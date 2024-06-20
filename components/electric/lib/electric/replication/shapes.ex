defmodule Electric.Replication.Shapes do
  @moduledoc """
  Context to work with replication shapes.
  """

  alias Electric.Replication.Shapes.ShapeRequest.Layer
  alias Electric.Replication.Changes
  alias Electric.Satellite.SatShapeReq
  alias Electric.Satellite.Permissions
  alias Electric.Postgres.Extension.SchemaCache
  alias Electric.Postgres.Extension.SchemaLoader.Version, as: SchemaVersion
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Shapes.ShapeRequest
  alias Electric.Replication.Shapes.ChangeProcessing.Reduction
  alias Electric.Replication.Shapes.ChangeProcessing

  import Electric.Postgres.Extension

  @type subquery_actions :: %{optional(Layer.t()) => [{Layer.graph_key(), Changes.change()}]}

  @spec process_transaction(Transaction.t(), [Permissions.move_out()], Graph.t(), [
          ShapeRequest.t()
        ]) ::
          {Transaction.t(), Graph.t(), subquery_actions()}
  def process_transaction(%Transaction{} = tx, moves_out \\ [], graph, shapes) do
    state = Reduction.new(graph)

    referenced =
      Enum.flat_map(tx.referenced_records, fn {rel, items} ->
        Enum.map(items, fn {pk, referenced} ->
          {{rel, pk},
           %Changes.UpdatedRecord{
             relation: referenced.relation,
             record: referenced.record,
             old_record: referenced.record,
             tags: referenced.tags
           }}
        end)
      end)

    state =
      tx.changes
      |> Enum.concat(moves_out)
      |> Enum.reduce(state, fn
        %{relation: relation} = change, state when is_migration_relation(relation) ->
          # For DDL changes, we let them through by always adding them to the resulting changes
          Reduction.add_passthrough_operation(state, change)

        change, state ->
          process_change_using_shapes(shapes, change, state)
      end)

    {graph, changes, actions} =
      Enum.reduce(referenced, state, fn {id, change}, state ->
        if Reduction.graph_includes_id?(state, id) do
          state
        else
          process_change_using_shapes(shapes, change, state)
        end
      end)
      |> ChangeProcessing.finalize_process()
      |> Reduction.unwrap()

    {%Transaction{tx | changes: changes}, graph, actions}
  end

  @doc """
  Process changes that didn't come in the form of a full transaction, but still need to be
  filtered and incorporated into the graph.
  """
  @spec process_additional_changes(Enumerable.t(Changes.change()), Graph.t(), [ShapeRequest.t()]) ::
          {Graph.t(), [Changes.change()], subquery_actions()}
  def process_additional_changes(changes, graph, shapes) do
    Enum.reduce(changes, Reduction.new(graph), &process_change_using_shapes(shapes, &1, &2))
    |> ChangeProcessing.finalize_process()
    |> Reduction.unwrap()
  end

  defp process_change_using_shapes(shapes, change, state) do
    shapes
    |> Enum.flat_map(&ShapeRequest.relevant_layers(&1, change))
    |> Enum.reduce(state, &ChangeProcessing.process(change, &1, &2))
  end

  @doc """
  Validate incoming Protobuf Satellite shape requests, converting them to internal
  representation.

  Checks each shape request separately, validating that:
  - All requested tables exist
  - If any of the tables have foreign keys, same request includes the referenced tables

  On error, the second element of the error tuple is an array with 3-tuples, where
  first element is the invalid request ID, second element is the error code, and the third
  element is the actual error message.
  """
  # TODO: Remove `origin` argument here when #191 is merged
  @spec validate_requests([%SatShapeReq{}, ...], String.t()) ::
          {:ok, [ShapeRequest.t(), ...]} | {:error, [{String.t(), atom(), String.t()}]}
  def validate_requests(shape_requests, origin) do
    {:ok, schema_version} = SchemaCache.load(origin)
    fk_graph = SchemaVersion.fk_graph(schema_version)

    shape_requests
    |> Enum.map(fn req ->
      case ShapeRequest.from_satellite(req, fk_graph, schema_version) do
        {:ok, %ShapeRequest{} = result} -> result
        {:error, {code, message}} -> {req.request_id, code, message}
      end
    end)
    |> Enum.split_with(&is_struct(&1, ShapeRequest))
    |> case do
      {results, []} -> {:ok, results}
      {_, errors} -> {:error, errors}
    end
  end

  @type action_context :: {actions :: subquery_actions(), source_tx_ids :: [non_neg_integer()]}

  @spec merge_actions(action_context(), action_context()) :: action_context()
  def merge_actions({a1, l1}, {a2, l2}) when is_list(l1) and is_list(l2) do
    {Map.merge(a1, a2, fn _, v1, v2 -> v1 ++ v2 end), l1 ++ l2}
  end

  @spec merge_actions_for_tx(action_context(), subquery_actions(), non_neg_integer()) ::
          action_context()
  def merge_actions_for_tx({a1, l1}, a2, new_txid) when is_list(l1) and is_integer(new_txid) do
    {Map.merge(a1, a2, fn _, v1, v2 -> v1 ++ v2 end), [new_txid | l1]}
  end
end
