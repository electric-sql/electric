defmodule Electric.Postgres.LsnTest do
  alias Electric.Postgres.Lsn
  use ExUnit.Case, async: true

  doctest Electric.Postgres.Lsn, import: true

  test "LSN implements `Inspect` protocol" do
    assert inspect(%Lsn{segment: 5}) == "#Lsn<5/0>"
  end

  test "LSN implement `String.Chars` protocol" do
    assert to_string(%Lsn{segment: 5}) == "5/0"
  end

  test "LSN implement `List.Chars` protocol" do
    assert to_charlist(%Lsn{segment: 5}) == ~c"5/0"
  end

  test "LSN comparisons work across range of values" do
    for expA <- 1..64 do
      for expB <- 1..64 do
        intA = 2 ** expA - 1
        intB = 2 ** expB - 2
        is_larger = intA > intB
        compare_res = if is_larger, do: :gt, else: :lt

        lsnA = Lsn.from_integer(intA)
        lsnB = Lsn.from_integer(intB)
        assert Lsn.is_larger(lsnA, lsnB) == is_larger
        assert Lsn.compare(lsnA, lsnB) == compare_res
      end
    end
  end
end
