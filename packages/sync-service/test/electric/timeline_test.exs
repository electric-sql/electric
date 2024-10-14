defmodule Electric.TimelineTest do
  use ExUnit.Case, async: true

  alias Electric.Timeline

  describe "load_timeline/1" do
    @moduletag :tmp_dir

    setup context do
      %{kv: Electric.PersistentKV.Filesystem.new!(root: context.tmp_dir)}
    end

    test "returns nil when no timeline is available", %{kv: kv} do
      assert Timeline.load_timeline(kv) == nil
    end
  end

  describe "store_timeline/2" do
    @moduletag :tmp_dir

    setup context do
      %{persistent_kv: Electric.PersistentKV.Filesystem.new!(root: context.tmp_dir)}
    end

    test "stores the timeline", %{persistent_kv: persistent_kv} do
      timeline = {1, 2}
      Timeline.store_timeline(timeline, persistent_kv)
      assert ^timeline = Timeline.load_timeline(persistent_kv)
    end
  end

  describe "check/2" do
    @moduletag :tmp_dir

    setup context do
      timeline = context[:electric_timeline]
      kv = Electric.PersistentKV.Filesystem.new!(root: context.tmp_dir)

      if timeline != nil do
        Timeline.store_timeline(timeline, kv)
      end

      {:ok, [timeline: timeline, persistent_kv: kv]}
    end

    @tag electric_timeline: nil
    test "stores the timeline if Electric has no timeline yet", %{persistent_kv: kv} do
      assert Timeline.load_timeline(kv) == nil

      timeline = {2, 5}

      assert :ok = Timeline.check(timeline, kv)
      assert ^timeline = Timeline.load_timeline(kv)
    end

    @tag electric_timeline: {1, 2}
    test "proceeds without changes if Postgres' timeline matches Electric's timeline", %{
      timeline: timeline,
      persistent_kv: kv
    } do
      assert ^timeline = Timeline.load_timeline(kv)
      assert :ok = Timeline.check(timeline, kv)
      assert ^timeline = Timeline.load_timeline(kv)
    end

    @tag electric_timeline: {1, 3}
    test "returns :timeline_changed on Point In Time Recovery (PITR)", %{
      timeline: timeline,
      persistent_kv: kv
    } do
      assert ^timeline = Timeline.load_timeline(kv)

      pg_timeline = {1, 2}
      assert :timeline_changed = Timeline.check(pg_timeline, kv)

      assert ^pg_timeline = Timeline.load_timeline(kv)
    end

    # TODO: add log output checks

    @tag electric_timeline: {1, 3}
    test "returns :timeline_changed when Postgres DB changed", %{
      timeline: timeline,
      persistent_kv: kv
    } do
      assert ^timeline = Timeline.load_timeline(kv)

      pg_timeline = {2, 3}
      assert :timeline_changed = Timeline.check(pg_timeline, kv)
      assert ^pg_timeline = Timeline.load_timeline(kv)
    end
  end
end
