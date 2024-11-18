defmodule Api.Application do
  use Application

  @impl true
  def start(_type, _args) do
    children = [
      Api.Repo,
      ApiWeb.Endpoint
    ]

    opts = [strategy: :one_for_one, name: Api.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
