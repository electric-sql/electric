defmodule Electric.Shapes.Consumer.MoveIns do
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Transaction
  alias Electric.Postgres.Xid
  alias Electric.Postgres.SnapshotQuery
  alias Electric.Shapes.Shape
  alias Electric.Shapes.WhereClause

  require Xid

  defstruct waiting_move_ins: %{},
            filtering_move_ins: [],
            move_in_buffering_snapshot: nil,
            in_flight_values: %{},
            moved_out_tags: %{},
            maximum_resolved_snapshot: nil,
            minimum_unresolved_snapshot: nil,
            move_out_generation: 0,
            move_in_counter: 0,
            # [P.splice] Buffered completed move-in results waiting for snapshot-ordered splice.
            # Each entry is {name, key_tag_pairs, pg_snapshot} where pg_snapshot is the query's
            # visibility snapshot. Results are spliced just before the first observed WAL txn
            # that is NOT visible in the query snapshot.
            buffered_move_ins: [],
            # Per-MI filter keys for [Ub.4a] shadow_only decisions.
            # Maps MI name => MapSet of keys that should be skipped during that MI's splice.
            # These keys are NOT in the log — the filter only prevents
            # the targeted MI from inserting a stale version. Other MIs are unaffected.
            mi_filter_keys: %{},
            shadows: %{},
            delegates: %{}

  @type pg_snapshot() :: SnapshotQuery.pg_snapshot()
  @type move_in_name() :: String.t()
  @type in_flight_values() :: %{term() => MapSet.t()}
  @type ref_entry() :: {Xid.anyxid(), [move_in_name()], [Changes.tag()]}
  @typedoc """
  Information needed to reason about move-in handling and correct stream processing.

  - `waiting_move_ins`: Information about move-ins we're waiting for. That means a move-in was triggered, but
                        query results are not yet available. The map value has pg snapshot and actual values that were
                        moved in and thus should be skipped in where clause evaluation until the results are appended to the log
  - `filtering_move_ins`: Information about move-ins we're filtering. That means a move-in has resolved and was
                          added to the shape log, and we need to skip changes that are already visible there.
  - `move_in_buffering_snapshot`: A snapshot that is a union of all the "waiting" move-in snapshots. This is used to
                                  reduce a check whether something is visible in any of the "waiting" move-in snapshots
                                  down to a single check instead of checking each snapshot individually.
  - `in_flight_values`: A precalculated map of all moved-in values that caused a move-in and thus should be skipped in
                        where clause evaluation until the results are appended to the log.
  - `moved_out_tags`: A map of move-in names to sets of tags that were moved out while the move-in was happening and thus
                      should be skipped when appending move-in results to the log.
  - `maximum_resolved_snapshot`: Stores the maximum snapshot of resolved move-ins that weren't immediately appended as
                                 snapshot-end control messages, to be appended when the last concurrent move-in resolves.
  - `minimum_unresolved_snapshot`: Stores the minimum snapshot of unresolved move-ins.
  - `move_out_generation`: A monotonically increasing counter incremented each time a move-out occurs.
                           Stored on waiting/filtering move-ins as trigger generation for tracing and lifecycle bookkeeping.
  """
  @type t() :: %__MODULE__{
          waiting_move_ins: %{
            move_in_name() =>
              {pg_snapshot() | nil, {term(), MapSet.t()}, trigger_generation :: non_neg_integer()}
          },
          filtering_move_ins:
            list(
              {pg_snapshot(), keys :: list(String.t()), {term(), MapSet.t()},
               trigger_generation :: non_neg_integer()}
            ),
          move_in_buffering_snapshot: nil | pg_snapshot(),
          in_flight_values: in_flight_values(),
          moved_out_tags: %{move_in_name() => MapSet.t(String.t())},
          maximum_resolved_snapshot: nil | pg_snapshot(),
          minimum_unresolved_snapshot: nil | pg_snapshot(),
          move_out_generation: non_neg_integer()
        }

  defguard has_unresolved_move_ins(state)
           when state.waiting_move_ins != %{} or state.filtering_move_ins != []

  defguard has_move_ins_in_flight(state)
           when state.waiting_move_ins != %{}

  def new() do
    %__MODULE__{}
  end

  @spec shadowed_key?(t(), String.t()) :: boolean()
  def shadowed_key?(%__MODULE__{shadows: shadows}, key), do: Map.has_key?(shadows, key)

  @spec authority_for_key(t(), String.t()) :: :shadowed | :delegated | :normal
  def authority_for_key(%__MODULE__{shadows: shadows}, key) when is_map_key(shadows, key),
    do: :shadowed

  def authority_for_key(%__MODULE__{delegates: delegates}, key) when is_map_key(delegates, key),
    do: :delegated

  def authority_for_key(_state, _key), do: :normal

  @spec relevant_waiting_move_ins(t(), Shape.t(), Changes.change()) :: list()
  def relevant_waiting_move_ins(%__MODULE__{waiting_move_ins: waiting_move_ins}, shape, change) do
    Enum.filter(waiting_move_ins, fn {_name, {_snapshot, {path, values}, _, _, _wal_lsn}} ->
      Shape.should_be_visible?(shape, change, %{path => values})
    end)
  end

  @spec owner_for_record(Shape.t(), map() | nil, list()) :: nil | tuple()
  def owner_for_record(_shape, nil, _relevant_move_ins), do: nil

  def owner_for_record(shape, record, relevant_move_ins) do
    Enum.find(relevant_move_ins, fn {_name, {_snapshot, {path, values}, _, _, _wal_lsn}} ->
      record_matches?(shape, record, %{path => values})
    end)
  end

  @spec move_in_covers_xid?(tuple() | nil, Xid.anyxid()) :: boolean()
  def move_in_covers_xid?(nil, _xid), do: false

  def move_in_covers_xid?({_name, {snapshot, _, _, _, _wal_lsn}}, xid) do
    is_nil(snapshot) or Transaction.visible_in_snapshot?(xid, snapshot)
  end

  @spec shadow_key(t(), Xid.anyxid(), String.t(), list(), [Changes.tag()] | nil) :: t()
  def shadow_key(state, xid, key, relevant_move_ins, tags \\ nil)
  def shadow_key(state, _xid, _key, [], _tags), do: state

  def shadow_key(%__MODULE__{shadows: shadows} = state, xid, key, relevant_move_ins, tags) do
    concurrent_move_in_names = Enum.map(relevant_move_ins, &elem(&1, 0))

    shadows =
      Map.update(shadows, key, {xid, concurrent_move_in_names, normalize_tags(tags)}, fn
        {existing_xid, existing_concurrent_move_in_names, existing_tags} ->
          {Xid.max(xid, existing_xid),
           Enum.uniq(existing_concurrent_move_in_names ++ concurrent_move_in_names),
           normalize_tags(tags, existing_tags)}

        {existing_xid, existing_concurrent_move_in_names} ->
          {Xid.max(xid, existing_xid),
           Enum.uniq(existing_concurrent_move_in_names ++ concurrent_move_in_names),
           normalize_tags(tags)}
      end)

    %{state | shadows: shadows}
  end

  @spec update_shadow_tags(t(), String.t(), [Changes.tag()]) :: t()
  def update_shadow_tags(%__MODULE__{shadows: shadows} = state, key, tags) do
    case Map.fetch(shadows, key) do
      {:ok, {xid, move_in_names, _existing_tags}} ->
        %{state | shadows: Map.put(shadows, key, {xid, move_in_names, normalize_tags(tags)})}

      {:ok, {xid, move_in_names}} ->
        %{state | shadows: Map.put(shadows, key, {xid, move_in_names, normalize_tags(tags)})}

      :error ->
        state
    end
  end

  @spec drop_shadow(t(), String.t()) :: t()
  def drop_shadow(%__MODULE__{shadows: shadows} = state, key) do
    %{state | shadows: Map.delete(shadows, key)}
  end

  @spec delegate_key(t(), Xid.anyxid(), String.t(), list(), [Changes.tag()] | nil) :: t()
  def delegate_key(%__MODULE__{delegates: delegates} = state, xid, key, relevant_move_ins, tags) do
    concurrent_move_in_names = Enum.map(relevant_move_ins, &elem(&1, 0))

    delegates =
      Map.update(delegates, key, {xid, concurrent_move_in_names, normalize_tags(tags)}, fn
        {existing_xid, existing_concurrent_move_in_names, existing_tags} ->
          {Xid.max(xid, existing_xid),
           Enum.uniq(existing_concurrent_move_in_names ++ concurrent_move_in_names),
           normalize_tags(tags, existing_tags)}

        {existing_xid, existing_concurrent_move_in_names} ->
          {Xid.max(xid, existing_xid),
           Enum.uniq(existing_concurrent_move_in_names ++ concurrent_move_in_names),
           normalize_tags(tags)}
      end)

    %{state | delegates: delegates}
  end

  @spec release_delegation(t(), String.t()) :: t()
  def release_delegation(%__MODULE__{delegates: delegates} = state, key) do
    %{state | delegates: Map.delete(delegates, key)}
  end

  @doc """
  Add information about a new move-in to the state for which we're waiting.
  Snapshot is initially nil and will be set later when the query begins.
  """
  @spec add_waiting(t(), move_in_name(), {term(), MapSet.t()}) :: t()
  def add_waiting(
        %__MODULE__{waiting_move_ins: waiting_move_ins} = state,
        name,
        moved_values
      ) do
    move_in_id = state.move_in_counter

    new_waiting_move_ins =
      Map.put(
        waiting_move_ins,
        name,
        {nil, moved_values, state.move_out_generation, move_in_id, nil}
      )

    new_buffering_snapshot = make_move_in_buffering_snapshot(new_waiting_move_ins)

    %{
      state
      | waiting_move_ins: new_waiting_move_ins,
        move_in_buffering_snapshot: new_buffering_snapshot,
        in_flight_values: make_in_flight_values(new_waiting_move_ins),
        moved_out_tags: Map.put(state.moved_out_tags, name, MapSet.new()),
        move_in_counter: move_in_id + 1
    }
  end

  # TODO: this assumes a single subquery for now
  def move_out_happened(state, new_tags, {removed_path, removed_values_set}) do
    moved_out_tags =
      Map.new(state.moved_out_tags, fn {name, tags} -> {name, MapSet.union(tags, new_tags)} end)

    # Remove moved-out values from both waiting and filtering move-ins so
    # they no longer claim authority over those values. Without this, a
    # move-in for a moved-out value would cause subsequent WAL operations
    # for that value to be incorrectly skipped (delegated to a query whose
    # results were already filtered out).
    waiting_move_ins =
      Map.new(state.waiting_move_ins, fn {name,
                                          {snapshot, {path, values}, trigger_gen, mi_id, wal_lsn}} =
                                           entry ->
        if path == removed_path do
          {name,
           {snapshot, {path, MapSet.difference(values, removed_values_set)}, trigger_gen, mi_id,
            wal_lsn}}
        else
          entry
        end
      end)

    filtering_move_ins =
      Enum.map(state.filtering_move_ins, fn {snapshot, key_set, {path, values}, tg, mi_id} = entry ->
        if path == removed_path do
          {snapshot, key_set, {path, MapSet.difference(values, removed_values_set)}, tg, mi_id}
        else
          entry
        end
      end)

    emptied_move_ins =
      empty_waiting_move_in_names(waiting_move_ins, removed_path)

    pruned_shadows =
      drop_refs_for_moved_out_tags(state.shadows, new_tags)

    shadows =
      drop_move_in_names(pruned_shadows, emptied_move_ins)

    pruned_delegates =
      drop_refs_for_moved_out_tags(state.delegates, new_tags)

    delegates =
      drop_move_in_names(pruned_delegates, emptied_move_ins)

    new_gen = state.move_out_generation + 1

    %{
      state
      | moved_out_tags: moved_out_tags,
        move_out_generation: new_gen,
        waiting_move_ins: waiting_move_ins,
        in_flight_values: make_in_flight_values(waiting_move_ins),
        filtering_move_ins: filtering_move_ins,
        shadows: shadows,
        delegates: delegates
    }
  end

  @doc """
  Set the snapshot for a waiting move-in when it becomes known.
  """
  @spec set_snapshot(t(), move_in_name(), pg_snapshot(), pos_integer() | nil) :: t()
  def set_snapshot(
        %__MODULE__{waiting_move_ins: waiting_move_ins} = state,
        name,
        snapshot,
        wal_lsn \\ nil
      ) do
    new_move_ins =
      Map.update!(waiting_move_ins, name, fn {_, moved_values, trigger_gen, mi_id, existing_lsn} ->
        {snapshot, moved_values, trigger_gen, mi_id, wal_lsn || existing_lsn}
      end)

    new_buffering_snapshot = make_move_in_buffering_snapshot(new_move_ins)

    %{
      state
      | waiting_move_ins: new_move_ins,
        move_in_buffering_snapshot: new_buffering_snapshot,
        minimum_unresolved_snapshot: min_snapshot(state.minimum_unresolved_snapshot, snapshot)
    }
  end

  @spec make_move_in_buffering_snapshot(%{move_in_name() => pg_snapshot()}) :: nil | pg_snapshot()
  # The fake global snapshot allows us to check if a transaction is not visible in any of the pending snapshots
  # instead of checking each snapshot individually.
  defp make_move_in_buffering_snapshot(waiting_move_ins) when waiting_move_ins == %{}, do: nil

  defp make_move_in_buffering_snapshot(waiting_move_ins) do
    snapshots =
      waiting_move_ins
      |> Map.values()
      |> Enum.map(fn
        {snapshot, _, _} -> snapshot
        {snapshot, _, _, _} -> snapshot
        {snapshot, _, _, _, _} -> snapshot
      end)
      |> Enum.reject(&is_nil/1)

    case snapshots do
      [] ->
        nil

      _ ->
        Enum.reduce(snapshots, {:infinity, -1, []}, fn {xmin, xmax, xip_list},
                                                       {global_xmin, global_xmax, global_xip_list} ->
          {Kernel.min(global_xmin, xmin), Kernel.max(global_xmax, xmax),
           global_xip_list ++ xip_list}
        end)
    end
  end

  defp make_in_flight_values(waiting_move_ins) do
    waiting_move_ins
    |> Map.values()
    |> Enum.map(fn
      {_, moved_values, _} -> moved_values
      {_, moved_values, _, _} -> moved_values
      {_, moved_values, _, _, _} -> moved_values
    end)
    |> Enum.reduce(%{}, fn {key, value}, acc ->
      Map.update(acc, key, value, &MapSet.union(&1, value))
    end)
  end

  @doc """
  Change a move-in from "waiting" to "filtering", marking it as complete and return best-effort visibility boundary.
  """
  @spec change_to_filtering(t(), move_in_name(), MapSet.t(String.t())) ::
          {visibility_boundary :: nil | pg_snapshot(), trigger_generation :: non_neg_integer(),
           move_in_id :: non_neg_integer(), t()}
  def change_to_filtering(%__MODULE__{} = state, name, key_set) do
    {{snapshot, moved_values, trigger_gen, move_in_id, _wal_lsn}, waiting_move_ins} =
      Map.pop!(state.waiting_move_ins, name)

    filtering_move_ins = [
      {snapshot, key_set, moved_values, trigger_gen, move_in_id} | state.filtering_move_ins
    ]

    buffering_snapshot = make_move_in_buffering_snapshot(waiting_move_ins)

    {boundary, maximum_resolved_snapshot} =
      cond do
        waiting_move_ins == %{} -> {max_snapshot(state.maximum_resolved_snapshot, snapshot), nil}
        is_minimum_snapshot?(state, snapshot) -> {snapshot, state.maximum_resolved_snapshot}
        true -> {nil, max_snapshot(state.maximum_resolved_snapshot, snapshot)}
      end

    new_state = %{
      state
      | waiting_move_ins: waiting_move_ins,
        filtering_move_ins: filtering_move_ins,
        move_in_buffering_snapshot: buffering_snapshot,
        in_flight_values: make_in_flight_values(waiting_move_ins),
        moved_out_tags: Map.delete(state.moved_out_tags, name),
        minimum_unresolved_snapshot: find_minimum_unresolved_snapshot(waiting_move_ins),
        maximum_resolved_snapshot: maximum_resolved_snapshot,
        shadows:
          Enum.reduce(state.shadows, %{}, fn
            {_, {_, [^name], _tags}}, acc ->
              acc

            {key, {xid, move_in_names, tags}}, acc ->
              case Enum.reject(move_in_names, &(&1 == name)) do
                [] -> acc
                remaining_names -> Map.put(acc, key, {xid, remaining_names, tags})
              end

            {_, {_, [^name]}}, acc ->
              acc

            {key, {xid, move_in_names}}, acc ->
              case Enum.reject(move_in_names, &(&1 == name)) do
                [] -> acc
                remaining_names -> Map.put(acc, key, {xid, remaining_names, []})
              end
          end)
        # Delegates are NOT cleaned up here. Delegation means "key was never
        # emitted to the log via WAL" — that fact doesn't change when one MI
        # resolves. Delegates are released when WAL emits the key or when
        # transient move-in state is garbage-collected.
    }

    {boundary, trigger_gen, move_in_id, new_state}
  end

  @doc """
  Update the key_set of the most recently added filtering move-in.
  Called after computing actually-inserted keys (post should_skip_query_row?
  filtering) so that the key_set only contains keys that were truly inserted
  into the log, not keys that were skipped.
  """
  @spec update_latest_filtering_key_set(t(), MapSet.t(String.t())) :: t()
  def update_latest_filtering_key_set(
        %__MODULE__{filtering_move_ins: [latest | rest]} = state,
        key_set
      ) do
    {snapshot, _old_key_set, moved_values, tg, mi_id} = latest
    %{state | filtering_move_ins: [{snapshot, key_set, moved_values, tg, mi_id} | rest]}
  end

  defp find_minimum_unresolved_snapshot(waiting_move_ins) do
    snapshots =
      waiting_move_ins
      |> Map.values()
      |> Enum.map(fn
        {snapshot, _, _} -> snapshot
        {snapshot, _, _, _} -> snapshot
        {snapshot, _, _, _, _} -> snapshot
      end)
      |> Enum.reject(&is_nil/1)

    case snapshots do
      [] -> nil
      list -> Enum.min(list, &(Xid.compare_snapshots(&1, &2) != :gt))
    end
  end

  defp empty_waiting_move_in_names(waiting_move_ins, removed_path) do
    waiting_move_ins
    |> Enum.reduce(MapSet.new(), fn {name, {_snapshot, {path, values}, _, _, _wal_lsn}}, acc ->
      if path == removed_path and MapSet.size(values) == 0 do
        MapSet.put(acc, name)
      else
        acc
      end
    end)
  end

  defp drop_move_in_names(refs, _names_to_drop) when refs == %{}, do: refs

  defp drop_move_in_names(refs, names_to_drop)
       when is_map(names_to_drop) and map_size(names_to_drop) == 0,
       do: refs

  defp drop_move_in_names(refs, names_to_drop) do
    Enum.reduce(refs, %{}, fn
      {key, {xid, names, tags}}, kept ->
        remaining_names = Enum.reject(names, &MapSet.member?(names_to_drop, &1))

        if remaining_names == [] do
          kept
        else
          Map.put(kept, key, {xid, remaining_names, tags})
        end

      {key, {xid, names}}, kept ->
        remaining_names = Enum.reject(names, &MapSet.member?(names_to_drop, &1))

        if remaining_names == [] do
          kept
        else
          Map.put(kept, key, {xid, remaining_names, []})
        end
    end)
  end

  defp drop_refs_for_moved_out_tags(refs, moved_out_tags)
       when refs == %{} or map_size(moved_out_tags) == 0 do
    refs
  end

  defp drop_refs_for_moved_out_tags(refs, moved_out_tags) do
    Enum.reduce(refs, %{}, fn
      {key, {xid, names, tags}}, acc ->
        remaining_tags = Enum.reject(tags, &MapSet.member?(moved_out_tags, &1))

        cond do
          tags == [] ->
            Map.put(acc, key, {xid, names, tags})

          remaining_tags == [] ->
            acc

          true ->
            Map.put(acc, key, {xid, names, remaining_tags})
        end

      {key, {xid, names}}, acc ->
        Map.put(acc, key, {xid, names, []})
    end)
  end

  @doc """
  Remove completed move-ins from the state.

  Move-in is considered "completed" (i.e. not included in the filtering logic)
  once we see any transaction that is after the end of the move-in snapshot.

  Filtering generally is applied only to transactions that are already visible
  in the snapshot, and those can only be with `xid < xmax`.
  """
  @spec remove_completed(t(), Transaction.t()) :: t()
  def remove_completed(%__MODULE__{} = state, %Transaction{xid: xid}) do
    state.filtering_move_ins
    |> Enum.reject(fn {snapshot, _, _, _, _} -> Xid.after_snapshot?(xid, snapshot) end)
    |> then(&%{state | filtering_move_ins: &1})
  end

  @doc """
  Check if a change is already visible in one of the completed move-ins.

  A visible change means it needs to be skipped to avoid duplicates.
  Only checks key membership in key_set (not value matching). Ghost keys
  (from filtered move-in results) are already excluded from key_set by
  `update_latest_filtering_key_set`, so no additional value check is needed.
  """
  @spec change_already_visible?(t(), Xid.anyxid(), Changes.change()) :: boolean()
  def change_already_visible?(_state, _xid, %Changes.DeletedRecord{}),
    do: false

  def change_already_visible?(%__MODULE__{filtering_move_ins: []}, _, _),
    do: false

  def change_already_visible?(
        %__MODULE__{filtering_move_ins: filters},
        xid,
        %{key: key}
      ) do
    Enum.any?(filters, fn {snapshot, key_set, {_path, values}, _tg, _mi_id} ->
      Transaction.visible_in_snapshot?(xid, snapshot) and
        MapSet.member?(key_set, key) and
        MapSet.size(values) > 0
    end)
  end

  @doc """
  Check if a change is covered by a filtering move-in whose linked values include
  the change's referenced values. Used for DELETE delegation: if a DELETE is covered
  by a filtering move-in (meaning the corresponding INSERT was delegated to the query),
  the DELETE should also be skipped.
  """
  @spec change_covered_by_filtering_move_in?(t(), map(), Xid.anyxid()) :: boolean()
  def change_covered_by_filtering_move_in?(%__MODULE__{filtering_move_ins: []}, _, _), do: false

  def change_covered_by_filtering_move_in?(
        %__MODULE__{filtering_move_ins: filters},
        referenced_values,
        xid
      ) do
    Enum.any?(filters, fn {snapshot, _key_set, {path, values}, _tg, _mi_id} ->
      case Map.fetch(referenced_values, path) do
        {:ok, value} ->
          Transaction.visible_in_snapshot?(xid, snapshot) and MapSet.member?(values, value)

        :error ->
          false
      end
    end)
  end

  @doc """
  Compute values from filtering move-ins that should be subtracted from extra_refs
  for a given transaction xid. Only filtering move-ins whose snapshot covers (is visible
  to) the xid contribute their moved values.

  This prevents spurious deletes when the async move-in query completes before the
  consumer processes WAL events that were visible in the query's snapshot.
  """
  @spec filtering_values_for_xid(t(), Xid.anyxid()) :: in_flight_values()
  def filtering_values_for_xid(%__MODULE__{filtering_move_ins: []}, _xid), do: %{}

  def filtering_values_for_xid(%__MODULE__{filtering_move_ins: filters}, xid) do
    Enum.reduce(filters, %{}, fn {snapshot, _key_set, {path, values}, _tg, _mi_id}, acc ->
      if Transaction.visible_in_snapshot?(xid, snapshot) do
        Map.update(acc, path, values, &MapSet.union(&1, values))
      else
        acc
      end
    end)
  end

  @doc """
  Garbage collect transient move-in state when no move-ins are active.

  When both waiting and filtering move-ins are empty, any future move-in
  will be triggered by a NEW linked value entering the shape, so shadows
  and delegates are no longer needed.
  """
  @spec gc_transient_move_in_state(t()) :: t()
  def gc_transient_move_in_state(
        %__MODULE__{waiting_move_ins: wmi, filtering_move_ins: []} = state
      )
      when wmi == %{} do
    %{
      state
      | move_out_generation: 0,
        shadows: %{},
        delegates: %{}
    }
  end

  def gc_transient_move_in_state(state) do
    state
  end

  @spec key_already_shadowed_for_move_in?(t(), String.t(), move_in_name()) :: boolean()
  def key_already_shadowed_for_move_in?(%__MODULE__{shadows: shadows}, key, move_in_name) do
    case Map.fetch(shadows, key) do
      :error -> false
      {:ok, names} when is_list(names) -> move_in_name in names
      {:ok, {_xid, names}} when is_list(names) -> move_in_name in names
      {:ok, {_xid, names, _tags}} when is_list(names) -> move_in_name in names
    end
  end

  defp normalize_tags(nil, existing_tags), do: existing_tags || []
  defp normalize_tags(tags, _existing_tags), do: tags || []
  defp normalize_tags(nil), do: []
  defp normalize_tags(tags), do: tags || []

  defp record_matches?(%Shape{where: nil}, _record, _refs), do: true

  defp record_matches?(%Shape{where: where}, record, refs) do
    WhereClause.includes_record?(where, record, refs)
  rescue
    KeyError -> false
  end

  @spec max_snapshot(pg_snapshot() | nil, pg_snapshot() | nil) :: pg_snapshot()
  defp max_snapshot(nil, value), do: value
  defp max_snapshot(value, nil), do: value

  defp max_snapshot(snapshot1, snapshot2) do
    case Xid.compare_snapshots(snapshot1, snapshot2) do
      :lt -> snapshot2
      _ -> snapshot1
    end
  end

  @spec min_snapshot(pg_snapshot(), pg_snapshot()) :: pg_snapshot()
  defp min_snapshot(nil, value), do: value
  defp min_snapshot(value, nil), do: value

  defp min_snapshot(snapshot1, snapshot2) do
    case Xid.compare_snapshots(snapshot1, snapshot2) do
      :lt -> snapshot1
      _ -> snapshot2
    end
  end

  @doc """
  Check if the given snapshot is the minimum among all concurrent waiting move-ins
  (excluding the current one being resolved, and only considering those with known snapshots).
  """
  @spec is_minimum_snapshot?(t(), pg_snapshot()) :: boolean()
  def is_minimum_snapshot?(
        %__MODULE__{minimum_unresolved_snapshot: minimum_unresolved_snapshot},
        snapshot
      ) do
    Xid.compare_snapshots(snapshot, minimum_unresolved_snapshot) == :eq
  end

  @doc """
  Store or update the maximum resolved snapshot.
  If there's already a stored snapshot, keep the maximum of the two.
  """
  @spec store_maximum_resolved_snapshot(t(), pg_snapshot()) :: t()
  def store_maximum_resolved_snapshot(
        %__MODULE__{maximum_resolved_snapshot: nil} = state,
        snapshot
      ) do
    %{state | maximum_resolved_snapshot: snapshot}
  end

  def store_maximum_resolved_snapshot(
        %__MODULE__{maximum_resolved_snapshot: stored} = state,
        snapshot
      ) do
    %{state | maximum_resolved_snapshot: max_snapshot(stored, snapshot)}
  end

  @doc """
  Get the stored maximum resolved snapshot and clear it, or return nil if none is stored.
  Returns {snapshot | nil, updated_state}.
  """
  @spec get_and_clear_maximum_resolved_snapshot(t()) :: {pg_snapshot() | nil, t()}
  def get_and_clear_maximum_resolved_snapshot(%__MODULE__{} = state) do
    {state.maximum_resolved_snapshot, %{state | maximum_resolved_snapshot: nil}}
  end

  # --- [P.splice] Buffered move-in support ---

  @doc """
  Buffer a completed move-in for snapshot-ordered splice.
  The move-in stays in `waiting_move_ins` — it will be moved to `filtering_move_ins`
  at splice time, ensuring moved_out_tags are fresh.
  """
  @spec buffer_completed_move_in(t(), move_in_name(), list({String.t(), list()}), pg_snapshot()) ::
          t()
  def buffer_completed_move_in(%__MODULE__{} = state, name, key_tag_pairs, snapshot) do
    key_set = MapSet.new(key_tag_pairs, fn {key, _tags} -> key end)

    %{
      state
      | buffered_move_ins: state.buffered_move_ins ++ [{name, key_tag_pairs, snapshot, key_set}]
    }
  end

  @doc """
  Pop all buffered move-ins that should be spliced before a WAL txn with the given xid.
  A buffered move-in should be spliced when the txn's xid is NOT visible in the
  move-in's query snapshot (the snapshot no longer covers this txn).
  Returns {entries_to_splice, updated_state}.
  """
  @spec pop_ready_to_splice_before_txn(t(), Xid.anyxid()) :: {list(), t()}
  def pop_ready_to_splice_before_txn(%__MODULE__{buffered_move_ins: []} = state, _xid) do
    {[], state}
  end

  def pop_ready_to_splice_before_txn(%__MODULE__{buffered_move_ins: buffered} = state, xid) do
    {ready, remaining} =
      Enum.split_with(buffered, fn {name, _key_tag_pairs, _snapshot, _key_set} ->
        # Splice when the query snapshot is known AND the txn is NOT visible in it.
        # If the snapshot in waiting_move_ins is nil, we can't determine visibility.
        case Map.fetch(state.waiting_move_ins, name) do
          {:ok, {snapshot, _, _, _, _}} when not is_nil(snapshot) ->
            not Transaction.visible_in_snapshot?(xid, snapshot)

          _ ->
            false
        end
      end)

    {ready, %{state | buffered_move_ins: remaining}}
  end

  @doc """
  Pop all buffered move-ins whose query WAL LSN is <= the given global LSN.
  This is the secondary trigger for [P.splice]: when global acknowledgement
  proves no more visible transactions can arrive.
  """
  @spec pop_ready_to_splice_by_lsn(t(), pos_integer()) :: {list(), t()}
  def pop_ready_to_splice_by_lsn(%__MODULE__{buffered_move_ins: []} = state, _lsn) do
    {[], state}
  end

  def pop_ready_to_splice_by_lsn(%__MODULE__{buffered_move_ins: buffered} = state, lsn) do
    {ready, remaining} =
      Enum.split_with(buffered, fn {name, _key_tag_pairs, _snapshot, _key_set} ->
        case Map.fetch(state.waiting_move_ins, name) do
          {:ok, {snapshot, _, _, _, wal_lsn}} when not is_nil(snapshot) ->
            # If wal_lsn is known, check against it. If nil (legacy/test),
            # any global_last_seen_lsn triggers the splice since we can't
            # determine the exact WAL position.
            is_nil(wal_lsn) or Electric.Postgres.Lsn.to_integer(wal_lsn) <= lsn

          _ ->
            false
        end
      end)

    {ready, %{state | buffered_move_ins: remaining}}
  end
end
