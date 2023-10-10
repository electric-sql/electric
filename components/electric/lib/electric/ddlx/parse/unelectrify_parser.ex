defmodule Electric.DDLX.Parse.UnelectrifyParser do
  alias Electric.DDLX.Parse.Element
  alias Electric.DDLX.Command.Disable
  import Electric.DDLX.Parse.Common

  @keywords ["unelectrify"]

  @elements [
    %Element{
      required: true,
      type: "kv",
      options: ["unelectrify"],
      name: "table",
      value_type: :name
    }
  ]

  use Electric.DDLX.Parse.Common

  def matches(statement) do
    String.starts_with?(statement, "unelectrify")
  end

  def make_from_values(values) do
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
