defmodule Electric.Application do
  @moduledoc false

  use Application

  def start(_type, _args) do
    children = [
      Electric.Replication
    ]

    opts = [strategy: :one_for_one, name: Electric.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
