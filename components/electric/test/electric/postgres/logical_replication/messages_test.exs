defmodule Electric.Postgres.LogicalReplication.MessagesTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Changes

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

      table = %{
        name: "ddl_commands",
        oid: 20005,
        # FIXME: primary keys are filled in somewhere else, somewhere that has access to the pg 
        # catalog tables...
        primary_keys: [],
        replica_identity: :default,
        schema: "electric"
      }

      columns = [
        %{name: "id", part_of_identity?: true, type: :int8, type_modifier: -1},
        %{name: "txid", part_of_identity?: false, type: :xid8, type_modifier: -1},
        %{
          name: "txts",
          part_of_identity?: false,
          type: :timestamptz,
          type_modifier: -1
        },
        %{
          name: "version",
          part_of_identity?: false,
          type: :varchar,
          type_modifier: 259
        },
        %{name: "query", part_of_identity?: false, type: :text, type_modifier: -1}
      ]

      assert Changes.Relation.to_schema_table(msg) == {table, columns}
    end
  end
end
