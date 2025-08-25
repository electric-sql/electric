defmodule Electric.ShapeCache.ShapeStatusOwner do
  @moduledoc """
  Owns the ETS table and the ShapeStatus state.

  This process creates the ETS table for shapes and initializes
  `Electric.ShapeCache.ShapeStatus` early in the supervision tree so that
  dependent processes (e.g., shape consumers) can use a single, shared
  ShapeStatus instance regardless of their own supervisor start order.
  """

  use GenServer, shutdown: 60_000

  alias Electric.ShapeCache.ShapeStatus

  @schema NimbleOptions.new!(
            stack_id: [type: :string, required: true],
            shape_status: [type: :mod_arg, required: true]
          )

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      stack_id = Keyword.fetch!(opts, :stack_id)
      GenServer.start_link(__MODULE__, opts, name: name(stack_id))
    end
  end

  @impl true
  def init(opts) do
    Process.flag(:trap_exit, true)
    stack_id = Keyword.fetch!(opts, :stack_id)
    {shape_status, shape_status_state} = Keyword.fetch!(opts, :shape_status)

    :ok = shape_status.initialise(shape_status_state)
    dbg("Initialised shape status")

    {:ok, %{shape_status: {shape_status, shape_status_state}}}
  end

  @impl true
  def handle_info({:EXIT, _, reason}, state) do
    {:stop, reason, state}
  end

  @impl true
  def terminate(reason, %{shape_status: {shape_status, shape_status_state}}) do
    dbg("storing shape status ets table")
    shape_status.terminate(shape_status_state)
    :ok
  end
end
