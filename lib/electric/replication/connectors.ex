defmodule Electric.Replication.Connectors do
  use Supervisor

  def start_link(connectors) do
    Supervisor.start_link(__MODULE__, connectors, name: __MODULE__)
  end

  @impl true
  def init(connectors) do
    connectors
    |> Enum.map(fn {name, opts} ->
      {Electric.Replication.PostgresConnector, Keyword.put(opts, :origin, to_string(name))}
      |> Supervisor.child_spec(id: name)
    end)
    |> Supervisor.init(strategy: :one_for_one)
  end
end
