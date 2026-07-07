defmodule ElectricTelemetry.SystemMetrics do
  @moduledoc """
  Periodic measurement functions for low-level system/runtime metrics that
  complement the application-level VM stats in `ElectricTelemetry.ApplicationTelemetry`.

  These functions are not a process; `ElectricTelemetry.Poller` invokes them
  (and the `SystemMetrics.Cgroup` / `SystemMetrics.Proc` readers) as MFA tuples,
  wrapping every invocation in `safe_invoke/3` so a crash here is logged and
  swallowed rather than removing the measurement.

  This module holds the BEAM allocator metrics (`vm.alloc.*`, derived from
  `:recon_alloc`), the cached platform/cgroup detection (`system_info/0`), and
  the shared `emit/2` helper used by the cgroup//proc readers.
  """

  @system_info_key {__MODULE__, :system_info}
  @fragmentation_gate_key {__MODULE__, :fragmentation_gate}

  # The poller runs all measurements at a single ~5s period, and
  # `:recon_alloc.fragmentation/1` is O(carriers) — too expensive for every
  # tick — so it self-gates to every 12th tick (~once a minute). The gate is an
  # atomic `:counters` ref cached in `:persistent_term`: `:counters.add/3` is a
  # lock-free bump, whereas a `:persistent_term.put` per tick would trigger a
  # global GC scan of all process heaps.
  @fragmentation_interval_ticks 12

  @doc """
  Number of poll ticks between per-allocator fragmentation samples.
  """
  @spec allocator_fragmentation_interval_ticks() :: pos_integer()
  def allocator_fragmentation_interval_ticks, do: @fragmentation_interval_ticks

  @doc """
  Emit a telemetry event carrying the non-nil `measurements` in a single
  `:telemetry.execute/2` call, or nothing when every value is nil (file
  missing / unreadable / metric intentionally skipped).
  """
  @spec emit(:telemetry.event_name(), %{optional(atom()) => number() | nil}) :: :ok
  def emit(event, measurements) do
    measurements = Map.reject(measurements, fn {_key, value} -> is_nil(value) end)
    if map_size(measurements) > 0, do: :telemetry.execute(event, measurements)
    :ok
  end

  @doc """
  Boot-time platform/cgroup detection, computed once and cached in `:persistent_term`.

  Returns a map of the form `%{os: {family, name}, cgroup_version: :v2 | :none}`.
  Cgroup v1 hosts report `:none` — the `cgroup.*` metrics are v2-only.
  """
  @spec system_info() :: %{os: {atom(), atom()}, cgroup_version: :v2 | :none}
  def system_info do
    memoized(@system_info_key, fn ->
      os = :os.type()
      %{os: os, cgroup_version: detect_cgroup_version(os)}
    end)
  end

  # The controllers list at the cgroup fs root is the canonical v2 marker.
  defp detect_cgroup_version({:unix, :linux}) do
    if File.exists?("/sys/fs/cgroup/cgroup.controllers"), do: :v2, else: :none
  end

  defp detect_cgroup_version(_non_linux), do: :none

  @doc """
  Cheap aggregate BEAM allocator metrics, sampled every poll tick.

  Emits the `[:vm, :alloc]` telemetry event carrying:

    * `:allocated` — bytes the allocators have requested from the OS (carriers)
    * `:used`      — bytes actually in use by blocks
    * `:unused`    — `allocated - used`, i.e. fragmentation/headroom held in carriers
    * `:carrier_usage` — `used / allocated`, the carrier usage ratio in `0..1`
  """
  @spec recon_alloc_measurement(map()) :: :ok
  def recon_alloc_measurement(_telemetry_opts) do
    # Each :recon_alloc.memory/1 call sweeps every allocator instance, so read
    # the two base numbers once and derive the rest locally.
    allocated = :recon_alloc.memory(:allocated)
    used = :recon_alloc.memory(:used)

    emit([:vm, :alloc], %{
      allocated: allocated,
      used: used,
      unused: max(allocated - used, 0),
      carrier_usage: if(allocated > 0, do: used / allocated)
    })
  end

  @doc """
  Per-allocator fragmentation breakdown (slow tier, ~once a minute — see
  `@fragmentation_interval_ticks`).

  Sums unused carrier bytes from `:recon_alloc.fragmentation(:current)` per
  allocator *type* and emits one `[:vm, :alloc, :fragmentation]` event per
  type, tagged by `allocator`.

  Options:
    * `:force`    — when `true`, always run regardless of the gate (tests)
    * `:gate_key` — override the `:persistent_term` key holding the tick counter
      (used by tests to avoid contending with the live poller's counter)
  """
  @spec allocator_fragmentation_measurement(map(), keyword()) :: :ok
  def allocator_fragmentation_measurement(_telemetry_opts, opts \\ []) do
    if due?(opts) do
      :recon_alloc.fragmentation(:current)
      |> Enum.reduce(%{}, fn {{type, _instance}, info}, acc ->
        unused = unused_bytes(info)
        Map.update(acc, type, unused, &(&1 + unused))
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

  defp due?(opts) do
    if Keyword.get(opts, :force, false) do
      true
    else
      gate_key = Keyword.get(opts, :gate_key, @fragmentation_gate_key)
      ref = memoized(gate_key, fn -> :counters.new(1, [:write_concurrency]) end)
      :counters.add(ref, 1, 1)
      # The first tick reads 1, so the gate fires on the Nth tick (not on boot).
      rem(:counters.get(ref, 1), @fragmentation_interval_ticks) == 0
    end
  end

  # Get-or-compute a `:persistent_term` entry. The put happens at most once per
  # key (on first call), never on the per-tick hot path.
  defp memoized(key, fun) do
    with :undefined <- :persistent_term.get(key, :undefined) do
      tap(fun.(), &:persistent_term.put(key, &1))
    end
  end

  # `:recon_alloc.fragmentation/1` returns a proplist per allocator with carrier
  # and block sizes for both single-block (sbcs) and multi-block (mbcs)
  # carriers. Unused bytes are the carrier bytes the OS gave us minus the bytes
  # actually filled by blocks.
  defp unused_bytes(info) do
    carriers =
      Keyword.get(info, :sbcs_carriers_size, 0) + Keyword.get(info, :mbcs_carriers_size, 0)

    blocks =
      Keyword.get(info, :sbcs_block_size, 0) + Keyword.get(info, :mbcs_block_size, 0)

    max(carriers - blocks, 0)
  end
end
