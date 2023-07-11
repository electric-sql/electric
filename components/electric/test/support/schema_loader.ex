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
    {:ok, nil, Schema.new()}
  end

  def load({[{version, schema} | _versions], opts}) do
    notify(opts, {:load, version, schema})
    {:ok, version, schema}
  end

  @impl true
  def load({versions, opts}, version) do
    case List.keyfind(versions, version, 0, nil) do
      {^version, schema} ->
        notify(opts, {:load, version, schema})

        {:ok, version, schema}

      nil ->
        {:error, "schema version #{version} not found"}
    end
  end

  @impl true
  def save({versions, opts}, version, schema, stmts) do
    notify(opts, {:save, version, schema, stmts})

    migration = {
      String.to_integer(version),
      DateTime.utc_now(),
      version,
      schema,
      stmts
    }

    {:ok, {[migration | versions], opts}}
  end

  @impl true
  def relation_oid({_versions, opts}, type, schema, name) do
    notify(opts, {:relation_oid, type, schema, name})

    with %{} = oids <- get_in(opts, [:oids, type]),
         {:ok, oid} <- Map.fetch(oids, {schema, name}) do
      {:ok, oid}
    else
      _ -> {:error, "no oid defined for #{type}:#{schema}.#{name} in #{inspect(opts)}"}
    end
  end

  @impl true
  def primary_keys({_versions, opts}, schema, name) do
    notify(opts, {:primary_keys, schema, name})

    with {:ok, pks} <- Map.fetch(opts, :pks),
         {:ok, tpks} <- Map.fetch(pks, {schema, name}) do
      {:ok, tpks}
    else
      :error ->
        {:error, "no pks defined for #{schema}.#{name} in #{inspect(opts)}"}
    end
  end

  @impl true
  def refresh_subscription({_versions, opts}, name) do
    notify(opts, {:refresh_subscription, name})
    :ok
  end

  @impl true
  def migration_history({versions, opts}, version) do
    notify(opts, {:migration_history, version})

    migrations =
      case version do
        nil ->
          versions

        version when is_binary(version) ->
          for {v, schema, stmts} <- versions, v > version, do: {v, schema, stmts}
      end

    {:ok, migrations}
  end

  defp notify(%{parent: parent}, msg) when is_pid(parent) do
    send(parent, {__MODULE__, msg})
  end
end
