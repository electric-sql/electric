defmodule Electric.Postgres.ReplicationClient do
  @moduledoc """
  A client module for Postgres logical replication.
  """
  use Postgrex.ReplicationConnection

  alias Electric.Postgres.LogicalReplication.Decoder
  alias Electric.Postgres.Lsn
  alias Electric.Postgres.ReplicationClient.Collector
  alias Electric.Postgres.ReplicationClient.ConnectionSetup
  alias Electric.Replication.Changes.Relation
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  @type step ::
          :disconnected
          | :connected
          | :query_pg_info
          | :create_publication
          | :create_slot
          | :set_display_setting
          | :ready_to_stream
          | :streaming

  defmodule State do
    @enforce_keys [:transaction_received, :relation_received, :publication_name]
    defstruct [
      :connection_manager,
      :transaction_received,
      :relation_received,
      :publication_name,
      :try_creating_publication?,
      :start_streaming?,
      :slot_name,
      :slot_temporary?,
      :display_settings,
      origin: "postgres",
      txn_collector: %Collector{},
      step: :disconnected,
      # Cache the end_lsn of the last processed Commit message to report it back to Postgres
      # on demand via standby status update messages -
      # https://www.postgresql.org/docs/current/protocol-replication.html#PROTOCOL-REPLICATION-STANDBY-STATUS-UPDATE
      #
      # Postgres defines separate "received and written to disk", "flushed to disk" and
      # "applied" offsets but we only keep track of the "applied" offset which we define as the
      # end LSN of the last transaction that we have successfully processed and persisted in the
      # shape log storage.
      applied_wal: 0
    ]

    @type t() :: %__MODULE__{
            connection_manager: pid(),
            transaction_received: {module(), atom(), [term()]},
            relation_received: {module(), atom(), [term()]},
            publication_name: String.t(),
            try_creating_publication?: boolean(),
            start_streaming?: boolean(),
            slot_name: String.t(),
            slot_temporary?: boolean(),
            origin: String.t(),
            txn_collector: Collector.t(),
            step: Electric.Postgres.ReplicationClient.step(),
            display_settings: [String.t()],
            applied_wal: non_neg_integer
          }

    @opts_schema NimbleOptions.new!(
                   connection_manager: [required: true, type: :pid],
                   transaction_received: [required: true, type: :mfa],
                   relation_received: [required: true, type: :mfa],
                   publication_name: [required: true, type: :string],
                   try_creating_publication?: [required: true, type: :boolean],
                   start_streaming?: [type: :boolean, default: true],
                   slot_name: [required: true, type: :string],
                   slot_temporary?: [type: :boolean, default: false]
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

  @spec start_link(Keyword.t()) :: :gen_statem.start_ret()
  def start_link(opts) do
    config = Map.new(opts)

    # Disable the reconnection logic in Postgex.ReplicationConnection to force it to exit with
    # the connection error. Without this, we may observe undesirable restarts in tests between
    # one test process exiting and the next one starting.
    start_opts =
      [
        # TODO: the name is not necessary
        name: name(config.stack_id),
        auto_reconnect: false
      ] ++ Electric.Utils.deobfuscate_password(config.connection_opts)

    Postgrex.ReplicationConnection.start_link(__MODULE__, config.replication_opts, start_opts)
  end

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def start_streaming(client) do
    send(client, :start_streaming)
  end

  def stop(client, reason) do
    Postgrex.ReplicationConnection.call(client, {:stop, reason})
  end

  # The `Postgrex.ReplicationConnection` behaviour does not follow the gen server conventions and
  # establishes its own instead. Unless the `sync_connect: false` option is passed to `start_link()`, the
  # connection process will try opening a replication connection to Postgres before returning
  # from its `init()` callback.
  #
  # The callbacks `init()`, `handle_connect()` and `handle_result()` defined in this module
  # below are all invoked inside the connection process' `init()` callback. Once any of our
  # callbacks return `{:stream, ...}`, the connection process finishes its initialization and
  # switches into the logical streaming mode to start receiving logical messages from Postgres,
  # invoking the `handle_data()` callback for each one.
  #
  # TODO(alco): this needs additional info about :noreply and :query return tuples.
  @impl true
  def init(replication_opts) do
    Process.set_label(:replication_client)

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
  def handle_call({:stop, reason}, from, _state) do
    Logger.notice(
      "Replication client #{inspect(self())} is stopping after receiving stop request from #{inspect(elem(from, 0))} with reason #{inspect(reason)}"
    )

    {:disconnect, reason}
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
        <<@repl_msg_x_log_data, _wal_start::64, wal_end::64, _clock::64, rest::binary>>,
        %State{} = state
      ) do
    OpenTelemetry.with_span(
      "pg_txn.replication_client.process_x_log_data",
      [msg_size: byte_size(rest)],
      fn -> process_x_log_data(rest, wal_end, state) end
    )
  end

  def handle_data(<<@repl_msg_primary_keepalive, wal_end::64, _clock::64, reply>>, state) do
    Logger.debug(fn ->
      "Primary Keepalive: wal_end=#{wal_end} (#{Lsn.from_integer(wal_end)}) reply=#{reply}"
    end)

    case reply do
      1 ->
        state = update_applied_wal(state, wal_end)
        {:noreply, [encode_standby_status_update(state)], state}

      0 ->
        {:noreply, [], state}
    end
  end

  defp process_x_log_data(data, wal_end, %State{} = state) do
    data
    |> decode_message()
    # # Useful for debugging:
    # |> tap(fn %struct{} = msg ->
    #   message_type = struct |> to_string() |> String.split(".") |> List.last()
    #
    #   Logger.debug(
    #     "XLogData: wal_start=#{wal_start} (#{Lsn.from_integer(wal_start)}), " <>
    #       "wal_end=#{wal_end} (#{Lsn.from_integer(wal_end)})\n" <>
    #       message_type <> " :: " <> inspect(Map.from_struct(msg))
    #   )
    # end)
    |> Collector.handle_message(state.txn_collector)
    |> case do
      %Collector{} = txn_collector ->
        {:noreply, %{state | txn_collector: txn_collector}}

      {%Relation{} = rel, %Collector{} = txn_collector} ->
        {m, f, args} = state.relation_received

        OpenTelemetry.with_span(
          "pg_txn.replication_client.relation_received",
          ["rel.id": rel.id, "rel.schema": rel.schema, "rel.table": rel.table],
          fn -> apply(m, f, [rel | args]) end
        )

        {:noreply, %{state | txn_collector: txn_collector}}

      {txn, %Collector{} = txn_collector} ->
        state = %{state | txn_collector: txn_collector}

        {m, f, args} = state.transaction_received

        # this will block until all the consumers have processed the transaction because
        # the log collector uses manual demand, and only replies to the `call` once it
        # receives more demand.
        # The timeout for any call here is important. Different storage
        # backends will require different timeouts and the timeout will need to
        # accomodate varying number of shape consumers.
        #
        # The current solution is to set timeout: :infinity for the call that
        # sends the txn message to the consumers and waits for them all to
        # write to storage, but crash individual consumers if the write takes
        # too long. So it doesn't matter how many consumers we have but an
        # individual storage write can timeout the entire batch.
        OpenTelemetry.with_span(
          "pg_txn.replication_client.transaction_received",
          [num_changes: length(txn.changes), num_relations: MapSet.size(txn.affected_relations)],
          fn -> apply(m, f, [txn | args]) end
        )
        |> case do
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

  defp decode_message(data) do
    OpenTelemetry.with_span(
      "pg_txn.replication_client.decode_message",
      [msg_size: byte_size(data)],
      fn -> Decoder.decode(data) end
    )
  end

  defp encode_standby_status_update(state) do
    <<
      @repl_msg_standby_status_update,
      state.applied_wal + 1::64,
      state.applied_wal + 1::64,
      state.applied_wal + 1::64,
      current_time()::64,
      0
    >>
  end

  @epoch DateTime.to_unix(~U[2000-01-01 00:00:00Z], :microsecond)
  defp current_time(), do: System.os_time(:microsecond) - @epoch

  defp update_applied_wal(state, wal) when wal >= state.applied_wal,
    do: %{state | applied_wal: wal}
end
