defmodule Electric.Replication.Shapes.Querying do
  alias Electric.Utils
  alias Electric.Replication.Changes.Ownership
  alias Electric.Postgres.Replication
  alias Electric.Replication.Shapes.ChangeProcessing
  alias Electric.Postgres.ShadowTableTransformation
  alias Electric.Postgres.Extension.SchemaLoader.Version, as: SchemaVersion
  alias Electric.Postgres.Schema
  alias Electric.Replication.Changes
  alias Electric.Replication.Eval
  alias Electric.Replication.Shapes.ShapeRequest.Layer

  @type results :: %{Layer.graph_key() => {Changes.change(), [String.t(), ...]}}

  @doc """
  Query PostgreSQL for data which corresponds to this layer.

  Each layer requires a different initial dataset, so this function
  encapsulates that. The arguments, apart from the layer itself, are:
  - `conn` - the `:epgsql` connection to use for queries.
  - `schema` - the `%Electric.Postgres.Schema.Proto.Schema{}` struct, used to get
    columns and other information required to build queries
  - `origin` - PG origin that's used to convert PG tags to Satellite tags.
    See `Electric.Postgres.ShadowTableTransformation.convert_tag_list_pg_to_satellite/2`
    for details.
  - `filtering_context` - additional information that needs to be taken into consideration
    when building a query, like permissions or rows that need to be ignored

  ## Transaction requirements

  Stability and validity of the results depends on running in the correct transaction.
  This function may execute multiple queries separately and expects the data to be stable,
  so the connection needs to be in a transaction with `ISOLATION LEVEL REPEATABLE READ`
  set (see [PG documentation](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-REPEATABLE-READ)
  for details.)
  """
  @spec query_layer(
          term(),
          Layer.t(),
          SchemaVersion.t(),
          String.t(),
          map(),
          [[String.t(), ...]] | nil
        ) ::
          {:ok, results(), Graph.t()} | {:error, term()}
  def query_layer(conn, %Layer{} = layer, schema, origin, context \\ %{}, from \\ nil) do
    case do_query_layer(conn, layer, schema, origin, context, from) do
      {:ok, _, changes, graph} -> {:ok, changes, graph}
      {:error, _} = error -> error
    end
  end

  @spec do_query_layer(
          term(),
          Layer.t(),
          SchemaVersion.t(),
          String.t(),
          map(),
          [[String.t(), ...]] | nil
        ) ::
          {:ok, [Changes.NewRecord.t()], results(), Graph.t()}
          | {:error, term()}
  defp do_query_layer(conn, %Layer{} = layer, schema_version, origin, context, from) do
    table =
      schema_version
      |> SchemaVersion.table!(layer.target_table)
      |> Schema.single_table_info(schema_version.schema)

    columns = Enum.map_join(table.columns, ", ", &~s|this."#{&1.name}"|)
    pk_clause = Enum.map_join(layer.target_pk, " AND ", &~s|this."#{&1}" = shadow."#{&1}"|)

    where_clauses =
      [
        where_target(layer.where_target),
        parent_pseudo_join(layer, from),
        context_filters(table, context, layer)
      ]
      |> Enum.reject(&(is_nil(&1) or &1 == ""))
      |> Enum.intersperse(" AND ")

    where = if where_clauses != [], do: ["WHERE ", where_clauses], else: ""

    query =
      IO.iodata_to_binary([
        """
        SELECT shadow."_tags", #{columns}
          FROM #{Schema.name(table.schema)}.#{Schema.name(table.name)} as this
          JOIN electric."shadow__#{table.schema}__#{table.name}" as shadow
            ON #{pk_clause}
        """,
        where
      ])

    # Important reason for `squery` usage here (as opposed to what might be more reasonable `equery`) is that we need
    # string representation of all fields, so we don't want to do double-conversion inside epgsql and back
    with {:ok, _, rows} <- :epgsql.squery(conn, query) do
      curr_records =
        rows_to_changes_with_tags(rows, Enum.map(table.columns, & &1.name), layer, origin)

      graph = maybe_fill_first_graph_layer(Graph.new(), layer, curr_records)

      record_map =
        Map.new(curr_records, fn {id, change} -> {id, {change, [layer.request_id]}} end)

      query_next_layers(
        conn,
        layer,
        schema_version,
        origin,
        context,
        curr_records,
        graph,
        record_map
      )
    end
  end

  def query_next_layers(
        conn,
        layer,
        schema_version,
        origin,
        context,
        curr_records,
        graph \\ Graph.new(),
        results_map \\ %{}
      )

  def query_next_layers(_, _, _, _, _, [], graph, results_map),
    do: {:ok, [], results_map, graph}

  def query_next_layers(
        conn,
        %Layer{} = layer,
        schema_version,
        origin,
        context,
        curr_records,
        graph,
        results_map
      ) do
    Enum.reduce_while(
      layer.next_layers,
      {:ok, curr_records, results_map, graph},
      fn next_layer, {:ok, curr_records, acc_records, acc_graph} ->
        pseudo_join = get_join_values(next_layer, curr_records)

        case do_query_layer(conn, next_layer, schema_version, origin, context, pseudo_join) do
          {:ok, next_records, all_records, graph} ->
            acc_graph =
              graph
              |> Utils.merge_graph_edges(acc_graph)
              |> fill_graph(next_layer, curr_records, next_records)

            {:cont, {:ok, curr_records, Map.merge(acc_records, all_records), acc_graph}}

          {:error, _} = error ->
            {:halt, error}
        end
      end
    )
  end

  defp where_target(nil), do: nil
  defp where_target(%Eval.Expr{query: query}), do: query

  defp maybe_fill_first_graph_layer(
         %Graph{} = graph,
         %Layer{direction: :first_layer, key: key},
         records
       ) do
    Enum.reduce(
      records,
      graph,
      fn {id, _}, graph -> Graph.add_edge(graph, :root, id, label: key) end
    )
  end

  defp maybe_fill_first_graph_layer(%Graph{} = graph, %Layer{}, _), do: graph

  @spec parent_pseudo_join(Layer.t(), [[String.t(), ...]] | nil) :: iodata()
  defp parent_pseudo_join(%Layer{direction: :first_layer}, nil), do: nil

  defp parent_pseudo_join(%Layer{} = layer, value_list) when is_list(value_list) do
    columns =
      case layer do
        %Layer{direction: :one_to_many, fk: fk} -> fk
        %Layer{direction: :many_to_one, target_pk: pk} -> pk
      end

    matches = Enum.map_intersperse(value_list, ", ", &[?(, wrap_values(&1), ?)])

    [
      ?(,
      Enum.map_intersperse(columns, ", ", &["this.", ?", &1, ?"]),
      ") IN (",
      matches,
      ?)
    ]
  end

  defp wrap_values(value_list), do: Enum.map(value_list, &quote_escape/1)
  defp quote_escape(nil), do: "NULL"
  defp quote_escape(str), do: [?', :binary.replace(str, "'", "''"), ?']

  # TODO: This uses implicit knowledge of graph vertex generation, should be extracted to the same point where id generation lies
  @spec get_join_values(Layer.t(), [map()]) :: [[String.t(), ...]]
  defp get_join_values(%Layer{direction: :one_to_many, source_pk: _cols}, records),
    do: Enum.map(records, &elem(elem(&1, 0), 1))

  defp get_join_values(%Layer{direction: :many_to_one, fk: cols}, records),
    do: Enum.map(records, &record_to_key(elem(&1, 1), cols))

  defp fill_graph(
         graph,
         %Layer{direction: :one_to_many} = layer,
         _source_changes,
         target_changes
       ) do
    target_changes
    |> Enum.reduce(graph, fn {target_node, change}, graph ->
      source_node = ChangeProcessing.id(change.record, layer.source_table, layer.fk)

      Graph.add_edge(graph, source_node, target_node, label: layer.key)
    end)
  end

  # `where_target: nil` should be guaranteed by the layer validation for now, but it's included in the guard here in case we lift the constraint later, since it's an assumption here.
  defp fill_graph(
         graph,
         %Layer{direction: :many_to_one, fk: fk, where_target: nil} = layer,
         source_changes,
         _target_changes
       ) do
    # Here we're adding mappings based on the "source" from which we're traversing, since it's guaranteed
    # that non-null FKs do exist by FK constraints on the database + lack of where clauses over the "-to-one" tables.
    source_changes
    |> Stream.reject(&columns_are_nil?(elem(&1, 1), fk))
    |> Enum.reduce(graph, fn {source_node, change}, graph ->
      target_node = ChangeProcessing.id(change.record, layer.target_table, layer.fk)

      Graph.add_edge(graph, source_node, target_node, label: layer.key)
    end)
  end

  # We're very slightly optimizing a single-column case because it's more common than multicolumn PKs and FKs
  @spec record_to_key(Changes.NewRecord.t(), [String.t(), ...]) :: [String.t(), ...]
  defp record_to_key(%Changes.NewRecord{record: record}, [key]),
    do: [Map.fetch!(record, key)]

  defp record_to_key(%Changes.NewRecord{record: record}, key) when is_list(key),
    do: Enum.map(key, &Map.fetch!(record, &1))

  # We're very slightly optimizing a single-column case because it's more common than multicolumn PKs and FKs
  defp columns_are_nil?(%Changes.NewRecord{record: record}, [key]),
    do: is_nil(Map.fetch!(record, key))

  defp columns_are_nil?(%Changes.NewRecord{record: record}, key),
    do: Enum.any?(key, &is_nil(Map.fetch!(record, &1)))

  @spec rows_to_changes_with_tags([tuple()], [String.t(), ...], Layer.t(), String.t()) ::
          [{Layer.graph_key(), Changes.NewRecord.t()}]
  defp rows_to_changes_with_tags(
         rows,
         col_names,
         %Layer{target_table: relation, target_pk: pk_cols},
         origin
       )
       when is_list(rows) do
    Enum.map(rows, fn row_tuple ->
      [tags | values] = Tuple.to_list(row_tuple)
      record = Map.new(Enum.zip(col_names, values))

      {ChangeProcessing.id(record, relation, pk_cols),
       %Changes.NewRecord{
         relation: relation,
         record: record,
         tags: ShadowTableTransformation.convert_tag_list_pg_to_satellite(tags, origin)
       }}
    end)
  end

  defp context_filters(%Replication.Table{} = table, context, %Layer{} = _layer) do
    ownership_column = Ownership.id_column_name()

    if context[:user_id] && Enum.any?(table.columns, &(&1.name == ownership_column)) do
      escaped = :binary.replace(context[:user_id], "'", "''")

      ["this.", ownership_column, " = '", escaped, ?']
    end
  end
end
