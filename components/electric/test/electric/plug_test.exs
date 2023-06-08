defmodule Electric.PlugTest do
  use ExUnit.Case, async: false
  use Plug.Test

  alias Electric.Postgres.{Extension, Schema}
  alias Electric.Postgres.Extension.SchemaCache

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

  def migrate(conn) do
    assert {:ok, [2023_03_28_11_39_27, 2023_04_24_15_44_25]} = Extension.migrate(conn)
  end

  @migrations [
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

  setup do
    pg_config = Electric.Postgres.TestConnection.config()

    {:ok, conn} = start_supervised(Electric.Postgres.TestConnection.childspec(pg_config))

    {:ok, conn: conn}
  end

  def oid_loader(type, schema, name) do
    {:ok, Enum.join(["#{type}", schema, name], ".") |> :erlang.phash2(50_000)}
  end

  def schema_update(schema \\ Schema.new(), cmds) do
    Schema.update(schema, cmds, oid_loader: &oid_loader/3)
  end

  def apply_migrations(conn) do
    migrate(conn)

    schema =
      Enum.reduce(@migrations, Schema.new(), fn {version, stmts}, schema ->
        schema =
          Enum.reduce(stmts, schema, fn stmt, schema ->
            schema_update(schema, stmt)
          end)

        assert :ok = Extension.save_schema(conn, version, schema, stmts)
        schema
      end)

    {:ok, schema}
  end

  describe "/migrations" do
    test "returns migrations translated to given dialect", cxt do
      tx(
        fn conn ->
          assert {:ok, _schema} = apply_migrations(conn)

          {:ok, _pid} =
            start_supervised({SchemaCache, [__connection__: conn, origin: "postgres_1"]})

          resp =
            conn(:get, "/api/migrations", %{"dialect" => "sqlite"})
            |> Electric.Plug.Router.call([])

          assert {200, _headers, body} = sent_resp(resp)
          assert ["application/zip"] = get_resp_header(resp, "content-type")

          {:ok, file_list} = :zip.extract(body, [:memory])

          assert file_list == [
                   {'0001/migration.sql',
                    "CREATE TABLE \"a\" (\n  \"id\" BLOB NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"a_pkey\" PRIMARY KEY (\"id\")\n) WITHOUT ROWID;\n\n\nCREATE TABLE \"b\" (\n  \"id\" BLOB NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"b_pkey\" PRIMARY KEY (\"id\")\n) WITHOUT ROWID;\n\n\nCREATE INDEX \"a_idx\" ON \"a\" (\"value\" ASC);\n"},
                   {'0002/migration.sql',
                    "CREATE TABLE \"c\" (\n  \"id\" BLOB NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"c_pkey\" PRIMARY KEY (\"id\")\n) WITHOUT ROWID;\n"},
                   {'0003/migration.sql',
                    "CREATE TABLE \"d\" (\n  \"id\" BLOB NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"d_pkey\" PRIMARY KEY (\"id\")\n) WITHOUT ROWID;\n"},
                   {'0004/migration.sql',
                    "CREATE TABLE \"e\" (\n  \"id\" BLOB NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"e_pkey\" PRIMARY KEY (\"id\")\n) WITHOUT ROWID;\n"}
                 ]
        end,
        cxt
      )
    end

    test "can return migrations after a certain point", cxt do
      tx(
        fn conn ->
          assert {:ok, _schema} = apply_migrations(conn)

          {:ok, _pid} =
            start_supervised({SchemaCache, [__connection__: conn, origin: "postgres_1"]})

          resp =
            conn(:get, "/api/migrations", %{"dialect" => "sqlite", "version" => "0002"})
            |> Electric.Plug.Router.call([])

          assert {200, _headers, body} = sent_resp(resp)
          assert ["application/zip"] = get_resp_header(resp, "content-type")

          {:ok, file_list} = :zip.extract(body, [:memory])

          assert file_list == [
                   {'0003/migration.sql',
                    "CREATE TABLE \"d\" (\n  \"id\" BLOB NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"d_pkey\" PRIMARY KEY (\"id\")\n) WITHOUT ROWID;\n"},
                   {'0004/migration.sql',
                    "CREATE TABLE \"e\" (\n  \"id\" BLOB NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"e_pkey\" PRIMARY KEY (\"id\")\n) WITHOUT ROWID;\n"}
                 ]
        end,
        cxt
      )
    end

    test "returns error if dialect missing", _cxt do
      for params <- [%{}, %{"dialect" => "invalid"}] do
        assert {403, _, _} =
                 conn(:get, "/api/migrations", params)
                 |> Electric.Plug.Router.call([])
                 |> sent_resp()
      end
    end
  end
end
