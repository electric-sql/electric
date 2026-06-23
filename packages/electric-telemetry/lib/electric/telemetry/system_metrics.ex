defmodule ElectricTelemetry.SystemMetrics do
  @moduledoc """
  Periodic measurement functions for low-level system/runtime metrics that
  complement the application-level VM stats in `ElectricTelemetry.ApplicationTelemetry`.

  These functions are not a process; they are invoked by `ElectricTelemetry.Poller`
  (via `telemetry_poller`) as `{__MODULE__, fun, [telemetry_opts]}` MFA tuples. The
  poller wraps every invocation in `ElectricTelemetry.Poller.safe_invoke/3`, so a
  crash here is logged and swallowed rather than removing the measurement.

  This module currently exposes:

    * BEAM allocator metrics (`vm.alloc.*`), derived from `:recon_alloc`. These are
      cross-platform (recon works everywhere) and sit alongside the existing
      `vm.memory.*` metrics. The cheap aggregate view is sampled every poll tick;
      the expensive per-allocator fragmentation breakdown is gated to run roughly
      once a minute.

    * A cached platform/cgroup detection helper (`system_info/0`). Only the OS and
      cgroup version are computed here; later tasks build cgroup/host readers on top
      of this scaffolding.
  """

  @system_info_key {__MODULE__, :system_info}
  @fragmentation_gate_key {__MODULE__, :fragmentation_gate}

  # The poller runs all measurements at a single ~5s period. The per-allocator
  # fragmentation breakdown (`:recon_alloc.fragmentation/1`) is O(carriers) and too
  # expensive to run every tick, so we gate it to run roughly once a minute. With a
  # 5s poll interval, every 12th tick is ~60s.
  #
  # We gate with an atomic `:counters` ref rather than a second `:telemetry_poller`
  # child: the poller's period is shared across all measurements (see
  # `ElectricTelemetry.Poller.child_spec/2`), so there is no per-measurement period
  # to configure, and a counter-gate keeps this self-contained.
  #
  # The `:counters` ref is created once and cached in `:persistent_term` (a single
  # put per gate key, ever). We deliberately avoid bumping the tick count via
  # `:persistent_term.put` on every poll: each `:persistent_term.put` triggers a
  # global scan of all process heaps for GC, which is exactly the per-tick overhead a
  # cheap telemetry module must avoid. `:counters.add/3` is a lock-free atomic with no
  # such cost and no read-modify-write race.
  @fragmentation_interval_ticks 12

  @doc """
  Number of poll ticks between per-allocator fragmentation samples.
  """
  @spec allocator_fragmentation_interval_ticks() :: pos_integer()
  def allocator_fragmentation_interval_ticks, do: @fragmentation_interval_ticks

  @doc """
  Boot-time platform/cgroup detection, computed once and cached in `:persistent_term`.

  Returns a map of the form `%{os: {family, name}, cgroup_version: :v1 | :v2 | :none}`.

  Cgroup version is detected by stat-ing the filesystem mounted at `/sys/fs/cgroup`:
  a `cgroup2fs` filesystem indicates v2; `tmpfs`/`cgroup` indicates v1; anything else
  (including non-Linux platforms or a missing mount) is reported as `:none`.

  Later tasks (cgroup/host readers) reuse this detection.
  """
  @spec system_info() :: %{os: {atom(), atom()}, cgroup_version: :v1 | :v2 | :none}
  def system_info do
    case :persistent_term.get(@system_info_key, :undefined) do
      :undefined ->
        info = compute_system_info()
        :persistent_term.put(@system_info_key, info)
        info

      info ->
        info
    end
  end

  defp compute_system_info do
    os = :os.type()
    %{os: os, cgroup_version: detect_cgroup_version(os)}
  end

  defp detect_cgroup_version({:unix, :linux}) do
    # `stat -fc %T` prints the filesystem type of the mount backing the path.
    case System.cmd("stat", ["-fc", "%T", "/sys/fs/cgroup"], stderr_to_stdout: true) do
      {output, 0} ->
        case String.trim(output) do
          "cgroup2fs" -> :v2
          "tmpfs" -> :v1
          "cgroup" -> :v1
          _ -> :none
        end

      _ ->
        :none
    end
  rescue
    _ -> :none
  end

  defp detect_cgroup_version(_non_linux), do: :none

  @doc """
  Cheap aggregate BEAM allocator metrics, sampled every poll tick.

  Emits the `[:vm, :alloc]` telemetry event carrying:

    * `:allocated` — bytes the allocators have requested from the OS (carriers)
    * `:used`      — bytes actually in use by blocks
    * `:unused`    — `allocated - used`, i.e. fragmentation/headroom held in carriers
    * `:carrier_usage` — `used / allocated`, the carrier usage ratio in `0..1`

  These map to the `vm.alloc.allocated`, `vm.alloc.unused`, and
  `vm.alloc.carrier_usage` metrics (plus `vm.alloc.used`).
  """
  @spec recon_alloc_measurement(map()) :: :ok
  def recon_alloc_measurement(_telemetry_opts) do
    allocated = :recon_alloc.memory(:allocated)
    used = :recon_alloc.memory(:used)
    unused = max(allocated - used, 0)
    carrier_usage = :recon_alloc.memory(:usage)

    :telemetry.execute([:vm, :alloc], %{
      allocated: allocated,
      used: used,
      unused: unused,
      carrier_usage: carrier_usage
    })

    :ok
  end

  @doc """
  Per-allocator fragmentation breakdown (slow tier, ~once a minute).

  Uses `:recon_alloc.fragmentation(:current)` (an O(carriers) call). It keys results
  by `{type, instance}` (e.g. `{:eheap_alloc, 3}`); we compute unused bytes held in
  carriers (`sbcs_carriers_size + mbcs_carriers_size - sbcs_block_size - mbcs_block_size`)
  and sum them per allocator *type*. One `[:vm, :alloc, :fragmentation]` event is
  emitted per type, tagged by `allocator` (the type name as a string).

  Because the poller runs every measurement at one ~5s period, this is gated by a
  counter in `:persistent_term` and early-returns on non-due ticks (see
  `@fragmentation_interval_ticks`). Pass `force: true` to bypass the gate (tests).

  Options:
    * `:force`    — when `true`, always run regardless of the gate
    * `:gate_key` — override the `:persistent_term` key holding the tick counter
      (used by tests to avoid contending with the live poller's counter)
  """
  @spec allocator_fragmentation_measurement(map(), keyword()) :: :ok
  def allocator_fragmentation_measurement(_telemetry_opts, opts \\ []) do
    if due?(opts) do
      :recon_alloc.fragmentation(:current)
      |> Enum.reduce(%{}, fn {{type, _instance}, info}, acc ->
        Map.update(acc, type, unused_bytes(info), &(&1 + unused_bytes(info)))
      end)
      |> Enum.each(fn {type, unused} ->
        :telemetry.execute(
          [:vm, :alloc, :fragmentation],
          %{unused: unused},
          %{allocator: to_string(type)}
        )
      end)
    end

    :ok
  end

  @doc """
  cgroup (v1/v2) accounting metrics, sampled every poll tick.

  Reads the container's cgroup files and emits the `cgroup.*` family (memory,
  cpu, io, and — on v2 — PSI pressure). Parsing lives in
  `ElectricTelemetry.SystemMetrics.Cgroup`; this is a thin delegator so it
  registers like the other measurements. No-ops when no cgroup is detected.

  Options are forwarded to `Cgroup.measurement/2` (`:cgroup_root` and
  `:cgroup_version` overrides for tests).
  """
  @spec cgroup_measurement(map(), keyword()) :: :ok
  def cgroup_measurement(telemetry_opts, opts \\ []) do
    ElectricTelemetry.SystemMetrics.Cgroup.measurement(telemetry_opts, opts)
  end

  defp due?(opts) do
    if Keyword.get(opts, :force, false) do
      true
    else
      gate_key = Keyword.get(opts, :gate_key, @fragmentation_gate_key)
      ref = gate_counter(gate_key)
      :counters.add(ref, 1, 1)
      # The first tick reads 1, so the gate fires on the Nth tick (not on boot).
      rem(:counters.get(ref, 1), @fragmentation_interval_ticks) == 0
    end
  end

  # Returns a cached single-slot `:counters` ref for the gate key, creating and
  # caching it on first use. The `:persistent_term.put` here happens at most once per
  # gate key (on first call), never on the per-tick hot path.
  defp gate_counter(gate_key) do
    case :persistent_term.get(gate_key, :undefined) do
      :undefined ->
        ref = :counters.new(1, [:write_concurrency])
        :persistent_term.put(gate_key, ref)
        ref

      ref ->
        ref
    end
  end

  # `:recon_alloc.fragmentation/1` returns a proplist per allocator with carrier and
  # block sizes for both single-block (sbcs) and multi-block (mbcs) carriers. Unused
  # bytes are the carrier bytes the OS gave us minus the bytes actually filled by blocks.
  defp unused_bytes(info) do
    carriers =
      Keyword.get(info, :sbcs_carriers_size, 0) + Keyword.get(info, :mbcs_carriers_size, 0)

    blocks =
      Keyword.get(info, :sbcs_block_size, 0) + Keyword.get(info, :mbcs_block_size, 0)

    max(carriers - blocks, 0)
  end
end
