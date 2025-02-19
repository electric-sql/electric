defmodule Electric.PhoenixEmbedded.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    electric_config = Electric.Application.api_plug_opts()

    children = [
      Electric.PhoenixEmbeddedWeb.Telemetry,
      Electric.PhoenixEmbedded.Repo,
      {DNSCluster,
       query: Application.get_env(:electric_phoenix_embedded, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Electric.PhoenixEmbedded.PubSub},
      # Start a worker by calling: Electric.PhoenixEmbedded.Worker.start_link(arg)
      # {Electric.PhoenixEmbedded.Worker, arg},
      # Start to serve requests, typically the last entry
      {Electric.PhoenixEmbeddedWeb.Endpoint, electric: electric_config}
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Electric.PhoenixEmbedded.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    Electric.PhoenixEmbeddedWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
