defmodule Electric.ShapeRouterBenchmark do
  @moduledoc """
  Benchmark harness for ShapeRouter performance testing.

  Tests the design goals:
  - Latency: 10-20 μs/lookup for typical cases
  - Memory: ~12-13 bytes/key
  - Scale: Millions of keys
  - "Mostly no match" workload efficiency
  """

  alias Electric.ShapeRouter

  @doc """
  Run the full benchmark suite.
  """
  def run_all do
    IO.puts("\n" <> String.duplicate("=", 80))
    IO.puts("ShapeRouter Performance Benchmark")
    IO.puts(String.duplicate("=", 80) <> "\n")

    scenarios = [
      {:small, 10_000, 10},
      {:medium, 100_000, 50},
      {:large, 1_000_000, 100}
    ]

    for {name, key_count, shape_count} <- scenarios do
      IO.puts("\n#{String.upcase(to_string(name))} SCENARIO")
      IO.puts("  Keys: #{format_number(key_count)}")
      IO.puts("  Shapes: #{shape_count}")
      IO.puts(String.duplicate("-", 80))

      run_scenario(key_count, shape_count)
    end

    IO.puts("\n" <> String.duplicate("=", 80))
    IO.puts("Benchmark Complete")
    IO.puts(String.duplicate("=", 80) <> "\n")
  end

  @doc """
  Run a single benchmark scenario.
  """
  def run_scenario(key_count, shape_count) do
    # Create router
    {:ok, router} = ShapeRouter.new("tenant_bench", "test_table")

    # Setup: Create shapes with realistic distribution
    {setup_time_us, _} = :timer.tc(fn ->
      setup_shapes(router, shape_count, key_count)
    end)

    IO.puts("  Setup time: #{format_time_us(setup_time_us)}")

    # Benchmark 1: Route operations (mostly misses)
    bench_mostly_misses(router, key_count)

    # Benchmark 2: Route operations (mostly hits, single shape)
    bench_mostly_hits_single(router, key_count)

    # Benchmark 3: Route operations (fan-out)
    bench_fanout(router, key_count)

    # Benchmark 4: Mixed workload (realistic)
    bench_mixed_workload(router, key_count)

    # Get final metrics
    print_metrics(router)

    :ok
  end

  ## Benchmark functions

  defp bench_mostly_misses(router, key_count) do
    IO.puts("\n  [1] Mostly Misses (90% miss rate)")

    # Use PKs outside the range of registered keys
    test_pks = Enum.map(key_count..(key_count + 10_000), & &1)

    {total_time_us, results} = :timer.tc(fn ->
      Enum.map(test_pks, fn pk ->
        ShapeRouter.route(router, %{
          pk: pk,
          new_record: %{id: pk, user_id: 1},
          changed_columns: []
        })
      end)
    end)

    miss_count = Enum.count(results, fn r -> r == [] end)
    hit_count = length(results) - miss_count
    avg_time_us = total_time_us / length(test_pks)

    IO.puts("      Operations: #{format_number(length(test_pks))}")
    IO.puts("      Misses: #{format_number(miss_count)} (#{format_percent(miss_count, length(test_pks))})")
    IO.puts("      Hits: #{format_number(hit_count)} (#{format_percent(hit_count, length(test_pks))})")
    IO.puts("      Avg latency: #{format_latency_us(avg_time_us)}")
    IO.puts("      Total time: #{format_time_us(total_time_us)}")

    check_target("Miss latency", avg_time_us, 1.0)
  end

  defp bench_mostly_hits_single(router, key_count) do
    IO.puts("\n  [2] Mostly Hits - Single Shape (90% hit rate)")

    # Use PKs from the first shape (which has ~10% of keys)
    sample_size = 10_000
    test_pks = Enum.take(1..key_count, sample_size) |> Enum.take_every(10)

    {total_time_us, results} = :timer.tc(fn ->
      Enum.map(test_pks, fn pk ->
        ShapeRouter.route(router, %{
          pk: pk,
          new_record: %{id: pk, user_id: 1, status: 1},
          changed_columns: [1]
        })
      end)
    end)

    hit_count = Enum.count(results, fn r -> r != [] end)
    shape_counts = Enum.map(results, &length/1)
    avg_shapes = if hit_count > 0, do: Enum.sum(shape_counts) / hit_count, else: 0
    avg_time_us = total_time_us / length(test_pks)

    IO.puts("      Operations: #{format_number(length(test_pks))}")
    IO.puts("      Hits: #{format_number(hit_count)} (#{format_percent(hit_count, length(test_pks))})")
    IO.puts("      Avg shapes/hit: #{:erlang.float_to_binary(avg_shapes, decimals: 2)}")
    IO.puts("      Avg latency: #{format_latency_us(avg_time_us)}")
    IO.puts("      Total time: #{format_time_us(total_time_us)}")

    check_target("Single-shape latency", avg_time_us, 20.0)
  end

  defp bench_fanout(router, _key_count) do
    IO.puts("\n  [3] Fan-out (multiple shapes match)")

    # Use PKs that match multiple shapes
    # These are keys where user_id and status overlap
    test_pks = 1..1000

    {total_time_us, results} = :timer.tc(fn ->
      Enum.map(test_pks, fn pk ->
        ShapeRouter.route(router, %{
          pk: pk,
          new_record: %{id: pk, user_id: 1, status: 1},
          changed_columns: [0, 1]
        })
      end)
    end)

    shape_counts = Enum.map(results, &length/1)
    max_shapes = Enum.max(shape_counts, fn -> 0 end)
    avg_shapes = if length(results) > 0, do: Enum.sum(shape_counts) / length(results), else: 0
    avg_time_us = total_time_us / length(test_pks)

    IO.puts("      Operations: #{format_number(length(test_pks))}")
    IO.puts("      Avg shapes/hit: #{:erlang.float_to_binary(avg_shapes, decimals: 2)}")
    IO.puts("      Max shapes: #{max_shapes}")
    IO.puts("      Avg latency: #{format_latency_us(avg_time_us)}")
    IO.puts("      Total time: #{format_time_us(total_time_us)}")

    check_target("Fan-out latency", avg_time_us, 50.0)
  end

  defp bench_mixed_workload(router, key_count) do
    IO.puts("\n  [4] Mixed Workload (realistic)")

    # 70% miss, 20% single-shape hit, 10% fan-out
    test_size = 10_000

    test_ops = [
      # 70% misses
      Enum.map(1..(test_size * 7 / 10), fn _ ->
        {:miss, :rand.uniform(key_count * 2) + key_count}
      end),
      # 20% single hits
      Enum.map(1..(test_size * 2 / 10), fn _ ->
        {:hit_single, :rand.uniform(key_count)}
      end),
      # 10% fan-out
      Enum.map(1..(test_size * 1 / 10), fn _ ->
        {:fanout, :rand.uniform(1000)}
      end)
    ]
    |> List.flatten()
    |> Enum.shuffle()

    {total_time_us, results} = :timer.tc(fn ->
      Enum.map(test_ops, fn {_type, pk} ->
        ShapeRouter.route(router, %{
          pk: pk,
          new_record: %{id: pk, user_id: 1, status: 1},
          changed_columns: [1]
        })
      end)
    end)

    miss_count = Enum.count(results, fn r -> r == [] end)
    hit_count = length(results) - miss_count
    shape_counts = Enum.map(results, &length/1)
    avg_shapes = if hit_count > 0, do: Enum.sum(shape_counts) / hit_count, else: 0
    avg_time_us = total_time_us / length(test_ops)

    IO.puts("      Operations: #{format_number(length(test_ops))}")
    IO.puts("      Misses: #{format_number(miss_count)} (#{format_percent(miss_count, length(test_ops))})")
    IO.puts("      Hits: #{format_number(hit_count)} (#{format_percent(hit_count, length(test_ops))})")
    IO.puts("      Avg shapes/hit: #{:erlang.float_to_binary(avg_shapes, decimals: 2)}")
    IO.puts("      Avg latency: #{format_latency_us(avg_time_us)}")
    IO.puts("      Total time: #{format_time_us(total_time_us)}")
    IO.puts("      Throughput: #{format_number(round(length(test_ops) / (total_time_us / 1_000_000)))} ops/sec")

    check_target("Mixed workload latency", avg_time_us, 15.0)
  end

  ## Setup helpers

  defp setup_shapes(router, shape_count, key_count) do
    # Create shapes with realistic distribution
    # Most shapes are small (1-5% of keys), few are large (10-20%)

    shapes = [
      # 70% small shapes (1-5% of keys each)
      Enum.map(1..round(shape_count * 0.7), fn id ->
        pks = sample_pks(key_count, 0.01 + :rand.uniform() * 0.04)
        {id, "user_id = #{id}", pks}
      end),
      # 20% medium shapes (5-10% of keys each)
      Enum.map(round(shape_count * 0.7)..round(shape_count * 0.9), fn id ->
        pks = sample_pks(key_count, 0.05 + :rand.uniform() * 0.05)
        {id, "status IN (1, 2, 3)", pks}
      end),
      # 10% large shapes (10-20% of keys each)
      Enum.map(round(shape_count * 0.9)..shape_count, fn id ->
        pks = sample_pks(key_count, 0.10 + :rand.uniform() * 0.10)
        {id, "tenant_id = 1", pks}
      end)
    ]
    |> List.flatten()

    Enum.each(shapes, fn {id, where_clause, pks} ->
      ShapeRouter.add_shape(router, id, where_clause, pks)
    end)
  end

  defp sample_pks(key_count, fraction) do
    sample_size = round(key_count * fraction)
    1..key_count |> Enum.take_random(sample_size)
  end

  ## Metrics and reporting

  defp print_metrics(router) do
    IO.puts("\n  Router Metrics:")
    metrics = ShapeRouter.metrics(router)

    IO.puts("    Presence checks: #{format_number(metrics["presence_checks"])}")
    IO.puts("    Presence hit rate: #{format_percent_float(metrics["presence_hit_rate"])}")
    IO.puts("    False positive rate: #{format_percent_float(metrics["false_positive_rate"])}")
    IO.puts("    Avg presence time: #{format_latency_us(metrics["avg_presence_us"])}")
    IO.puts("    Avg route time: #{format_latency_us(metrics["avg_route_us"])}")
    IO.puts("    Route calls: #{format_number(metrics["route_calls"])}")
    IO.puts("    Route hits: #{format_number(metrics["route_hits"])}")
    IO.puts("    Route misses: #{format_number(metrics["route_misses"])}")
    IO.puts("    Avg shapes/hit: #{:erlang.float_to_binary(metrics["avg_shapes_per_hit"], decimals: 2)}")
  end

  defp check_target(name, actual_us, target_us) do
    if actual_us <= target_us do
      IO.puts("      ✓ #{name} within target (≤ #{target_us} μs)")
    else
      IO.puts("      ⚠ #{name} above target: #{format_latency_us(actual_us)} > #{target_us} μs")
    end
  end

  ## Formatting helpers

  defp format_number(n) when is_integer(n) do
    n
    |> Integer.to_string()
    |> String.reverse()
    |> String.split("", trim: true)
    |> Enum.chunk_every(3)
    |> Enum.join(",")
    |> String.reverse()
  end

  defp format_number(n) when is_float(n), do: :erlang.float_to_binary(n, decimals: 2)
  defp format_number(nil), do: "0"

  defp format_time_us(us) do
    cond do
      us < 1_000 -> "#{:erlang.float_to_binary(us, decimals: 2)} μs"
      us < 1_000_000 -> "#{:erlang.float_to_binary(us / 1_000, decimals: 2)} ms"
      true -> "#{:erlang.float_to_binary(us / 1_000_000, decimals: 2)} s"
    end
  end

  defp format_latency_us(us) when is_number(us) do
    "#{:erlang.float_to_binary(us, decimals: 3)} μs"
  end

  defp format_latency_us(_), do: "N/A"

  defp format_percent(count, total) when total > 0 do
    "#{:erlang.float_to_binary(count / total * 100, decimals: 1)}%"
  end

  defp format_percent(_, _), do: "0%"

  defp format_percent_float(ratio) when is_number(ratio) do
    "#{:erlang.float_to_binary(ratio * 100, decimals: 1)}%"
  end

  defp format_percent_float(_), do: "0%"
end

# Run if executed directly
if Code.ensure_loaded?(ExUnit) do
  Electric.ShapeRouterBenchmark.run_all()
end
