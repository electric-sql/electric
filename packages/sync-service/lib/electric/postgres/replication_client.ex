defmodule Electric.Postgres.ReplicationClient do
  @moduledoc """
  A client module for Postgres logical replication.
  """
  use Postgrex.ReplicationConnection

  alias Electric.Postgres.LogicalReplication.Decoder
  alias Electric.Postgres.ReplicationClient.Collector

  require Logger

  defmodule State do
    @enforce_keys [:transaction_received, :publication_name]
    defstruct [
      :transaction_received,
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
            publication_name: String.t(),
            try_creating_publication?: boolean(),
            start_streaming?: boolean(),
            slot_name: String.t(),
            origin: String.t(),
            txn_collector: Collector.t(),
            step:
              :disconnected
              | :create_publication
              | :create_slot
              | :ready_to_stream
              | :streaming
              | :set_display_setting,
            display_settings: [String.t()],
            received_wal: non_neg_integer,
            applied_wal: non_neg_integer
          }

    @opts_schema NimbleOptions.new!(
                   transaction_received: [required: true, type: :mfa],
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

  @repl_msg_x_log_data ?w
  @repl_msg_primary_keepalive ?k
  @repl_msg_standby_status_update ?r

  def start_link(connection_opts, replication_opts) do
    Postgrex.ReplicationConnection.start_link(__MODULE__, replication_opts, connection_opts)
  end

  def start_streaming(client) do
    send(client, :start_streaming)
  end

  # The Postgrex.ReplicationConnection behaviour does not adhere to gen server conventions and
  # establishes its own. Unless the `sync_connet: true` option is passed to `start_link()`, the
  # connection process will try opening a replication connection to Postgres before returning
  # from its `init()` callback.
  #
  # The callbacks `init()`, `handle_connect()` and `handle_result()` defined in this module
  # below are all invoked inside the connection process' `init()` callback. Once any of our
  # callbacks returns `{:stream, ...}`, the connection process finishes its initialization and
  # starts receiving replication messages from Postgres, invoking the `handle_data()` callback
  # for each one.
  @impl true
  def init(replication_opts) do
    {:ok, State.new(replication_opts)}
  end

  @impl true
  def handle_connect(%State{display_settings: [query | rest]} = state) do
    {:query, query, %{state | display_settings: rest, step: :set_display_setting}}
  end

  def handle_connect(state) do
    if state.try_creating_publication? do
      create_publication_step(state)
    else
      create_replication_slot_step(state)
    end
  end

  # Successful creation of the replication slot.
  @impl true
  def handle_result(
        [%Postgrex.Result{command: :create_publication}],
        %State{step: :create_publication} = state
      ) do
    create_replication_slot_step(state)
  end

  def handle_result(result, %State{step: :set_display_setting} = state) do
    if is_struct(result, Postgrex.Error) do
      Logger.error("Failed to set display setting: #{inspect(result)}")
    end

    handle_connect(state)
  end

  def handle_result(%Postgrex.Error{} = error, %State{step: :create_publication} = state) do
    error_message = "publication \"#{state.publication_name}\" already exists"

    case error.postgres do
      %{code: :duplicate_object, pg_code: "42710", message: ^error_message} ->
        create_replication_slot_step(state)

      other ->
        {:disconnect, other}
    end
  end

  def handle_result([%Postgrex.Result{} = result], %State{step: :create_slot} = state) do
    log_slot_creation_result(result)

    maybe_start_streaming(state)
  end

  # Error while trying to create the replication slot.
  def handle_result(%Postgrex.Error{} = error, %State{step: :create_slot} = state) do
    error_msg = "replication slot \"#{state.slot_name}\" already exists"

    case error.postgres do
      %{code: :duplicate_object, pg_code: "42710", message: ^error_msg} ->
        # Slot already exists, proceed nominally.
        Logger.debug("Found existing replication slot")
        maybe_start_streaming(state)

      _ ->
        # Unexpected error, fail loudly.
        raise error
    end
  end

  @impl true
  def handle_info(:start_streaming, state) do
    if state.step == :ready_to_stream do
      start_streaming_step(state)
    else
      Logger.debug("Replication client requested to start streaming while step=#{state.step}")
      {:noreply, state}
    end
  end

  @impl true
  @spec handle_data(binary(), State.t()) ::
          {:noreply, State.t()} | {:noreply, list(binary()), State.t()}
  def handle_data(
        <<@repl_msg_x_log_data, wal_start::64, wal_end::64, _clock::64, rest::binary>>,
        %State{} = state
      ) do
    Logger.debug("XLogData: wal_start=#{wal_start}, wal_end=#{wal_end}")

    state = update_received_wal(state, wal_end)

    rest
    |> Decoder.decode()
    |> Collector.handle_message(state.txn_collector)
    |> case do
      %Collector{} = txn_collector ->
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
    state = update_received_wal(state, wal_end)

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

  defp create_publication_step(state) do
    # We're creating an "empty" publication because first snapshot creation should add the table
    query = "CREATE PUBLICATION #{state.publication_name}"
    {:query, query, %{state | step: :create_publication}}
  end

  defp create_replication_slot_step(state) do
    query = "CREATE_REPLICATION_SLOT #{state.slot_name} LOGICAL pgoutput NOEXPORT_SNAPSHOT"
    {:query, query, %{state | step: :create_slot}}
  end

  defp maybe_start_streaming(state) do
    if state.start_streaming? do
      start_streaming_step(state)
    else
      {:noreply, %{state | step: :ready_to_stream}}
    end
  end

  defp start_streaming_step(state) do
    query =
      "START_REPLICATION SLOT #{state.slot_name} LOGICAL 0/0 (proto_version '1', publication_names '#{state.publication_name}')"

    Logger.info("Started replication from postgres")

    {:stream, query, [], %{state | step: :streaming}}
  end

  defp log_slot_creation_result(result) do
    Logger.debug(fn ->
      %Postgrex.Result{
        command: :create,
        columns: ["slot_name", "consistent_point", "snapshot_name", "output_plugin"],
        rows: [[_, lsn_str, nil, _]],
        num_rows: 1,
        connection_id: _,
        messages: []
      } = result

      "Created new slot at lsn=#{lsn_str}"
    end)
  end

  # This is an edge case that seems to be caused by the documented requirement to respond to `Primary
  # keepalive message`[1] with a `Standby status update`[2] message that has all of the WAL byte
  # offset values incremented by 1. Perhaps, it is a bug in Postgres: when Electric opens a new
  # replication connection, Postgres immediately sends a "keepalive" message where the value of
  # `wal_end` is the last "flushed to disk" WAL offset that Electric reported prior to closing
  # the replication connection. This looks suspicious because in subsequent "keepalive"
  # messages that Postgres sends to Electric throughout the lifetime of the replication
  # connection it *does not* use the incremented value reported by Electric for `wal_end` but
  # instead uses the original offset that does not have 1 added to it.
  #
  # [1]: https://www.postgresql.org/docs/current/protocol-replication.html#PROTOCOL-REPLICATION-PRIMARY-KEEPALIVE-MESSAGE
  # [2]: https://www.postgresql.org/docs/current/protocol-replication.html#PROTOCOL-REPLICATION-STANDBY-STATUS-UPDATE
  defp update_received_wal(state, wal) when wal == state.received_wal - 1, do: state

  # wal can be 0 if the incoming logical message is e.g. Relation.
  defp update_received_wal(state, 0), do: state

  defp update_received_wal(%{received_wal: wal} = state, wal), do: state

  defp update_received_wal(state, wal) when wal > state.received_wal,
    do: %{state | received_wal: wal}

  defp update_applied_wal(state, wal) when wal > state.applied_wal,
    do: %{state | applied_wal: wal}

  # wal can be 0 if the incoming logical message is e.g. Relation.
  defp update_applied_wal(state, 0), do: state
end
