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
        assert rows == [["schema_migrations"], ["things"]]
        {:ok, rows} = migrate_module(conn, cxt, MigrationsV2)
        assert rows == [["other_things"], ["schema_migrations"], ["things"]]
        {:ok, rows} = migrate_module(conn, cxt, MigrationsV3)
        assert rows == [["schema_migrations"], ["things"]]
      end,
      cxt
    )
  end

  test "default migrations are valid", cxt do
    tx(&migrate/1, cxt)
  end

  test_tx "we can retrieve and set the current schema json", fn conn ->
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
  end

  test_tx "we can retrieve the schema for a given version", fn conn ->
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
  end

  test_tx "we can retrieve the sql of applied migrations", fn conn ->
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
        assert :ok = save_migration_version(conn, version)
        schema
      end)

    assert migrations == migration_history(conn)

    [_m1, _m2, m3, m4] = migrations
    assert [m3, m4] == migration_history(conn, "0002")
  end

  test_tx "logical replication ddl is not captured", fn conn ->
    sql1 = "CREATE PUBLICATION all_tables FOR ALL TABLES;"

    sql2 =
      "CREATE SUBSCRIPTION \"postgres_1\" CONNECTION 'host=electric_1 port=5433 dbname=test connect_timeout=5000' PUBLICATION \"all_tables\" WITH (connect = false)"

    sql3 = "ALTER SUBSCRIPTION \"postgres_1\" ENABLE"
    # sql4 = "ALTER SUBSCRIPTION \"postgres_1\" REFRESH PUBLICATION WITH (copy_data = false);"

    for sql <- [sql1, sql2, sql3] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    assert {:ok, []} = Extension.ddl_history(conn)
  end

  describe "table electrification" do
    alias Electric.Postgres.SQLGenerator

    test_tx "can generate the ddl to create any index", fn conn ->
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
    end

    @tag timeout: 30_000
    test_tx "can generate the ddl to create any table", fn conn ->
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
    end

    test_tx "includes defaults and constraints in the generated ddl", fn conn ->
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
    end

    test_tx "includes indexes in the generated ddl", fn conn ->
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
    end

    test_tx "creates shadow tables", fn conn ->
      sql1 = "CREATE TABLE public.buttercup (id int4 GENERATED ALWAYS AS IDENTITY PRIMARY KEY);"
      sql2 = "CREATE TABLE public.daisy (id int4 GENERATED ALWAYS AS IDENTITY PRIMARY KEY);"
      sql3 = "CALL electric.electrify('buttercup')"

      for sql <- [sql1, sql2, sql3] do
        {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
      end

      assert {:ok, _, [{"1"}]} =
               :epgsql.squery(
                 conn,
                 "SELECT 1 FROM pg_class JOIN pg_namespace ON relnamespace = pg_namespace.oid WHERE relname = 'shadow__public__buttercup' AND nspname = 'electric'"
               )

      assert {:ok, _, []} =
               :epgsql.squery(
                 conn,
                 "SELECT 1 FROM pg_class JOIN pg_namespace ON relnamespace = pg_namespace.oid WHERE relname = 'shadow__public__daisy' AND nspname = 'electric'"
               )
    end

    test_tx "successfully validates column types", fn conn ->
      assert [{:ok, [], []}, {:ok, [], []}, {:ok, [], []}] ==
               :epgsql.squery(conn, """
               CREATE TYPE shapes AS ENUM ('circle', 'square', 'diamond');

               CREATE TABLE public.t1 (
                 id UUID PRIMARY KEY,
                 content TEXT NOT NULL,
                 words VARCHAR,
                 num2a INT2,
                 num2b SMALLINT,
                 num4a INT4,
                 num4b INT,
                 num4c INTEGER,
                 num8a INT8,
                 num8b BIGINT,
                 real4a FLOAT4,
                 "Real4b" REAL,
                 real8a FLOAT8,
                 real8b DOUBLE PRECISION,
                 ts TIMESTAMP,
                 tstz TIMESTAMPTZ,
                 d DATE,
                 t TIME,
                 flag BOOLEAN,
                 jb JSONB,
                 shape shapes
               );

               CALL electric.electrify('public.t1');
               """)
    end

    test_tx "rejects invalid column types", fn conn ->
      assert [
               {:ok, [], []},
               {:ok, [], []},
               {:error, {:error, :error, _, :raise_exception, error_msg, _}}
             ] =
               :epgsql.squery(conn, """
               CREATE TYPE badenum AS ENUM ('1circle', '_square', 'hello world');

               CREATE TABLE public.t1 (
                 id UUID PRIMARY KEY,
                 c1 CHARACTER,
                 c2 CHARACTER(11),
                 "C3" VARCHAR(11),
                 created_at TIMETZ,
                 e badenum
               );
               CALL electric.electrify('public.t1');
               """)

      assert error_msg ==
               """
               Cannot electrify t1 because some of its columns have types not supported by Electric:

                   c1 character(1)
                   c2 character(11)
                   "C3" character varying(11)
                   created_at time with time zone
                   e badenum (enum type badenum contains unsupported values '1circle', '_square', 'hello world')

               See https://electric-sql.com/docs/usage/data-modelling/types#supported-data-types
               to learn more about data type support in Electric.
               """
               |> String.trim()
    end

    test_tx "rejects default column expressions", fn conn ->
      assert [
               {:ok, [], []},
               {:error, {:error, :error, _, :raise_exception, error_msg, _}}
             ] =
               :epgsql.squery(conn, """
               CREATE TABLE public.t1 (
                 id UUID PRIMARY KEY,
                 t1 TEXT DEFAULT '',
                 num INTEGER NOT NULL,
                 "Ts" TIMESTAMP DEFAULT now(),
                 name VARCHAR
               );
               CALL electric.electrify('public.t1');
               """)

      assert error_msg ==
               """
               Cannot electrify t1 because some of its columns have DEFAULT expressions which are not currently supported by Electric:
                 t1
                 "Ts"
               """
               |> String.trim()
    end

    test_tx "rejects columns with CHECK, UNIQUE or EXCLUDE constraints",
            fn conn ->
              assert [
                       {:ok, [], []},
                       {:error, {:error, :error, _, :raise_exception, error_msg, _}}
                     ] =
                       :epgsql.squery(conn, """
                       CREATE TABLE public.t1 (
                         id UUID PRIMARY KEY,
                         t1 TEXT CHECK (t1 != ''),
                         "Ts" INT CHECK ("Ts" > 3),
                         uu INT UNIQUE,
                         "Email" TEXT,
                         EXCLUDE USING btree (lower("Email") WITH =)
                       );
                       CALL electric.electrify('public.t1');
                       """)

              # order insensitive testing for cols
              assert "Cannot electrify t1 because some of its columns have CHECK, UNIQUE, EXCLUDE or user-defined constraints which are not currently supported by Electric:" <>
                       column_names = error_msg

              for col <- ["t1", ~s("Ts"), "uu"] do
                assert column_names =~ ~r/#{col}/
              end
            end

    test_tx "rejects tables with missing primary key", fn conn ->
      assert [
               {:ok, [], []},
               {:error, {:error, :error, _, :raise_exception, error_msg, _}}
             ] =
               :epgsql.squery(conn, """
               CREATE TABLE public.t1 (id TEXT, val INTEGER);
               CALL electric.electrify('public.t1');
               """)

      assert error_msg == "Cannot electrify t1 because it doesn't have a PRIMARY KEY."
    end
  end

  test_tx "electrified?/3", fn conn ->
    sql1 = "CREATE TABLE public.buttercup (id int4 GENERATED ALWAYS AS IDENTITY PRIMARY KEY);"
    sql2 = "CREATE TABLE public.daisy (id int4 GENERATED ALWAYS AS IDENTITY PRIMARY KEY);"
    sql3 = "CALL electric.electrify('buttercup')"

    for sql <- [sql1, sql2, sql3] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    assert {:ok, true} = Extension.electrified?(conn, "buttercup")
    assert {:ok, true} = Extension.electrified?(conn, "public", "buttercup")

    assert {:ok, false} = Extension.electrified?(conn, "daisy")
    assert {:ok, false} = Extension.electrified?(conn, "public", "daisy")
  end

  defp migration_history(conn, after_version \\ nil) do
    assert {:ok, versions} = Extension.migration_history(conn, after_version)
    Enum.map(versions, fn %{version: v, stmts: s} -> {v, s} end)
  end
end
