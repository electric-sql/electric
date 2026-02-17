defmodule Electric.Shapes.Querying do
  alias Electric.ShapeCache.LogChunker
  alias Electric.Utils
  alias Electric.Shapes.Shape
  alias Electric.Shapes.Shape.SubqueryMoves
  alias Electric.Shapes.Consumer.DnfContext
  alias Electric.Replication.Eval.SqlGenerator
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
  # - it's up to the caller to interpolate them into the query correctly.
  # For DNF shapes, each disjunct pattern may contain nil entries for positions not in that disjunct.
  # These become empty strings in the slash-delimited wire format.
  defp make_tags(%Shape{tag_structure: tag_structure}, stack_id, shape_handle) do
    Enum.map(tag_structure, fn pattern ->
      Enum.map(pattern, fn
        nil ->
          "''"

        column_name when is_binary(column_name) ->
          col = pg_cast_column_to_text(column_name)
          namespaced = pg_namespace_value_sql(col)
          ~s[md5('#{stack_id}#{shape_handle}' || #{namespaced})]

        {:hash_together, columns} ->
          column_parts =
            Enum.map(columns, fn col_name ->
              col = pg_cast_column_to_text(col_name)
              ~s['#{col_name}:' || #{pg_namespace_value_sql(col)}]
            end)

          ~s[md5('#{stack_id}#{shape_handle}' || #{Enum.join(column_parts, " || ")})]
      end)
      |> Enum.join("|| '/' ||")
    end)
  end

  defp json_like_select(shape, additional_headers, stack_id, shape_handle, dnf_context \\ nil)

  defp json_like_select(
         %Shape{
           root_table: root_table,
           selected_columns: columns
         } = shape,
         additional_headers,
         stack_id,
         shape_handle,
         dnf_context
       ) do
    tags = make_tags(shape, stack_id, shape_handle)
    key_part = build_key_part(shape)
    value_part = build_value_part(columns)

    active_conditions_sql =
      build_active_conditions_sql(dnf_context, shape)

    headers_part = build_headers_part(root_table, additional_headers, tags, active_conditions_sql)

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

  defp build_headers_part(rel, headers, tags, active_conditions_sql) when is_list(headers),
    do: build_headers_part(rel, Map.new(headers), tags, active_conditions_sql)

  defp build_headers_part({relation, table}, additional_headers, tags, active_conditions_sql) do
    headers = %{operation: "insert", relation: [relation, table]}

    headers =
      headers
      |> Map.merge(additional_headers)
      |> Jason.encode!()
      |> Utils.escape_quotes(?')

    headers =
      if tags != [] do
        "{" <> json = headers

        tags = Enum.join(tags, ~s[ || '","' || ])
        ~s/{"tags":["' || #{tags} || '"],/ <> json
      else
        headers
      end

    # Inject active_conditions into the JSON if present
    headers =
      if active_conditions_sql do
        # Insert before the closing }
        # headers looks like: '..."relation":["public","items"]}'
        # We want: '..."relation":["public","items"],"active_conditions":' || array_sql || '}'
        {prefix, "}"} = String.split_at(headers, -1)
        prefix <> ~s[,"active_conditions":' || #{active_conditions_sql} || '}']
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

  # Build a SQL expression that produces a JSON array of booleans for active_conditions.
  # Returns nil if no dnf_context or no positions.
  defp build_active_conditions_sql(nil, _shape), do: nil

  defp build_active_conditions_sql(
         %DnfContext{
           decomposition: %{subexpressions: subexpressions, position_count: position_count}
         },
         shape
       )
       when position_count > 0 do
    conditions =
      Enum.map(0..(position_count - 1)//1, fn pos ->
        subexpr = Map.fetch!(subexpressions, pos)

        sql =
          if subexpr.is_subquery do
            generate_subquery_condition_sql(
              subexpr,
              shape.subquery_comparison_expressions,
              shape.shape_dependencies
            )
          else
            SqlGenerator.to_sql(subexpr.ast)
          end

        # For negated positions, wrap in NOT
        if subexpr.negated, do: "(NOT #{sql})", else: sql
      end)

    # Produce JSON array like [true,false,true]
    # Use array_to_json to convert boolean[] to JSON text
    conditions_sql = Enum.join(conditions, ", ")
    "array_to_json(ARRAY[#{conditions_sql}]::boolean[])::text"
  end

  defp build_active_conditions_sql(_, _shape), do: nil

  # Generate SQL for a subquery condition, e.g.:
  #   ("parent_id" IN (SELECT id FROM parent WHERE category = 'a'))
  defp generate_subquery_condition_sql(subexpr, comparison_expressions, shape_dependencies) do
    sublink_index = SubqueryMoves.extract_sublink_index(subexpr.ast)
    dep_shape = if sublink_index, do: Enum.at(shape_dependencies, sublink_index)

    if dep_shape do
      subquery_section = rebuild_subquery_section(dep_shape)
      column_sql = get_column_sql_for_subexpr(comparison_expressions, sublink_index)
      ~s[(#{column_sql} #{subquery_section})]
    else
      raise "Could not resolve dependency shape for sublink index #{inspect(sublink_index)}"
    end
  end

  defp rebuild_subquery_section(dep_shape) do
    base =
      ~s|IN (SELECT #{Enum.join(dep_shape.explicitly_selected_columns, ", ")} FROM #{Utils.relation_to_sql(dep_shape.root_table)}|

    where = if dep_shape.where, do: " WHERE #{dep_shape.where.query}", else: ""
    base <> where <> ")"
  end

  defp get_column_sql_for_subexpr(comparison_expressions, dep_index) do
    key = ["$sublink", "#{dep_index}"]

    case Map.get(comparison_expressions, key) do
      nil -> raise "No comparison expression found for sublink index #{dep_index}"
      %Electric.Replication.Eval.Expr{eval: ast} -> SqlGenerator.to_sql(ast)
    end
  end
end
