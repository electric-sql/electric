defmodule Electric.DDLX.Parse.EnableParser do
  alias Electric.DDLX.Parse.Element
  alias Electric.DDLX.Command.Enable
  import Electric.DDLX.Parse.Common

  @keywords ["alter table", "enable electric"]

  @elements [
    %Element{
      required: true,
      type: "kv",
      options: ["alter table"],
      name: "table",
      valueType: :name
    },
    %Element{required: true, type: "keyword", options: ["enable electric"], name: nil}
  ]

  use Electric.DDLX.Parse.Common

  def matches(statement) do
    String.contains?(statement, "enable electric")
  end

  def make_from_values(values) do
    {schema_name, table_name} = schema_and_table(get_value(values, "table"), @default_schema)

    {
      :ok,
      [
        %Enable{
          table_name: "#{schema_name}.#{table_name}"
        }
      ]
    }
  end
end
