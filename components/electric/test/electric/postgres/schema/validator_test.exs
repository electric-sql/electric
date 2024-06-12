defmodule Electric.Postgres.Schema.ValidatorTest do
  use ExUnit.Case, async: true

  alias Electric.DDLX
  alias Electric.Postgres
  alias Electric.Postgres.NameParser
  alias Electric.Postgres.Schema
  alias Electric.Postgres.Schema.Validator

  import Electric.Utils, only: [inspect_relation: 1]

  defp schema(name, columns, extra_ddl) do
    ddl = Enum.join([extra_ddl, create_table_ddl(name, columns)], "\n")
    Schema.update(Schema.new(), ddl, oid_loader: &oid_loader/3)
  end

  defp create_table_ddl({_, _} = relation, columns) do
    "CREATE TABLE #{inspect_relation(relation)} (\n#{Enum.join(columns, ",\n")})"
  end

  defp create_table_ddl(name, columns) when is_binary(name) do
    create_table_ddl({"public", name}, columns)
  end

  defp oid_loader(type, schema, name) do
    {:ok, Enum.join(["#{type}", schema, name], ".") |> :erlang.phash2(50_000)}
  end

  defp grant(name, permission) do
    relation = {"public", name}
    "ELECTRIC GRANT #{permission} ON #{inspect_relation(relation)} TO 'some-role'"
  end

  unsupported_types = Postgres.all_types() -- Postgres.supported_types()

  electrification_cases =
    Enum.concat([
      [
        {"invalid.namespace", [valid: false], ["id uuid PRIMARY KEY", "value text"], []},
        {"missing_primary_key", [valid: false], ["id uuid", "value text"], []},
        {"sized_varchar", [valid: false], ["id uuid PRIMARY KEY", "value varchar(32)"], []},
        {"unsized_varchar", [valid: true], ["id uuid PRIMARY KEY", "value varchar"], []},
        {"valid_enum", [valid: true], ["id uuid PRIMARY KEY, value shapes"],
         [
           "CREATE TYPE shapes AS ENUM ('circle', 'square', 'diamond');"
         ]},
        {"uppercase_enum", [valid: true], ["id uuid PRIMARY KEY, value shapes"],
         [
           "CREATE TYPE shapes AS ENUM ('CIRCLE', 'SQUARE', 'DIAMOND');"
         ]},
        {"invalid_enum", [valid: false], ["id uuid PRIMARY KEY", "value badenum"],
         [
           "CREATE TYPE badenum AS ENUM ('1circle', '_square', 'hello world');"
         ]}
      ],
      Enum.map(
        unsupported_types,
        &{"#{String.replace(&1, " ", "_")}_column", [valid: false],
         ["id uuid PRIMARY KEY", "invalid #{&1}"], []}
      )
    ])

  describe "validate_schema_for_electrification/2" do
    for {name, validity, columns, extra_ddl} <- electrification_cases do
      valid? = Keyword.get(validity, :valid, true)

      test_name =
        String.replace(name, ["_", "."], " ") <>
          if valid?,
            do: " is valid",
            else: " is invalid"

      relation = NameParser.parse!(name)

      expected =
        if valid?,
          do: quote(do: {:ok, _}),
          else: quote(do: {:error, _})

      @tag String.to_atom(name)
      @tag :electrify
      test test_name do
        assert unquote(expected) =
                 unquote(name)
                 |> schema(unquote(columns), unquote(extra_ddl))
                 |> Validator.validate_schema_for_electrification(unquote(relation))
      end
    end
  end

  permissions_cases =
    Enum.concat([
      [
        {
          "column_unique_constraints",
          [INSERT: false, UPDATE: false, DELETE: true, SELECT: true],
          [
            "id uuid PRIMARY KEY",
            "value text NOT NULL",
            "tag text UNIQUE"
          ]
        },
        {
          "serial_primary_key",
          [INSERT: false, UPDATE: true, DELETE: true, SELECT: true],
          [
            "id serial8 PRIMARY KEY",
            "value text NOT NULL"
          ]
        },
        {
          "generated_integer_primary_key",
          [INSERT: false, UPDATE: true, DELETE: true, SELECT: true],
          [
            "id int8 GENERATED ALWAYS AS IDENTITY PRIMARY KEY",
            "value text NOT NULL"
          ]
        },
        # perhaps a compound primary key (integer, binary) should be allowed?
        {
          "serial_compound_primary_key",
          [INSERT: false, UPDATE: true, DELETE: true, SELECT: true],
          [
            "id serial8 NOT NULL",
            "qualifier uuid NOT NULL",
            "value text NOT NULL",
            "PRIMARY KEY (id, qualifier)"
          ]
        },
        # TODO: we should allow constant defaults...
        {
          "constant_column_defaults",
          [INSERT: false, UPDATE: true, DELETE: true, SELECT: true],
          [
            "id uuid PRIMARY KEY",
            "value text NOT NULL DEFAULT 'something'"
          ]
        },
        {
          "function_column_defaults",
          [INSERT: false, UPDATE: true, DELETE: true, SELECT: true],
          [
            "id uuid PRIMARY KEY",
            "value text NOT NULL DEFAULT some_function_call()"
          ]
        },
        {
          # TODO: we should allow timestamp defaults (with mapping)...
          "timestamp_column_defaults",
          [INSERT: false, UPDATE: true, DELETE: true, SELECT: true],
          [
            "id uuid PRIMARY KEY",
            "at timestamptz NOT NULL DEFAULT NOW()"
          ]
        },
        {
          "binary_pks",
          [INSERT: true, UPDATE: true, DELETE: true, SELECT: true],
          [
            "id1 uuid",
            "id2 bytea",
            "id3 text",
            "id4 varchar",
            "id5 text",
            "PRIMARY KEY (id1, id2, id3, id4, id5)"
          ]
        }
      ],
      Enum.map(~w[uuid bytea text varchar], fn type ->
        {
          "#{type}_pk",
          [INSERT: true, UPDATE: true, DELETE: true, SELECT: true],
          ["id #{type} PRIMARY KEY"]
        }
      end)
    ])

  describe "validate_schema_for_permissions/2:" do
    for privilege <- [:INSERT, :UPDATE, :DELETE, :SELECT] do
      for {name, validity, columns} <- permissions_cases do
        allowed? = Keyword.get(validity, privilege, true)

        test_name =
          String.replace(name, ["_", "."], " ") <>
            if allowed?,
              do: ": #{privilege} is ALLOWED",
              else: ": #{privilege} is DENIED"

        expected =
          if allowed?,
            do: quote(do: {:ok, _}),
            else: quote(do: {:error, _})

        @tag String.to_atom(name)
        @tag privilege
        test test_name do
          ddlx = grant(unquote(name), unquote(privilege))
          command = DDLX.parse!(ddlx)

          assert unquote(expected) =
                   unquote(name)
                   |> schema(unquote(columns), "")
                   |> Validator.validate_schema_for_permissions(command.action)
        end
      end
    end
  end
end
