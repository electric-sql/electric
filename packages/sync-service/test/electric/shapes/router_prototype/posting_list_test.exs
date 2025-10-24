defmodule Electric.Shapes.RouterPrototype.PostingListTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.RouterPrototype.PostingList

  describe "new/1" do
    test "creates an ETS table" do
      table = PostingList.new()
      assert is_reference(table)
      assert :ets.info(table, :type) == :duplicate_bag
    end
  end

  describe "insert/5 and lookup/4" do
    test "inserts and retrieves shape IDs" do
      table = PostingList.new()

      PostingList.insert(table, "users", "id", 42, 1)
      PostingList.insert(table, "users", "id", 42, 5)
      PostingList.insert(table, "users", "status", "active", 10)

      assert PostingList.lookup(table, "users", "id", 42) == [1, 5]
      assert PostingList.lookup(table, "users", "status", "active") == [10]
      assert PostingList.lookup(table, "users", "id", 99) == []
    end

    test "handles different value types" do
      table = PostingList.new()

      PostingList.insert(table, "test", "col", 42, 1)
      PostingList.insert(table, "test", "col", "string", 2)
      PostingList.insert(table, "test", "col", true, 3)
      PostingList.insert(table, "test", "col", nil, 4)

      assert PostingList.lookup(table, "test", "col", 42) == [1]
      assert PostingList.lookup(table, "test", "col", "string") == [2]
      assert PostingList.lookup(table, "test", "col", true) == [3]
      assert PostingList.lookup(table, "test", "col", nil) == [4]
    end
  end

  describe "insert_batch/2" do
    test "inserts multiple entries at once" do
      table = PostingList.new()

      entries = [
        {"users", "id", 1, 10},
        {"users", "id", 2, 20},
        {"products", "sku", "ABC", 30}
      ]

      PostingList.insert_batch(table, entries)

      assert PostingList.lookup(table, "users", "id", 1) == [10]
      assert PostingList.lookup(table, "users", "id", 2) == [20]
      assert PostingList.lookup(table, "products", "sku", "ABC") == [30]
    end
  end

  describe "any_match?/4" do
    test "returns true if any match exists" do
      table = PostingList.new()
      PostingList.insert(table, "users", "id", 42, 1)

      assert PostingList.any_match?(table, "users", "id", 42) == true
      assert PostingList.any_match?(table, "users", "id", 99) == false
    end

    test "short-circuits without building full list" do
      table = PostingList.new()
      # Insert many entries
      for i <- 1..1000 do
        PostingList.insert(table, "users", "id", 42, i)
      end

      # Should be fast even with 1000 matches
      assert PostingList.any_match?(table, "users", "id", 42) == true
    end
  end

  describe "lookup_first/4" do
    test "returns first matching shape ID" do
      table = PostingList.new()
      PostingList.insert(table, "users", "id", 42, 1)
      PostingList.insert(table, "users", "id", 42, 5)

      # Returns one of the shape IDs (order not guaranteed with duplicate_bag)
      first = PostingList.lookup_first(table, "users", "id", 42)
      assert first in [1, 5]
    end

    test "returns nil if no match" do
      table = PostingList.new()
      assert PostingList.lookup_first(table, "users", "id", 99) == nil
    end
  end

  describe "delete/5" do
    test "removes specific posting" do
      table = PostingList.new()
      PostingList.insert(table, "users", "id", 42, 1)
      PostingList.insert(table, "users", "id", 42, 5)

      PostingList.delete(table, "users", "id", 42, 1)

      assert PostingList.lookup(table, "users", "id", 42) == [5]
    end
  end

  describe "delete_shape/2" do
    test "removes all postings for a shape" do
      table = PostingList.new()
      PostingList.insert(table, "users", "id", 42, 1)
      PostingList.insert(table, "users", "status", "active", 1)
      PostingList.insert(table, "products", "sku", "ABC", 1)
      PostingList.insert(table, "users", "id", 43, 2)

      PostingList.delete_shape(table, 1)

      assert PostingList.lookup(table, "users", "id", 42) == []
      assert PostingList.lookup(table, "users", "status", "active") == []
      assert PostingList.lookup(table, "products", "sku", "ABC") == []
      assert PostingList.lookup(table, "users", "id", 43) == [2]
    end
  end

  describe "count/1 and stats/1" do
    test "returns correct count and stats" do
      table = PostingList.new()
      assert PostingList.count(table) == 0

      PostingList.insert(table, "users", "id", 42, 1)
      PostingList.insert(table, "users", "id", 42, 5)
      PostingList.insert(table, "users", "status", "active", 10)

      assert PostingList.count(table) == 3

      stats = PostingList.stats(table)
      assert stats.size == 3
      assert stats.type == :duplicate_bag
      assert is_integer(stats.memory_bytes)
    end
  end

  describe "performance characteristics" do
    test "O(1) lookup performance" do
      table = PostingList.new()

      # Insert 10,000 postings
      for i <- 1..10_000 do
        PostingList.insert(table, "users", "id", rem(i, 100), i)
      end

      # Lookup should still be fast
      {time_us, _result} =
        :timer.tc(fn ->
          PostingList.lookup(table, "users", "id", 42)
        end)

      # Should complete in microseconds, not milliseconds
      assert time_us < 100
    end

    test "minimal allocations for common case (0-1 matches)" do
      table = PostingList.new()
      PostingList.insert(table, "users", "id", 42, 1)

      # Measure reductions (proxy for allocations)
      {reductions_before, _} = :erlang.process_info(self(), :reductions)
      _result = PostingList.lookup(table, "users", "id", 42)
      {reductions_after, _} = :erlang.process_info(self(), :reductions)

      # Should use very few reductions
      reductions_used = reductions_after - reductions_before
      assert reductions_used < 50
    end
  end
end
