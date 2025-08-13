defmodule Burn.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children =
      [
        # BurnWeb.Telemetry,
        Burn.Repo,
        {DNSCluster, query: Application.get_env(:burn, :dns_cluster_query) || :ignore},
        {Phoenix.PubSub, name: Burn.PubSub},
        {Finch, name: Burn.Finch},
        {Registry, keys: :unique, name: Burn.Agents}
      ] ++
        sync_spawning_children(Mix.env()) ++
        [
          {BurnWeb.Endpoint, phoenix_sync: Phoenix.Sync.plug_opts()}
        ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Burn.Supervisor]
    Supervisor.start_link(children, opts)
  end

  defp sync_spawning_children(:test), do: []
  defp sync_spawning_children(_), do: [Burn.Agents.Supervisor]

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    BurnWeb.Endpoint.config_change(changed, removed)

    :ok
  end
end
