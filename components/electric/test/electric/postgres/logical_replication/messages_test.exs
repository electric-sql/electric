defmodule Electric.Postgres.LogicalReplication.MessagesTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.LogicalReplication.Messages

  describe "Relation" do
    test "to_schema_table/1" do
      msg = %Messages.Relation{
        columns: [
          %Messages.Relation.Column{
            flags: [:key],
            name: "id",
            type: :int8,
            type_modifier: -1
          },
          %Messages.Relation.Column{
            flags: [],
            name: "txid",
            type: :xid8,
            type_modifier: -1
          },
          %Messages.Relation.Column{
            flags: [],
            name: "txts",
            type: :timestamptz,
            type_modifier: -1
          },
          %Messages.Relation.Column{
            flags: [],
            name: "version",
            type: :varchar,
            type_modifier: 259
          },
          %Messages.Relation.Column{
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
        primary_keys: ["id"],
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

      assert Messages.Relation.to_schema_table(msg) == {table, columns}
    end
  end
end
