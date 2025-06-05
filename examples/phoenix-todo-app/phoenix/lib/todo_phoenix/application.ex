defmodule TodoPhoenix.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      TodoPhoenixWeb.Telemetry,
      TodoPhoenix.Repo,
      {DNSCluster, query: Application.get_env(:todo_phoenix, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: TodoPhoenix.PubSub},
      # Start a worker by calling: TodoPhoenix.Worker.start_link(arg)
      # {TodoPhoenix.Worker, arg},
      # Start to serve requests, typically the last entry
      # Phoenix.Sync integration - starts embedded Electric
      {TodoPhoenixWeb.Endpoint, phoenix_sync: Phoenix.Sync.plug_opts()}
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: TodoPhoenix.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    TodoPhoenixWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
