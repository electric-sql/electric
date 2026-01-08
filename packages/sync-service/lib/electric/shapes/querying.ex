defmodule Electric.Shapes.Querying do
  alias Electric.ShapeCache.LogChunker
  alias Electric.Utils
  alias Electric.Shapes.Shape
  alias Electric.Telemetry.OpenTelemetry

  def query_move_in(conn, stack_id, shape_handle, shape, {where, params}, sublink_index \\ nil) do
    table = Utils.relation_to_sql(shape.root_table)

    # Pass sublink_index to filter tags in both the JSON headers and the tags array
    # This prevents "phantom" tags for other dependencies in OR-combined subqueries
    {json_like_select, _} =
      json_like_select(shape, %{"is_move_in" => true}, stack_id, shape_handle, sublink_index)

    key_select = key_select(shape)
    tag_select = make_tags(shape, stack_id, shape_handle, sublink_index) |> Enum.join(", ")

    query =
      Postgrex.prepare!(
        conn,
        table,
        ~s|SELECT #{key_select}, ARRAY[#{tag_select}]::text[], #{json_like_select} FROM #{table} WHERE #{where}|
      )

    Postgrex.stream(conn, query, params)
    |> Stream.flat_map(& &1.rows)
  end

  def query_subset(conn, stack_id, shape_handle, shape, subset, headers \\ []) do
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

    {json_like_select, params} = json_like_select(shape, headers, stack_id, shape_handle)

    query =
      Postgrex.prepare!(
        conn,
        table,
        ~s|SELECT #{json_like_select} FROM #{table} #{where} #{order_by} #{limit} #{offset}|
      )

    Postgrex.stream(conn, query, params)
    |> Stream.flat_map(& &1.rows)
  rescue
    e in Postgrex.Error ->
      case e.postgres do
        # invalid_text_representation - e.g. invalid enum value
        %{code: :invalid_text_representation, message: message} ->
          # This is a type of error we expect, because we allow enums in subset where clauses
          # even though we can't validate them fully.
          raise __MODULE__.QueryError, message: message

        _ ->
          reraise e, __STACKTRACE__
      end
  end

  defmodule QueryError do
    defexception [:message]
  end

  @doc """
  Streams the initial data for a shape. Query results are returned as a stream of JSON strings, as prepared on PostgreSQL.
  """
  @type json_iodata :: iodata()

  @type json_result_stream :: Enumerable.t(json_iodata())

  @spec stream_initial_data(
          DBConnection.t(),
          String.t(),
          String.t(),
          Shape.t(),
          non_neg_integer()
        ) ::
          json_result_stream()
  def stream_initial_data(
        conn,
        stack_id,
        shape_handle,
        shape,
        chunk_bytes_threshold \\ LogChunker.default_chunk_size_threshold()
      )

  def stream_initial_data(_, _, _, %Shape{log_mode: :changes_only}, _chunk_bytes_threshold) do
    []
  end

  def stream_initial_data(
        conn,
        stack_id,
        shape_handle,
        %Shape{root_table: root_table} = shape,
        chunk_bytes_threshold
      ) do
    OpenTelemetry.with_span("shape_read.stream_initial_data", [], stack_id, fn ->
      table = Utils.relation_to_sql(root_table)

      where =
        if not is_nil(shape.where), do: " WHERE " <> shape.where.query, else: ""

      {json_like_select, params} = json_like_select(shape, [], stack_id, shape_handle)

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

  # Converts a tag structure to something PG select can fill, but returns a list of separate strings for each tag
  # Generate tag expressions for SQL queries.
  # For shapes with DNF structure, generates DNF-based tags: "d{index}:{value_parts_base64}:{hash}"
  # Falls back to legacy format for shapes without DNF structure.
  # only_sublink_index: if provided, only generates tags for disjuncts containing that dependency
  #
  # IMPORTANT: When a disjunct has a non-sublink predicate (predicate_sql), we wrap the tag
  # expression in a CASE WHEN to ensure rows only get tags for disjuncts they actually satisfy.
  # This prevents "phantom" tags that would keep rows alive after move-outs.
  defp make_tags(%Shape{dnf_structure: dnf_structure} = _shape, stack_id, shape_handle, only_sublink_index)
       when dnf_structure != [] do
    # DNF-based tags: one tag per disjunct that matches the filter AND has sublinks
    # Disjuncts without sublinks (e.g., plain conditions like "flag = true") don't generate tags
    dnf_structure
    |> Enum.with_index()
    |> Enum.filter(fn {disjunct, _idx} ->
      # Must have at least one sublink
      disjunct.sublinks != [] and
        (is_nil(only_sublink_index) or ["$sublink", only_sublink_index] in disjunct.sublinks)
    end)
    |> Enum.map(fn {disjunct, disjunct_index} ->
      # Build value_parts expression: "0:val1/1:val2" (sorted by sublink ref)
      value_parts_expr =
        disjunct.sublinks
        |> Enum.sort()
        |> Enum.map(fn sublink_ref ->
          pattern = Map.get(disjunct.patterns, sublink_ref, [])
          sublink_index = List.last(sublink_ref)
          make_sublink_value_expr(sublink_index, pattern)
        end)
        |> Enum.join(" || '/' || ")

      # Tag format: d{index}:{value_parts_base64}:{hash}
      # The hash is md5(stack_id || shape_handle || "disjunct:" || disjunct_index || ":" || value_parts)
      hash_expr = ~s[md5('#{stack_id}#{shape_handle}disjunct:#{disjunct_index}:' || (#{value_parts_expr}))]

      # encode() with 'base64url' encoding (matching Base.url_encode64)
      # Note: PostgreSQL's encode(x, 'base64') uses standard base64, but we need URL-safe.
      # We use replace to convert + -> - and / -> _
      base64_expr = ~s[replace(replace(rtrim(encode((#{value_parts_expr})::bytea, 'base64'), '='), '+', '-'), '/', '_')]

      tag_expr = ~s['d#{disjunct_index}:' || #{base64_expr} || ':' || #{hash_expr}]

      # If this disjunct has a non-sublink predicate, wrap the tag with CASE WHEN
      # This ensures rows only get tags for disjuncts whose predicates they satisfy
      case disjunct.predicate_sql do
        nil ->
          tag_expr

        predicate_sql ->
          ~s[CASE WHEN (#{predicate_sql}) THEN #{tag_expr} ELSE NULL END]
      end
    end)
  end

  # Legacy format for shapes without DNF structure
  defp make_tags(%Shape{tag_structure: tag_structure}, stack_id, shape_handle, only_sublink_index) do
    tag_structure
    |> Enum.filter(fn {["$sublink", idx], _} ->
      is_nil(only_sublink_index) or idx == only_sublink_index
    end)
    |> Enum.flat_map(fn {["$sublink", sublink_index], pattern} ->
      # Each pattern produces one tag string
      # The hash must include the sublink index to match SubqueryMoves.make_value_hash
      Enum.map(pattern, fn
        column_name when is_binary(column_name) ->
          ~s[md5('#{stack_id}#{shape_handle}sublink:#{sublink_index}:' || #{pg_cast_column_to_text(column_name)})]

        {:hash_together, columns} ->
          column_parts = Enum.map(columns, &~s['#{&1}:' || #{pg_cast_column_to_text(&1)}])
          ~s[md5('#{stack_id}#{shape_handle}sublink:#{sublink_index}:' || #{Enum.join(column_parts, " || ':'|| ")})]
      end)
    end)
  end

  # Build SQL expression for a sublink's value part: "{sublink_index}:{value}"
  defp make_sublink_value_expr(sublink_index, pattern) do
    Enum.map(pattern, fn
      column_name when is_binary(column_name) ->
        ~s['#{sublink_index}:' || #{pg_cast_column_to_text(column_name)}]

      {:hash_together, columns} ->
        column_parts = Enum.map(columns, &pg_cast_column_to_text/1)
        ~s['#{sublink_index}:' || #{Enum.join(column_parts, " || ':' || ")}]
    end)
    |> Enum.join(" || ")
  end

  defp json_like_select(
         %Shape{
           root_table: root_table,
           selected_columns: columns
         } = shape,
         additional_headers,
         stack_id,
         shape_handle,
         only_sublink_index \\ nil
       ) do
    tags = make_tags(shape, stack_id, shape_handle, only_sublink_index)
    key_part = build_key_part(shape)
    value_part = build_value_part(columns)
    headers_part = build_headers_part(root_table, additional_headers, tags)

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

  defp build_headers_part(rel, headers, tags) when is_list(headers),
    do: build_headers_part(rel, Map.new(headers), tags)

  defp build_headers_part({relation, table}, additional_headers, tags) do
    headers = %{operation: "insert", relation: [relation, table]}

    headers =
      headers
      |> Map.merge(additional_headers)
      |> Jason.encode!()
      |> Utils.escape_quotes(?')

    headers =
      if tags != [] do
        "{" <> json = headers

        # Use array_to_json with array_remove to filter out NULL tags.
        # This handles CASE WHEN ... ELSE NULL END expressions from predicate-conditional tags.
        # We use array_to_json instead of string concatenation because NULL in string concat
        # would make the entire result NULL.
        tags_array = Enum.join(tags, ", ")
        ~s/{"tags":' || array_to_json(array_remove(ARRAY[#{tags_array}], NULL)) || ',/ <> json
      else
        headers
      end

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
