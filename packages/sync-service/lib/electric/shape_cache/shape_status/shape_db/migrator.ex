defmodule Electric.ShapeCache.ShapeStatus.ShapeDb.Migrator do
  use GenServer

  alias Electric.ShapeCache.ShapeStatus.ShapeDb

  require Logger

  @optimization_period :timer.minutes(60)

  def start_link(args) do
    GenServer.start_link(__MODULE__, args)
  end

  @impl GenServer
  def init(args) do
    {:ok, stack_id} = Keyword.fetch(args, :stack_id)
    exclusive_mode = Keyword.get(args, :exclusive_mode, false)

    Process.set_label({:shape_db_migrator, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    with {:ok, conn} <- apply_migration(stack_id, args, exclusive_mode) do
      {:ok, schedule_optimize(stack_id, conn), :hibernate}
    end
  end

  defp apply_migration(_stack_id, _opts, true = _exclusive?) do
    # In exclusive  mode we *must* apply the migrations within the pool
    # connection initialization because we might be using a memory db.
    # We return nil to trigger checkout-mode.
    {:ok, nil}
  end

  defp apply_migration(_stack_id, opts, false = _exclusive?) do
    with {:ok, conn} <- ShapeDb.Connection.open(opts, integrity_check: true),
         {:ok, _version} <- ShapeDb.Connection.migrate(conn, opts),
         :ok = ShapeDb.Connection.optimize(conn) do
      {:ok, conn}
    end
  end

  @impl GenServer
  def handle_info(:optimize, {stack_id, nil}) do
    ShapeDb.Connection.checkout_write!(stack_id, :optimize, fn %{conn: conn} ->
      :ok = ShapeDb.Connection.optimize(conn)
    end)

    {:noreply, schedule_optimize(stack_id, nil), :hibernate}
  end

  def handle_info(:optimize, {stack_id, conn}) do
    Logger.notice("Optimizing shape db tables")
    :ok = ShapeDb.Connection.optimize(conn)

    {:noreply, schedule_optimize(stack_id, conn), :hibernate}
  end

  defp schedule_optimize(stack_id, conn) do
    Process.send_after(self(), :optimize, @optimization_period)
    {stack_id, conn}
  end
end
