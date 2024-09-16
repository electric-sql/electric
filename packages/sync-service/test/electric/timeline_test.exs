defmodule Electric.TimelineTest do
  use ExUnit.Case, async: true
  alias Electric.Timeline
  alias Support.Mock.ShapeCache

  import Mox

  describe "load_timeline/1" do
    @moduletag :tmp_dir

    setup context do
      %{kv: Electric.PersistentKV.Filesystem.new!(root: context.tmp_dir)}
    end

    test "returns nil when no timeline is available", %{kv: kv} do
      assert Timeline.load_timeline(persistent_kv: kv) == nil
    end
  end

  describe "store_timeline/2" do
    @moduletag :tmp_dir

    setup context do
      %{opts: [persistent_kv: Electric.PersistentKV.Filesystem.new!(root: context.tmp_dir)]}
    end

    test "stores the timeline", %{opts: opts} do
      timeline = {1, 2}
      Timeline.store_timeline(timeline, opts)
      assert ^timeline = Timeline.load_timeline(opts)
    end
  end

  describe "check/2" do
    @moduletag :tmp_dir

    setup context do
      timeline = context[:electric_timeline]
      kv = Electric.PersistentKV.Filesystem.new!(root: context.tmp_dir)
      opts = [persistent_kv: kv, shape_cache: {ShapeCache, []}]

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
      expect(ShapeCache, :clean_all_shapes, 0, fn _ -> :ok end)
      assert ^timeline = Timeline.load_timeline(opts)
      assert :ok = Timeline.check(timeline, opts)
      assert ^timeline = Timeline.load_timeline(opts)
    end

    @tag electric_timeline: {1, 3}
    test "cleans all shapes on Point In Time Recovery (PITR)", %{
      timeline: timeline,
      opts: opts
    } do
      expect(ShapeCache, :clean_all_shapes, 1, fn _ -> :ok end)
      assert ^timeline = Timeline.load_timeline(opts)

      pg_timeline = {1, 2}
      assert :ok = Timeline.check(pg_timeline, opts)

      assert ^pg_timeline = Timeline.load_timeline(opts)
    end

    # TODO: add log output checks

    @tag electric_timeline: {1, 3}
    test "cleans all shapes when Postgres DB changed", %{timeline: timeline, opts: opts} do
      expect(ShapeCache, :clean_all_shapes, 1, fn _ -> :ok end)
      assert ^timeline = Timeline.load_timeline(opts)

      pg_timeline = {2, 3}
      assert :ok = Timeline.check(pg_timeline, opts)
      assert ^pg_timeline = Timeline.load_timeline(opts)
    end
  end
end
