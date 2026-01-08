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

    Process.set_label({:shape_db_migrator, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    with {:ok, conn} <- ShapeDb.Connection.open(args),
         {:ok, _version} <- ShapeDb.Connection.migrate(conn),
         :ok = ShapeDb.Connection.optimize(conn) do
      {:ok, schedule_optimize(conn), :hibernate}
    end
  end

  @impl GenServer
  def handle_info(:optimize, conn) do
    Logger.info("Optimizing shape db tables")
    :ok = ShapeDb.Connection.optimize(conn)

    {:noreply, schedule_optimize(conn), :hibernate}
  end

  defp schedule_optimize(conn) do
    Process.send_after(self(), :optimize, @optimization_period)
    conn
  end
end
