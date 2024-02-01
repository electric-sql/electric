defmodule Electric.Satellite.Permissions.WriteBuffer do
  alias Electric.Replication.Changes
  alias Electric.Satellite.Permissions

  require Record

  defmodule Error do
    defexception [:message]
  end

  @behaviour Electric.Satellite.Permissions.Graph

  Record.defrecordp(:state,
    graph: nil,
    upstream: nil,
    deletes: MapSet.new(),
    moves: [],
    tags: MapSet.new()
  )

  @spec new(upstream :: Permissions.Graph.impl()) :: Permissions.Graph.impl()
  def new(upstream) do
    {__MODULE__, state(upstream: upstream)}
  end

  def pending_changes({__MODULE__, state(graph: graph)}) do
    graph
  end

  def pending_changes(state(graph: graph)) do
    graph
  end

  def seen_tags({__MODULE__, state}) do
    seen_tags(state)
  end

  def seen_tags(state(tags: tags)) do
    tags
  end

  def empty?({__MODULE__, state}) do
    empty?(state)
  end

  def empty?(state(graph: nil)) do
    true
  end

  def empty?(_state) do
    false
  end

  @moduledoc """
  Allow for GCing the locally kept state by monitoring the txns coming out of PG
  and dropping any accrued updates once all the client writes have been received
  by the shapes.

  Must be run *after* the shapes have been updated by the tx, so that there's an overlap
  between the local state here and the data in the shape graph.

  Also worth running against the original tx from PG, not the version filtered for the client
  because we're only looking for tags and there's a tiny chance that the client can't read its
  writes...

  So, something like:

       perms
       |> Permissions.filter_read(txn)
       |> Shape.update()

       # the shape graph now contains all the updates previously held by the tree instance so
       # we're free to GC
       Tree.receive_transaction(tree, txn)
  """
  def receive_transaction({__MODULE__, state}, %Changes.Transaction{} = txn) do
    {__MODULE__, receive_transaction(state, txn)}
  end

  def receive_transaction(state(graph: nil) = state, %Changes.Transaction{} = _txn) do
    state
  end

  def receive_transaction(state, %Changes.Transaction{} = txn) do
    Enum.reduce(txn.changes, state, fn change, state(tags: tags) = state ->
      tags = Enum.reduce(change.tags, tags, &MapSet.delete(&2, &1))
      state(state, tags: tags)
    end)
    |> detect_empty()
  end

  defp detect_empty(state(tags: tags, upstream: upstream) = state) do
    if MapSet.size(tags) == 0 do
      state(upstream: upstream)
    else
      state
    end
  end

  @impl Permissions.Graph
  def scope_id(state(graph: nil, upstream: upstream), root, relation, record) do
    Permissions.Graph.scope_id(upstream, root, relation, record)
  end

  def scope_id(state(upstream: upstream) = state, root, relation, record) when is_map(record) do
    scope_id(state, root, relation, Permissions.Graph.primary_key(upstream, relation, record))
  end

  def scope_id(_state, root, root, id) when is_list(id) do
    {id, [{root, id}]}
  end

  def scope_id(state, root, relation, id) when is_list(id) do
    methods = [
      &locally_deleted/4,
      &scope_id_with_moves/4,
      &local_scope_id/4,
      &upstream_scope_id/4
    ]

    methods
    |> Stream.map(& &1.(state, root, relation, id))
    |> Enum.find(& &1)
    |> case do
      :deleted -> nil
      result -> result
    end
  end

  defp locally_deleted(state(deletes: deletes), _root, relation, id) do
    if MapSet.member?(deletes, {relation, id}), do: :deleted
  end

  defp scope_id_with_moves(state(moves: []), _root, _relation, _id) do
    nil
  end

  # try resolving the given {relation, id} as a child of the records found in the moves list if
  # the record is a child of any of these moves, then recursively continue the search upwards
  # starting from this move.
  defp scope_id_with_moves(state, root, relation, id) do
    state(moves: moves, upstream: upstream) = state

    if relation_path = Permissions.Graph.relation_path(upstream, root, relation) do
      ordering = relation_path |> Stream.with_index() |> Map.new()

      valid_moves =
        moves
        |> Stream.filter(fn {relation, _} -> Map.has_key?(ordering, relation) end)
        |> Enum.sort_by(fn {relation, _} -> Map.fetch!(ordering, relation) end)

      Enum.find_value(valid_moves, fn {move_relation, move_id} = move ->
        # filter out the move we're using from the state as we recurse othewise we end up in an
        # infinite loop
        state = state(state, moves: Stream.reject(valid_moves, &(&1 == move)))

        with {scope_id, _path} <- scope_id(state, move_relation, relation, id) do
          if scope_id == move_id do
            scope_id(state, root, move_relation, move_id)
          end
        end
      end)
    end
  end

  defp local_scope_id(state, root, relation, id) do
    state(graph: graph, upstream: upstream, deletes: deletes) = state

    relation_path = Permissions.Graph.relation_path(upstream, root, relation)

    # this may give a partial path, terminating before the root
    with {{scope_relation, scope_id}, path} <-
           Permissions.Graph.traverse_fks(graph, relation_path, relation, id) do
      cond do
        Enum.any?(path, &MapSet.member?(deletes, &1)) ->
          :deleted

        scope_relation == root ->
          {scope_id, path}

        # our local tree doesn't have the full path to `root`, so starting from where the
        # local tree left off, lookup rest of path in upstream
        true ->
          Permissions.Graph.scope_id(upstream, root, scope_relation, scope_id)
      end
    end
  end

  defp upstream_scope_id(state(upstream: upstream), root, relation, id) do
    Permissions.Graph.scope_id(upstream, root, relation, id)
  end

  @impl Permissions.Graph
  def parent_scope_id(state(graph: nil, upstream: upstream), root, relation, record) do
    Permissions.Graph.parent_scope_id(upstream, root, relation, record)
  end

  def parent_scope_id(state, root, relation, record) do
    with {parent_relation, parent_id} <- parent(state, root, relation, record) do
      scope_id(state, root, parent_relation, parent_id)
    end
  end

  @impl Permissions.Graph
  def parent(state(upstream: upstream), root, relation, record) do
    Permissions.Graph.parent(upstream, root, relation, record)
  end

  @impl Permissions.Graph
  def apply_change(state, roots, %Changes.NewRecord{} = change) do
    state(graph: graph, upstream: upstream, deletes: deletes) = state
    %{relation: relation, record: record} = change

    # if this lives in any of the scope roots we care about (in `roots`) then we need to add it
    # if not, who cares
    # in a scope root if the relation == root or the record has a `parent/4` for one of the roots
    v1 = {relation, Permissions.Graph.primary_key(upstream, relation, record)}

    graph =
      Enum.reduce(roots, graph, fn root, src_graph ->
        case Permissions.Graph.parent(upstream, root, relation, record) do
          {parent_relation, parent_id} = v2 ->
            if exists?(graph, upstream, deletes, root, v2) do
              src_graph
              |> ensure_graph()
              |> Graph.add_edge(v1, v2)
            else
              raise Error,
                message:
                  "foreign key reference to non-existant record #{inspect(relation)} => #{inspect(parent_relation)} id: #{inspect(parent_id)}"
            end

          nil ->
            src_graph
        end
      end)

    state
    |> state(graph: graph)
    |> apply_tags(change)
  end

  def apply_change(state, _roots, %Changes.DeletedRecord{relation: relation} = change) do
    state(upstream: upstream, deletes: deletes) = state

    state(state,
      deletes:
        MapSet.put(
          deletes,
          {relation, Permissions.Graph.primary_key(upstream, relation, change.old_record)}
        )
    )
    |> apply_tags(change)
  end

  def apply_change(state, roots, %Changes.UpdatedRecord{} = change) do
    state(upstream: upstream, deletes: deletes) = state
    %{relation: relation, old_record: old, record: new} = change

    Enum.reduce(roots, state, fn root, state(graph: src_graph, moves: moves) = state ->
      if Permissions.Graph.modifies_fk?(upstream, root, change) do
        child = {relation, Permissions.Graph.primary_key(upstream, relation, new)}
        old_parent = Permissions.Graph.parent(upstream, root, relation, old)
        new_parent = Permissions.Graph.parent(upstream, root, relation, new)

        if exists?(src_graph, upstream, deletes, root, new_parent) do
          graph =
            src_graph
            |> ensure_graph()
            |> Graph.delete_edge(child, old_parent)
            |> Graph.add_edge(child, new_parent)

          state(state, graph: graph, moves: [child | moves])
        else
          raise Error,
            message:
              "foreign key reference to non-existant record #{inspect(relation)} => #{inspect(new_parent)}"
        end
      else
        state
      end
    end)
    |> apply_tags(change)
  end

  defp apply_tags(state(tags: tags) = state, %{tags: change_tags}) do
    state(state, tags: Enum.into(change_tags, tags))
  end

  defp exists?(graph, upstream, deletes, root, vertex) do
    exists_locally?(graph, deletes, vertex) || exists_upstream?(upstream, root, vertex)
  end

  defp exists_locally?(nil, _deletes, _vertex) do
    false
  end

  defp exists_locally?(graph, deletes, vertex) do
    !MapSet.member?(deletes, vertex) && Graph.has_vertex?(graph, vertex)
  end

  defp exists_upstream?(upstream, root, {relation, id}) do
    exists_upstream?(upstream, root, relation, id)
  end

  defp exists_upstream?(upstream, root, relation, id) do
    with {_id, _} <- Permissions.Graph.scope_id(upstream, root, relation, id) do
      true
    else
      _ -> false
    end
  end

  @impl Permissions.Graph
  def primary_key(state(upstream: upstream), relation, record) do
    Permissions.Graph.primary_key(upstream, relation, record)
  end

  @impl Permissions.Graph
  def modifies_fk?(state(upstream: upstream), root, update) do
    Permissions.Graph.modifies_fk?(upstream, root, update)
  end

  @impl Permissions.Graph
  def relation_path(state(upstream: upstream), root, relation) do
    Permissions.Graph.relation_path(upstream, root, relation)
  end

  defp ensure_graph(nil) do
    Permissions.Graph.graph()
  end

  defp ensure_graph(graph) do
    graph
  end
end
