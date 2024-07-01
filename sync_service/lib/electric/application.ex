defmodule Electric.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      {Postgrex,
       Application.fetch_env!(:electric, :database_config) ++
         [
           name: Electric.DbPool,
           pool_size: 10
         ]},
      {Bandit, plug: Electric.Plug.Router, port: 3000}
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Electric.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
