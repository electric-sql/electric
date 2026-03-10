defmodule Electric.Shapes.Consumer.Subqueries.MoveQueue do
  @moduledoc false

  alias Electric.Shapes.Consumer.Subqueries

  defstruct move_out: [], move_in: []

  @type t() :: %__MODULE__{
          move_out: [Subqueries.move_value()],
          move_in: [Subqueries.move_value()]
        }

  @type batch_kind() :: :move_out | :move_in
  @type batch() :: {batch_kind(), [Subqueries.move_value()]}

  @spec new() :: t()
  def new, do: %__MODULE__{}

  @spec length(t()) :: non_neg_integer()
  def length(%__MODULE__{move_out: move_out, move_in: move_in}) do
    Kernel.length(move_out) + Kernel.length(move_in)
  end

  @spec enqueue(t(), map() | keyword(), MapSet.t()) :: t()
  def enqueue(%__MODULE__{} = queue, payload, %MapSet{} = base_view)
      when is_map(payload) or is_list(payload) do
    payload = Map.new(payload)

    queue
    |> to_ops()
    |> Kernel.++(payload_to_ops(payload))
    |> reduce(base_view)
  end

  @spec pop_next(t()) :: {batch(), t()} | nil
  def pop_next(%__MODULE__{move_out: [_ | _] = move_out} = queue) do
    {{:move_out, move_out}, %{queue | move_out: []}}
  end

  def pop_next(%__MODULE__{move_out: [], move_in: [_ | _] = move_in} = queue) do
    {{:move_in, move_in}, %{queue | move_in: []}}
  end

  def pop_next(%__MODULE__{}), do: nil

  defp to_ops(%__MODULE__{move_out: move_out, move_in: move_in}) do
    Enum.map(move_out, &{:move_out, &1}) ++ Enum.map(move_in, &{:move_in, &1})
  end

  defp payload_to_ops(payload) do
    Enum.map(Map.get(payload, :move_out, []), &{:move_out, &1}) ++
      Enum.map(Map.get(payload, :move_in, []), &{:move_in, &1})
  end

  defp reduce(ops, base_view) do
    terminal_ops =
      ops
      |> Enum.with_index()
      |> Enum.reduce(%{}, fn {{kind, move_value}, index}, acc ->
        Map.put(acc, elem(move_value, 0), %{kind: kind, move_value: move_value, index: index})
      end)
      |> Map.values()
      |> Enum.reject(&redundant?(&1, base_view))
      |> Enum.sort_by(& &1.index)

    %__MODULE__{
      move_out: for(%{kind: :move_out, move_value: move_value} <- terminal_ops, do: move_value),
      move_in: for(%{kind: :move_in, move_value: move_value} <- terminal_ops, do: move_value)
    }
  end

  defp redundant?(%{kind: :move_in, move_value: {value, _}}, base_view) do
    MapSet.member?(base_view, value)
  end

  defp redundant?(%{kind: :move_out, move_value: {value, _}}, base_view) do
    not MapSet.member?(base_view, value)
  end
end
