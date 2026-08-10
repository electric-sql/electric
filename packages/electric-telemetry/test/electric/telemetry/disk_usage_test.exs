defmodule ElectricTelemetry.DiskUsageTest do
  use ExUnit.Case, async: true

  alias ElectricTelemetry.DiskUsage

  @moduletag :tmp_dir

  defp generate_data(%{tmp_dir: storage_dir}, max_files \\ 10) do
    dir =
      "#{abs(System.monotonic_time())}/#{System.unique_integer([:positive, :monotonic])}/shape-id"

    base = Path.join(storage_dir, dir)
    File.mkdir_p!(base)
    file_count = Enum.random(1..max_files)

    Enum.reduce(1..file_count, 0, fn n, bytes ->
      file_size = Enum.random(100..2048)
      data = :binary.copy("0", file_size)
      File.write!(Path.join(base, "#{n}.data"), data, [:raw, :binary])
      bytes + file_size
    end)
  end

  setup(ctx) do
    stack_id = "#{inspect(__MODULE__)}#{System.monotonic_time()}"

    ctx = Map.put(ctx, :stack_id, stack_id)

    if Map.get(ctx, :start_usage, true) do
      start_usage(ctx)
    else
      ctx
    end
  end

  test "calculates disk usage from all files under dir", ctx do
    assert eventually_read_usage(ctx, 0)
    bytes = generate_data(ctx)
    :ok = DiskUsage.update(ctx.usage)
    assert eventually_read_usage(ctx, bytes)
  end

  @tag manual_refresh: false, update_period: 1
  test "writes to storage dir are counted in the usage", ctx do
    assert eventually_read_usage(ctx, 0)
    bytes = generate_data(ctx)
    assert eventually_read_usage(ctx, bytes)
    bytes2 = generate_data(ctx)
    assert eventually_read_usage(ctx, bytes + bytes2)
  end

  @tag start_usage: false
  test "value is preserved between restarts", ctx do
    bytes = generate_data(ctx)
    ctx = start_usage(ctx)
    :ok = DiskUsage.update(ctx.usage)
    assert eventually_read_usage(ctx, bytes)

    stop_usage(ctx)
    ctx = start_usage(ctx)
    assert eventually_read_usage(ctx, bytes)
  end

  @tag start_usage: false
  test "ensures storage_dir exists before writing to it", ctx do
    ctx =
      start_usage(%{ctx | tmp_dir: Path.join(ctx.tmp_dir, "dir#{System.monotonic_time()}-#{}")})

    Process.link(ctx.usage)
    :ok = DiskUsage.update(ctx.usage)
  end

  describe "per-directory grouping (top-N)" do
    # Mirror the real electric shape storage layout, where DiskUsage walks the
    # per-stack `shapes` root and a shape lives at
    # `<walk_root>/<stack_id>/<p1>/<p2>/<shape_handle>` (the two-level shard is
    # the first two char-pairs of the handle; see
    # Electric.ShapeCache.PureFileStorage.shape_data_dir/3). The shape handle
    # therefore sits at depth 4 below the walk root.
    @shape_dir_depth 4

    defp make_shape(walk_root, stack_id, handle, bytes) do
      <<p1::binary-2, p2::binary-2, _::binary>> = handle
      base = Path.join([walk_root, stack_id, p1, p2, handle])
      File.mkdir_p!(base)
      File.write!(Path.join(base, "1.data"), :binary.copy("0", bytes), [:raw, :binary])
      bytes
    end

    defp make_shape(ctx, handle, bytes) when is_map(ctx) do
      make_shape(ctx.tmp_dir, ctx.stack_id, handle, bytes)
    end

    @tag start_usage: false
    test "emits only the top-N largest shapes", ctx do
      # 5 shapes with distinct handles and sizes, ask for top 3.
      make_shape(ctx, "aaaa1111", 100)
      make_shape(ctx, "bbbb2222", 500)
      make_shape(ctx, "cccc3333", 300)
      make_shape(ctx, "dddd4444", 50)
      make_shape(ctx, "eeee5555", 400)

      ctx = start_usage_grouped(ctx, group_depth: @shape_dir_depth, top_n: 3)
      :ok = DiskUsage.update(ctx.usage)

      assert {:ok, 1350, _} = DiskUsage.current(ctx.stack_id)

      assert {:ok, top} = DiskUsage.current_dirs(ctx.stack_id)
      # Sorted desc by size, only the 3 largest, smaller ones dropped.
      assert top == [{"bbbb2222", 500}, {"eeee5555", 400}, {"cccc3333", 300}]
      handles = Enum.map(top, &elem(&1, 0))
      refute "aaaa1111" in handles
      refute "dddd4444" in handles
    end

    @tag start_usage: false
    test "tag values are the shape_handle dir names", ctx do
      make_shape(ctx, "abcd1234handle", 10)

      ctx = start_usage_grouped(ctx, group_depth: @shape_dir_depth, top_n: 10)
      :ok = DiskUsage.update(ctx.usage)

      assert {:ok, [{"abcd1234handle", 10}]} = DiskUsage.current_dirs(ctx.stack_id)
    end

    @tag start_usage: false
    test "wrong (too shallow) group_depth buckets by hash-prefix, not handle", ctx do
      # Regression guard for the off-by-one bug: bucketing one level too shallow
      # keys by the 2-char shard prefix `<p2>`, aggregating many shapes into one
      # bucket instead of reporting per shape. Two shapes that share a shard
      # prefix must collapse together at the wrong depth.
      make_shape(ctx, "zzaa1111", 10)
      make_shape(ctx, "zzaa2222", 20)

      # @shape_dir_depth - 1 == bucket by <p2> ("aa"), which both shapes share.
      ctx = start_usage_grouped(ctx, group_depth: @shape_dir_depth - 1, top_n: 10)
      :ok = DiskUsage.update(ctx.usage)

      assert {:ok, [{"aa", 30}]} = DiskUsage.current_dirs(ctx.stack_id)
    end

    @tag start_usage: false
    test "grouping disabled by default leaves current_dirs pending", ctx do
      make_shape(ctx, "aaaa1111", 10)
      ctx = start_usage(ctx)
      :ok = DiskUsage.update(ctx.usage)

      assert {:ok, 10, _} = DiskUsage.current(ctx.stack_id)
      assert :pending = DiskUsage.current_dirs(ctx.stack_id)
    end

    @tag start_usage: false
    test "total stays correct alongside grouping", ctx do
      total =
        make_shape(ctx, "aaaa1111", 100) +
          make_shape(ctx, "bbbb2222", 250)

      ctx = start_usage_grouped(ctx, group_depth: @shape_dir_depth)
      :ok = DiskUsage.update(ctx.usage)

      assert {:ok, ^total, _} = DiskUsage.current(ctx.stack_id)
    end
  end

  defp start_usage_grouped(ctx, opts) do
    {:ok, usage_pid} =
      DiskUsage.start_link(
        [
          stack_id: ctx.stack_id,
          storage_dir: ctx.tmp_dir,
          manual_refresh: true,
          update_period: 1_000
        ] ++ opts
      )

    Map.put(ctx, :usage, usage_pid)
  end

  defp stop_usage(ctx) do
    ref = Process.monitor(ctx.usage)
    Process.unlink(ctx.usage)
    Process.exit(ctx.usage, :kill)
    assert_receive {:DOWN, ^ref, :process, _pid, :killed}
  end

  defp start_usage(ctx) do
    {:ok, usage_pid} =
      DiskUsage.start_link(
        stack_id: ctx.stack_id,
        storage_dir: ctx.tmp_dir,
        manual_refresh: Map.get(ctx, :manual_refresh, true),
        update_period: Map.get(ctx, :update_period, 1_000)
      )

    Map.put(ctx, :usage, usage_pid)
  end

  defp eventually_read_usage(ctx, expected_bytes, read \\ nil, n \\ 50)

  defp eventually_read_usage(_ctx, expected_bytes, read, 0) do
    flunk("expected #{expected_bytes} got #{read}")
  end

  defp eventually_read_usage(ctx, expected_bytes, _read, n) do
    case DiskUsage.current(ctx.stack_id) do
      {:ok, ^expected_bytes, _duration} ->
        true

      {:ok, bytes, _duration} ->
        Process.sleep(20)
        eventually_read_usage(ctx, expected_bytes, bytes, n - 1)

      :pending ->
        Process.sleep(20)
        eventually_read_usage(ctx, expected_bytes, nil, n - 1)
    end
  end
end
