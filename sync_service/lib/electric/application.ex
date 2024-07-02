defmodule Electric.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false
  alias Electric.Postgres.ReplicationClient
  require Logger

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      {Electric.InMemShapeCache, []},
      {Electric.Replication.ShapeLogStorage, []},
      {Registry,
       name: Registry.ShapeChanges, keys: :duplicate, partitions: System.schedulers_online()},
      {Postgrex,
       Application.fetch_env!(:electric, :database_config) ++
         [
           name: Electric.DbPool,
           pool_size: 10
         ]},
      {ReplicationClient,
       Application.fetch_env!(:electric, :database_config) ++
         [
           init_opts: [
             publication_name: "electric_publication",
             transaction_received: {Electric.Replication.ShapeLogStorage, :store_transaction, []}
           ]
         ]},
      {Bandit, plug: Electric.Plug.Router, port: 3000}
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Electric.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
