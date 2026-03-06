defmodule Electric.Shapes.Consumer.MoveQueue do
  @moduledoc false

  @type value_change() :: term()
  @type queue_item() ::
          {:move_out, Electric.shape_handle(), value_change()}
          | {:move_in, Electric.shape_handle(), value_change()}

  @type t() :: %__MODULE__{
          move_out: :queue.queue(queue_item()),
          move_in: :queue.queue(queue_item())
        }

  defstruct move_out: :queue.new(), move_in: :queue.new()

  @spec new() :: t()
  def new, do: %__MODULE__{}

  @spec enqueue_move_ins(t(), Electric.shape_handle(), [value_change()]) :: t()
  def enqueue_move_ins(queue, _dep_handle, []), do: queue

  def enqueue_move_ins(%__MODULE__{} = queue, dep_handle, values) do
    Enum.reduce(values, queue, fn value, acc ->
      %{acc | move_in: :queue.in({:move_in, dep_handle, value}, acc.move_in)}
    end)
  end

  @spec enqueue_move_outs(t(), Electric.shape_handle(), [value_change()]) :: t()
  def enqueue_move_outs(queue, _dep_handle, []), do: queue

  def enqueue_move_outs(%__MODULE__{} = queue, dep_handle, values) do
    Enum.reduce(values, queue, fn value, acc ->
      %{acc | move_out: :queue.in({:move_out, dep_handle, value}, acc.move_out)}
    end)
  end

  @spec pop_next(t()) ::
          {:empty, t()} | {{:move_out | :move_in, Electric.shape_handle(), value_change()}, t()}
  def pop_next(%__MODULE__{} = queue) do
    case :queue.out(queue.move_out) do
      {{:value, op}, move_out} ->
        {op, %{queue | move_out: move_out}}

      {:empty, _} ->
        case :queue.out(queue.move_in) do
          {{:value, op}, move_in} -> {op, %{queue | move_in: move_in}}
          {:empty, _} -> {:empty, queue}
        end
    end
  end
end
