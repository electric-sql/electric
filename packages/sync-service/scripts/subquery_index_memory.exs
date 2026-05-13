defmodule SubqueryIndexMemoryBench do
  @moduledoc false

  @cohort 1
  @node 1
  @ref ["$sublink", "0"]
  @subquery_key {:dependency, "dep_handle_0", @ref}

  def run do
    IO.puts("# SubqueryIndex memory benchmark")
    IO.puts("")
    IO.puts("* OTP: #{System.otp_release()}")
    IO.puts("* Elixir: #{System.version()}")
    IO.puts("* Architecture: #{:erlang.system_info(:system_architecture)}")
    IO.puts("* Word size: #{:erlang.system_info(:wordsize)} bytes")
    IO.puts("")

    current_vs_compact()
    IO.puts("")
    tagged_vs_compact()
    IO.puts("")
    customer_workload_estimates()
  end

  defp current_vs_compact do
    scenarios = [
      {"1 participant, 1k values, steady state", 1, 1_000, 0, 0},
      {"10 participants, 1k values, steady state", 10, 1_000, 0, 0},
      {"100 participants, 1k values, steady state", 100, 1_000, 0, 0},
      {"100 participants, 10k values, steady state", 100, 10_000, 0, 0},
      {"100 participants, 1k values, 100 moved x 1 lagging", 100, 1_000, 100, 1},
      {"100 participants, 1k values, 100 moved x 10 lagging", 100, 1_000, 100, 10},
      {"100 participants, 1k values, 100 moved x 99 lagging", 100, 1_000, 100, 99},
      {"100 participants, 1k values, 1k moved x 99 lagging", 100, 1_000, 1_000, 99}
    ]

    IO.puts("## Current vs compact proposed layout")
    IO.puts("")
    IO.puts("| Scenario | Current | Compact proposed | Savings |")
    IO.puts("|----------|---------|------------------|---------|")

    for {label, participants, values, moved, lagging} <- scenarios do
      current = measure(fn -> current_tables(participants, values) end)
      compact = measure(fn -> compact_tables(participants, values, moved, lagging) end)

      IO.puts(
        "| #{label} | #{format_bytes(current.bytes)} | #{format_bytes(compact.bytes)} | #{savings(current.bytes, compact.bytes)} |"
      )
    end
  end

  defp tagged_vs_compact do
    scenarios = [
      {"10 participants, 1k values, steady state", 10, 1_000, 0, 0},
      {"100 participants, 1k values, steady state", 100, 1_000, 0, 0},
      {"100 participants, 1k values, 100 moved x 10 lagging", 100, 1_000, 100, 10}
    ]

    IO.puts("## Tagged RFC layout vs compact proposed layout")
    IO.puts("")
    IO.puts("| Scenario | Tagged RFC layout | Compact proposed | Savings |")
    IO.puts("|----------|-------------------|------------------|---------|")

    for {label, participants, values, moved, lagging} <- scenarios do
      tagged = measure(fn -> tagged_tables(participants, values, moved, lagging) end)
      compact = measure(fn -> compact_tables(participants, values, moved, lagging) end)

      IO.puts(
        "| #{label} | #{format_bytes(tagged.bytes)} | #{format_bytes(compact.bytes)} | #{savings(tagged.bytes, compact.bytes)} |"
      )
    end
  end

  defp customer_workload_estimates do
    shapes = 100_000
    rows_per_subquery = [1_000, 10_000]

    workloads = [
      %{
        name: "HumanLayer",
        observed_shapes: 75,
        observed_occurrences: 134,
        observed_cohorts: 13,
        source: "packages/sync-service/humanlayer.md"
      },
      %{
        name: "AutoArc",
        observed_shapes: 611,
        observed_occurrences: 291,
        observed_cohorts: 209,
        source: "packages/sync-service/autoarc.md"
      },
      %{
        name: "Hazel",
        observed_shapes: 13,
        observed_occurrences: 4,
        observed_cohorts: 4,
        source: "packages/sync-service/hazel.md"
      }
    ]

    coefficients = estimate_coefficients()

    IO.puts("## 100k-shape customer workload estimates")
    IO.puts("")

    IO.puts(
      "Steady-state estimates preserve each workload's observed subquery-occurrence and literal-cohort ratios."
    )

    IO.puts("")

    IO.puts(
      "| Customer | Source | Shared occurrences | Participants @100k shapes | Cohorts @100k shapes | Rows/cohort | Current | Compact proposed | Savings |"
    )

    IO.puts(
      "|----------|--------|--------------------|----------------------------|----------------------|-------------|---------|------------------|---------|"
    )

    for workload <- workloads, values <- rows_per_subquery do
      participants =
        scale_count(shapes, workload.observed_occurrences, workload.observed_shapes)

      cohorts = scale_count(shapes, workload.observed_cohorts, workload.observed_shapes)
      shared_pct = shared_pct(workload.observed_occurrences, workload.observed_cohorts)
      current = estimate_current(coefficients, participants, values)
      compact = estimate_compact(coefficients, participants, cohorts, values)

      IO.puts(
        "| #{workload.name} | #{workload.source} | #{shared_pct} | #{format_count(participants)} | #{format_count(cohorts)} | #{format_count(values)} | #{format_bytes(current)} | #{format_bytes(compact)} | #{savings(current, compact)} |"
      )
    end
  end

  defp current_tables(participants, values) do
    current = :ets.new(:current_per_shape, [:bag, :public])

    for participant <- ints(participants) do
      :ets.insert(current, {{:polarity, participant, @ref}, :positive})
      :ets.insert(current, {{:node_shape, @node}, {participant, 0, :positive, participant, []}})

      :ets.insert(
        current,
        {{:shape_node, participant}, {@node, 0, :positive, participant, []}}
      )

      :ets.insert(
        current,
        {{:shape_dep_node, participant, 0}, {@node, :positive, participant, []}}
      )

      for value <- ints(values) do
        :ets.insert(current, {{:node_positive_member, @node, value}, {participant, participant}})
        :ets.insert(current, {{:membership, participant, @ref, value}, true})
      end
    end

    %{current: current}
  end

  defp compact_workload_tables(participants, cohorts, values_per_cohort) do
    participant_meta = :ets.new(:compact_workload_participant_meta, [:set, :public])
    cohort_meta = :ets.new(:compact_workload_cohort_meta, [:set, :public])
    positive = :ets.new(:compact_workload_positive_participants, [:bag, :public])
    by_shape = :ets.new(:compact_workload_participants_by_shape, [:bag, :public])
    by_cohort = :ets.new(:compact_workload_participants_by_cohort, [:bag, :public])
    cohorts_by_subquery = :ets.new(:compact_workload_cohorts_by_subquery, [:bag, :public])
    shape_ref = :ets.new(:compact_workload_shape_ref_participant, [:bag, :public])
    participant_count = :ets.new(:compact_workload_participant_count, [:set, :public])
    cohort_value = :ets.new(:compact_workload_cohort_value, [:set, :public])
    exceptions = :ets.new(:compact_workload_exception_by_value, [:bag, :public])

    exceptions_by_participant =
      :ets.new(:compact_workload_exception_by_participant, [:bag, :public])

    for cohort <- ints(cohorts) do
      subquery_key = {:dependency, "dep_handle_#{cohort}", @ref}
      :ets.insert(cohort_meta, {cohort, subquery_key, @node, :active})
      :ets.insert(cohorts_by_subquery, {subquery_key, cohort})
      :ets.insert(participant_count, {cohort, 0})

      for value <- ints(values_per_cohort) do
        :ets.insert(cohort_value, {{cohort, value}, true, 0})
      end
    end

    for participant <- ints(participants) do
      cohort = rem(participant - 1, max(cohorts, 1)) + 1

      :ets.insert(participant_meta, {
        participant,
        participant,
        cohort,
        @ref,
        @node,
        :positive,
        participant,
        [],
        :indexed
      })

      :ets.insert(positive, {cohort, participant, participant})
      :ets.insert(by_shape, {participant, participant, cohort, :positive})
      :ets.insert(by_cohort, {cohort, participant})
      :ets.insert(shape_ref, {{participant, @ref}, participant, cohort})
    end

    %{
      participant_meta: participant_meta,
      cohort_meta: cohort_meta,
      positive: positive,
      by_shape: by_shape,
      by_cohort: by_cohort,
      cohorts_by_subquery: cohorts_by_subquery,
      shape_ref: shape_ref,
      participant_count: participant_count,
      cohort_value: cohort_value,
      exceptions: exceptions,
      exceptions_by_participant: exceptions_by_participant
    }
  end

  defp compact_tables(participants, values, moved, lagging) do
    participant_meta = :ets.new(:compact_participant_meta, [:set, :public])
    cohort_meta = :ets.new(:compact_cohort_meta, [:set, :public])
    positive = :ets.new(:compact_positive_participants, [:bag, :public])
    by_shape = :ets.new(:compact_participants_by_shape, [:bag, :public])
    by_cohort = :ets.new(:compact_participants_by_cohort, [:bag, :public])
    cohorts_by_subquery = :ets.new(:compact_cohorts_by_subquery, [:bag, :public])
    shape_ref = :ets.new(:compact_shape_ref_participant, [:bag, :public])
    participant_count = :ets.new(:compact_participant_count, [:set, :public])
    cohort_value = :ets.new(:compact_cohort_value, [:set, :public])
    exceptions = :ets.new(:compact_exception_by_value, [:bag, :public])
    exceptions_by_participant = :ets.new(:compact_exception_by_participant, [:bag, :public])
    moved_values = MapSet.new(ints(moved))

    :ets.insert(cohort_meta, {@cohort, @subquery_key, @node, :active})
    :ets.insert(cohorts_by_subquery, {@subquery_key, @cohort})
    :ets.insert(participant_count, {@cohort, participants})

    for participant <- ints(participants) do
      :ets.insert(participant_meta, {
        participant,
        participant,
        @cohort,
        @ref,
        @node,
        :positive,
        participant,
        [],
        :indexed
      })

      :ets.insert(positive, {@cohort, participant, participant})
      :ets.insert(by_shape, {participant, participant, @cohort, :positive})
      :ets.insert(by_cohort, {@cohort, participant})
      :ets.insert(shape_ref, {{participant, @ref}, participant, @cohort})
    end

    for value <- ints(values) do
      base_member? = not MapSet.member?(moved_values, value)
      exception_count = if base_member?, do: 0, else: lagging
      :ets.insert(cohort_value, {{@cohort, value}, base_member?, exception_count})

      if not base_member? do
        for participant <- ints(lagging) do
          :ets.insert(exceptions, {{@cohort, value}, participant})
          :ets.insert(exceptions_by_participant, {participant, @cohort, value})
        end
      end
    end

    %{
      participant_meta: participant_meta,
      cohort_meta: cohort_meta,
      positive: positive,
      by_shape: by_shape,
      by_cohort: by_cohort,
      cohorts_by_subquery: cohorts_by_subquery,
      shape_ref: shape_ref,
      participant_count: participant_count,
      cohort_value: cohort_value,
      exceptions: exceptions,
      exceptions_by_participant: exceptions_by_participant
    }
  end

  defp tagged_tables(participants, values, moved, lagging) do
    tagged = :ets.new(:tagged_rfc_layout, [:bag, :public])
    moved_values = MapSet.new(ints(moved))

    :ets.insert(tagged, {{:cohort_meta, @cohort}, {@subquery_key, @node, :active}})
    :ets.insert(tagged, {{:cohorts_by_subquery, @subquery_key}, @cohort})
    :ets.insert(tagged, {{:participant_count, @cohort}, participants})

    for participant <- ints(participants) do
      participant_tuple = {participant, @cohort, :positive, participant, []}

      :ets.insert(
        tagged,
        {{:participant_meta, participant},
         {
           participant,
           @cohort,
           @ref,
           @node,
           :positive,
           participant,
           [],
           :indexed
         }}
      )

      :ets.insert(tagged, {{:participants, @cohort, :positive}, participant_tuple})

      :ets.insert(
        tagged,
        {{:participants_by_shape, participant}, {participant, @cohort, :positive}}
      )

      :ets.insert(tagged, {{:participants_by_cohort, @cohort}, participant})
      :ets.insert(tagged, {{:shape_ref_participant, participant, @ref}, {participant, @cohort}})
    end

    for value <- ints(values) do
      base_member? = not MapSet.member?(moved_values, value)
      exception_count = if base_member?, do: 0, else: lagging

      :ets.insert(tagged, {{:base_member, @cohort, value}, base_member?})
      :ets.insert(tagged, {{:exception_count, @cohort, value}, exception_count})

      if not base_member? do
        for participant <- ints(lagging) do
          participant_tuple = {participant, @cohort, :positive, participant, []}
          :ets.insert(tagged, {{:exception_by_value, @cohort, value}, participant_tuple})
          :ets.insert(tagged, {{:exception_by_participant, participant_tuple}, {@cohort, value}})
        end
      end
    end

    %{tagged: tagged}
  end

  defp measure(fun) do
    :erlang.garbage_collect()

    tables = fun.()
    table_ids = Map.values(tables)
    bytes = table_ids |> Enum.map(&:ets.info(&1, :memory)) |> Enum.sum() |> words_to_bytes()
    rows = table_ids |> Enum.map(&:ets.info(&1, :size)) |> Enum.sum()

    Enum.each(table_ids, &:ets.delete/1)

    %{bytes: bytes, rows: rows}
  end

  defp estimate_coefficients do
    current_empty = measure(fn -> current_tables(0, 0) end).bytes
    current_participants = measure(fn -> current_tables(1_000, 0) end).bytes
    current_with_values = measure(fn -> current_tables(100, 1_000) end).bytes
    current_without_values = measure(fn -> current_tables(100, 0) end).bytes

    compact_empty = measure(fn -> compact_workload_tables(0, 0, 0) end).bytes
    compact_cohorts = measure(fn -> compact_workload_tables(0, 1_000, 0) end).bytes
    compact_participants = measure(fn -> compact_workload_tables(1_000, 1, 0) end).bytes
    compact_one_cohort = measure(fn -> compact_workload_tables(0, 1, 0) end).bytes
    compact_with_values = measure(fn -> compact_workload_tables(0, 100, 100) end).bytes
    compact_without_values = measure(fn -> compact_workload_tables(0, 100, 0) end).bytes

    %{
      current_fixed: current_empty,
      current_participant: (current_participants - current_empty) / 1_000,
      current_value:
        (current_with_values - current_without_values) /
          (100 * 1_000),
      compact_fixed: compact_empty,
      compact_cohort: (compact_cohorts - compact_empty) / 1_000,
      compact_participant: (compact_participants - compact_one_cohort) / 1_000,
      compact_value:
        (compact_with_values - compact_without_values) /
          (100 * 100)
    }
  end

  defp estimate_current(coefficients, participants, values) do
    coefficients.current_fixed +
      coefficients.current_participant * participants +
      coefficients.current_value * participants * values
  end

  defp estimate_compact(coefficients, participants, cohorts, values) do
    coefficients.compact_fixed +
      coefficients.compact_participant * participants +
      coefficients.compact_cohort * cohorts +
      coefficients.compact_value * cohorts * values
  end

  defp words_to_bytes(words), do: words * :erlang.system_info(:wordsize)

  defp format_bytes(bytes) when bytes < 1024, do: "#{bytes} B"
  defp format_bytes(bytes) when bytes < 1024 * 1024, do: "#{Float.round(bytes / 1024, 1)} KiB"

  defp format_bytes(bytes) when bytes < 1024 * 1024 * 1024,
    do: "#{Float.round(bytes / 1024 / 1024, 2)} MiB"

  defp format_bytes(bytes) when bytes < 1024 * 1024 * 1024 * 1024,
    do: "#{Float.round(bytes / 1024 / 1024 / 1024, 2)} GiB"

  defp format_bytes(bytes), do: "#{Float.round(bytes / 1024 / 1024 / 1024 / 1024, 2)} TiB"

  defp format_count(count) when is_integer(count) do
    count
    |> Integer.to_string()
    |> String.reverse()
    |> String.replace(~r/.{3}(?=.)/, "\\0,")
    |> String.reverse()
  end

  defp format_count(count), do: format_count(round(count))

  defp savings(current, proposed) do
    "#{Float.round((1 - proposed / current) * 100, 1)}%"
  end

  defp shared_pct(occurrences, cohorts) do
    "#{Float.round((occurrences - cohorts) / occurrences * 100, 1)}%"
  end

  defp scale_count(target_shapes, count, observed_shapes) do
    round(target_shapes * count / observed_shapes)
  end

  defp ints(0), do: []
  defp ints(count), do: 1..count
end

SubqueryIndexMemoryBench.run()
