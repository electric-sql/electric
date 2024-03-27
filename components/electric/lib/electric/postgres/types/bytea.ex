defmodule Electric.Postgres.Types.Bytea do
  @moduledoc """
  Utility module that implements encoding and decoding between Postgres'
  Hex encoding of BYTEA values and Elixir's raw binaries.

  Because we're using the text format for tuple values in the logical replication stream between Postgres and
  Electric, we have to encode the raw binary into one of Postgres' input encodings for BYTEA, of which the Hex
  encoding is the simpler one.

  https://www.postgresql.org/docs/current/datatype-binary.html#id-1.5.7.12.9
  """

  @type format :: :hex | :escape

  def to_postgres_hex(bin) do
    "\\x" <> Base.encode16(bin, case: :lower)
  end

  # Hex format: "\\xffa001"
  def from_postgres_hex("\\x" <> hex_str), do: Base.decode16!(hex_str, case: :mixed)

  def from_postgres_escape(_escape_str) do
    raise(ArgumentError,
      message: "bytea escape output format not supported - please use hex format"
    )
  end

  def to_postgres_escape(_bin) do
    raise(ArgumentError,
      message: "bytea escape output format not supported - please use hex format"
    )
  end

  @spec from_postgres_serialized(String.t()) :: binary()
  def from_postgres_serialized(serialized_bytes) do
    case postgres_hex_encoded?(serialized_bytes) do
      true -> from_postgres_hex(serialized_bytes)
      false -> from_postgres_escape(serialized_bytes)
    end
  end

  @spec to_postgres_serialized(binary(), format()) :: String.t()
  def to_postgres_serialized(bin, format) do
    case format do
      :hex -> to_postgres_hex(bin)
      :escape -> to_postgres_escape(bin)
    end
  end

  def postgres_hex_encoded?(str) do
    case str do
      "\\x" <> rest ->
        case Base.decode16(rest, case: :mixed) do
          {:ok, _} -> true
          _ -> false
        end

      _ ->
        false
    end
  end
end
