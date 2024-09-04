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

    test "returns nil when no timeline ID is available", %{kv: kv} do
      assert Timeline.load_timeline(persistent_kv: kv) == nil
    end
  end

  describe "check/2" do
    @moduletag :tmp_dir

    setup context do
      timeline = context[:electric_timeline]
      kv = Electric.PersistentKV.Filesystem.new!(root: context.tmp_dir)
      opts = [persistent_kv: kv, shape_cache: {ShapeCache, []}]
      {:ok, [timeline: timeline, opts: opts]}
    end

    @tag electric_timeline: nil
    test "stores the Postgres timeline if Electric has no timeline yet", %{opts: opts} do
      timeline = 5
      assert :ok = Timeline.check(timeline, opts)
      assert ^timeline = Timeline.load_timeline(opts)
    end

    @tag electric_timeline: 3
    test "proceeds without changes if Postgres' timeline matches Electric's timeline", %{
      timeline: timeline,
      opts: opts
    } do
      assert :ok = Timeline.check(timeline, opts)
      assert ^timeline = Timeline.load_timeline(opts)
    end

    @tag electric_timeline: 3
    test "cleans all shapes if Postgres' timeline does not match Electric's timeline", %{
      opts: opts
    } do
      ShapeCache
      |> expect(:clean_all_shapes, fn _ -> :ok end)

      pg_timeline = 2
      assert :ok = Timeline.check(pg_timeline, opts)
      assert ^pg_timeline = Timeline.load_timeline(opts)
    end

    @tag electric_timeline: 3
    test "cleans all shapes if Postgres' timeline is unknown", %{opts: opts} do
      ShapeCache
      |> expect(:clean_all_shapes, fn _ -> :ok end)

      assert :ok = Timeline.check(nil, opts)
      assert Timeline.load_timeline(opts) == nil
    end
  end
end
