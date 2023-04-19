defmodule Electric.Postgres.MockSchemaLoader do
  @behaviour Electric.Postgres.Extension.SchemaLoader

  alias Electric.Postgres.Schema

  @impl true
  def connect(conn_config, opts) do
    opts = Map.new(opts)
    notify(opts, {:connect, conn_config})
    {:ok, {[], opts}}
  end

  @impl true
  def load({[], opts}) do
    notify(opts, :load)
    {:ok, Schema.new()}
  end

  def load({[{version, schema} | _versions], opts}) do
    notify(opts, {:load, version, schema})
    {:ok, schema}
  end

  @impl true
  def load({versions, opts}, version) do
    case List.keyfind(versions, version, 0, nil) do
      {^version, schema} ->
        notify(opts, {:load, version, schema})

        {:ok, schema}

      nil ->
        {:error, "schema version #{version} not found"}
    end
  end

  @impl true
  def save({versions, opts}, version, schema) do
    notify(opts, {:save, version, schema})
    {:ok, {[{version, schema} | versions], opts}}
  end

  defp notify(%{parent: parent}, msg) when is_pid(parent) do
    send(parent, {__MODULE__, msg})
  end
end
