defmodule Electric.PlugTest do
  use Electric.Extension.Case, async: false
  use Plug.Test
  use Electric.Satellite.Protobuf

  alias Electric.Postgres.{Extension, Schema}
  alias Electric.Postgres.Extension.SchemaCache

  @migrations [
    {"0001",
     [
       "CREATE TABLE a (id uuid PRIMARY KEY, value text NOT NULL); CREATE INDEX a_idx ON a (value);",
       "CREATE TABLE b (id uuid PRIMARY KEY, value text NOT NULL);"
     ]},
    {"0002", ["CREATE TABLE c (id uuid PRIMARY KEY, value text NOT NULL);"]},
    {"0003",
     [
       "CREATE TABLE d (id uuid PRIMARY KEY, value text NOT NULL);",
       "ALTER TABLE d ADD COLUMN is_valid boolean;"
     ]},
    {"0004", ["CREATE TABLE e (id uuid PRIMARY KEY, value text NOT NULL);"]}
  ]

  def oid_loader(type, schema, name) do
    {:ok, Enum.join(["#{type}", schema, name], ".") |> :erlang.phash2(50_000)}
  end

  def schema_update(schema \\ Schema.new(), cmds) do
    Schema.update(schema, cmds, oid_loader: &oid_loader/3)
  end

  def apply_migrations(conn) do
    schema =
      Enum.reduce(@migrations, Schema.new(), fn {version, stmts}, schema ->
        schema =
          Enum.reduce(stmts, schema, fn stmt, schema ->
            schema_update(schema, stmt)
          end)

        assert :ok = Extension.save_schema(conn, version, schema, stmts)
        assert :ok = save_migration_version(conn, version)
        schema
      end)

    {:ok, schema}
  end

  describe "/migrations" do
    test_tx("returns 204 if there are no migrations", fn conn ->
      {:ok, _pid} = start_supervised({SchemaCache, [__connection__: conn, origin: "postgres_1"]})

      assert {204, _, _} =
               conn(:get, "/api/migrations", %{"dialect" => "sqlite"})
               |> Electric.Plug.Router.call([])
               |> sent_resp()
    end)

    test_tx("returns migrations translated to the sqlite dialect", fn conn ->
      assert {:ok, _schema} = apply_migrations(conn)

      {:ok, _pid} = start_supervised({SchemaCache, [__connection__: conn, origin: "postgres_1"]})

      resp =
        conn(:get, "/api/migrations", %{"dialect" => "sqlite"})
        |> Electric.Plug.Router.call([])

      assert {200, _headers, body} = sent_resp(resp)
      assert ["application/zip"] = get_resp_header(resp, "content-type")

      {:ok, file_list} = :zip.extract(body, [:memory])

      assert [
               {~c"0001/migration.sql",
                "CREATE TABLE \"a\" (\n  \"id\" TEXT NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"a_pkey\" PRIMARY KEY (\"id\")\n);\n\nCREATE INDEX \"a_idx\" ON \"a\" (\"value\" ASC);\n\nCREATE TABLE \"b\" (\n  \"id\" TEXT NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"b_pkey\" PRIMARY KEY (\"id\")\n)"},
               {~c"0001/metadata.json", metadata_json_0001},
               {~c"0002/migration.sql",
                "CREATE TABLE \"c\" (\n  \"id\" TEXT NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"c_pkey\" PRIMARY KEY (\"id\")\n);"},
               {~c"0002/metadata.json", metadata_json_0002},
               {~c"0003/migration.sql",
                "CREATE TABLE \"d\" (\n  \"id\" TEXT NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"d_pkey\" PRIMARY KEY (\"id\")\n);\n\nALTER TABLE \"d\" ADD COLUMN \"is_valid\" INTEGER;"},
               {~c"0003/metadata.json", metadata_json_0003},
               {~c"0004/migration.sql",
                "CREATE TABLE \"e\" (\n  \"id\" TEXT NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"e_pkey\" PRIMARY KEY (\"id\")\n);"},
               {~c"0004/metadata.json", metadata_json_0004}
             ] = file_list

      assert {:ok,
              %{
                "format" => "SatOpMigrate",
                "ops" => [op1, _op2],
                "protocol_version" => "Electric.Satellite",
                "version" => "0001"
              }} = Jason.decode(metadata_json_0001)

      assert {:ok,
              %SatOpMigrate{
                stmts: [
                  %SatOpMigrate.Stmt{
                    type: :CREATE_TABLE,
                    sql:
                      "CREATE TABLE \"a\" (\n  \"id\" TEXT NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"a_pkey\" PRIMARY KEY (\"id\")\n)\n"
                  },
                  %SatOpMigrate.Stmt{
                    type: :CREATE_INDEX,
                    sql: "CREATE INDEX \"a_idx\" ON \"a\" (\"value\" ASC);\n"
                  }
                ],
                affected_entity:
                  {:table,
                   %SatOpMigrate.Table{
                     name: "a",
                     columns: [
                       %SatOpMigrate.Column{
                         name: "id",
                         sqlite_type: "TEXT",
                         pg_type: %SatOpMigrate.PgColumnType{name: "uuid"}
                       },
                       %SatOpMigrate.Column{
                         name: "value",
                         sqlite_type: "TEXT",
                         pg_type: %SatOpMigrate.PgColumnType{name: "text"}
                       }
                     ],
                     fks: [],
                     pks: ["id"]
                   }},
                version: "0001"
              }} = op1 |> Base.decode64!() |> SatOpMigrate.decode()

      assert {:ok, %{"ops" => [_]}} = Jason.decode(metadata_json_0002)
      assert {:ok, %{"ops" => [_, _]}} = Jason.decode(metadata_json_0003)
      assert {:ok, %{"ops" => [_]}} = Jason.decode(metadata_json_0004)
    end)

    test_tx("returns migrations translated to the postgresql dialect", fn conn ->
      assert {:ok, _schema} = apply_migrations(conn)

      {:ok, _pid} = start_supervised({SchemaCache, [__connection__: conn, origin: "postgres_1"]})

      resp =
        conn(:get, "/api/migrations", %{"dialect" => "postgresql"})
        |> Electric.Plug.Router.call([])

      assert {200, _headers, body} = sent_resp(resp)
      assert ["application/zip"] = get_resp_header(resp, "content-type")

      {:ok, file_list} = :zip.extract(body, [:memory])

      assert [
               {
                 ~c"0001/migration.sql",
                 "CREATE TABLE a (id uuid PRIMARY KEY, value text NOT NULL);\n\nCREATE INDEX a_idx ON a (value);\n\nCREATE TABLE b (id uuid PRIMARY KEY, value text NOT NULL);"
               },
               {~c"0001/metadata.json", metadata_json_0001},
               {~c"0002/migration.sql",
                "CREATE TABLE c (id uuid PRIMARY KEY, value text NOT NULL);"},
               {~c"0002/metadata.json", metadata_json_0002},
               {~c"0003/migration.sql",
                "CREATE TABLE d (id uuid PRIMARY KEY, value text NOT NULL);\n\nALTER TABLE d ADD COLUMN is_valid boolean;"},
               {~c"0003/metadata.json", metadata_json_0003},
               {~c"0004/migration.sql",
                "CREATE TABLE e (id uuid PRIMARY KEY, value text NOT NULL);"},
               {~c"0004/metadata.json", metadata_json_0004}
             ] = file_list

      assert {:ok,
              %{
                "format" => "SatOpMigrate",
                "ops" => [op1, _op2],
                "protocol_version" => "Electric.Satellite",
                "version" => "0001"
              }} = Jason.decode(metadata_json_0001)

      assert {:ok,
              %SatOpMigrate{
                stmts: [
                  %SatOpMigrate.Stmt{
                    type: :CREATE_TABLE,
                    sql: "CREATE TABLE a (id uuid PRIMARY KEY, value text NOT NULL)"
                  },
                  %SatOpMigrate.Stmt{
                    type: :CREATE_INDEX,
                    sql: "CREATE INDEX a_idx ON a (value)"
                  }
                ],
                affected_entity:
                  {:table,
                   %SatOpMigrate.Table{
                     name: "a",
                     columns: [
                       %SatOpMigrate.Column{
                         name: "id",
                         sqlite_type: "TEXT",
                         pg_type: %SatOpMigrate.PgColumnType{name: "uuid"}
                       },
                       %SatOpMigrate.Column{
                         name: "value",
                         sqlite_type: "TEXT",
                         pg_type: %SatOpMigrate.PgColumnType{name: "text"}
                       }
                     ],
                     fks: [],
                     pks: ["id"]
                   }},
                version: "0001"
              }} = op1 |> Base.decode64!() |> SatOpMigrate.decode()

      assert {:ok, %{"version" => "0002", "ops" => [_]}} = Jason.decode(metadata_json_0002)
      assert {:ok, %{"version" => "0003", "ops" => [_, _]}} = Jason.decode(metadata_json_0003)
      assert {:ok, %{"version" => "0004", "ops" => [_]}} = Jason.decode(metadata_json_0004)
    end)

    test_tx("can return migrations after a certain point", fn conn ->
      assert {:ok, _schema} = apply_migrations(conn)

      {:ok, _pid} = start_supervised({SchemaCache, [__connection__: conn, origin: "postgres_1"]})

      resp =
        conn(:get, "/api/migrations", %{"dialect" => "sqlite", "version" => "0002"})
        |> Electric.Plug.Router.call([])

      assert {200, _headers, body} = sent_resp(resp)
      assert ["application/zip"] = get_resp_header(resp, "content-type")

      {:ok, file_list} = :zip.extract(body, [:memory])

      assert [
               {~c"0003/migration.sql",
                "CREATE TABLE \"d\" (\n  \"id\" TEXT NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"d_pkey\" PRIMARY KEY (\"id\")\n)\n\nALTER TABLE \"d\" ADD COLUMN \"is_valid\" INTEGER;"},
               {~c"0003/metadata.json", metadata_json_0003},
               {~c"0004/migration.sql",
                "CREATE TABLE \"e\" (\n  \"id\" TEXT NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"e_pkey\" PRIMARY KEY (\"id\")\n)"},
               {~c"0004/metadata.json", metadata_json_0004}
             ] = file_list

      assert %{
               "format" => "SatOpMigrate",
               "ops" => [_create_table, _alter_table],
               "protocol_version" => "Electric.Satellite",
               "version" => "0003"
             } = Jason.decode!(metadata_json_0003)

      assert %{
               "format" => "SatOpMigrate",
               "ops" => [_create_table],
               "protocol_version" => "Electric.Satellite",
               "version" => "0004"
             } = Jason.decode!(metadata_json_0004)
    end)

    test "returns error if dialect missing", _cxt do
      for params <- [%{}, %{"dialect" => "invalid"}] do
        assert {403, _, _} =
                 conn(:get, "/api/migrations", params)
                 |> Electric.Plug.Router.call([])
                 |> sent_resp()
      end
    end

    test_tx("returns 204 if there are no new migrations after a given version", fn conn ->
      assert {:ok, _schema} = apply_migrations(conn)
      {:ok, _pid} = start_supervised({SchemaCache, [__connection__: conn, origin: "postgres_1"]})

      assert {204, _, _} =
               conn(:get, "/api/migrations", %{"dialect" => "sqlite", "version" => "0004"})
               |> Electric.Plug.Router.call([])
               |> sent_resp()
    end)
  end
end
