#!/usr/bin/env elixir

# Benchmark script for comparing EqualityIndex vs LsmEqualityIndex
#
# This script compares the performance of the standard EqualityIndex
# (using Elixir maps) against the LSM-based index prototype.
#
# Run with:
#   mix run priv/lsm_index_prototype/benchmark.exs

defmodule LsmIndexBenchmark do
  @moduledoc """
  Benchmark comparing EqualityIndex vs LsmEqualityIndex.

  Tests:
  1. Insert performance (building index)
  2. Lookup performance (hot path)
  3. Memory usage
  4. Compaction overhead
  """

  alias Electric.Shapes.Filter.Indexes.EqualityIndex
  alias Electric.Shapes.Filter.Indexes.LsmEqualityIndex
  alias Electric.Shapes.Filter.Index

  def run do
    IO.puts("\n=== LSM Index Benchmark ===\n")

    # Test different scales
    scales = [
      {1_000, "1K keys"},
      {10_000, "10K keys"},
      {100_000, "100K keys"},
      {1_000_000, "1M keys"}
    ]

    for {num_keys, label} <- scales do
      IO.puts("## #{label}\n")

      # Generate test data
      keys = generate_keys(num_keys)

      # Benchmark EqualityIndex
      {eq_time, eq_index} = benchmark_insert_equality(keys)
      eq_memory = estimate_memory(eq_index)

      # Benchmark LsmEqualityIndex
      {lsm_time, lsm_index} = benchmark_insert_lsm(keys)
      lsm_stats = LsmEqualityIndex.stats(lsm_index)

      # Benchmark lookups
      lookup_keys = Enum.take_random(keys, min(1000, num_keys))
      eq_lookup_time = benchmark_lookup(eq_index, lookup_keys, :equality)
      lsm_lookup_time = benchmark_lookup(lsm_index, lookup_keys, :lsm)

      # Print results
      IO.puts("Insert Performance:")
      IO.puts("  EqualityIndex:    #{format_time(eq_time)}")
      IO.puts("  LsmEqualityIndex: #{format_time(lsm_time)}")
      IO.puts("  Difference:       #{format_diff(lsm_time, eq_time)}")

      IO.puts("\nLookup Performance (avg per key):")
      IO.puts("  EqualityIndex:    #{format_time(eq_lookup_time)}")
      IO.puts("  LsmEqualityIndex: #{format_time(lsm_lookup_time)}")
      IO.puts("  Difference:       #{format_diff(lsm_lookup_time, eq_lookup_time)}")

      IO.puts("\nMemory Usage:")
      IO.puts("  EqualityIndex:    ~#{format_bytes(eq_memory)} (estimated)")
      IO.puts("  LsmEqualityIndex: #{lsm_stats.total_entries} entries")
      IO.puts("    Overlay:        #{lsm_stats.total_overlay_entries}")
      IO.puts("    Segments:       #{lsm_stats.total_segment_entries}")
      IO.puts("    Num segments:   #{lsm_stats.total_segments}")

      IO.puts("\n" <> String.duplicate("-", 60) <> "\n")
    end

    IO.puts("Benchmark complete!")
  end

  defp generate_keys(num_keys) do
    for i <- 1..num_keys, do: i
  end

  defp benchmark_insert_equality(keys) do
    {time, index} =
      :timer.tc(fn ->
        Enum.reduce(keys, EqualityIndex.new(:int4), fn key, acc ->
          Index.add_shape(acc, key, rem(key, 100), nil)
        end)
      end)

    {time, index}
  end

  defp benchmark_insert_lsm(keys) do
    {time, index} =
      :timer.tc(fn ->
        index = LsmEqualityIndex.new(:int4, num_lanes: 64, compaction_threshold: 10_000)

        Enum.reduce(keys, index, fn key, acc ->
          Index.add_shape(acc, key, rem(key, 100), nil)
        end)
      end)

    {time, index}
  end

  defp benchmark_lookup(index, keys, _type) do
    {time, _} =
      :timer.tc(fn ->
        Enum.each(keys, fn key ->
          Index.affected_shapes(index, "test_field", %{"test_field" => key}, %{})
        end)
      end)

    div(time, length(keys))
  end

  defp estimate_memory(index) do
    # Rough estimate: each entry is ~20-30 bytes in a map
    map_size = map_size(index.values)
    map_size * 25
  end

  defp format_time(microseconds) do
    cond do
      microseconds < 1_000 ->
        "#{microseconds}μs"

      microseconds < 1_000_000 ->
        "#{Float.round(microseconds / 1_000, 2)}ms"

      true ->
        "#{Float.round(microseconds / 1_000_000, 2)}s"
    end
  end

  defp format_diff(lsm_time, eq_time) do
    diff_pct = ((lsm_time - eq_time) / eq_time * 100) |> Float.round(1)

    cond do
      diff_pct > 0 -> "#{diff_pct}% slower"
      diff_pct < 0 -> "#{abs(diff_pct)}% faster"
      true -> "same"
    end
  end

  defp format_bytes(bytes) do
    cond do
      bytes < 1024 ->
        "#{bytes}B"

      bytes < 1024 * 1024 ->
        "#{Float.round(bytes / 1024, 2)}KB"

      true ->
        "#{Float.round(bytes / (1024 * 1024), 2)}MB"
    end
  end
end

# Run the benchmark
LsmIndexBenchmark.run()
