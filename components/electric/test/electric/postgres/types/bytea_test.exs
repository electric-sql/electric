defmodule Electric.Postgres.Types.ByteaTest do
  use ExUnit.Case, async: true
  alias Electric.Postgres.Types.Bytea

  doctest Electric.Postgres.Types.Bytea, import: true

  test "detects whether input is already hex encoded" do
    # should detect regular hex encoded strings
    assert Bytea.postgres_hex_encoded?("\\x0001ff")
    assert Bytea.postgres_hex_encoded?("\\x7abbf3c48af50c57144178")
    assert Bytea.postgres_hex_encoded?(<<0b01011100, 0b01111000>> <> "ff01")

    # should have \x prefix to be a postgres hex encoded string
    refute Bytea.postgres_hex_encoded?("0001ff")

    # should detect if invalid hex characters are present
    refute Bytea.postgres_hex_encoded?("\\x0001fgh3")
  end
end
