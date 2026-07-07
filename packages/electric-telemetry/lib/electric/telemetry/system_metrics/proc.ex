defmodule ElectricTelemetry.SystemMetrics.Proc do
  @moduledoc """
  Reads the BEAM's own `/proc/<pid>/status` and `/proc/<pid>/io` and emits
  `host.proc.beam.*` telemetry: the per-process RSS breakdown (anon vs file vs
  shmem) shows cgroup `anon` tracking the BEAM's anonymous footprint, and the
  IO byte counters give the kernel's view of this process's disk traffic.

  All reads are defensive: a missing file, a permission error (`/proc/<pid>/io`
  can be EACCES-restricted even for self in some sandboxes), or unexpected
  content results in the corresponding metric being skipped, never a crash.
  `/proc` only exists on Linux, so the measurement is a clean no-op everywhere
  else.

  Status `Rss*`/`VmRSS` values are in kB and converted to bytes;
  `/proc/<pid>/io` `read_bytes`/`write_bytes` are already bytes and emitted
  as-is.
  """

  alias ElectricTelemetry.SystemMetrics

  import ElectricTelemetry.SystemMetrics, only: [emit: 2]
  import ElectricTelemetry.SystemMetrics.ProcfsParse, only: [read_kv_file: 2]

  @default_root "/proc"

  @status_keys MapSet.new(~w(RssAnon RssFile RssShmem VmRSS))
  @io_keys MapSet.new(~w(read_bytes write_bytes))

  @doc """
  Read the BEAM's `/proc/<pid>` accounting files and emit `host.proc.beam.*`
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
      %{status: status_path, io: io_path} = paths(opts)

      status = read_kv_file(status_path, @status_keys)

      emit([:host, :proc, :beam], %{
        rss_anon: kb_to_bytes(status["RssAnon"]),
        rss_file: kb_to_bytes(status["RssFile"]),
        rss_shmem: kb_to_bytes(status["RssShmem"]),
        vm_rss: kb_to_bytes(status["VmRSS"])
      })

      io = read_kv_file(io_path, @io_keys)

      emit([:host, :proc, :beam, :io], %{
        read_bytes: io["read_bytes"],
        write_bytes: io["write_bytes"]
      })
    end

    :ok
  end

  # In production (no opts) the BEAM pid and the file paths never change for
  # the life of the VM, so resolve them once and cache in :persistent_term;
  # test overrides recompute.
  defp paths([]) do
    SystemMetrics.memoized({__MODULE__, :paths}, fn ->
      build_paths(@default_root, :os.getpid())
    end)
  end

  defp paths(opts) do
    build_paths(
      Keyword.get(opts, :proc_root, @default_root),
      Keyword.get_lazy(opts, :pid, fn -> :os.getpid() end)
    )
  end

  defp build_paths(root, pid) do
    dir = Path.join(root, to_string(pid))
    %{status: Path.join(dir, "status"), io: Path.join(dir, "io")}
  end

  defp kb_to_bytes(nil), do: nil
  defp kb_to_bytes(kb), do: kb * 1024
end
