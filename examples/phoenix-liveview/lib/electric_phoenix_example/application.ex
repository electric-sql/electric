defmodule Electric.PhoenixExample.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      Electric.PhoenixExampleWeb.Telemetry,
      Electric.PhoenixExample.Repo,
      {DNSCluster,
       query: Application.get_env(:electric_phoenix_example, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Electric.PhoenixExample.PubSub},
      # Start a worker by calling: Electric.PhoenixExample.Worker.start_link(arg)
      # {Electric.PhoenixExample.Worker, arg},
      # Start to serve requests, typically the last entry
      Electric.PhoenixExampleWeb.Endpoint
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Electric.PhoenixExample.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    Electric.PhoenixExampleWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
