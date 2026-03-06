defmodule Electric.Shapes.Consumer.SubqueryView do
  @moduledoc false

  alias Electric.Shapes.Consumer.Materializer
  alias Electric.Shapes.Shape

  @spec refs_for_txn(Shape.t(), Electric.stack_id(), %{term() => MapSet.t()}) ::
          {map(), map()}
  def refs_for_txn(shape, stack_id, in_flight_values) do
    full_refs = Materializer.get_all_as_refs(shape, stack_id)

    refs_before_move_ins =
      Enum.reduce(in_flight_values, full_refs, fn {key, values}, acc ->
        if is_map_key(acc, key),
          do: Map.update!(acc, key, &MapSet.difference(&1, values)),
          else: acc
      end)

    {refs_before_move_ins, full_refs}
  end
end
