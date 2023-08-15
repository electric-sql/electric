defmodule Electric.DDLX.Parse.SQLiteParser do
  alias Electric.DDLX.Parse.Element
  alias Electric.DDLX.Command.SQLite
  import Electric.DDLX.Parse.Common

  @keywords ["electric sqlite"]

  @elements [
    %Element{
      required: true,
      type: "kv",
      options: ["electric sqlite"],
      name: "sql",
      valueType: :string
    }
  ]

  use Electric.DDLX.Parse.Common

  def matches(statement) do
    String.starts_with?(statement, "electric sqlite")
  end

  def make_from_values(values) do
    {
      :ok,
      [
        %SQLite{
          sqlite_statement: get_value(values, "sql")
        }
      ]
    }
  end
end
