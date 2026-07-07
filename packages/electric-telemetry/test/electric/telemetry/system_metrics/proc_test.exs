defmodule ElectricTelemetry.SystemMetrics.ProcTest do
  use ExUnit.Case, async: true

  @moduletag :tmp_dir

  alias ElectricTelemetry.SystemMetrics.Proc

  @pid "4242"

  # Attach handlers for every host.* event and collect emitted measurements
  # into a flat map of metric-name (dotted string) => value. Single-key
  # measurement maps make this unambiguous.
  defp collect_host_metrics(fun) do
    test_pid = self()
    ref = make_ref()

    events = [
      [:host, :proc, :beam],
      [:host, :proc, :beam, :io]
    ]

    handler_id = {__MODULE__, ref}

    :telemetry.attach_many(
      handler_id,
      events,
      fn event, measurements, _meta, _ ->
        send(test_pid, {ref, event, measurements})
      end,
      nil
    )

    try do
      fun.()
    after
      :telemetry.detach(handler_id)
    end

    drain(ref, %{})
  end

  defp drain(ref, acc) do
    receive do
      {^ref, event, measurements} ->
        name = event |> Enum.map(&Atom.to_string/1) |> Enum.join(".")

        acc =
          Enum.reduce(measurements, acc, fn {k, v}, acc ->
            Map.put(acc, "#{name}.#{k}", v)
          end)

        drain(ref, acc)
    after
      0 -> acc
    end
  end

  defp write_file(root, rel, content) do
    path = Path.join(root, rel)
    File.mkdir_p!(Path.dirname(path))
    File.write!(path, content)
  end

  defp status do
    """
    Name:\tbeam.smp
    State:\tS (sleeping)
    Pid:\t4242
    VmPeak:\t 2000000 kB
    VmRSS:\t  500000 kB
    RssAnon:\t  300000 kB
    RssFile:\t  150000 kB
    RssShmem:\t  50000 kB
    Threads:\t42
    """
  end

  defp proc_io do
    """
    rchar: 123456789
    wchar: 987654321
    syscr: 1000
    syscw: 2000
    read_bytes: 65536
    write_bytes: 131072
    cancelled_write_bytes: 0
    """
  end

  describe "linux /proc" do
    setup %{tmp_dir: tmp_dir} do
      root = Path.join(tmp_dir, "proc")

      write_file(root, "#{@pid}/status", status())
      write_file(root, "#{@pid}/io", proc_io())

      %{root: root}
    end

    test "emits BEAM Rss*/VmRSS in bytes (kB * 1024)", %{root: root} do
      m =
        collect_host_metrics(fn ->
          Proc.measurement(%{}, os: {:unix, :linux}, proc_root: root, pid: @pid)
        end)

      assert m["host.proc.beam.rss_anon"] == 300_000 * 1024
      assert m["host.proc.beam.rss_file"] == 150_000 * 1024
      assert m["host.proc.beam.rss_shmem"] == 50_000 * 1024
      assert m["host.proc.beam.vm_rss"] == 500_000 * 1024
    end

    test "emits BEAM io read/write in bytes (no scaling)", %{root: root} do
      m =
        collect_host_metrics(fn ->
          Proc.measurement(%{}, os: {:unix, :linux}, proc_root: root, pid: @pid)
        end)

      assert m["host.proc.beam.io.read_bytes"] == 65_536
      assert m["host.proc.beam.io.write_bytes"] == 131_072
    end

    test "io read_bytes/write_bytes are not multiplied by 1024", %{root: root} do
      m =
        collect_host_metrics(fn ->
          Proc.measurement(%{}, os: {:unix, :linux}, proc_root: root, pid: @pid)
        end)

      refute m["host.proc.beam.io.read_bytes"] == 65_536 * 1024
    end
  end

  describe "non-linux guard" do
    test "no-ops and emits nothing on macOS", %{tmp_dir: tmp_dir} do
      root = Path.join(tmp_dir, "proc")
      write_file(root, "#{@pid}/status", status())
      write_file(root, "#{@pid}/io", proc_io())

      m =
        collect_host_metrics(fn ->
          assert :ok =
                   Proc.measurement(%{}, os: {:unix, :darwin}, proc_root: root, pid: @pid)
        end)

      assert m == %{}
    end
  end

  describe "missing / malformed files" do
    test "missing status file skips beam.rss_* but other metrics still emit", %{tmp_dir: tmp_dir} do
      root = Path.join(tmp_dir, "proc")
      write_file(root, "#{@pid}/io", proc_io())

      m =
        collect_host_metrics(fn ->
          assert :ok = Proc.measurement(%{}, os: {:unix, :linux}, proc_root: root, pid: @pid)
        end)

      refute Map.has_key?(m, "host.proc.beam.rss_anon")
      refute Map.has_key?(m, "host.proc.beam.vm_rss")
      assert m["host.proc.beam.io.read_bytes"] == 65_536
    end

    test "missing/unreadable io file skips io metrics but memory metrics still emit", %{
      tmp_dir: tmp_dir
    } do
      root = Path.join(tmp_dir, "proc")
      write_file(root, "#{@pid}/status", status())
      # no io file written

      m =
        collect_host_metrics(fn ->
          assert :ok = Proc.measurement(%{}, os: {:unix, :linux}, proc_root: root, pid: @pid)
        end)

      refute Map.has_key?(m, "host.proc.beam.io.read_bytes")
      refute Map.has_key?(m, "host.proc.beam.io.write_bytes")
      assert m["host.proc.beam.rss_anon"] == 300_000 * 1024
    end

    test "malformed value skips that metric, others still emitted", %{tmp_dir: tmp_dir} do
      root = Path.join(tmp_dir, "proc")

      write_file(root, "#{@pid}/status", """
      VmRSS:\t  garbage kB
      RssAnon:\t  300000 kB
      """)

      write_file(root, "#{@pid}/io", """
      read_bytes: nope
      write_bytes: 131072
      """)

      m =
        collect_host_metrics(fn ->
          assert :ok = Proc.measurement(%{}, os: {:unix, :linux}, proc_root: root, pid: @pid)
        end)

      refute Map.has_key?(m, "host.proc.beam.vm_rss")
      assert m["host.proc.beam.rss_anon"] == 300_000 * 1024

      refute Map.has_key?(m, "host.proc.beam.io.read_bytes")
      assert m["host.proc.beam.io.write_bytes"] == 131_072
    end

    test "all files missing emits nothing, no crash", %{tmp_dir: tmp_dir} do
      root = Path.join(tmp_dir, "empty")

      m =
        collect_host_metrics(fn ->
          assert :ok = Proc.measurement(%{}, os: {:unix, :linux}, proc_root: root, pid: @pid)
        end)

      assert m == %{}
    end
  end

  describe "metric definitions" do
    test "host.* metrics are present in ApplicationTelemetry.metrics/1" do
      names =
        ElectricTelemetry.ApplicationTelemetry.metrics(%{})
        |> Enum.map(& &1.name)

      assert [:host, :proc, :beam, :rss_anon] in names
      assert [:host, :proc, :beam, :rss_file] in names
      assert [:host, :proc, :beam, :rss_shmem] in names
      assert [:host, :proc, :beam, :vm_rss] in names
      assert [:host, :proc, :beam, :io, :read_bytes] in names
      assert [:host, :proc, :beam, :io, :write_bytes] in names
    end
  end
end
