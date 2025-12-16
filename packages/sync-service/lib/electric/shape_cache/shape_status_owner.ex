defmodule Electric.ShapeCache.ShapeStatusOwner do
  @moduledoc """
  Owns the ETS table and the ShapeStatus state.

  This process creates the ETS table for shapes and initializes
  `Electric.ShapeCache.ShapeStatus` early in the supervision tree so that
  dependent processes (e.g., shape consumers) can use a single, shared
  ShapeStatus instance regardless of their own supervisor start order.
  """

  use GenServer

  alias Electric.ShapeCache.ShapeStatus

  require Logger

  @schema NimbleOptions.new!(stack_id: [type: :string, required: true])

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def initialize(stack_id) do
    GenServer.call(name(stack_id), :initialize)
  end

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      opts = Map.new(opts)
      GenServer.start_link(__MODULE__, opts, name: name(opts.stack_id))
    end
  end

  @impl true
  def init(config) do
    stack_id = config.stack_id

    Process.set_label({:shape_status_owner, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    :ok = Electric.LsnTracker.initialize(stack_id)

    {:ok, %{stack_id: stack_id, initialized: false}, :hibernate}
  end

  @impl true
  def handle_call(:initialize, _from, %{initialized: false} = state) do
    :ok = ShapeStatus.initialize(state.stack_id)
    {:reply, :ok, %{state | initialized: true}, :hibernate}
  end

  def handle_call(:initialize, _from, %{initialized: true} = state) do
    {:reply, :ok, state, :hibernate}
  end
end
