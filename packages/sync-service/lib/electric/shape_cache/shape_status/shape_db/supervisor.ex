defmodule Electric.ShapeCache.ShapeStatus.ShapeDb.Supervisor do
  use Supervisor

  alias Electric.ShapeCache.ShapeStatus.ShapeDb

  require Logger

  def name(stack_ref) do
    Electric.ProcessRegistry.name(stack_ref, __MODULE__)
  end

  def start_link(opts) do
    Supervisor.start_link(__MODULE__, opts, name: name(opts))
  end

  def init(opts) do
    shape_db_opts = Keyword.fetch!(opts, :shape_db_opts)
    stack_id = Keyword.fetch!(opts, :stack_id)
    opts = Keyword.put(shape_db_opts, :stack_id, stack_id)
    exclusive_mode = Keyword.get(opts, :exclusive_mode, false)

    read_pool_spec =
      if exclusive_mode do
        Logger.notice("Starting ShapeDb in exclusive mode")
        []
      else
        [
          Supervisor.child_spec(
            {
              NimblePool,
              worker: {ShapeDb.Connection, Keyword.put(opts, :mode, :read)},
              pool_size: Keyword.get(opts, :read_pool_size, 2 * System.schedulers_online()),
              name: ShapeDb.PoolRegistry.pool_name(stack_id, :read, exclusive_mode)
            },
            id: {:pool, :read}
          )
        ]
      end

    children =
      Enum.concat([
        [
          {ShapeDb.PoolRegistry, stack_id: stack_id},
          {ShapeDb.Migrator, opts}
        ],
        read_pool_spec,
        [
          # a separate single-worker pool for writes as they have to be serialised
          # to avoid busy errors
          Supervisor.child_spec(
            {NimblePool,
             worker: {ShapeDb.Connection, Keyword.put(opts, :mode, :write)},
             pool_size: 1,
             name: ShapeDb.PoolRegistry.pool_name(stack_id, :write, exclusive_mode)},
            id: {:pool, :write}
          ),
          # write buffer for batching SQLite writes to avoid timeout cascades
          {ShapeDb.WriteBuffer, opts},
          {ShapeDb.Statistics, opts}
        ]
      ])

    Supervisor.init(children, strategy: :one_for_one)
  end
end
