defmodule Electric.Replication.ShapeLogCollector do
  @moduledoc """
  The ShapeLogCollector is responsible for collecting and processing
  shape log operations and managing shape registrations.

  It consists of two main components: the processor and the RequestBatcher.

  The processor handles the processing of shape log operations
  and manages the shape matching index updates. When any txn comes from postgres,
  we need to store it into the log for this shape if and only if it has
  txid >= xmin of the snapshot.

  The RequestBatcher batches the registration and deregistration of shapes
  to avoid overwhelming the processor with frequent updates.
  """
  use GenServer

  alias Electric.Postgres.ReplicationClient
  alias Electric.Replication.ShapeLogCollector.FlushTracker
  alias Electric.LsnTracker
  alias Electric.Replication.ShapeLogCollector.AffectedColumns
  alias Electric.Postgres.Lsn
  alias Electric.Replication.PersistentReplicationState
  alias Electric.Postgres.Inspector
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.TransactionFragment
  alias Electric.Replication.LogOffset

  alias Electric.Shapes.DependencyLayers
  alias Electric.Shapes.EventRouter
  alias Electric.Shapes.Partitions
  alias Electric.Telemetry.OpenTelemetry
  alias Electric.Shapes.ConsumerRegistry

  import Electric.Utils, only: [map_while_ok: 2, map_if_ok: 2]

  require Electric.Replication.LogOffset
  require Logger
  require TransactionFragment

  @schema NimbleOptions.new!(
            stack_id: [type: :string, required: true],
            inspector: [type: :mod_arg, required: true],
            persistent_kv: [type: :any, required: true],
            consumer_registry_opts: [type: :any]
          )

  @consumer_cleanup_reason Electric.ShapeCache.ShapeCleaner.consumer_cleanup_reason()

  # How often to scan the FlushTracker for entries that have made no flush progress
  # past the grace period (see the :flush_stall_grace_period stack config value).
  @stall_check_interval 10_000
  @stall_check_interval_floor 1_000

  defguardp is_ready_to_process(state)
            when is_map_key(state, :last_processed_offset) and
                   not is_nil(state.last_processed_offset)

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(Map.new(opts), @schema) do
      stack_id = opts[:stack_id]

      GenServer.start_link(__MODULE__, opts,
        name: name(stack_id),
        spawn_opt: Electric.StackConfig.spawn_opts(stack_id, :shape_log_collector)
      )
    end
  end

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  @doc """
  Marks the collector as ready to process operations from
  the replication stream.

  This is typically called after the initial shape registrations
  have been processed.
  """
  @spec mark_as_ready(Electric.stack_id()) :: :ok
  def mark_as_ready(stack_id) do
    # use an infinite timeout because the call can come in while the filters are building
    # the time taken to build the filters depends on the number of shapes so there is no
    # known upper bound for this after which we can say "this is taking too long"
    GenServer.call(name(stack_id), :mark_as_ready, :infinity)
  end

  @doc """
  Handles a replication log events.

  Should be called with operations received from the replication stream.

  Uuse `GenServer.call/2` here to make the event processing synchronous.

  This `call/3` has a timeout of `:infinity` because timeouts are
  handled at the storage layer, that is this function doesn't
  assume any aggregate max time for the shape consumers to actually commit
  the new txn to disk, instead the storage backend is responsible for
  determining how long a write should reasonably take and if that fails
  it should raise.
  """
  def handle_event(event, stack_id) do
    trace_context = OpenTelemetry.get_current_context()
    GenServer.call(name(stack_id), {:handle_event, event, trace_context}, :infinity)
  end

  @doc """
  Non-blocking variant of `handle_event/2`.

  Sends a `$gen_call` to the collector and returns a monitor reference.
  The caller receives `{monitor_ref, response}` when the event is processed,
  or `{:DOWN, monitor_ref, :process, pid, reason}` if the collector crashes.

  Uses the same `$gen_call` protocol as `GenServer.call` internally — the
  existing `handle_call` handles the request unchanged.
  """
  def handle_event_async(event, stack_id) do
    trace_context = OpenTelemetry.get_current_context()
    server = name(stack_id)

    case GenServer.whereis(server) do
      nil ->
        exit({:noproc, {__MODULE__, :handle_event_async, [event, stack_id]}})

      pid ->
        monitor_ref = Process.monitor(pid)
        send(pid, {:"$gen_call", {self(), monitor_ref}, {:handle_event, event, trace_context}})
        monitor_ref
    end
  end

  @doc """
  Adds a shape to the shape matching index in the ShapeLogCollector
  used for matching and sending replication stream operations.
  """
  defdelegate add_shape(stack_id, shape_handle, shape, operation), to: __MODULE__.RequestBatcher

  @doc """
  Removes a shape from the shape matching index in the ShapeLogCollector.
  This call succeeds before the shape is actually removed from the index.
  """
  defdelegate remove_shape(stack_id, shape_handle), to: __MODULE__.RequestBatcher

  @doc """
  Handles batched shape registration updates from the RequestBatcher.
  """
  def handle_shape_registration_updates(stack_id, shapes_to_add, shapes_to_remove) do
    pid = name(stack_id) |> GenServer.whereis()
    call_ref = make_ref()

    GenServer.cast(
      pid,
      {:handle_shape_registration_updates, call_ref, shapes_to_add, shapes_to_remove}
    )

    call_ref
  end

  @doc """
  Notifies the ShapeLogCollector that a shape's data has been flushed
  up to a certain offset, used to mark the overall flush progress.

  Should be called by consumer processes after they flush data.
  """
  @spec notify_flushed(Electric.stack_id(), Electric.shape_handle(), LogOffset.t()) :: :ok
  def notify_flushed(stack_id, shape_handle, offset) do
    GenServer.cast(name(stack_id), {:writer_flushed, shape_handle, offset})
  end

  @doc """
  Notifies the ShapeLogCollector that a shape's writer is alive and
  deliberately deferring its flush notifications (e.g. buffering transactions
  ahead of PG snapshot info or during a subquery move-in awaiting splice).

  Sent by a writer in answer to a `:verify_flush_progress` challenge from the
  stall check. Grants the shape's flush entry a fresh stall grace period so a
  healthy deferral is not mistaken for a wedged writer.
  """
  @spec notify_flush_deferred(Electric.stack_id(), Electric.shape_handle()) :: :ok
  def notify_flush_deferred(stack_id, shape_handle) do
    GenServer.cast(name(stack_id), {:writer_flush_deferred, shape_handle})
  end

  @doc """
  Returns the list of currently active shapes being tracked
  in the shape matching filters.
  """
  @spec active_shapes(Electric.stack_id()) :: MapSet.t(Electric.shape_handle())
  def active_shapes(stack_id) do
    GenServer.call(name(stack_id), :active_shapes)
  end

  @doc """
  Set process flags on the given ShapeLogCollector process.

  Accepts a list of flags to set, see `Process.flag/2` for valid settings.

  Doesn't crash if given an invalid flag or value - instead returns the list of
  invalid flags.

      iex> ShapeLogCollector.set_process_flags("my-stack-id", min_heap_size: 1024 * 1024, min_bin_vheap_size: 1024 * 1024)
      {:ok, settings: [min_heap_size: 1024 * 1024, min_bin_vheap_size: 1024 * 1024], invalid: []}
  """
  def set_process_flags(stack_id, flags) do
    GenServer.call(name(stack_id), {:set_process_flags, flags}, :infinity)
  end

  def get_process_flags(stack_id) do
    if pid = name(stack_id) |> GenServer.whereis() do
      {:garbage_collection, gc_flags} = :erlang.process_info(pid, :garbage_collection)
      {:priority, priority} = :erlang.process_info(pid, :priority)

      {:ok,
       [priority: priority] ++
         Keyword.take(gc_flags, [:min_bin_vheap_size, :min_heap_size, :fullsweep_after])}
    else
      :error
    end
  end

  @doc """
  Utility for tests, monitors the SLC process.
  """
  def monitor(stack_id) do
    stack_id
    |> name()
    |> GenServer.whereis()
    |> Process.monitor()
  end

  def init(opts) do
    activate_mocked_functions_from_test_process()

    stack_id = opts.stack_id

    Process.set_label({:shape_log_collector, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    persistent_replication_data_opts = [
      stack_id: stack_id,
      persistent_kv: opts.persistent_kv
    ]

    {:ok, tracker_state} =
      persistent_replication_data_opts
      |> PersistentReplicationState.get_tracked_relations()
      |> AffectedColumns.init()

    {:ok, registry_state} =
      ConsumerRegistry.new(stack_id, Map.get(opts, :consumer_registry_opts, []))

    replication_client_name = ReplicationClient.name(stack_id)

    state =
      Map.merge(opts, %{
        subscriptions: 0,
        persistent_replication_data_opts: persistent_replication_data_opts,
        tracked_relations: tracker_state,
        partitions: Partitions.new(Keyword.new(opts)),
        dependency_layers: DependencyLayers.new(),
        # A pending FlushTracker entry always has a live monitor watching the
        # writer pid responsible for completing it, kept in two mirrored maps.
        writer_monitors: %{},
        writer_monitor_refs: %{},
        # Shapes whose writer was challenged by the last stall check and has not
        # shown flush progress since (see :check_stalled_flushes).
        stall_suspects: MapSet.new(),
        event_router:
          opts
          |> Keyword.new()
          |> EventRouter.new(),
        flush_tracker:
          FlushTracker.new(
            notify_fn: fn lsn ->
              case GenServer.whereis(replication_client_name) do
                nil -> :ok
                pid -> send(pid, {:flush_boundary_updated, lsn})
              end
            end
          ),
        registry_state: registry_state
      })

    schedule_stall_check(stall_grace_period(stack_id))

    {:ok, state, {:continue, :restore_shapes}}
  end

  def handle_continue(:restore_shapes, state) do
    OpenTelemetry.with_span(
      "shape_log_collector.restore_shapes",
      [],
      state.stack_id,
      fn ->
        start = System.monotonic_time()

        {partitions, event_router, layers, count} =
          state.stack_id
          |> Electric.ShapeCache.ShapeStatus.list_shapes()
          |> Enum.reduce(
            {state.partitions, state.event_router, state.dependency_layers, 0},
            fn {shape_handle, shape}, {partitions, event_router, layers, count} ->
              # Check dependencies first - if a parent shape failed to restore,
              # we should skip this shape (and its children will also be skipped)
              case DependencyLayers.add_dependency(layers, shape, shape_handle) do
                {:ok, layers} ->
                  partitions = restore_partitions_for_shape(partitions, shape_handle, shape)

                  {
                    partitions,
                    EventRouter.add_shape(event_router, shape_handle, shape),
                    layers,
                    count + 1
                  }

                {:error, {:missing_dependencies, missing_deps}} ->
                  Logger.warning(
                    "Skipping shape during restore: missing dependencies #{inspect(MapSet.to_list(missing_deps))}",
                    shape_handle: shape_handle
                  )

                  {partitions, event_router, layers, count}
              end
            end
          )

        Logger.notice(
          "Restored filters for #{count} shapes in #{System.convert_time_unit(System.monotonic_time() - start, :native, :millisecond)}ms"
        )

        {:noreply,
         %{
           state
           | partitions: partitions,
             event_router: event_router,
             dependency_layers: layers,
             subscriptions: count
         }}
      end
    )
  end

  # Restoring a shape requires introspecting its root table, which can fail
  # while the database connection pool is still coming up (or the database is
  # otherwise unhealthy) — exactly the situation we're likely to be in when
  # restarting after a crash. Skipping the shape is not an option: nothing
  # re-registers restored shapes later, so a skipped shape would silently stop
  # receiving updates.
  #
  # We deliberately retry in place rather than letting the error propagate and
  # be "handled upstream", because there is no upstream handler that recovers
  # gracefully here:
  #
  #   * Restore runs in `handle_continue`, not through the event path, so the
  #     replication client's pause/redeliver recovery for
  #     `:connection_not_available` does not apply.
  #   * `ShapeLogCollector.Supervisor` is `max_restarts: 0`, so a crash is not
  #     retried locally — it propagates straight to the `:one_for_all`
  #     `Shapes.Supervisor`, restarting the *entire* shape subsystem.
  #   * The failure is a transient pool-warmup race that recurs on every
  #     restart, so repeated crashes blow the supervisor restart intensity and
  #     escalate — the cascade the shape subsystem is explicitly designed to be
  #     resilient against (see `Electric.CoreSupervisor`).
  #
  # Blocking in `handle_continue` is intentional: it keeps restore atomic with
  # respect to `mark_as_ready`/`handle_event`, so the collector never starts
  # serving before its partition state is rebuilt. The trade-off is that this
  # also delays the process's response to a shutdown signal, so the total wait
  # is bounded below the supervisor's default 5s shutdown timeout. If the error
  # still persists after that, we give up and crash with a descriptive error so
  # the wider connection-recovery machinery can take over.
  @restore_retry_delay_ms 100
  @restore_max_retries 40

  defp restore_partitions_for_shape(partitions, shape_handle, shape, attempt \\ 1) do
    case Partitions.add_shape(partitions, shape_handle, shape) do
      {:ok, partitions} ->
        partitions

      {:error, reason} when attempt >= @restore_max_retries ->
        raise "Failed to restore partition info for shape #{shape_handle}: #{inspect(reason)}"

      {:error, reason} ->
        if attempt == 1 do
          Logger.warning(
            "Retrying shape restore: failed to introspect #{Electric.Utils.inspect_relation(shape.root_table)}: #{inspect(reason)}",
            shape_handle: shape_handle
          )
        end

        Process.sleep(@restore_retry_delay_ms)
        restore_partitions_for_shape(partitions, shape_handle, shape, attempt + 1)
    end
  end

  def handle_call(:mark_as_ready, _from, state) do
    offset =
      case LsnTracker.get_last_processed_lsn(state.stack_id) do
        %Lsn{} = lsn ->
          LogOffset.new(Lsn.to_integer(lsn), :infinity)

        nil ->
          raise "LsnTracker must be populated before marking shape_log_collector as ready"
      end

    Electric.StatusMonitor.mark_shape_log_collector_ready(state.stack_id, self())
    {:reply, :ok, Map.put(state, :last_processed_offset, offset)}
  end

  def handle_call({:handle_event, _, _}, _from, state)
      when not is_ready_to_process(state) do
    {:reply, {:error, :not_ready}, state}
  end

  def handle_call({:handle_event, event, trace_context}, _from, state) do
    OpenTelemetry.set_current_context(trace_context)

    {response, state} = do_handle_event(event, state)

    {:reply, response, state}
  end

  def handle_call(:active_shapes, _from, state) do
    {:reply, EventRouter.active_shapes(state.event_router), state}
  end

  def handle_call({:set_process_flags, flags}, _from, state) do
    {settings, invalid} =
      Enum.flat_map_reduce(flags, [], fn {flag, value}, invalid ->
        try do
          {[{flag, Process.flag(flag, value)}], invalid}
        rescue
          ArgumentError ->
            {[], [flag | invalid]}
        end
      end)

    {:reply, {:ok, [settings: settings, invalid: invalid]}, state}
  end

  def handle_cast({:writer_flushed, shape_id, offset}, state) do
    now = System.monotonic_time(:millisecond)

    state =
      Map.update!(
        state,
        :flush_tracker,
        &FlushTracker.handle_flush_notification(&1, shape_id, offset, now)
      )

    # A flush that completes the entry removes it from the tracker; its writer no
    # longer needs watching.
    state =
      if FlushTracker.tracked?(state.flush_tracker, shape_id),
        do: state,
        else: demonitor_writer(state, shape_id)

    {:noreply, clear_stall_suspect(state, shape_id)}
  end

  def handle_cast({:writer_flush_deferred, shape_handle}, state) do
    now = System.monotonic_time(:millisecond)

    state = Map.update!(state, :flush_tracker, &FlushTracker.touch(&1, shape_handle, now))

    {:noreply, clear_stall_suspect(state, shape_handle)}
  end

  def handle_cast(
        {:handle_shape_registration_updates, call_ref, shapes_to_add, shapes_to_remove},
        state
      ) do
    OpenTelemetry.with_span(
      "shape_log_collector.handle_shape_registration_updates",
      [
        shapes_to_add_count: Enum.count(shapes_to_add),
        shapes_to_remove_count: Enum.count(shapes_to_remove)
      ],
      state.stack_id,
      fn ->
        {state, results} =
          shapes_to_remove
          |> Enum.reduce({state, %{}}, fn shape_handle, {state, results} ->
            case remove_subscription(state, shape_handle) do
              {:ok, state} -> {state, Map.put(results, shape_handle, :ok)}
              {:error, reason} -> {state, Map.put(results, shape_handle, {:error, reason})}
            end
          end)

        {state, results} =
          shapes_to_add
          |> Enum.reduce({state, results}, fn {shape_handle, shape}, {state, results} ->
            case Partitions.add_shape(state.partitions, shape_handle, shape) do
              {:ok, partitions} ->
                case DependencyLayers.add_dependency(
                       state.dependency_layers,
                       shape,
                       shape_handle
                     ) do
                  {:ok, dependency_layers} ->
                    state =
                      %{
                        state
                        | partitions: partitions,
                          event_router:
                            EventRouter.add_shape(state.event_router, shape_handle, shape),
                          dependency_layers: dependency_layers
                      }
                      |> Map.update!(:subscriptions, &(&1 + 1))
                      |> log_subscription_status()

                    {state, Map.put(results, shape_handle, :ok)}

                  {:error, {:missing_dependencies, missing_deps}} ->
                    Logger.warning(
                      "Shape cannot be added: missing dependencies #{inspect(MapSet.to_list(missing_deps))}",
                      shape_handle: shape_handle
                    )

                    {state, Map.put(results, shape_handle, {:error, :missing_dependencies})}
                end

              {:error, reason} ->
                {state, Map.put(results, shape_handle, {:error, reason})}
            end
          end)

        __MODULE__.RequestBatcher.handle_processor_update_response(
          state.stack_id,
          call_ref,
          results
        )

        {:noreply, state}
      end
    )
  end

  def handle_info({:DOWN, ref, :process, _pid, reason}, state)
      when is_map_key(state.writer_monitor_refs, ref) do
    shape_handle = Map.fetch!(state.writer_monitor_refs, ref)

    state =
      state
      |> forget_writer_monitor(shape_handle, ref)
      |> handle_writer_down(shape_handle, reason)

    {:noreply, state}
  end

  def handle_info(:check_stalled_flushes, state) do
    now = System.monotonic_time(:millisecond)

    grace_period = stall_grace_period(state.stack_id)
    schedule_stall_check(grace_period)

    stalled = FlushTracker.stalled_shapes(state.flush_tracker, now, grace_period)

    # Challenge-response: a stalled entry whose writer is still alive gets one
    # chance to prove it is deliberately deferring its flushes. First time a
    # shape shows up stalled, its monitored writer pid is sent a challenge; a
    # healthy deferring consumer answers with a notify_flush_deferred cast,
    # which touches the entry and clears the suspicion. Invalidated are only
    # the suspects still stalled with no progress since the previous check's
    # challenge, and shapes with no monitored writer left to challenge (their
    # writer is already dead — e.g. a :killed DOWN left the entry pinned).
    {challengeable, orphaned} =
      Enum.split_with(stalled, &is_map_key(state.writer_monitors, &1))

    {repeat_suspects, fresh_suspects} =
      Enum.split_with(challengeable, &MapSet.member?(state.stall_suspects, &1))

    Enum.each(fresh_suspects, fn shape_handle ->
      {pid, _ref} = Map.fetch!(state.writer_monitors, shape_handle)
      send(pid, :verify_flush_progress)
    end)

    state = %{state | stall_suspects: MapSet.new(fresh_suspects)}

    case orphaned ++ repeat_suspects do
      [] ->
        {:noreply, state}

      stalled ->
        Logger.warning(
          "Writers for shapes #{inspect(stalled)} have made no flush progress in over " <>
            "#{grace_period}ms, removing the shapes to unpin the flush boundary"
        )

        OpenTelemetry.execute(
          [:electric, :flush_tracker, :stall_detected],
          %{count: length(stalled)},
          %{stack_id: state.stack_id}
        )

        Electric.ShapeCache.ShapeCleaner.remove_shapes_async(state.stack_id, stalled)

        # Touching re-arms the grace period: the unpinning happens via the removal
        # chain, and if that chain is lost the stall simply re-fires one grace
        # period later (shape removal is idempotent).
        flush_tracker =
          Enum.reduce(stalled, state.flush_tracker, &FlushTracker.touch(&2, &1, now))

        {:noreply, %{state | flush_tracker: flush_tracker}}
    end
  end

  # Preserve the default GenServer behaviour for unexpected messages.
  def handle_info(msg, state) do
    Logger.warning("#{inspect(__MODULE__)} received unexpected message: #{inspect(msg)}")
    {:noreply, state}
  end

  # ShapeCleaner is driving this removal: shape invalidation is already in flight,
  # so just unpin the flush entry.
  defp handle_writer_down(state, shape_handle, @consumer_cleanup_reason) do
    emit_writer_down_telemetry(state, :cleanup)
    Map.update!(state, :flush_tracker, &FlushTracker.handle_shape_removed(&1, shape_handle))
  end

  # Assume supervisor teardown (deploy/stack shutdown): leave the entry pinned on
  # purpose so a mass shutdown never mass-invalidates shapes. :noproc belongs here
  # because it masks the real exit reason of a writer that died before we could
  # monitor it — a deploy-time :shutdown as easily as a crash. If the assumption
  # is wrong, the stall check self-heals one grace period later.
  defp handle_writer_down(state, _shape_handle, reason)
       when reason in [:shutdown, :killed, :noproc] do
    emit_writer_down_telemetry(state, :shutdown)
    state
  end

  # Anything else is a crash ({:shutdown, :suspend} included: a suspending consumer
  # must have no pending flush entries, so a monitored suspend is a contract
  # violation). Unpin immediately and make sure the shape is invalidated — it must
  # not resume from storage that is behind the acked WAL.
  defp handle_writer_down(state, shape_handle, reason) do
    Logger.warning(
      "Writer for shape #{shape_handle} exited with #{inspect(reason)} before completing " <>
        "its flush, removing the shape"
    )

    emit_writer_down_telemetry(state, :crash)
    Electric.ShapeCache.ShapeCleaner.remove_shapes_async(state.stack_id, [shape_handle])
    Map.update!(state, :flush_tracker, &FlushTracker.handle_shape_removed(&1, shape_handle))
  end

  # An undeliverable reason from the registry is either a publish-level failure —
  # the shape is gone from ShapeStatus or was removed after failing to resume, so
  # removal is already in flight, same as a cleanup DOWN — or the exit reason the
  # broadcast's own monitor observed for the writer.
  defp undeliverable_down_reason({:publish, _}), do: @consumer_cleanup_reason
  defp undeliverable_down_reason(reason), do: reason

  defp emit_writer_down_telemetry(state, reason_class) do
    OpenTelemetry.execute(
      [:electric, :flush_tracker, :writer_down],
      %{count: 1},
      %{stack_id: state.stack_id, reason_class: reason_class}
    )
  end

  defp monitor_writer(state, shape_handle, pid) do
    case Map.fetch(state.writer_monitors, shape_handle) do
      {:ok, {^pid, _ref}} ->
        state

      {:ok, {_old_pid, _old_ref}} ->
        # A different pid now owns this shape's entry (resumed consumer): swap the
        # monitor over to it.
        state |> demonitor_writer(shape_handle) |> monitor_writer(shape_handle, pid)

      :error ->
        # Monitoring an already-dead pid yields an immediate :noproc DOWN, so a
        # writer that dies before this call is never lost: the DOWN is classified
        # as teardown and the stall check picks the entry up if that was wrong.
        ref = Process.monitor(pid)

        %{
          state
          | writer_monitors: Map.put(state.writer_monitors, shape_handle, {pid, ref}),
            writer_monitor_refs: Map.put(state.writer_monitor_refs, ref, shape_handle)
        }
    end
  end

  defp demonitor_writer(state, shape_handle) do
    case Map.fetch(state.writer_monitors, shape_handle) do
      {:ok, {_pid, ref}} ->
        Process.demonitor(ref, [:flush])
        forget_writer_monitor(state, shape_handle, ref)

      :error ->
        state
    end
  end

  defp forget_writer_monitor(state, shape_handle, ref) do
    %{
      state
      | writer_monitors: Map.delete(state.writer_monitors, shape_handle),
        writer_monitor_refs: Map.delete(state.writer_monitor_refs, ref)
    }
  end

  # Any flush progress answers an outstanding stall challenge: if the shape's
  # entry stalls again later, its writer must be challenged afresh rather than
  # invalidated as an unresponsive suspect. (The check interval is clamped to at
  # least 1s, so with a sub-second grace period a suspect could otherwise stall
  # again before the next check despite having answered in between.)
  defp clear_stall_suspect(state, shape_handle) do
    %{state | stall_suspects: MapSet.delete(state.stall_suspects, shape_handle)}
  end

  defp stall_grace_period(stack_id) do
    Electric.StackConfig.lookup(
      stack_id,
      :flush_stall_grace_period,
      Electric.Config.default(:flush_stall_grace_period)
    )
  end

  # Check at the configured grace period when it is shorter than the default
  # interval, so a small grace period is enforced at matching granularity
  # (clamped below so a tiny value cannot turn the check into a busy loop).
  defp schedule_stall_check(grace_period) do
    grace_period
    |> min(@stall_check_interval)
    |> max(@stall_check_interval_floor)
    |> then(&Process.send_after(self(), :check_stalled_flushes, &1))
  end

  defp do_handle_event(%Relation{} = rel, state) do
    OpenTelemetry.with_span(
      "pg_txn.replication_client.relation_received",
      ["rel.id": rel.id, "rel.schema": rel.schema, "rel.table": rel.table],
      state.stack_id,
      fn ->
        Logger.info("Received relation #{inspect(rel.schema)}.#{inspect(rel.table)}")
        Logger.debug(fn -> "Relation received in ShapeLogCollector: #{inspect(rel)}" end)

        result = handle_relation(state, rel)
        OpenTelemetry.wipe_interval_timer()
        result
      end
    )
  end

  defp do_handle_event(%TransactionFragment{} = txn_fragment, state) do
    OpenTelemetry.with_span(
      "pg_txn.replication_client.transaction_received",
      [
        num_changes: txn_fragment.change_count,
        num_relations: MapSet.size(txn_fragment.affected_relations),
        xid: txn_fragment.xid,
        complete_transaction?: TransactionFragment.complete_transaction?(txn_fragment)
      ],
      state.stack_id,
      fn ->
        OpenTelemetry.start_interval(:"shape_log_collector.logging.duration_µs")

        Logger.debug(
          fn ->
            "Received transaction fragment #{txn_fragment.xid} (#{txn_fragment.change_count} changes) from Postgres at #{txn_fragment.lsn}"
          end,
          received_transaction_xid: txn_fragment.xid,
          received_transaction_num_changes: txn_fragment.change_count,
          received_transaction_lsn: to_string(txn_fragment.lsn)
        )

        Logger.debug(fn ->
          "Txn fragment received in ShapeLogCollector: #{inspect(txn_fragment)}"
        end)

        result = handle_txn_fragment(state, txn_fragment)

        OpenTelemetry.stop_and_save_intervals(
          total_attribute: :"shape_log_collector.transaction.total_duration_µs"
        )

        put_wall_clock_duration_if_commit(txn_fragment)

        result
      end
    )
  end

  defp put_wall_clock_duration_if_commit(%TransactionFragment{
         commit: %Changes.Commit{tx_started_at: tx_started_at}
       }) do
    OpenTelemetry.add_span_attributes(
      total_processing_time:
        System.convert_time_unit(System.monotonic_time() - tx_started_at, :native, :millisecond)
    )
  end

  defp put_wall_clock_duration_if_commit(_txn_fragment), do: :ok

  # If we've already processed a txn_fragment, then drop it without processing
  defp handle_txn_fragment(%{last_processed_offset: last_processed_offset} = state, txn_fragment)
       when LogOffset.is_log_offset_lte(txn_fragment.last_log_offset, last_processed_offset) do
    Logger.debug(fn ->
      "Dropping transaction fragment as last_log_offset #{txn_fragment.last_log_offset} not greater than last processed #{last_processed_offset}"
    end)

    OpenTelemetry.add_span_attributes("txn.is_dropped": true)

    flush_tracker =
      if txn_fragment.commit do
        FlushTracker.handle_txn_fragment(
          state.flush_tracker,
          txn_fragment,
          [],
          System.monotonic_time(:millisecond)
        )
      else
        state.flush_tracker
      end

    {:ok, %{state | flush_tracker: flush_tracker}}
  end

  defp handle_txn_fragment(
         %{last_processed_offset: last_processed_offset},
         %TransactionFragment{
           changes: [%{log_offset: first_log_offset} | _],
           last_log_offset: last_log_offset
         }
       )
       when LogOffset.is_log_offset_lte(first_log_offset, last_processed_offset) and
              LogOffset.is_log_offset_lt(last_processed_offset, last_log_offset) do
    raise """
    Received TransactionFragment that has already been partially processed.

    This scenario is not currently supported. It could occur if the
    batch size was changed while restarting the replication client.

    First log offset: #{inspect(first_log_offset)}
    last processed offset: #{inspect(last_processed_offset)}
    last log offset: #{inspect(last_log_offset)}
    """
  end

  defp handle_txn_fragment(state, txn_fragment) do
    OpenTelemetry.add_span_attributes("txn.is_dropped": false)

    OpenTelemetry.start_interval(:"shape_log_collector.fill_keys_in_txn.duration_µs")

    case fill_keys(txn_fragment, state) do
      {:ok, txn_fragment} ->
        OpenTelemetry.start_interval(:"partitions.handle_transaction.duration_µs")

        {partitions, txn_fragment} =
          Partitions.handle_txn_fragment(state.partitions, txn_fragment)

        state =
          state
          |> Map.put(:partitions, partitions)
          |> put_last_processed_offset(txn_fragment)
          |> publish(txn_fragment)

        {:ok, state}

      {:error, reason} ->
        Logger.warning(
          "Failed to introspect relations affected by transaction #{txn_fragment.xid}: #{inspect(reason)}. Replication is paused until introspection succeeds"
        )

        {normalize_inspector_error(reason), state}
    end
  end

  defp publish(state, event) do
    OpenTelemetry.start_interval(:"shape_log_collector.event_routing.duration_µs")

    {events_by_handle, event_router} =
      EventRouter.event_by_shape_handle(state.event_router, event)

    state = %{state | event_router: event_router}

    affected_shapes = Map.keys(events_by_handle) |> MapSet.new()
    affected_shape_count = MapSet.size(affected_shapes)

    OpenTelemetry.add_span_attributes(
      "shape_log_collector.affected_shape_count": affected_shape_count
    )

    OpenTelemetry.execute(
      [:electric, :shape_log_collector, :transaction],
      %{affected_shape_count: affected_shape_count},
      %{stack_id: state.stack_id}
    )

    OpenTelemetry.start_interval(:"shape_log_collector.publish.duration_µs")
    context = OpenTelemetry.get_current_context()

    {undeliverable, delivered_pids} =
      for layer <- DependencyLayers.get_for_handles(state.dependency_layers, affected_shapes),
          reduce: {%{}, %{}} do
        {undeliverable_acc, delivered_acc} ->
          # Each publish is synchronous, so layers will be processed in order
          layer_events =
            Map.new(layer, fn handle ->
              {handle, {:handle_event, Map.fetch!(events_by_handle, handle), context}}
            end)

          {layer_undeliverable, layer_delivered} =
            ConsumerRegistry.publish(layer_events, state.registry_state)

          {Map.merge(undeliverable_acc, layer_undeliverable),
           Map.merge(delivered_acc, layer_delivered)}
      end

    OpenTelemetry.start_interval(:"shape_log_collector.set_last_processed_lsn.duration_µs")

    lsn = Lsn.from_integer(state.last_processed_offset.tx_offset)
    LsnTracker.set_last_processed_lsn(state.stack_id, lsn)

    delivered_shapes =
      MapSet.difference(affected_shapes, undeliverable |> Map.keys() |> MapSet.new())

    # An undeliverable shape may still hold a pending flush entry from an
    # earlier commit. Run the failure through the same classification as a
    # writer DOWN instead of blindly unpinning: a crash still invalidates the
    # shape, and an ambiguous reason leaves the entry pinned for the stall
    # check rather than disarming that backstop.
    state =
      Enum.reduce(undeliverable, state, fn {shape_handle, reason}, state ->
        state = demonitor_writer(state, shape_handle)

        if FlushTracker.tracked?(state.flush_tracker, shape_handle) do
          handle_writer_down(state, shape_handle, undeliverable_down_reason(reason))
        else
          state
        end
      end)

    case event do
      %TransactionFragment{commit: commit} when not is_nil(commit) ->
        LsnTracker.broadcast_last_seen_lsn(state.stack_id, lsn)

        flush_tracker =
          FlushTracker.handle_txn_fragment(
            state.flush_tracker,
            event,
            delivered_shapes,
            System.monotonic_time(:millisecond)
          )

        # Every delivered shape still tracked after this commit gets a monitor on
        # the pid that actually received it — not just newly tracked shapes. The
        # suspend-retry path in ConsumerRegistry.publish/2 can deliver a commit
        # for an already-tracked shape to a fresh consumer pid while the previous
        # pid's completing flush cast is still in our mailbox; monitor_writer
        # swaps the monitor over and flushes the old pid's queued DOWN, so the
        # suspended predecessor's exit is never misread as a crash.
        Enum.reduce(delivered_shapes, %{state | flush_tracker: flush_tracker}, fn shape_handle,
                                                                                  state ->
          if FlushTracker.tracked?(state.flush_tracker, shape_handle) do
            monitor_writer(state, shape_handle, Map.fetch!(delivered_pids, shape_handle))
          else
            state
          end
        end)

      _ ->
        state
    end
  end

  defp handle_relation(state, rel) do
    {relation_status, updated_rel, tracker_state} =
      AffectedColumns.transform_relation(rel, state.tracked_relations)

    # PG doesn't send all the details in the relation message (in particular, nullability), but
    # it will send a message even if the relation is unchanged. So if we see a relation message that's not
    # changed, it might be after a reconnection, or it might be because something actually changed.
    # In either case, we need to clean the inspector cache so we get the latest info.
    if rel == updated_rel do
      Inspector.clean(updated_rel.id, state.inspector)
    end

    case Partitions.handle_relation(state.partitions, updated_rel) do
      {:ok, partitions} ->
        state = %{state | partitions: partitions}

        with {:ok, state} <- publish_relation(state, updated_rel, relation_status) do
          :ok =
            PersistentReplicationState.set_tracked_relations(
              tracker_state,
              state.persistent_replication_data_opts
            )

          {:ok, %{state | tracked_relations: tracker_state}}
        end

      {:error, reason} ->
        Logger.warning(
          "Failed to introspect relation #{Electric.Utils.inspect_relation({updated_rel.schema, updated_rel.table})}: #{inspect(reason)}. Replication is paused until introspection succeeds"
        )

        {normalize_inspector_error(reason), state}
    end
  end

  defp normalize_inspector_error(:connection_not_available),
    do: {:error, :connection_not_available}

  # Introspection failed for a reason other than the connection pool being
  # down, e.g. the database returned an error to the catalog query. Reply with
  # the one error the replication client knows how to recover from: it pauses
  # the stream and redelivers the event, giving the introspection another
  # chance instead of crashing the collector.
  defp normalize_inspector_error(_reason), do: {:error, :connection_not_available}

  defp publish_relation(state, rel, :unchanged) do
    OpenTelemetry.add_span_attributes("rel.is_dropped": true)

    Logger.debug(fn ->
      "Dropping unchanged relation message for #{inspect(rel.schema)}.#{inspect(rel.table)}"
    end)

    {:ok, state}
  end

  defp publish_relation(state, rel, _relation_status) do
    case state do
      %{subscriptions: 0} ->
        OpenTelemetry.add_span_attributes("rel.is_dropped": true)

        Logger.debug(fn ->
          "Dropping relation message for #{inspect(rel.schema)}.#{inspect(rel.table)}: no active consumers"
        end)

        {:ok, state}

      _ ->
        OpenTelemetry.add_span_attributes("rel.is_dropped": false)

        # relation changes will also start consumers if they're not running
        {:ok, publish(state, rel)}
    end
  end

  defp remove_subscription(%{subscriptions: count} = state, shape_handle) do
    OpenTelemetry.with_span(
      "shape_log_collector.remove_shape",
      [shape_handle: shape_handle],
      state.stack_id,
      fn ->
        if EventRouter.has_shape?(state.event_router, shape_handle) do
          Logger.debug("Deleting shape #{shape_handle}")

          OpenTelemetry.start_interval(:"unsubscribe_shape.remove_subscription.duration_µs")

          OpenTelemetry.start_interval(:"unsubscribe_shape.remove_from_event_router.duration_µs")
          event_router = EventRouter.remove_shape(state.event_router, shape_handle)

          OpenTelemetry.start_interval(:"unsubscribe_shape.remove_from_partitions.duration_µs")
          partitions = Partitions.remove_shape(state.partitions, shape_handle)

          OpenTelemetry.start_interval(:"unsubscribe_shape.demonitor_writer.duration_µs")
          state = demonitor_writer(state, shape_handle)

          OpenTelemetry.start_interval(:"unsubscribe_shape.remove_from_flush_tracker.duration_µs")
          flush_tracker = FlushTracker.handle_shape_removed(state.flush_tracker, shape_handle)

          OpenTelemetry.start_interval(
            :"unsubscribe_shape.remove_from_dependency_layers.duration_µs"
          )

          dependency_layers =
            DependencyLayers.remove_dependency(state.dependency_layers, shape_handle)

          Electric.Shapes.ConsumerRegistry.remove_consumer(shape_handle, state.registry_state)

          OpenTelemetry.stop_and_save_intervals(
            total_attribute: "unsubscribe_shape.total_duration_µs"
          )

          {:ok,
           %{
             state
             | subscriptions: count - 1,
               event_router: event_router,
               partitions: partitions,
               dependency_layers: dependency_layers,
               flush_tracker: flush_tracker
           }
           |> log_subscription_status()}
        else
          # This may happen as we attempt to remove a shape multiple times
          # depending on the source of the delete, on the understanding that
          # removal is idempotent.
          {:error, "shape #{shape_handle} not registered"}
        end
      end
    )
  end

  defp log_subscription_status(%{subscriptions: active} = state) do
    Logger.debug(fn ->
      "#{active} consumers of replication stream"
    end)

    state
  end

  defp put_last_processed_offset(state, %TransactionFragment{last_log_offset: last_log_offset}),
    do: %{state | last_processed_offset: last_log_offset}

  if Mix.env() == :test do
    def activate_mocked_functions_from_test_process do
      Support.TestUtils.activate_mocked_functions_for_module(__MODULE__)
    end
  else
    def activate_mocked_functions_from_test_process, do: :noop
  end

  defp fill_keys(batch, state) do
    with {:ok, pk_cols_of_relations} <- pk_cols_of_relations(batch, state) do
      batch =
        Map.update!(batch, :changes, fn changes ->
          Enum.map(
            changes,
            &Changes.fill_key(&1, pk_cols_of_relations[Map.get(&1, :relation)])
          )
        end)

      {:ok, batch}
    end
  end

  defp pk_cols_of_relations(batch, state) do
    batch.affected_relations
    |> map_while_ok(fn relation ->
      with {:ok, pk_cols} <- pk_cols_of_relation(relation, state) do
        {:ok, {relation, pk_cols}}
      end
    end)
    |> map_if_ok(&Map.new/1)
  end

  defp pk_cols_of_relation(relation, state) do
    with {:ok, {oid, _}} <- Inspector.load_relation_oid(relation, state.inspector),
         {:ok, info} <- Inspector.load_column_info(oid, state.inspector) do
      {:ok, Inspector.get_pk_cols(info)}
    else
      :table_not_found ->
        # The table was dropped (or renamed) after these changes were written
        # to the WAL, so its primary key can no longer be introspected. Key
        # the changes on the full record — the same fallback used for tables
        # without a primary key — and leave handling of the dropped table to
        # the affected shapes further down the stack.
        {:ok, []}

      {:error, reason} ->
        {:error, reason}
    end
  end
end
