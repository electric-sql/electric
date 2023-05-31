defmodule Electric.Postgres.ExtensionTest do
  use ExUnit.Case, async: false

  alias Electric.Postgres.Schema

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

  alias Ecto.Adapter.Schema
  alias Electric.Postgres.{Extension, Schema}

  setup do
    pg_config = Electric.Postgres.TestConnection.config()

    {:ok, conn} = start_supervised(Electric.Postgres.TestConnection.childspec(pg_config))

    {:ok, conn: conn}
  end

  defmodule RollbackError do
    # use a special error to abort the transaction so we can be sure that some other problem isn't
    # happening in the tx and being swallowed
    defexception [:message]
  end

  def tx(fun, cxt) do
    assert_raise RollbackError, fn ->
      :epgsql.with_transaction(
        cxt.conn,
        fn tx ->
          fun.(tx)
          raise RollbackError, message: "rollback"
        end,
        reraise: true
      )
    end
  end

  def migrate(conn, _cxt, migration_module) do
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
        {:ok, rows} = migrate(conn, cxt, MigrationsV1)
        # FIXME: we no longer need the electric.migrations table 
        assert rows == [["migrations"], ["schema_migrations"], ["things"]]
        {:ok, rows} = migrate(conn, cxt, MigrationsV2)
        assert rows == [["migrations"], ["other_things"], ["schema_migrations"], ["things"]]
        {:ok, rows} = migrate(conn, cxt, MigrationsV3)
        assert rows == [["migrations"], ["schema_migrations"], ["things"]]
      end,
      cxt
    )
  end

  test "default migrations are valid", cxt do
    tx(
      fn conn ->
        {:ok, [2023_03_28_11_39_27]} = Extension.migrate(conn)
      end,
      cxt
    )
  end

  test "we can retrieve and set the current schema json", cxt do
    tx(
      fn conn ->
        {:ok, [2023_03_28_11_39_27]} = Extension.migrate(conn)

        assert {:ok, nil, %Schema.Proto.Schema{tables: []}} = Extension.current_schema(conn)
        schema = Schema.new()
        version = "20230405171534_1"

        schema =
          schema_update(
            schema,
            Electric.Postgres.parse!("CREATE TABLE first (id uuid PRIMARY KEY);")
          )

        assert :ok = Extension.save_schema(conn, version, schema)
        assert {:ok, ^version, ^schema} = Extension.current_schema(conn)

        schema =
          schema_update(
            schema,
            Electric.Postgres.parse!("ALTER TABLE first ADD value text;")
          )

        version = "20230405171534_2"
        assert :ok = Extension.save_schema(conn, version, schema)
        assert {:ok, ^version, ^schema} = Extension.current_schema(conn)
      end,
      cxt
    )
  end

  test "we can retrieve the schema for a given version", cxt do
    tx(
      fn conn ->
        {:ok, [2023_03_28_11_39_27]} = Extension.migrate(conn)

        assert {:ok, nil, %Schema.Proto.Schema{tables: []}} = Extension.current_schema(conn)
        schema = Schema.new()
        version = "20230405171534_1"

        schema =
          schema_update(
            schema,
            Electric.Postgres.parse!("CREATE TABLE first (id uuid PRIMARY KEY);")
          )

        assert :ok = Extension.save_schema(conn, version, schema)
        assert {:ok, ^version, ^schema} = Extension.current_schema(conn)
        assert {:ok, ^version, ^schema} = Extension.schema_version(conn, version)

        schema =
          schema_update(
            schema,
            Electric.Postgres.parse!("ALTER TABLE first ADD value text;")
          )

        version = "20230405171534_2"
        assert :ok = Extension.save_schema(conn, version, schema)
        assert {:ok, ^version, ^schema} = Extension.current_schema(conn)
        assert {:ok, ^version, ^schema} = Extension.schema_version(conn, version)
      end,
      cxt
    )
  end

  test "migration capture", cxt do
    tx(
      fn conn ->
        {:ok, [2023_03_28_11_39_27]} = Extension.migrate(conn)

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
        {:ok, [2023_03_28_11_39_27]} = Extension.migrate(conn)

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
end
