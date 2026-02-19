defmodule Electric.Client.Application do
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      {Registry, name: Electric.Client.Registry, keys: :unique},
      {Finch, name: Electric.Client.Finch},
      {DynamicSupervisor, name: Electric.Client.RequestSupervisor, strategy: :one_for_one},
      Electric.Client.ExpiredShapesCache
    ]

    Supervisor.start_link(children, strategy: :one_for_one, name: __MODULE__)
  end
end
