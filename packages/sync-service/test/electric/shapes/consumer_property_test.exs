defmodule Electric.Shapes.ConsumerPropertyTest do
  use ExUnit.Case, async: true
  use ExUnitProperties
  use Repatch.ExUnit, assert_expectations: true

  alias Electric.Shapes.Shape

  alias Support.StubInspector
  alias Support.ConsumerProperty.Generator
  alias Support.ConsumerProperty.Runner

  import Support.ComponentSetup

  @inspector StubInspector.new(
               tables: ["test_table", "other_table"],
               columns: [
                 %{name: "id", type: "int8", pk_position: 0},
                 %{name: "parent_id", type: "int8"},
                 %{name: "value", type: "text"}
               ]
             )

  @shape_with_subquery Shape.new!("public.test_table",
                         inspector: @inspector,
                         where: "parent_id IN (SELECT id FROM public.other_table)"
                       )

  @moduletag :tmp_dir

  setup :with_stack_id_from_test

  setup do
    %{inspector: @inspector, pool: nil}
  end

  setup ctx do
    Electric.StackConfig.put(ctx.stack_id, :shape_hibernate_after, 60_000)
    Electric.StackConfig.put(ctx.stack_id, :feature_flags, ["tagged_subqueries"])
    :ok
  end

  setup [
    :with_registry,
    :with_pure_file_storage,
    :with_shape_status,
    :with_lsn_tracker,
    :with_log_chunking,
    :with_persistent_kv,
    :with_async_deleter,
    :with_shape_cleaner,
    :with_shape_log_collector,
    :with_noop_publication_manager,
    :with_status_monitor,
    {Runner, :with_patched_snapshotter},
    :with_shape_cache
  ]

  @tag timeout: 120_000
  property "consumer produces a valid materializable log for arbitrary event sequences", ctx do
    check all(
            scenario <- Generator.scenario(),
            # Raise this as needed to get more coverage
            max_runs: 50,
            max_run_time: 120_000,
            max_shrinking_steps: 100
          ) do
      # Rewrite LSNs/xids to be globally unique across iterations.
      # The ShapeLogCollector drops txn fragments with LSNs <= last_processed_offset.
      iteration = Process.get(:prop_iteration, 0)
      Process.put(:prop_iteration, iteration + 1)
      scenario = bump_scenario_offsets(scenario, iteration * 1000)

      Runner.run_scenario(ctx,
        events: scenario.events,
        expected_rows: scenario.expected_rows,
        shape: @shape_with_subquery,
        extended_output: true
      )
    end
  end

  defp bump_scenario_offsets(scenario, 0), do: scenario

  defp bump_scenario_offsets(scenario, offset) do
    events =
      Enum.map(scenario.events, fn
        {:txn, opts} ->
          {:txn, Keyword.merge(opts, xid: opts[:xid] + offset, lsn: opts[:lsn] + offset)}

        {:snapshot, opts} ->
          opts =
            opts
            |> Keyword.put(:snapshot, bump_snapshot(opts[:snapshot], offset))
            |> then(fn o ->
              if Keyword.has_key?(o, :wal_lsn),
                do: Keyword.update!(o, :wal_lsn, &(&1 + offset)),
                else: o
            end)

          {:snapshot, opts}

        {:query_result, opts} ->
          {:query_result, Keyword.put(opts, :snapshot, bump_snapshot(opts[:snapshot], offset))}

        {:global_last_seen_lsn, opts} ->
          {:global_last_seen_lsn, Keyword.update!(opts, :lsn, &(&1 + offset))}

        other ->
          other
      end)

    %{scenario | events: events}
  end

  defp bump_snapshot({xmin, xmax, xip}, offset) do
    {xmin + offset, xmax + offset, Enum.map(xip, &(&1 + offset))}
  end
end
