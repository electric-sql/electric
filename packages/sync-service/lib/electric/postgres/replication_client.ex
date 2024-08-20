defmodule Electric.Postgres.ReplicationClient do
  @moduledoc """
  A client module for Postgres logical replication.
  """
  use Postgrex.ReplicationConnection

  alias Electric.Postgres.LogicalReplication.Decoder
  alias Electric.Postgres.ReplicationClient.Collector
  alias Electric.Postgres.ReplicationClient.ConnectionSetup
  alias Electric.Replication.Changes.RelationChange

  require Logger

  @type step ::
          :disconnected
          | :connected
          | :create_publication
          | :create_slot
          | :set_display_setting
          | :ready_to_stream
          | :streaming

  defmodule State do
    @enforce_keys [:transaction_received, :relation_received, :publication_name]
    defstruct [
      :transaction_received,
      :relation_received,
      :publication_name,
      :try_creating_publication?,
      :start_streaming?,
      :slot_name,
      :display_settings,
      origin: "postgres",
      txn_collector: %Collector{},
      step: :disconnected,
      # Keep track of the latest received and applied WAL offsets so that we can report them
      # back to Postgres in standby status update messages -
      # https://www.postgresql.org/docs/current/protocol-replication.html#PROTOCOL-REPLICATION-STANDBY-STATUS-UPDATE
      #
      # Postgres defines separate "flushed" and "applied" offsets but we merge those into one
      # concept of "applied WAL" which is defined as the offset we have successfully processed
      # and persisted in our shape log storage.
      received_wal: 0,
      applied_wal: 0
    ]

    @type t() :: %__MODULE__{
            transaction_received: {module(), atom(), [term()]},
            relation_received: {module(), atom(), [term()]},
            publication_name: String.t(),
            try_creating_publication?: boolean(),
            start_streaming?: boolean(),
            slot_name: String.t(),
            origin: String.t(),
            txn_collector: Collector.t(),
            step: Electric.Postgres.ReplicationClient.step(),
            display_settings: [String.t()],
            received_wal: non_neg_integer,
            applied_wal: non_neg_integer
          }

    @opts_schema NimbleOptions.new!(
                   transaction_received: [required: true, type: :mfa],
                   relation_received: [required: true, type: :mfa],
                   publication_name: [required: true, type: :string],
                   try_creating_publication?: [required: true, type: :boolean],
                   start_streaming?: [type: :boolean, default: true],
                   slot_name: [required: true, type: :string]
                 )

    @spec new(Access.t()) :: t()
    def new(opts) do
      opts = NimbleOptions.validate!(opts, @opts_schema)
      settings = [display_settings: Electric.Postgres.display_settings()]
      opts = settings ++ opts
      struct!(__MODULE__, opts)
    end
  end

  # @type state :: State.t()

  @repl_msg_x_log_data ?w
  @repl_msg_primary_keepalive ?k
  @repl_msg_standby_status_update ?r

  def start_link(connection_opts, replication_opts) do
    # Disable the reconnection logic in Postgex.ReplicationConnection to force it to exit with
    # the connection error. Without this, we may observe undesirable restarts in tests between
    # one test process exiting and the next one starting.
    connection_opts = [auto_reconnect: false] ++ connection_opts
    Postgrex.ReplicationConnection.start_link(__MODULE__, replication_opts, connection_opts)
  end

  def start_streaming(client) do
    send(client, :start_streaming)
  end

  # The `Postgrex.ReplicationConnection` behaviour does not adhere to gen server conventions and
  # establishes its own. Unless the `sync_connet: false` option is passed to `start_link()`, the
  # connection process will try opening a replication connection to Postgres before returning
  # from its `init()` callback.
  #
  # The callbacks `init()`, `handle_connect()` and `handle_result()` defined in this module
  # below are all invoked inside the connection process' `init()` callback. Once any of our
  # callbacks returns `{:stream, ...}`, the connection process finishes its initialization and
  # switches into the logical streaming mode to start receiving logical messages from Postgres,
  # invoking the `handle_data()` callback for each one.
  @impl true
  def init(replication_opts) do
    {:ok, State.new(replication_opts)}
  end

  # `Postgrex.ReplicationConnection` opens a new replication connection to Postgres and then
  # gives us a chance to execute one or more queries before switching into the logical
  # streaming mode. It doesn't give us the connection socket but instead takes the query returned
  # by one of our `handle_connect/1`, `handle_result/2` or `handle_info/2` callbacks, executes
  # it, invokes the `handle_result/2` callback on the result which may return another query to
  # execute, executes that, and so it goes on and on, recursively, until a callback returns
  # `{:noreply, ...}` or `{:streaming, ...}`.
  #
  # To execute a series of queries one after the other, we define an ad-hoc state
  # machine that starts from the :connected state in `handle_connect/1`, then transitions to
  # the next step and returns the appropriate query to `Postgrex.ReplicationConnection` for execution,
  # This is all implemented in a separate module named `Electric.Postgres.ReplicationClient.ConnectionSetup`
  # to separate the connection setup logic from logical streaming.

  @impl true
  def handle_connect(state) do
    %{state | step: :connected}
    |> ConnectionSetup.start()
  end

  @impl true
  def handle_result(result_list_or_error, state) do
    ConnectionSetup.process_query_result(result_list_or_error, state)
  end

  @impl true
  def handle_info(:start_streaming, %State{step: :ready_to_stream} = state) do
    ConnectionSetup.start_streaming(state)
  end

  def handle_info(:start_streaming, %State{step: step} = state) do
    Logger.debug("Replication client requested to start streaming while step=#{step}")
    {:noreply, state}
  end

  @impl true
  @spec handle_data(binary(), State.t()) ::
          {:noreply, State.t()} | {:noreply, list(binary()), State.t()}
  def handle_data(
        <<@repl_msg_x_log_data, wal_start::64, wal_end::64, _clock::64, rest::binary>>,
        %State{} = state
      ) do
    Logger.debug("XLogData: wal_start=#{wal_start}, wal_end=#{wal_end}")

    state = update_received_wal(:xlog_data, state, wal_start, wal_end)

    rest
    |> Decoder.decode()
    |> Collector.handle_message(state.txn_collector)
    |> case do
      %Collector{} = txn_collector ->
        {:noreply, %{state | txn_collector: txn_collector}}

      {%RelationChange{} = rel, %Collector{} = txn_collector} ->
        {m, f, args} = state.relation_received
        apply(m, f, [rel | args])
        {:noreply, %{state | txn_collector: txn_collector}}

      {txn, %Collector{} = txn_collector} ->
        state = %{state | txn_collector: txn_collector}

        {m, f, args} = state.transaction_received

        case apply(m, f, [txn | args]) do
          :ok ->
            # We currently process incoming replication messages sequentially, persisting each
            # new transaction into the shape log store. So, when the applied function
            # returns, we can safely advance the replication slot past the transaction's commit
            # LSN.
            state = update_applied_wal(state, wal_end)
            {:noreply, [encode_standby_status_update(state)], state}

          other ->
            # TODO(alco): crash the connection process here?
            # If we keep going and a subsequent transaction is processed successfully, Electric
            # will acknowledge the later LSN to Postgres and so the next time it opens a
            # replication connection, it will no longer receive the failed transaction.
            Logger.error("Unexpected result from calling #{inspect(m)}.#{f}(): #{inspect(other)}")
            {:noreply, state}
        end
    end
  end

  def handle_data(<<@repl_msg_primary_keepalive, wal_end::64, _clock::64, reply>>, state) do
    Logger.debug("Primary Keepalive: wal_end=#{wal_end} reply=#{reply}")

    state = update_received_wal(:keepalive, state, nil, wal_end)

    messages =
      case reply do
        1 -> [encode_standby_status_update(state)]
        0 -> []
      end

    {:noreply, messages, state}
  end

  defp encode_standby_status_update(state) do
    # Even though Postgres docs say[1] that these values need to be incremented by 1,
    # Postgres' own walreceiver process does not seem to be doing that.
    # Given the fact that `state.applied_wal` is set to the `wal_end` value of the most
    # recently processed XLogData message (which itself appears to be the end LSN + 1 of the last
    # transaction's Commit message) I'm worried about Postgres skipping the next transaction by
    # treating the "flushed LSN" we're reporting back to it as having passed the transaction.
    # TODO: needs more testing/PG source reading/whatever.
    #
    # [1]: https://www.postgresql.org/docs/current/protocol-replication.html#PROTOCOL-REPLICATION-STANDBY-STATUS-UPDATE
    <<
      @repl_msg_standby_status_update,
      state.received_wal::64,
      state.applied_wal::64,
      state.applied_wal::64,
      current_time()::64,
      0
    >>
  end

  @epoch DateTime.to_unix(~U[2000-01-01 00:00:00Z], :microsecond)
  defp current_time(), do: System.os_time(:microsecond) - @epoch

  # wal can be 0 if the incoming logical message is e.g. Relation.
  defp update_received_wal(_step, state, _, 0), do: state

  defp update_received_wal(_step, %{received_wal: wal} = state, _, wal), do: state

  defp update_received_wal(_step, state, _, wal) when wal > state.received_wal,
    do: %{state | received_wal: wal}

  defp update_applied_wal(state, wal) when wal > state.applied_wal,
    do: %{state | applied_wal: wal}

  # wal can be 0 if the incoming logical message is e.g. Relation.
  defp update_applied_wal(state, 0), do: state
end
