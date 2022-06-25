defmodule Electric.Application do
  @moduledoc false

  use Application

  def start(_type, _args) do
    children = [
      Electric.Postgres.SchemaRegistry,
      Electric.VaxRepo,
      {Electric.Replication, Application.get_env(:electric, Electric.Replication)},
      Electric.ReplicationServer.Postgres
    ]

    opts = [strategy: :one_for_one, name: Electric.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
