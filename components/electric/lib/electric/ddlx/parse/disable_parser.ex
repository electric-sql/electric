defmodule Electric.DDLX.Parse.DisableParser do
  alias Electric.DDLX.Parse.Element
  alias Electric.DDLX.Command.Disable
  import Electric.DDLX.Parse.Common

  @keywords ["alter table", "disable electric"]

  @elements [
    %Element{
      required: true,
      type: "kv",
      options: ["alter table"],
      name: "table",
      value_type: :name
    },
    %Element{required: true, type: "keyword", options: ["disable electric"], name: nil}
  ]

  use Electric.DDLX.Parse.Common

  def matches(statement) do
    String.contains?(statement, "disable electric")
  end

  def make_from_values(values, _sql) do
    {schema_name, table_name} = schema_and_table(get_value(values, "table"), @default_schema)

    {
      :ok,
      [
        %Disable{
          table_name: "#{schema_name}.#{table_name}"
        }
      ]
    }
  end
end
