defmodule Electric.Replication.PostgresInterop.CastingTest do
  use ExUnit.Case, async: true
  import Electric.Replication.PostgresInterop.Casting
  doctest Electric.Replication.PostgresInterop.Casting, import: true

  describe "like?/2 Postgres compatibility" do
    test "`%` and `_` match newline characters" do
      # In Postgres both wildcards match any character, including newlines.
      assert like?("hello\nworld", "hello%world")
      assert like?("a\nb", "a_b")
    end

    test "the pattern must match the whole value, including a trailing newline" do
      # 'trailing\n' LIKE 'trailing' is false in Postgres; the newline is a
      # real character that the (anchored) pattern must account for.
      refute like?("trailing\n", "trailing")
      assert like?("trailing\n", "trailing%")
    end

    test "a backslash escapes `%` and `_` to match the literal character" do
      assert like?("100%", "100\\%")
      assert like?("a_b", "a\\_b")
      refute like?("hello", "hell\\%")
    end

    test "ilike?/2 keeps the corrected semantics while ignoring case" do
      assert ilike?("HELLO\nWORLD", "hello%world")
      assert ilike?("100%", "100\\%")
    end
  end
end
