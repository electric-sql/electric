defmodule Electric.Satellite.SerializationTest do
  alias Electric.Satellite.Serialization

  use Electric.Satellite.Protobuf
  use ExUnit.Case, async: true

  alias Electric.Replication.Changes.Transaction

  alias Electric.Postgres.{Lsn, Schema, Extension.SchemaCache}

  test "test row serialization" do
    data = %{"not_null" => <<"4">>, "null" => nil, "not_present" => <<"some other value">>}
    columns = ["null", "this_columns_is_empty", "not_null"]

    serialized_data = Serialization.map_to_row(data, columns)

    expected = %SatOpRow{
      nulls_bitmask: <<1::1, 1::1, 0::1, 0::5>>,
      values: [<<>>, <<>>, <<"4">>]
    }

    assert serialized_data == expected
  end

  test "test row deserialization" do
    deserialized_data =
      Serialization.row_to_map(
        ["null", "this_columns_is_empty", "not_null"],
        %SatOpRow{nulls_bitmask: <<1::1, 1::1, 0::1, 0::5>>, values: [<<>>, <<>>, <<"4">>]}
      )

    expected = %{"not_null" => <<"4">>, "null" => nil, "this_columns_is_empty" => nil}

    assert deserialized_data == expected
  end

  test "test row deserialization with long bitmask" do
    mask = <<0b1101000010000000::16>>

    deserialized_data =
      Serialization.row_to_map(
        Enum.map(0..8, &"bit#{&1}"),
        %SatOpRow{nulls_bitmask: mask, values: Enum.map(0..8, fn _ -> "" end)}
      )

    expected = %{
      "bit0" => nil,
      "bit1" => nil,
      "bit2" => "",
      "bit3" => nil,
      "bit4" => "",
      "bit5" => "",
      "bit6" => "",
      "bit7" => "",
      "bit8" => nil
    }

    assert deserialized_data == expected
  end

  test "test row serialization 2" do
    data = %{
      "content" => "hello from pg_1",
      "content_text_null" => nil,
      "content_text_null_default" => "",
      "id" => "f989b58b-980d-4d3c-b178-adb6ae8222f1",
      "intvalue_null" => nil,
      "intvalue_null_default" => "10"
    }

    columns = [
      "id",
      "content",
      "content_text_null",
      "content_text_null_default",
      "intvalue_null",
      "intvalue_null_default"
    ]

    serialized_data = Serialization.map_to_row(data, columns)

    expected = %SatOpRow{
      nulls_bitmask: <<0::1, 0::1, 1::1, 0::1, 1::1, 0::3>>,
      values: ["f989b58b-980d-4d3c-b178-adb6ae8222f1", "hello from pg_1", "", "", "", "10"]
    }

    assert serialized_data == expected
  end

  describe "relations" do
    test "correctly set the pk flag" do
      table = %{
        schema: "something",
        name: "rotten",
        oid: 2234,
        primary_keys: ["id1", "id2"]
      }

      columns = [
        %{name: "id1", type: :uuid, type_modifier: nil, part_of_identity: true},
        %{name: "id2", type: :uuid, type_modifier: nil, part_of_identity: true},
        %{name: "content", type: :char, type_modifier: nil, part_of_identity: true}
      ]

      msg = Serialization.serialize_relation(table, columns)

      assert %SatRelation{
               schema_name: "something",
               table_type: :TABLE,
               table_name: "rotten",
               relation_id: 2234,
               columns: [
                 %SatRelationColumn{
                   name: "id1",
                   type: "uuid",
                   primaryKey: true
                 },
                 %SatRelationColumn{
                   name: "id2",
                   type: "uuid",
                   primaryKey: true
                 },
                 %SatRelationColumn{
                   name: "content",
                   type: "char",
                   primaryKey: false
                 }
               ]
             } = msg
    end
  end

  describe "migrations" do
    setup do
      origin = "postgres_1"

      {:ok, _pid} =
        start_supervised(
          {SchemaCache,
           {[origin: origin], [backend: {Electric.Postgres.MockSchemaLoader, parent: self()}]}}
        )

      {:ok, origin: origin}
    end

    def oid_loader(type, schema, name) do
      {:ok, Enum.join(["#{type}", schema, name], ".") |> :erlang.phash2(50_000)}
    end

    def schema_update(schema \\ Schema.new(), cmds) do
      Schema.update(schema, cmds, oid_loader: &oid_loader/3)
    end

    defp migrate_schema(tx, version, cxt) do
      schema =
        Enum.reduce(tx.changes, Schema.new(), fn
          %{relation: {"electric", "ddl_commands"}, record: %{"query" => sql}}, schema ->
            schema_update(schema, sql)

          _op, schema ->
            schema
        end)

      assert {:ok, _} = SchemaCache.save(cxt.origin, version, schema)

      tx
    end

    test "writes to electric ddl table are recognised as migration ops", cxt do
      version = "20220421"

      tx = %Transaction{
        changes: [
          %Electric.Replication.Changes.UpdatedRecord{
            relation: {"electric", "ddl_commands"},
            old_record: nil,
            record: %{
              "id" => "6",
              "query" => "create table something_else (id uuid primary key);",
              "txid" => "749",
              "txts" => "2023-04-20 19:41:56.236357+00",
              "version" => version
            },
            tags: ["postgres_1@1682019749178"]
          },
          %Electric.Replication.Changes.UpdatedRecord{
            relation: {"electric", "ddl_commands"},
            old_record: nil,
            record: %{
              "id" => "7",
              "query" => "create table other_thing (id uuid primary key);",
              "txid" => "749",
              "txts" => "2023-04-20 19:41:56.236357+00",
              "version" => version
            },
            tags: ["postgres_1@1682019749178"]
          },
          %Electric.Replication.Changes.UpdatedRecord{
            relation: {"electric", "ddl_commands"},
            old_record: nil,
            record: %{
              "id" => "8",
              "query" => "create table yet_another_thing (id uuid primary key);",
              "txid" => "749",
              "txts" => "2023-04-20 19:41:56.236357+00",
              "version" => version
            },
            tags: ["postgres_1@1682019749178"]
          },
          %Electric.Replication.Changes.UpdatedRecord{
            relation: {"electric", "migration_versions"},
            old_record: nil,
            record: %{
              "txid" => "749",
              "txts" => "2023-04-20 19:41:56.236357+00",
              "version" => version
            },
            tags: ["postgres_1@1682019749178"]
          }
        ],
        commit_timestamp: ~U[2023-04-20 14:05:31.416063Z],
        origin: cxt.origin,
        publication: "all_tables",
        lsn: %Lsn{segment: 0, offset: 0},
        origin_type: :postgresql
      }

      migrate_schema(tx, version, cxt)

      {oplog, [], %{}} = Serialization.serialize_trans(tx, 1, %{})

      assert [%SatOpLog{ops: ops}] = oplog

      assert [
               %SatTransOp{op: {:begin, %SatOpBegin{is_migration: true}}},
               %SatTransOp{op: {:migrate, %SatOpMigrate{} = migration1}},
               %SatTransOp{op: {:migrate, %SatOpMigrate{} = migration2}},
               %SatTransOp{op: {:migrate, %SatOpMigrate{} = migration3}},
               %SatTransOp{op: {:commit, %SatOpCommit{}}}
             ] = ops

      assert %SatOpMigrate{
               stmts: [
                 %SatOpMigrate.Stmt{type: :CREATE_TABLE, sql: sql1}
               ],
               table: %SatOpMigrate.Table{
                 name: "something_else",
                 columns: [%SatOpMigrate.Column{name: "id", sqlite_type: "BLOB"}],
                 fks: [],
                 pks: ["id"]
               }
             } = migration1

      assert sql1 =~ ~r/^CREATE TABLE "something_else"/

      assert %SatOpMigrate{
               stmts: [
                 %SatOpMigrate.Stmt{type: :CREATE_TABLE, sql: sql2}
               ],
               table: %SatOpMigrate.Table{
                 name: "other_thing",
                 columns: [%SatOpMigrate.Column{name: "id", sqlite_type: "BLOB"}],
                 fks: [],
                 pks: ["id"]
               }
             } = migration2

      assert sql2 =~ ~r/^CREATE TABLE "other_thing"/

      assert %SatOpMigrate{
               stmts: [
                 %SatOpMigrate.Stmt{type: :CREATE_TABLE, sql: sql3}
               ],
               table: %SatOpMigrate.Table{
                 name: "yet_another_thing",
                 columns: [%SatOpMigrate.Column{name: "id", sqlite_type: "BLOB"}],
                 fks: [],
                 pks: ["id"]
               }
             } = migration3

      assert sql3 =~ ~r/^CREATE TABLE "yet_another_thing"/
    end

    test "pg-only migrations are not serialized", cxt do
      version = "20220421"

      tx = %Transaction{
        changes: [
          %Electric.Replication.Changes.UpdatedRecord{
            relation: {"electric", "ddl_commands"},
            old_record: nil,
            record: %{
              "id" => "6",
              "query" =>
                "CREATE SUBSCRIPTION \"postgres_2\" CONNECTION 'host=electric_1 port=5433 dbname=test connect_timeout=5000' PUBLICATION \"all_tables\" WITH (connect = false)",
              "txid" => "749",
              "txts" => "2023-04-20 19:41:56.236357+00",
              "version" => version
            },
            tags: ["postgres_1@1682019749178"]
          },
          %Electric.Replication.Changes.UpdatedRecord{
            relation: {"electric", "ddl_commands"},
            old_record: nil,
            record: %{
              "id" => "7",
              "query" => "ALTER SUBSCRIPTION \"postgres_1\" ENABLE",
              "txid" => "749",
              "txts" => "2023-04-20 19:41:56.236357+00",
              "version" => version
            },
            tags: ["postgres_1@1682019749178"]
          },
          %Electric.Replication.Changes.UpdatedRecord{
            relation: {"electric", "ddl_commands"},
            old_record: nil,
            record: %{
              "id" => "8",
              "query" =>
                "ALTER SUBSCRIPTION \"postgres_1\" REFRESH PUBLICATION WITH (copy_data = false)",
              "txid" => "749",
              "txts" => "2023-04-20 19:41:56.236357+00",
              "version" => version
            },
            tags: ["postgres_1@1682019749178"]
          },
          %Electric.Replication.Changes.UpdatedRecord{
            relation: {"electric", "migration_versions"},
            old_record: nil,
            record: %{
              "txid" => "749",
              "txts" => "2023-04-20 19:41:56.236357+00",
              "version" => version
            },
            tags: ["postgres_1@1682019749178"]
          }
        ],
        commit_timestamp: ~U[2023-04-20 14:05:31.416063Z],
        origin: cxt.origin,
        publication: "all_tables",
        lsn: %Lsn{segment: 0, offset: 0},
        origin_type: :postgresql
      }

      migrate_schema(tx, version, cxt)

      {oplog, [], %{}} = Serialization.serialize_trans(tx, 1, %{})

      assert [] == oplog
    end

    test "writes to tables in electric schema are not serialized", cxt do
      version = "20220421"

      tx = %Transaction{
        changes: [
          %Electric.Replication.Changes.UpdatedRecord{
            relation: {"electric", "schema"},
            old_record: nil,
            record: %{
              "id" => "6",
              "txid" => "749",
              "txts" => "2023-04-20 19:41:56.236357+00",
              "version" => version
            },
            tags: ["postgres_1@1682019749178"]
          },
          %Electric.Replication.Changes.UpdatedRecord{
            relation: {"electric", "something"},
            old_record: nil,
            record: %{
              "id" => "7",
              "query" => "ALTER SUBSCRIPTION \"postgres_1\" ENABLE",
              "txid" => "749",
              "txts" => "2023-04-20 19:41:56.236357+00",
              "version" => version
            },
            tags: ["postgres_1@1682019749178"]
          },
          %Electric.Replication.Changes.UpdatedRecord{
            relation: {"electric", "schema_migrations"},
            old_record: nil,
            record: %{
              "id" => "8",
              "query" =>
                "ALTER SUBSCRIPTION \"postgres_1\" REFRESH PUBLICATION WITH (copy_data = false)",
              "txid" => "749",
              "txts" => "2023-04-20 19:41:56.236357+00",
              "version" => version
            },
            tags: ["postgres_1@1682019749178"]
          }
        ],
        commit_timestamp: ~U[2023-04-20 14:05:31.416063Z],
        origin: cxt.origin,
        publication: "all_tables",
        lsn: %Lsn{segment: 0, offset: 0},
        origin_type: :postgresql
      }

      migrate_schema(tx, version, cxt)

      {oplog, [], %{}} = Serialization.serialize_trans(tx, 1, %{})

      assert [] = oplog
    end
  end
end
