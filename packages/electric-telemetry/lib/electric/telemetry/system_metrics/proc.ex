defmodule ElectricTelemetry.SystemMetrics.Proc do
  @moduledoc """
  Reads Linux `/proc` accounting files and emits `host.mem.*` (from
  `/proc/meminfo`) and `host.proc.beam.*` (from the BEAM's own
  `/proc/<pid>/status` and `/proc/<pid>/io`) telemetry.

  This bridges the cgroup plane and the BEAM allocator plane: the per-process
  RSS breakdown (anon vs file vs shmem) shows cgroup `anon` tracking the BEAM
  footprint, and meminfo gives the host-RAM ceiling/cache picture (one task per
  host on EC2, so host ≈ container).

  All reads are defensive: a missing file, a permission error (`/proc/<pid>/io`
  can be EACCES-restricted even for self in some sandboxes), or unexpected
  content results in the corresponding metric being skipped, never a crash.
  `/proc` only exists on Linux, so the measurement is a clean no-op everywhere
  else.

  meminfo values and status `Rss*`/`VmRSS` are in kB and converted to bytes;
  `/proc/<pid>/io` `read_bytes`/`write_bytes` are already bytes and emitted
  as-is.
  """

  alias ElectricTelemetry.SystemMetrics

  import ElectricTelemetry.SystemMetrics, only: [emit: 2]
  import ElectricTelemetry.SystemMetrics.ProcfsParse, only: [read_kv_file: 1]

  @default_root "/proc"

  @doc """
  Read the `/proc` accounting files and emit `host.mem.*` / `host.proc.beam.*`
  telemetry events.

  Reads every tick (no slow-tier gating). Options:

    * `:proc_root` — override the `/proc` filesystem root (default
      `#{@default_root}`); used by tests to point at fixture trees.
    * `:pid` — override the OS pid of the BEAM whose per-process files are read
      (default `:os.getpid()`); used by tests.
    * `:os` — override the detected OS (`{family, name}` tuple); used by tests.
      Defaults to the cached `SystemMetrics.system_info/0` value.
  """
  @spec measurement(map(), keyword()) :: :ok
  def measurement(_telemetry_opts, opts \\ []) do
    os = Keyword.get_lazy(opts, :os, fn -> SystemMetrics.system_info().os end)

    if os == {:unix, :linux} do
      root = Keyword.get(opts, :proc_root, @default_root)
      pid = opts |> Keyword.get_lazy(:pid, fn -> :os.getpid() end) |> to_string()

      meminfo = read_kv_file(Path.join(root, "meminfo"))

      emit([:host, :mem], %{
        total: kb_to_bytes(meminfo["MemTotal"]),
        free: kb_to_bytes(meminfo["MemFree"]),
        cached: kb_to_bytes(meminfo["Cached"])
      })

      status = read_kv_file(Path.join([root, pid, "status"]))

      emit([:host, :proc, :beam], %{
        rss_anon: kb_to_bytes(status["RssAnon"]),
        rss_file: kb_to_bytes(status["RssFile"]),
        rss_shmem: kb_to_bytes(status["RssShmem"]),
        vm_rss: kb_to_bytes(status["VmRSS"])
      })

      io = read_kv_file(Path.join([root, pid, "io"]))

      emit([:host, :proc, :beam, :io], %{
        read_bytes: io["read_bytes"],
        write_bytes: io["write_bytes"]
      })
    end

    :ok
  end

  defp kb_to_bytes(nil), do: nil
  defp kb_to_bytes(kb), do: kb * 1024
end
