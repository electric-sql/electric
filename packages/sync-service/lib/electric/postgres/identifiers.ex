defmodule Electric.Postgres.Identifiers do
  @namedatalen 63
  @ascii_downcase ?a - ?A

  defmodule StringSplitter do
    @moduledoc """
    Utility module for splitting strings on a schema delimiter
    """

    @doc """
    Split a string on a schema delimiter, only if the delimiter is not
    inside quotes, returning a list of strings
    """
    @spec split_outside_quotes(binary()) :: [binary(), ...]
    def split_outside_quotes(string) do
      split_outside_quotes(string, "", [], false)
    end

    # Return the accumulated parts
    defp split_outside_quotes("", current, acc, _in_quotes), do: acc ++ [current]

    # If we hit a period and we're not in quotes, split here
    defp split_outside_quotes(<<".", rest::binary>>, current, acc, false),
      do: split_outside_quotes(rest, "", acc ++ [current], false)

    # Toggle the in_quotes flag when encountering a quote
    defp split_outside_quotes(<<"\"", rest::binary>>, current, acc, in_quotes),
      do: split_outside_quotes(rest, current <> "\"", acc, !in_quotes)

    # Continue processing, accumulating characters
    defp split_outside_quotes(<<char, rest::binary>>, current, acc, in_quotes),
      do: split_outside_quotes(rest, current <> <<char>>, acc, in_quotes)
  end

  @doc """
  Parse a PostgreSQL identifier, removing quotes if present and escaping internal ones
  and downcasing the identifier otherwise.

  ## Examples

      iex> Electric.Postgres.Identifiers.parse("FooBar")
      {:ok, "foobar"}

      iex> Electric.Postgres.Identifiers.parse(~S|"FooBar"|)
      {:ok, "FooBar"}

      iex> Electric.Postgres.Identifiers.parse(~S|Foo"Bar"|)
      {:error, ~S|Invalid unquoted identifier contains special characters: Foo"Bar"|}

      iex> Electric.Postgres.Identifiers.parse(~S| |)
      {:error, ~S|Invalid unquoted identifier contains special characters:  |}

      iex> Electric.Postgres.Identifiers.parse("foob@r")
      {:error, ~S|Invalid unquoted identifier contains special characters: foob@r|}

      iex> Electric.Postgres.Identifiers.parse(~S|"Foo"Bar"|)
      {:error, ~S|Invalid identifier with unescaped quote: Foo"Bar|}

      iex> Electric.Postgres.Identifiers.parse(~S|""|)
      {:error, "Invalid zero-length delimited identifier"}

      iex> Electric.Postgres.Identifiers.parse("")
      {:error, "Invalid zero-length delimited identifier"}

      iex> Electric.Postgres.Identifiers.parse(~S|" "|)
      {:ok, " "}

      iex> Electric.Postgres.Identifiers.parse(~S|"Foo""Bar"|)
      {:ok, ~S|Foo"Bar|}
  """
  @spec parse(binary(), boolean(), boolean()) :: {:ok, binary()} | {:error, term()}
  def parse(ident, truncate \\ false, single_byte_encoding \\ false) when is_binary(ident) do
    if String.starts_with?(ident, ~S|"|) and String.ends_with?(ident, ~S|"|) do
      ident_unquoted = String.slice(ident, 1..-2//1)
      parse_quoted_identifier(ident_unquoted)
    else
      parse_unquoted_identifier(ident, truncate, single_byte_encoding)
    end
  end

  defp parse_quoted_identifier(""), do: {:error, "Invalid zero-length delimited identifier"}

  defp parse_quoted_identifier(ident) do
    if contains_unescaped_quote?(ident),
      do: {:error, "Invalid identifier with unescaped quote: #{ident}"},
      else: {:ok, unescape_quotes(ident)}
  end

  @doc """
  Parse an unquoted PostgreSQL identifier, downcasing characters and failing if any
  special characters are present

  ## Examples
      iex> Electric.Postgres.Identifiers.parse_unquoted_identifier("FooBar")
      {:ok, "foobar"}

      iex> Electric.Postgres.Identifiers.parse_unquoted_identifier("foob@r")
      {:error, ~S|Invalid unquoted identifier contains special characters: foob@r|}
  """
  @spec parse(binary(), boolean(), boolean()) :: {:ok, binary()} | {:error, term()}
  def parse_unquoted_identifier(ident, truncate \\ false, single_byte_encoding \\ false)

  def parse_unquoted_identifier("", _, _), do: parse_quoted_identifier("")

  def parse_unquoted_identifier(ident, truncate, single_byte_encoding) do
    unless valid_unquoted_identifier?(ident),
      do: {:error, "Invalid unquoted identifier contains special characters: #{ident}"},
      else: {:ok, downcase(ident, truncate, single_byte_encoding)}
  end

  defp contains_unescaped_quote?(string) do
    Regex.match?(~r/(?<!")"(?!")/, string)
  end

  defp unescape_quotes(string) do
    string
    |> String.replace(~r/""/, ~S|"|)
  end

  defp valid_unquoted_identifier?(identifier) do
    Regex.match?(~r/^[\pL_][\pL\pM_0-9$]*$]*$/u, identifier)
  end

  @doc """
  Parse a PostgreSQL relation identifier

  ## Examples

      iex> Electric.Postgres.Identifiers.parse_relation("foo")
      {:ok, {"public", "foo"}}

      iex> Electric.Postgres.Identifiers.parse_relation("foo.bar")
      {:ok, {"foo", "bar"}}

      iex> Electric.Postgres.Identifiers.parse_relation(~S|"foo"."bar"|)
      {:ok, {"foo", "bar"}}

      iex> Electric.Postgres.Identifiers.parse_relation(~S|"foo.woah"."bar"|)
      {:ok, {"foo.woah", "bar"}}

      iex> Electric.Postgres.Identifiers.parse_relation(~S|"foo".bar|)
      {:ok, {"foo", "bar"}}

      iex> Electric.Postgres.Identifiers.parse_relation(~S|"foo"."bar|)
      {:error, ~S|Invalid unquoted identifier contains special characters: "bar|}

      iex> Electric.Postgres.Identifiers.parse_relation("foo.bar.baz")
      {:error, "Invalid relation identifier, too many delimiters: foo.bar.baz"}
  """
  @spec parse_relation(binary()) :: {:ok, Electric.relation()} | {:error, term()}
  def parse_relation(ident) do
    case StringSplitter.split_outside_quotes(ident) do
      [table] ->
        case parse(table) do
          {:ok, parsed} -> {:ok, {"public", parsed}}
          {:error, reason} -> {:error, reason}
        end

      [schema, table] ->
        with {:ok, schema} <- parse(schema),
             {:ok, table} <- parse(table) do
          {:ok, {schema, table}}
        end

      _ ->
        {:error, "Invalid relation identifier, too many delimiters: #{ident}"}
    end
  end

  @doc """
  Downcase the identifier and truncate if necessary, using
  PostgreSQL's algorithm for downcasing.

  Setting `truncate` to `true` will truncate the identifier to 63 characters

  Setting `single_byte_encoding` to `true` will downcase the identifier
  using single byte encoding

  See:
  https://github.com/postgres/postgres/blob/259a0a99fe3d45dcf624788c1724d9989f3382dc/src/backend/parser/scansup.c#L46-L80

  ## Examples

      iex> Electric.Postgres.Identifiers.downcase("FooBar")
      "foobar"
      iex> Electric.Postgres.Identifiers.downcase(String.duplicate("a", 100), true)
      String.duplicate("a", 63)
  """
  def downcase(ident, truncate \\ false, single_byte_encoding \\ false)

  def downcase(ident, false, single_byte_encoding) do
    downcased_ident =
      ident
      |> String.to_charlist()
      |> Enum.map(&downcase_char(&1, single_byte_encoding))
      |> List.to_string()

    downcased_ident
  end

  def downcase(ident, true, single_byte_encoding) do
    downcased_ident = downcase(ident, false, single_byte_encoding)

    truncated_ident =
      if String.length(ident) >= @namedatalen do
        String.slice(downcased_ident, 0, @namedatalen)
      else
        downcased_ident
      end

    truncated_ident
  end

  # Helper function to downcase a character
  defp downcase_char(ch, _) when ch in ?A..?Z, do: ch + @ascii_downcase

  defp downcase_char(ch, true) when ch > 127,
    do:
      if(ch == Enum.at(:unicode_util.uppercase(ch), 0),
        do: Enum.at(:unicode_util.lowercase(ch), 0),
        else: ch
      )

  defp downcase_char(ch, _), do: ch
end
