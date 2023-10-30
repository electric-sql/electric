defmodule Electric.Replication.Shapes.ChangeProcessing do
  require Pathex
  alias Electric.Replication.Eval
  alias Electric.Replication.Shapes.ShapeRequest.Layer
  alias Electric.Replication.Shapes.ChangeProcessing.Reduction
  alias Electric.Replication.Changes

  use Pathex, default_mod: :json
  require Pathex.Lenses
  import Electric.Replication.Shapes.ChangeProcessing.Reduction

  @spec process(Changes.change(), Layer.t(), Reduction.t()) :: Reduction.t()
  def process(%Changes.NewRecord{} = r, %Layer{} = layer, reduction(graph: graph) = state)
      when r.relation == layer.target_table do
    if where_clause_passes?(layer.where_target, r.record) do
      own_id = id(r.record, layer.target_table, layer.target_pk)

      case layer.direction do
        :first_layer ->
          graph = add_to_graph(graph, layer, r.record)

          process_next_layers(layer, reduction(state, graph: graph), r.record, event: :new)
          |> add_operation(r, own_id)

        :one_to_many ->
          parent_id = id(r.record, layer.source_table, layer.fk)

          if row_in_graph?(graph, parent_id, layer.parent_key) do
            graph = add_to_graph(graph, layer, r.record, parent_id)

            process_next_layers(layer, reduction(state, graph: graph), r.record, event: :new)
            |> add_operation(r, own_id)
          else
            buffer(state, r, layer, waiting_for: {:pk, parent_id})
          end

        :many_to_one ->
          # Since this is a new record, it cannot have been already referenced, unless in the same transaction
          case fetch_buffer_seen_fk(reduction(state, :buffer), layer, own_id) do
            {:ok, {parent_id, count}} ->
              graph = add_to_graph(graph, layer, r.record, parent_id)

              if count == 1 do
                process_next_layers(layer, reduction(state, graph: graph), r.record, event: :new)
                |> add_operation(r, own_id)
              else
                reduction(state, graph: graph)
              end

            :error ->
              buffer(state, r, layer, waiting_for: {:fk, own_id})
          end
      end
    else
      skip(state)
    end
  end

  def process(%Changes.DeletedRecord{} = r, %Layer{} = layer, reduction(graph: graph) = state)
      when r.relation == layer.target_table do
    own_id = id(r.old_record, layer.target_table, layer.target_pk)

    cond do
      row_in_graph?(graph, own_id, layer.key) ->
        state
        |> remove_layer_connection(layer, r.old_record)
        |> cascade_remove_from_graph(layer, own_id)
        |> add_operation(r, own_id)
        |> mark_gone_superseded(own_id)

      row_gone?(state, own_id) ->
        state
        |> add_operation(r, own_id)
        |> mark_gone_superseded(own_id)

      true ->
        skip(state)
    end
  end

  def process(%Changes.UpdatedRecord{} = r, %Layer{} = layer, reduction(graph: graph) = state)
      when r.relation == layer.target_table do
    own_id = id(r.record, layer.target_table, layer.target_pk)
    was_in_where? = where_clause_passes?(layer.where_target, r.old_record)
    is_in_where? = where_clause_passes?(layer.where_target, r.record)
    is_in_graph? = row_in_graph?(graph, own_id, layer.key)

    case layer.direction do
      :first_layer ->
        case {was_in_where?, is_in_where?} do
          {true, true} ->
            # it's guaranteed to be already in the graph if it's a first layer and where clause passed before
            # TODO: assumption above likely doesn't hold under permissions unless we include that check in
            #       the `was_in_where` boolean, which seems reasonable, since permissions-caused moves are moves.
            state
            |> add_operation(r, own_id, as: :updated_record)
            |> mark_gone_superseded(own_id)

          {false, true} ->
            move_in(state, r, layer, own_id)

          {true, false} ->
            move_out(state, r, layer, own_id)

          {false, false} ->
            skip(state)
        end

      :many_to_one ->
        # Where clauses are not allowed on the `one` side of many-to-one relation, so an update here
        # is processed like an insert. Difference being, this "update" may be a compensation coming in
        # together with another update/insert of a row on the `many` side
        if is_in_graph? do
          state
          |> add_operation(r, own_id, as: :updated_record)
          |> mark_gone_superseded(own_id)
        else
          case fetch_buffer_seen_fk(reduction(state, :buffer), layer, own_id) do
            {:ok, {parent_id, _count}} ->
              move_in(state, r, layer, own_id, parent_id)

            :error ->
              buffer(state, r, layer, waiting_for: {:fk, own_id})
          end
        end

      :one_to_many ->
        parent_id = id(r.record, layer.source_table, layer.fk)

        case {is_in_graph?, was_in_where?, is_in_where?} do
          # {true, false, _} is impossible, since if it's in graph currently, it's previous version has passed the "where" check
          {true, true, true} ->
            old_parent_id = id(r.old_record, layer.source_table, layer.fk)

            cond do
              parent_id == old_parent_id ->
                reduction(state, graph: graph)
                |> add_operation(r, own_id, as: :updated_record)

              row_in_graph?(graph, parent_id, layer.parent_key) ->
                # We need to special-case a same-layer move between parents to update the graph correctly
                graph =
                  reduction(state, :graph)
                  |> Graph.delete_edge(old_parent_id, own_id, layer.key)
                  |> add_to_graph(layer, r.record, parent_id)

                reduction(state, graph: graph)
                |> add_operation(r, own_id, as: :updated_record)
                |> mark_gone_superseded(own_id)

              true ->
                # New parent isn't in the graph, but may be added.
                # If we never see parent's addition, we need to move out; otherwise we need to do cross-parent move
                buffer(state, r, layer,
                  waiting_for: {:pk, parent_id},
                  if_not_seen: {:move_out, own_id}
                )
            end

          {false, _, true} ->
            # This update may be relevant if we'll see parent insert/update in the same txn, so we buffer
            if row_in_graph?(graph, parent_id, layer.parent_key) do
              move_in(state, r, layer, own_id, parent_id)
            else
              buffer(state, r, layer, waiting_for: {:pk, parent_id})
            end

          {true, true, false} ->
            move_out(state, r, layer, own_id)

          {false, false, false} ->
            skip(state)
        end
    end
  end

  def finalize_process(reduction(buffer: buffer) = state) do
    # TODO: Are dependency loops between rows possible at this point? Would they be possible when we add recursive rows/tables support?
    buffer.pending_move_out
    |> Enum.flat_map(fn {_, pending} -> pending end)
    |> Enum.reduce(state, fn {event, layer, own_id}, state ->
      move_out(state, event, layer, own_id)
    end)
  end

  def move_in(state, %Changes.UpdatedRecord{} = event, layer, own_id, parent_id \\ nil)
      when is_struct(layer, Layer) and is_reduction(state) do
    graph = add_to_graph(reduction(state, :graph), layer, event.record, parent_id)

    process_next_layers(layer, reduction(state, graph: graph), event.record, event: :new)
    |> add_operation(event, own_id, as: :new_record)
    |> mark_gone_superseded(own_id)
    |> add_fetch_action(layer, event.record, own_id)
  end

  def move_out(state, %Changes.UpdatedRecord{} = event, %Layer{} = layer, own_id) do
    state
    |> remove_layer_connection(layer, event.old_record)
    |> cascade_remove_from_graph(layer, own_id)
    |> add_operation(event, own_id, as: :deleted_record)
    |> mark_gone_superseded(own_id)
  end

  def add_fetch_action(state, %Layer{next_layers: []}, _, _) when is_reduction(state), do: state

  def add_fetch_action(reduction(actions: actions) = state, layer, record, own_id)
      when is_struct(layer, Layer) and is_map(record) do
    if Enum.any?(layer.next_layers, &(&1.direction == :one_to_many)) do
      actions = Map.update(actions, layer, [{own_id, record}], &[{own_id, record} | &1])
      reduction(state, actions: actions)
    else
      state
    end
  end

  @spec skip(any()) :: any()
  def skip(state), do: state

  def mark_gone_superseded(reduction(gone_nodes: gone) = state, id),
    do: reduction(state, gone_nodes: MapSet.delete(gone, id))

  def row_gone?(reduction(gone_nodes: gone), id), do: MapSet.member?(gone, id)

  def where_clause_passes?(nil, _), do: true

  def where_clause_passes?(%Eval.Expr{} = expr, record) do
    {:ok, remapped} = Eval.Runner.record_to_ref_values(expr.used_refs, record)

    case Eval.Runner.execute(expr, remapped) do
      {:ok, true} -> true
      {:ok, false} -> false
      _ -> false
    end
  end

  @doc """
  Add record to graph
  """
  def add_to_graph(graph, layer, record_or_id, parent_id \\ nil)

  def add_to_graph(graph, %Layer{direction: :first_layer} = layer, record_or_id, nil)
      when is_map(record_or_id) or is_tuple(record_or_id) do
    own_id =
      case record_or_id do
        record when is_map(record) -> id(record, layer.target_table, layer.target_pk)
        id -> id
      end

    Graph.add_edge(graph, :root, own_id, label: layer.key)
  end

  def add_to_graph(graph, %Layer{} = layer, record_or_id, parent_record_or_id)
      when (is_map(record_or_id) or is_tuple(record_or_id)) and layer.direction != :first_layer and
             parent_record_or_id != nil and
             (is_map(parent_record_or_id) or is_tuple(parent_record_or_id)) do
    own_id =
      case record_or_id do
        record when is_map(record) -> id(record, layer.target_table, layer.target_pk)
        id -> id
      end

    parent_id =
      case parent_record_or_id do
        record when is_map(record) -> id(record, layer.source_table, layer.source_pk)
        id -> id
      end

    Graph.add_edge(graph, parent_id, own_id, label: layer.key)
  end

  def add_to_graph(graph, %Layer{} = layer, own_id, parent_id)
      when is_tuple(own_id) and layer.direction != :first_layer and parent_id != nil do
    Graph.add_edge(graph, parent_id, own_id, label: layer.key)
  end

  @doc """

  """
  def remove_layer_connection(state, %Layer{} = layer, record) when is_map(record) do
    remove_layer_connection(state, layer, id(record, layer.target_table, layer.target_pk))
  end

  def remove_layer_connection(reduction(graph: graph) = state, %Layer{key: key}, id)
      when is_tuple(id) do
    edges_for_removal =
      graph
      |> Graph.in_edges(id)
      |> Enum.filter(&match?(%Graph.Edge{label: ^key}, &1))

    reduction(state, graph: Graph.delete_edges(graph, edges_for_removal))
  end

  def remove_from_graph(graph, %Layer{key: key}, id, parent_id) do
    Graph.delete_edge(graph, parent_id, id, key)
  end

  @doc """

  """
  def gc_node(state, false, _) when is_reduction(state), do: state

  def gc_node(reduction(graph: g, gone_nodes: n) = state, true, id),
    do: reduction(state, graph: Graph.delete_vertex(g, id), gone_nodes: MapSet.put(n, id))

  @doc """

  """
  def process_next_layers(%Layer{next_layers: []}, state, _record, _) when is_reduction(state),
    do: state

  def process_next_layers(%Layer{} = layer, state, record, event: event_type)
      when is_reduction(state) do
    for %Layer{} = next_layer <- layer.next_layers, reduce: state do
      state ->
        case {next_layer.direction, event_type} do
          # On a fully new row we don't need to 1-* relations, since all of them will be contained in this or following txns
          {:one_to_many, :new} ->
            trigger_buffer_pk_event(state, next_layer, record)

          {:many_to_one, :new} ->
            trigger_buffer_fk_event(state, next_layer, record)
        end
    end
  end

  def cascade_remove_from_graph(reduction(graph: graph) = state, %Layer{} = layer, starting_id) do
    edges = Graph.out_edges(graph, starting_id)

    state =
      for %Graph.Edge{label: key, v2: next_id} <- edges,
          %Layer{key: ^key} = next_layer <- layer.next_layers,
          reduce: state do
        reduction(graph: graph) = state ->
          graph = Graph.delete_edge(graph, starting_id, next_id, key)

          reduction(state, graph: graph)
          |> cascade_remove_from_graph(next_layer, next_id)
      end

    if Graph.in_degree(graph, starting_id) > 0 or not Graph.has_vertex?(graph, starting_id) do
      state
    else
      # Nothing references this row anymore, we need to send GONE message to the client
      # and make sure any already-processed changes are not sent
      reduction(gone_nodes: gone, graph: graph, operation_ids: ids, operations: ops) = state

      changes_to_delete = Map.get(ids, starting_id, [])

      # Special case: if the row has been added in this txn then it shouldn't even be GONE
      gone =
        if Enum.any?(changes_to_delete, &match?(%Changes.NewRecord{}, &1)),
          do: gone,
          else: MapSet.put(gone, starting_id)

      reduction(state,
        gone_nodes: gone,
        graph: Graph.delete_vertex(graph, starting_id),
        operations: Map.drop(ops, changes_to_delete)
      )
    end
  end

  @doc """

  """
  def id(record, relation, pk_columns), do: {relation, get_pk(record, pk_columns)}
  defp get_pk(map, keys), do: Enum.map(keys, &Map.fetch!(map, &1))

  @doc """

  """
  def row_in_graph?(graph, row_id, layer_key) do
    graph
    |> Graph.in_edges(row_id)
    |> Enum.any?(&(&1.label == layer_key))
  end

  @doc """

  """
  def buffer(reduction(buffer: buffer) = state, event, layer, [
        {:waiting_for, {kind, id}} | if_not_seen
      ])
      when kind in [:pk, :fk] do
    path = path(kind / {layer.key, id})

    buffer = Pathex.force_over!(buffer, path, &[{event, layer} | &1], [{event, layer}])

    buffer =
      case Keyword.fetch(if_not_seen, :if_not_seen) do
        {:ok, {:move_out, own_id}} ->
          path = path(:pending_move_out / {layer.key, id})
          tuple = {event, layer, own_id}
          Pathex.force_over!(buffer, path, &[tuple | &1], [tuple])

        :error ->
          buffer
      end

    reduction(state, buffer: buffer)
  end

  @doc """

  """
  def waiting_for?(buffer, %Layer{key: key, direction: dir}, found_id) do
    kind =
      case dir do
        :one_to_many -> :pk
        :many_to_one -> :fk
      end

    Pathex.exists?(buffer, path(kind / {key, found_id} / 0))
  end

  @doc """

  """
  def fetch_buffer_seen_fk(buffer, %Layer{key: key, direction: :many_to_one}, fk_id) do
    Pathex.view(buffer, path(:events / :fk / {key, fk_id}))
  end

  @doc """
  """
  def trigger_buffer_fk_event(state, %Layer{direction: :many_to_one} = layer, record)
      when is_reduction(state) do
    own_id = id(record, layer.source_table, layer.source_pk)
    fk_id = id(record, layer.target_table, layer.fk)

    event_path = path(:events / :fk / {layer.key, fk_id})

    buffer =
      reduction(state, :buffer)
      |> Pathex.force_over!(event_path, fn {_, count} -> {own_id, count + 1} end, {own_id, 1})

    # If the row has already been referenced in the same layer (i.e. by a sibling), then we can immediately add a graph edge towards it
    graph =
      if row_in_graph?(reduction(state, :graph), fk_id, layer.key) do
        add_to_graph(reduction(state, :graph), layer, fk_id, own_id)
      else
        reduction(state, :graph)
      end

    for {change, layer} <-
          Pathex.get(reduction(state, :buffer), path(:fk / {layer.key, fk_id}), []),
        reduce: reduction(state, buffer: buffer, graph: graph) do
      state -> process(change, layer, state)
    end
  end

  @doc """
  """
  def trigger_buffer_pk_event(state, %Layer{direction: :one_to_many} = layer, record)
      when is_reduction(state) do
    own_id = id(record, layer.source_table, layer.source_pk)

    buffer =
      reduction(state, :buffer)
      |> Map.update!(:pending_move_out, &Map.delete(&1, {layer.key, own_id}))

    for {change, layer} <-
          Pathex.get(buffer, path(:pk / {layer.key, own_id}), []),
        reduce: reduction(state, buffer: buffer) do
      state -> process(change, layer, state)
    end
  end
end
