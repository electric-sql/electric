defmodule ElectricTelemetry.SystemMetrics.Proc do
  @moduledoc """
  Reads Linux `/proc` accounting files and emits `host.mem.*` and
  `host.proc.beam.*` telemetry.

  This bridges the cgroup plane and the BEAM allocator plane:

    * `host.mem.*` (from `/proc/meminfo`) gives the host-RAM ceiling and cache
      picture. On Electric Cloud there is one task per host (EC2), so host ≈
      container.
    * `host.proc.beam.*` (from `/proc/<beam_pid>/status` and
      `/proc/<beam_pid>/io`) gives the per-process RSS breakdown (anon vs file
      vs shmem) and IO byte counters for *this* BEAM, so cgroup `anon` can be
      shown to track the BEAM's anonymous footprint.

  All reads are defensive: a missing file, a permission error (`/proc/<pid>/io`
  can be EACCES-restricted even for self in some sandboxes), or unexpected
  content results in the corresponding metric being skipped, never a crash.

  `/proc` only exists on Linux, so the measurement is a clean no-op on every
  other platform. The OS is taken from
  `ElectricTelemetry.SystemMetrics.system_info/0` (cached at boot) so we never
  re-detect on the hot path.

  Units:

    * `/proc/meminfo` values and `/proc/<pid>/status` `Rss*`/`VmRSS` are in kB
      and converted to bytes (× 1024).
    * `/proc/<pid>/io` `read_bytes`/`write_bytes` are already bytes and emitted
      as-is.
  """

  alias ElectricTelemetry.SystemMetrics
  alias ElectricTelemetry.SystemMetrics.ProcfsParse

  @default_root "/proc"

  @doc """
  The default `/proc` filesystem root. Tests override this via the `:proc_root`
  option on `measurement/2`.
  """
  @spec default_root() :: String.t()
  def default_root, do: @default_root

  @doc """
  Read the `/proc` accounting files and emit `host.mem.*` / `host.proc.beam.*`
  telemetry events.

  Reads every tick (no slow-tier gating). Options:

    * `:proc_root` — override the `/proc` filesystem root (default
      `#{@default_root}`); used by tests to point at fixture trees.
    * `:pid` — override the OS pid of the BEAM whose per-process files are read
      (default `:os.getpid()`); used by tests to point at `<proc_root>/<pid>/`.
    * `:os` — override the detected OS (`{family, name}` tuple); used by tests.
      Defaults to the cached `SystemMetrics.system_info/0` value.
  """
  @spec measurement(map(), keyword()) :: :ok
  def measurement(_telemetry_opts, opts \\ []) do
    os = Keyword.get_lazy(opts, :os, fn -> SystemMetrics.system_info().os end)

    case os do
      {:unix, :linux} ->
        root = Keyword.get(opts, :proc_root, @default_root)
        pid = Keyword.get_lazy(opts, :pid, fn -> :os.getpid() end) |> to_string()

        emit_host_mem(root)
        emit_beam_status(root, pid)
        emit_beam_io(root, pid)

      _non_linux ->
        :ok
    end

    :ok
  end

  ## host memory -----------------------------------------------------------

  # /proc/meminfo is a flat "<key>:   <N> kB" file. Read the keys we want and
  # convert kB -> bytes.
  defp emit_host_mem(root) do
    info = ProcfsParse.read_meminfo(Path.join(root, "meminfo"))

    emit([:host, :mem], :total, kb_to_bytes(Map.get(info, "MemTotal")))
    emit([:host, :mem], :free, kb_to_bytes(Map.get(info, "MemFree")))
    emit([:host, :mem], :cached, kb_to_bytes(Map.get(info, "Cached")))
  end

  ## BEAM process status ---------------------------------------------------

  # /proc/<pid>/status is a flat "<Key>:\t<value>[ kB]" file. The Rss*/VmRSS
  # values are in kB; convert to bytes.
  defp emit_beam_status(root, pid) do
    status = ProcfsParse.read_status(Path.join([root, pid, "status"]))

    emit([:host, :proc, :beam], :rss_anon, kb_to_bytes(Map.get(status, "RssAnon")))
    emit([:host, :proc, :beam], :rss_file, kb_to_bytes(Map.get(status, "RssFile")))
    emit([:host, :proc, :beam], :rss_shmem, kb_to_bytes(Map.get(status, "RssShmem")))
    emit([:host, :proc, :beam], :vm_rss, kb_to_bytes(Map.get(status, "VmRSS")))
  end

  ## BEAM process IO -------------------------------------------------------

  # /proc/<pid>/io is a flat "<key>: <N>" file with byte counters. May be
  # EACCES-restricted; on any read failure we simply emit nothing.
  defp emit_beam_io(root, pid) do
    io = ProcfsParse.read_proc_io(Path.join([root, pid, "io"]))

    emit([:host, :proc, :beam, :io], :read_bytes, Map.get(io, "read_bytes"))
    emit([:host, :proc, :beam, :io], :write_bytes, Map.get(io, "write_bytes"))
  end

  ## emitting --------------------------------------------------------------

  # Emit `event` carrying a single keyed measurement, unless the value is nil
  # (file missing / unreadable / unparseable).
  defp emit(_event, _key, nil), do: :ok

  defp emit(event, key, value) do
    :telemetry.execute(event, %{key => value})
    :ok
  end

  ## unit helpers ----------------------------------------------------------

  defp kb_to_bytes(nil), do: nil
  defp kb_to_bytes(kb), do: kb * 1024
end
