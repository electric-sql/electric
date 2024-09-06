defmodule Electric.TimelineTest do
  use ExUnit.Case, async: true
  alias Electric.Timeline
  alias Electric.TimelineCache
  alias Electric.ShapeCacheMock

  import Mox

  describe "check/2" do
    setup context do
      timeline = context[:electric_timeline]

      pid =
        case timeline do
          nil ->
            {:ok, pid} = TimelineCache.start_link()
            pid

          _ ->
            {:ok, pid} = TimelineCache.start_link(timeline)
            pid
        end

      opts = [timeline_cache: pid, shape_cache: {ShapeCacheMock, []}]
      {:ok, [timeline: timeline, opts: opts]}
    end

    @tag electric_timeline: nil
    test "stores the Postgres timeline if Electric has no timeline yet", %{opts: opts} do
      timeline = 5
      assert :ok = Timeline.check(timeline, opts)
      assert ^timeline = TimelineCache.get_timeline(opts[:timeline_cache])
    end

    @tag electric_timeline: 3
    test "proceeds without changes if Postgres' timeline matches Electric's timeline", %{
      timeline: timeline,
      opts: opts
    } do
      assert :ok = Timeline.check(timeline, opts)
      assert ^timeline = TimelineCache.get_timeline(opts[:timeline_cache])
    end

    @tag electric_timeline: 3
    test "cleans all shapes if Postgres' timeline does not match Electric's timeline", %{
      opts: opts
    } do
      ShapeCacheMock
      |> expect(:clean_all_shapes, fn _ -> :ok end)

      pg_timeline = 4
      assert :ok = Timeline.check(pg_timeline, opts)
      assert ^pg_timeline = TimelineCache.get_timeline(opts[:timeline_cache])
    end

    @tag electric_timeline: 3
    test "cleans all shapes if Postgres' timeline is unknown", %{opts: opts} do
      ShapeCacheMock
      |> expect(:clean_all_shapes, fn _ -> :ok end)

      assert :ok = Timeline.check(nil, opts)
      assert TimelineCache.get_timeline(opts[:timeline_cache]) == nil
    end
  end
end
