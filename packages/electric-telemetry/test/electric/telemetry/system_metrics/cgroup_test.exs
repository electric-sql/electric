defmodule ElectricTelemetry.SystemMetrics.CgroupTest do
  use ExUnit.Case, async: true

  @moduletag :tmp_dir

  alias ElectricTelemetry.SystemMetrics.Cgroup

  # Attach handlers for every cgroup.* event and collect emitted measurements
  # into a flat map of metric-name (dotted string) => value. Single-key
  # measurement maps make this unambiguous.
  defp collect_cgroup_metrics(fun) do
    test_pid = self()
    ref = make_ref()

    events = [
      [:cgroup, :memory],
      [:cgroup, :cpu],
      [:cgroup, :io],
      [:cgroup, :memory, :pressure, :full],
      [:cgroup, :cpu, :pressure, :full]
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

  describe "cgroup v2" do
    setup %{tmp_dir: tmp_dir} do
      root = Path.join(tmp_dir, "v2")

      write_file(root, "memory.current", "1048576\n")

      write_file(root, "memory.stat", """
      anon 524288
      file 262144
      inactive_file 131072
      slab 4096
      """)

      write_file(root, "memory.max", "max\n")

      write_file(root, "memory.pressure", """
      some avg10=1.50 avg60=0.30 avg300=0.10 total=12345
      full avg10=0.75 avg60=0.20 avg300=0.05 total=6789
      """)

      write_file(root, "cpu.stat", """
      usage_usec 9000000
      user_usec 6000000
      system_usec 3000000
      nr_periods 100
      nr_throttled 7
      throttled_usec 250000
      """)

      write_file(root, "cpu.pressure", """
      some avg10=2.00 avg60=0.50 avg300=0.10 total=99999
      full avg10=1.25 avg60=0.40 avg300=0.08 total=55555
      """)

      write_file(root, "io.stat", """
      259:0 rbytes=1000 wbytes=2000 rios=10 wios=20
      259:1 rbytes=500 wbytes=1500 rios=5 wios=15
      """)

      %{root: root}
    end

    test "emits parsed memory metrics", %{root: root} do
      m =
        collect_cgroup_metrics(fn ->
          Cgroup.measurement(%{}, cgroup_version: :v2, cgroup_root: root)
        end)

      assert m["cgroup.memory.current"] == 1_048_576
      assert m["cgroup.memory.anon"] == 524_288
      assert m["cgroup.memory.file"] == 262_144
      # working_set = current - inactive_file = 1048576 - 131072
      assert m["cgroup.memory.working_set"] == 1_048_576 - 131_072
    end

    test "skips memory.max when value is \"max\"", %{root: root} do
      m =
        collect_cgroup_metrics(fn ->
          Cgroup.measurement(%{}, cgroup_version: :v2, cgroup_root: root)
        end)

      refute Map.has_key?(m, "cgroup.memory.max")
    end

    test "emits a real numeric memory.max", %{root: root} do
      write_file(root, "memory.max", "2147483648\n")

      m =
        collect_cgroup_metrics(fn ->
          Cgroup.measurement(%{}, cgroup_version: :v2, cgroup_root: root)
        end)

      assert m["cgroup.memory.max"] == 2_147_483_648
    end

    test "parses PSI full avg10 for memory and cpu", %{root: root} do
      m =
        collect_cgroup_metrics(fn ->
          Cgroup.measurement(%{}, cgroup_version: :v2, cgroup_root: root)
        end)

      assert m["cgroup.memory.pressure.full.avg10"] == 0.75
      assert m["cgroup.cpu.pressure.full.avg10"] == 1.25
    end

    test "emits cpu usage / throttling in microseconds", %{root: root} do
      m =
        collect_cgroup_metrics(fn ->
          Cgroup.measurement(%{}, cgroup_version: :v2, cgroup_root: root)
        end)

      assert m["cgroup.cpu.usage_usec"] == 9_000_000
      assert m["cgroup.cpu.nr_throttled"] == 7
      assert m["cgroup.cpu.throttled_usec"] == 250_000
    end

    test "sums io rbytes/wbytes across devices", %{root: root} do
      m =
        collect_cgroup_metrics(fn ->
          Cgroup.measurement(%{}, cgroup_version: :v2, cgroup_root: root)
        end)

      assert m["cgroup.io.rbytes"] == 1500
      assert m["cgroup.io.wbytes"] == 3500
    end

    test "skips working_set when inactive_file is absent", %{root: root} do
      write_file(root, "memory.stat", "anon 524288\nfile 262144\n")

      m =
        collect_cgroup_metrics(fn ->
          Cgroup.measurement(%{}, cgroup_version: :v2, cgroup_root: root)
        end)

      refute Map.has_key?(m, "cgroup.memory.working_set")
      # other metrics still emitted
      assert m["cgroup.memory.anon"] == 524_288
    end

    test "skips PSI when pressure files are absent (kernel without PSI)", %{root: root} do
      File.rm!(Path.join(root, "memory.pressure"))
      File.rm!(Path.join(root, "cpu.pressure"))

      m =
        collect_cgroup_metrics(fn ->
          Cgroup.measurement(%{}, cgroup_version: :v2, cgroup_root: root)
        end)

      refute Map.has_key?(m, "cgroup.memory.pressure.full.avg10")
      refute Map.has_key?(m, "cgroup.cpu.pressure.full.avg10")
      # rest still works
      assert m["cgroup.memory.current"] == 1_048_576
    end
  end

  describe ":none / non-Linux" do
    test "no-ops and emits nothing", %{tmp_dir: tmp_dir} do
      m =
        collect_cgroup_metrics(fn ->
          assert :ok = Cgroup.measurement(%{}, cgroup_version: :none, cgroup_root: tmp_dir)
        end)

      assert m == %{}
    end
  end

  describe "malformed / missing files" do
    test "skips missing files without crashing, still emits available metrics", %{
      tmp_dir: tmp_dir
    } do
      root = Path.join(tmp_dir, "partial")
      # Only a memory.current and a malformed memory.stat; everything else absent.
      write_file(root, "memory.current", "4096\n")
      write_file(root, "memory.stat", "this is not valid\nanon notanumber\nfile 8192\n")

      m =
        collect_cgroup_metrics(fn ->
          assert :ok = Cgroup.measurement(%{}, cgroup_version: :v2, cgroup_root: root)
        end)

      assert m["cgroup.memory.current"] == 4096
      # malformed/absent keys are skipped
      refute Map.has_key?(m, "cgroup.memory.anon")
      assert m["cgroup.memory.file"] == 8192
      refute Map.has_key?(m, "cgroup.memory.working_set")
      # entirely-absent planes simply emit nothing
      refute Map.has_key?(m, "cgroup.cpu.usage_usec")
      refute Map.has_key?(m, "cgroup.io.rbytes")
    end

    test "empty io.stat emits nothing for io", %{tmp_dir: tmp_dir} do
      root = Path.join(tmp_dir, "emptyio")
      write_file(root, "io.stat", "")

      m =
        collect_cgroup_metrics(fn ->
          assert :ok = Cgroup.measurement(%{}, cgroup_version: :v2, cgroup_root: root)
        end)

      refute Map.has_key?(m, "cgroup.io.rbytes")
      refute Map.has_key?(m, "cgroup.io.wbytes")
    end
  end

  describe "metric definitions" do
    test "cgroup.* metrics are present in ApplicationTelemetry.metrics/1" do
      names =
        ElectricTelemetry.ApplicationTelemetry.metrics(%{})
        |> Enum.map(& &1.name)

      assert [:cgroup, :memory, :current] in names
      assert [:cgroup, :memory, :anon] in names
      assert [:cgroup, :memory, :file] in names
      assert [:cgroup, :memory, :working_set] in names
      assert [:cgroup, :memory, :max] in names
      assert [:cgroup, :memory, :pressure, :full, :avg10] in names
      assert [:cgroup, :cpu, :usage_usec] in names
      assert [:cgroup, :cpu, :nr_throttled] in names
      assert [:cgroup, :cpu, :throttled_usec] in names
      assert [:cgroup, :cpu, :pressure, :full, :avg10] in names
      assert [:cgroup, :io, :rbytes] in names
      assert [:cgroup, :io, :wbytes] in names
    end
  end
end
