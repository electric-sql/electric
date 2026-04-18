defmodule Electric.Shapes.WhereClause do
  alias PgInterop.Sublink
  alias Electric.Replication.Eval.Runner
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex

  @spec includes_record_result(
          Electric.Replication.Eval.Expr.t() | nil,
          map(),
          ([String.t()], term() -> boolean())
        ) :: {:ok, boolean()} | :error
  def includes_record_result(where_clause, record, subquery_member? \\ fn _, _ -> false end)
  def includes_record_result(nil = _where_clause, _record, _), do: {:ok, true}

  def includes_record_result(where_clause, record, subquery_member?)
      when is_function(subquery_member?, 2) do
    with {:ok, refs} <- Runner.record_to_ref_values(where_clause.used_refs, record),
         {:ok, evaluated} <-
           Runner.execute(where_clause, refs, subquery_member?: subquery_member?) do
      {:ok, not is_nil(evaluated) and evaluated != false}
    else
      _ -> :error
    end
  end

  @spec includes_record?(Electric.Replication.Eval.Expr.t() | nil, map(), ([String.t()], term() ->
                                                                             boolean())) ::
          boolean()
  def includes_record?(where_clause, record, subquery_member? \\ fn _, _ -> false end)
  def includes_record?(nil = _where_clause, _record, _), do: true

  def includes_record?(where_clause, record, subquery_member?)
      when is_function(subquery_member?, 2) do
    case includes_record_result(where_clause, record, subquery_member?) do
      {:ok, included?} -> included?
      :error -> false
    end
  end

  @spec subquery_member_from_refs(map()) :: ([String.t()], term() -> boolean())
  def subquery_member_from_refs(extra_refs) when is_map(extra_refs) do
    fn subquery_ref, typed_value ->
      typed_value
      |> Sublink.member?(Map.get(extra_refs, subquery_ref, []))
    end
  end

  @doc """
  Build a subquery_member? callback that queries the SubqueryIndex.

  Used for filter-side exact verification: checks whether a specific
  shape currently contains a typed value for a canonical subquery ref.
  """
  @spec subquery_member_from_index(SubqueryIndex.t(), term()) ::
          ([String.t()], term() -> boolean())
  def subquery_member_from_index(index, shape_handle) do
    fn subquery_ref, typed_value ->
      SubqueryIndex.membership_or_fallback?(index, shape_handle, subquery_ref, typed_value)
    end
  end
end
