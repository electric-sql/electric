defmodule Electric.Replication.Shapes do
  @moduledoc """
  Context to work with replication shapes.
  """
  import Electric.Postgres.Extension, only: [is_migration_relation: 1]
  alias Electric.Replication.Eval
  alias Electric.Utils
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Transaction
  alias Electric.Postgres.Extension.SchemaCache
  alias Electric.Postgres.Extension.SchemaLoader.Version, as: SchemaVersion
  alias Electric.Replication.Changes.UpdatedRecord
  alias Electric.Replication.Shapes.ShapeRequest
  use Electric.Satellite.Protobuf

  @doc """
  Remove all changes from a transaction which do not belong to any of the
  requested shapes.

  May result in a transaction with no changes.
  """
  @spec filter_map_changes_from_tx(Transaction.t(), [term()]) :: Transaction.t()
  def filter_map_changes_from_tx(%Transaction{changes: changes} = tx, shapes) do
    %{tx | changes: Enum.flat_map(changes, &filter_map_change_for_shapes(&1, shapes))}
  end

  # Don't touch migration relations
  defp filter_map_change_for_shapes(change, _) when is_migration_relation(change.relation),
    do: [change]

  # Updated record may need to be converted to an INSERT or a DELETE instead, if record moves in/out of shape
  defp filter_map_change_for_shapes(%UpdatedRecord{} = change, shapes) do
    positions = Map.new(shapes, &{ShapeRequest.get_update_position_in_shape(&1, change), nil})

    case positions do
      # We have sent this row before in at least one shape, keep the update
      %{in: _} -> [change]
      # Some shapes observe a move-in, some observe a move-out, but we're keeping the update
      %{move_in: _, move_out: _} -> [change]
      # Next cases will do transformations that assume correct info about the client,
      # which is impossible if at least one shape couldn't be calculated, so we skip the change
      %{error: _} -> []
      # If it's a move-in in all cases, convert update to insert
      %{move_in: _} -> [Changes.convert_update(change, to: :new_record)]
      # If it's a move-out in all cases, convert update to insert
      %{move_out: _} -> [Changes.convert_update(change, to: :deleted_record)]
      # Otherwise, change is not part of any shapes - skip it
      _ -> []
    end
  end

  # New/deleted records either do or do not fall into any one of the shapes
  defp filter_map_change_for_shapes(change, shapes) do
    record =
      case change do
        %Changes.NewRecord{record: x} -> x
        %Changes.DeletedRecord{old_record: x} -> x
      end

    if Enum.any?(shapes, &ShapeRequest.record_belongs_to_shape?(&1, change.relation, record)),
      do: [change],
      else: []
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
    |> Enum.map(&validate_request(&1, schema_version, graph))
    |> Enum.split_with(&is_struct(&1, ShapeRequest))
    |> case do
      {results, []} -> {:ok, results}
      {_, errors} -> {:error, errors}
    end
  end

  @spec validate_request(%SatShapeReq{}, SchemaVersion.t(), Graph.t()) ::
          ShapeRequest.t() | {String.t(), atom(), String.t()}
  defp validate_request(%SatShapeReq{shape_definition: shape} = request, schema_version, graph) do
    with :ok <- request_cannot_be_empty(shape),
         :ok <- table_names_are_valid(shape),
         :ok <- tables_should_exist(shape, graph),
         :ok <- tables_should_not_duplicate(shape),
         :ok <- where_clauses_cannot_have_fks(shape, graph),
         %{} = parsed <- where_clauses_are_valid(shape, schema_version),
         :ok <- all_fks_should_be_included(shape, graph) do
      ShapeRequest.from_satellite_request(request, parsed)
    else
      {code, message} -> {request.request_id, code, message}
    end
  end

  defp request_cannot_be_empty(%SatShapeDef{selects: []}),
    do: {:EMPTY_SHAPE_DEFINITION, "Empty shape requests are not allowed"}

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
      {:DUPLICATE_TABLE_IN_SHAPE_DEFINITION, "Cannot select same table twice"}
    else
      :ok
    end
  end

  defp where_clauses_cannot_have_fks(%SatShapeDef{selects: selects}, graph) do
    selects_with_where =
      selects
      |> Enum.filter(&(&1.where != ""))
      |> Enum.map(& &1.tablename)

    selected_tables = MapSet.new(selects, & &1.tablename)

    # If children of a where-filtered tables are in selected, then we have a problem where we cannot guarantee FK consistency on the client right now.
    # This is expected to be addressed later.
    case Enum.filter(selects_with_where, &(not children_in_selected?(&1, selected_tables, graph))) do
      [] ->
        :ok

      violations ->
        {:INVALID_WHERE_CLAUSE,
         "Where clause currently cannot be applied to a table with incoming FKs in the same request, but requested tables do have them: #{Enum.join(violations, ", ")}"}
    end
  end

  defp children_in_selected?(table, selected, graph) do
    MapSet.disjoint?(selected, MapSet.new(Graph.in_neighbors(graph, table)))
  end

  defp where_clauses_are_valid(%SatShapeDef{selects: selects}, schema) do
    selects
    |> Enum.filter(&(&1.where != ""))
    |> Enum.reduce_while(%{}, &parse_where_clause(&1, schema, &2))
  end

  defp all_fks_should_be_included(%SatShapeDef{selects: selects}, graph) do
    queried_tables = Enum.map(selects, & &1.tablename)

    case Graph.reachable(graph, queried_tables) -- queried_tables do
      [] ->
        :ok

      missing_reachable ->
        {:REFERENTIAL_INTEGRITY_VIOLATION,
         "Some tables are missing from the shape request, but are referenced by FKs on the requested tables: #{Enum.join(missing_reachable, ",")}"}
    end
  end

  # Used in `Enum.reduce_while/3`
  @spec parse_where_clause(%SatShapeDef.Select{}, SchemaVersion.t(), %{
          String.t() => Eval.Expr.t()
        }) ::
          {:cont, %{String.t() => Eval.Expr.t()}} | {:halt, {atom(), String.t()}}
  defp parse_where_clause(%{tablename: table, where: where}, schema, acc) do
    refs =
      SchemaVersion.table!(schema, {"public", table})
      |> Map.fetch!(:columns)
      # All columns have to be `this`-qualified so that we can reuse the where clause in queries with no edits
      |> Enum.map(fn %{name: name, type: %{name: type}} ->
        {["this", name], String.to_atom(type)}
      end)
      |> Map.new()

    case Eval.Parser.parse_and_validate_expression(where, refs) do
      {:ok, %{returns: :bool} = parsed} ->
        {:cont, Map.put(acc, where, parsed)}

      {:ok, %{returns: type}} ->
        {:halt,
         {:INVALID_WHERE_CLAUSE,
          "Where expression should evaluate to a boolean, but it's #{type}"}}

      {:error, reason} ->
        {:halt, {:INVALID_WHERE_CLAUSE, reason}}
    end
  end
end
