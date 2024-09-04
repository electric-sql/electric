defmodule Electric.Shapes.Querying do
  alias Electric.Replication.LogOffset
  alias Electric.Utils
  alias Electric.Shapes.Shape
  alias Electric.Telemetry.OpenTelemetry

  @doc """
  Streams the initial data for a shape. Query results are returned as a stream of JSON strings, as prepared on PostgreSQL.
  """
  @type json_iodata :: iodata()

  @type json_result_stream :: Enumerable.t(json_iodata())

  @spec stream_initial_data(DBConnection.t(), Shape.t()) :: json_result_stream()
  def stream_initial_data(conn, %Shape{root_table: root_table, table_info: table_info} = shape) do
    OpenTelemetry.with_span("querying.stream_initial_data", [], fn ->
      table = Utils.relation_to_sql(root_table)

      where =
        if not is_nil(shape.where), do: " WHERE " <> shape.where.query, else: ""

      {json_like_select, params} = json_like_select(table_info, root_table, Shape.pk(shape))

      query =
        Postgrex.prepare!(conn, table, ~s|SELECT #{json_like_select} FROM #{table} #{where}|)

      Postgrex.stream(conn, query, params)
      |> Stream.flat_map(& &1.rows)
      |> Stream.map(&hd/1)
    end)
  end

  defp json_like_select(table_info, root_table, pk_cols) do
    columns = get_column_names(table_info, root_table)

    key_part = build_key_part(root_table, pk_cols)
    value_part = build_value_part(columns)
    headers_part = build_headers_part(root_table)
    offset_part = ~s['"offset":"#{LogOffset.first()}"']

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
    #   "headers": {"operation": "insert", "relation": ["public", "test_table"]},
    #   "offset": "0_0"
    # }
    query =
      ~s['{' || #{key_part} || ',' || #{value_part} || ',' || #{headers_part} || ',' || #{offset_part} || '}']

    {query, []}
  end

  defp get_column_names(table_info, root_table) do
    table_info
    |> Map.fetch!(root_table)
    |> Map.fetch!(:columns)
    |> Enum.map(& &1.name)
  end

  defp build_headers_part(root_table) do
    ~s['"headers":{"operation":"insert","relation":#{build_relation_header(root_table)}}']
  end

  defp build_relation_header({schema, table}) do
    ~s'["#{escape_sql_json_interpolation(schema)}","#{escape_sql_json_interpolation(table)}"]'
  end

  defp build_key_part(root_table, pk_cols) do
    pk_part = join_primary_keys(pk_cols)

    # Because relation part of the key is known at query building time, we can use $1 to inject escaped version of the relation
    ~s['"key":' || ] <>
      pg_escape_string_for_json(~s['#{escape_relation(root_table)}' || '/"' || #{pk_part} || '"'])
  end

  defp join_primary_keys(pk_cols) do
    pk_cols
    |> Enum.map(&pg_cast_column_to_text/1)
    |> Enum.map(&~s[replace(#{&1}, '/', '//')])
    # NULL values are not allowed in PKs, but they are possible on pk-less tables where we consider all columns to be PKs
    |> Enum.map(&~s[coalesce(#{&1}, '')])
    |> Enum.join(~s[ || '"/"' || ])
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
    relation |> Utils.relation_to_sql() |> String.replace(~S|'|, ~S|''|)
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
