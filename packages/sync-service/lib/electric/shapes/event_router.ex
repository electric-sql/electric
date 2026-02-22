defmodule Electric.Shapes.EventRouter do
  @moduledoc """
  Routes replication events to shapes, returning per-shape transaction fragments.

  The EventRouter wraps a Filter and adds transaction-aware routing:
  - For Relation events, returns the relation for all affected shapes
  - For TransactionFragment events, returns per-shape TransactionFragments
    with only the changes that affect each shape.

  Transaction state is tracked to ensure:
  - Each shape receives Begin only once per transaction (on first relevant operation)
  - Each shape receives Commit only if it received operations in the transaction
  - Shapes added mid-transaction are skipped for that transaction
  - Shapes removed mid-transaction stop receiving events immediately
  """

  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.TransactionFragment
  alias Electric.Shapes.EventRouter
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Shape

  defstruct filter: nil,
            current_xid: nil,
            shapes_seen_begin: MapSet.new(),
            shapes_in_txn: MapSet.new(),
            # Shapes added after the current transaction started (should be skipped)
            shapes_added_mid_txn: MapSet.new(),
            in_txn: false

  @type t :: %EventRouter{}
  @type shape_id :: any()

  @spec new(keyword()) :: t()
  def new(opts \\ []) do
    %EventRouter{filter: Filter.new(opts)}
  end

  @spec add_shape(t(), shape_id(), Shape.t()) :: t()
  def add_shape(%EventRouter{} = router, shape_id, shape) do
    router = %EventRouter{router | filter: Filter.add_shape(router.filter, shape_id, shape)}

    if router.in_txn do
      %{router | shapes_added_mid_txn: MapSet.put(router.shapes_added_mid_txn, shape_id)}
    else
      router
    end
  end

  @spec remove_shape(t(), shape_id()) :: t()
  def remove_shape(%EventRouter{} = router, shape_id) do
    %EventRouter{
      router
      | filter: Filter.remove_shape(router.filter, shape_id),
        shapes_seen_begin: MapSet.delete(router.shapes_seen_begin, shape_id),
        shapes_in_txn: MapSet.delete(router.shapes_in_txn, shape_id),
        shapes_added_mid_txn: MapSet.delete(router.shapes_added_mid_txn, shape_id)
    }
  end

  @spec has_shape?(t(), shape_id()) :: boolean()
  def has_shape?(%EventRouter{} = router, shape_id) do
    Filter.has_shape?(router.filter, shape_id)
  end

  @spec active_shapes(t()) :: MapSet.t(shape_id())
  def active_shapes(%EventRouter{} = router) do
    Filter.active_shapes(router.filter)
  end

  @spec event_by_shape_handle(t(), Relation.t() | TransactionFragment.t()) ::
          {%{shape_id() => Relation.t() | TransactionFragment.t()}, t()}
  def event_by_shape_handle(%EventRouter{} = router, %Relation{} = relation) do
    result = route_relation_to_shapes(router, relation)
    {result, router}
  end

  def event_by_shape_handle(
        %EventRouter{} = router,
        %TransactionFragment{changes: changes, commit: commit} = txn_fragment
      ) do
    router = maybe_start_transaction(router, txn_fragment)
    {shape_changes, router} = route_changes_to_shapes(router, changes)
    {shape_changes, router} = maybe_end_transaction(shape_changes, router, commit)
    result = build_shape_fragments(shape_changes, txn_fragment)
    {result, router}
  end

  # Relation routing

  defp route_relation_to_shapes(router, relation) do
    router.filter
    |> Filter.affected_shapes(relation)
    |> Map.new(fn shape_id -> {shape_id, relation} end)
  end

  # Change routing

  defp route_changes_to_shapes(router, changes) do
    Enum.reduce(changes, {%{}, router}, fn change, {shape_events, router} ->
      route_change(change, shape_events, router)
    end)
  end

  defp route_change(change, shape_events, router) do
    affected_shapes = find_affected_shapes_for_change(router, change)
    send_change_to_shapes(shape_events, router, change, affected_shapes)
  end

  # Transaction state management

  defp maybe_start_transaction(router, %TransactionFragment{has_begin?: false}), do: router

  defp maybe_start_transaction(%EventRouter{} = router, %TransactionFragment{
         xid: xid,
         has_begin?: true
       }) do
    %{
      router
      | current_xid: xid,
        shapes_seen_begin: MapSet.new(),
        shapes_in_txn: MapSet.new(),
        shapes_added_mid_txn: MapSet.new(),
        in_txn: true
    }
  end

  defp maybe_end_transaction(shape_changes, router, nil), do: {shape_changes, router}

  defp maybe_end_transaction(shape_changes, %EventRouter{} = router, commit) do
    shape_changes =
      send_commit_to_participating_shapes(shape_changes, commit, router.shapes_in_txn)

    router = %{
      router
      | current_xid: nil,
        shapes_seen_begin: MapSet.new(),
        shapes_in_txn: MapSet.new(),
        shapes_added_mid_txn: MapSet.new(),
        in_txn: false
    }

    {shape_changes, router}
  end

  # Shape eligibility

  defp find_affected_shapes_for_change(router, change) do
    affected = Filter.affected_shapes(router.filter, change)
    exclude_shapes_added_mid_txn(affected, router.shapes_added_mid_txn)
  end

  defp exclude_shapes_added_mid_txn(affected, shapes_added_mid_txn) do
    MapSet.difference(affected, shapes_added_mid_txn)
  end

  # Sending changes to shapes

  defp send_commit_to_participating_shapes(shape_events, commit, shapes_in_txn) do
    Enum.reduce(shapes_in_txn, shape_events, fn shape_id, shape_events ->
      update_shape_events(shape_events, shape_id, &%{&1 | commit: commit})
    end)
  end

  defp send_change_to_shapes(shape_events, router, change, affected_shapes) do
    Enum.reduce(affected_shapes, {shape_events, router}, fn shape_id, {shape_events, router} ->
      {shape_events, router} = maybe_send_begin(shape_events, router, shape_id)
      shape_events = prepend_change(shape_events, shape_id, change)
      router = mark_shape_in_txn(router, shape_id)
      {shape_events, router}
    end)
  end

  defp maybe_send_begin(shape_events, router, shape_id) do
    if needs_begin?(router, shape_id) do
      shape_events =
        update_shape_events(shape_events, shape_id, &%{&1 | has_begin?: true})

      router = mark_shape_seen_begin(router, shape_id)

      {shape_events, router}
    else
      {shape_events, router}
    end
  end

  defp needs_begin?(%EventRouter{} = router, shape_id) do
    router.current_xid != nil and
      not MapSet.member?(router.shapes_seen_begin, shape_id)
  end

  defp mark_shape_seen_begin(%EventRouter{} = router, shape_id) do
    %{router | shapes_seen_begin: MapSet.put(router.shapes_seen_begin, shape_id)}
  end

  defp mark_shape_in_txn(%EventRouter{} = router, shape_id) do
    %{router | shapes_in_txn: MapSet.put(router.shapes_in_txn, shape_id)}
  end

  # Result building

  defp prepend_change(shape_events, shape_id, change) do
    relation = change.relation

    update_shape_events(
      shape_events,
      shape_id,
      fn attrs ->
        %{
          attrs
          | changes: [change | attrs.changes],
            affected_relations: MapSet.put(attrs.affected_relations, relation),
            change_count: attrs.change_count + 1
        }
      end
    )
  end

  defp update_shape_events(shape_events, shape_id, update_fn) do
    attrs =
      update_fn.(%{
        changes: [],
        affected_relations: MapSet.new(),
        change_count: 0,
        commit: nil,
        has_begin?: false
      })

    Map.update(shape_events, shape_id, attrs, update_fn)
  end

  defp build_shape_fragments(shape_events, %TransactionFragment{
         xid: xid,
         lsn: lsn,
         last_log_offset: last_log_offset
       }) do
    Map.new(shape_events, fn {shape_id, attrs} ->
      fragment = %TransactionFragment{
        xid: xid,
        lsn: lsn,
        last_log_offset: last_log_offset,
        has_begin?: attrs.has_begin?,
        commit: attrs.commit,
        changes: Enum.reverse(attrs.changes),
        affected_relations: attrs.affected_relations,
        change_count: attrs.change_count
      }

      {shape_id, fragment}
    end)
  end
end
