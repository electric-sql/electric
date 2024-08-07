defmodule Electric.Replication.LogOffsetTest do
  alias Electric.Postgres.Lsn
  alias Electric.Replication.LogOffset

  use ExUnit.Case, async: true

  doctest Electric.Replication.LogOffset, import: true

  test "LogOffset initializes as 0,0" do
    assert %LogOffset{} == LogOffset.first()
    assert %{tx_offset: 0} = %LogOffset{}
    assert %{op_offset: 0} = %LogOffset{}
  end

  test "LogOffset implements `Inspect` protocol" do
    assert inspect(LogOffset.new(0, 0)) == "LogOffset.new(0, 0)"
    assert inspect(LogOffset.new(10, 2)) == "LogOffset.new(10, 2)"
    assert inspect(LogOffset.before_all()) == "LogOffset.before_all()"
  end

  test "LogOffset implements `Json.Encoder` protocol" do
    assert {:ok, ~s|"0_0"|} = Jason.encode(LogOffset.new(0, 0))
    assert {:ok, ~s|"10_2"|} = Jason.encode(LogOffset.new(10, 2))
    assert {:ok, ~s|"-1"|} = Jason.encode(LogOffset.before_all())
  end

  test "LogOffset implements `String.Chars` protocol" do
    assert to_string(LogOffset.new(0, 0)) == "0_0"
    assert to_string(LogOffset.new(10, 2)) == "10_2"
    assert to_string(LogOffset.before_all()) == "-1"
  end

  test "LogOffset implements `List.Chars` protocol" do
    assert to_charlist(LogOffset.new(0, 0)) == ~c"0_0"
    assert to_charlist(LogOffset.new(10, 2)) == ~c"10_2"
    assert to_charlist(LogOffset.before_all()) == ~c"-1"
  end
end
