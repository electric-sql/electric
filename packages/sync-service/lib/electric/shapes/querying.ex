defmodule Electric.Shapes.Querying do
  alias Electric.ShapeCache.LogChunker
  alias Electric.Utils
  alias Electric.Shapes.Shape
  alias Electric.Telemetry.OpenTelemetry

  def query_move_in(conn, shape, {where, params}) do
    table = Utils.relation_to_sql(shape.root_table)

    {json_like_select, _} = json_like_select(shape, %{"is_move_in" => true})
    key_select = key_select(shape)

    query =
      Postgrex.prepare!(
        conn,
        table,
        ~s|SELECT #{key_select}, #{json_like_select} FROM #{table} WHERE #{where}|
      )

    Postgrex.stream(conn, query, params)
    |> Stream.flat_map(& &1.rows)
  end

  def query_subset(conn, shape, subset, headers \\ []) do
    # When querying a subset, we select same columns as the base shape
    table = Utils.relation_to_sql(shape.root_table)

    where =
      case {shape.where, subset.where} do
        {nil, nil} ->
          ""

        {nil, %{query: where}} ->
          " WHERE " <> where

        {%{query: where}, nil} ->
          " WHERE " <> where

        {%{query: base_where}, %{query: where}} ->
          " WHERE " <> base_where <> " AND (" <> where <> ")"
      end

    order_by = if order_by = subset.order_by, do: " ORDER BY " <> order_by, else: ""
    limit = if limit = subset.limit, do: " LIMIT #{limit}", else: ""
    offset = if offset = subset.offset, do: " OFFSET #{offset}", else: ""

    {json_like_select, params} = json_like_select(shape, headers)

    query =
      Postgrex.prepare!(
        conn,
        table,
        ~s|SELECT #{json_like_select} FROM #{table} #{where} #{order_by} #{limit} #{offset}|
      )

    Postgrex.stream(conn, query, params)
    |> Stream.flat_map(& &1.rows)
  end

  @doc """
  Streams the initial data for a shape. Query results are returned as a stream of JSON strings, as prepared on PostgreSQL.
  """
  @type json_iodata :: iodata()

  @type json_result_stream :: Enumerable.t(json_iodata())

  @spec stream_initial_data(DBConnection.t(), String.t(), Shape.t(), non_neg_integer()) ::
          json_result_stream()
  def stream_initial_data(
        conn,
        stack_id,
        shape,
        chunk_bytes_threshold \\ LogChunker.default_chunk_size_threshold()
      )

  def stream_initial_data(_, _, %Shape{log_mode: :changes_only}, _chunk_bytes_threshold) do
    []
  end

  def stream_initial_data(
        conn,
        stack_id,
        %Shape{root_table: root_table} = shape,
        chunk_bytes_threshold
      ) do
    OpenTelemetry.with_span("shape_read.stream_initial_data", [], stack_id, fn ->
      table = Utils.relation_to_sql(root_table)

      where =
        if not is_nil(shape.where), do: " WHERE " <> shape.where.query, else: ""

      {json_like_select, params} = json_like_select(shape)

      query =
        Postgrex.prepare!(conn, table, ~s|SELECT #{json_like_select} FROM #{table} #{where}|)

      Postgrex.stream(conn, query, params)
      |> Stream.flat_map(& &1.rows)
      |> Stream.transform(0, fn [line], chunk_size ->
        # Reason to add 1 byte to expected length is to account for  `\n` breaks when the data is written.
        case LogChunker.fit_into_chunk(
               IO.iodata_length(line) + 1,
               chunk_size,
               chunk_bytes_threshold
             ) do
          {:ok, new_chunk_size} ->
            {[line], new_chunk_size}

          {:threshold_exceeded, new_chunk_size} ->
            {[line, :chunk_boundary], new_chunk_size}
        end
      end)
    end)
  end

  defp key_select(%Shape{root_table: root_table, root_pk: pk_cols}) do
    ~s['#{escape_relation(root_table)}' || '/' || #{join_primary_keys(pk_cols)}]
  end

  defp json_like_select(
         %Shape{
           root_table: root_table,
           selected_columns: columns
         } = shape,
         additional_headers \\ []
       ) do
    additional_headers =
      Shape.SubqueryMoves.move_in_tag_structure(shape)
      |> Electric.Utils.deep_map(fn column_name -> "$${#{column_name}}" end)
      |> case do
        [] -> additional_headers
        tag_structure -> additional_headers |> Map.new() |> Map.put(:tags, tag_structure)
      end

    key_part = build_key_part(shape)
    value_part = build_value_part(columns)
    headers_part = build_headers_part(root_table, additional_headers)

    # We're building a JSON string that looks like this:
    #
    # {
    #   "key": "\"public\".\"test_table\"/\"1\"",
    #   "value": {
    #     "id": "1",
    #     "name": "John Doe",
    #     "email": "john.doe@example.com",
    #     "nullable": null
    #   },
    #   "headers": {"operation": "insert", "relation": ["public", "test_table"]}
    # }
    query =
      ~s['{' || #{key_part} || ',' || #{value_part} || ',' || #{headers_part} || '}']

    {query, []}
  end

  defp build_headers_part(rel, headers) when is_list(headers),
    do: build_headers_part(rel, Map.new(headers))

  defp build_headers_part({relation, table}, additional_headers) do
    headers = %{operation: "insert", relation: [relation, table]}

    headers =
      headers
      |> Map.merge(additional_headers)
      |> Jason.encode!()
      |> Utils.escape_quotes(?')
      |> String.replace(~r/\$\$\{(\w+)\}/, ~s[' || \\1::text || '])

    ~s['"headers":#{headers}']
  end

  defp build_key_part(shape) do
    # Because relation part of the key is known at query building time, we can use $1 to inject escaped version of the relation
    ~s['"key":' || ] <> pg_escape_string_for_json(key_select(shape))
  end

  # This is a bespoke derivation of the record from its contents for Postgres but it must
  # exactly match the algorithm implemented in `Electric.Replication.Changes.build_key/3`.
  defp join_primary_keys(pk_cols) do
    pk_cols
    |> Enum.map(&pg_cast_column_to_text/1)
    |> Enum.map(&~s['"' || replace(#{&1}, '/', '//') || '"'])
    # NULL values are not allowed in PKs, but they are possible on pk-less tables where we consider all columns to be PKs
    |> Enum.map(&~s[coalesce(#{&1}, '_')])
    |> Enum.join(~s[ || '/' || ])
  end

  defp build_value_part(columns) do
    column_parts = Enum.map(columns, &build_column_part/1)
    ~s['"value":{' || #{Enum.join(column_parts, " || ',' || ")} || '}']
  end

  defp build_column_part(column) do
    escaped_name = escape_sql_json_interpolation(column)
    escaped_value = escape_column_value(column)

    # Since `||` returns NULL if any of the arguments is NULL, we need to use `coalesce` to handle NULL values
    ~s['"#{escaped_name}":' || #{pg_coalesce_json_string(escaped_value)}]
  end

  defp escape_sql_json_interpolation(str) do
    str
    |> String.replace(~S|"|, ~S|\"|)
    |> String.replace(~S|'|, ~S|''|)
  end

  defp escape_relation(relation) do
    relation |> Utils.relation_to_sql(true) |> String.replace(~S|'|, ~S|''|)
  end

  defp escape_column_value(column) do
    column
    |> pg_cast_column_to_text()
    |> pg_escape_string_for_json()
    |> pg_coalesce_json_string()
  end

  defp pg_cast_column_to_text(column), do: ~s["#{Utils.escape_quotes(column)}"::text]
  defp pg_escape_string_for_json(str), do: ~s[to_json(#{str})::text]
  defp pg_coalesce_json_string(str), do: ~s[coalesce(#{str} , 'null')]
end
