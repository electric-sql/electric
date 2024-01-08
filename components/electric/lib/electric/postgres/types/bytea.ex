defmodule Electric.Postgres.Types.Bytea do
  @moduledoc """
  Utility module that implements encoding and decoding between Postgres'
  Hex encoding of BYTEA values and Elixir's raw binaries.

  Because we're using the text format for tuple values in the logical replication stream between Postgres and
  Electric, we have to encode the raw binary into one of Postgres' input encodings for BYTEA, of which the Hex
  encoding is the simpler one.

  https://www.postgresql.org/docs/current/datatype-binary.html#id-1.5.7.12.9
  """

  def to_postgres_hex(bin) do
    for <<bbbb::4 <- bin>>, into: "\\x", do: <<to_hex_digit(bbbb)>>
  end

  defp to_hex_digit(d) when d in 0..9, do: ?0 + d
  defp to_hex_digit(d) when d in 10..15, do: ?a + d - 10

  # Hex format: "\\xffa001"
  def from_postgres_hex("\\x" <> hex_str), do: decode_hex_str(hex_str)

  defp decode_hex_str(""), do: ""

  defp decode_hex_str(<<c>> <> hex_str),
    do: <<decode_hex_char(c)::4, decode_hex_str(hex_str)::bits>>

  defp decode_hex_char(char) when char in ?0..?9, do: char - ?0
  defp decode_hex_char(char) when char in ?a..?f, do: char - ?a + 10
  defp decode_hex_char(char) when char in ?A..?F, do: char - ?A + 10
end
