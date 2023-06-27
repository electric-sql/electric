defmodule Electric.PlugTest do
  use Electric.Extension.Case, async: false
  use Plug.Test
  use Electric.Satellite.Protobuf

  alias Electric.Postgres.{Extension, Schema}
  alias Electric.Postgres.Extension.SchemaCache

  @migrations [
    {"0001",
     [
       "CREATE TABLE a (id uuid PRIMARY KEY, value text NOT NULL);",
       "CREATE TABLE b (id uuid PRIMARY KEY, value text NOT NULL);",
       "CREATE INDEX a_idx ON a (value);"
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
        schema
      end)

    {:ok, schema}
  end

  describe "/migrations" do
    test_tx("returns migrations translated to given dialect", fn conn ->
      assert {:ok, _schema} = apply_migrations(conn)

      {:ok, _pid} = start_supervised({SchemaCache, [__connection__: conn, origin: "postgres_1"]})

      resp =
        conn(:get, "/api/migrations", %{"dialect" => "sqlite"})
        |> Electric.Plug.Router.call([])

      assert {200, _headers, body} = sent_resp(resp)
      assert ["application/zip"] = get_resp_header(resp, "content-type")

      {:ok, file_list} = :zip.extract(body, [:memory])

      assert file_list == [
               {'0001/migration.sql',
                "CREATE TABLE \"a\" (\n  \"id\" BLOB NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"a_pkey\" PRIMARY KEY (\"id\")\n) WITHOUT ROWID;\n\n\nCREATE TABLE \"b\" (\n  \"id\" BLOB NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"b_pkey\" PRIMARY KEY (\"id\")\n) WITHOUT ROWID;\n\n\nCREATE INDEX \"a_idx\" ON \"a\" (\"value\" ASC);\n"},
               {
                 '0001/metadata.json',
                 "{\"format\":\"SatOpMigrate\",\"ops\":[\"GjIKAWESEgoCaWQSBEJMT0IaBgoEdXVpZBIVCgV2YWx1ZRIEVEVYVBoGCgR0ZXh0IgJpZAoEMDAwMRJ+EnxDUkVBVEUgVEFCTEUgImEiICgKICAiaWQiIEJMT0IgTk9UIE5VTEwsCiAgInZhbHVlIiBURVhUIE5PVCBOVUxMLAogIENPTlNUUkFJTlQgImFfcGtleSIgUFJJTUFSWSBLRVkgKCJpZCIpCikgV0lUSE9VVCBST1dJRDsK\",\"GjIKAWISEgoCaWQSBEJMT0IaBgoEdXVpZBIVCgV2YWx1ZRIEVEVYVBoGCgR0ZXh0IgJpZAoEMDAwMRJ+EnxDUkVBVEUgVEFCTEUgImIiICgKICAiaWQiIEJMT0IgTk9UIE5VTEwsCiAgInZhbHVlIiBURVhUIE5PVCBOVUxMLAogIENPTlNUUkFJTlQgImJfcGtleSIgUFJJTUFSWSBLRVkgKCJpZCIpCikgV0lUSE9VVCBST1dJRDsK\",\"CgQwMDAxEi8IARIrQ1JFQVRFIElOREVYICJhX2lkeCIgT04gImEiICgidmFsdWUiIEFTQyk7Cg==\"],\"protocol_version\":\"Electric.Satellite.v1_4\",\"version\":\"0001\"}"
               },
               {'0002/migration.sql',
                "CREATE TABLE \"c\" (\n  \"id\" BLOB NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"c_pkey\" PRIMARY KEY (\"id\")\n) WITHOUT ROWID;\n"},
               {
                 '0002/metadata.json',
                 "{\"format\":\"SatOpMigrate\",\"ops\":[\"GjIKAWMSEgoCaWQSBEJMT0IaBgoEdXVpZBIVCgV2YWx1ZRIEVEVYVBoGCgR0ZXh0IgJpZAoEMDAwMhJ+EnxDUkVBVEUgVEFCTEUgImMiICgKICAiaWQiIEJMT0IgTk9UIE5VTEwsCiAgInZhbHVlIiBURVhUIE5PVCBOVUxMLAogIENPTlNUUkFJTlQgImNfcGtleSIgUFJJTUFSWSBLRVkgKCJpZCIpCikgV0lUSE9VVCBST1dJRDsK\"],\"protocol_version\":\"Electric.Satellite.v1_4\",\"version\":\"0002\"}"
               },
               {'0003/migration.sql',
                "CREATE TABLE \"d\" (\n  \"id\" BLOB NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"d_pkey\" PRIMARY KEY (\"id\")\n) WITHOUT ROWID;\n\n\nALTER TABLE \"d\" ADD COLUMN \"is_valid\" INTEGER;\n"},
               {
                 '0003/metadata.json',
                 "{\"format\":\"SatOpMigrate\",\"ops\":[\"Gk8KAWQSEgoCaWQSBEJMT0IaBgoEdXVpZBIVCgV2YWx1ZRIEVEVYVBoGCgR0ZXh0EhsKCGlzX3ZhbGlkEgdJTlRFR0VSGgYKBGJvb2wiAmlkCgQwMDAzEn4SfENSRUFURSBUQUJMRSAiZCIgKAogICJpZCIgQkxPQiBOT1QgTlVMTCwKICAidmFsdWUiIFRFWFQgTk9UIE5VTEwsCiAgQ09OU1RSQUlOVCAiZF9wa2V5IiBQUklNQVJZIEtFWSAoImlkIikKKSBXSVRIT1VUIFJPV0lEOwo=\",\"Gk8KAWQSEgoCaWQSBEJMT0IaBgoEdXVpZBIVCgV2YWx1ZRIEVEVYVBoGCgR0ZXh0EhsKCGlzX3ZhbGlkEgdJTlRFR0VSGgYKBGJvb2wiAmlkCgQwMDAzEjMIBhIvQUxURVIgVEFCTEUgImQiIEFERCBDT0xVTU4gImlzX3ZhbGlkIiBJTlRFR0VSOwo=\"],\"protocol_version\":\"Electric.Satellite.v1_4\",\"version\":\"0003\"}"
               },
               {'0004/migration.sql',
                "CREATE TABLE \"e\" (\n  \"id\" BLOB NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"e_pkey\" PRIMARY KEY (\"id\")\n) WITHOUT ROWID;\n"},
               {
                 '0004/metadata.json',
                 "{\"format\":\"SatOpMigrate\",\"ops\":[\"GjIKAWUSEgoCaWQSBEJMT0IaBgoEdXVpZBIVCgV2YWx1ZRIEVEVYVBoGCgR0ZXh0IgJpZAoEMDAwNBJ+EnxDUkVBVEUgVEFCTEUgImUiICgKICAiaWQiIEJMT0IgTk9UIE5VTEwsCiAgInZhbHVlIiBURVhUIE5PVCBOVUxMLAogIENPTlNUUkFJTlQgImVfcGtleSIgUFJJTUFSWSBLRVkgKCJpZCIpCikgV0lUSE9VVCBST1dJRDsK\"],\"protocol_version\":\"Electric.Satellite.v1_4\",\"version\":\"0004\"}"
               }
             ]

      assert {'0001/metadata.json', json} = List.keyfind(file_list, '0001/metadata.json', 0)

      assert {:ok,
              %{
                "format" => "SatOpMigrate",
                "ops" => [op1, _op2, _op3],
                "protocol_version" => "Electric.Satellite.v1_4",
                "version" => "0001"
              }} = Jason.decode(json)

      assert {:ok,
              %SatOpMigrate{
                stmts: [
                  %SatOpMigrate.Stmt{
                    type: :CREATE_TABLE,
                    sql:
                      "CREATE TABLE \"a\" (\n  \"id\" BLOB NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"a_pkey\" PRIMARY KEY (\"id\")\n) WITHOUT ROWID;\n"
                  }
                ],
                table: %SatOpMigrate.Table{
                  name: "a",
                  columns: [
                    %SatOpMigrate.Column{
                      name: "id",
                      sqlite_type: "BLOB",
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
                },
                version: "0001"
              }} = op1 |> Base.decode64!() |> SatOpMigrate.decode()

      assert {'0002/metadata.json', json} = List.keyfind(file_list, '0002/metadata.json', 0)

      assert {:ok, %{"ops" => [_]}} = Jason.decode(json)

      assert {'0003/metadata.json', json} = List.keyfind(file_list, '0003/metadata.json', 0)

      assert {:ok, %{"ops" => [_, _]}} = Jason.decode(json)

      assert {'0004/metadata.json', json} = List.keyfind(file_list, '0004/metadata.json', 0)

      assert {:ok, %{"ops" => [_]}} = Jason.decode(json)
    end

    test_tx("can return migrations after a certain point", fn conn ->
      assert {:ok, _schema} = apply_migrations(conn)

      {:ok, _pid} = start_supervised({SchemaCache, [__connection__: conn, origin: "postgres_1"]})

      resp =
        conn(:get, "/api/migrations", %{"dialect" => "sqlite", "version" => "0002"})
        |> Electric.Plug.Router.call([])

      assert {200, _headers, body} = sent_resp(resp)
      assert ["application/zip"] = get_resp_header(resp, "content-type")

      {:ok, file_list} = :zip.extract(body, [:memory])

      assert file_list == [
               {'0003/migration.sql',
                "CREATE TABLE \"d\" (\n  \"id\" BLOB NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"d_pkey\" PRIMARY KEY (\"id\")\n) WITHOUT ROWID;\n\n\nALTER TABLE \"d\" ADD COLUMN \"is_valid\" INTEGER;\n"},
               {
                 '0003/metadata.json',
                 "{\"format\":\"SatOpMigrate\",\"ops\":[\"Gk8KAWQSEgoCaWQSBEJMT0IaBgoEdXVpZBIVCgV2YWx1ZRIEVEVYVBoGCgR0ZXh0EhsKCGlzX3ZhbGlkEgdJTlRFR0VSGgYKBGJvb2wiAmlkCgQwMDAzEn4SfENSRUFURSBUQUJMRSAiZCIgKAogICJpZCIgQkxPQiBOT1QgTlVMTCwKICAidmFsdWUiIFRFWFQgTk9UIE5VTEwsCiAgQ09OU1RSQUlOVCAiZF9wa2V5IiBQUklNQVJZIEtFWSAoImlkIikKKSBXSVRIT1VUIFJPV0lEOwo=\",\"Gk8KAWQSEgoCaWQSBEJMT0IaBgoEdXVpZBIVCgV2YWx1ZRIEVEVYVBoGCgR0ZXh0EhsKCGlzX3ZhbGlkEgdJTlRFR0VSGgYKBGJvb2wiAmlkCgQwMDAzEjMIBhIvQUxURVIgVEFCTEUgImQiIEFERCBDT0xVTU4gImlzX3ZhbGlkIiBJTlRFR0VSOwo=\"],\"protocol_version\":\"Electric.Satellite.v1_4\",\"version\":\"0003\"}"
               },
               {'0004/migration.sql',
                "CREATE TABLE \"e\" (\n  \"id\" BLOB NOT NULL,\n  \"value\" TEXT NOT NULL,\n  CONSTRAINT \"e_pkey\" PRIMARY KEY (\"id\")\n) WITHOUT ROWID;\n"},
               {
                 '0004/metadata.json',
                 "{\"format\":\"SatOpMigrate\",\"ops\":[\"GjIKAWUSEgoCaWQSBEJMT0IaBgoEdXVpZBIVCgV2YWx1ZRIEVEVYVBoGCgR0ZXh0IgJpZAoEMDAwNBJ+EnxDUkVBVEUgVEFCTEUgImUiICgKICAiaWQiIEJMT0IgTk9UIE5VTEwsCiAgInZhbHVlIiBURVhUIE5PVCBOVUxMLAogIENPTlNUUkFJTlQgImVfcGtleSIgUFJJTUFSWSBLRVkgKCJpZCIpCikgV0lUSE9VVCBST1dJRDsK\"],\"protocol_version\":\"Electric.Satellite.v1_4\",\"version\":\"0004\"}"
               }
             ]
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
