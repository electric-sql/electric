# Tests adapted from Postgrex.ReplicationConnection test suite.
# https://github.com/elixir-ecto/postgrex/blob/master/test/replication_connection_test.exs
#
# These validate that the vendored encode_lsn/decode_lsn functions
# remain correct after vendoring.

defmodule Electric.Postgres.ReplicationConnectionTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.ReplicationConnection

  describe "encode_lsn/1" do
    test "encodes 0" do
      assert ReplicationConnection.encode_lsn(0) == {:ok, "0/0"}
    end

    test "encodes max uint64" do
      max = Bitwise.bsl(1, 64) - 1
      assert ReplicationConnection.encode_lsn(max) == {:ok, "FFFFFFFF/FFFFFFFF"}
    end

    test "encodes a typical LSN" do
      assert ReplicationConnection.encode_lsn(0x16B3738) == {:ok, "0/16B3738"}
    end

    test "returns error for negative values" do
      assert ReplicationConnection.encode_lsn(-1) == :error
    end

    test "returns error for values exceeding max uint64" do
      assert ReplicationConnection.encode_lsn(Bitwise.bsl(1, 64)) == :error
    end
  end

  describe "decode_lsn/1" do
    test "decodes 0/0" do
      assert ReplicationConnection.decode_lsn("0/0") == {:ok, 0}
    end

    test "decodes max LSN" do
      max = Bitwise.bsl(1, 64) - 1
      assert ReplicationConnection.decode_lsn("FFFFFFFF/FFFFFFFF") == {:ok, max}
    end

    test "round-trips a typical LSN" do
      {:ok, encoded} = ReplicationConnection.encode_lsn(0x16B3738)
      assert ReplicationConnection.decode_lsn(encoded) == {:ok, 0x16B3738}
    end

    test "returns error for missing slash" do
      assert ReplicationConnection.decode_lsn("0") == :error
    end

    test "returns error for invalid hex" do
      assert ReplicationConnection.decode_lsn("G/0") == :error
    end

    test "returns error for components exceeding 8 hex digits" do
      assert ReplicationConnection.decode_lsn("100000000/0") == :error
    end

    test "returns error for negative components" do
      assert ReplicationConnection.decode_lsn("-1/0") == :error
    end
  end
end
