defmodule Electric.Replication.PublicationManager do
  use Supervisor

  @callback name(binary() | Keyword.t()) :: term()
  @callback add_shape(shape_handle(), Electric.Shapes.Shape.t(), Keyword.t()) :: :ok
  @callback remove_shape(shape_handle(), Keyword.t()) :: :ok
  @callback wait_for_restore(Keyword.t()) :: :ok

  alias __MODULE__.RelationTracker
  @behaviour __MODULE__

  @type stack_id :: Electric.stack_id()
  @type shape_handle :: Electric.ShapeCache.shape_handle()

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts, name: name(opts[:stack_id]))
  end

  defdelegate add_shape(stack_id, shape_handle, shape), to: RelationTracker

  defdelegate remove_shape(stack_id, shape_handle), to: RelationTracker

  defdelegate wait_for_restore(stack_id), to: RelationTracker

  def init(opts) do
    Process.set_label({:publication_manager_sup, opts[:stack_id]})

    children = [
      {__MODULE__.RelationTracker, opts},
      {__MODULE__.Configurator, opts}
    ]

    Supervisor.init(children, strategy: :rest_for_one)
  end
end
