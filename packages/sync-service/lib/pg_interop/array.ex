defmodule PgInterop.Array do
  @doc ~S"""
  Parse a Postgres string-serialized array into a list of strings, unwrapping the escapes. Parses nested arrays.
  If a casting function is provided, it will be applied to each element.

  ## Examples

      iex> ~S|{"(\"2023-06-15 11:18:05.372698+00\",)"}| |> parse()
      [~s|("2023-06-15 11:18:05.372698+00",)|]

      iex> ~S|{"(\"2023-06-15 11:18:05.372698+00\",)","(\"2023-06-15 11:18:05.372698+00\",)"}| |> parse()
      [~s|("2023-06-15 11:18:05.372698+00",)|, ~s|("2023-06-15 11:18:05.372698+00",)|]

      iex> ~S|{"2023-06-15 11:18:05.372698+00",2023-06-15 11:18:05.372698+00}| |> parse(fn x -> {:ok, n, _} = DateTime.from_iso8601(x); n end)
      [~U[2023-06-15 11:18:05.372698Z], ~U[2023-06-15 11:18:05.372698Z]]

      iex> ~s|{'foo', 'bar{}', "tableName",'{baz,quux}', '}},,,{{',id, ",,\\"{}"}| |> parse()
      ["'foo'", "'bar{}'", "tableName", "'{baz,quux}'", "'}},,,{{'", "id", ",,\"{}"]

      iex> ~s|{{1},{2},{3}}| |> parse(&String.to_integer/1)
      [[1], [2], [3]]

      iex> ~s|{1,2,{3}}| |> parse(&String.to_integer/1)
      ** (RuntimeError) Invalid array syntax at "{3}}"

      iex> ~S|{"(\"2023-06-15 11:18:05.372698+00\",)"}}| |> parse()
      ** (RuntimeError) Invalid array syntax at "}"
  """
  def parse(string, casting_fun \\ & &1) do
    case parse_with_tail(string, casting_fun) do
      {result, ""} -> result
      {_, rest} -> raise("Invalid array syntax at #{inspect(rest)}")
    end
  end

  defp parse_with_tail("{}" <> str, _), do: {[], str}
  defp parse_with_tail("{" <> str, casting_fun), do: parse_pg_array_elem(str, casting_fun)
  defp parse_with_tail("," <> str, casting_fun), do: parse_pg_array_elem(str, casting_fun)
  defp parse_with_tail("}" <> str, _), do: {[], str}
  defp parse_with_tail(str, _), do: {[], str}

  # skip whitespace
  defp parse_pg_array_elem(<<space>> <> str, casting_fun) when space in [?\s, ?\t, ?\n] do
    parse_pg_array_elem(str, casting_fun)
  end

  # quoted element, scan until the next non-escaped quote
  defp parse_pg_array_elem(<<q>> <> str, casting_fun) when q in [?", ?'] do
    {elem, rest} = scan_until_quote(str, q, put_single_quote("", q))
    {result, rest} = parse_with_tail(rest, casting_fun)
    {[casting_fun.(elem) | result], rest}
  end

  # a nested array, parse that
  defp parse_pg_array_elem(<<q>> <> str, casting_fun) when q in [?{] do
    {elem, rest} = parse_with_tail(<<q>> <> str, casting_fun)
    {result, rest} = parse_with_tail(rest, casting_fun)
    {[elem | result], rest}
  end

  # regular identifier, parse it whole until the next comma or end of the array
  defp parse_pg_array_elem(str, casting_fun) do
    {elem, rest} = scan_until_comma_or_end(str, "")
    {result, rest} = parse_with_tail(rest, casting_fun)
    {[casting_fun.(elem) | result], rest}
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

  defp scan_until_comma_or_end("}" <> _ = rest, acc) do
    {acc, rest}
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
  def serialize(array, quote_char \\ ?") when is_list(array) do
    array
    |> Enum.map_join(",", fn
      nil -> "null"
      val when is_binary(val) -> val |> String.replace(~S|"|, ~S|\"|) |> enclose(<<quote_char>>)
    end)
    |> enclose("{", "}")
  end

  defp enclose(str, left, right \\ nil) do
    left <> str <> (right || left)
  end
end
