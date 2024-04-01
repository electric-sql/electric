defmodule Electric.Postgres.Types.Bytea do
  @moduledoc """
  Utility module that implements encoding and decoding between Postgres'
  Hex encoding of BYTEA values and Elixir's raw binaries.

  Because we're using the text format for tuple values in the logical replication stream between Postgres and
  Electric, we have to encode the raw binary into one of Postgres' input encodings for BYTEA, of which the Hex
  encoding is the simpler one.

  https://www.postgresql.org/docs/current/datatype-binary.html#DATATYPE-BINARY-BYTEA-HEX-FORMAT
  """

  @type format :: :hex | :escape

  def to_postgres_hex(bin) do
    "\\x" <> Base.encode16(bin, case: :lower)
  end

  # Hex format: "\\xffa001"
  def from_postgres_hex("\\x" <> hex_str), do: Base.decode16!(hex_str, case: :mixed)
end
