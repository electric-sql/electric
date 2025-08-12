defmodule Electric.Shapes.WhereClause do
  alias Electric.Replication.Eval.Runner

  def includes_record?(where_clause, record, extra_refs \\ %{})
  def includes_record?(nil = _where_clause, _record, _), do: true

  def includes_record?(where_clause, record, extra_refs) do
    with {:ok, refs} <- Runner.record_to_ref_values(where_clause.used_refs, record),
         {:ok, evaluated} <- Runner.execute(where_clause, Map.merge(refs, extra_refs)) do
      if is_nil(evaluated), do: false, else: evaluated
    else
      _ -> false
    end
  end
end
