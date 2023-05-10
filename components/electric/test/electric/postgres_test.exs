defmodule Electric.PostgresTest do
  use Electric.Postgres.Case, async: false
  use ExUnitProperties

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

  defmodule Producer do
    use GenStage

    def start_link(opts) do
      GenStage.start_link(__MODULE__, opts, name: __MODULE__)
    end

    def publish(pid, messages) do
      GenStage.call(pid, {:publish, messages})
    end

    def init(_opts) do
      {:producer, []}
    end

    def handle_demand(_demand, state) do
      {:noreply, [], state}
    end

    def handle_call({:publish, events}, _from, state) do
      {:reply, :ok, events, state}
    end
  end

  defmodule Replication do
    use Postgrex.ReplicationConnection

    def start_link({state, opts}) do
      extra_opts = [
        auto_reconnect: false
      ]

      Postgrex.ReplicationConnection.start_link(__MODULE__, state, extra_opts ++ opts)
    end

    def stop(process) do
      Postgrex.ReplicationConnection.call(process, :disconnect)
    end

    @impl true
    def init(state) do
      {:ok, Map.put(state, :step, :disconnected)}
    end

    @impl true
    def handle_connect(state) do
      query = "CREATE_REPLICATION_SLOT postgrex TEMPORARY LOGICAL pgoutput NOEXPORT_SNAPSHOT"
      {:query, query, %{state | step: :create_slot}}
    end

    @impl true
    def handle_call(:disconnect, _from, state) do
      query = "DROP_REPLICATION_SLOT postgrex"
      {:query, query, %{state | step: :drop_slot}}
    end

    @impl true
    def handle_result(results, %{step: :create_slot} = state) when is_list(results) do
      query =
        "START_REPLICATION SLOT postgrex LOGICAL 0/0 (proto_version '1', publication_names 'pgx_test')"

      Process.send_after(state.parent, {:replication, self()}, 200)

      {:stream, query, [], %{state | step: :streaming}}
    end

    @impl true
    # https://www.postgresql.org/docs/14/protocol-replication.html
    def handle_data(<<?w, _wal_start::64, _wal_end::64, _clock::64, rest::binary>>, state) do
      message = Electric.Postgres.LogicalReplication.Decoder.decode(rest)
      Producer.publish(state.producer, [message])
      {:noreply, state}
    end

    def handle_data(<<?k, wal_end::64, _clock::64, reply>>, state) do
      messages =
        case reply do
          1 -> [<<?r, wal_end + 1::64, wal_end + 1::64, wal_end + 1::64, current_time()::64, 0>>]
          0 -> []
        end

      {:noreply, messages, state}
    end

    @epoch DateTime.to_unix(~U[2000-01-01 00:00:00Z], :microsecond)
    defp current_time(), do: System.os_time(:microsecond) - @epoch
  end

  def connection_args(pg_config \\ Electric.Postgres.TestConnection.config()) do
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

  setup_all do
    config = Electric.Postgres.TestConnection.config()
    config = Keyword.delete(config, :database)
    db_name = "electric_postgres_test_#{DateTime.utc_now() |> DateTime.to_unix()}"

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

    on_exit(fn ->
      {:ok, conn} = :epgsql.connect(pg_config)

      {:ok, _, _} =
        :epgsql.equery(
          conn,
          "SELECT pg_terminate_backend(pg_stat_activity.pid) FROM pg_stat_activity WHERE pg_stat_activity.datname = $1 AND pid <> pg_backend_pid();",
          [db_name]
        )

      :epgsql.close(conn)

      dropdb(db_name, config)
    end)

    {:ok, db: db_name, pg_config: pg_config, conn: conn}
  end

  setup(cxt) do
    %{pg_config: pg_config, conn: conn} = cxt

    # start the replication process here so that it will be stopped before
    # we get to the on_exit handler defined in the setup_all
    assert {:ok, _versions} = Electric.Postgres.Extension.migrate(conn)

    {:ok, _, _} = :epgsql.squery(conn, "CREATE PUBLICATION pgx_test FOR ALL TABLES;")

    # {:ok, _cols, _rows} =
    #   :epgsql.equery(
    #     conn,
    #     "SELECT c.oid, relname FROM pg_class c INNER JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = $1 AND c.relkind = 'r'",
    #     [
    #       Electric.Postgres.Extension.schema()
    #     ]
    #   )

    # FIXME: have turned off the capture of ddl statements through logical replication
    # pending a re-write using `Electric.Replication.Postgres.LogicalReplicationProducer`
    # {ddl_table_oid, _} =
    #   Enum.find(rows, fn {_oid, name} -> name == Electric.Postgres.Extension.ddl_table() end)

    # {:ok, producer} = start_supervised(Producer)

    # {:ok, replication_pid} =
    #   start_supervised(
    #     {Replication, {%{parent: self(), producer: producer, ddl_oid: ddl_table_oid}, pg_config}}
    #   )

    # receive do
    #   {:replication, _pid} ->
    #     :ok
    # end

    # {:ok, rep_consumer} =
    #   start_supervised(
    #     {Electric.Postgres.ReplicationConsumer, schema: Schema.new(), producer: producer}
    #   )

    namespace = "public"

    sql_file = pg_config[:database] <> ".sql"

    write_log? = false

    file =
      if write_log? do
        File.open!(sql_file, [:append])
      else
        nil
      end

    on_exit(fn ->
      if write_log?,
        do: IO.puts(["SQL log written to ", sql_file])
    end)

    {
      :ok,
      pg_config: pg_config, namespace: namespace, sql_file: file
      # replication_pid: replication_pid,
      # producer: producer,
      # replication_consumer: rep_consumer,
    }
  end

  # generate random create table statements
  # make sure they're valid for pg
  # get the ast
  # translate the ast to sqlite
  # make sure they're valid for sqlite
  #
  # - generate streal of ddl statements [create table, alter table, drop table only] (keeping a
  #   simple record of the existing tables so these statements are valid)
  # - run them against pg
  # - run them through the pgx state machine
  # - validate that final pgx state matches pg state

  def to_sql(table, opts) do
    SQLGenerator.Table.create_table(table, opts)
    |> Enum.take(1)
    |> hd()
  end

  defp size_stream do
    Stream.repeatedly(fn -> :rand.uniform(50) end)
  end

  def oid_loader(conn) do
    &Electric.Postgres.Extension.SchemaLoader.Epgsql.relation_oid(conn, &1, &2, &3)
  end

  def exec(nil, schema, _conn, _cxt) do
    schema
  end

  def exec(sql, schema, conn, cxt) do
    %{sql_file: sql_file} = cxt
    trace("> " <> sql <> ";")
    if sql_file, do: IO.write(sql_file, sql <> ";\n\n")

    :epgsql.with_transaction(conn, fn tx ->
      {:ok, _count, _rows} = :epgsql.squery(tx, sql <> ";")
    end)

    cmds = parse(sql)
    Schema.update(schema, cmds, oid_loader: oid_loader(conn))
  end

  def take(generator) do
    generator |> Enum.take(1) |> hd()
  end

  def migrate_schema(conn, namespace, command_count, cxt) do
    types = [{:int, "integer"}]

    schema =
      size_stream()
      |> Stream.map(fn size ->
        StreamData.resize(
          SQLGenerator.Table.table_definition(namespace: namespace, types: types),
          size
        )
      end)
      |> Stream.map(&take/1)
      |> Stream.map(
        &to_sql(
          &1,
          temporary_tables: false,
          foreign_keys: false
        )
      )
      |> Stream.take(5)
      |> Enum.reduce(Schema.new(), &exec(&1, &2, conn, cxt))

    StreamData.frequency([
      {4, StreamData.constant(:create_table)},
      {6, StreamData.constant(:alter_table)},
      {2, StreamData.constant(:create_index)},
      {2, StreamData.constant(:alter_index)},
      {1, StreamData.constant(:drop_index)},
      {1, StreamData.constant(:drop_table)}
    ])
    |> Stream.take(command_count)
    |> Stream.zip(size_stream())
    |> Enum.reduce(schema, fn
      {:create_table, size}, schema ->
        StreamData.resize(
          SQLGenerator.Table.table_definition(
            namespace: namespace,
            types: types,
            min_columns: 4
          ),
          size
        )
        |> Stream.map(
          &(SQLGenerator.Table.create_table(&1,
              schema: schema,
              temporary_tables: false
            )
            |> Enum.take(1)
            |> hd())
        )
        |> take()
        |> exec(schema, conn, cxt)

      {:alter_table, _size}, schema ->
        if Enum.empty?(schema.tables) do
          schema
        else
          # limit type choice to those that can be automatically cast
          types = [
            # {:float, "float4"},
            # {:float, "float8"},
            {:int, "int4"},
            {:int, "int2"},
            {:int, "int8"}
            #   {:str, "text"}
          ]

          SQLGenerator.Table.alter_table(
            schema: schema,
            types: types,
            # always cascade things to prevent errors. also harder
            cascade: true,
            # altering tables and setting new types has complicated effects on constraints
            except: [:drop_not_null, :generated, :set_type, :alter_constraint]
          )
          |> take()
          |> exec(schema, conn, cxt)
        end

      {:drop_table, _size}, schema ->
        case schema.tables do
          # at least 2 tables
          [_, _ | _] ->
            SQLGenerator.Table.drop_table(schema: schema, cascade: true)
            |> take()
            |> exec(schema, conn, cxt)

          _ ->
            schema
        end

      {:create_index, _size}, schema ->
        SQLGenerator.Index.create_index(schema: schema, except: [:concurrently])
        |> take()
        |> exec(schema, conn, cxt)

      {:alter_index, _size}, schema ->
        SQLGenerator.Index.alter_index(
          schema: schema,
          only_supported: true
        )
        |> take()
        |> exec(schema, conn, cxt)

      {:drop_index, _size}, schema ->
        # you can't drop a constraint by dropping its index -- so exclude the implicit indexes from this list
        case Schema.indexes(schema, include_constraints: false) do
          [] ->
            schema

          _ ->
            SQLGenerator.Index.drop_index(
              schema: schema,
              cascade: true
            )
            |> take()
            |> exec(schema, conn, cxt)
        end
    end)
  end

  defp pg_schema(conn, pg_config, namespace) do
    connection_args =
      Enum.flat_map([:host, :port, :database, :username], fn arg ->
        if value = pg_config[arg] do
          ["--#{@conf_arg_map[arg] || arg}=#{value}"]
        else
          []
        end
      end)

    # pg uses PGPASSWORD and so do we
    {sql, 0} =
      cmd(
        "pg_dump",
        connection_args ++
          [
            "--schema=#{namespace}",
            "--schema-only",
            "--no-owner",
            "--no-comments"
          ]
      )

    trace(sql)
    cmds = parse(sql)

    expected_schema = Schema.update(Schema.new(), cmds, oid_loader: oid_loader(conn))

    {expected_schema, cmds}
  end

  @tag timeout: :infinity
  property "pg schema tracking", cxt do
    %{namespace: namespace, conn: conn} = cxt

    # to generate e.g. 1024 statements run
    # STMTS=1024 mix test
    # the default is low to keep the standard test runtime low
    statement_count = System.get_env("STMTS", "64") |> String.to_integer()

    try do
      schema = migrate_schema(conn, namespace, statement_count, cxt)

      {expected_schema, _cmds} = pg_schema(conn, cxt.pg_config, namespace)

      assert_schema_equal(schema, expected_schema)

      # {:ok, replication_schema} =
      #   Electric.Postgres.ReplicationConsumer.current_schema(cxt.replication_consumer)

      # assert_schema_equal(replication_schema, expected_schema)
      assert_valid_schema(schema)
    after
      {:ok, _, _} = :epgsql.squery(cxt.conn, "DROP SCHEMA IF EXISTS #{namespace} CASCADE")
    end
  end

  def assert_schema_equal(schema1, expected_schema) do
    assert length(schema1.tables) == length(expected_schema.tables)

    for table <- schema1.tables do
      {:ok, expected_table} = Schema.fetch_table(expected_schema, table.name)
      assert table == expected_table
    end
  end
end
