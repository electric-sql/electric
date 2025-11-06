defmodule Electric.Replication.PublicationManager do
  @moduledoc """
  Manages a PostgreSQL publication for a given Electric stack, tracking shapes
  and ensuring that the publication configuration matches the required set of
  relations that need to be published for the shapes to function correctly.

  Includes periodic checks of the publication to ensure that it remains valid,
  and expires any shapes that are no longer valid due to schema changes or
  permission issues.
  """

  @type stack_id :: Electric.stack_id()
  @type shape_handle :: Electric.ShapeCache.shape_handle()

  @callback add_shape(stack_id(), shape_handle(), Electric.Shapes.Shape.t()) :: :ok
  @callback remove_shape(stack_id(), shape_handle()) :: :ok
  @callback wait_for_restore(stack_id(), Keyword.t()) :: :ok

  @behaviour __MODULE__

  defdelegate start_link(opts), to: __MODULE__.Supervisor

  defdelegate child_spec(opts), to: __MODULE__.Supervisor

  defdelegate name(opts), to: __MODULE__.RelationTracker

  @impl __MODULE__
  defdelegate add_shape(stack_id, shape_handle, shape), to: __MODULE__.RelationTracker

  @impl __MODULE__
  defdelegate remove_shape(stack_id, shape_handle), to: __MODULE__.RelationTracker

  @impl __MODULE__
  defdelegate wait_for_restore(stack_id, opts \\ []), to: __MODULE__.RelationTracker
end
