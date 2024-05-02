defmodule Electric.Postgres.TestConnection do
  import ExUnit.Callbacks
  import ExUnit.Assertions

  alias Electric.Replication.{Postgres.Client, PostgresConnector, PostgresConnectorMng}

  require Electric.Postgres.Extension

  @conf_arg_map %{database: "dbname"}

  def cmd(exe, args) do
    trace("$ " <> Enum.join([exe | args], " "))
    System.cmd(exe, args, stderr_to_stdout: true)
  end

  def trace(s) do
    unless is_nil(System.get_env("SQL_TRACE")) do
      IO.puts(s)
    end
  end

  def connection_args(pg_config \\ config()) do
    Enum.flat_map([:host, :port, :database, :username], fn arg ->
      if value = pg_config[arg] do
        ["--#{@conf_arg_map[arg] || arg}=#{value}"]
      else
        []
      end
    end)
  end

  def dropdb(dbname, config) do
    Stream.repeatedly(fn ->
      cmd(
        "dropdb",
        connection_args(config) ++ ["--force", dbname]
      )
    end)
    |> Enum.take_while(fn
      {_, 0} ->
        false

      {_, _} ->
        Process.sleep(200)
        true
    end)
  end

  def create_test_db(setup_fun \\ fn _, _ -> nil end, teardown_fun \\ fn _ -> nil end) do
    db_name = "electric_postgres_test_#{DateTime.utc_now() |> DateTime.to_unix()}"
    config = config() |> Keyword.delete(:database)

    # put the configured password into the env where the pg cli tools expects it to be
    # if we're already getting the password from the env, then this does nothing
    if password = Keyword.get(config, :password),
      do: System.put_env("PGPASSWORD", to_string(password))

    {_, 0} =
      cmd(
        "createdb",
        connection_args(config) ++ ["-E", "UTF-8", "-T", "template0", db_name]
      )

    pg_config = Keyword.put(config, :database, db_name)
    conn_opts = conn_opts(pg_config)

    {:ok, conn} = Client.connect(conn_opts)
    setup_fun.(conn, db_name)
    Client.close(conn)

    on_exit(fn ->
      {:ok, conn} = Client.connect(conn_opts)
      teardown_fun.(conn)
      terminate_all_connections(conn, db_name)
      Client.close(conn)
      dropdb(db_name, config)
    end)

    {:ok, conn} = start_supervised(Electric.Postgres.TestConnection.childspec(conn_opts))
    %{db: db_name, pg_config: pg_config, conn_opts: conn_opts, conn: conn}
  end

  def terminate_all_connections(conn, db_name) do
    {:ok, _, _} =
      :epgsql.equery(
        conn,
        "SELECT pg_terminate_backend(pg_stat_activity.pid) FROM pg_stat_activity WHERE pg_stat_activity.datname = $1 AND pid <> pg_backend_pid();",
        [db_name]
      )

    :ok
  end

  def setup_replicated_db(context) do
    context = %{origin: origin} = Map.put_new(context, :origin, "test-origin")

    # Initialize the test DB to the state which Electric can work with.
    setup_fun = Map.get(context, :setup_fun, fn _conn, _dbname -> nil end)

    # Dropping the subscription is necessary before the test DB can be removed.
    teardown_fun = fn conn ->
      :epgsql.squery(
        conn,
        """
        ALTER SUBSCRIPTION "#{origin}" DISABLE;
        ALTER SUBSCRIPTION "#{origin}" SET (slot_name=NONE);
        DROP SUBSCRIPTION "#{origin}";
        """
      )
    end

    context = Map.merge(context, create_test_db(setup_fun, teardown_fun))
    connector_config = pg_connector_config(context)

    {:ok, _} = PostgresConnector.start_link(connector_config)
    assert :ready == wait_for_postgres_initialization(origin)

    # The connector config may be updated post-initialization, so we replace the static config
    # in the context with the dynamic one fetched from the PostgresConnector.
    Map.put(context, :connector_config, PostgresConnector.connector_config(origin))
  end

  def config do
    [
      host: System.get_env("PG_HOST", "localhost"),
      port: System.get_env("PG_PORT", "54321") |> String.to_integer(),
      database: System.get_env("PG_DB", "electric"),
      username: System.get_env("PG_USERNAME", "postgres"),
      password: System.get_env("PGPASSWORD", "password"),
      ipv6: false
    ]
  end

  def conn_opts(config) when is_list(config) do
    [connection: config]
    |> PostgresConnectorMng.preflight_connector_config()
    |> Electric.Replication.Connectors.get_connection_opts()
  end

  def setup_electrified_tables(%{scenario: scenario, conn: conn, origin: origin}) do
    setup_scenario(conn, origin, scenario)
  end

  def setup_electrified_tables(%{conn: conn, origin: origin}) do
    setup_scenario(conn, origin, :entries_and_documents)
  end

  def setup_open_permissions(%{scenario: scenario, conn: conn, origin: origin}) do
    define_permissions(conn, origin, scenario)
  end

  def setup_open_permissions(%{conn: conn, origin: origin}) do
    define_permissions(conn, origin, :entries_and_documents)
  end

  def define_permissions(conn, origin, scenario) do
    ddlx = scenario_ddlx(scenario)

    sql =
      ddlx
      |> Enum.map(&Electric.DDLX.parse!/1)
      |> Electric.DDLX.Command.PgSQL.to_sql()
      |> Enum.join("\n")

    conn
    |> :epgsql.squery(["BEGIN;\n", sql, "\nCOMMIT;"])
    |> Enum.each(&(:ok = elem(&1, 0)))

    :ok = wait_for_message(origin, Electric.Replication.Changes.UpdatedPermissions)
  end

  def setup_scenario(conn, origin, scenario) do
    {:ok, electrified_table_count} = run_scenario_migrations(conn, scenario)

    :ok = wait_for_message(origin, Electric.Replication.Changes.Migration)

    [electrified_count: electrified_table_count]
  end

  defp wait_for_message(_origin, []) do
    :ok
  end

  defp wait_for_message(origin, msg_type_list) when is_list(msg_type_list) do
    Stream.resource(
      fn -> 0 end,
      fn pos ->
        case Electric.Postgres.CachedWal.EtsBacked.next_segment(origin, pos) do
          :latest ->
            Process.sleep(100)
            {[], pos}

          {:ok, segment, pos} ->
            {[segment], pos}
        end
      end,
      & &1
    )
    |> Stream.reject(&(&1.changes == []))
    |> Enum.reduce_while(msg_type_list, fn
      %{changes: changes}, wait ->
        changes
        |> Enum.reduce(wait, fn
          %type{}, [type | rest] ->
            rest

          _, wait ->
            wait
        end)
        |> case do
          [] ->
            {:halt, :ok}

          rest ->
            {:cont, rest}
        end
    end)
    |> case do
      :ok ->
        :ok

      _ ->
        flunk("#{inspect(msg_type_list)} didn't show up in the cached WAL")
    end
  end

  defp wait_for_message(origin, type, count \\ 1) when is_atom(type) do
    wait_list =
      type
      |> Stream.duplicate(count)
      |> Enum.to_list()

    wait_for_message(origin, wait_list)
  end

  def run_scenario_migrations(conn, scenario) do
    {tables, [{version, ddl}]} = migration(scenario)
    for sql <- ddl, do: {:ok, [], []} = :epgsql.squery(conn, sql)

    :epgsql.squery(
      conn,
      [
        "BEGIN;",
        "CALL electric.migration_version('#{version}');",
        tables |> Enum.map(&"CALL electric.electrify('#{&1}');") |> Enum.join("\n"),
        "COMMIT;"
      ]
      |> Enum.join("\n")
    )
    |> Enum.each(&assert {:ok, _, _} = &1)

    {:ok, length(tables)}
  end

  def migrations(scenario) do
    {_tables, migrations} = migration(scenario)
    migrations
  end

  def migration(:entries_and_documents) do
    {sql, names} =
      create_table_sql([
        {"public.users",
         """
         id UUID PRIMARY KEY,
         name TEXT NOT NULL,
         role TEXT
         """},
        {"public.documents",
         """
         id UUID PRIMARY KEY,
         title TEXT NOT NULL
         """},
        {"public.my_entries",
         """
         id UUID PRIMARY KEY,
         content VARCHAR NOT NULL,
         content_b TEXT
         """},
        {"public.authored_entries",
         """
         id UUID PRIMARY KEY,
         content TEXT NOT NULL,
         author_id UUID REFERENCES users(id)
         """},
        {"public.comments",
         """
         id UUID PRIMARY KEY,
         content TEXT NOT NULL,
         entry_id UUID REFERENCES authored_entries(id),
         author_id UUID REFERENCES users(id)
         """}
      ])

    {names, [{"20230830154422", sql}]}
  end

  def migration(:linear) do
    {sql, names} =
      create_table_sql([
        {"public.users",
         """
         id UUID PRIMARY KEY,
         name TEXT NOT NULL
         """},
        {"public.accounts",
         """
         id UUID PRIMARY KEY,
         name TEXT NOT NULL
         """},
        {"public.projects",
         """
         id UUID PRIMARY KEY,
         account_id UUID NOT NULL REFERENCES public.accounts (id),
         name TEXT NOT NULL
         """},
        {"public.issues",
         """
         id UUID PRIMARY KEY,
         project_id UUID NOT NULL REFERENCES public.projects (id),
         name TEXT NOT NULL,
         visible bool
         """},
        {"public.comments",
         """
         id UUID PRIMARY KEY,
         issue_id UUID NOT NULL REFERENCES public.issues (id),
         author_id UUID NOT NULL REFERENCES public.users (id),
         comment TEXT NOT NULL
         """},
        {"public.team_memberships",
         """
         id UUID PRIMARY KEY,
         account_id UUID NOT NULL REFERENCES public.accounts (id) ON DELETE CASCADE,
         user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
         role TEXT NOT NULL
         """},
        {"public.project_memberships",
         """
         id UUID PRIMARY KEY,
         project_id UUID NOT NULL REFERENCES public.projects (id) ON DELETE CASCADE,
         team_membership_id UUID NOT NULL REFERENCES public.team_memberships (id) ON DELETE CASCADE,
         -- include direct user_id fk because we need it for assigns
         user_id UUID NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
         role TEXT NOT NULL
         """}
      ])

    {names, [{"20240415110440", sql}]}
  end

  def scenario_ddlx(scenario) do
    {names, _} = migration(scenario)

    Enum.map(names, &"ELECTRIC GRANT ALL ON #{&1} TO AUTHENTICATED")
  end

  defp create_table_sql(tables) do
    Enum.map_reduce(tables, [], fn {name, columns}, names ->
      {"CREATE TABLE #{name} (" <> columns <> ");", [name | names]}
    end)
  end

  def setup_with_sql_execute(%{conn: conn, with_sql: sql}) do
    case :epgsql.squery(conn, sql) do
      {:ok, _, _} ->
        :ok

      {:ok, _} ->
        :ok

      results ->
        case Enum.filter(results, &match?({:error, _}, &1)) do
          [] ->
            :ok

          errors ->
            raise "Encountered following errors while executing pre-test sql:\n#{inspect(errors, pretty: true)}"
        end
    end
  end

  def setup_with_sql_execute(_), do: :ok

  def setup_with_ddlx(%{conn: conn, ddlx: ddlx, origin: origin}) do
    sql =
      ddlx
      |> List.wrap()
      |> Enum.map(&String.trim/1)
      |> Enum.map(fn
        "ELECTRIC " <> _ = ddlx -> ddlx
        ddl -> "ELECTRIC " <> ddl
      end)
      |> Enum.map(&Electric.DDLX.parse!/1)
      |> Electric.DDLX.Command.pg_sql()
      |> Enum.join("\n")

    conn
    |> :epgsql.squery(["BEGIN;\n", sql, "\nCOMMIT;"])
    |> Enum.each(&(:ok = elem(&1, 0)))

    :ok = wait_for_message(origin, Electric.Replication.Changes.UpdatedPermissions)

    :ok
  end

  def setup_with_ddlx(_) do
    :ok
  end

  def wait_for_permission_state(%{origin: origin} = cxt) do
    msg_count =
      cxt
      |> Map.get(:wait_for, [])
      |> Keyword.get(:perms, 0)

    :ok = wait_for_message(origin, Electric.Replication.Changes.UpdatedPermissions, msg_count)
  end

  def load_schema(%{conn: _, origin: origin}) do
    {:ok, schema} = Electric.Postgres.Extension.SchemaCache.load(origin)

    {:ok, schema: schema}
  end

  def childspec(config, child_id \\ :epgsql) do
    conn_opts =
      if is_list(config) do
        conn_opts(config)
      else
        config
      end

    %{
      id: child_id,
      start: {Client, :connect, [conn_opts]}
    }
  end

  ###
  # Utility functions
  ###

  defp pg_connector_config(%{pg_config: pg_config, origin: origin}) do
    [
      producer: Electric.Replication.Postgres.LogicalReplicationProducer,
      connection:
        Keyword.merge(pg_config,
          replication: ~c"database",
          ssl: false
        ),
      replication: [
        electric_connection: [
          host: "host.docker.internal",
          port: 5433,
          dbname: "test"
        ]
      ],
      proxy: [
        listen: [port: 65432],
        password: "password"
      ],
      wal_window: [
        in_memory_size: 1_000_000,
        resumable_size: 1_000_000
      ],
      origin: origin
    ]
  end

  # Wait for the Postgres connector to start. It starts the CachedWal.Producer which this test module depends on.
  defp wait_for_postgres_initialization(origin) do
    case PostgresConnectorMng.status(origin) do
      :ready ->
        :ready

      _ ->
        Process.sleep(50)
        wait_for_postgres_initialization(origin)
    end
  end
end
