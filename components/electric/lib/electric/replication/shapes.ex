defmodule Electric.Replication.Shapes do
  @moduledoc """
  Context to work with replication shapes.
  """
  import Electric.Postgres.Extension, only: [is_migration_relation: 1]
  alias Electric.Utils
  alias Electric.Replication.Changes.Transaction
  alias Electric.Postgres.Extension.SchemaCache
  alias Electric.Postgres.Schema
  alias Electric.Replication.Shapes.ShapeRequest
  use Electric.Satellite.Protobuf

  @doc """
  Remove all changes from a transaction which do not belong to any of the
  requested shapes.

  May result in a transaction with no changes.
  """
  @spec filter_changes_from_tx(Transaction.t(), [term()]) :: Transaction.t()
  def filter_changes_from_tx(%Transaction{changes: changes} = tx, shapes) do
    %{tx | changes: Enum.filter(changes, &change_belongs_to_any_shape?(&1, shapes))}
  end

  defp change_belongs_to_any_shape?(change, shapes) do
    is_migration_relation(change.relation) or
      Enum.any?(shapes, &ShapeRequest.change_belongs_to_shape?(&1, change))
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
    {:ok, _, schema} = SchemaCache.load(origin)
    # TODO: Move this graph calculation to the SchemaCache when #191 is merged
    graph = Schema.public_fk_graph(schema)

    shape_requests
    |> Enum.map(&validate_request(&1, schema, graph))
    |> Enum.split_with(&is_struct(&1, ShapeRequest))
    |> case do
      {results, []} -> {:ok, results}
      {_, errors} -> {:error, errors}
    end
  end

  @spec validate_request(%SatShapeReq{}, Schema.t(), Graph.t()) ::
          ShapeRequest.t() | {String.t(), atom(), String.t()}
  defp validate_request(%SatShapeReq{shape_definition: shape} = request, _schema, graph) do
    with :ok <- request_cannot_be_empty(shape),
         :ok <- table_names_are_valid(shape),
         :ok <- tables_should_exist(shape, graph),
         :ok <- tables_should_not_duplicate(shape),
         :ok <- all_fks_should_be_included(shape, graph) do
      ShapeRequest.from_satellite_request(request)
    else
      {code, message} -> {request.request_id, code, message}
    end
  end

  defp request_cannot_be_empty(%SatShapeDef{selects: []}),
    do: {:CODE_UNSPECIFIED, "Empty shape requests are not allowed"}

  defp request_cannot_be_empty(_), do: :ok

  defp table_names_are_valid(%SatShapeDef{selects: selects}) do
    if Enum.all?(
         selects,
         &(String.length(&1.tablename) in 1..64 and String.printable?(&1.tablename))
       ) do
      :ok
    else
      {:TABLE_NOT_FOUND, "Invalid table name"}
    end
  end

  defp tables_should_exist(%SatShapeDef{selects: selects}, graph) do
    tables = Enum.map(selects, & &1.tablename)

    case Enum.reject(tables, &Graph.has_vertex?(graph, &1)) do
      [] -> :ok
      unknowns -> {:TABLE_NOT_FOUND, "Unknown tables: #{Enum.join(unknowns, ",")}"}
    end
  end

  defp tables_should_not_duplicate(%SatShapeDef{selects: selects}) do
    if Utils.has_duplicates_by?(selects, & &1.tablename) do
      {:CODE_UNSPECIFIED, "Cannot select same table twice"}
    else
      :ok
    end
  end

  defp all_fks_should_be_included(%SatShapeDef{selects: selects}, graph) do
    queried_tables = Enum.map(selects, & &1.tablename)

    case Graph.reachable(graph, queried_tables) -- queried_tables do
      [] ->
        :ok

      missing_reachable ->
        {:CODE_UNSPECIFIED,
         "Some tables are missing from the shape request, but are referenced by FKs on the requested tables: #{Enum.join(missing_reachable, ",")}"}
    end
  end
end
