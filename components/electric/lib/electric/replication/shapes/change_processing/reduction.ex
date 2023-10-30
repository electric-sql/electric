defmodule Electric.Replication.Shapes.ChangeProcessing.Reduction do
  alias Electric.Replication.Shapes.ShapeRequest.Layer
  alias Electric.Replication.Changes
  require Record

  @empty_buffer %{pk: %{}, fk: %{}, events: %{fk: %{}}, pending_move_out: %{}}

  Record.defrecord(:reduction,
    graph: Graph.new(),
    buffer: @empty_buffer,
    operations: %{},
    passthrough_operations: [],
    operation_ids: %{},
    gone_nodes: MapSet.new(),
    actions: %{}
  )

  @type row_id :: term()
  @type event :: Changes.change()
  @type buffer_key :: {Layer.graph_key(), row_id()}
  @type fk_event :: {parent_id :: row_id(), this_fk_seen_count :: pos_integer()}
  @type update_state :: :new_record | :deleted_record | :updated_record
  @type buffer() :: %{
          pk: %{optional(buffer_key()) => [{event(), Layer.t()}, ...]},
          fk: %{optional(buffer_key()) => [{event(), Layer.t()}, ...]},
          events: %{fk: %{optional(buffer_key()) => fk_event()}},
          pending_move_out: %{optional(buffer_key()) => [{event(), Layer.t()}, ...]}
        }
  @type subquery_actions :: Electric.Replication.Shapes.subquery_actions()
  @type t() ::
          record(
            :reduction,
            graph: Graph.t(),
            buffer: buffer(),
            operations: %{optional(event()) => update_state() | nil},
            passthrough_operations: [event()],
            operation_ids: %{row_id() => [event(), ...]},
            gone_nodes: MapSet.t(row_id()),
            actions: subquery_actions()
          )

  defguard is_reduction(r) when Record.is_record(r, :reduction)

  @spec new(Graph.t()) :: t()
  def new(%Graph{} = graph), do: reduction(graph: graph)

  @spec unwrap(reduction :: t()) ::
          {Graph.t(), [Changes.change() | Changes.Gone.t()], subquery_actions()}
  def unwrap(reduction(graph: graph, operations: ops, gone_nodes: gone, actions: actions) = state) do
    changes =
      reduction(state, :passthrough_operations) ++
        Enum.map(gone, fn {relation, pk} -> %Changes.Gone{relation: relation, pk: pk} end) ++
        Enum.map(ops, &unwrap_operation/1)

    {graph, changes, actions}
  end

  defp unwrap_operation({%Changes.UpdatedRecord{} = change, target}),
    do: Changes.convert_update(change, to: target)

  defp unwrap_operation({change, nil}), do: change

  def add_passthrough_operation(reduction(passthrough_operations: ops) = state, event) do
    reduction(state, passthrough_operations: [event | ops])
  end

  @spec add_operation(t(), event(), row_id(), nil | [as: update_state()]) :: t()
  def add_operation(state, event, own_id, opts \\ nil)

  def add_operation(
        reduction(operations: ops, operation_ids: ids) = state,
        %Changes.UpdatedRecord{} = event,
        own_id,
        as: update_state
      )
      when update_state in [:new_record, :deleted_record, :updated_record] do
    ops = Map.update(ops, event, update_state, &merge_update_states(&1, update_state))
    ids = Map.update(ids, own_id, [event], &[event | &1])

    reduction(state, operations: ops, operation_ids: ids)
  end

  def add_operation(reduction(operations: ops, operation_ids: ids) = state, event, own_id, nil)
      when not is_struct(event, Changes.UpdatedRecord),
      do:
        reduction(state,
          operations: Map.put(ops, event, nil),
          operation_ids: Map.update(ids, own_id, [event], &[event | &1])
        )

  defp merge_update_states(:updated_record, _), do: :updated_record
  defp merge_update_states(_, :updated_record), do: :updated_record
  defp merge_update_states(:new_record, :deleted_record), do: :updated_record
  defp merge_update_states(:deleted_record, :new_record), do: :updated_record
  defp merge_update_states(state, state), do: state

  @spec graph_includes_id?(t(), row_id()) :: boolean()
  def graph_includes_id?(reduction(graph: graph), id), do: Graph.has_vertex?(graph, id)
end
