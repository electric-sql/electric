defmodule Electric.Postgres.LogicalReplication.MessagesTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Changes
  alias Electric.Postgres.Replication.{Column, Table}

  describe "Changes.Relation" do
    test "to_schema_table/1" do
      msg = %Changes.Relation{
        columns: [
          %Changes.Relation.Column{
            flags: [:key],
            name: "id",
            type: :int8,
            type_modifier: -1
          },
          %Changes.Relation.Column{
            flags: [],
            name: "txid",
            type: :xid8,
            type_modifier: -1
          },
          %Changes.Relation.Column{
            flags: [],
            name: "txts",
            type: :timestamptz,
            type_modifier: -1
          },
          %Changes.Relation.Column{
            flags: [],
            name: "version",
            type: :varchar,
            type_modifier: 259
          },
          %Changes.Relation.Column{
            flags: [],
            name: "query",
            type: :text,
            type_modifier: -1
          }
        ],
        id: 20005,
        name: "ddl_commands",
        namespace: "electric",
        replica_identity: :default
      }

      table = %Table{
        schema: "electric",
        name: "ddl_commands",
        oid: 20005,
        # FIXME: primary keys are filled in somewhere else, somewhere that has access to the pg 
        # catalog tables...
        primary_keys: [],
        replica_identity: :default,
        columns: [
          %Column{name: "id", identity?: true, type: :int8, type_modifier: -1},
          %Column{name: "txid", identity?: false, type: :xid8, type_modifier: -1},
          %Column{
            name: "txts",
            identity?: false,
            type: :timestamptz,
            type_modifier: -1
          },
          %Column{
            name: "version",
            identity?: false,
            type: :varchar,
            type_modifier: 259
          },
          %Column{name: "query", identity?: false, type: :text, type_modifier: -1}
        ]
      }

      assert Changes.Relation.to_schema_table(msg) == table
    end
  end
end
