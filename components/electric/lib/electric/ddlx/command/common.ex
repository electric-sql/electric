defmodule Electric.DDLX.Command.Common do
  def sql_repr(value) when value == nil do
    "null"
  end

  def sql_repr(value) when is_binary(value) do
    "'#{escape_quotes(value, [])}'"
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

  defp escape_quotes(<<>>, acc) do
    IO.iodata_to_binary(acc)
  end

  defp escape_quotes(<<?', rest::binary>>, acc) do
    escape_quotes(rest, [acc, "''"])
  end

  defp escape_quotes(<<c::binary-1, rest::binary>>, acc) do
    escape_quotes(rest, [acc, c])
  end
end
