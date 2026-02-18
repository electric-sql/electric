defmodule Electric.Client.ExpiredShapesCacheTest do
  use ExUnit.Case, async: false

  alias Electric.Client.ExpiredShapesCache

  setup do
    ExpiredShapesCache.clear()
    :ok
  end

  describe "get_expired_handle/1" do
    test "returns nil for unknown shape key" do
      assert ExpiredShapesCache.get_expired_handle("unknown-key") == nil
    end

    test "returns expired handle after marking" do
      ExpiredShapesCache.mark_expired("http://localhost:3000/v1/shape?table=items", "handle-123")

      assert ExpiredShapesCache.get_expired_handle("http://localhost:3000/v1/shape?table=items") ==
               "handle-123"
    end

    test "returns nil after clearing" do
      ExpiredShapesCache.mark_expired("http://localhost:3000/v1/shape?table=items", "handle-123")
      ExpiredShapesCache.clear()

      assert ExpiredShapesCache.get_expired_handle("http://localhost:3000/v1/shape?table=items") ==
               nil
    end
  end

  describe "mark_expired/2" do
    test "stores expired handle for shape key" do
      assert :ok = ExpiredShapesCache.mark_expired("shape-key-1", "expired-handle-1")
      assert ExpiredShapesCache.get_expired_handle("shape-key-1") == "expired-handle-1"
    end

    test "overwrites previous expired handle" do
      ExpiredShapesCache.mark_expired("shape-key-1", "old-handle")
      ExpiredShapesCache.mark_expired("shape-key-1", "new-handle")

      assert ExpiredShapesCache.get_expired_handle("shape-key-1") == "new-handle"
    end

    test "can store multiple shape keys" do
      ExpiredShapesCache.mark_expired("shape-key-1", "handle-1")
      ExpiredShapesCache.mark_expired("shape-key-2", "handle-2")
      ExpiredShapesCache.mark_expired("shape-key-3", "handle-3")

      assert ExpiredShapesCache.get_expired_handle("shape-key-1") == "handle-1"
      assert ExpiredShapesCache.get_expired_handle("shape-key-2") == "handle-2"
      assert ExpiredShapesCache.get_expired_handle("shape-key-3") == "handle-3"
    end
  end

  describe "LRU eviction" do
    test "evicts oldest entry when exceeding 250 entries" do
      # Insert 251 entries - the first one should be evicted
      for i <- 1..251 do
        ExpiredShapesCache.mark_expired("key-#{i}", "handle-#{i}")
      end

      # Wait briefly for the eviction to complete
      Process.sleep(10)

      # The first entry should have been evicted
      assert ExpiredShapesCache.get_expired_handle("key-1") == nil

      # Recent entries should still exist
      assert ExpiredShapesCache.get_expired_handle("key-251") == "handle-251"
      assert ExpiredShapesCache.get_expired_handle("key-250") == "handle-250"
    end

    test "accessing entry updates its LRU position" do
      # Insert entries up to the limit
      for i <- 1..250 do
        ExpiredShapesCache.mark_expired("key-#{i}", "handle-#{i}")
      end

      # Access key-1 to make it recently used
      assert ExpiredShapesCache.get_expired_handle("key-1") == "handle-1"

      # Wait briefly for the LRU update
      Process.sleep(10)

      # Insert one more entry to trigger eviction
      ExpiredShapesCache.mark_expired("key-251", "handle-251")

      # Wait for eviction
      Process.sleep(10)

      # key-1 should still exist because we accessed it
      assert ExpiredShapesCache.get_expired_handle("key-1") == "handle-1"

      # key-2 (which wasn't accessed) should have been evicted
      assert ExpiredShapesCache.get_expired_handle("key-2") == nil
    end
  end

  describe "size/0" do
    test "returns 0 for empty cache" do
      assert ExpiredShapesCache.size() == 0
    end

    test "returns correct count after marking" do
      ExpiredShapesCache.mark_expired("key-1", "handle-1")
      assert ExpiredShapesCache.size() == 1

      ExpiredShapesCache.mark_expired("key-2", "handle-2")
      assert ExpiredShapesCache.size() == 2
    end

    test "doesn't increase for duplicate keys" do
      ExpiredShapesCache.mark_expired("key-1", "handle-1")
      ExpiredShapesCache.mark_expired("key-1", "handle-2")

      assert ExpiredShapesCache.size() == 1
    end
  end

  describe "clear/0" do
    test "removes all entries" do
      for i <- 1..10 do
        ExpiredShapesCache.mark_expired("key-#{i}", "handle-#{i}")
      end

      assert ExpiredShapesCache.size() == 10

      ExpiredShapesCache.clear()

      assert ExpiredShapesCache.size() == 0
    end
  end
end
