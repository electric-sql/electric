defmodule Electric.DDLX.Parse.RevokeParser do
  alias Electric.DDLX.Parse.Element
  import Electric.DDLX.Parse.Common
  alias Electric.DDLX.Command.Revoke

  @keywords [
    "electric",
    "revoke",
    "select",
    "insert",
    "update",
    "delete",
    "all",
    "read",
    "write",
    "on",
    "from",
    "using"
  ]

  @elements [
    %Element{required: true, type: "keyword", options: ["electric"], name: nil},
    %Element{required: true, type: "keyword", options: ["revoke"], name: "command"},
    %Element{
      required: true,
      type: "keyword",
      options: ["select", "insert", "update", "delete", "all", "read", "write"],
      name: "privilege"
    },
    %Element{
      required: false,
      type: "value",
      options: nil,
      name: "columns",
      value_type: :collection
    },
    %Element{required: true, type: "kv", options: ["on"], name: "table", value_type: :name},
    %Element{required: true, type: "kv", options: ["from"], name: "role", value_type: :string}
  ]

  use Electric.DDLX.Parse.Common

  def matches(statement) do
    String.starts_with?(statement, "electric revoke")
  end

  def make_from_values(values, _sql) do
    privilege = get_value(values, "privilege")
    columns = get_value(values, "columns")
    scope_role = get_value(values, "role")

    privileges = expand_privileges(privilege)

    columns_names =
      if columns == nil do
        ["*"]
      else
        for part <- String.split(columns, ",") do
          String.trim(part)
        end
      end

    {scope, role} = scope_and_role(scope_role)
    {schema_name, table_name} = schema_and_table(get_value(values, "table"), @default_schema)

    {
      :ok,
      for priv <- privileges do
        %Revoke{
          privilege: priv,
          on_table: "#{schema_name}.#{table_name}",
          role: role,
          scope: scope,
          column_names: columns_names
        }
      end
    }
  end
end
