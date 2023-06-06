defmodule Electric.Postgres.ExtensionTest do
  use Electric.Extension.Case, async: false

  alias Electric.Postgres.{Schema, Schema.Proto}

  def oid_loader(type, schema, name) do
    {:ok, Enum.join(["#{type}", schema, name], ".") |> :erlang.phash2(50_000)}
  end

  def schema_update(schema \\ Schema.new(), cmds) do
    Schema.update(schema, cmds, oid_loader: &oid_loader/3)
  end

  defmodule MigrationCreateThing do
    @behaviour Electric.Postgres.Extension.Migration

    @impl true
    def version(), do: 2023_03_28_10_57_30

    @impl true
    def up(schema) do
      [
        "CREATE TABLE #{schema}.things (id uuid PRIMARY KEY)"
      ]
    end

    @impl true
    def down(schema) do
      [
        "DROP TABLE #{schema}.things CASCADE"
      ]
    end
  end

  def migrations do
    [
      MigrationCreateThing
    ]
  end

  alias Electric.Postgres.{Extension, Schema}

  def migrate_module(conn, _cxt, migration_module) do
    {:ok, _} = Extension.migrate(conn, migration_module)

    versions = Enum.map(migration_module.migrations(), & &1.version())
    assert {:ok, columns, rows} = :epgsql.squery(conn, "SELECT * FROM electric.schema_migrations")

    assert ["version", "inserted_at"] == Enum.map(columns, &elem(&1, 1))
    assert versions == Enum.map(rows, fn {v, _ts} -> String.to_integer(v) end)

    {:ok, _, rows} =
      :epgsql.equery(
        conn,
        "SELECT c.relname FROM pg_class c INNER JOIN pg_namespace n ON c.relnamespace = n.oid WHERE c.relkind = 'r' AND n.nspname = $1 ORDER BY c.relname",
        ["electric"]
      )

    {:ok, Enum.map(rows, &Tuple.to_list(&1))}
  end

  defmodule Migration01 do
    def version(), do: 2023_03_28_10_57_30
    def up(schema), do: ["CREATE TABLE #{schema}.things (id uuid PRIMARY KEY)"]
  end

  defmodule Migration02 do
    def version(), do: 2023_03_28_10_57_31
    def up(schema), do: ["CREATE TABLE #{schema}.other_things (id uuid PRIMARY KEY)"]
  end

  defmodule Migration03 do
    def version(), do: 2023_03_28_10_57_32
    def up(schema), do: ["DROP TABLE #{schema}.other_things"]
  end

  defmodule MigrationsV1 do
    def migrations, do: [Migration01]
  end

  defmodule MigrationsV2 do
    def migrations, do: [Migration01, Migration02]
  end

  defmodule MigrationsV3 do
    def migrations, do: [Migration01, Migration02, Migration03]
  end

  @tag :tmp_dir
  test "uses migration table to track applied migrations", cxt do
    tx(
      fn conn ->
        {:ok, rows} = migrate_module(conn, cxt, MigrationsV1)
        # FIXME: we no longer need the electric.migrations table 
        assert rows == [["migrations"], ["schema_migrations"], ["things"]]
        {:ok, rows} = migrate_module(conn, cxt, MigrationsV2)
        assert rows == [["migrations"], ["other_things"], ["schema_migrations"], ["things"]]
        {:ok, rows} = migrate_module(conn, cxt, MigrationsV3)
        assert rows == [["migrations"], ["schema_migrations"], ["things"]]
      end,
      cxt
    )
  end

  test "default migrations are valid", cxt do
    tx(&migrate/1, cxt)
  end

  test "we can retrieve and set the current schema json", cxt do
    tx(
      fn conn ->
        migrate(conn)

        assert {:ok, nil, %Schema.Proto.Schema{tables: []}} = Extension.current_schema(conn)
        schema = Schema.new()
        version = "20230405171534_1"

        schema =
          schema_update(
            schema,
            Electric.Postgres.parse!("CREATE TABLE first (id uuid PRIMARY KEY);")
          )

        assert :ok =
                 Extension.save_schema(conn, version, schema, [
                   "CREATE TABLE first (id uuid PRIMARY KEY);"
                 ])

        assert {:ok, ^version, ^schema} = Extension.current_schema(conn)

        schema =
          schema_update(
            schema,
            Electric.Postgres.parse!("ALTER TABLE first ADD value text;")
          )

        version = "20230405171534_2"

        assert :ok =
                 Extension.save_schema(conn, version, schema, [
                   "ALTER TABLE first ADD value text;"
                 ])

        assert {:ok, ^version, ^schema} = Extension.current_schema(conn)
      end,
      cxt
    )
  end

  test "we can retrieve the schema for a given version", cxt do
    tx(
      fn conn ->
        migrate(conn)

        assert {:ok, nil, %Schema.Proto.Schema{tables: []}} = Extension.current_schema(conn)
        schema = Schema.new()
        version = "20230405171534_1"

        schema =
          schema_update(
            schema,
            Electric.Postgres.parse!("CREATE TABLE first (id uuid PRIMARY KEY);")
          )

        assert :ok =
                 Extension.save_schema(conn, version, schema, [
                   "CREATE TABLE first (id uuid PRIMARY KEY);"
                 ])

        assert {:ok, ^version, ^schema} = Extension.current_schema(conn)
        assert {:ok, ^version, ^schema} = Extension.schema_version(conn, version)

        schema =
          schema_update(
            schema,
            Electric.Postgres.parse!("ALTER TABLE first ADD value text;")
          )

        version = "20230405171534_2"

        assert :ok =
                 Extension.save_schema(conn, version, schema, [
                   "ALTER TABLE first ADD value text;"
                 ])

        assert {:ok, ^version, ^schema} = Extension.current_schema(conn)
        assert {:ok, ^version, ^schema} = Extension.schema_version(conn, version)
      end,
      cxt
    )
  end

  test "we can retrieve the sql of applied migrations", cxt do
    migrations = [
      {"0001",
       [
         "CREATE TABLE a (id uuid PRIMARY KEY, value text NOT NULL);",
         "CREATE TABLE b (id uuid PRIMARY KEY, value text NOT NULL);",
         "CREATE INDEX a_idx ON a (value);"
       ]},
      {"0002", ["CREATE TABLE c (id uuid PRIMARY KEY, value text NOT NULL);"]},
      {"0003", ["CREATE TABLE d (id uuid PRIMARY KEY, value text NOT NULL);"]},
      {"0004", ["CREATE TABLE e (id uuid PRIMARY KEY, value text NOT NULL);"]}
    ]

    tx(
      fn conn ->
        migrate(conn)

        _schema =
          Enum.reduce(migrations, Schema.new(), fn {version, stmts}, schema ->
            schema =
              Enum.reduce(stmts, schema, fn stmt, schema ->
                schema_update(
                  schema,
                  stmt
                )
              end)

            assert :ok = Extension.save_schema(conn, version, schema, stmts)
            schema
          end)

        assert {:ok, versions} = Extension.migration_history(conn)

        assert migrations == Enum.map(versions, fn {v, _, s} -> {v, s} end)

        assert {:ok, versions} = Extension.migration_history(conn, "0002")

        versions = Enum.map(versions, fn {v, _, s} -> {v, s} end)

        assert versions == Enum.slice(migrations, 2..-1)
      end,
      cxt
    )
  end

  test "migration capture", cxt do
    tx(
      fn conn ->
        migrate(conn)

        sql1 = "CREATE TABLE buttercup (id int8 GENERATED ALWAYS AS IDENTITY);"
        sql2 = "CREATE TABLE daisy (id int8 GENERATED ALWAYS AS IDENTITY);"
        sql3 = "ALTER TABLE buttercup ADD COLUMN petal text;"
        sql4 = "ALTER TABLE buttercup ADD COLUMN stem text, ADD COLUMN leaf text;"

        for sql <- [sql1, sql2, sql3, sql4] do
          {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
        end

        assert {:ok, [row1, row2, row3, row4]} = Extension.ddl_history(conn)

        assert {1, txid, timestamp, ^sql1} = row1
        assert {2, ^txid, ^timestamp, ^sql2} = row2
        assert {3, ^txid, ^timestamp, ^sql3} = row3
        assert {4, ^txid, ^timestamp, ^sql4} = row4
      end,
      cxt
    )
  end

  test "migration capture", cxt do
    tx(
      fn conn ->
        migrate(conn)

        sql1 = "CREATE TABLE buttercup (id int8 GENERATED ALWAYS AS IDENTITY);"
        sql2 = "CREATE TABLE daisy (id int8 GENERATED ALWAYS AS IDENTITY);"
        sql3 = "ALTER TABLE buttercup ADD COLUMN petal text;"
        sql4 = "ALTER TABLE buttercup ADD COLUMN stem text, ADD COLUMN leaf text;"

        for sql <- [sql1, sql2, sql3, sql4] do
          {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
        end

        assert {:ok, [row1, row2, row3, row4]} = Extension.ddl_history(conn)

        assert {1, txid, timestamp, ^sql1} = row1
        assert {2, ^txid, ^timestamp, ^sql2} = row2
        assert {3, ^txid, ^timestamp, ^sql3} = row3
        assert {4, ^txid, ^timestamp, ^sql4} = row4
      end,
      cxt
    )
  end

  test "logical replication ddl is not captured", cxt do
    tx(
      fn conn ->
        migrate(conn)

        sql1 = "CREATE PUBLICATION all_tables FOR ALL TABLES;"

        sql2 =
          "CREATE SUBSCRIPTION \"postgres_1\" CONNECTION 'host=electric_1 port=5433 dbname=test connect_timeout=5000' PUBLICATION \"all_tables\" WITH (connect = false)"

        sql3 = "ALTER SUBSCRIPTION \"postgres_1\" ENABLE"
        # sql4 = "ALTER SUBSCRIPTION \"postgres_1\" REFRESH PUBLICATION WITH (copy_data = false);"

        for sql <- [sql1, sql2, sql3] do
          {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
        end

        assert {:ok, []} = Extension.ddl_history(conn)
      end,
      cxt
    )
  end

  describe "electrification" do
    alias Electric.Postgres.SQLGenerator

    test "can generate the ddl to create any index", cxt do
      tx(
        fn conn ->
          migrate(conn)

          assert {:ok, agent} = SQLGenerator.SchemaAgent.start_link()

          namespace = "something"
          assert {:ok, [], []} = :epgsql.squery(conn, "CREATE SCHEMA #{namespace}")

          SQLGenerator.sql_stream([:create_table, :create_index],
            schema: agent,
            create_table: [
              namespace: namespace,
              # limit the types used to avoid differences around casting
              # and representation that cause test failures but aren't problems
              # with the extension code.
              # To support other types, the sql_generator code would have to
              # capture all of pg's rules around casting etc
              types: [
                {:int, "int4"},
                {:int, "int2"},
                {:int, "int8"}
              ],
              temporary_tables: false,
              timezones: false,
              serial: false,
              trace: true
            ],
            create_index: [
              named: :always,
              only_supported: true,
              except: [:concurrently]
            ]
          )
          |> Stream.take(40)
          |> Enum.each(fn sql ->
            assert {:ok, [], []} = :epgsql.squery(conn, sql)
          end)

          schema = SQLGenerator.SchemaAgent.schema(agent)

          for table <- schema.tables, index <- table.indexes do
            {:ok, ddl} = Extension.create_index_ddl(conn, table.name, index.name)

            new_schema = Map.update!(Schema.new(), :tables, &[%{table | indexes: []} | &1])

            ast = Electric.Postgres.parse!(ddl)
            assert new_schema = schema_update(new_schema, ast)
            assert {:ok, new_table} = Schema.fetch_table(new_schema, table.name)
            %{} = new_index = Enum.find(new_table.indexes, &(&1.name == index.name))
            assert new_index == index
          end
        end,
        cxt
      )
    end

    test "can generate the ddl to create any table", cxt do
      tx(
        fn conn ->
          migrate(conn)

          assert {:ok, agent} = SQLGenerator.SchemaAgent.start_link()

          namespace = "something"
          assert {:ok, [], []} = :epgsql.squery(conn, "CREATE SCHEMA #{namespace}")

          SQLGenerator.sql_stream([:create_table],
            schema: agent,
            create_table: [
              namespace: namespace,
              # limit the types used to avoid differences around casting
              # and representation that cause test failures but aren't problems
              # with the extension code.
              # To support other types, the sql_generator code would have to
              # capture all of pg's rules around casting etc
              types: [
                {:int, "int4"},
                {:int, "int2"},
                {:int, "int8"}
              ],
              temporary_tables: false,
              timezones: false,
              serial: false,
              trace: true
            ]
          )
          |> Stream.take(40)
          |> Enum.each(fn sql ->
            assert {:ok, [], []} = :epgsql.squery(conn, sql)
          end)

          schema = SQLGenerator.SchemaAgent.schema(agent)

          for table <- schema.tables do
            {:ok, ddl} = Extension.create_table_ddl(conn, table.name)

            ast = Electric.Postgres.parse!(ddl)
            assert new_schema = schema_update(ast)
            assert {:ok, new_table} = Schema.fetch_table(new_schema, table.name)
            assert new_table == table
          end
        end,
        cxt
      )
    end

    test "generated ddl includes defaults and constraints", cxt do
      tx(
        fn conn ->
          migrate(conn)

          create_parent_table = """
          CREATE TABLE public.parent (
            id uuid PRIMARY KEY NOT NULL
          )
          """

          assert {:ok, [], []} = :epgsql.squery(conn, create_parent_table)

          create_table = """
          CREATE TABLE public.something (
            id uuid PRIMARY KEY NOT NULL,
            val1 text NOT NULL DEFAULT 'valid',
            val2 timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
            val3 int8 CONSTRAINT val3_check CHECK (val3 > 10),
            parent_id uuid REFERENCES public.parent (id) ON DELETE CASCADE
          )
          """

          assert {:ok, [], []} = :epgsql.squery(conn, create_table)

          {:ok, ddl} =
            Extension.create_table_ddl(conn, %Proto.RangeVar{schema: "public", name: "something"})

          assert ddl == """
                 CREATE TABLE something (
                     id uuid NOT NULL,
                     val1 text NOT NULL DEFAULT 'valid'::text,
                     val2 timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
                     val3 bigint,
                     parent_id uuid,
                     CONSTRAINT something_pkey PRIMARY KEY (id),
                     CONSTRAINT something_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES parent(id) ON DELETE CASCADE,
                     CONSTRAINT val3_check CHECK (val3 > 10)
                 );


                 """
        end,
        cxt
      )
    end

    test "generated ddl includes indexes", cxt do
      tx(
        fn conn ->
          migrate(conn)

          create_table = """
          CREATE TABLE public.something (
            id uuid PRIMARY KEY NOT NULL,
            val1 text NOT NULL DEFAULT 'valid',
            val2 timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
            val3 int8 CONSTRAINT val3_check CHECK (val3 > 10)
          )
          """

          assert {:ok, [], []} = :epgsql.squery(conn, create_table)

          create_index1 = """
          CREATE UNIQUE INDEX something_val1_uniq_idx ON public.something (val1)
          """

          assert {:ok, [], []} = :epgsql.squery(conn, create_index1)

          {:ok, ddl} =
            Extension.create_table_ddl(conn, %Proto.RangeVar{schema: "public", name: "something"})

          assert ddl == """
                 CREATE TABLE something (
                     id uuid NOT NULL,
                     val1 text NOT NULL DEFAULT 'valid'::text,
                     val2 timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
                     val3 bigint,
                     CONSTRAINT something_pkey PRIMARY KEY (id),
                     CONSTRAINT val3_check CHECK (val3 > 10)
                 );


                 CREATE UNIQUE INDEX something_val1_uniq_idx ON public.something USING btree (val1);

                 """
        end,
        cxt
      )
    end
  end
end
