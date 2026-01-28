defmodule Electric.Shapes.Querying do
  alias Electric.ShapeCache.LogChunker
  alias Electric.Utils
  alias Electric.Shapes.Shape
  alias Electric.Shapes.Shape.SubqueryMoves
  alias Electric.Telemetry.OpenTelemetry

  @value_prefix SubqueryMoves.value_prefix()
  @null_sentinel SubqueryMoves.null_sentinel()

  def query_move_in(conn, stack_id, shape_handle, shape, {where, params}) do
    table = Utils.relation_to_sql(shape.root_table)

    {json_like_select, _} =
      json_like_select(shape, %{"is_move_in" => true}, stack_id, shape_handle)

    key_select = key_select(shape)
    tag_select = make_tags(shape, stack_id, shape_handle) |> Enum.join(", ")

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
        Postgrex.prepare!(
          conn,
          table,
          ~s|SELECT #{json_like_select} FROM #{table} #{where}|
        )

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
  # - it's up to the caller to interpolate them into the query correctly
  defp make_tags(%Shape{tag_structure: tag_structure}, stack_id, shape_handle) do
    # Escape single quotes for SQL string interpolation
    # Use to_string to handle nil values gracefully
    escaped_prefix = escape_sql_string(to_string(stack_id) <> to_string(shape_handle))

    Enum.map(tag_structure, fn pattern ->
      Enum.map(pattern, fn
        column_name when is_binary(column_name) ->
          col = pg_cast_column_to_text(column_name)
          namespaced = pg_namespace_value_sql(col)
          ~s[md5('#{escaped_prefix}' || #{namespaced})]

        {:hash_together, columns} ->
          column_parts =
            Enum.map(columns, fn col_name ->
              col = pg_cast_column_to_text(col_name)
              ~s['#{col_name}:' || #{pg_namespace_value_sql(col)}]
            end)

          ~s[md5('#{escaped_prefix}' || #{Enum.join(column_parts, " || ")})]
      end)
      |> Enum.join("|| '/' ||")
    end)
  end

  defp escape_sql_string(str), do: String.replace(str, "'", "''")

  # Generate SQL for active_conditions array for shapes with DNF decomposition
  defp make_active_conditions(%Shape{dnf_decomposition: nil}), do: nil
  defp make_active_conditions(%Shape{dnf_decomposition: %{has_subqueries: false}}), do: nil

  defp make_active_conditions(%Shape{
         dnf_decomposition: decomposition,
         shape_dependencies: shape_dependencies,
         subquery_comparison_expressions: comparison_expressions
       }) do
    position_count = decomposition.position_count

    if position_count == 0 do
      nil
    else
      # Generate SQL for each position
      conditions =
        Enum.map(0..(position_count - 1), fn position ->
          subexpr = Map.fetch!(decomposition.subexpressions, position)

          if subexpr.is_subquery do
            # For subquery positions, generate column IN (SELECT ...)
            generate_subquery_condition_sql(subexpr, comparison_expressions, shape_dependencies)
          else
            # For non-subquery positions, we need to evaluate the condition
            # Since rows in the result already satisfy the WHERE clause,
            # non-subquery AND conditions must be true.
            # For OR branches, we'd need the actual SQL which is complex.
            # For now, generate the SQL based on what we can determine.
            generate_non_subquery_condition_sql(subexpr)
          end
        end)

      # Build a JSON array: '[true,false,true]'
      # Using array_to_json for proper formatting
      ~s|array_to_json(ARRAY[#{Enum.join(conditions, ", ")}]::boolean[])::text|
    end
  end

  # Generate SQL for a subquery condition
  defp generate_subquery_condition_sql(subexpr, comparison_expressions, shape_dependencies) do
    # Find which sublink this corresponds to
    {sublink_index, _} =
      comparison_expressions
      |> Enum.find({0, nil}, fn {path, _testexpr} ->
        case path do
          ["$sublink", idx_str] ->
            idx = String.to_integer(idx_str)
            # Match by checking if the column matches
            dep_shape = Enum.at(shape_dependencies, idx)

            if dep_shape do
              column_matches?(subexpr, comparison_expressions, path)
            else
              false
            end

          _ ->
            false
        end
      end)
      |> then(fn
        {["$sublink", idx_str], _} -> {String.to_integer(idx_str), true}
        _ -> {0, false}
      end)

    # Get the dependency shape and build the subquery section
    dep_shape = Enum.at(shape_dependencies, sublink_index)

    if dep_shape do
      subquery_section = rebuild_subquery_section(dep_shape)
      column_sql = get_column_sql_for_subexpr(subexpr, comparison_expressions, sublink_index)

      # Check if this is a negated position
      if subexpr.negated do
        ~s[(NOT #{column_sql} #{subquery_section})]
      else
        ~s[(#{column_sql} #{subquery_section})]
      end
    else
      # Fallback - should not happen
      "true"
    end
  end

  # Check if a subexpression matches a sublink path
  defp column_matches?(subexpr, comparison_expressions, path) do
    case Map.get(comparison_expressions, path) do
      nil ->
        false

      %{eval: %Electric.Replication.Eval.Parser.Ref{path: [col_name]}} ->
        subexpr.column == col_name

      _ ->
        # For row expressions, just check if the column is non-nil
        subexpr.column != nil
    end
  end

  # Get the SQL for the column reference in a subexpression
  defp get_column_sql_for_subexpr(subexpr, comparison_expressions, sublink_index) do
    path = ["$sublink", "#{sublink_index}"]

    case Map.get(comparison_expressions, path) do
      %{eval: %Electric.Replication.Eval.Parser.Ref{path: [column_name]}} ->
        ~s["#{column_name}"]

      %{eval: %Electric.Replication.Eval.Parser.RowExpr{elements: elements}} ->
        columns =
          Enum.map(elements, fn
            %Electric.Replication.Eval.Parser.Ref{path: [col]} -> ~s["#{col}"]
            _ -> nil
          end)

        if Enum.any?(columns, &is_nil/1) do
          # Fallback to column from subexpr
          if subexpr.column, do: ~s["#{subexpr.column}"], else: "NULL"
        else
          "(#{Enum.join(columns, ", ")})"
        end

      _ ->
        # Fallback to column from subexpr
        if subexpr.column, do: ~s["#{subexpr.column}"], else: "NULL"
    end
  end

  # Generate SQL for a non-subquery condition
  # This is complex as we'd need to convert the AST back to SQL
  # For now, return true (since the row is in the result, the condition is satisfied)
  defp generate_non_subquery_condition_sql(_subexpr) do
    # Non-subquery conditions in the WHERE clause are already satisfied for returned rows
    # This is a simplification - for full accuracy we'd need AST-to-SQL conversion
    "true"
  end

  # Rebuild the SQL subquery section (IN (SELECT ... FROM ...))
  defp rebuild_subquery_section(shape) do
    base =
      ~s|IN (SELECT #{Enum.join(shape.explicitly_selected_columns, ", ")} FROM #{Utils.relation_to_sql(shape.root_table)}|

    where = if shape.where, do: " WHERE #{shape.where.query}", else: ""
    base <> where <> ")"
  end

  defp json_like_select(
         %Shape{
           root_table: root_table,
           selected_columns: columns
         } = shape,
         additional_headers,
         stack_id,
         shape_handle
       ) do
    tags = make_tags(shape, stack_id, shape_handle)
    active_conditions = make_active_conditions(shape)
    key_part = build_key_part(shape)
    value_part = build_value_part(columns)
    headers_part = build_headers_part(root_table, additional_headers, tags, active_conditions)

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

  defp build_headers_part(rel, headers, tags, active_conditions) when is_list(headers),
    do: build_headers_part(rel, Map.new(headers), tags, active_conditions)

  defp build_headers_part({relation, table}, additional_headers, tags, active_conditions) do
    headers = %{operation: "insert", relation: [relation, table]}

    headers =
      headers
      |> Map.merge(additional_headers)
      |> Jason.encode!()
      |> Utils.escape_quotes(?')

    # Add tags if present
    headers =
      if tags != [] do
        "{" <> json = headers

        tags = Enum.join(tags, ~s[ || '","' || ])
        ~s/{"tags":["' || #{tags} || '"],/ <> json
      else
        headers
      end

    # Add active_conditions if present
    headers =
      if active_conditions != nil do
        "{" <> json = headers
        # active_conditions is a SQL expression that evaluates to a JSON array
        ~s/{"active_conditions":' || #{active_conditions} || ',/ <> json
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

  # Generates SQL to namespace a value for tag hashing.
  # This MUST produce identical output to SubqueryMoves.namespace_value/1 for
  # the same input values, or Elixir-side and SQL-side tag computation will diverge.
  defp pg_namespace_value_sql(col_sql) do
    ~s[CASE WHEN #{col_sql} IS NULL THEN '#{@null_sentinel}' ELSE '#{@value_prefix}' || #{col_sql} END]
  end
end
