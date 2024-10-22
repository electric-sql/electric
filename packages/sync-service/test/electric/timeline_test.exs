defmodule Electric.TimelineTest do
  use ExUnit.Case, async: true

  alias Electric.Timeline

  @moduletag :tmp_dir
  @tenant_id "test_tenant"

  describe "load_timeline/1" do
    setup context do
      %{
        opts: [
          persistent_kv: Electric.PersistentKV.Filesystem.new!(root: context.tmp_dir),
          tenant_id: @tenant_id
        ]
      }
    end

    test "returns nil when no timeline is available", %{opts: opts} do
      assert Timeline.load_timeline(opts) == nil
    end
  end

  describe "store_timeline/2" do
    setup context do
      %{
        opts: [
          persistent_kv: Electric.PersistentKV.Filesystem.new!(root: context.tmp_dir),
          tenant_id: @tenant_id
        ]
      }
    end

    test "stores the timeline", %{opts: opts} do
      timeline = {1, 2}
      Timeline.store_timeline(timeline, opts)
      assert ^timeline = Timeline.load_timeline(opts)
    end
  end

  describe "check/2" do
    setup context do
      timeline = context[:electric_timeline]
      kv = Electric.PersistentKV.Filesystem.new!(root: context.tmp_dir)
      opts = [persistent_kv: kv, shape_cache: {ShapeCache, []}, tenant_id: @tenant_id]

      if timeline != nil do
        Timeline.store_timeline(timeline, opts)
      end

      {:ok, [timeline: timeline, opts: opts]}
    end

    @tag electric_timeline: nil
    test "stores the timeline if Electric has no timeline yet", %{opts: opts} do
      assert Timeline.load_timeline(opts) == nil

      timeline = {2, 5}

      assert :ok = Timeline.check(timeline, opts)
      assert ^timeline = Timeline.load_timeline(opts)
    end

    @tag electric_timeline: {1, 2}
    test "proceeds without changes if Postgres' timeline matches Electric's timeline", %{
      timeline: timeline,
      opts: opts
    } do
      assert ^timeline = Timeline.load_timeline(opts)
      assert :ok = Timeline.check(timeline, opts)
      assert ^timeline = Timeline.load_timeline(opts)
    end

    @tag electric_timeline: {1, 3}
    test "returns :timeline_changed on Point In Time Recovery (PITR)", %{
      timeline: timeline,
      opts: opts
    } do
      assert ^timeline = Timeline.load_timeline(opts)

      pg_timeline = {1, 2}
      assert :timeline_changed = Timeline.check(pg_timeline, opts)

      assert ^pg_timeline = Timeline.load_timeline(opts)
    end

    @tag electric_timeline: {1, 3}
    test "returns :timeline_changed when Postgres DB changed", %{
      timeline: timeline,
      opts: opts
    } do
      assert ^timeline = Timeline.load_timeline(opts)

      pg_timeline = {2, 3}
      assert :timeline_changed = Timeline.check(pg_timeline, opts)
      assert ^pg_timeline = Timeline.load_timeline(opts)
    end
  end
end
