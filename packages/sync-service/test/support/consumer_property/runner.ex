defmodule Support.ConsumerProperty.Runner do
  @moduledoc """
  Shared scenario runner for consumer property tests and stable reproductions.

  Accepts a list of events and expected final rows, sets up the shape consumer,
  feeds the events, and asserts log invariants + expected materialized state.

  ## Event format

  Events use a copy-pasteable tuple format:

      {:txn, xid: 100, lsn: 1000, ops: [insert: %{id: 1, parent_id: 2, value: "v"}]}
      {:move_in, values: [1, 2], name: "move_in_0"}
      {:move_out, values: [1, 2]}
      {:snapshot, name: "move_in_0", snapshot: {100, 101, []}}
      {:query_result, name: "move_in_0", snapshot: {100, 101, []}, rows: [%{id: 1, ...}]}

  ## Usage

      # In property tests:
      Runner.run_scenario(ctx,
        events: scenario.events,
        expected_rows: scenario.expected_rows,
        shape: @shape_with_subquery
      )

      # In stable reproductions (copy-paste Scenario.new(...) from failure output):
      scenario = Scenario.new(events: [...], expected_rows: %{...})
      Runner.run_scenario(ctx, scenario, shape: @shape_with_subquery, extended_output: true)
  """

  alias Electric.LogItems
  alias Electric.Shapes.Shape
  alias Electric.Postgres.Lsn
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset
  alias Electric.Replication.ShapeLogCollector
  alias Electric.ShapeCache
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes
  alias Electric.Shapes.Consumer
  alias Electric.Shapes.Shape.SubqueryMoves

  alias Support.ConsumerProperty.Generator
  alias Support.ConsumerProperty.Invariants

  import Support.TestUtils, only: [complete_txn_fragment: 3]
  import ExUnit.Assertions
  import ExUnit.Callbacks

  @receive_timeout 2_000

  def with_patched_snapshotter(ctx) do
    # Agent holds initial snapshot rows for the snapshotter task to read
    {:ok, agent} = Agent.start_link(fn -> [] end)

    Support.TestUtils.patch_snapshotter(fn parent,
                                           shape_handle,
                                           shape,
                                           %{snapshot_fun: snapshot_fun} ->
      GenServer.cast(parent, {:pg_snapshot_known, shape_handle, {10, 11, [10]}})
      GenServer.cast(parent, {:snapshot_started, shape_handle})

      initial_rows = Agent.get(agent, & &1)

      snapshot_items =
        Enum.map(initial_rows, fn row ->
          record = Map.new(row, fn {k, v} -> {to_string(k), to_string(v)} end)

          %Changes.NewRecord{
            relation: shape.root_table,
            record: record,
            log_offset: LogOffset.new(0, 0)
          }
          |> Changes.fill_key(Shape.pk(shape))
          |> Shape.fill_move_tags(shape, ctx.stack_id, shape_handle)
          # Normally snapshot items are formatted by the querying SQL, but we're going to reuse "normal path" for this test
          |> LogItems.from_change(0, [], :full)
          |> Enum.map(fn {_, item} ->
            Map.update!(
              item,
              :headers,
              &(Map.drop(&1, [:txids, :lsn, :op_position])
                |> Map.put(:__note, "from snapshotter"))
            )
          end)
          |> Enum.map(&Jason.encode!/1)
        end)

      snapshot_fun.(snapshot_items)
    end)

    test_pid = self()

    Repatch.patch(
      Electric.Shapes.PartialModes,
      :query_move_in_async,
      [mode: :shared],
      fn _task_sup, _shape_handle, _shape, _where_clause, opts ->
        send(
          test_pid,
          {:query_requested, opts[:move_in_name], opts[:consumer_pid], opts[:results_fn]}
        )

        :ok
      end
    )

    Support.TestUtils.activate_mocks_for_descendant_procs(Consumer)

    %{snapshot_agent: agent}
  end

  def run_scenario(ctx, %Support.ConsumerProperty.Scenario{} = scenario, opts) do
    run_scenario(ctx, [events: scenario.events, expected_rows: scenario.expected_rows] ++ opts)
  end

  def run_scenario(ctx, opts) when is_list(opts) do
    events = Keyword.fetch!(opts, :events)
    expected_rows = Keyword.fetch!(opts, :expected_rows)
    shape_def = Keyword.fetch!(opts, :shape)
    tag_column = Keyword.get(opts, :tag_column, :parent_id)
    extended_output = Keyword.get(opts, :extended_output, false)

    linked_values_at = derive_linked_values_at(events)

    # Extract initial snapshot rows and set them on the agent before shape creation
    initial_rows =
      case Enum.find(events, fn {type, _} -> type == :initial_rows end) do
        {:initial_rows, opts} -> opts[:rows] || []
        nil -> []
      end

    if ctx[:snapshot_agent] do
      Agent.update(ctx[:snapshot_agent], fn _ -> initial_rows end)
    end

    # Drain any leftover messages from previous iterations
    drain_query_requested()

    {shape_handle, _} = ShapeCache.get_or_create_shape_handle(shape_def, ctx.stack_id)
    :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

    {:ok, shape} = Shapes.fetch_shape_by_handle(ctx.stack_id, shape_handle)
    [dep_handle] = shape.shape_dependencies_handles

    consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
    _ref = Consumer.register_for_changes(ctx.stack_id, shape_handle)

    if opts[:with_materializer] do
      # Start a real Materializer that tracks the PK column ("id") so we can
      # verify its materialized state matches expected rows after the scenario.
      start_supervised!(
        {Consumer.Materializer,
         %{
           stack_id: ctx.stack_id,
           shape_handle: shape_handle,
           columns: ["id"],
           materialized_type: {:array, :int8}
         }}
      )

      Consumer.Materializer.wait_until_ready(%{
        stack_id: ctx.stack_id,
        shape_handle: shape_handle
      })
    end

    try do
      run_ctx =
        ctx
        |> Map.put(:linked_values_at, linked_values_at)
        |> Map.put(:shape_handle, shape_handle)
        |> Map.put(:relation, shape.root_table)
        |> Map.put(:tag_column, tag_column)

      # Compute the max LSN across txn events and snapshot wal_lsn fields.
      max_lsn =
        Enum.reduce(events, 0, fn
          {:txn, opts}, acc ->
            max(acc, opts[:lsn])

          {:snapshot, opts}, acc ->
            case opts[:wal_lsn] do
              nil -> acc
              lsn -> max(acc, lsn)
            end

          _, acc ->
            acc
        end)

      # Pre-fill the link values ETS table from the first :set_linked_values event
      # so Materializer.get_all_as_refs returns correct values from the start.
      case Enum.find(events, fn {type, _} -> type == :set_linked_values end) do
        {:set_linked_values, opts} ->
          update_ets_link_values(ctx.stack_id, dep_handle, MapSet.new(opts[:values]))

        nil ->
          :ok
      end

      # Append a global_last_seen_lsn event so buffered move-ins are flushed.
      # Always append — even with max_lsn=0, this triggers splice for buffered
      # move-ins that have nil wal_lsn (tests without explicit WAL LSN tracking).
      events_with_lsn_flush = events ++ [{:global_last_seen_lsn, lsn: max_lsn}]

      {consumer_alive?, mapping} =
        Enum.reduce_while(events_with_lsn_flush, {true, %{}}, fn event, {_, mapping} ->
          if Process.alive?(consumer_pid) do
            new_mapping =
              feed_event(event, consumer_pid, dep_handle, shape, run_ctx, mapping)

            {:cont, {true, new_mapping}}
          else
            {:halt, {false, mapping}}
          end
        end)

      shape_storage = Storage.for_shape(shape_handle, ctx.storage)

      log_items =
        if consumer_alive? do
          items =
            Storage.get_log_stream(
              LogOffset.before_all(),
              LogOffset.last_before_real_offsets(),
              shape_storage
            )
            |> Stream.concat(
              Storage.get_log_stream(LogOffset.last_before_real_offsets(), shape_storage)
            )
            |> Enum.map(&Jason.decode!/1)

          items
        else
          []
        end

      materialized =
        if log_items != [] do
          try do
            Invariants.walk_and_materialize(log_items, %{}, %{})
          rescue
            e ->
              flunk(
                flunk_message("Log invariant violated: #{Exception.message(e)}",
                  shape: shape,
                  events: events,
                  mapping: mapping,
                  log_items: log_items,
                  extended_output: extended_output
                )
              )
          end
        else
          %{}
        end

      unless expected_rows == :skip do
        assert materialized == expected_rows
      end

      # If a real materializer is running, verify its state matches expected rows.
      if (opts[:with_materializer] || false) and expected_rows != :skip do
        materializer_values =
          Consumer.Materializer.get_link_values(%{
            stack_id: ctx.stack_id,
            shape_handle: shape_handle
          })

        # Extract expected IDs from expected_rows values (each has an "id" field)
        expected_ids =
          expected_rows
          |> Map.values()
          |> Enum.map(fn row -> String.to_integer(row["id"]) end)
          |> MapSet.new()

        assert materializer_values == expected_ids,
               "Materializer state mismatch.\n" <>
                 "Materializer has: #{inspect(MapSet.to_list(materializer_values))}\n" <>
                 "Expected IDs: #{inspect(MapSet.to_list(expected_ids))}"
      end

      {shape_handle, fn -> cleanup_shape(consumer_pid, shape_handle, dep_handle, ctx) end}
    after
      if not Keyword.get(opts, :without_cleanup, false) do
        cleanup_shape(consumer_pid, shape_handle, dep_handle, ctx)
        Storage.cleanup!(ctx.storage, shape_handle)
      end
    end
  end

  # Derive linked_values_at from the event sequence.
  # Tracks active linked values through move-in/move-out events and records
  # the state at each WAL txn's xid.
  defp derive_linked_values_at(events) do
    {_active, lv_at} =
      Enum.reduce(events, {MapSet.new(), %{}}, fn
        {:set_linked_values, opts}, {_active, acc} ->
          {MapSet.new(opts[:values]), acc}

        {:move_in, opts}, {active, acc} ->
          values = MapSet.new(opts[:values])
          {MapSet.union(active, values), acc}

        {:move_out, opts}, {active, acc} ->
          values = MapSet.new(opts[:values])
          {MapSet.difference(active, values), acc}

        {:txn, opts}, {active, acc} ->
          {active, Map.put(acc, opts[:xid], active)}

        _, {active, acc} ->
          {active, acc}
      end)

    lv_at
  end

  # --- Event feeding ---

  defp feed_event({:initial_rows, _opts}, _consumer_pid, _dep_handle, _shape, _ctx, mapping) do
    mapping
  end

  defp feed_event({:set_linked_values, _opts}, _consumer_pid, _dep_handle, _shape, _ctx, mapping) do
    mapping
  end

  defp feed_event({:txn, opts}, _consumer_pid, dep_handle, _shape, ctx, mapping) do
    xid = opts[:xid]
    lsn = opts[:lsn]
    ops = opts[:ops]

    update_ets_link_values(ctx.stack_id, dep_handle, ctx.linked_values_at[xid])

    replication_changes =
      ops
      |> Enum.with_index()
      |> Enum.map(fn {op, idx} ->
        op_to_replication_change(op, lsn, idx, ctx.relation)
      end)

    lsn = Lsn.from_integer(lsn)
    txn = complete_txn_fragment(xid, lsn, replication_changes)
    ShapeLogCollector.handle_event(txn, ctx.stack_id)

    mapping
  end

  defp feed_event({:move_in, opts}, consumer_pid, dep_handle, _shape, _ctx, mapping) do
    move_in_tuples = Enum.map(opts[:values], fn v -> {v, to_string(v)} end)
    generator_name = opts[:name]

    send(
      consumer_pid,
      {:materializer_changes, dep_handle, %{move_in: move_in_tuples, move_out: []}}
    )

    ensure_processed(consumer_pid)

    receive do
      {:query_requested, actual_name, ^consumer_pid, results_fn} ->
        Process.put({:results_fn, actual_name}, results_fn)
        Map.put(mapping, generator_name, actual_name)
    after
      @receive_timeout ->
        mapping
    end
  end

  defp feed_event({:move_out, opts}, consumer_pid, dep_handle, _shape, _ctx, mapping) do
    move_out_tuples = Enum.map(opts[:values], fn v -> {v, to_string(v)} end)

    send(
      consumer_pid,
      {:materializer_changes, dep_handle, %{move_in: [], move_out: move_out_tuples}}
    )

    ensure_processed(consumer_pid)
    mapping
  end

  defp feed_event({:snapshot, opts}, consumer_pid, _dep_handle, _shape, _ctx, mapping) do
    generator_name = opts[:name]
    snapshot = opts[:snapshot]

    wal_lsn =
      case opts[:wal_lsn] do
        nil -> nil
        int when is_integer(int) -> Lsn.from_integer(int)
        %Lsn{} = lsn -> lsn
      end

    case Map.fetch(mapping, generator_name) do
      {:ok, actual_name} ->
        send(consumer_pid, {:pg_snapshot_known, actual_name, snapshot, wal_lsn})
        ensure_processed(consumer_pid)

      :error ->
        :ok
    end

    mapping
  end

  defp feed_event({:query_result, opts}, consumer_pid, _dep_handle, _shape, ctx, mapping) do
    generator_name = opts[:name]
    snapshot = opts[:snapshot]
    query_rows = opts[:rows]

    case Map.fetch(mapping, generator_name) do
      {:ok, actual_name} ->
        results_fn = Process.get({:results_fn, actual_name})

        if results_fn do
          rows =
            Enum.map(query_rows, fn row ->
              key = Generator.build_key(ctx.relation, row.id)
              value = row_to_string_map(row)
              tag_value = to_string(Map.fetch!(row, ctx.tag_column))

              tag =
                SubqueryMoves.make_value_hash(
                  ctx.stack_id,
                  ctx.shape_handle,
                  tag_value
                )

              json =
                Jason.encode!(%{
                  "key" => key,
                  "value" => value,
                  "headers" => %{
                    "operation" => "insert",
                    "relation" => Tuple.to_list(ctx.relation),
                    "is_move_in" => true,
                    "tags" => [tag]
                  }
                })

              [key, [tag], json]
            end)

          try do
            {keys, result_snapshot} = results_fn.(rows, snapshot)
            send(consumer_pid, {:query_move_in_complete, actual_name, keys, result_snapshot})
            ensure_processed(consumer_pid)
          rescue
            _ -> :ok
          end
        end

      :error ->
        :ok
    end

    mapping
  end

  defp feed_event({:global_last_seen_lsn, opts}, consumer_pid, _dep_handle, _shape, _ctx, mapping) do
    lsn = opts[:lsn]

    send(consumer_pid, {:global_last_seen_lsn, lsn})
    ensure_processed(consumer_pid)

    mapping
  end

  # --- Op to replication change conversion ---

  defp op_to_replication_change({:insert, row}, lsn, idx, relation) do
    record = row_to_string_map(row)

    %Changes.NewRecord{
      relation: relation,
      record: record,
      log_offset: LogOffset.new(Lsn.from_integer(lsn), idx)
    }
  end

  defp op_to_replication_change({:update, row}, lsn, idx, relation) do
    {old_record, new_record} = split_update_row(row)

    Changes.UpdatedRecord.new(
      relation: relation,
      old_record: old_record,
      record: new_record,
      log_offset: LogOffset.new(Lsn.from_integer(lsn), idx)
    )
  end

  defp op_to_replication_change({:update, old_record, new_record}, lsn, idx, relation) do
    Changes.UpdatedRecord.new(
      relation: relation,
      old_record: old_record,
      record: new_record,
      log_offset: LogOffset.new(Lsn.from_integer(lsn), idx)
    )
  end

  defp op_to_replication_change({:delete, row}, lsn, idx, relation) do
    old_record = row_to_string_map(row)

    %Changes.DeletedRecord{
      relation: relation,
      old_record: old_record,
      log_offset: LogOffset.new(Lsn.from_integer(lsn), idx)
    }
  end

  # Convert atom-keyed row map to string-keyed map with string values
  defp row_to_string_map(row) do
    Map.new(row, fn {k, v} -> {to_string(k), to_string(v)} end)
  end

  # Split an update row with [old: x, new: y] notation into {old_record, new_record}
  defp split_update_row(row) do
    {old, new} =
      Enum.reduce(row, {%{}, %{}}, fn {k, v}, {old_acc, new_acc} ->
        key = to_string(k)

        case v do
          [old: old_val, new: new_val] ->
            {Map.put(old_acc, key, to_string(old_val)), Map.put(new_acc, key, to_string(new_val))}

          plain ->
            str = to_string(plain)
            {Map.put(old_acc, key, str), Map.put(new_acc, key, str)}
        end
      end)

    {old, new}
  end

  # --- Helpers ---

  defp update_ets_link_values(_stack_id, _dep_handle, nil), do: :ok

  defp update_ets_link_values(stack_id, dep_handle, linked_values) do
    table = Electric.Shapes.Consumer.Materializer.link_values_table_name(stack_id)
    :ets.insert(table, {dep_handle, linked_values})
  rescue
    ArgumentError -> :ok
  end

  defp ensure_processed(pid) do
    if Process.alive?(pid) do
      :sys.get_state(pid)
    end
  rescue
    _ -> :ok
  end

  defp drain_query_requested do
    receive do
      {:query_requested, _, _, _} -> drain_query_requested()
    after
      0 -> :ok
    end
  end

  defp cleanup_shape(consumer_pid, shape_handle, dep_handle, ctx) do
    if consumer_pid && Process.alive?(consumer_pid) do
      Consumer.stop(consumer_pid, :normal)
    end

    Process.sleep(50)
    ShapeCache.clean_shape(shape_handle, ctx.stack_id)
    ShapeCache.clean_shape(dep_handle, ctx.stack_id)
    Process.sleep(100)
  end

  defp flunk_message(reason, opts) do
    shape = opts[:shape]
    base = "#{reason}\nShape where: #{inspect(shape.where.query)}"

    if opts[:extended_output] do
      mapping = opts[:mapping]
      log_items = opts[:log_items]
      linked_values_at = opts[:linked_values_at]

      parts = [
        base,
        "Move-in mapping: #{inspect(mapping, pretty: true, limit: :infinity)}",
        "linked_values_at: #{inspect(linked_values_at, pretty: true, limit: :infinity)}"
      ]

      parts =
        parts ++
          [
            "Log items: #{inspect(log_items, pretty: true, limit: :infinity, charlists: :as_lists)}"
          ]

      Enum.join(parts, "\n")
    else
      base
    end
  end
end
