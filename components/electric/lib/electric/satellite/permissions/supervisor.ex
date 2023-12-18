defmodule Electric.Satellite.Permissions.Supervisor do
  use Supervisor

  alias Electric.Satellite.Permissions

  def start_link(init_arg) do
    Supervisor.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  def init(_) do
    children = [
      Permissions.Transient
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end
end
