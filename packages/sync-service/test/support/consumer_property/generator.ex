defmodule Support.ConsumerProperty.Generator do
  @moduledoc """
  StreamData generators that produce `%Scenario{}` values for Consumer property tests.

  The shape under test is: `test_table WHERE parent_id IN (SELECT id FROM other_table)`
  - The dependency shape materializes `other_table`, tracking which `id` values exist
  - Move-in: new `id` values appear in `other_table` (e.g., id=3 inserted into other_table)
  - Move-out: `id` values disappear from `other_table`
  - WAL events: INSERTs/UPDATEs/DELETEs on `test_table`
  - A `test_table` row with `parent_id=X` is "in shape" only if X is in the active linked values
  - UPDATEs can change `parent_id`, causing FK migration across sublink values

  Each row in the model tracks `{parent_id, value}`. The PK is `id` (an auto-incrementing
  integer), and `parent_id` is the FK sublink column that determines shape membership.

  ## Event format

  Events are valid Elixir tuples with keyword list options, designed for copy-paste
  from test failure output into stable reproduction tests.

      {:txn, xid: 100, lsn: 1000, ops: [
        insert: %{id: 1, parent_id: 2, value: "v"},
        update: %{id: 1, parent_id: [old: 2, new: 3], value: "v"},
        delete: %{id: 1, parent_id: 2, value: "v"}
      ]}
      {:move_in, values: [1, 2], name: "move_in_0"}
      {:move_out, values: [1, 2]}
      {:snapshot, name: "move_in_0", snapshot: {100, 101, []}}
      {:query_result, name: "move_in_0", snapshot: {100, 101, []}, rows: [
        %{id: 1, parent_id: 2, value: "v"}
      ]}

  For updates, a column value of `[old: x, new: y]` indicates a change;
  a plain value means the column is unchanged.
  """

  use ExUnitProperties

  alias Support.ConsumerProperty.Scenario
  alias Support.ConsumerProperty.Scenario.ModelState

  @max_row_id 8
  @max_linked_id 8
  @relation {"public", "test_table"}

  def scenario do
    gen all(
          num_initial_values <- integer(0..3),
          initial_values <- initial_linked_values(num_initial_values),
          initial_insert_flags <- list_of(boolean(), length: num_initial_values),
          initial_insert_values <- list_of(constant("v"), length: num_initial_values),
          num_initial_snapshot_rows <- integer(0..3),
          initial_snapshot_row_seeds <-
            list_of(initial_snapshot_row_seed(), length: num_initial_snapshot_rows),
          num_initial_move_ins <- integer(1..3),
          initial_move_seeds <-
            list_of(move_in_seed(), length: num_initial_move_ins),
          num_ops <- integer(10..100),
          ops_seed <- list_of(operation_seed(), length: num_ops),
          txn_sizes <-
            list_of(
              frequency([
                {5, constant(1)},
                {3, constant(2)},
                {2, constant(3)},
                {1, constant(4)}
              ]),
              min_length: num_ops + num_initial_move_ins
            ),
          snapshot_delay_seeds <-
            list_of(float(min: 0.0, max: 1.0), min_length: 30, max_length: 60),
          async_timing_seeds <-
            list_of(float(min: 0.0, max: 1.0), min_length: 60, max_length: 120)
        ) do
      initial_setup = %{
        values: initial_values,
        insert_flags: initial_insert_flags,
        insert_values: initial_insert_values,
        snapshot_row_seeds: initial_snapshot_row_seeds
      }

      build_scenario(
        initial_setup,
        initial_move_seeds ++ ops_seed,
        txn_sizes,
        snapshot_delay_seeds,
        async_timing_seeds
      )
    end
  end

  defp initial_snapshot_row_seed do
    gen all(value <- member_of(["v1", "v2", "v3"])) do
      %{value: value}
    end
  end

  defp initial_linked_values(0), do: constant([])

  defp initial_linked_values(n) do
    gen all(values <- uniq_list_of(integer(1..@max_linked_id), length: n)) do
      values
    end
  end

  defp move_in_seed do
    gen all(move_values <- list_of(integer(1..@max_linked_id), min_length: 1, max_length: 3)) do
      %{op_type: :move_in, row_id: 1, value: "x", move_values: move_values}
    end
  end

  defp operation_seed do
    gen all(
          op_type <-
            frequency([
              {3, constant(:insert)},
              {3, constant(:update)},
              {2, constant(:delete)},
              {2, constant(:update_parent_id)},
              {1, constant(:move_in)},
              {1, constant(:move_out)}
            ]),
          row_id <- integer(1..@max_row_id),
          parent_id <- integer(1..@max_linked_id),
          value <- member_of(["a", "b"]),
          move_values <- list_of(integer(1..@max_linked_id), min_length: 1, max_length: 2)
        ) do
      %{
        op_type: op_type,
        row_id: row_id,
        parent_id: parent_id,
        value: value,
        move_values: move_values
      }
    end
  end

  defp build_scenario(
         initial_setup,
         ops_seed,
         txn_sizes,
         snapshot_delay_seeds,
         async_timing_seeds
       ) do
    {model, wal_events, linked_values_at, initial_rows} =
      generate_timeline(initial_setup, ops_seed, txn_sizes)

    pending_names =
      model.pending_move_ins
      |> Enum.sort_by(fn {_name, info} -> info.triggered_at_xid end)
      |> Enum.map(fn {name, _info} -> name end)

    placeholder_async =
      Enum.flat_map(pending_names, fn name ->
        [
          {:snapshot, name: name, snapshot: :placeholder},
          {:query_result, name: name, snapshot: :placeholder, rows: :placeholder}
        ]
      end)

    events_with_placeholders =
      interleave_events(wal_events, placeholder_async, async_timing_seeds)

    events = resolve_snapshots(events_with_placeholders, model, snapshot_delay_seeds)
    expected_rows = compute_expected_rows(model)

    # Prepend initial_rows event if there are any snapshot rows
    events =
      if initial_rows != [] do
        [{:initial_rows, rows: initial_rows} | events]
      else
        events
      end

    # [P.splice] Append a global_last_seen_lsn event at the end so that any
    # buffered move-in results that haven't been spliced by a WAL txn trigger
    # get spliced via the secondary (LSN-based) trigger. Use the highest LSN
    # from all txn events.
    max_lsn =
      events
      |> Enum.reduce(0, fn
        {:txn, opts}, acc -> max(acc, opts[:lsn])
        _, acc -> acc
      end)

    events =
      if max_lsn > 0 and pending_names != [] do
        events ++ [{:global_last_seen_lsn, lsn: max_lsn}]
      else
        events
      end

    %Scenario{
      events: events,
      expected_rows: expected_rows,
      linked_values_at: linked_values_at,
      move_in_results: %{}
    }
  end

  # Phase 1: Generate timeline
  defp generate_timeline(initial_setup, ops_seed, txn_sizes) do
    initial_linked = MapSet.new(initial_setup.values)
    initial_model = %ModelState{active_linked_values: initial_linked}

    # Generate initial snapshot rows — these exist in the DB before the shape is created.
    # They have valid FK values pointing to active linked values.
    {model_after_snapshot, initial_rows} =
      generate_initial_snapshot_rows(
        initial_model,
        Map.get(initial_setup, :snapshot_row_seeds, [])
      )

    {model, initial_events, initial_lv_at} =
      initial_setup.values
      |> Enum.zip(Enum.zip(initial_setup.insert_flags, initial_setup.insert_values))
      |> Enum.reduce({model_after_snapshot, [], %{}}, fn {parent_id, {do_insert?, value}},
                                                         {model, events, lv_at} ->
        if do_insert? do
          id = model.next_row_id
          xid = model.next_xid
          lsn = model.next_lsn
          row = %{parent_id: parent_id, value: value}
          new_rows = Map.put(model.rows, id, row)

          new_model = %{
            model
            | next_xid: xid + 1,
              next_lsn: lsn + 1,
              next_row_id: id + 1,
              rows: new_rows,
              rows_at_xid: Map.put(model.rows_at_xid, xid, new_rows),
              lsn_at_xid: Map.put(model.lsn_at_xid, xid, lsn)
          }

          op = {:insert, %{id: id, parent_id: parent_id, value: value}}
          event = {:txn, xid: xid, lsn: lsn, ops: [op]}
          {new_model, [event | events], Map.put(lv_at, xid, model.active_linked_values)}
        else
          {model, events, lv_at}
        end
      end)

    initial_events_ordered =
      if initial_linked == MapSet.new() do
        Enum.reverse(initial_events)
      else
        [
          {:set_linked_values, values: MapSet.to_list(initial_linked)}
          | Enum.reverse(initial_events)
        ]
      end

    # Chunk ops into transaction groups — multiple WAL ops may share a single txn
    groups = chunk_by_sizes(ops_seed, txn_sizes)

    {model, wal_events_rev, linked_values_at} =
      Enum.reduce(groups, {model, [], initial_lv_at}, fn group, {model, events_acc, lv_at} ->
        process_txn_group(group, model, events_acc, lv_at)
      end)

    {model, initial_events_ordered ++ Enum.reverse(wal_events_rev), linked_values_at,
     initial_rows}
  end

  # Generate rows that exist in the initial snapshot (not from WAL transactions).
  # These rows are in the shape from the start but NOT tracked in key_ownership.
  defp generate_initial_snapshot_rows(model, []), do: {model, []}

  defp generate_initial_snapshot_rows(model, snapshot_row_seeds) do
    if MapSet.size(model.active_linked_values) == 0 do
      # No active linked values — can't create rows that are in the shape
      {model, []}
    else
      active_list = MapSet.to_list(model.active_linked_values)

      {final_model, rows_rev} =
        Enum.reduce(snapshot_row_seeds, {model, []}, fn seed, {model, rows} ->
          id = model.next_row_id
          # Pick a parent_id from the active linked values so the row is in the shape
          parent_id = Enum.at(active_list, rem(id, length(active_list)))
          row_data = %{parent_id: parent_id, value: seed.value}

          new_model = %{
            model
            | next_row_id: id + 1,
              rows: Map.put(model.rows, id, row_data)
          }

          snapshot_row = %{id: id, parent_id: parent_id, value: seed.value}
          {new_model, [snapshot_row | rows]}
        end)

      {final_model, Enum.reverse(rows_rev)}
    end
  end

  # Process a group of operation seeds, batching WAL changes into a single transaction.
  # Move-in/move-out seeds flush any accumulated WAL changes before emitting their event.
  defp process_txn_group(seeds, model, events_acc, lv_at) do
    {model, events_acc, lv_at, pending} =
      Enum.reduce(seeds, {model, events_acc, lv_at, {[], MapSet.new()}}, fn
        seed, {model, events_acc, lv_at, {changes, touched}} ->
          if seed.op_type in [:move_in, :move_out] do
            # Flush pending WAL changes before the control event
            {model, events_acc, lv_at} = flush_pending_changes(model, events_acc, lv_at, changes)

            case try_generate_control_event(seed, model) do
              nil ->
                {model, events_acc, lv_at, {[], MapSet.new()}}

              {new_model, new_events} ->
                new_events_acc = Enum.reverse(new_events) ++ events_acc
                {new_model, new_events_acc, lv_at, {[], MapSet.new()}}
            end
          else
            case try_generate_wal_change(seed, model, touched) do
              nil ->
                {model, events_acc, lv_at, {changes, touched}}

              {new_model, change, touched_id} ->
                {new_model, events_acc, lv_at,
                 {changes ++ [change], MapSet.put(touched, touched_id)}}
            end
          end
      end)

    # Flush any remaining pending WAL changes
    {changes, _touched} = pending
    flush_pending_changes(model, events_acc, lv_at, changes)
  end

  defp flush_pending_changes(model, events_acc, lv_at, []), do: {model, events_acc, lv_at}

  defp flush_pending_changes(model, events_acc, lv_at, changes) do
    xid = model.next_xid
    lsn = model.next_lsn

    new_model = %{
      model
      | next_xid: xid + 1,
        next_lsn: lsn + 1,
        rows_at_xid: Map.put(model.rows_at_xid, xid, model.rows),
        lsn_at_xid: Map.put(model.lsn_at_xid, xid, lsn)
    }

    event = {:txn, xid: xid, lsn: lsn, ops: changes}
    new_lv_at = Map.put(lv_at, xid, model.active_linked_values)

    {new_model, [event | events_acc], new_lv_at}
  end

  defp chunk_by_sizes([], _sizes), do: []
  defp chunk_by_sizes(_list, []), do: []

  defp chunk_by_sizes(list, [size | rest_sizes]) do
    {chunk, rest} = Enum.split(list, size)

    if chunk == [] do
      []
    else
      [chunk | chunk_by_sizes(rest, rest_sizes)]
    end
  end

  # --- WAL change generators (update model.rows/next_row_id only, not xid/lsn/rows_at_xid) ---

  defp try_generate_wal_change(%{op_type: :insert} = seed, model, _touched_keys) do
    if map_size(model.rows) >= @max_row_id do
      nil
    else
      id = model.next_row_id

      parent_id = pick_parent_id(seed.parent_id, model.active_linked_values)
      row = %{parent_id: parent_id, value: seed.value}

      new_model = %{model | rows: Map.put(model.rows, id, row), next_row_id: id + 1}

      change = {:insert, %{id: id, parent_id: parent_id, value: seed.value}}

      {new_model, change, id}
    end
  end

  defp try_generate_wal_change(%{op_type: :update} = seed, model, touched_keys) do
    case pick_row_id(seed.row_id, model.rows, touched_keys) do
      nil ->
        nil

      id ->
        old_row = Map.fetch!(model.rows, id)
        new_row = %{old_row | value: seed.value}
        new_model = %{model | rows: Map.put(model.rows, id, new_row)}

        value_field =
          if old_row.value == seed.value,
            do: old_row.value,
            else: [old: old_row.value, new: seed.value]

        change = {:update, %{id: id, parent_id: old_row.parent_id, value: value_field}}

        {new_model, change, id}
    end
  end

  defp try_generate_wal_change(%{op_type: :update_parent_id} = seed, model, touched_keys) do
    case pick_row_id(seed.row_id, model.rows, touched_keys) do
      nil ->
        nil

      id ->
        old_row = Map.fetch!(model.rows, id)
        new_parent_id = compute_new_parent_id(seed.parent_id, old_row.parent_id)

        if new_parent_id == old_row.parent_id do
          nil
        else
          new_row = %{old_row | parent_id: new_parent_id}
          new_model = %{model | rows: Map.put(model.rows, id, new_row)}

          change =
            {:update,
             %{
               id: id,
               parent_id: [old: old_row.parent_id, new: new_parent_id],
               value: old_row.value
             }}

          {new_model, change, id}
        end
    end
  end

  defp try_generate_wal_change(%{op_type: :delete} = seed, model, touched_keys) do
    case pick_row_id(seed.row_id, model.rows, touched_keys) do
      nil ->
        nil

      id ->
        old_row = Map.fetch!(model.rows, id)
        new_model = %{model | rows: Map.delete(model.rows, id)}

        change = {:delete, %{id: id, parent_id: old_row.parent_id, value: old_row.value}}

        {new_model, change, id}
    end
  end

  defp try_generate_wal_change(_seed, _model, _touched_keys), do: nil

  # Pick a row ID that exists and hasn't been touched in this transaction
  defp pick_row_id(preferred_id, rows, touched_keys) do
    if map_size(rows) == 0 do
      nil
    else
      ids = Map.keys(rows)
      available = Enum.reject(ids, &MapSet.member?(touched_keys, &1))

      if available == [] do
        nil
      else
        if preferred_id in available, do: preferred_id, else: List.first(available)
      end
    end
  end

  defp pick_parent_id(seed_parent_id, active_linked_values) do
    if MapSet.size(active_linked_values) > 0 do
      active = MapSet.to_list(active_linked_values)
      Enum.at(active, rem(seed_parent_id, length(active)))
    else
      seed_parent_id
    end
  end

  defp compute_new_parent_id(seed_parent_id, old_parent_id) do
    if seed_parent_id == old_parent_id do
      candidates = Enum.to_list(1..@max_linked_id) -- [old_parent_id]
      if candidates == [], do: old_parent_id, else: List.first(candidates)
    else
      seed_parent_id
    end
  end

  # --- Control event generators (move-in / move-out) ---

  defp try_generate_control_event(%{op_type: :move_in} = seed, model) do
    available = MapSet.new(1..@max_linked_id) |> MapSet.difference(model.active_linked_values)

    if MapSet.size(available) == 0 do
      nil
    else
      values =
        seed.move_values
        |> Enum.uniq()
        |> Enum.filter(&MapSet.member?(available, &1))

      values =
        if values == [],
          do: [available |> MapSet.to_list() |> List.first()],
          else: values

      counter = model.move_in_counter
      name = "move_in_#{counter}"

      new_model = %{
        model
        | active_linked_values: MapSet.union(model.active_linked_values, MapSet.new(values)),
          move_in_counter: counter + 1,
          pending_move_ins:
            Map.put(model.pending_move_ins, name, %{
              values: MapSet.new(values),
              triggered_at_xid: model.next_xid
            })
      }

      {new_model, [{:move_in, values: values, name: name}]}
    end
  end

  defp try_generate_control_event(%{op_type: :move_out} = seed, model) do
    if MapSet.size(model.active_linked_values) == 0 do
      nil
    else
      active = MapSet.to_list(model.active_linked_values)

      values =
        seed.move_values
        |> Enum.uniq()
        |> Enum.filter(&(&1 in active))

      values = if values == [], do: [List.first(active)], else: values

      new_model = %{
        model
        | active_linked_values: MapSet.difference(model.active_linked_values, MapSet.new(values))
      }

      {new_model, [{:move_out, values: values}]}
    end
  end

  defp try_generate_control_event(_seed, _model), do: nil

  # Phase 2: Resolve placeholder snapshots based on position in interleaved events.
  # The snapshot xid must be >= the highest WAL xid preceding the pg_snapshot_known,
  # because PG is always ahead of the replication stream.
  defp resolve_snapshots(events, model, snapshot_delay_seeds) do
    all_xids = Map.keys(model.rows_at_xid) |> Enum.sort()
    max_xid = if all_xids == [], do: model.next_xid - 1, else: List.last(all_xids)

    delay_stream =
      Stream.cycle(snapshot_delay_seeds) |> Stream.take(map_size(model.pending_move_ins))

    delay_map =
      model.pending_move_ins
      |> Enum.sort_by(fn {name, _} -> name end)
      |> Enum.zip(delay_stream)
      |> Map.new(fn {{name, _}, seed} -> {name, seed} end)

    {resolved, _, _, _} =
      Enum.reduce(events, {[], 0, 0, %{}}, fn event,
                                              {acc, highest_wal_xid, highest_wal_lsn, snapshots} ->
        case event do
          {:txn, opts} ->
            {[event | acc], max(highest_wal_xid, opts[:xid]), max(highest_wal_lsn, opts[:lsn]),
             snapshots}

          {:snapshot, opts} ->
            if opts[:snapshot] == :placeholder do
              name = opts[:name]
              min_snapshot_xid = highest_wal_xid
              available = Enum.filter(all_xids, &(&1 >= min_snapshot_xid))

              delay_seed = Map.get(delay_map, name, 0.5)

              snapshot_xid =
                if available == [] do
                  max(max_xid, min_snapshot_xid)
                else
                  idx = trunc(delay_seed * length(available))
                  idx = min(idx, length(available) - 1)
                  Enum.at(available, idx)
                end

              snapshot = {snapshot_xid, snapshot_xid + 1, []}
              new_snapshots = Map.put(snapshots, name, snapshot)

              # wal_lsn must be the LSN of snapshot_xid (or the highest LSN
              # visible in the snapshot). The Postgres connection that returned
              # this snapshot must have been taken when the WAL was at least at
              # this point. Using highest_wal_lsn would be incorrect when
              # snapshot_xid is ahead of the consumer's current WAL position.
              snapshot_wal_lsn = Map.get(model.lsn_at_xid, snapshot_xid, highest_wal_lsn)

              {[{:snapshot, name: name, snapshot: snapshot, wal_lsn: snapshot_wal_lsn} | acc],
               highest_wal_xid, highest_wal_lsn, new_snapshots}
            else
              {[event | acc], highest_wal_xid, highest_wal_lsn, snapshots}
            end

          {:query_result, opts} ->
            if opts[:rows] == :placeholder do
              name = opts[:name]
              snapshot = Map.fetch!(snapshots, name)
              {snapshot_xid, _, _} = snapshot
              info = Map.fetch!(model.pending_move_ins, name)

              rows_at = rows_at_snapshot(model.rows_at_xid, all_xids, snapshot_xid)

              query_rows =
                for {id, row} <- rows_at,
                    MapSet.member?(info.values, row.parent_id) do
                  %{id: id, parent_id: row.parent_id, value: row.value}
                end

              resolved_event =
                {:query_result, name: name, snapshot: snapshot, rows: query_rows}

              {[resolved_event | acc], highest_wal_xid, highest_wal_lsn, snapshots}
            else
              {[event | acc], highest_wal_xid, highest_wal_lsn, snapshots}
            end

          _ ->
            {[event | acc], highest_wal_xid, highest_wal_lsn, snapshots}
        end
      end)

    Enum.reverse(resolved)
  end

  defp rows_at_snapshot(rows_at_xid, all_xids, snapshot_xid) do
    case Enum.filter(all_xids, &(&1 <= snapshot_xid)) |> List.last() do
      nil -> %{}
      xid -> Map.get(rows_at_xid, xid, %{})
    end
  end

  # Phase 3: Interleave WAL events with async events
  defp interleave_events(wal_events, [], _timing_seeds), do: wal_events

  defp interleave_events(wal_events, async_events, timing_seeds) do
    grouped = group_async_by_name(async_events)

    move_in_positions =
      wal_events
      |> Enum.with_index()
      |> Enum.reduce(%{}, fn
        {{:move_in, opts}, idx}, acc -> Map.put(acc, opts[:name], idx)
        _, acc -> acc
      end)

    {final_events, _} =
      grouped
      |> Enum.zip(Stream.cycle(timing_seeds))
      |> Enum.reduce({wal_events, 0}, fn {{name, group}, seed}, {events, offset} ->
        move_in_pos = Map.get(move_in_positions, name, 0) + offset
        available_range = length(events) - move_in_pos - 1

        insert_at =
          if available_range <= 0 do
            length(events)
          else
            move_in_pos + 1 + trunc(seed * available_range)
          end

        {insert_at_multiple(events, insert_at, group), offset + length(group)}
      end)

    final_events
  end

  defp group_async_by_name(async_events) do
    async_events
    |> Enum.group_by(fn
      {:snapshot, opts} -> opts[:name]
      {:query_result, opts} -> opts[:name]
    end)
    |> Enum.sort_by(fn {name, _} -> name end)
    |> Enum.map(fn {name, events} ->
      sorted =
        Enum.sort_by(events, fn
          {:snapshot, _} -> 0
          {:query_result, _} -> 1
        end)

      {name, sorted}
    end)
  end

  defp compute_expected_rows(model) do
    for {id, row} <- model.rows,
        MapSet.member?(model.active_linked_values, row.parent_id),
        into: %{} do
      key = build_key(@relation, id)

      value = %{
        "id" => to_string(id),
        "parent_id" => to_string(row.parent_id),
        "value" => row.value
      }

      {key, value}
    end
  end

  def build_key({schema, table}, id) do
    ~s["#{schema}"."#{table}"/"#{id}"]
  end

  defp insert_at_multiple(list, index, elements) do
    {head, tail} = Enum.split(list, index)
    head ++ elements ++ tail
  end
end
