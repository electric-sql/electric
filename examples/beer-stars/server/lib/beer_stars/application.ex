defmodule BeerStars.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      # Start the Ecto repository
      BeerStars.Repo,
      # Start the Github query worker.
      {BeerStars.Worker, name: BeerStars.Worker},
      # Start the Endpoint (http/https)
      BeerStarsWeb.Endpoint
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: BeerStars.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    BeerStarsWeb.Endpoint.config_change(changed, removed)

    :ok
  end
end
