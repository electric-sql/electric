defmodule Electric.TimelineCacheTest do
  use ExUnit.Case, async: false
  alias Electric.TimelineCache

  describe "get_timeline/1" do
    setup do
      %{kv: Electric.PersistentKV.Memory.new!()}
    end

    test "returns nil when no timeline ID is available", %{kv: kv} do
      {:ok, pid} = TimelineCache.start_link(persistent_kv: kv)
      assert TimelineCache.get_timeline(pid) == nil
    end

    test "returns the provided timeline ID", %{kv: kv} do
      timeline = 5
      {:ok, pid} = TimelineCache.start_link(timeline_id: timeline, persistent_kv: kv)
      assert TimelineCache.get_timeline(pid) == timeline
    end
  end

  describe "start_link/1" do
    setup do
      %{kv: Electric.PersistentKV.Memory.new!()}
    end

    test "persists provided timeline ID and loads timeline ID from storage", %{kv: kv} do
      timeline = 9
      # Start a timeline cache which will store the provided timeline ID
      {:ok, _pid} = TimelineCache.start_link(timeline_id: timeline, persistent_kv: kv)

      # Start another timeline cache without provided a timeline ID
      # it should load the one from persistent storage set by the timeline cache above
      {:ok, pid} = TimelineCache.start_link(persistent_kv: kv, name: :timeline_cache_2)
      assert TimelineCache.get_timeline(pid) == timeline
    end
  end

  describe "store_timeline/2" do
    setup do
      %{kv: Electric.PersistentKV.Memory.new!()}
    end

    test "stores the timeline ID", %{kv: kv} do
      {:ok, pid} = TimelineCache.start_link(timeline_id: 3, persistent_kv: kv)
      assert TimelineCache.get_timeline(pid) == 3
      assert TimelineCache.store_timeline(pid, 4) == :ok
      assert TimelineCache.get_timeline(pid) == 4
    end

    test "persists the timeline ID", %{kv: kv} do
      {:ok, cache1} = TimelineCache.start_link(timeline_id: 3, persistent_kv: kv)
      assert TimelineCache.get_timeline(cache1) == 3
      assert TimelineCache.store_timeline(cache1, 4) == :ok
      assert TimelineCache.get_timeline(cache1) == 4

      # Check that a fresh timeline cache also loads the timeline ID
      # that was persisted by the latest `store_timeline/2` call of the timeline cache above
      {:ok, cache2} = TimelineCache.start_link(persistent_kv: kv, name: :timeline_cache_2)
      assert TimelineCache.get_timeline(cache2) == 4
    end
  end
end
