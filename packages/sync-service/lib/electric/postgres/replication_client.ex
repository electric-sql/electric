defmodule Electric.Postgres.ReplicationClient do
  @moduledoc """
  A client module for Postgres logical replication.
  """
  use Postgrex.ReplicationConnection

  alias Electric.Postgres.LogicalReplication.Decoder
  alias Electric.Postgres.Lsn
  alias Electric.Postgres.ReplicationClient.MessageConverter
  alias Electric.Postgres.ReplicationClient.ConnectionSetup
  alias Electric.Replication.Changes.TransactionFragment
  alias Electric.Replication.Changes.Relation
  alias Electric.Telemetry.OpenTelemetry
  alias Electric.Telemetry.Sampler

  require Logger
  require MessageConverter

  @type step ::
          :disconnected
          | :connected
          | :identify_system
          | :query_pg_info
          | :acquire_lock
          | :create_publication
          | :check_if_publication_exists
          | :drop_slot
          | :create_slot
          | :query_slot_flushed_lsn
          | :set_display_setting
          | :ready_to_stream
          | :start_streaming
          | :streaming

  defmodule State do
    @enforce_keys [:handle_event, :publication_name]
    defstruct [
      :stack_id,
      :connection_manager,
      :handle_event,
      :publication_name,
      :lock_acquired?,
      :try_creating_publication?,
      :recreate_slot?,
      :start_streaming?,
      :pg_version,
      :slot_name,
      :slot_temporary?,
      :display_settings,
      :message_converter,
      :publication_owner?,
      :replication_idle_timeout,
      step: :disconnected,
      # Cache the end_lsn of the last processed Commit message to report it back to Postgres
      # on demand via standby status update messages -
      # https://www.postgresql.org/docs/current/protocol-replication.html#PROTOCOL-REPLICATION-STANDBY-STATUS-UPDATE
      #
      # Postgres defines separate "received and written to disk", "flushed to disk" and
      # "applied" offsets but we only keep track of the "applied" offset which we define as the
      # end LSN of the last transaction that we have successfully processed and persisted in the
      # shape log storage.
      received_wal: 0,
      flushed_wal: 0,
      last_seen_txn_lsn: Lsn.from_integer(0),
      last_seen_txn_timestamp: nil,
      flush_up_to_date?: true
    ]

    @type t() :: %__MODULE__{
            stack_id: String.t(),
            connection_manager: pid(),
            handle_event: {module(), atom(), [term()]},
            publication_name: String.t(),
            try_creating_publication?: boolean(),
            recreate_slot?: boolean(),
            start_streaming?: boolean(),
            pg_version: non_neg_integer(),
            slot_name: String.t(),
            slot_temporary?: boolean(),
            display_settings: [String.t()],
            message_converter: MessageConverter.t(),
            publication_owner?: boolean(),
            replication_idle_timeout: non_neg_integer(),
            step: Electric.Postgres.ReplicationClient.step(),
            received_wal: non_neg_integer(),
            flushed_wal: non_neg_integer(),
            last_seen_txn_lsn: Lsn.t(),
            last_seen_txn_timestamp: integer(),
            flush_up_to_date?: boolean()
          }

    @opts_schema NimbleOptions.new!(
                   stack_id: [required: true, type: :string],
                   connection_manager: [required: true, type: :pid],
                   handle_event: [required: true, type: :mfa],
                   publication_name: [required: true, type: :string],
                   try_creating_publication?: [required: true, type: :boolean],
                   start_streaming?: [type: :boolean, default: true],
                   slot_name: [required: true, type: :string],
                   slot_temporary?: [type: :boolean, default: false],
                   replication_idle_timeout: [type: :non_neg_integer, default: 0],
                   # Set a reasonable limit for the maximum size of a transaction that
                   # we can handle, above which we would exit as we run the risk of running
                   # out of memmory.
                   # TODO: stream out transactions and collect on disk to avoid this
                   max_txn_size: [type: {:or, [:non_neg_integer, nil]}, default: nil],
                   # Maximum number of changes to buffer before flushing a transaction fragment.
                   # Smaller values result in more message passing overhead but lower memory usage.
                   # The minimum allowed value is 2.
                   max_batch_size: [type: :non_neg_integer, default: 100]
                 )

    @spec new(Access.t()) :: t()
    def new(opts) do
      opts = NimbleOptions.validate!(opts, @opts_schema)
      settings = [display_settings: Electric.Postgres.display_settings()]
      opts = settings ++ opts

      {max_txn_size, opts} = Keyword.pop!(opts, :max_txn_size)
      {max_batch_size, opts} = Keyword.pop!(opts, :max_batch_size)

      # Assert the implicit requirement
      true = max_batch_size >= 2

      struct!(
        __MODULE__,
        opts ++
          [
            message_converter:
              MessageConverter.new(
                max_tx_size: max_txn_size,
                max_batch_size: max_batch_size
              )
          ]
      )
    end
  end

  # @type state :: State.t()

  @repl_msg_x_log_data ?w
  @repl_msg_primary_keepalive ?k
  @repl_msg_standby_status_update ?r

  @default_connect_timeout 30_000
  @idle_check_interval Electric.Config.min_replication_idle_timeout()

  @spec start_link(Keyword.t()) :: :gen_statem.start_ret()
  def start_link(opts) do
    config = Map.new(opts)

    # Disable the reconnection logic in Postgex.ReplicationConnection to force it to exit with
    # the connection error. Without this, we may observe undesirable restarts in tests between
    # one test process exiting and the next one starting.
    start_opts =
      [
        name: name(config.stack_id),
        timeout: Access.get(opts, :timeout, @default_connect_timeout),
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

    Logger.metadata(stack_id: state.stack_id, is_connection_process?: true)
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

    if current_step == :identify_system,
      do: notify_system_identified(state, extra_info)

    if current_step == :query_pg_info,
      do: notify_pg_info_obtained(state, extra_info)

    if current_step == :acquire_lock do
      case extra_info do
        :lock_acquired -> notify_lock_acquired(state)
        {:lock_acquisition_failed, error} -> notify_lock_acquisition_error(state, error)
      end
    end

    # for new slots, always reset the last processed LSN
    if current_step == :create_slot and extra_info == :created_new_slot do
      Electric.LsnTracker.set_last_processed_lsn(state.stack_id, state.flushed_wal)
      notify_created_new_slot(state)
    end

    # for existing slots, populate the last processed LSN if not present
    if current_step == :query_slot_flushed_lsn,
      do: Electric.LsnTracker.initialize_last_processed_lsn(state.stack_id, state.flushed_wal)

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
  def handle_info({:flush_boundary_updated, lsn}, state) do
    state =
      if Lsn.from_integer(lsn) == state.last_seen_txn_lsn do
        %{
          state
          | flush_up_to_date?: true,
            flushed_wal: state.received_wal,
            received_wal: max(lsn, state.received_wal)
        }
      else
        %{state | flushed_wal: max(lsn, state.flushed_wal), received_wal: state.received_wal}
      end

    {:noreply, [encode_standby_status_update(state)], state}
  end

  @impl true
  def handle_info(:start_streaming, %State{step: :ready_to_stream} = state) do
    ConnectionSetup.start_streaming(state)
  end

  def handle_info(:start_streaming, %State{step: step} = state) do
    Logger.debug("Replication client requested to start streaming while step=#{step}")
    {:noreply, state}
  end

  def handle_info(:check_if_idle, %State{last_seen_txn_timestamp: txn_ts} = state) do
    time_diff = System.convert_time_unit(System.monotonic_time() - txn_ts, :native, :millisecond)

    if time_diff >= state.replication_idle_timeout do
      {:disconnect, {:shutdown, {:connection_idle, time_diff}}}
    else
      {:noreply, state}
    end
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
    # Modify the state as if we've just seen a transaction so that in the future we have a
    # starting point to check how long the stream has been idle for.
    state = %{state | step: :streaming, last_seen_txn_timestamp: System.monotonic_time()}

    if state.replication_idle_timeout > 0 do
      :timer.send_interval(@idle_check_interval, :check_if_idle)
    end

    notify_seen_first_message(state)
    handle_data(data, state)
  end

  def handle_data(<<@repl_msg_primary_keepalive, wal_end::64, _clock::64, reply>>, state) do
    Logger.debug(fn ->
      "Primary Keepalive: wal_end=#{wal_end} (#{Lsn.from_integer(wal_end)}) reply=#{reply}"
    end)

    case reply do
      1 when MessageConverter.in_transaction?(state.message_converter) ->
        {:noreply, [encode_standby_status_update(state)], state}

      # if we are not in a transaction, advance the replication slot
      # with keepalives to avoid it getting filled with irrelevant changes, like
      # heartbeats from the database provider
      1 ->
        state = update_stored_wals(state, wal_end)
        {:noreply, [encode_standby_status_update(state)], state}

      0 when MessageConverter.in_transaction?(state.message_converter) ->
        {:noreply, [], state}

      0 ->
        state = update_stored_wals(state, wal_end)
        {:noreply, [], state}
    end
  end

  def handle_data(
        <<@repl_msg_x_log_data, _wal_start::64, _server_wal_end::64, _clock::64, data::binary>>,
        %State{} = state
      ) do
    msg = Decoder.decode(data)

    # Useful for debugging:
    # %struct{} = msg
    # message_type = struct |> to_string() |> String.split(".") |> List.last()

    # Logger.debug(
    #   "XLogData: wal_start=#{wal_start} (#{Lsn.from_integer(wal_start)}), " <>
    #     "wal_end=#{wal_end} (#{Lsn.from_integer(wal_end)})\n" <>
    #     message_type <> " :: " <> inspect(Map.from_struct(msg))
    # )

    case MessageConverter.convert(msg, state.message_converter) do
      {:error, reason} ->
        {:disconnect, {:irrecoverable_slot, reason}}

      {:buffering, converter} ->
        {:noreply, %{state | message_converter: converter}}

      {:ok, event, converter} ->
        state = %{state | message_converter: converter}

        handle_event(event, state)

        state = maybe_update_flush_up_to_date(state)

        {acks, state} = acknowledge_transaction(event, state)

        {:noreply, acks, state}
    end
  end

  defp handle_event(event, state) do
    {m, f, args} = state.handle_event

    apply_with_retries({m, f, [event | args]}, state)
  end

  defp acknowledge_transaction(%TransactionFragment{commit: nil}, state), do: {[], state}

  defp acknowledge_transaction(%TransactionFragment{lsn: lsn, commit: commit}, state) do
    if Sampler.sample_metrics?() do
      alias Electric.Replication.Changes.Commit

      OpenTelemetry.execute(
        [:electric, :postgres, :replication, :transaction_received],
        %{
          monotonic_time: System.monotonic_time(),
          receive_lag: Commit.calculate_final_receive_lag(commit, System.monotonic_time()),
          bytes: commit.transaction_size,
          count: 1,
          operations: commit.txn_change_count
        },
        %{stack_id: state.stack_id}
      )
    end

    state =
      %{
        state
        | last_seen_txn_lsn: lsn,
          last_seen_txn_timestamp: System.monotonic_time()
      }
      |> update_received_wal(Lsn.to_integer(lsn))

    {[encode_standby_status_update(state)], state}
  end

  defp acknowledge_transaction(%Relation{}, state), do: {[], state}

  defp maybe_update_flush_up_to_date(state) do
    if MessageConverter.in_transaction?(state.message_converter) do
      %{state | flush_up_to_date?: false}
    else
      state
    end
  end

  defp encode_standby_status_update(state) do
    Logger.debug(fn ->
      "Standby status update: received_wal=#{Lsn.from_integer(state.received_wal)}, flushed_wal=#{Lsn.from_integer(state.flushed_wal)}"
    end)

    <<
      @repl_msg_standby_status_update,
      state.received_wal + 1::64,
      state.flushed_wal + 1::64,
      state.flushed_wal + 1::64,
      current_time()::64,
      0
    >>
  end

  # Retry applying the given MFA
  # A retry may need to happen if the connection is available or the collector is not ready yet.
  # In those instances we wait until the stack is ready and retry, and will go on retrying forever.
  # We may also get a process down, and we retry here too but with a timeout since processes should
  # be bought back up by the supervisor and if this carries on for longer than the timeout there may
  # be a more serious issue.
  @retry_time 10 * 60_000
  @spin_prevention_delay 50
  defp apply_with_retries(mfa, state, time_remaining \\ @retry_time) do
    start_time = System.monotonic_time(:millisecond)
    {m, f, args} = mfa

    try do
      case apply(m, f, args) do
        :ok ->
          :ok

        {:error, error} when error in [:not_ready, :connection_not_available] ->
          Process.sleep(@spin_prevention_delay)

          Electric.StatusMonitor.wait_until_active(state.stack_id,
            timeout: :infinity,
            block_on_conn_sleeping: true
          )

          apply_with_retries(mfa, state, @retry_time)
      end
    catch
      _, _ when time_remaining > 0 ->
        receive do
          # on receiving an exit while holding processing, we should respect the exit
          {:EXIT, _from, reason} -> exit(reason)
        after
          @spin_prevention_delay ->
            time_remaining = time_remaining - (System.monotonic_time(:millisecond) - start_time)
            apply_with_retries(mfa, state, time_remaining)
        end
    end
  end

  @epoch DateTime.to_unix(~U[2000-01-01 00:00:00Z], :microsecond)
  defp current_time(), do: System.os_time(:microsecond) - @epoch

  defp update_stored_wals(
         %{
           received_wal: received_wal,
           flushed_wal: flushed_wal,
           flush_up_to_date?: flush_up_to_date?
         } = state,
         wal
       ) do
    received_wal = max(received_wal, wal)
    flushed_wal = if flush_up_to_date?, do: max(flushed_wal, wal), else: flushed_wal

    %{state | received_wal: received_wal, flushed_wal: flushed_wal}
  end

  defp update_received_wal(state, wal) when is_number(wal) and wal >= state.received_wal,
    do: %{state | received_wal: wal}

  defp update_received_wal(state, wal) when is_number(wal), do: state

  defp notify_connection_opened(%State{connection_manager: manager} = state) do
    :ok = Electric.Connection.Manager.replication_client_started(manager)
    state
  end

  defp notify_system_identified(%State{connection_manager: manager} = state, info) do
    :ok = Electric.Connection.Manager.pg_system_identified(manager, info)
    state
  end

  defp notify_pg_info_obtained(%State{connection_manager: manager} = state, pg_info) do
    :ok = Electric.Connection.Manager.pg_info_obtained(manager, pg_info)
    state
  end

  defp notify_lock_acquisition_error(%State{connection_manager: manager} = state, error) do
    :ok = Electric.Connection.Manager.replication_client_lock_acquisition_failed(manager, error)
    state
  end

  defp notify_lock_acquired(%State{connection_manager: manager} = state) do
    :ok = Electric.Connection.Manager.replication_client_lock_acquired(manager)
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
