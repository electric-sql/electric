defmodule Electric.DDLX.Parse.AssignParser do
  alias Electric.DDLX.Parse.Element
  alias Electric.DDLX.Command.Assign
  import Electric.DDLX.Parse.Common

  @keywords ["electric", "assign", "to", "if"]

  @elements [
    %Element{required: true, type: "keyword", options: ["electric"], name: nil},
    %Element{
      required: true,
      type: "kv",
      options: ["assign"],
      name: "role",
      value_type: [:string, :collection, :name]
    },
    %Element{required: true, type: "kv", options: ["to"], name: "user", value_type: :name},
    %Element{required: false, type: "kv", options: ["if"], name: "if", value_type: :collection}
  ]

  use Electric.DDLX.Parse.Common

  def matches(statement) do
    String.starts_with?(statement, "electric assign")
  end

  def make_from_values(values, sql) do
    to_def = get_value(values, "user")
    role_def = get_value(values, "role")
    role_def_type = get_value_type(values, "role")

    with {:ok, schema_name, table_name, user_column} <-
           parse_to_def(to_def, @default_schema),
         {:ok, scope, role_name, role_column} <-
           parse_role_def(role_def, role_def_type, table_name) do
      {
        :ok,
        [
          %Assign{
            schema_name: schema_name,
            table_name: table_name,
            user_column: user_column,
            scope: scope,
            role_name: role_name,
            role_column: role_column,
            if_statement: get_value(values, "if")
          }
        ]
      }
    else
      {:error, message} -> {:error, error(message, sql)}
    end
  end
end
