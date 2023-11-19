defmodule Electric.Postgres.ReplicationTest do
  use ExUnit.Case, async: true

  use Electric.Satellite.Protobuf

  alias Electric.Postgres.{Replication, Schema}

  def parse(sql) do
    Electric.Postgres.parse!(sql)
  end

  test "stmt_type/1" do
    stmts = [
      {"create table doorbel (id int8);", :CREATE_TABLE},
      {"create index on frog (id asc);", :CREATE_INDEX},
      {"alter table public.fish add value text;", :ALTER_ADD_COLUMN}
    ]

    for {sql, expected_type} <- stmts do
      [ast] = parse(sql)
      assert Replication.stmt_type(ast) == expected_type
    end
  end

  describe "affected_tables/1" do
    def assert_table_list(tables, expected_tables) do
      assert length(tables) == length(expected_tables)

      assert tables
             |> Enum.zip(expected_tables)
             |> Enum.all?(fn {name, expected_name} ->
               Schema.equal?(name, expected_name, [nil])
             end)
    end

    test "returns a list of created tables" do
      """
      create table public.fish (id int8 primary key);
      create table frog (id int8 primary key);
      create table teeth.front (id int8 primary key);
      """
      |> parse()
      |> Replication.affected_tables()
      |> assert_table_list([{"public", "fish"}, {"public", "frog"}, {"teeth", "front"}])
    end

    test "returns a list of altered tables" do
      """
      alter table public.fish add value text;
      alter table frog add constraint "something_unique" unique (something);
      alter table teeth.front alter column id drop default;
      """
      |> parse()
      |> Replication.affected_tables()
      |> assert_table_list([{"public", "fish"}, {"public", "frog"}, {"teeth", "front"}])
    end

    test "captures all affected tables" do
      """
      create table public.fish (id int8 primary key);
      create table frog (id int8 primary key);
      alter table teeth.front alter column id drop default;
      """
      |> parse()
      |> Replication.affected_tables()
      |> assert_table_list([{"public", "fish"}, {"public", "frog"}, {"teeth", "front"}])
    end

    test "deduplicates in a search path aware manner" do
      """
      create table public.fish (id int8 primary key);
      alter table fish alter column id drop default;
      """
      |> parse()
      |> Replication.affected_tables()
      |> assert_table_list([{"public", "fish"}])
    end

    test "returns [] for CREATE INDEX" do
      """
      create index my_index on public.fish (id);
      create index on frog (id asc);
      """
      |> parse()
      |> Replication.affected_tables()
      |> assert_table_list([])
    end

    test "returns [] for unsupported stmts" do
      stmts = [
        """
        CREATE SUBSCRIPTION \"postgres_2\" CONNECTION 'host=electric_1 port=5433 dbname=test connect_timeout=5000' PUBLICATION \"all_tables\" WITH (connect = false)
        """,
        """
        ALTER SUBSCRIPTION \"postgres_1\" ENABLE
        """,
        """
        ALTER SUBSCRIPTION \"postgres_1\" REFRESH PUBLICATION WITH (copy_data = false)
        """
      ]

      for stmt <- stmts do
        stmt
        |> parse()
        |> Replication.affected_tables()
        |> assert_table_list([])
      end
    end
  end

  defp oid_loader(type, schema, name) do
    {:ok, Enum.join(["#{type}", schema, name], ".") |> :erlang.phash2(50_000)}
  end

  defp schema_update(schema \\ Schema.new(), cmds) do
    Schema.update(schema, cmds, oid_loader: &oid_loader/3)
  end

  describe "migrate/2" do
    test "updates the schema and returns a valid protcol message" do
      stmt = "CREATE TABLE public.fish (id int8 PRIMARY KEY);"
      schema = schema_update(stmt)

      version = "20230405134615"

      assert {:ok, [msg], [{"public", "fish"}]} = Replication.migrate(schema, version, stmt)

      # there are lots of tests that validate the schema is being properly updated
      # assert Schema.table_names(schema) == [~s("public"."fish"), ~s("frog"), ~s("teeth"."front")]
      assert Schema.table_names(schema) == [~s("public"."fish")]
      assert %SatOpMigrate{version: ^version} = msg
      %{stmts: stmts, table: table} = msg

      assert stmts == [
               %SatOpMigrate.Stmt{
                 type: :CREATE_TABLE,
                 sql:
                   "CREATE TABLE \"fish\" (\n  \"id\" INTEGER NOT NULL,\n  CONSTRAINT \"fish_pkey\" PRIMARY KEY (\"id\")\n) WITHOUT ROWID;\n"
               }
             ]

      assert %SatOpMigrate.Table{name: "fish"} = table

      assert table == %SatOpMigrate.Table{
               name: "fish",
               columns: [
                 %SatOpMigrate.Column{
                   name: "id",
                   sqlite_type: "INTEGER",
                   pg_type: %SatOpMigrate.PgColumnType{name: "int8", array: [], size: []}
                 }
               ],
               fks: [],
               pks: ["id"]
             }

      stmt = """
      CREATE TABLE teeth.front (
          id int8 PRIMARY KEY,
          frog_id int8 NOT NULL REFERENCES fish (id)
      );
      """

      schema = schema_update(schema, stmt)

      assert {:ok, [msg], [{"teeth", "front"}]} = Replication.migrate(schema, version, stmt)
      assert Schema.table_names(schema) == [~s("public"."fish"), ~s("teeth"."front")]
      assert %SatOpMigrate{version: ^version} = msg
      %{stmts: stmts, table: table} = msg

      assert stmts == [
               %SatOpMigrate.Stmt{
                 type: :CREATE_TABLE,
                 sql:
                   "CREATE TABLE \"front\" (\n  \"id\" INTEGER NOT NULL,\n  \"frog_id\" INTEGER NOT NULL,\n  CONSTRAINT \"front_frog_id_fkey\" FOREIGN KEY (\"frog_id\") REFERENCES \"fish\" (\"id\"),\n  CONSTRAINT \"front_pkey\" PRIMARY KEY (\"id\")\n) WITHOUT ROWID;\n"
               }
             ]

      assert table == %SatOpMigrate.Table{
               name: "front",
               columns: [
                 %SatOpMigrate.Column{
                   name: "id",
                   sqlite_type: "INTEGER",
                   pg_type: %SatOpMigrate.PgColumnType{name: "int8", array: [], size: []}
                 },
                 %SatOpMigrate.Column{
                   name: "frog_id",
                   sqlite_type: "INTEGER",
                   pg_type: %SatOpMigrate.PgColumnType{name: "int8", array: [], size: []}
                 }
               ],
               fks: [
                 %SatOpMigrate.ForeignKey{
                   fk_cols: ["frog_id"],
                   pk_table: "fish",
                   pk_cols: ["id"]
                 }
               ],
               pks: ["id"]
             }
    end

    test "multiple alter table cmds" do
      stmt = "CREATE TABLE public.fish (id int8 PRIMARY KEY);"
      schema = schema_update(stmt)

      version = "20230405134615"

      assert {:ok, [_msg], [{"public", "fish"}]} = Replication.migrate(schema, version, stmt)

      # there are lots of tests that validate the schema is being properly updated
      assert Schema.table_names(schema) == [~s("public"."fish")]

      stmt =
        "ALTER TABLE fish ADD COLUMN value jsonb DEFAULT '{}', ADD COLUMN ts timestamp DEFAULT current_timestamp;"

      schema = schema_update(schema, stmt)

      assert {:ok, [msg], [{"public", "fish"}]} = Replication.migrate(schema, version, stmt)

      assert %SatOpMigrate{version: ^version} = msg

      %{stmts: stmts, table: table} = msg

      assert stmts == [
               %SatOpMigrate.Stmt{
                 type: :ALTER_ADD_COLUMN,
                 sql: "ALTER TABLE \"fish\" ADD COLUMN \"value\" TEXT_JSON DEFAULT '{}';\n"
               },
               %SatOpMigrate.Stmt{
                 type: :ALTER_ADD_COLUMN,
                 sql: "ALTER TABLE \"fish\" ADD COLUMN \"ts\" TEXT DEFAULT current_timestamp;\n"
               }
             ]

      assert table == %SatOpMigrate.Table{
               name: "fish",
               columns: [
                 %SatOpMigrate.Column{
                   name: "id",
                   sqlite_type: "INTEGER",
                   pg_type: %SatOpMigrate.PgColumnType{name: "int8"}
                 },
                 %SatOpMigrate.Column{
                   name: "value",
                   sqlite_type: "TEXT_JSON",
                   pg_type: %SatOpMigrate.PgColumnType{name: "jsonb"}
                 },
                 %SatOpMigrate.Column{
                   name: "ts",
                   sqlite_type: "TEXT",
                   pg_type: %SatOpMigrate.PgColumnType{name: "timestamp"}
                 }
               ],
               fks: [],
               pks: ["id"]
             }
    end

    test "create index doesn't list tables" do
      stmt = "CREATE TABLE public.fish (id int8 PRIMARY KEY, available boolean);"
      schema = schema_update(stmt)

      version = "20230405134615"

      assert {:ok, [_msg], [{"public", "fish"}]} = Replication.migrate(schema, version, stmt)

      stmt = "CREATE INDEX fish_available_index ON public.fish (avilable);"
      schema = schema_update(schema, stmt)

      version = "20230405134616"
      assert {:ok, [msg], []} = Replication.migrate(schema, version, stmt)
      assert %SatOpMigrate{version: ^version} = msg

      %{stmts: stmts, table: table} = msg

      assert stmts == [
               %SatOpMigrate.Stmt{
                 sql: "CREATE INDEX \"fish_available_index\" ON \"fish\" (\"avilable\" ASC);\n",
                 type: :CREATE_INDEX
               }
             ]

      assert is_nil(table)
    end

    test "pg-only ddl statements don't generate a message" do
      stmts = [
        """
        CREATE SUBSCRIPTION \"postgres_2\" CONNECTION 'host=electric_1 port=5433 dbname=test connect_timeout=5000' PUBLICATION \"all_tables\" WITH (connect = false)
        """,
        """
        ALTER SUBSCRIPTION \"postgres_1\" ENABLE
        """,
        """
        ALTER SUBSCRIPTION \"postgres_1\" REFRESH PUBLICATION WITH (copy_data = false)
        """
      ]

      schema = Schema.new()
      version = "20230405134615"

      for stmt <- stmts do
        assert {:ok, [], []} = Replication.migrate(schema, version, stmt)
      end
    end

    # TODO: actually I think this is a situation we *MUST* avoid by
    # checking for unsupported migrations in the pg event trigger
    # function. by the time it reaches this point it would be too late
    # and things would be completely fubar'd
    # see: VAX-618
    # test "rejects unsupported migration types" do
    #   schema = Schema.new()

    #   stmts = [
    #     """
    #     CREATE TABLE public.fish (id int8 PRIMARY KEY, value varchar(255));
    #     ALTER TABLE fish DROP COLUMN value;
    #     """
    #   ]

    #   version = "20230405134615"

    #   assert {:error, schema} = Replication.migrate(schema, version, stmts)
    # end
  end
end
