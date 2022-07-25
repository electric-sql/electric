defmodule Electric.Application do
  @moduledoc false

  use Application

  def start(_type, _args) do
    children = [
      Electric.Postgres.SchemaRegistry,
      {Registry, keys: :unique, name: Electric.PostgresSlotRegistry},
      {Registry, keys: :duplicate, name: Electric.PostgresDispatcher},
      Electric.VaxRepo,
      Electric.PostgresServer,
      {Electric.Replication.Connectors,
       Application.get_env(:electric, Electric.Replication.Connectors)},
      {Electric.Replication.Vaxine.DownstreamPipeline,
       Application.get_env(:electric, Electric.Replication.Vaxine.DownstreamPipeline)}
    ]

    opts = [strategy: :one_for_one, name: Electric.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
