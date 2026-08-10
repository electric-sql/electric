defmodule ElectricTelemetry.SystemMetrics.Cgroup do
  @moduledoc """
  Reads cgroup v2 accounting files from `/sys/fs/cgroup/*` and emits `cgroup.*`
  telemetry.

  All reads are defensive: a missing file, a permission error, or unexpected
  content results in the corresponding metric being skipped, never a crash. The
  cgroup version is taken from `ElectricTelemetry.SystemMetrics.system_info/0`
  (cached at boot) so we never stat the filesystem on the hot path. Anything
  other than v2 (cgroup v1 hosts, non-Linux platforms) is a clean no-op.

  Units: memory and io metrics are bytes, cpu usage / throttled time are
  microseconds, PSI `full avg10` is a stall percentage (float).
  """

  alias ElectricTelemetry.SystemMetrics

  import ElectricTelemetry.SystemMetrics, only: [emit: 2]

  import ElectricTelemetry.SystemMetrics.ProcfsParse,
    only: [read_kv_file: 2, read_int_file: 1, read_raw_file: 1, parse_int: 1, parse_float: 1]

  @default_root "/sys/fs/cgroup"

  @files %{
    memory_current: "memory.current",
    memory_stat: "memory.stat",
    memory_max: "memory.max",
    memory_pressure: "memory.pressure",
    cpu_stat: "cpu.stat",
    cpu_pressure: "cpu.pressure",
    io_stat: "io.stat"
  }
  @default_paths Map.new(@files, fn {key, file} -> {key, Path.join(@default_root, file)} end)

  @memory_stat_keys MapSet.new(~w(anon file inactive_file))
  @cpu_stat_keys MapSet.new(~w(usage_usec nr_throttled throttled_usec))

  @doc """
  Read the cgroup accounting files and emit `cgroup.*` telemetry events.

  Reads every tick (no slow-tier gating). Options:

    * `:cgroup_root` — override the cgroup filesystem root (default
      `#{@default_root}`); used by tests to point at fixture trees.
    * `:cgroup_version` — override the detected cgroup version (`:v2`/`:none`);
      used by tests. Defaults to the cached `SystemMetrics.system_info/0` value.
  """
  @spec measurement(map(), keyword()) :: :ok
  def measurement(_telemetry_opts, opts \\ []) do
    version =
      Keyword.get_lazy(opts, :cgroup_version, fn -> SystemMetrics.system_info().cgroup_version end)

    if version == :v2 do
      paths = opts |> Keyword.get(:cgroup_root, @default_root) |> paths()
      emit_memory(paths)
      emit_cpu(paths)
      emit([:cgroup, :io], io_totals(read_raw_file(paths.io_stat)))
    end

    :ok
  end

  # The production file paths are compile-time constants; only tests pass a
  # different root.
  defp paths(@default_root), do: @default_paths
  defp paths(root), do: Map.new(@files, fn {key, file} -> {key, Path.join(root, file)} end)

  defp emit_memory(paths) do
    current = read_int_file(paths.memory_current)
    stat = read_kv_file(paths.memory_stat, @memory_stat_keys)
    inactive_file = stat["inactive_file"]

    emit([:cgroup, :memory], %{
      current: current,
      anon: stat["anon"],
      file: stat["file"],
      working_set: current && inactive_file && max(current - inactive_file, 0),
      # An unlimited memory.max is the literal "max", which parses to nil and is
      # skipped (the host-RAM ceiling comes from the /proc reader).
      max: read_int_file(paths.memory_max)
    })

    emit_pressure(paths.memory_pressure, :memory)
  end

  defp emit_cpu(paths) do
    stat = read_kv_file(paths.cpu_stat, @cpu_stat_keys)

    emit([:cgroup, :cpu], %{
      usage_usec: stat["usage_usec"],
      nr_throttled: stat["nr_throttled"],
      throttled_usec: stat["throttled_usec"]
    })

    emit_pressure(paths.cpu_pressure, :cpu)
  end

  # PSI files may be absent even on v2 (kernel built without PSI); a nil avg10
  # is dropped by emit/2, skipping the event.
  defp emit_pressure(path, plane) do
    emit([:cgroup, plane, :pressure, :full], %{avg10: psi_full_avg10(read_raw_file(path))})
  end

  # io.stat is one line per device: "MAJ:MIN rbytes=… wbytes=… rios=… …".
  # Sum rbytes/wbytes across all devices; a key never seen stays absent.
  defp io_totals(nil), do: %{}

  defp io_totals(content) do
    for field <- String.split(content), reduce: %{} do
      acc ->
        case field do
          "rbytes=" <> value -> add_field(acc, :rbytes, parse_int(value))
          "wbytes=" <> value -> add_field(acc, :wbytes, parse_int(value))
          _ -> acc
        end
    end
  end

  defp add_field(acc, _key, nil), do: acc
  defp add_field(acc, key, value), do: Map.update(acc, key, value, &(&1 + value))

  # PSI file format (one "some"/"full" line each):
  #   some avg10=0.00 avg60=0.00 avg300=0.00 total=12345
  #   full avg10=0.00 avg60=0.00 avg300=0.05 total=6789
  # Extract avg10 from the "full" line as a float.
  defp psi_full_avg10(nil), do: nil

  defp psi_full_avg10(content) do
    content
    |> String.split("\n", trim: true)
    |> Enum.find_value(fn line ->
      case String.split(line, " ", trim: true) do
        ["full" | fields] ->
          Enum.find_value(fields, fn
            "avg10=" <> rest -> parse_float(rest)
            _ -> nil
          end)

        _ ->
          nil
      end
    end)
  end
end
