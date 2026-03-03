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

  @default_connection_idle_timeout 30_000

  def init(opts) do
    shape_db_opts = Keyword.fetch!(opts, :shape_db_opts)
    stack_id = Keyword.fetch!(opts, :stack_id)
    opts = Keyword.put(shape_db_opts, :stack_id, stack_id)
    exclusive_mode = Keyword.get(opts, :exclusive_mode, false)
    idle_timeout = Keyword.get(opts, :connection_idle_timeout, @default_connection_idle_timeout)
    # don't close the write connection in exclusive mode
    # NimblePool treats `worker_idle_timeout: nil` as no idle timeout
    write_pool_idle_timeout = if(exclusive_mode, do: nil, else: idle_timeout)

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
              name: ShapeDb.PoolRegistry.pool_name(stack_id, :read, exclusive_mode),
              worker_idle_timeout: idle_timeout,
              lazy: true
            },
            id: {:pool, :read}
          )
        ]
      end

    children =
      Enum.concat([
        [
          {ShapeDb.PoolRegistry, stack_id: stack_id},
          {ShapeDb.Statistics, opts},
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
             name: ShapeDb.PoolRegistry.pool_name(stack_id, :write, exclusive_mode),
             worker_idle_timeout: write_pool_idle_timeout,
             lazy: not exclusive_mode},
            id: {:pool, :write}
          ),
          # Write buffer for batching SQLite writes to avoid timeout cascades.
          {ShapeDb.WriteBuffer, opts},
          {Task, fn -> ShapeDb.Statistics.initialize(stack_id) end}
        ]
      ])

    # Because the full state of the system is split between the actual db, the
    # writeBuffer and the ShapeStatus ets caches, we are not safe to adopt a
    # one_for_one strategy and need to propagate an exit in the children of
    # this supervisor to the parent
    Supervisor.init(children, strategy: :one_for_all, max_restarts: 0)
  end
end
