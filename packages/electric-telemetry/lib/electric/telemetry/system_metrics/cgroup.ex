defmodule ElectricTelemetry.SystemMetrics.Cgroup do
  @moduledoc """
  Reads cgroup (v1 and v2) accounting files and emits `cgroup.*` telemetry.

  Electric Cloud runs on cgroup v2 (container at the root of its own cgroup
  namespace), so v2 controllers are read directly from `/sys/fs/cgroup/*`. v1 is
  the legacy/fallback layout (Fargate and other hosts) where controllers live
  under per-controller subdirs (`/sys/fs/cgroup/memory/`, `/sys/fs/cgroup/cpu/`,
  …).

  All reads are defensive: a missing file, a permission error, or unexpected
  content results in the corresponding metric being skipped, never a crash. The
  cgroup version is taken from `ElectricTelemetry.SystemMetrics.system_info/0`
  (cached at boot) so we never stat the filesystem on the hot path. When the
  version is `:none` (including all non-Linux platforms) the measurement is a
  clean no-op.

  Units:

    * memory metrics are bytes
    * cpu usage / throttled time are emitted in **microseconds**. v1 reports
      these in nanoseconds (`cpuacct.usage`, `cpu.stat` `throttled_time`), so we
      convert to microseconds for a unit consistent with v2's `usage_usec` /
      `throttled_usec`.
    * io metrics are bytes
    * PSI `full avg10` is a stall percentage (float). PSI exists on v2 only.
  """

  alias ElectricTelemetry.SystemMetrics

  @default_root "/sys/fs/cgroup"

  @doc """
  The default cgroup filesystem root. Tests override this via the `:cgroup_root`
  option on `measurement/2`.
  """
  @spec default_root() :: String.t()
  def default_root, do: @default_root

  @doc """
  Read the cgroup accounting files and emit `cgroup.*` telemetry events.

  Reads every tick (no slow-tier gating). Options:

    * `:cgroup_root` — override the cgroup filesystem root (default
      `#{@default_root}`); used by tests to point at fixture trees.
    * `:cgroup_version` — override the detected cgroup version (`:v1`/`:v2`/
      `:none`); used by tests. Defaults to the cached
      `SystemMetrics.system_info/0` value.
  """
  @spec measurement(map(), keyword()) :: :ok
  def measurement(_telemetry_opts, opts \\ []) do
    version =
      Keyword.get_lazy(opts, :cgroup_version, fn -> SystemMetrics.system_info().cgroup_version end)

    root = Keyword.get(opts, :cgroup_root, @default_root)

    case version do
      :v2 -> read_v2(root)
      :v1 -> read_v1(root)
      :none -> :ok
    end

    :ok
  end

  ## cgroup v2 -------------------------------------------------------------

  defp read_v2(root) do
    emit_v2_memory(root)
    emit_v2_cpu(root)
    emit_v2_io(root)
  end

  defp emit_v2_memory(root) do
    current = read_int_file(Path.join(root, "memory.current"))
    stat = read_stat_file(Path.join(root, "memory.stat"))

    emit(:memory, :current, current)
    emit(:memory, :anon, Map.get(stat, "anon"))
    emit(:memory, :file, Map.get(stat, "file"))
    emit(:memory, :working_set, working_set(current, Map.get(stat, "inactive_file")))
    emit(:memory, :max, real_limit(read_raw_file(Path.join(root, "memory.max"))))

    emit_pressure(Path.join(root, "memory.pressure"), :memory)
  end

  defp emit_v2_cpu(root) do
    stat = read_stat_file(Path.join(root, "cpu.stat"))

    emit(:cpu, :usage_usec, Map.get(stat, "usage_usec"))
    emit(:cpu, :nr_throttled, Map.get(stat, "nr_throttled"))
    emit(:cpu, :throttled_usec, Map.get(stat, "throttled_usec"))

    emit_pressure(Path.join(root, "cpu.pressure"), :cpu)
  end

  defp emit_v2_io(root) do
    io = parse_io_stat(read_raw_file(Path.join(root, "io.stat")))

    emit(:io, :rbytes, io.rbytes)
    emit(:io, :wbytes, io.wbytes)
  end

  ## cgroup v1 -------------------------------------------------------------

  defp read_v1(root) do
    emit_v1_memory(root)
    emit_v1_cpu(root)
    # NOTE: v1 blkio accounting (blkio.throttle.io_service_bytes) is awkward and
    # not present on the hosts we care about (Electric Cloud is v2). IO metrics
    # are emitted on v2 only; v1 deliberately skips them.
  end

  defp emit_v1_memory(root) do
    current = read_int_file(Path.join(root, "memory/memory.usage_in_bytes"))
    stat = read_stat_file(Path.join(root, "memory/memory.stat"))

    emit(:memory, :current, current)
    emit(:memory, :anon, Map.get(stat, "rss"))
    emit(:memory, :file, Map.get(stat, "cache"))
    emit(:memory, :working_set, working_set(current, Map.get(stat, "inactive_file")))

    emit(
      :memory,
      :max,
      real_limit(read_raw_file(Path.join(root, "memory/memory.limit_in_bytes")))
    )

    # v1 has no PSI; skip cgroup.memory.pressure.full.avg10.
  end

  defp emit_v1_cpu(root) do
    usage_ns = read_int_file(Path.join(root, "cpuacct/cpuacct.usage"))
    emit(:cpu, :usage_usec, ns_to_us(usage_ns))

    stat = read_stat_file(Path.join(root, "cpu/cpu.stat"))
    emit(:cpu, :nr_throttled, Map.get(stat, "nr_throttled"))
    emit(:cpu, :throttled_usec, ns_to_us(Map.get(stat, "throttled_time")))

    # v1 has no PSI; skip cgroup.cpu.pressure.full.avg10.
  end

  ## emitting --------------------------------------------------------------

  # Emit a `[:cgroup, plane]` event carrying a single keyed measurement, unless
  # the value is nil (file missing / unparseable / intentionally skipped).
  defp emit(_plane, _key, nil), do: :ok

  defp emit(plane, key, value) do
    :telemetry.execute([:cgroup, plane], %{key => value})
    :ok
  end

  # PSI files may be absent even on v2 (kernel built without PSI). Skip on any
  # read/parse failure.
  defp emit_pressure(path, plane) do
    case psi_full_avg10(read_raw_file(path)) do
      nil -> :ok
      avg10 -> :telemetry.execute([:cgroup, plane, :pressure, :full], %{avg10: avg10})
    end

    :ok
  end

  ## parsing helpers -------------------------------------------------------

  # working_set = current - inactive_file. If either input is missing, skip the
  # metric rather than emit a wrong number.
  defp working_set(nil, _inactive_file), do: nil
  defp working_set(_current, nil), do: nil
  defp working_set(current, inactive_file), do: max(current - inactive_file, 0)

  # A memory limit is only meaningful when it's a real number. v2 unlimited is
  # the literal string "max"; v1 unlimited is a huge sentinel (~9.2e18). In both
  # cases skip the metric (the host-RAM ceiling comes from /proc readers).
  @v1_unlimited_threshold 0x7000_0000_0000_0000
  defp real_limit(nil), do: nil

  defp real_limit(raw) do
    case parse_int(raw) do
      nil -> nil
      value when value >= @v1_unlimited_threshold -> nil
      value -> value
    end
  end

  defp ns_to_us(nil), do: nil
  defp ns_to_us(ns), do: div(ns, 1000)

  # Parse a flat `key value` stat file (memory.stat, cpu.stat) into a map of
  # binary key -> integer value. Lines that don't parse are dropped.
  defp read_stat_file(path) do
    case read_raw_file(path) do
      nil ->
        %{}

      content ->
        content
        |> String.split("\n", trim: true)
        |> Enum.reduce(%{}, fn line, acc ->
          case String.split(line, " ", trim: true) do
            [key, value] ->
              case parse_int(value) do
                nil -> acc
                int -> Map.put(acc, key, int)
              end

            _ ->
              acc
          end
        end)
    end
  end

  # io.stat is one line per device: "MAJ:MIN rbytes=… wbytes=… rios=… …".
  # Sum rbytes/wbytes across all devices.
  defp parse_io_stat(nil), do: %{rbytes: nil, wbytes: nil}

  defp parse_io_stat(content) do
    {rbytes, wbytes, any?} =
      content
      |> String.split("\n", trim: true)
      |> Enum.reduce({0, 0, false}, fn line, {r, w, any?} ->
        fields = String.split(line, " ", trim: true)

        line_r = io_field(fields, "rbytes=")
        line_w = io_field(fields, "wbytes=")

        {r + (line_r || 0), w + (line_w || 0), any? or line_r != nil or line_w != nil}
      end)

    if any? do
      %{rbytes: rbytes, wbytes: wbytes}
    else
      %{rbytes: nil, wbytes: nil}
    end
  end

  defp io_field(fields, prefix) do
    Enum.find_value(fields, fn field ->
      case field do
        ^prefix <> rest -> parse_int(rest)
        _ -> nil
      end
    end)
  end

  # PSI file format (one "some"/"full" line each):
  #   some avg10=0.00 avg60=0.00 avg300=0.00 total=12345
  #   full avg10=0.00 avg60=0.00 avg300=0.00 total=6789
  # Extract avg10 from the "full" line as a float.
  defp psi_full_avg10(nil), do: nil

  defp psi_full_avg10(content) do
    content
    |> String.split("\n", trim: true)
    |> Enum.find_value(fn line ->
      case String.split(line, " ", trim: true) do
        ["full" | fields] ->
          Enum.find_value(fields, fn field ->
            case field do
              "avg10=" <> rest -> parse_float(rest)
              _ -> nil
            end
          end)

        _ ->
          nil
      end
    end)
  end

  ## low-level file/number helpers -----------------------------------------

  # Read a single-integer file (memory.current, usage_in_bytes, cpuacct.usage).
  defp read_int_file(path), do: parse_int(read_raw_file(path))

  defp read_raw_file(path) do
    case File.read(path) do
      {:ok, content} -> String.trim(content)
      {:error, _reason} -> nil
    end
  end

  defp parse_int(nil), do: nil

  defp parse_int(str) do
    case Integer.parse(String.trim(str)) do
      {int, ""} -> int
      _ -> nil
    end
  end

  defp parse_float(str) do
    case Float.parse(String.trim(str)) do
      {float, ""} -> float
      _ -> nil
    end
  end
end
