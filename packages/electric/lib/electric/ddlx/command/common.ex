defmodule Electric.DDLX.Command.Common do
  def sql_repr(nil) do
    "null"
  end

  def sql_repr(value) when is_binary(value) do
    "'#{escape_quotes(value)}'"
  end

  def sql_repr(values) when is_list(values) do
    [
      "ARRAY[",
      values |> Stream.map(&sql_repr/1) |> Enum.intersperse(", "),
      "]"
    ]
    |> IO.iodata_to_binary()
  end

  def sql_repr(int) when is_integer(int) do
    "#{int}"
  end

  def sql_repr({schema, table}) when is_binary(schema) and is_binary(table) do
    ~s['"#{schema}"."#{table}"']
  end

  defp escape_quotes(value) do
    :binary.replace(value, "'", "''", [:global])
  end
end
