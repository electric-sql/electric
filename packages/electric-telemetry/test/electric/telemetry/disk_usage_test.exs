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
