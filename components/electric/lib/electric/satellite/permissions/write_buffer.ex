defmodule Electric.Satellite.Permissions.WriteBuffer do
  alias Electric.Replication.Changes
  alias Electric.Satellite.Permissions
  alias Electric.Satellite.Auth

  require Record
  require Logger

  defmodule Error do
    defexception [:message]
  end

  # slightly arbitrary high-water mark prompting warning messages
  @high_ops 50

  @behaviour Electric.Satellite.Permissions.Graph

  Record.defrecordp(:state,
    empty: true,
    graph: nil,
    upstream: nil,
    deletes: MapSet.new(),
    moves: [],
    # set of join table relations that have been removed locally
    dead_edges: MapSet.new(),
    tags: MapSet.new(),
    ops: 0,
    user_id: nil
  )

  @spec new(upstream :: Permissions.Graph.impl(), Auth.t()) :: Permissions.Graph.impl()
  def new(upstream, %Auth{} = auth) do
    {__MODULE__, state(upstream: upstream, user_id: auth.user_id)}
  end

  # Some util functions useful for testing

  @doc false
  def pending_changes({__MODULE__, state(graph: graph)}) do
    graph
  end

  def pending_changes(state(graph: graph)) do
    graph
  end

  @doc false
  def seen_tags({__MODULE__, state}) do
    seen_tags(state)
  end

  def seen_tags(state(tags: tags)) do
    tags
  end

  @doc false
  def empty?({__MODULE__, state(empty: empty)}) do
    empty
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
       |> Shape.update(shapes)

       # the shape graph now contains all the updates in the txn so we're free to GC the write
       # buffer in the permissions without a danger of inconsistencies
       perms = Permissions.receive_transaction(perms, txn)
  """
  def receive_transaction({__MODULE__, state}, %Changes.Transaction{} = txn) do
    {__MODULE__, receive_transaction(state, txn)}
  end

  def receive_transaction(state(empty: true) = state, %Changes.Transaction{} = _txn) do
    state
  end

  def receive_transaction(state, %Changes.Transaction{} = txn) do
    Enum.reduce(txn.changes, state, fn change, state(tags: tags) = state ->
      tags = Enum.reduce(change.tags, tags, &MapSet.delete(&2, &1))
      state(state, tags: tags)
    end)
    |> detect_empty()
  end

  defp detect_empty(state(tags: tags, upstream: upstream, user_id: user_id) = state) do
    if MapSet.size(tags) == 0 do
      state(upstream: upstream, user_id: user_id)
    else
      state
    end
  end

  @impl Permissions.Graph
  def scope_path(state(empty: true, upstream: upstream), root, relation, record) do
    Permissions.Graph.scope_path(upstream, root, relation, record)
  end

  def scope_path(state, root, relation, id) when is_list(id) do
    # these methods have to return either:
    # - `nil` - the method doesn't  have any info on this scope
    # - `:deleted` - the write buffer knows about this scope and it's been deleted, or
    # - a list of scope ids
    #
    # it's important that we don't just filter out the `:deleted` messages (e.g. by using
    # flat_map) because we want to short-circuit the search if we hit it and not continue down to
    # the upstream graph
    methods =
      Stream.map(
        [
          &locally_deleted/4,
          &scope_path_with_moves/4,
          &local_scope_path/4,
          &upstream_scope_path/4
        ],
        & &1.(state, root, relation, id)
      )

    case Enum.find(methods, & &1) do
      nil -> []
      :deleted -> []
      scopes when is_list(scopes) -> scopes
    end
  end

  defp locally_deleted(state(deletes: deletes), _root, relation, id) do
    if MapSet.member?(deletes, {relation, id}), do: :deleted
  end

  defp scope_path_with_moves(state(moves: []), _root, _relation, _id) do
    nil
  end

  # try resolving the given {relation, id} as a child of the records found in the moves list if
  # the record is a child of any of these moves, then recursively continue the search upwards
  # starting from this move.
  defp scope_path_with_moves(state, root, relation, id) do
    state(moves: moves, upstream: upstream) = state

    if relation_path = Permissions.Graph.relation_path(upstream, root, relation) do
      ordering = relation_path |> Stream.with_index() |> Map.new()

      valid_moves =
        moves
        |> Stream.reject(&match?({^relation, _}, &1))
        |> Stream.filter(fn {relation, _} -> Map.has_key?(ordering, relation) end)
        |> Enum.sort_by(fn {relation, _} -> Map.fetch!(ordering, relation) end)

      Enum.find_value(valid_moves, fn {move_relation, move_id} = move ->
        # filter out the move we're using from the state as we recurse othewise we end up in an
        # infinite loop
        state = state(state, moves: Stream.reject(valid_moves, &(&1 == move)))

        case scope_path(state, move_relation, relation, id) do
          [[{^move_relation, ^move_id, _attrs} | _]] ->
            scope_path(state, root, move_relation, move_id)

          _other ->
            nil
        end
      end)
    end
  end

  defp local_scope_path(state(graph: nil) = _state, _root, _relation, _id) do
    nil
  end

  defp local_scope_path(state, root, relation, id) do
    state(graph: graph, upstream: upstream, deletes: deletes) = state

    relation_path = Permissions.Graph.relation_path(upstream, root, relation)

    {deleted, valid} =
      graph
      |> Permissions.Graph.traverse_fks(relation_path, relation, id)
      |> Enum.split_with(fn path -> Enum.any?(path, &MapSet.member?(deletes, &1)) end)

    case {deleted, valid} do
      {[], []} ->
        nil

      # if the all the paths we have have been deleted then return deleted
      # we need to return this tombstone to short cut looking up the path
      # in the upstream graph
      {[_ | _], []} ->
        :deleted

      {_deleted, [_ | _] = valid} ->
        # the Graph.traverse_fks/3 doesn't necessarily reach the scope root if it does then we've
        # found a valid scope locally, if it doesn't then we need to hand over to the upstream
        # graph to continue where we left off.
        case Enum.split_with(valid, fn [{scope_relation, _scope_id} | _] ->
               scope_relation == root
             end) do
          {[], unscoped} ->
            Enum.flat_map(unscoped, fn [{scope_relation, scope_id} | _] = path ->
              path = normalise_path(path)

              state
              |> upstream_scope_path(root, scope_relation, scope_id)
              |> Enum.map(fn p -> p ++ path end)
            end)

          {scoped, _} ->
            Enum.map(scoped, &normalise_path/1)
        end
    end
  end

  # upstream_scope_path is always the last thing to be checked, even when resolving from the local
  # graph, so we don't need to put `:deleted` tombstone markers in, we just return `[]` to signify
  # that no paths were found in the upstream
  defp upstream_scope_path(state, root, relation, id) do
    state(upstream: upstream) = state

    upstream
    |> Permissions.Graph.scope_path(root, relation, id)
    |> reject_dead_paths(state)
    |> reject_deleted_paths(state)
    |> Enum.to_list()
  end

  defp reject_dead_paths(paths, state(dead_edges: dead_edges) = _state) do
    if MapSet.size(dead_edges) > 0 do
      Stream.reject(paths, fn path ->
        path
        |> Enum.reverse()
        |> Stream.chunk_every(2, 1, :discard)
        |> Enum.any?(fn [{rel1, id1, _}, {rel2, id2, _}] ->
          MapSet.member?(dead_edges, {{rel1, id1}, {rel2, id2}})
        end)
      end)
    else
      paths
    end
  end

  defp reject_deleted_paths(paths, state(deletes: deletes)) do
    if MapSet.size(deletes) > 0 do
      Stream.reject(paths, fn path ->
        Enum.any?(path, fn
          {relation, id, _} -> MapSet.member?(deletes, {relation, id})
          {relation, id} -> MapSet.member?(deletes, {relation, id})
        end)
      end)
    else
      paths
    end
  end

  # our local graph paths are just {relation, id} but the results from Graph.scoped_path need to
  # be {relation, id, metadata}
  defp normalise_path(local_path) do
    Enum.map(local_path, fn {relation, id} -> {relation, id, []} end)
  end

  @impl Permissions.Graph
  def parent(state(upstream: upstream), root, relation, record) do
    Permissions.Graph.parent(upstream, root, relation, record)
  end

  @impl Permissions.Graph
  def apply_change(state, roots, %Changes.NewRecord{} = change) do
    state(graph: graph, upstream: upstream, deletes: deletes) = state
    %{relation: relation, record: record} = change

    # if this lives in any of the scope roots we care about (in `roots`) then we need to add it if
    # not, who cares
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
                  "foreign key reference to non-existent record #{Electric.Utils.inspect_relation(relation)} " <>
                    "=> #{Electric.Utils.inspect_relation(parent_relation)} id: #{inspect(parent_id)}"
            end

          nil ->
            src_graph
        end
      end)

    state
    |> state(graph: graph, empty: is_nil(graph))
    |> apply_tags(change, state)
    |> log_state()
  end

  def apply_change(state, _roots, %Changes.DeletedRecord{relation: relation} = change) do
    state(upstream: upstream, deletes: deletes) = state

    state(state,
      empty: false,
      deletes:
        MapSet.put(
          deletes,
          {relation, Permissions.Graph.primary_key(upstream, relation, change.old_record)}
        )
    )
    |> apply_tags(change, state)
    |> log_state()
  end

  def apply_change(state, roots, %Changes.UpdatedRecord{} = change) do
    state(upstream: upstream, deletes: deletes) = state
    %{relation: relation, old_record: old, record: new} = change

    Enum.reduce(roots, state, fn root, state(moves: moves) = state ->
      case Permissions.Graph.modified_fks(upstream, root, change) do
        [] ->
          state

        modified_keys ->
          child = {relation, Permissions.Graph.primary_key(upstream, relation, new)}

          Enum.reduce(modified_keys, state(state, moves: [child | moves]), fn
            {^relation, _old_id, _new_id}, state(graph: graph) = state ->
              old_parent = Permissions.Graph.parent(upstream, root, relation, old)
              new_parent = Permissions.Graph.parent(upstream, root, relation, new)

              if exists?(graph, upstream, deletes, root, new_parent) do
                graph =
                  graph
                  |> ensure_graph()
                  |> Graph.delete_edge(child, old_parent)
                  |> Graph.add_edge(child, new_parent)

                state(state, graph: graph, empty: false)
              else
                raise Error,
                  message:
                    "foreign key reference to non-existent record #{inspect(relation)} => #{inspect(new_parent)}"
              end

            {fk_relation, old_id, new_id}, state ->
              state(graph: graph, moves: moves, dead_edges: dead_edges) = state
              old_parent = {fk_relation, old_id}
              new_parent = {fk_relation, new_id}

              graph =
                graph
                |> ensure_graph()
                |> Graph.delete_edge(child, old_parent)
                |> Graph.add_edge(child, new_parent)

              state(state,
                graph: graph,
                moves: [old_parent | moves],
                empty: false,
                # though the fk goes the other way, record the edge upwards because that's the way
                # our paths come out
                dead_edges: MapSet.put(dead_edges, {old_parent, child})
              )
          end)
      end
    end)
    |> then(fn state(moves: moves) = state -> state(state, moves: Enum.uniq(moves)) end)
    |> apply_tags(change, state)
    |> log_state()
  end

  defp apply_tags(state(empty: true) = state, _change, _old_state) do
    state
  end

  defp apply_tags(state(tags: tags, ops: ops) = state, %{tags: change_tags}, old_state) do
    ops = if state == old_state, do: ops, else: ops + 1
    state(state, tags: Enum.into(change_tags, tags), ops: ops)
  end

  defp log_state(state(ops: ops, user_id: user_id) = state) when ops > 0 and rem(ops, 10) == 0 do
    level = if ops >= @high_ops, do: :warn, else: :debug

    Logger.log(level, fn -> "Write buffer holding #{ops} unsynced ops" end, user_id: user_id)

    state
  end

  defp log_state(state) do
    state
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
    with [_ | _] <- Permissions.Graph.scope_id(upstream, root, relation, id) do
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
  def modified_fks(state(upstream: upstream), root, update) do
    Permissions.Graph.modified_fks(upstream, root, update)
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
