defmodule Electric.DDLX.Command.Enable do
  alias Electric.DDLX.Command
  alias Electric.DDLX.Parse.Build

  @type t() :: %__MODULE__{
          table_name: String.t()
        }

  @keys [
    :table_name
  ]

  @enforce_keys @keys

  defstruct @keys

  def matches_tokens(tokens) do
    case tokens do
      [{:ALTER, _}, {:TABLE, _}, _, {:ENABLE, _}, {:ELECTRIC, _}] ->
        true

      _ ->
        false
    end
  end

  def builder() do
    Build.new()
    |> Build.expect([:ALTER, :TABLE])
    |> Build.property(:table_name, &Electric.Postgres.NameParser.parse(&1, &2))
    |> Build.expect([:ENABLE, :ELECTRIC])
  end

  defimpl Command do
    import Electric.DDLX.Command.Common

    def pg_sql(enable) do
      [
        """
        CALL electric.enable(#{sql_repr(enable.table_name)});
        """
      ]
    end

    def table_name(%{table_name: table_name}) do
      table_name
    end

    def tag(_a), do: "ELECTRIC ENABLE"
  end
end
