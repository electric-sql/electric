defmodule Electric.Satellite.SerializationTest do
  use ExUnit.Case, async: true

  use Electric.Satellite.Protobuf

  alias Electric.Postgres.{Lsn, Schema, Extension.SchemaCache}
  alias Electric.Replication.Changes.Transaction
  alias Electric.Satellite.Serialization

  describe "map_to_row" do
    test "encodes a map into a SatOpRow struct" do
      uuid = Electric.Utils.uuid4()

      data = %{
        "not_null" => "4",
        "null" => nil,
        "not_present" => "some other value",
        "int" => "13",
        "var" => "...",
        "real" => "-3.14",
        "id" => uuid,
        "bytes" => <<0xFF, 0xA0, 0x01>>
      }

      columns = [
        %{name: "null", type: :text},
        %{name: "this_columns_is_empty", type: :text},
        %{name: "not_null", type: :text},
        %{name: "id", type: :uuid},
        %{name: "int", type: :int4},
        %{name: "var", type: :varchar},
        %{name: "real", type: :float8},
        %{name: "bytes", type: :bytea}
      ]

      assert %SatOpRow{
               values: [
                 "",
                 "",
                 "4",
                 uuid,
                 "13",
                 "...",
                 "-3.14",
                 <<0xFF, 0xA0, 0x01>>
               ],
               nulls_bitmask: <<0b11000000>>
             } == Serialization.map_to_row(data, columns)
    end

    test "converts the +00 offset to Z in timestamptz values" do
      data = %{
        "t1" => "2023-08-14 14:01:28.848242+00",
        "t2" => "2023-08-14 10:01:28+00",
        "t3" => "2023-08-13 18:30:00.123+00"
      }

      columns = [
        %{name: "t1", type: :timestamptz},
        %{name: "t2", type: :timestamptz},
        %{name: "t3", type: :timestamptz}
      ]

      assert %SatOpRow{
               values: [
                 "2023-08-14 14:01:28.848242Z",
                 "2023-08-14 10:01:28Z",
                 "2023-08-13 18:30:00.123Z"
               ],
               nulls_bitmask: <<0>>
             } == Serialization.map_to_row(data, columns)
    end
  end

  describe "decode_record" do
    test "decodes a SatOpRow struct into a map" do
      row = %SatOpRow{
        nulls_bitmask: <<0b00100001, 0>>,
        values: [
          "256",
          "hello",
          "",
          "5.4",
          "-1.0e124",
          "2023-08-15 17:20:31",
          "2023-08-15 17:20:31Z",
          "",
          <<0xFF, 0xA0, 0x01>>
        ]
      }

      columns = [
        %{name: "int", type: :int2},
        %{name: "text", type: :text},
        %{name: "null", type: :bytea},
        %{name: "real1", type: :float8},
        %{name: "real2", type: :float8},
        %{name: "t", type: :timestamp},
        %{name: "tz", type: :timestamptz},
        %{name: "x", type: :float4, nullable?: true},
        %{name: "bytes", type: :bytea}
      ]

      assert %{
               "int" => "256",
               "text" => "hello",
               "null" => nil,
               "real1" => "5.4",
               "real2" => "-1.0e124",
               "t" => "2023-08-15 17:20:31",
               "tz" => "2023-08-15 17:20:31Z",
               "x" => nil,
               "bytes" => <<0xFF, 0xA0, 0x01>>
             } == Serialization.decode_record(row, columns)
    end

    test "raises when the row contains an invalid value for its type" do
      test_data = [
        {"1.0", :int4},
        {"33", :float8},
        {"1000000", :int2},
        {"-1000000000000000", :int4},
        {"...", :uuid},
        {"00000000-0000-0000-0000-00000000000g", :uuid},
        {"00000000-0000-0000-0000_000000000001", :uuid},
        {"20230815", :timestamp},
        {"2023-08-15 11:12:13+04:00", :timestamp},
        {"2023-08-15 11:12:13Z", :timestamp},
        {"2023-08-15 11:12:13+01", :timestamptz},
        {"2023-08-15 11:12:13+99:98", :timestamptz},
        {"2023-08-15 11:12:13+00", :timestamptz}
      ]

      Enum.each(test_data, fn {val, type} ->
        row = %SatOpRow{nulls_bitmask: <<0>>, values: [val]}
        columns = [%{name: "val", type: type}]

        try do
          Serialization.decode_record(row, columns)
        rescue
          _ -> :ok
        else
          val -> flunk("Expected decode_record() to raise but it returned #{inspect(val)}")
        end
      end)
    end

    test "raises when the row contains null values for non-null columns" do
      row = %SatOpRow{nulls_bitmask: <<0b10000000>>, values: [""]}
      columns = [%{name: "val", type: :timestamp, nullable?: false}]

      assert_raise RuntimeError, "protocol violation, null value for a not null column", fn ->
        Serialization.decode_record(row, columns)
      end
    end
  end

  describe "relations" do
    alias Electric.Postgres.Replication.{Column, Table}

    test "correctly set the pk flag" do
      table = %Table{
        schema: "something",
        name: "rotten",
        oid: 2234,
        primary_keys: ["id1", "id2"],
        columns: [
          %Column{
            name: "id1",
            type: "uuid",
            type_modifier: nil,
            part_of_identity?: true
          },
          %Column{
            name: "id2",
            type: "uuid",
            type_modifier: nil,
            part_of_identity?: true
          },
          %Column{
            name: "content",
            type: "char",
            type_modifier: nil,
            part_of_identity?: false
          }
        ]
      }

      msg = Serialization.serialize_relation(table)

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
      {stmts, schema} =
        Enum.flat_map_reduce(tx.changes, Schema.new(), fn
          %{relation: {"electric", "ddl_commands"}, record: %{"query" => sql}}, schema ->
            {[sql], schema_update(schema, sql)}

          _op, schema ->
            {[], schema}
        end)

      assert {:ok, _} = SchemaCache.save(cxt.origin, version, schema, stmts)

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

      {oplog,
       [{"public", "something_else"}, {"public", "other_thing"}, {"public", "yet_another_thing"}],
       %{}} = Serialization.serialize_trans(tx, 1, %{})

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
