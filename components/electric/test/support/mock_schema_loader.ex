defmodule Electric.Postgres.MockSchemaLoader do
  alias Electric.Postgres.{
    Extension.SchemaLoader,
    Extension.Migration,
    Schema
  }

  def oid_loader(type, schema, name) do
    {:ok, Enum.join(["#{type}", schema, name], ".") |> :erlang.phash2(50_000)}
  end

  def schema_update(schema \\ Schema.new(), cmds)

  def schema_update(%Schema.Proto.Schema{} = schema, cmds) when is_list(cmds) do
    schema_update(schema, cmds, &oid_loader/3)
  end

  def schema_update(cmds, oid_loader) when is_list(cmds) and is_function(oid_loader) do
    schema_update(Schema.new(), cmds, oid_loader)
  end

  def schema_update(%Schema.Proto.Schema{} = schema, cmds, oid_loader)
      when is_function(oid_loader, 3) do
    Schema.update(schema, cmds, oid_loader: oid_loader)
  end

  @spec migrate_versions([{version :: binary(), [stmt :: binary()]}]) :: [
          {version :: binary(), Schema.t()}
        ]
  def migrate_versions(migrations, oid_loader \\ nil) do
    oid_loader = oid_loader || (&oid_loader/3)

    {versions, _schema} =
      migrations
      |> Enum.map(fn {version, stmts} -> {version, List.wrap(stmts)} end)
      |> Enum.map_reduce(Schema.new(), fn {version, stmts}, schema ->
        schema = Enum.reduce(stmts, schema, &schema_update(&2, &1, oid_loader))
        {mock_version(version, schema, stmts), schema}
      end)

    # we need versions in reverse order, with the latest migration first
    Enum.reverse(versions)
  end

  def backend_spec(opts) do
    oid_loader = Keyword.get(opts, :oids, &oid_loader/3) |> make_oid_loader()

    versions = migrate_versions(Keyword.get(opts, :migrations, []), oid_loader)
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

  defp mock_version(version, schema, stmts) do
    %Migration{
      txid: String.to_integer(version),
      txts: DateTime.utc_now(),
      version: version,
      schema: schema,
      stmts: stmts
    }
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

  def load({[%{version: version, schema: schema} | _versions], opts}) do
    notify(opts, {:load, version, schema})
    {:ok, version, schema}
  end

  @impl true
  def load({versions, opts}, version) do
    case Enum.find(versions, &(&1.version == version)) do
      %Migration{schema: schema} ->
        notify(opts, {:load, version, schema})

        {:ok, version, schema}

      nil ->
        {:error, "schema version not found: #{version}"}
    end
  end

  @impl true
  def save({versions, opts}, version, schema, stmts) do
    notify(opts, {:save, version, schema, stmts})

    {:ok, {[mock_version(version, schema, stmts) | versions], opts}}
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
  def migration_history({versions, opts}, after_version) do
    notify(opts, {:migration_history, after_version})

    migrations =
      case after_version do
        nil ->
          versions

        after_version when is_binary(after_version) ->
          for %Migration{version: v} = version <- versions, v > after_version, do: version
      end

    {:ok, migrations}
  end

  @impl true
  def known_migration_version?({versions, opts}, version) do
    notify(opts, {:known_migration_version?, version})

    Enum.any?(versions, &(&1.version == version))
  end

  @impl true
  def internal_schema(_state) do
    Schema.new()
  end

  @impl true
  def table_electrified?(state, {schema, name}) do
    with {:ok, tables} <- electrified_tables(state) do
      {:ok, Enum.any?(tables, &(&1.schema == schema && &1.name == name))}
    end
  end

  @impl true
  def index_electrified?({[version | _versions], _opts}, {schema, name}) do
    {:ok,
     Enum.any?(
       Schema.indexes(version.schema, include_constraints: false),
       &(&1.table.schema == schema && &1.name == name)
     )}
  end

  defp notify(%{parent: parent}, msg) when is_pid(parent) do
    send(parent, {__MODULE__, msg})
  end
end
