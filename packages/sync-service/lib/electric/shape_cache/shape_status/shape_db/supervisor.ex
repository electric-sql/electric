defmodule Electric.ShapeCache.ShapeStatus.ShapeDb.Supervisor do
  use Supervisor

  alias Electric.ShapeCache.ShapeStatus.ShapeDb

  def name(stack_ref) do
    Electric.ProcessRegistry.name(stack_ref, __MODULE__)
  end

  def start_link(args) do
    Supervisor.start_link(__MODULE__, args, name: name(args))
  end

  def init(args) do
    stack_id = Keyword.fetch!(args, :stack_id)

    children = [
      {ShapeDb.Migrator, args},
      Supervisor.child_spec(
        {
          NimblePool,
          # nomutex is safe because we're enforcing use by a single "thread" via the pool
          #
          # see: https://sqlite.org/threadsafe.html
          #
          # > The SQLITE_OPEN_NOMUTEX flag causes the database connection to be in the multi-thread mode
          #
          # > Multi-thread. In this mode, SQLite can be safely used by multiple
          # > threads provided that no single database connection nor any object
          # > derived from database connection, such as a prepared statement, is
          # > used in two or more threads at the same time.
          worker: {ShapeDb.Connection, Keyword.put(args, :readonly, true)},
          pool_size: System.schedulers_online(),
          name: ShapeDb.Connection.pool_name(stack_id, :read)
        },
        id: {:pool, :read}
      ),
      # a separate single-worker pool for writes as they have to be serialised
      # to avoid busy errors
      Supervisor.child_spec(
        {NimblePool,
         worker: {ShapeDb.Connection, args},
         pool_size: 1,
         name: ShapeDb.Connection.pool_name(stack_id, :write)},
        id: {:pool, :write}
      )
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end
end
