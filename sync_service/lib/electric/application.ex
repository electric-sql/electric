defmodule Electric.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false
  alias Electric.ShapeCache.InMemoryStorage
  alias Electric.Postgres.ReplicationClient
  require Logger

  use Application

  @impl true
  def start(_type, _args) do
    with {:ok, storage_opts} <- InMemoryStorage.shared_opts([]) do
      storage = {InMemoryStorage, storage_opts}

      children =
        if Application.fetch_env!(:electric, :environment) != :test do
          [
            Electric.Telemetry,
            {InMemoryStorage, storage_opts},
            {Registry,
             name: Registry.ShapeChanges, keys: :duplicate, partitions: System.schedulers_online()},
            {Electric.ShapeCache, storage: storage},
            {Electric.Replication.ShapeLogStorage,
             storage: storage, registry: Registry.ShapeChanges},
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
                   transaction_received:
                     {Electric.Replication.ShapeLogStorage, :store_transaction, []}
                 ]
               ]},
            {Bandit,
             plug:
               {Electric.Plug.Router,
                storage: storage,
                registry: Registry.ShapeChanges,
                shape_cache: {Electric.ShapeCache, []},
                long_poll_timeout: 20_000},
             port: 3000}
          ]
        else
          []
        end

      # See https://hexdocs.pm/elixir/Supervisor.html
      # for other strategies and supported options
      opts = [strategy: :one_for_one, name: Electric.Supervisor]
      Supervisor.start_link(children, opts)
    end
  end
end
