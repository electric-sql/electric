defmodule Electric.Postgres.MockSchemaLoader do
  alias Electric.Postgres.{
    Extension.SchemaLoader,
    Extension.Migration,
    Schema
  }

  alias Electric.Satellite.SatPerms

  defmacro __using__(_opts) do
    quote do
      alias Electric.Postgres.MockSchemaLoader
      alias Electric.Postgres.Extension.SchemaLoader
    end
  end

  defstruct versions: [], opts: [], global_perms: [], user_perms: []

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
    {:ok, state} = connect(spec, [])
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

  def backend_spec(opts \\ []) do
    oid_loader = Keyword.get(opts, :oids, &oid_loader/3) |> make_oid_loader()

    versions = migrate_versions(Keyword.get(opts, :migrations, []), oid_loader)
    parent = Keyword.get(opts, :parent, self())
    pks = Keyword.get(opts, :pks, nil)
    txids = Keyword.get(opts, :txids, %{})
    # allow for having a shortcut to set electrified tables and indexes
    indexes = Keyword.get(opts, :indexes, %{})
    tables = Keyword.get(opts, :tables, %{})

    rules = Keyword.get(opts, :rules, [])

    {__MODULE__,
     [
       parent: parent,
       versions: versions,
       oid_loader: oid_loader,
       pks: pks,
       txids: txids,
       indexes: indexes,
       tables: tables,
       rules: List.wrap(rules)
     ]}
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
    :ok = Agent.update(pid, &receive_tx(&1, tx, version))
    {:agent, pid}
  end

  def receive_tx(%{opts: opts} = state, %{"txid" => _txid, "txts" => _txts} = row, version) do
    key = tx_key(row)
    %{state | opts: Map.update(opts, :txids, %{key => version}, &Map.put(&1, key, version))}
  end

  # ignore rows that don't define a txid, txts key
  def receive_tx(state, _row, _version) do
    state
  end

  def electrify_table({__MODULE__, state}, {schema, table}) do
    {__MODULE__, electrify_table(state, {schema, table})}
  end

  def electrify_table({:agent, pid}, {schema, table}) do
    :ok = Agent.update(pid, &electrify_table(&1, {schema, table}))
    {:agent, pid}
  end

  def electrify_table(%{opts: opts} = state, {schema, table}) do
    %{
      state
      | opts:
          Map.update(
            opts,
            :tables,
            %{{schema, table} => true},
            &Map.put(&1, {schema, table}, true)
          )
    }
  end

  defp tx_key(%{"txid" => txid, "txts" => txts}) do
    {to_integer(txid), to_integer(txts)}
  end

  @behaviour SchemaLoader

  @impl SchemaLoader
  def connect({:agent, pid}, _conn_config) do
    {:ok, {:agent, pid}}
  end

  def connect({:agent, opts, args}, conn_config) do
    name = Keyword.get(args, :name)
    pid = name && GenServer.whereis(name)

    if pid && Process.alive?(pid) do
      # use existing agent
      {:ok, {:agent, name}}
    else
      with {:ok, conn} <- connect(opts, conn_config),
           {:ok, pid} <- Agent.start_link(fn -> conn end, args) do
        {:ok, {:agent, name || pid}}
      end
    end
  end

  def connect(opts, conn_config) do
    opts = Map.new(opts)
    {versions, opts} = Map.pop(opts, :versions, [])
    {rules, opts} = Map.pop(opts, :rules, [])

    notify(opts, {:connect, conn_config})
    {:ok, %__MODULE__{versions: versions, opts: opts, global_perms: rules}}
  end

  @impl SchemaLoader
  def load({:agent, pid}) do
    Agent.get(pid, &load/1)
  end

  def load(%{versions: [], opts: opts}) do
    notify(opts, :load)
    {:ok, SchemaLoader.Version.new(nil, Schema.new())}
  end

  def load(%{versions: [%{version: version, schema: schema} | _versions], opts: opts}) do
    notify(opts, :load)
    notify(opts, {:load, version, schema})
    {:ok, SchemaLoader.Version.new(version, schema)}
  end

  @impl SchemaLoader
  def load({:agent, pid}, version) do
    Agent.get(pid, &load(&1, version))
  end

  def load(%{versions: versions, opts: opts}, version) do
    case Enum.find(versions, &(&1.version == version)) do
      %Migration{schema: schema} ->
        notify(opts, {:load, version, schema})

        {:ok, SchemaLoader.Version.new(version, schema)}

      nil ->
        {:error, "schema version not found: #{version}"}
    end
  end

  @impl SchemaLoader
  def save({:agent, pid}, version, schema, stmts) do
    with :ok <-
           Agent.update(pid, fn state ->
             {:ok, state, _schema_version} = save(state, version, schema, stmts)
             state
           end) do
      {:ok, {:agent, pid}, SchemaLoader.Version.new(version, schema)}
    end
  end

  def save(%{versions: versions, opts: opts} = state, version, schema, stmts) do
    notify(opts, {:save, version, schema, stmts})

    {:ok, %{state | versions: [mock_version(version, schema, stmts) | versions]},
     SchemaLoader.Version.new(version, schema)}
  end

  @impl SchemaLoader
  def relation_oid({:agent, pid}, type, schema, name) do
    Agent.get(pid, &relation_oid(&1, type, schema, name))
  end

  def relation_oid(%{opts: %{oid_loader: oid_loader}}, type, schema, name)
      when is_function(oid_loader, 3) do
    oid_loader.(type, schema, name)
  end

  def relation_oid(%{opts: opts}, type, schema, name) do
    notify(opts, {:relation_oid, type, schema, name})

    with %{} = oids <- get_in(opts, [:oids, type]),
         {:ok, oid} <- Map.fetch(oids, {schema, name}) do
      {:ok, oid}
    else
      _ -> {:error, "no oid defined for #{type}:#{schema}.#{name} in #{inspect(opts)}"}
    end
  end

  @impl SchemaLoader
  def refresh_subscription({:agent, pid}, name) do
    Agent.get(pid, &refresh_subscription(&1, name))
  end

  def refresh_subscription(%{opts: opts}, name) do
    notify(opts, {:refresh_subscription, name})
    :ok
  end

  @impl SchemaLoader
  def migration_history({:agent, pid}, after_version) do
    Agent.get(pid, &migration_history(&1, after_version))
  end

  def migration_history(%{versions: versions, opts: opts}, after_version) do
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

  @impl SchemaLoader
  def known_migration_version?({:agent, pid}, version) do
    Agent.get(pid, &known_migration_version?(&1, version))
  end

  def known_migration_version?(%{versions: versions, opts: opts}, version) do
    notify(opts, {:known_migration_version?, version})

    Enum.any?(versions, &(&1.version == version))
  end

  @impl SchemaLoader
  def internal_schema(_state) do
    Schema.new()
  end

  def electrified_tables({:agent, pid}) do
    Agent.get(pid, &electrified_tables/1)
  end

  def electrified_tables(%{versions: [version | _versions]}) do
    {:ok, Schema.table_info(version.schema)}
  end

  def electrified_tables(_state) do
    {:ok, []}
  end

  @impl SchemaLoader
  def table_electrified?({:agent, pid}, {schema, name}) do
    Agent.get(pid, &table_electrified?(&1, {schema, name}))
  end

  def table_electrified?(%{opts: opts} = state, {schema, name}) do
    if Map.get(opts.tables, {schema, name}) do
      {:ok, true}
    else
      with {:ok, tables} <- electrified_tables(state) do
        {:ok, Enum.any?(tables, &(&1.schema == schema && &1.name == name))}
      end
    end
  end

  @impl SchemaLoader
  def index_electrified?({:agent, pid}, {schema, name}) do
    Agent.get(pid, &index_electrified?(&1, {schema, name}))
  end

  def index_electrified?(%{versions: [version | _versions]}, {schema, name}) do
    {:ok,
     Enum.any?(
       Schema.indexes(version.schema, include_constraints: false),
       &(&1.table.schema == schema && &1.name == name)
     )}
  end

  defp notify(%{parent: parent}, msg) when is_pid(parent) do
    send(parent, {__MODULE__, msg})
  end

  defp notify(_, _msg) do
    :ok
  end

  @impl SchemaLoader
  def tx_version({:agent, pid}, row) do
    Agent.get(pid, &tx_version(&1, row))
  end

  def tx_version(%{versions: versions, opts: opts}, %{"txid" => txid, "txts" => txts} = row) do
    notify(opts, {:tx_version, txid, txts})

    key = tx_key(row)

    # we may not explicitly configure the mock loader with txids
    case Map.fetch(opts[:txids] || %{}, key) do
      :error ->
        # we only use the txid which MUST be set to the version because
        # the mocking system has no way to propagate transaction ids through
        # -- the txid/txts stuff is an implementation detail of the proxy system
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

  @impl SchemaLoader
  def global_permissions({:agent, pid}) do
    Agent.get(pid, &global_permissions(&1))
  end

  def global_permissions(%{global_perms: []}) do
    {:ok, initial_global_perms()}
  end

  def global_permissions(%{global_perms: [perms | _]}) do
    {:ok, perms}
  end

  @impl SchemaLoader
  def global_permissions({:agent, pid}, id) do
    Agent.get(pid, &global_permissions(&1, id))
  end

  def global_permissions(%{global_perms: [], opts: opts}, 1) do
    notify(opts, :global_permissions)
    {:ok, initial_global_perms()}
  end

  def global_permissions(%{global_perms: []}, id) do
    {:error, "global perms with id #{id} not found"}
  end

  def global_permissions(%{global_perms: perms, opts: opts}, id) do
    notify(opts, {:global_permissions, id})

    case Enum.find(perms, &(&1.id == id)) do
      nil -> {:error, "global perms with id #{id} not found"}
      perms -> {:ok, perms}
    end
  end

  @impl SchemaLoader
  def user_permissions({:agent, pid}, user_id) do
    Agent.get_and_update(pid, fn state ->
      case user_permissions(state, user_id) do
        {:ok, state, perms} ->
          {{:ok, {:agent, pid}, perms}, state}

        error ->
          {error, state}
      end
    end)
  end

  def user_permissions(%{user_perms: user_perms, opts: opts} = state, user_id) do
    notify(opts, {:user_permissions, user_id})

    case(Enum.find(user_perms, &(&1.user_id == user_id))) do
      nil ->
        id = next_user_perms_id(state)

        {:ok, global} = global_permissions(state)
        perms = %SatPerms{id: id, user_id: user_id, rules: global}
        {:ok, %{state | user_perms: [perms | user_perms]}, perms}

      perms ->
        {:ok, state, perms}
    end
  end

  @impl SchemaLoader
  def user_permissions({:agent, pid}, user_id, perms_id) do
    Agent.get(pid, &user_permissions(&1, user_id, perms_id))
  end

  def user_permissions(%{user_perms: user_perms, opts: opts}, user_id, perms_id) do
    notify(opts, {:user_permissions, user_id, perms_id})

    case(Enum.find(user_perms, &(&1.user_id == user_id && &1.id == perms_id))) do
      nil ->
        {:error, "perms id #{perms_id} not found for user #{user_id}"}

      perms ->
        {:ok, perms}
    end
  end

  def save_global_permissions({__MODULE__, {:agent, pid}}, rules) do
    Agent.get_and_update(pid, fn state ->
      case save_global_permissions({__MODULE__, state}, rules) do
        {:ok, {__MODULE__, state}} ->
          {{:ok, {__MODULE__, {:agent, pid}}}, state}

        error ->
          {error, state}
      end
    end)
  end

  def save_global_permissions(
        {__MODULE__, %{global_perms: global_perms, opts: opts} = state},
        %SatPerms.Rules{} = rules
      ) do
    notify(opts, {:save_global_permissions, rules})

    # duplicate all the current user perms with the updated rules, as per the pg version
    {user_perms, _id} =
      state.user_perms
      |> Enum.filter(&(&1.rules.id == rules.parent_id))
      |> Enum.uniq_by(& &1.user_id)
      |> Enum.map_reduce(next_user_perms_id(state), fn user_perms, id ->
        {%{user_perms | id: id, rules: rules}, id + 1}
      end)

    {:ok,
     {__MODULE__,
      %{state | user_perms: user_perms ++ state.user_perms, global_perms: [rules | global_perms]}}}
  end

  @impl SchemaLoader
  def save_user_permissions({:agent, pid}, user_id, roles) do
    Agent.get_and_update(pid, fn state ->
      case save_user_permissions(state, user_id, roles) do
        {:ok, state, perms} ->
          {{:ok, {:agent, pid}, perms}, state}

        error ->
          {error, state}
      end
    end)
  end

  def save_user_permissions(
        %{user_perms: user_perms, opts: opts} = state,
        user_id,
        %SatPerms.Roles{} = perms
      ) do
    notify(opts, {:save_user_permissions, user_id, perms})
    %{rules_id: rules_id, parent_id: parent_id, roles: roles} = perms

    global =
      cond do
        rules_id == 1 -> initial_global_perms()
        global = Enum.find(state.global_perms, &(&1.id == rules_id)) -> global
        true -> nil
      end

    if global do
      if parent_id && !Enum.find(user_perms, &(&1.id == parent_id)) do
        {:error, "invalid parent permissions id #{parent_id}"}
      else
        id = next_user_perms_id(state)

        perms = %SatPerms{id: id, user_id: user_id, rules: global, roles: roles}
        {:ok, %{state | user_perms: [perms | user_perms]}, perms}
      end
    else
      {:error, "invalid global permissions id #{rules_id}"}
    end
  end

  defp next_user_perms_id(%{user_perms: []}), do: 1
  defp next_user_perms_id(%{user_perms: [%{id: id} | _]}), do: id + 1

  defp initial_global_perms do
    %SatPerms.Rules{id: 1}
  end
end
