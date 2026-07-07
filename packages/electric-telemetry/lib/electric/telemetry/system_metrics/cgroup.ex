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
  alias ElectricTelemetry.SystemMetrics.ProcfsParse

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
    * `:cgroup_version` — override the detected cgroup version (`:v2`/`:none`);
      used by tests. Defaults to the cached `SystemMetrics.system_info/0` value.
  """
  @spec measurement(map(), keyword()) :: :ok
  def measurement(_telemetry_opts, opts \\ []) do
    version =
      Keyword.get_lazy(opts, :cgroup_version, fn -> SystemMetrics.system_info().cgroup_version end)

    if version == :v2 do
      root = Keyword.get(opts, :cgroup_root, @default_root)
      emit_memory(root)
      emit_cpu(root)
      emit_io(root)
    end

    :ok
  end

  defp emit_memory(root) do
    current = read_int_file(Path.join(root, "memory.current"))
    stat = read_stat_file(Path.join(root, "memory.stat"))

    emit(:memory, :current, current)
    emit(:memory, :anon, Map.get(stat, "anon"))
    emit(:memory, :file, Map.get(stat, "file"))
    emit(:memory, :working_set, working_set(current, Map.get(stat, "inactive_file")))
    # An unlimited memory.max is the literal "max", which parses to nil and is
    # skipped (the host-RAM ceiling comes from the /proc reader).
    emit(:memory, :max, read_int_file(Path.join(root, "memory.max")))

    emit_pressure(Path.join(root, "memory.pressure"), :memory)
  end

  defp emit_cpu(root) do
    stat = read_stat_file(Path.join(root, "cpu.stat"))

    emit(:cpu, :usage_usec, Map.get(stat, "usage_usec"))
    emit(:cpu, :nr_throttled, Map.get(stat, "nr_throttled"))
    emit(:cpu, :throttled_usec, Map.get(stat, "throttled_usec"))

    emit_pressure(Path.join(root, "cpu.pressure"), :cpu)
  end

  defp emit_io(root) do
    io = parse_io_stat(read_raw_file(Path.join(root, "io.stat")))

    emit(:io, :rbytes, io.rbytes)
    emit(:io, :wbytes, io.wbytes)
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

  # The format-agnostic file/integer primitives are shared with the /proc
  # reader (ProcfsParse); the colon- vs space-delimited stat parsers above stay
  # separate because they parse genuinely different file layouts.

  # Read a single-integer file (memory.current, usage_in_bytes, cpuacct.usage).
  defp read_int_file(path), do: parse_int(read_raw_file(path))

  defp read_raw_file(path), do: ProcfsParse.read_raw_file(path)

  defp parse_int(value), do: ProcfsParse.parse_int(value)

  defp parse_float(str) do
    case Float.parse(String.trim(str)) do
      {float, ""} -> float
      _ -> nil
    end
  end
end
