defmodule Electric.TimelineCacheTest do
  use ExUnit.Case, async: false
  alias Electric.TimelineCache

  describe "get_timeline/1" do
    test "returns the timeline ID" do
      timeline = 5
      {:ok, pid} = TimelineCache.start_link(timeline)
      assert TimelineCache.get_timeline(pid) == timeline
    end
  end

  describe "store_timeline/2" do
    test "stores the timeline ID" do
      {:ok, pid} = TimelineCache.start_link(3)
      assert TimelineCache.store_timeline(pid, 4) == :ok
      assert TimelineCache.get_timeline(pid) == 4
    end
  end
end
