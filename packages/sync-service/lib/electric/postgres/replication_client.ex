defmodule Electric.Postgres.ReplicationClient do
  @moduledoc """
  A client module for Postgres logical replication.
  """
  use Postgrex.ReplicationConnection

  require Electric.Postgres.ReplicationClient.Collector
  alias Electric.Replication.Changes.Transaction
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
          | :drop_slot
          | :create_slot
          | :set_display_setting
          | :ready_to_stream
          | :streaming

  defmodule State do
    @enforce_keys [:transaction_received, :relation_received, :publication_name]
    defstruct [
      :stack_id,
      :connection_manager,
      :transaction_received,
      :relation_received,
      :publication_name,
      :try_creating_publication?,
      :recreate_slot?,
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
            stack_id: String.t(),
            connection_manager: pid(),
            transaction_received: {module(), atom(), [term()]},
            relation_received: {module(), atom(), [term()]},
            publication_name: String.t(),
            try_creating_publication?: boolean(),
            recreate_slot?: boolean(),
            start_streaming?: boolean(),
            slot_name: String.t(),
            slot_temporary?: boolean(),
            origin: String.t(),
            txn_collector: Collector.t(),
            step: Electric.Postgres.ReplicationClient.step(),
            display_settings: [String.t()],
            applied_wal: non_neg_integer()
          }

    @opts_schema NimbleOptions.new!(
                   stack_id: [required: true, type: :string],
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
        name: name(config.stack_id),
        auto_reconnect: false,
        sync_connect: false
      ] ++ Electric.Utils.deobfuscate_password(config.replication_opts[:connection_opts])

    Postgrex.ReplicationConnection.start_link(
      __MODULE__,
      Keyword.delete(config.replication_opts, :connection_opts),
      start_opts
    )
  end

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  # This is a send() and not a call() to prevent the caller (the Connection.Manager process) from
  # getting blocked when the replication connection is blocked some replication slot condition
  # that doesn't let it start streaming immediately.
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
  # would all be invoked inside the connection process' `init()` callback in that case. Once
  # any of the callbacks return `{:stream, ...}`, the connection process finishes its
  # initialization and switches into the logical streaming mode to start receiving logical
  # messages from Postgres, invoking the `handle_data()` callback for each one.
  #
  # TODO(alco): this needs additional info about :noreply and :query return tuples.
  @impl true
  def init(replication_opts) do
    state = State.new(replication_opts)

    Process.set_label({:replication_client, state.stack_id})
    Logger.metadata(stack_id: state.stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: state.stack_id)

    {:ok, state}
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
    |> notify_connection_opened()
    |> ConnectionSetup.start()
  end

  @impl true
  def handle_result(result_list_or_error, state) do
    {current_step, next_step, extra_info, return_val} =
      ConnectionSetup.process_query_result(result_list_or_error, state)

    if current_step == :query_pg_info,
      do: notify_pg_info_obtained(state, extra_info)

    if current_step == :create_slot and extra_info == :created_new_slot,
      do: notify_created_new_slot(state)

    if next_step == :ready_to_stream,
      do: notify_ready_to_stream(state)

    return_val
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

  # This callback is invoked when the connection process receives a shutdown signal.
  def handle_info({:EXIT, _pid, :shutdown}, _state) do
    Logger.debug("Replication client #{inspect(self())} received shutdown signal, stopping")
    {:disconnect, :shutdown}
  end

  # Some other exit reason we're not expecting: disconnect and shut down.
  def handle_info({:EXIT, _pid, reason}, _state) do
    {:disconnect, reason}
  end

  # The implementation of Postgrex.ReplicationConnection doesn't give us a convenient way to
  # check whether the START_REPLICATION_SLOT statement succeeded before switching the
  # connection into streaming mode. Returning {:query, "START_REPLICATION_SLOT ...", state}
  # works fine when the query result is an error: it is then passed to the handle_result()
  # callback. But if streaming starts without issues, a function clause error is encountered
  # inside Postgrex.ReplicationConnection because it expects the connection to already have
  # been switched into streaming mode by returning {:stream, "START_REPLICATION_SLOT ...", [], state}.
  #
  # Hence this function clause of `handle_data()` that notifies the connection manager about
  # successful streaming start as soon as it receives the first replication message from
  # Postgres.
  @impl true
  @spec handle_data(binary(), State.t()) ::
          {:noreply, State.t()} | {:noreply, list(binary()), State.t()}
  def handle_data(data, %State{step: :start_streaming} = state) do
    state = %{state | step: :streaming}
    notify_seen_first_message(state)
    handle_data(data, state)
  end

  def handle_data(
        <<@repl_msg_x_log_data, _wal_start::64, wal_end::64, _clock::64, rest::binary>>,
        %State{stack_id: _stack_id} = state
      ) do
    process_x_log_data(rest, wal_end, state)
  end

  def handle_data(<<@repl_msg_primary_keepalive, wal_end::64, _clock::64, reply>>, state) do
    Logger.debug(fn ->
      "Primary Keepalive: wal_end=#{wal_end} (#{Lsn.from_integer(wal_end)}) reply=#{reply}"
    end)

    case reply do
      1 when Collector.is_collecting(state.txn_collector) ->
        {:noreply, [encode_standby_status_update(state)], state}

      # if we are not collecting any transactions, advance the replication slot
      # with keepalives to avoid it getting filled with irrelevant changes, like
      # heartbeats from the database provider
      1 ->
        state = update_applied_wal(state, wal_end)
        {:noreply, [encode_standby_status_update(state)], state}

      0 ->
        {:noreply, [], state}
    end
  end

  defp process_x_log_data(data, _wal_end, %State{stack_id: stack_id} = state) do
    decode_message(data)
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
          stack_id,
          fn -> apply(m, f, [rel | args]) end
        )

        {:noreply, %{state | txn_collector: txn_collector}}

      {%Transaction{} = txn, %Collector{} = txn_collector} ->
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
        apply(m, f, [txn | args])
        |> case do
          :ok ->
            # We currently process incoming replication messages sequentially, persisting each
            # new transaction into the shape log store. So, when the applied function
            # returns, we can safely advance the replication slot past the transaction's commit
            # LSN.
            state = update_applied_wal(state, Electric.Postgres.Lsn.to_integer(txn.lsn))
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
    Decoder.decode(data)
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

  defp update_applied_wal(state, wal) when is_number(wal) and wal >= state.applied_wal,
    do: %{state | applied_wal: wal}

  defp update_applied_wal(state, wal) when is_number(wal), do: state

  defp notify_connection_opened(%State{connection_manager: manager} = state) do
    :ok = Electric.Connection.Manager.replication_client_started(manager)
    state
  end

  defp notify_pg_info_obtained(%State{connection_manager: manager} = state, pg_info) do
    :ok = Electric.Connection.Manager.pg_info_obtained(manager, pg_info)
    state
  end

  defp notify_created_new_slot(%State{connection_manager: manager} = state) do
    :ok = Electric.Connection.Manager.replication_client_created_new_slot(manager)
    state
  end

  defp notify_ready_to_stream(%State{connection_manager: manager} = state) do
    :ok = Electric.Connection.Manager.replication_client_ready_to_stream(manager)
    state
  end

  defp notify_seen_first_message(%State{connection_manager: manager} = state) do
    :ok = Electric.Connection.Manager.replication_client_streamed_first_message(manager)
    state
  end
end
