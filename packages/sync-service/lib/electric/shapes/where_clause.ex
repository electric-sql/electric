defmodule Electric.Shapes.WhereClause do
  alias PgInterop.Sublink
  alias Electric.Replication.Eval.Runner
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex.MultiTimeView

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
  Build a subquery_member? callback that signals "unknown" by raising.

  The filter cannot answer subquery membership correctly: a consumer that is
  mid-move on a subquery is effectively reading at two logical times at once,
  which a single per-shape pin cannot represent. So whenever the filter is
  evaluating a residual `and_where` that contains a sublink, this callback
  raises. The runner catches the raise and throws `:could_not_compute`,
  which propagates as `:error` from `includes_record_result/3` — the caller
  treats that as "over-route, let the consumer do the exact check in
  `Shape.convert_change`".
  """
  @spec subquery_member_unknown() :: ([String.t()], term() -> boolean())
  def subquery_member_unknown do
    fn _subquery_ref, _typed_value ->
      raise "subquery membership cannot be evaluated at the filter; consumer must check"
    end
  end

  @doc """
  Build a subquery_member? callback that reads `MultiTimeView` at the
  per-ref logical time given by `subquery_refs`. The optional
  `time_override` lets a single ref read at a different time — used by
  splice-plan to read the trigger ref's `from_time`/`to_time` while
  every other ref stays at the consumer's currently-pinned time.

  Replaces the pre-RFC pattern of materialising a full MapSet per ref
  up front; membership is now checked lazily as the DNF evaluator walks
  each record's sublinks.
  """
  @spec subquery_member_from_mtv(
          MultiTimeView.t() | nil,
          map(),
          {term(), non_neg_integer()} | nil
        ) ::
          ([String.t()], term() -> boolean())
  def subquery_member_from_mtv(mtv, subquery_refs, time_override \\ nil)

  def subquery_member_from_mtv(nil, _subquery_refs, _time_override) do
    fn _, _ -> false end
  end

  def subquery_member_from_mtv(mtv, subquery_refs, time_override) do
    fn subquery_ref, typed_value ->
      case Map.get(subquery_refs, subquery_ref) do
        nil ->
          false

        %{subquery_id: id, time: pinned_time} ->
          time =
            case time_override do
              {^subquery_ref, override_time} -> override_time
              _ -> pinned_time
            end

          MultiTimeView.member?(mtv, id, typed_value, time)
      end
    end
  end
end
