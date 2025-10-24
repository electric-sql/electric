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
    assert ~s|"0_0"| == :json.encode(LogOffset.new(0, 0), &encode/2) |> IO.iodata_to_binary()
    assert ~s|"10_2"| == :json.encode(LogOffset.new(10, 2), &encode/2) |> IO.iodata_to_binary()
    assert ~s|"-1"| == :json.encode(LogOffset.before_all(), &encode/2) |> IO.iodata_to_binary()
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

  defp encode(%LogOffset{} = offset, _encode),
    do: Jason.encode_to_iodata!(offset)

  defp encode(%Electric.Shapes.Shape{} = shape, _encode),
    do: Jason.encode_to_iodata!(shape)

  defp encode(val, encode), do: :json.encode_value(val, encode)
end
