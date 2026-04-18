defmodule Electric.Shapes.Consumer.Subqueries.ShapeInfo do
  # Holds the immutable shape-level data shared by the steady and buffering states.

  alias Electric.Shapes.Consumer.Subqueries.RefResolver
  alias Electric.Shapes.DnfPlan
  alias Electric.Shapes.Shape

  @enforce_keys [
    :shape,
    :stack_id,
    :shape_handle,
    :dnf_plan,
    :ref_resolver,
    :buffer_max_transactions
  ]
  defstruct [
    :shape,
    :stack_id,
    :shape_handle,
    :dnf_plan,
    :ref_resolver,
    :buffer_max_transactions
  ]

  @type t() :: %__MODULE__{
          shape: Shape.t(),
          stack_id: String.t(),
          shape_handle: String.t(),
          dnf_plan: DnfPlan.t(),
          ref_resolver: RefResolver.t(),
          buffer_max_transactions: pos_integer()
        }
end
