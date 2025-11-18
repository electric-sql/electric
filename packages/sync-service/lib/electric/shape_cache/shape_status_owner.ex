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

  require Logger

  @schema NimbleOptions.new!(
            stack_id: [type: :string, required: true],
            storage: [type: :mod_arg, required: true]
          )

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      opts = Map.new(opts)
      GenServer.start_link(__MODULE__, opts, name: name(opts.stack_id))
    end
  end

  @impl true
  def init(config) do
    Process.flag(:trap_exit, true)

    stack_id = config.stack_id

    Process.set_label({:shape_status_owner, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    :ok = ShapeStatus.initialize_from_storage(stack_id, config.storage)
    :ok = Electric.LsnTracker.initialize(stack_id)

    {:ok, %{stack_id: stack_id, backup_dir: ShapeStatus.backup_dir(config.storage)}}
  end

  @impl true
  def handle_info({:EXIT, _, reason}, state) do
    {:stop, reason, state}
  end

  @impl true
  def terminate(_reason, %{stack_id: stack_id, backup_dir: backup_dir}) do
    Logger.info("Terminating shape status owner, backing up state for faster recovery.")
    ShapeStatus.terminate(stack_id, backup_dir)
    :ok
  end
end
