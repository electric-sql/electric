defmodule Electric.Postgres.MockSchemaLoader do
  alias Electric.Postgres.{
    Extension.SchemaLoader,
    Schema
  }

  def oid_loader(type, schema, name) do
    {:ok, Enum.join(["#{type}", schema, name], ".") |> :erlang.phash2(50_000)}
  end

  def schema_update(schema \\ Schema.new(), cmds) do
    Schema.update(schema, cmds, oid_loader: &oid_loader/3)
  end

  @spec migrate_versions([{version :: binary(), [stmt :: binary()]}]) :: [
          {version :: binary(), Schema.t()}
        ]
  def migrate_versions(migrations) do
    {versions, _schema} =
      Enum.map_reduce(migrations, Schema.new(), fn {version, stmts}, schema ->
        schema = Enum.reduce(stmts, schema, &schema_update(&2, &1))
        {{version, schema}, schema}
      end)

    versions
  end

  def backend_spec(opts) do
    versions = migrate_versions(Keyword.get(opts, :migrations, []))
    oid_loader = Keyword.get(opts, :oids, &oid_loader/3) |> make_oid_loader()
    parent = Keyword.get(opts, :parent, self())
    pks = Keyword.get(opts, :pks, nil)

    {__MODULE__, [parent: parent, versions: versions, oid_loader: oid_loader, pks: pks]}
  end

  defp make_oid_loader(fun) when is_function(fun, 3) do
    fun
  end

  defp make_oid_loader(oids) when is_map(oids) do
    fn type, schema, name ->
      with %{} = oids <- oids[type],
           {:ok, oid} <- Map.fetch(oids, {schema, name}) do
        {:ok, oid}
      else
        _ -> {:error, "no oid defined for #{type}:#{schema}.#{name} in #{inspect(oids)}"}
      end
    end
  end

  @behaviour SchemaLoader

  @impl true
  def connect(conn_config, opts) do
    {versions, opts} =
      opts
      |> Map.new()
      |> Map.pop(:versions, [])

    notify(opts, {:connect, conn_config})
    {:ok, {versions, opts}}
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
    case List.keyfind(versions, version, 2, nil) do
      {_txid, _txts, ^version, schema, _stmts} ->
        notify(opts, {:load, version, schema})

        {:ok, version, schema}

      nil ->
        {:error, "schema version not found: #{version}"}
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
  def relation_oid({_versions, %{oid_loader: oid_loader}}, type, schema, name)
      when is_function(oid_loader, 3) do
    oid_loader.(type, schema, name)
  end

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
  def primary_keys({_versions, %{pks: pks} = opts}, schema, name) when is_map(pks) do
    notify(opts, {:primary_keys, schema, name})

    with {:ok, tpks} <- Map.fetch(pks, {schema, name}) do
      {:ok, tpks}
    else
      :error ->
        {:error, "no pks defined for #{schema}.#{name} in #{inspect(opts)}"}
    end
  end

  def primary_keys({[{_version, schema} | _versions], opts}, sname, tname) do
    notify(opts, {:primary_keys, sname, tname})

    Schema.primary_keys(schema, sname, tname)
  end

  def primary_keys({[], _opts}, sname, tname) do
    {:error, "unknown table #{sname}.#{tname} and no primary keys configured"}
  end

  @impl true
  def primary_keys({_versions, _opts} = state, {schema, name}) do
    primary_keys(state, schema, name)
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
          for {txid, txts, v, schema, stmts} <- versions,
              v > version,
              do: {txid, txts, v, schema, stmts}
      end

    {:ok, migrations}
  end

  @impl true
  def known_migration_version?({versions, opts}, version) do
    notify(opts, {:known_migration_version?, version})

    not is_nil(List.keyfind(versions, version, 2))
  end

  @impl true
  def electrified_tables({[{_, schema} | _versions], _opts}) do
    {:ok, Enum.map(schema.tables, &%{schema: &1.name.schema, name: &1.name.name, oid: &1.oid})}
  end

  def electrified_tables(_state) do
    {:ok, []}
  end

  defp notify(%{parent: parent}, msg) when is_pid(parent) do
    send(parent, {__MODULE__, msg})
  end
end
