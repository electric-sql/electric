defmodule Electric.Replication.Shapes do
  @moduledoc """
  Context to work with replication shapes.
  """

  alias Electric.Replication.Shapes.ShapeRequest.Layer
  alias Electric.Replication.Changes
  alias Electric.Satellite.SatShapeReq
  alias Electric.Postgres.Extension.SchemaCache
  alias Electric.Postgres.Extension.SchemaLoader.Version, as: SchemaVersion
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Shapes.ShapeRequest
  alias Electric.Replication.Shapes.ChangeProcessing.Reduction
  alias Electric.Replication.Shapes.ChangeProcessing

  import Electric.Postgres.Extension

  @type subquery_actions :: %{optional(Layer.t()) => [{Layer.graph_key(), Changes.change()}]}

  @spec process_transaction(Transaction.t(), Graph.t(), [ShapeRequest.t()]) ::
          {Transaction.t(), Graph.t(), subquery_actions()}
  def process_transaction(%Transaction{} = tx, graph, shapes) do
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
      Enum.reduce(tx.changes, state, fn
        %{relation: relation} = change, state when is_migration_relation(relation) ->
          # For DDL changes, we let them through by always adding them to the resulting changes
          Reduction.add_passthrough_operation(state, change)

        change, state ->
          shapes
          |> Enum.flat_map(&ShapeRequest.relevant_layers(&1, change))
          |> Enum.reduce(state, &ChangeProcessing.process(change, &1, &2))
      end)

    {graph, changes, actions} =
      Enum.reduce(referenced, state, fn {id, change}, state ->
        if Reduction.graph_includes_id?(state, id) do
          state
        else
          shapes
          |> Enum.flat_map(&ShapeRequest.relevant_layers(&1, change))
          |> Enum.reduce(state, &ChangeProcessing.process(change, &1, &2))
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
    Enum.reduce(changes, Reduction.new(graph), fn change, state ->
      shapes
      |> Enum.flat_map(&ShapeRequest.relevant_layers(&1, change))
      |> Enum.reduce(state, &ChangeProcessing.process(change, &1, &2))
    end)
    |> ChangeProcessing.finalize_process()
    |> Reduction.unwrap()
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
    graph = SchemaVersion.fk_graph(schema_version)

    shape_requests
    |> Enum.map(fn req ->
      case ShapeRequest.from_satellite(req, graph, schema_version) do
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

  @spec merge_actions(subquery_actions(), subquery_actions()) :: subquery_actions()
  def merge_actions(a1, a2) do
    Map.merge(a1, a2, fn _, v1, v2 -> v1 ++ v2 end)
  end
end
