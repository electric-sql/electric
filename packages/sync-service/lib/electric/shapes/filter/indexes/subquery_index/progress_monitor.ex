defmodule Electric.Shapes.Filter.Indexes.SubqueryIndex.ProgressMonitor do
  @moduledoc """
  Tracks, per subquery, the earliest logical time any registered consumer may
  still need to read. The minimum across live consumers is the compaction
  lower bound for `MultiTimeView`.

  One GenServer + one ETS table per stack. The GenServer serialises writes
  and owns the process monitors that release pinned times when consumers die.
  `min_required_time/2` reads the ETS row directly so the routing path does
  not have to call the GenServer.

  See `docs/rfcs/subquery-index.md`, section *Processed-Up-To Time*.
  """

  use GenServer, restart: :temporary

  import Electric, only: [is_stack_id: 1]

  @type subquery_id :: term()
  @type shape_handle :: term()
  @type time :: non_neg_integer()
  @type stack_id :: String.t()

  defp registered_name(stack_id) when is_stack_id(stack_id),
    do: :"subquery_progress_monitor:#{stack_id}"

  defp table_name(stack_id) when is_stack_id(stack_id),
    do: :"subquery_progress_monitor_table:#{stack_id}"

  @spec start_link(keyword()) :: GenServer.on_start()
  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    GenServer.start_link(__MODULE__, opts, name: registered_name(stack_id))
  end

  @doc "Look up the ETS table for a stack, or `nil` if none exists."
  @spec for_stack(stack_id()) :: atom() | nil
  def for_stack(stack_id) when is_stack_id(stack_id) do
    case :ets.whereis(table_name(stack_id)) do
      :undefined -> nil
      _tid -> table_name(stack_id)
    end
  end

  @doc """
  Register `pid` as a consumer of `subquery_id` for `shape_handle`. The
  consumer's initial required time is `time` — the materializer's current
  logical time when registration succeeds. The consumer process is
  monitored; if it dies the pinned time is released automatically.

  Re-registering an existing `{subquery_id, shape_handle}` replaces the
  previous registration.
  """
  @spec register_consumer(stack_id(), subquery_id(), shape_handle(), pid(), time()) :: :ok
  def register_consumer(stack_id, subquery_id, shape_handle, pid, time) do
    GenServer.call(
      registered_name(stack_id),
      {:register, subquery_id, shape_handle, pid, time}
    )
  end

  @doc """
  Remove the registration for `{subquery_id, shape_handle}`. Idempotent.
  """
  @spec unregister_consumer(stack_id(), subquery_id(), shape_handle()) :: :ok
  def unregister_consumer(stack_id, subquery_id, shape_handle) do
    GenServer.call(
      registered_name(stack_id),
      {:unregister, subquery_id, shape_handle}
    )
  end

  @doc """
  Advance the consumer's required time past `time`. After this call the
  consumer asserts it no longer needs to read `subquery_id` at any time
  `<= time`.
  """
  @spec notify_processed_up_to(stack_id(), time(), subquery_id(), shape_handle()) :: :ok
  def notify_processed_up_to(stack_id, time, subquery_id, shape_handle) do
    GenServer.call(
      registered_name(stack_id),
      {:notify, time, subquery_id, shape_handle}
    )
  end

  @doc """
  Earliest logical time any live consumer may still need to read for
  `subquery_id`. `nil` when no consumer is registered — callers may
  compact freely.
  """
  @spec min_required_time(stack_id() | atom(), subquery_id()) :: time() | nil
  def min_required_time(stack_id, subquery_id) when is_stack_id(stack_id),
    do: min_required_time(table_name(stack_id), subquery_id)

  def min_required_time(table, subquery_id) when is_atom(table) do
    case :ets.lookup(table, {:min_required_time, subquery_id}) do
      [{_, time}] -> time
      [] -> nil
    end
  end

  @spec registered?(stack_id() | atom(), subquery_id(), shape_handle()) :: boolean()
  def registered?(stack_id, subquery_id, shape_handle) when is_stack_id(stack_id),
    do: registered?(table_name(stack_id), subquery_id, shape_handle)

  def registered?(table, subquery_id, shape_handle) when is_atom(table) do
    :ets.member(table, {:consumer, subquery_id, shape_handle})
  end

  @impl true
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)

    table =
      :ets.new(table_name(stack_id), [
        :set,
        :public,
        :named_table,
        read_concurrency: true
      ])

    {:ok, %{stack_id: stack_id, table: table, monitors: %{}}}
  end

  @impl true
  def handle_call({:register, subquery_id, shape_handle, pid, time}, _from, state) do
    state = remove_registration(state, subquery_id, shape_handle)

    monitor_ref = Process.monitor(pid)

    :ets.insert(
      state.table,
      {{:consumer, subquery_id, shape_handle}, time, monitor_ref}
    )

    state = put_in(state.monitors[monitor_ref], {subquery_id, shape_handle})
    recompute_min(state.table, subquery_id)
    {:reply, :ok, state}
  end

  def handle_call({:unregister, subquery_id, shape_handle}, _from, state) do
    state = remove_registration(state, subquery_id, shape_handle)
    recompute_min(state.table, subquery_id)
    {:reply, :ok, state}
  end

  def handle_call({:notify, time, subquery_id, shape_handle}, _from, state) do
    case :ets.lookup(state.table, {:consumer, subquery_id, shape_handle}) do
      [{key, current, monitor_ref}] ->
        new_required = max(current, time + 1)

        if new_required != current do
          :ets.insert(state.table, {key, new_required, monitor_ref})
          recompute_min(state.table, subquery_id)
        end

        {:reply, :ok, state}

      [] ->
        {:reply, :ok, state}
    end
  end

  @impl true
  def handle_info({:DOWN, monitor_ref, :process, _pid, _reason}, state) do
    case Map.pop(state.monitors, monitor_ref) do
      {nil, _} ->
        {:noreply, state}

      {{subquery_id, shape_handle}, monitors} ->
        :ets.delete(state.table, {:consumer, subquery_id, shape_handle})
        recompute_min(state.table, subquery_id)
        {:noreply, %{state | monitors: monitors}}
    end
  end

  defp remove_registration(state, subquery_id, shape_handle) do
    case :ets.lookup(state.table, {:consumer, subquery_id, shape_handle}) do
      [{key, _time, monitor_ref}] ->
        Process.demonitor(monitor_ref, [:flush])
        :ets.delete(state.table, key)
        %{state | monitors: Map.delete(state.monitors, monitor_ref)}

      [] ->
        state
    end
  end

  defp recompute_min(table, subquery_id) do
    case :ets.match(table, {{:consumer, subquery_id, :_}, :"$1", :_}) do
      [] ->
        :ets.delete(table, {:min_required_time, subquery_id})

      times ->
        min = times |> Enum.map(fn [t] -> t end) |> Enum.min()
        :ets.insert(table, {{:min_required_time, subquery_id}, min})
    end
  end
end
