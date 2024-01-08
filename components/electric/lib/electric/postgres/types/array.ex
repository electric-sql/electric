defmodule Electric.Postgres.Types.Array do
  @doc ~S"""
  Parse a Postgres string-serialized array into a list of strings, unwrapping the escapes

  ## Examples

      iex> ~S|{"(\"2023-06-15 11:18:05.372698+00\",)"}| |> parse()
      [~s|("2023-06-15 11:18:05.372698+00",)|]

      iex> ~S|{"(\"2023-06-15 11:18:05.372698+00\",)","(\"2023-06-15 11:18:05.372698+00\",)"}| |> parse()
      [~s|("2023-06-15 11:18:05.372698+00",)|, ~s|("2023-06-15 11:18:05.372698+00",)|]

      iex> ~s|{'foo', 'bar{}', "tableName",'{baz,quux}', '}},,,{{',id, ",,\\"{}"}| |> parse()
      ["'foo'", "'bar{}'", "tableName", "'{baz,quux}'", "'}},,,{{'", "id", ",,\"{}"]
  """
  def parse("{}"), do: []
  def parse("{" <> str), do: parse_pg_array_elem(str)
  def parse("," <> str), do: parse_pg_array_elem(str)
  def parse("}"), do: []

  # skip whitespace
  defp parse_pg_array_elem(<<space>> <> str) when space in [?\s, ?\t, ?\n] do
    parse_pg_array_elem(str)
  end

  # quoted element, scan until the next non-escaped quote
  defp parse_pg_array_elem(<<q>> <> str) when q in [?", ?'] do
    {elem, rest} = scan_until_quote(str, q, put_single_quote("", q))
    [elem | parse(rest)]
  end

  # regular identifier, parse it whole until the next comma or end of the array
  defp parse_pg_array_elem(str) do
    {elem, rest} = scan_until_comma_or_end(str, "")
    [elem | parse(rest)]
  end

  # closing quote, return
  defp scan_until_quote(<<q>> <> rest, q, acc) do
    {put_single_quote(acc, q), rest}
  end

  # escaped quote, keep going
  defp scan_until_quote(<<?\\, q>> <> str, q, acc) do
    scan_until_quote(str, q, acc <> <<q>>)
  end

  # escaped backslash, keep going
  defp scan_until_quote(<<?\\, ?\\>> <> str, q, acc) do
    scan_until_quote(str, q, acc <> <<?\\>>)
  end

  # regular character, keep going
  defp scan_until_quote(<<c>> <> str, q, acc) do
    scan_until_quote(str, q, acc <> <<c>>)
  end

  defp scan_until_comma_or_end("}", acc) do
    {acc, "}"}
  end

  defp scan_until_comma_or_end(<<?,>> <> _ = str, acc) do
    {acc, str}
  end

  defp scan_until_comma_or_end(<<c>> <> str, acc) do
    scan_until_comma_or_end(str, acc <> <<c>>)
  end

  defp put_single_quote(str, ?"), do: str
  defp put_single_quote(str, ?'), do: str <> <<?'>>

  @doc ~S"""
  Serialize a list of strings into a postgres string-serialized array into a list of strings, wrapping the contents

  ## Examples

      iex> [~s|("2023-06-15 11:18:05.372698+00",)|] |> serialize()
      ~S|{"(\"2023-06-15 11:18:05.372698+00\",)"}|

      iex> [~s|("2023-06-15 11:18:05.372698+00",)|, ~s|("2023-06-15 11:18:05.372698+00",)|] |> serialize()
      ~S|{"(\"2023-06-15 11:18:05.372698+00\",)","(\"2023-06-15 11:18:05.372698+00\",)"}|

      iex> str = ~S|{"(\"2023-06-15 11:18:05.372698+00\",)","(\"2023-06-15 11:18:05.372698+00\",)"}|
      iex> str |> parse() |> serialize()
      str
  """
  def serialize(array) when is_list(array) do
    array
    |> Enum.map_join(",", fn
      nil -> "null"
      val when is_binary(val) -> val |> String.replace(~S|"|, ~S|\"|) |> enclose(~S|"|)
    end)
    |> enclose("{", "}")
  end

  defp enclose(str, left, right \\ nil) do
    left <> str <> (right || left)
  end
end
