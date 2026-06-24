defmodule Electric.ShapeCache.ShapeStatusOwner do
  @moduledoc """
  Owns the ETS table and the ShapeStatus state.

  This process creates the ETS table for shapes and initializes
  `Electric.ShapeCache.ShapeStatus` early in the supervision tree so that
  dependent processes (e.g., shape consumers) can use a single, shared
  ShapeStatus instance regardless of their own supervisor start order.

  Initialization is done asynchronously via `handle_continue` to avoid
  blocking the supervision tree startup on potentially slow SQLite reads.
  """

  use GenServer

  alias Electric.ShapeCache.ShapeStatus

  require Logger

  @schema NimbleOptions.new!(stack_id: [type: :string, required: true])

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  @doc """
  Refresh shape metadata from SQLite after lock acquisition.

  Uses an infinite timeout because on laggy storage with an incorrectly
  shut-down database this can take a long time.
  """
  def refresh(stack_id) do
    GenServer.call(name(stack_id), :refresh, :infinity)
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

    {:ok, %{stack_id: stack_id}, {:continue, :initialize}}
  end

  @impl true
  def handle_continue(:initialize, state) do
    # Initialize shape metadata from SQLite so we can serve shapes in
    # read-only mode before the advisory lock is acquired
    :ok = ShapeStatus.initialize(state.stack_id)

    # Signal that shape metadata is loaded and shapes can be served read-only
    Electric.StatusMonitor.mark_shape_metadata_ready(state.stack_id, self())

    Logger.notice("Shape metadata initialized, entering read-only mode")

    {:noreply, state, :hibernate}
  end

  @impl true
  def handle_call(:refresh, _from, state) do
    :ok = ShapeStatus.refresh(state.stack_id)
    {:reply, :ok, state, :hibernate}
  end
end
