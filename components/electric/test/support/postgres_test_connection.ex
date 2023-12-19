defmodule Electric.Postgres.TestConnection do
  import ExUnit.Callbacks
  import ExUnit.Assertions

  alias Electric.Replication.{Postgres.Client, PostgresConnector, PostgresConnectorMng}
  alias Electric.Postgres.Extension

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

  def create_test_db(setup_fun \\ fn _ -> nil end, teardown_fun \\ fn _ -> nil end) do
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
    {:ok, conn} = start_supervised(Electric.Postgres.TestConnection.childspec(pg_config))

    setup_fun.(conn)

    on_exit(fn ->
      {:ok, conn} = Client.connect(pg_config)
      teardown_fun.(conn)
      terminate_all_connections(conn, db_name)
      Client.close(conn)
      dropdb(db_name, config)
    end)

    %{db: db_name, pg_config: pg_config, conn: conn}
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
    context = Map.put_new(context, :origin, "tmp-test-subscription")
    origin = Map.fetch!(context, :origin)

    # Initialize the test DB to the state which Electric can work with.
    setup_fun = fn _conn -> nil end

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

    connector_config =
      context
      |> pg_connector_config()
      |> Keyword.put(:origin, "#{origin}")

    {:ok, _} = PostgresConnector.start_link(connector_config)
    assert :ready == wait_for_postgres_initialization(origin)

    Map.put(context, :connector_config, PostgresConnector.connector_config(origin))
  end

  def config do
    [
      host: System.get_env("PG_HOST", "localhost"),
      port: System.get_env("PG_PORT", "54321") |> String.to_integer(),
      database: System.get_env("PG_DB", "electric"),
      username: System.get_env("PG_USERNAME", "postgres"),
      password: System.get_env("PGPASSWORD", "password")
    ]
    |> Enum.map(fn
      {k, v} when is_binary(v) -> {k, String.to_charlist(v)}
      other -> other
    end)
  end

  def setup_electrified_tables(%{conn: conn}) do
    {:ok, [], []} =
      :epgsql.squery(conn, """
      CREATE TABLE public.users (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL
      )
      """)

    {:ok, [], []} =
      :epgsql.squery(conn, """
      CREATE TABLE public.documents (
        id UUID PRIMARY KEY,
        title TEXT NOT NULL,
        electric_user_id UUID REFERENCES users(id)
      )
      """)

    {:ok, [], []} =
      :epgsql.squery(conn, """
      CREATE TABLE public.my_entries (
        id UUID PRIMARY KEY,
        content VARCHAR NOT NULL,
        content_b TEXT
      );

      """)

    :epgsql.squery(conn, """
    BEGIN;
    CALL electric.migration_version('20230830154422');
    CALL electric.electrify('public.users');
    CALL electric.electrify('public.documents');
    CALL electric.electrify('public.my_entries');
    COMMIT;
    """)
    |> Enum.each(&assert {:ok, _, _} = &1)

    Stream.resource(
      fn -> 0 end,
      fn pos ->
        case Electric.Postgres.CachedWal.EtsBacked.next_segment(pos) do
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
    |> Stream.take(10)
    |> Enum.find(&Enum.all?(&1.changes, fn x -> Extension.is_ddl_relation(x.relation) end)) ||
      flunk("Migration statements didn't show up in the cached WAL")

    []
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

  def load_schema(%{conn: _, origin: origin}) do
    {:ok, schema} = Electric.Postgres.Extension.SchemaCache.load(origin)

    {:ok, schema: schema}
  end

  def childspec(config, child_id \\ :epgsql) do
    %{
      id: child_id,
      start: {Client, :connect, [config]}
    }
  end

  ###
  # Utility functions
  ###

  defp pg_connector_config(%{pg_config: pg_config}) do
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
      ]
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
