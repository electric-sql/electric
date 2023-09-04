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
      |> Enum.map(fn {opts, stmts} -> {opts, List.wrap(stmts)} end)
      |> Enum.map_reduce(Schema.new(), fn {opts, stmts}, schema ->
        schema = Enum.reduce(stmts, schema, &schema_update(&2, &1, oid_loader))
        {mock_version(opts, schema, stmts), schema}
      end)

    # we need versions in reverse order, with the latest migration first
    Enum.reverse(versions)
  end

  def start_link(opts, args \\ []) do
    {module, spec} = agent_spec(opts, args)
    {:ok, state} = connect([], spec)
    {module, state}
  end

  @doc """
  Use this if you need a schema loader that's shared between multiple processes
  It replaces the loader state with an Agent instance and calls the various
  loader functions via that. Passing a `:name` in the args allows for this
  loader to be called via this registered name.
  """
  def agent_spec(opts, args \\ []) do
    {module, state} = backend_spec(opts)

    {module, {:agent, state, args}}
  end

  @doc """
  Gives the SchemaLoader instance that allows you to share a single agent-based
  mock loader via a registered name.
  """
  def agent_id(name) when is_atom(name) do
    {__MODULE__, {:agent, name}}
  end

  def backend_spec(opts) do
    oid_loader = Keyword.get(opts, :oids, &oid_loader/3) |> make_oid_loader()

    versions = migrate_versions(Keyword.get(opts, :migrations, []), oid_loader)
    parent = Keyword.get(opts, :parent, self())
    pks = Keyword.get(opts, :pks, nil)
    txids = Keyword.get(opts, :txids, %{})

    {__MODULE__,
     [parent: parent, versions: versions, oid_loader: oid_loader, pks: pks, txids: txids]}
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

  defp mock_version(version, schema, stmts) when is_binary(version) do
    mock_version([version: version], schema, stmts)
  end

  defp mock_version(opts, schema, stmts) do
    version = Keyword.fetch!(opts, :version)

    %Migration{
      txid: Keyword.get(opts, :txid, to_integer(version)),
      txts: Keyword.get(opts, :txts, to_integer(version)),
      version: version,
      schema: schema,
      stmts: stmts,
      timestamp: Keyword.get(opts, :timestamp, DateTime.utc_now())
    }
  end

  defp to_integer(i) when is_integer(i), do: i
  defp to_integer(s) when is_binary(s), do: String.to_integer(s)

  @doc """
  Update the mock loader with a new {txid, txts} => version mapping
  Returns the updated state
  """
  def receive_tx({__MODULE__, state}, tx, version) do
    {__MODULE__, receive_tx(state, tx, version)}
  end

  def receive_tx({:agent, pid}, %{"txid" => _txid, "txts" => _txts} = tx, version) do
    with :ok <- Agent.update(pid, &receive_tx(&1, tx, version)) do
      {:agent, pid}
    end
  end

  def receive_tx({versions, opts}, %{"txid" => _txid, "txts" => _txts} = row, version) do
    key = tx_key(row)
    {versions, Map.update(opts, :txids, %{key => version}, &Map.put(&1, key, version))}
  end

  # ignore rows that don't define a txid, txts key
  def receive_tx({versions, opts}, _row, _version) do
    {versions, opts}
  end

  defp tx_key(%{"txid" => txid, "txts" => txts}) do
    {to_integer(txid), to_integer(txts)}
  end

  @behaviour SchemaLoader

  @impl true
  def connect(_conn_config, {:agent, pid}) do
    {:ok, {:agent, pid}}
  end

  def connect(conn_config, {:agent, opts, args}) do
    name = Keyword.get(args, :name)
    pid = name && GenServer.whereis(name)

    if pid && Process.alive?(pid) do
      # use existing agent
      {:ok, {:agent, name}}
    else
      with {:ok, conn} <- connect(conn_config, opts),
           {:ok, pid} <- Agent.start_link(fn -> conn end, args) do
        {:ok, {:agent, name || pid}}
      end
    end
  end

  def connect(conn_config, opts) do
    {versions, opts} =
      opts
      |> Map.new()
      |> Map.pop(:versions, [])

    notify(opts, {:connect, conn_config})
    {:ok, {versions, opts}}
  end

  @impl true
  def load({:agent, pid}) do
    Agent.get(pid, &load/1)
  end

  def load({[], opts}) do
    notify(opts, :load)
    {:ok, nil, Schema.new()}
  end

  def load({[%{version: version, schema: schema} | _versions], opts}) do
    notify(opts, {:load, version, schema})
    {:ok, version, schema}
  end

  @impl true
  def load({:agent, pid}, version) do
    Agent.get(pid, &load(&1, version))
  end

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
  def save({:agent, pid}, version, schema, stmts) do
    with :ok <-
           Agent.update(pid, fn state ->
             {:ok, state} = save(state, version, schema, stmts)
             state
           end) do
      {:ok, {:agent, pid}}
    end
  end

  def save({versions, opts}, version, schema, stmts) do
    notify(opts, {:save, version, schema, stmts})

    {:ok, {[mock_version(version, schema, stmts) | versions], opts}}
  end

  @impl true
  def relation_oid({:agent, pid}, type, schema, name) do
    Agent.get(pid, &relation_oid(&1, type, schema, name))
  end

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
  def primary_keys({:agent, pid}, schema, name) do
    Agent.get(pid, &primary_keys(&1, schema, name))
  end

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
  def primary_keys({:agent, pid}, {schema, name}) do
    Agent.get(pid, &primary_keys(&1, {schema, name}))
  end

  def primary_keys({_versions, _opts} = state, {schema, name}) do
    primary_keys(state, schema, name)
  end

  @impl true
  def refresh_subscription({:agent, pid}, name) do
    Agent.get(pid, &refresh_subscription(&1, name))
  end

  def refresh_subscription({_versions, opts}, name) do
    notify(opts, {:refresh_subscription, name})
    :ok
  end

  @impl true
  def migration_history({:agent, pid}, after_version) do
    Agent.get(pid, &migration_history(&1, after_version))
  end

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
  def known_migration_version?({:agent, pid}, version) do
    Agent.get(pid, &known_migration_version?(&1, version))
  end

  def known_migration_version?({versions, opts}, version) do
    notify(opts, {:known_migration_version?, version})

    Enum.any?(versions, &(&1.version == version))
  end

  @impl true
  def internal_schema(_state) do
    Schema.new()
  end

  def electrified_tables({:agent, pid}) do
    Agent.get(pid, &electrified_tables/1)
  end

  def electrified_tables({[version | _versions], _opts}) do
    {:ok, Schema.table_info(version.schema)}
  end

  def electrified_tables(_state) do
    {:ok, []}
  end

  @impl true
  def table_electrified?({:agent, pid}, {schema, name}) do
    Agent.get(pid, &table_electrified?(&1, {schema, name}))
  end

  def table_electrified?(state, {schema, name}) do
    with {:ok, tables} <- electrified_tables(state) do
      {:ok, Enum.any?(tables, &(&1.schema == schema && &1.name == name))}
    end
  end

  @impl true
  def index_electrified?({:agent, pid}, {schema, name}) do
    Agent.get(pid, &index_electrified?(&1, {schema, name}))
  end

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

  @impl true
  def tx_version({:agent, pid}, row) do
    Agent.get(pid, &tx_version(&1, row))
  end

  def tx_version({versions, opts}, %{"txid" => txid, "txts" => txts} = row) do
    notify(opts, {:tx_version, txid, txts})

    key = tx_key(row)

    # we may not explicitly configure the mock loader with txids
    case Map.fetch(opts[:txids] || %{}, key) do
      :error ->
        # we only use the txid which MUST be set to the version because
        # the mocking system has no way to propagate transaction ids through
        # -- the txid/txts stuff is an implementation detail of the proxy system
        # FIXME: re-factor the proxy impl to cache actions until it has a version
        case Enum.find(
               versions,
               &(to_integer(&1.txid) == to_integer(txid) &&
                   to_integer(&1.txts) == to_integer(txts))
             ) do
          %Migration{version: version} ->
            {:ok, version}

          _other ->
            {:error, "#{__MODULE__}: No migration matching #{txid}"}
        end

      {:ok, version} ->
        {:ok, version}
    end
  end
end
