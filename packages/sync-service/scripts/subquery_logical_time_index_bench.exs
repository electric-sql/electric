alias Electric.Shapes.Filter.Indexes.LogicalTimeSubqueryIndex

defmodule SubqueryLogicalTimeIndexBench do
  @moduledoc false

  @cohort :cohort
  @ref ["$sublink", "0"]
  @node :node
  @ops 20_000

  def run do
    IO.puts("# Subquery logical-time index prototype benchmark")
    IO.puts("")
    IO.puts("* OTP: #{System.otp_release()}")
    IO.puts("* Elixir: #{System.version()}")
    IO.puts("* Word size: #{:erlang.system_info(:wordsize)} bytes")
    IO.puts("")

    memory_table()
    IO.puts("")
    performance_table()
  end

  defp memory_table do
    scenarios = [
      {"1 participant, 1k values, steady", 1, 1_000, 0, 0},
      {"10 participants, 1k values, steady", 10, 1_000, 0, 0},
      {"100 participants, 1k values, steady", 100, 1_000, 0, 0},
      {"100 participants, 10k values, steady", 100, 10_000, 0, 0},
      {"100 participants, 1k values, 100 moved x 1 divergent", 100, 1_000, 100, 1},
      {"100 participants, 1k values, 100 moved x 10 divergent", 100, 1_000, 100, 10},
      {"100 participants, 1k values, 100 moved x 99 divergent", 100, 1_000, 100, 99},
      {"100 participants, 1k values, 1k moved x 99 divergent", 100, 1_000, 1_000, 99}
    ]

    IO.puts("## ETS Memory")
    IO.puts("")
    IO.puts("| Scenario | Current per-shape | XOR sparse | Logical-time | Logical vs current |")
    IO.puts("|----------|-------------------|------------|--------------|--------------------|")

    for {label, participants, values, moved, divergent} <- scenarios do
      current = measure(fn -> current_tables(participants, values, moved, divergent) end)
      xor = measure(fn -> xor_tables(participants, values, moved, divergent) end)
      logical = measure(fn -> logical_tables(participants, values, moved, divergent) end)
      savings = savings(current.bytes, logical.bytes)

      IO.puts(
        "| #{label} | #{format_bytes(current.bytes)} | #{format_bytes(xor.bytes)} | #{format_bytes(logical.bytes)} | #{savings} |"
      )
    end
  end

  defp performance_table do
    participants = 100
    values = 1_000
    moved = 100
    divergent = 10
    value = 1
    participant = 1

    current_tables = current_tables(participants, values, moved, divergent)
    xor_tables = xor_tables(participants, values, moved, divergent)
    logical = logical_index(participants, values, moved, divergent)

    try do
      IO.puts("## Microbenchmarks")
      IO.puts("")

      IO.puts(
        "Scenario: 100 participants, 1k values, 100 moved values, 10 divergent participants."
      )

      IO.puts("Each figure is average microseconds over #{@ops} iterations.")
      IO.puts("")
      IO.puts("| Operation | Current per-shape | XOR sparse | Logical-time |")
      IO.puts("|-----------|-------------------|------------|--------------|")

      route_current =
        avg_us(fn ->
          :ets.lookup(current_tables.current, {:node_positive_member, @node, value})
        end)

      route_xor =
        avg_us(fn ->
          xor_route(xor_tables, value)
        end)

      route_logical =
        avg_us(fn ->
          LogicalTimeSubqueryIndex.route(logical, @cohort, value)
        end)

      member_current =
        avg_us(fn ->
          :ets.member(current_tables.current, {:membership, participant, @ref, value})
        end)

      member_xor =
        avg_us(fn ->
          xor_member?(xor_tables, participant, value)
        end)

      member_logical =
        avg_us(fn ->
          LogicalTimeSubqueryIndex.participant_member?(logical, participant, value)
        end)

      IO.puts(
        "| route moved value | #{format_us(route_current)} | #{format_us(route_xor)} | #{format_us(route_logical)} |"
      )

      IO.puts(
        "| exact member? | #{format_us(member_current)} | #{format_us(member_xor)} | #{format_us(member_logical)} |"
      )
    after
      Enum.each(Map.values(current_tables), &:ets.delete/1)
      Enum.each(Map.values(xor_tables), &:ets.delete/1)
      LogicalTimeSubqueryIndex.delete(logical)
    end
  end

  defp current_tables(participants, values, moved, divergent) do
    current = :ets.new(:current_per_shape, [:bag, :public])
    moved_values = MapSet.new(ints(moved))

    for participant <- ints(participants), value <- ints(values) do
      moved_value? = MapSet.member?(moved_values, value)

      if not moved_value? or participant <= divergent do
        :ets.insert(current, {{:node_positive_member, @node, value}, {participant, participant}})
        :ets.insert(current, {{:membership, participant, @ref, value}, true})
      end
    end

    %{current: current}
  end

  defp xor_tables(participants, values, moved, divergent) do
    positive = :ets.new(:xor_positive_participants, [:bag, :public])
    by_shape = :ets.new(:xor_participants_by_shape, [:bag, :public])
    shape_ref = :ets.new(:xor_shape_ref_participant, [:bag, :public])
    cohort_value = :ets.new(:xor_cohort_value, [:set, :public])
    exceptions = :ets.new(:xor_exception_by_value, [:bag, :public])
    exceptions_by_participant = :ets.new(:xor_exception_by_participant, [:bag, :public])
    participant_count = :ets.new(:xor_participant_count, [:set, :public])
    moved_values = MapSet.new(ints(moved))

    for participant <- ints(participants) do
      :ets.insert(positive, {@cohort, participant, participant})
      :ets.insert(by_shape, {participant, participant, @cohort, :positive})
      :ets.insert(shape_ref, {{participant, @ref}, participant, @cohort})
    end

    :ets.insert(participant_count, {@cohort, participants})

    for value <- ints(values) do
      base_member? = not MapSet.member?(moved_values, value)
      exception_count = if base_member?, do: 0, else: divergent
      :ets.insert(cohort_value, {{@cohort, value}, base_member?, exception_count})

      if not base_member? do
        for participant <- ints(divergent) do
          :ets.insert(exceptions, {{@cohort, value}, participant})
          :ets.insert(exceptions_by_participant, {participant, @cohort, value})
        end
      end
    end

    %{
      positive: positive,
      by_shape: by_shape,
      shape_ref: shape_ref,
      cohort_value: cohort_value,
      exceptions: exceptions,
      exceptions_by_participant: exceptions_by_participant,
      participant_count: participant_count
    }
  end

  defp logical_tables(participants, values, moved, divergent) do
    index = logical_index(participants, values, moved, divergent)
    Map.new(LogicalTimeSubqueryIndex.tables(index), &{&1, &1})
  end

  defp logical_index(participants, values, moved, divergent) do
    index = LogicalTimeSubqueryIndex.new()
    LogicalTimeSubqueryIndex.new_cohort(index, @cohort, ints(values))

    latest_time =
      if moved == 0 do
        0
      else
        LogicalTimeSubqueryIndex.advance(index, @cohort, Enum.map(ints(moved), &{&1, false}))
      end

    for participant <- ints(participants) do
      time = if moved > 0 and participant <= divergent, do: 0, else: latest_time

      LogicalTimeSubqueryIndex.add_participant(index, participant, @cohort, :positive,
        participant_id: participant,
        time: time
      )
    end

    index
  end

  defp xor_route(tables, value) do
    [{{@cohort, ^value}, base_member?, _exception_count}] =
      :ets.lookup(tables.cohort_value, {@cohort, value})

    if base_member? do
      exceptions =
        tables.exceptions
        |> :ets.lookup({@cohort, value})
        |> MapSet.new(fn {{@cohort, ^value}, participant} -> participant end)

      tables.positive
      |> :ets.lookup(@cohort)
      |> Enum.reject(fn {@cohort, participant, _next_condition_id} ->
        MapSet.member?(exceptions, participant)
      end)
    else
      :ets.lookup(tables.exceptions, {@cohort, value})
    end
  end

  defp xor_member?(tables, participant, value) do
    [{{@cohort, ^value}, base_member?, _exception_count}] =
      :ets.lookup(tables.cohort_value, {@cohort, value})

    has_exception? =
      tables.exceptions
      |> :ets.lookup({@cohort, value})
      |> Enum.any?(fn {{@cohort, ^value}, ^participant} -> true end)

    base_member? != has_exception?
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

  defp avg_us(fun) do
    fun.()

    {time, _} =
      :timer.tc(fn ->
        for _ <- 1..@ops do
          fun.()
        end
      end)

    time / @ops
  end

  defp words_to_bytes(words), do: words * :erlang.system_info(:wordsize)

  defp format_bytes(bytes) when bytes < 1024, do: "#{bytes} B"
  defp format_bytes(bytes) when bytes < 1024 * 1024, do: "#{Float.round(bytes / 1024, 1)} KiB"
  defp format_bytes(bytes), do: "#{Float.round(bytes / 1024 / 1024, 2)} MiB"

  defp savings(current, logical) do
    "#{Float.round((1 - logical / current) * 100, 1)}%"
  end

  defp format_us(us), do: "#{Float.round(us, 3)} us"

  defp ints(0), do: []
  defp ints(count), do: 1..count
end

SubqueryLogicalTimeIndexBench.run()
