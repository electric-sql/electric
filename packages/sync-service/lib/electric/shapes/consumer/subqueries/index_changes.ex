defmodule Electric.Shapes.Consumer.Subqueries.IndexChanges do
  @moduledoc """
  Determines subquery index effects for dependency move events.

  The subquery index tracks which values are present in the dependency view.
  When a move event occurs, the index must be updated — but the *timing* of
  that update depends on whether the move triggers buffering.

  ## Broadening and narrowing

  While a move-in is being buffered, transactions continue to arrive and must
  be filtered. To avoid missing relevant rows, the index is **broadened**
  (made more permissive) as soon as buffering starts. Once the move-in query
  completes and the splice is done, the index is **narrowed** back to its
  final state.

  For a positive (`IN`) subquery:
  - Adding values to the index broadens the filter (more rows match).
  - So a move-in adds to the index when **buffering starts**.

  For a negated (`NOT IN`) subquery:
  - Adding values to the index *narrows* the filter (fewer rows match).
  - So a dependency move-in does **not** update the index when buffering starts
    (keeping the filter broad); the add is deferred until **complete**.
  - A dependency move-out broadens the filter by removing the value from the
    index immediately, and that removal remains correct after the splice.

  ## Effect tables

  ### When buffering starts

  | Dep move   | Polarity | Index effect              |
  |------------|----------|---------------------------|
  | move_in    | positive | AddToSubqueryIndex        |
  | move_in    | negated  | *(none)*                  |
  | move_out   | positive | *(none)*                  |
  | move_out   | negated  | RemoveFromSubqueryIndex   |

  ### When complete (splice finished, or immediate for non-buffering cases)

  | Dep move   | Polarity | Index effect              |
  |------------|----------|---------------------------|
  | move_in    | positive | *(none)*                  |
  | move_in    | negated  | AddToSubqueryIndex        |
  | move_out   | positive | RemoveFromSubqueryIndex   |
  | move_out   | negated  | *(none)*                  |

  ## Caller conventions

  - **Non-buffering cases** (positive move-out, negated move-in): the move
    completes atomically, so callers use `effects_for_complete/3`.
  - **Buffering cases** (positive move-in, negated move-out): callers use
    `effects_for_buffering/3` when entering buffering and
    `effects_for_complete/3` at splice time.
  """

  alias Electric.Shapes.Consumer.Effects
  alias Electric.Shapes.DnfPlan

  @type move :: {:move_in | :move_out, non_neg_integer(), list()}

  @doc """
  Returns index effects to apply when a dependency move event starts buffering.

  Used only by buffering cases to broaden the filter before the move-in query
  runs. Calling this for an immediate (non-buffering) move is a bug in the
  caller.
  """
  @spec effects_for_buffering(DnfPlan.t(), move(), [String.t()]) ::
          [Effects.AddToSubqueryIndex.t() | Effects.RemoveFromSubqueryIndex.t()]
  def effects_for_buffering(dnf_plan, {dep_move_kind, dep_index, values}, subquery_ref) do
    polarity = Map.get(dnf_plan.dependency_polarities, dep_index, :positive)

    case {polarity, dep_move_kind} do
      {:positive, :move_in} ->
        [
          %Effects.AddToSubqueryIndex{
            dep_index: dep_index,
            subquery_ref: subquery_ref,
            values: values
          }
        ]

      {:negated, :move_out} ->
        [
          %Effects.RemoveFromSubqueryIndex{
            dep_index: dep_index,
            subquery_ref: subquery_ref,
            values: values
          }
        ]

      other ->
        raise ArgumentError,
              "effects_for_buffering/3 only supports buffering cases, got #{inspect(other)}"
    end
  end

  @doc """
  Returns index effects to apply when a move event completes.

  For buffering cases this is called at splice time. For non-buffering cases
  (where the move completes atomically) this is the only function called.
  """
  @spec effects_for_complete(DnfPlan.t(), move(), [String.t()]) ::
          [Effects.AddToSubqueryIndex.t() | Effects.RemoveFromSubqueryIndex.t()]
  def effects_for_complete(dnf_plan, {dep_move_kind, dep_index, values}, subquery_ref) do
    polarity = Map.get(dnf_plan.dependency_polarities, dep_index, :positive)

    case {polarity, dep_move_kind} do
      {:positive, :move_in} ->
        []

      {:negated, :move_in} ->
        [
          %Effects.AddToSubqueryIndex{
            dep_index: dep_index,
            subquery_ref: subquery_ref,
            values: values
          }
        ]

      {:positive, :move_out} ->
        [
          %Effects.RemoveFromSubqueryIndex{
            dep_index: dep_index,
            subquery_ref: subquery_ref,
            values: values
          }
        ]

      {:negated, :move_out} ->
        []
    end
  end
end
