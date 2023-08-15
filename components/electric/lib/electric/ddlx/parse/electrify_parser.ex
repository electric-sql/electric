defmodule Electric.DDLX.Parse.ElectrifyParser do
  alias Electric.DDLX.Parse.Element
  alias Electric.DDLX.Command.Enable
  import Electric.DDLX.Parse.Common

  @keywords ["electrify"]

  @elements [
    %Element{required: true, type: "kv", options: ["electrify"], name: "table", valueType: :name}
  ]

  use Electric.DDLX.Parse.Common

  def matches(statement) do
    String.starts_with?(statement, "electrify")
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
