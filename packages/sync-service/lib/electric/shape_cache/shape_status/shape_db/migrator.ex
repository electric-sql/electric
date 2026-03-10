defmodule Electric.ShapeCache.ShapeStatus.ShapeDb.Migrator do
  use GenServer

  alias Electric.ShapeCache.ShapeStatus.ShapeDb

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

    Logger.notice("Shape database file: #{inspect(ShapeDb.Connection.db_path!(args))}")

    with :ok <- apply_migration(stack_id, args, exclusive_mode) do
      {:ok, schedule_optimize(stack_id), :hibernate}
    end
  end

  defp apply_migration(_stack_id, _opts, true = _exclusive?) do
    # In exclusive  mode we *must* apply the migrations within the pool
    # connection initialization because we might be using a memory db.
    :ok
  end

  defp apply_migration(_stack_id, opts, false = _exclusive?) do
    with {:ok, conn} <- ShapeDb.Connection.open(opts, integrity_check: true),
         {:ok, _version} <- ShapeDb.Connection.migrate(conn, opts),
         # https://sqlite.org/pragma.html#pragma_optimize
         # Applications with long-lived database connections should run "PRAGMA
         # optimize=0x10002" when the database connection first opens
         :ok = ShapeDb.Connection.optimize(conn, "0x10002"),
         :ok = ShapeDb.Connection.close(conn) do
      :ok
    end
  end

  @impl GenServer
  def handle_info(:optimize, stack_id) do
    ShapeDb.Connection.checkout_write!(stack_id, :optimize, fn %{conn: conn} ->
      :ok = ShapeDb.Connection.optimize(conn)
    end)

    {:noreply, schedule_optimize(stack_id), :hibernate}
  end

  defp schedule_optimize(stack_id) do
    Process.send_after(self(), :optimize, @optimization_period)
    stack_id
  end
end
