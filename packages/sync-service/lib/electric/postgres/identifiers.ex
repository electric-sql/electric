defmodule Electric.Postgres.Identifiers do
  @namedatalen 63
  @ascii_downcase ?a - ?A

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
        result = String.slice(downcased_ident, 0, @namedatalen)
        result
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
