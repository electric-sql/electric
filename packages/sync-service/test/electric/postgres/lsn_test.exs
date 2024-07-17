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
end
