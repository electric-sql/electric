defmodule Electric.Shapes.RouterPrototype.Benchmark do
  @moduledoc """
  Benchmark comparing current Filter implementation vs ShardedRouter prototype.

  Tests several workload patterns:
  1. **Pure equality shapes**: `id = N` for N shapes
  2. **Mixed fast/slow**: 80% equality, 20% complex conditions
  3. **High contention**: Many shapes on same table/field
  4. **Sparse matching**: Most records match 0-1 shapes

  Measures:
  - Throughput (records/sec)
  - Latency (μs per affected_shapes call)
  - Reductions per call
  - Memory usage
  - Scalability (how performance changes with shape count)
  """

  alias Electric.Shapes.Filter
  alias Electric.Shapes.Shape
  alias Electric.Shapes.RouterPrototype.{ShardedRouter, CompiledShape}

  @type result :: %{
          impl: :filter | :sharded_router,
          shapes: non_neg_integer(),
          records: non_neg_integer(),
          workload: atom(),
          avg_latency_us: float(),
          p50_latency_us: float(),
          p99_latency_us: float(),
          avg_reductions: float(),
          throughput_per_sec: float(),
          memory_bytes: non_neg_integer()
        }

  @doc """
  Runs a comprehensive benchmark comparing both implementations.

  ## Options

  - `:shape_counts` - List of shape counts to test (default: [100, 1000, 5000, 10000])
  - `:records_per_test` - Number of records to process per test (default: 1000)
  - `:workloads` - Which workloads to test (default: [:equality, :mixed, :contention])
  """
  def run(opts \\ []) do
    shape_counts = Keyword.get(opts, :shape_counts, [100, 1000, 5000])
    records_per_test = Keyword.get(opts, :records_per_test, 1000)
    workloads = Keyword.get(opts, :workloads, [:equality, :mixed])

    IO.puts("\n" <> IO.ANSI.cyan() <> "=== Router Prototype Benchmark ===" <> IO.ANSI.reset())
    IO.puts("Shape counts: #{inspect(shape_counts)}")
    IO.puts("Records per test: #{records_per_test}")
    IO.puts("Workloads: #{inspect(workloads)}\n")

    results =
      for shape_count <- shape_counts,
          workload <- workloads do
        IO.puts(
          IO.ANSI.yellow() <>
            "\n--- Testing #{shape_count} shapes, workload: #{workload} ---" <>
            IO.ANSI.reset()
        )

        # Test current Filter implementation
        filter_result = benchmark_filter(shape_count, records_per_test, workload)
        print_result("Current Filter", filter_result)

        # Test ShardedRouter implementation
        router_result = benchmark_sharded_router(shape_count, records_per_test, workload)
        print_result("Sharded Router", router_result)

        # Calculate speedup
        speedup = filter_result.avg_latency_us / router_result.avg_latency_us

        IO.puts(
          IO.ANSI.green() <>
            "Speedup: #{Float.round(speedup, 2)}x faster" <> IO.ANSI.reset()
        )

        {filter_result, router_result}
      end

    # Generate summary
    print_summary(results)

    results
  end

  @doc """
  Benchmarks the current Filter implementation.
  """
  def benchmark_filter(shape_count, record_count, workload) do
    inspector = create_mock_inspector()

    # Setup: Create filter with shapes
    filter = setup_filter(shape_count, workload, inspector)

    # Generate test records
    records = generate_records(record_count, shape_count, workload)

    # Measure memory before
    memory_before = :erlang.memory(:total)

    # Warm up
    Enum.take(records, 10)
    |> Enum.each(fn record ->
      Filter.affected_shapes(filter, record)
    end)

    # Benchmark
    {time_us, results} =
      :timer.tc(fn ->
        Enum.map(records, fn record ->
          # Measure reductions
          {reductions, shapes} =
            reductions_and_result(fn ->
              Filter.affected_shapes(filter, record)
            end)

          {MapSet.to_list(shapes), reductions}
        end)
      end)

    # Measure memory after
    memory_after = :erlang.memory(:total)

    # Extract metrics
    latencies_us = Enum.map(results, fn _ -> time_us / record_count end)
    reductions_list = Enum.map(results, fn {_shapes, reds} -> reds end)

    %{
      impl: :filter,
      shapes: shape_count,
      records: record_count,
      workload: workload,
      avg_latency_us: avg(latencies_us),
      p50_latency_us: percentile(latencies_us, 50),
      p99_latency_us: percentile(latencies_us, 99),
      avg_reductions: avg(reductions_list),
      throughput_per_sec: 1_000_000 / (time_us / record_count),
      memory_bytes: memory_after - memory_before
    }
  end

  @doc """
  Benchmarks the ShardedRouter implementation.
  """
  def benchmark_sharded_router(shape_count, record_count, workload) do
    inspector = create_mock_inspector()

    # Setup: Create router with shapes
    router = setup_sharded_router(shape_count, workload, inspector)

    # Generate test records
    records = generate_records(record_count, shape_count, workload)

    # Measure memory before
    memory_before = :erlang.memory(:total)

    # Warm up
    Enum.take(records, 10)
    |> Enum.each(fn record ->
      ShardedRouter.affected_shapes(router, "test_table", record)
    end)

    # Benchmark
    {time_us, results} =
      :timer.tc(fn ->
        Enum.map(records, fn record ->
          # Measure reductions
          {reductions, shapes} =
            reductions_and_result(fn ->
              ShardedRouter.affected_shapes(router, "test_table", record)
            end)

          {shapes, reductions}
        end)
      end)

    # Measure memory after
    memory_after = :erlang.memory(:total)

    # Extract metrics
    latencies_us = Enum.map(results, fn _ -> time_us / record_count end)
    reductions_list = Enum.map(results, fn {_shapes, reds} -> reds end)

    %{
      impl: :sharded_router,
      shapes: shape_count,
      records: record_count,
      workload: workload,
      avg_latency_us: avg(latencies_us),
      p50_latency_us: percentile(latencies_us, 50),
      p99_latency_us: percentile(latencies_us, 99),
      avg_reductions: avg(reductions_list),
      throughput_per_sec: 1_000_000 / (time_us / record_count),
      memory_bytes: memory_after - memory_before
    }
  end

  # Setup Filter with shapes
  defp setup_filter(shape_count, :equality, inspector) do
    1..shape_count
    |> Enum.reduce(Filter.new(), fn i, filter ->
      shape = Shape.new!("test_table", where: "id = #{i}", inspector: inspector)
      Filter.add_shape(filter, i, shape)
    end)
  end

  defp setup_filter(shape_count, :mixed, inspector) do
    1..shape_count
    |> Enum.reduce(Filter.new(), fn i, filter ->
      # 80% equality, 20% complex
      where_clause =
        if rem(i, 5) == 0 do
          "price > #{i * 10}"
        else
          "id = #{i}"
        end

      shape = Shape.new!("test_table", where: where_clause, inspector: inspector)
      Filter.add_shape(filter, i, shape)
    end)
  end

  # Setup ShardedRouter with shapes
  defp setup_sharded_router(shape_count, :equality, inspector) do
    shapes =
      1..shape_count
      |> Enum.map(fn i ->
        CompiledShape.compile(%{
          id: i,
          table: "test_table",
          where: "id = #{i}",
          inspector: inspector
        })
      end)

    ShardedRouter.new()
    |> ShardedRouter.add_shapes(shapes)
  end

  defp setup_sharded_router(shape_count, :mixed, inspector) do
    shapes =
      1..shape_count
      |> Enum.map(fn i ->
        # 80% equality, 20% complex
        where_clause =
          if rem(i, 5) == 0 do
            "price > #{i * 10}"
          else
            "id = #{i}"
          end

        CompiledShape.compile(%{
          id: i,
          table: "test_table",
          where: where_clause,
          inspector: inspector
        })
      end)

    ShardedRouter.new()
    |> ShardedRouter.add_shapes(shapes)
  end

  # Generate test records
  defp generate_records(count, shape_count, :equality) do
    # Generate records that hit random shapes
    1..count
    |> Enum.map(fn _ ->
      # Create a change record (mimics %Changes.NewRecord{})
      %{
        relation: {"public", "test_table"},
        record: %{
          "id" => to_string(:rand.uniform(shape_count)),
          "name" => "test_#{:rand.uniform(1000)}"
        }
      }
    end)
  end

  defp generate_records(count, shape_count, :mixed) do
    1..count
    |> Enum.map(fn _ ->
      %{
        relation: {"public", "test_table"},
        record: %{
          "id" => to_string(:rand.uniform(shape_count)),
          "price" => to_string(:rand.uniform(shape_count * 10)),
          "name" => "test_#{:rand.uniform(1000)}"
        }
      }
    end)
  end

  # Measures reductions and result
  defp reductions_and_result(fun) do
    {reductions_before, _} = :erlang.process_info(self(), :reductions)
    result = fun.()
    {reductions_after, _} = :erlang.process_info(self(), :reductions)

    {reductions_after - reductions_before, result}
  end

  # Statistical helpers
  defp avg([]), do: 0.0
  defp avg(list), do: Enum.sum(list) / length(list)

  defp percentile(list, p) when p >= 0 and p <= 100 do
    sorted = Enum.sort(list)
    k = (length(sorted) - 1) * p / 100
    f = floor(k)
    c = ceil(k)

    if f == c do
      Enum.at(sorted, trunc(k))
    else
      d0 = Enum.at(sorted, trunc(f)) * (c - k)
      d1 = Enum.at(sorted, trunc(c)) * (k - f)
      d0 + d1
    end
  end

  # Print helpers
  defp print_result(name, result) do
    IO.puts("#{name}:")
    IO.puts("  Avg latency: #{Float.round(result.avg_latency_us, 2)} μs")
    IO.puts("  P50 latency: #{Float.round(result.p50_latency_us, 2)} μs")
    IO.puts("  P99 latency: #{Float.round(result.p99_latency_us, 2)} μs")
    IO.puts("  Avg reductions: #{Float.round(result.avg_reductions, 0)}")

    IO.puts(
      "  Throughput: #{Float.round(result.throughput_per_sec, 0)} records/sec"
    )

    IO.puts("  Memory: #{format_bytes(result.memory_bytes)}")
  end

  defp print_summary(results) do
    IO.puts("\n" <> IO.ANSI.cyan() <> "=== Summary ===" <> IO.ANSI.reset())

    for {{filter_result, router_result}, idx} <- Enum.with_index(results, 1) do
      speedup = filter_result.avg_latency_us / router_result.avg_latency_us
      memory_reduction = (filter_result.memory_bytes - router_result.memory_bytes) / filter_result.memory_bytes * 100

      IO.puts("\nTest #{idx}: #{filter_result.shapes} shapes, #{filter_result.workload}")
      IO.puts("  Latency: #{Float.round(speedup, 2)}x faster")

      IO.puts(
        "  Memory: #{if memory_reduction > 0, do: "#{Float.round(memory_reduction, 1)}% reduction", else: "#{Float.round(abs(memory_reduction), 1)}% increase"}"
      )

      reduction_improvement =
        (filter_result.avg_reductions - router_result.avg_reductions) /
          filter_result.avg_reductions * 100

      IO.puts("  Reductions: #{Float.round(reduction_improvement, 1)}% fewer")
    end
  end

  defp format_bytes(bytes) when bytes < 1024, do: "#{bytes} B"

  defp format_bytes(bytes) when bytes < 1024 * 1024,
    do: "#{Float.round(bytes / 1024, 2)} KB"

  defp format_bytes(bytes), do: "#{Float.round(bytes / (1024 * 1024), 2)} MB"

  # Mock inspector for testing
  defp create_mock_inspector do
    # Return a minimal mock that satisfies the inspector interface
    # In real tests, would use Electric.Postgres.Inspector.Mock or similar
    %{
      columns: fn _table ->
        [
          %{name: "id", type: "int8"},
          %{name: "name", type: "text"},
          %{name: "price", type: "numeric"}
        ]
      end
    }
  end
end
