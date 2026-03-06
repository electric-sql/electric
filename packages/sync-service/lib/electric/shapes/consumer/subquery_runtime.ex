defmodule Electric.Shapes.Consumer.SubqueryRuntime do
  @moduledoc false

  alias Electric.Shapes.Consumer.MoveHandling
  alias Electric.Shapes.Consumer.MoveIns
  alias Electric.Shapes.Consumer.MovePhase
  alias Electric.Shapes.Consumer.MoveQueue

  @type t() :: %__MODULE__{
          queue: MoveQueue.t(),
          phase: MovePhase.t()
        }

  defstruct queue: MoveQueue.new(), phase: :idle

  @spec new() :: t()
  def new, do: %__MODULE__{}

  @spec queue_dependency_changes(map(), Electric.shape_handle(), %{optional(atom()) => list()}) ::
          map()
  def queue_dependency_changes(%{subquery_runtime: runtime} = state, dep_handle, changes) do
    move_out = Map.get(changes, :move_out, [])
    move_in = Map.get(changes, :move_in, [])

    runtime =
      runtime
      |> Map.update!(:queue, &MoveQueue.enqueue_move_outs(&1, dep_handle, move_out))
      |> Map.update!(:queue, &MoveQueue.enqueue_move_ins(&1, dep_handle, move_in))

    %{state | subquery_runtime: runtime}
  end

  @spec process_queue(map()) :: {map(), [term()]}
  def process_queue(state) do
    do_process_queue(state, [])
  end

  @spec on_move_in_snapshot_known(map(), String.t(), MoveIns.pg_snapshot()) :: map()
  def on_move_in_snapshot_known(state, name, snapshot) do
    move_handling_state = MoveIns.set_snapshot(state.move_handling_state, name, snapshot)
    move_handling_state = MoveIns.gc_touch_tracker(move_handling_state)
    %{state | move_handling_state: move_handling_state}
  end

  @spec on_move_in_complete(map(), String.t(), [String.t()], MoveIns.pg_snapshot()) ::
          {map(), [term()]}
  def on_move_in_complete(state, name, key_set, snapshot) do
    {state, notification} = MoveHandling.query_complete(state, name, key_set, snapshot)
    move_handling_state = MoveIns.gc_touch_tracker(state.move_handling_state)
    state = %{state | move_handling_state: move_handling_state}

    {state, queued_notifications} = process_queue(%{state | subquery_runtime: set_idle(state)})
    notifications = [notification | queued_notifications] |> Enum.reject(&is_nil/1)
    {state, notifications}
  end

  defp do_process_queue(state, notifications) do
    if waiting_move_in?(state) do
      {%{state | subquery_runtime: set_waiting(state)}, Enum.reverse(notifications)}
    else
      runtime = %{state.subquery_runtime | phase: :idle}

      case MoveQueue.pop_next(runtime.queue) do
        {:empty, _} ->
          {%{state | subquery_runtime: runtime}, Enum.reverse(notifications)}

        {{:move_out, dep_handle, value}, queue} ->
          runtime = %{runtime | queue: queue}

          {state, notification} =
            MoveHandling.process_move_outs(%{state | subquery_runtime: runtime}, dep_handle, [
              value
            ])

          do_process_queue(state, [notification | notifications])

        {{:move_in, dep_handle, value}, queue} ->
          runtime = %{runtime | queue: queue, phase: :waiting_move_in}
          state = %{state | subquery_runtime: runtime}
          state = MoveHandling.process_move_ins(state, dep_handle, [value])
          {state, Enum.reverse(notifications)}
      end
    end
  end

  defp waiting_move_in?(%{move_handling_state: %{waiting_move_ins: waiting_move_ins}}) do
    map_size(waiting_move_ins) > 0
  end

  defp set_idle(%{subquery_runtime: runtime}), do: %{runtime | phase: :idle}
  defp set_waiting(%{subquery_runtime: runtime}), do: %{runtime | phase: :waiting_move_in}
end
