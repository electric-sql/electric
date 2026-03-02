defmodule Electric.ShapeCache.ShapeStatus.ShapeDb.InMemory.Supervisor do
  @moduledoc """
  Supervisor for the in-memory ShapeDb implementation.

  Starts a single `Electric.ShapeCache.ShapeStatus.ShapeDb.InMemory` GenServer
  that owns the ETS table for the given stack. Because all data is ephemeral
  there are no connection pools, migrators, or statistics processes needed.

  ## Usage

      {Electric.ShapeCache.ShapeStatus.ShapeDb.InMemory.Supervisor,
       stack_id: stack_id}

  """

  use Supervisor

  alias Electric.ShapeCache.ShapeStatus.ShapeDb.InMemory

  def name(stack_ref) do
    Electric.ProcessRegistry.name(stack_ref, __MODULE__)
  end

  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts, name: name(opts))
  end

  @impl Supervisor
  def init(opts) do
    # Accept either a plain stack_id or a keyword list (matching the interface
    # of `ShapeDb.Supervisor` so callers can swap them easily).
    stack_id = Keyword.fetch!(opts, :stack_id)

    children = [
      {InMemory, stack_id: stack_id}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end
end
