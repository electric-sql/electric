defmodule Electric.Shapes.Querying do
  alias Electric.Replication.Eval.Parser.Func
  alias Electric.Replication.Eval.SqlGenerator
  alias Electric.ShapeCache.LogChunker
  alias Electric.Shapes.DnfPlan
  alias Electric.Shapes.Shape
  alias Electric.Shapes.SubqueryTags
  alias Electric.Telemetry.OpenTelemetry
  alias Electric.Utils

  @value_prefix SubqueryTags.value_prefix()
  @null_sentinel SubqueryTags.null_sentinel()

  def query_move_in(conn, stack_id, shape_handle, shape, {where, params}, opts \\ []) do
    table = Utils.relation_to_sql(shape.root_table)

    metadata =
      metadata_sql(
        shape,
        stack_id,
        shape_handle,
        opts |> Keyword.put(:start_param_idx, length(params) + 1)
      )

    {json_like_select, metadata_params} =
      json_like_select(shape, %{"is_move_in" => true}, stack_id, shape_handle, metadata)

    key_select = key_select(shape)
    tag_select = Enum.join(metadata.tags_sqls, ", ")

    query =
      Postgrex.prepare!(
        conn,
        table,
        ~s|SELECT #{key_select}, ARRAY[#{tag_select}]::text[], #{json_like_select} FROM #{table} WHERE #{where}|
      )

    Postgrex.stream(conn, query, params ++ metadata_params)
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

    metadata = metadata_sql(shape, stack_id, shape_handle)

    {json_like_select, params} =
      json_like_select(shape, headers, stack_id, shape_handle, metadata)

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

      metadata = metadata_sql(shape, stack_id, shape_handle)
      {json_like_select, params} = json_like_select(shape, [], stack_id, shape_handle, metadata)

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
  # - it's up to the caller to interpolate them into the query correctly
  defp make_tags(%Shape{tag_structure: tag_structure}, stack_id, shape_handle) do
    Enum.map(tag_structure, fn pattern ->
      Enum.map(pattern, fn
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

  defp json_like_select(
         %Shape{
           root_table: root_table,
           selected_columns: columns
         } = shape,
         additional_headers,
         _stack_id,
         _shape_handle,
         metadata
       ) do
    key_part = build_key_part(shape)
    value_part = build_value_part(columns)
    headers_part = build_headers_part(root_table, additional_headers, metadata)

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

    {query, metadata.params}
  end

  defp build_headers_part(rel, headers, metadata) when is_list(headers),
    do: build_headers_part(rel, Map.new(headers), metadata)

  defp build_headers_part({relation, table}, additional_headers, metadata) do
    headers = %{operation: "insert", relation: [relation, table]}

    headers =
      headers
      |> Map.merge(additional_headers)
      |> Jason.encode!()
      |> Utils.escape_quotes(?')

    headers =
      if metadata.tags_sqls != [] do
        "{" <> json = headers

        ~s/{"active_conditions":#{active_conditions_json_expr(metadata)},"tags":#{tags_json_expr(metadata.tags_sqls)},/ <>
          json
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

  defp pg_cast_column_to_text(column) do
    escaped = Utils.escape_quotes(column)
    col = ~s["#{escaped}"]
    # In PostgreSQL, casting bpchar (char(n)) to text strips trailing spaces.
    # Use concat() for bpchar columns to preserve the space padding, since
    # concat() converts its argument to text without trimming.
    ~s[CASE WHEN #{col} IS NULL THEN NULL::text WHEN pg_typeof(#{col}) = 'character'::regtype THEN concat(#{col}, '') ELSE #{col}::text END]
  end

  defp pg_escape_string_for_json(str), do: ~s[to_json(#{str})::text]
  defp pg_coalesce_json_string(str), do: ~s[coalesce(#{str} , 'null')]

  defp metadata_sql(shape, stack_id, shape_handle, opts \\ []) do
    case dnf_plan_for_metadata(shape, opts) do
      %DnfPlan{} = plan ->
        tags_sqls = tags_sql(plan, stack_id, shape_handle)

        {active_conditions_sqls, params} =
          case Keyword.get(opts, :views) do
            nil ->
              {active_conditions_sql(plan), []}

            views ->
              {sqls, params, _next_idx} =
                active_conditions_sql_for_views(
                  plan,
                  views,
                  shape.where.used_refs,
                  Keyword.get(opts, :start_param_idx, 1)
                )

              {sqls, params}
          end

        %{tags_sqls: tags_sqls, active_conditions_sqls: active_conditions_sqls, params: params}

      nil ->
        %{
          tags_sqls: make_tags(shape, stack_id, shape_handle),
          active_conditions_sqls: nil,
          params: []
        }
    end
  end

  defp dnf_plan_for_metadata(shape, opts) do
    case Keyword.get(opts, :dnf_plan) do
      %DnfPlan{} = plan ->
        plan

      nil ->
        if shape.shape_dependencies == [] do
          nil
        else
          {:ok, %DnfPlan{} = plan} = DnfPlan.compile(shape)
          plan
        end
    end
  end

  def move_in_where_clause(plan, dep_index, move_in_values, views, used_refs) do
    impacted = Map.get(plan.dependency_disjuncts, dep_index, [])
    all_idxs = Enum.to_list(0..(length(plan.disjuncts) - 1))
    unaffected = all_idxs -- impacted

    {candidate_sql, candidate_params, next_param} =
      build_disjuncts_sql(
        plan,
        impacted,
        dep_index,
        move_in_values,
        views,
        used_refs,
        1,
        ignore_trigger_polarity?: true
      )

    {exclusion_sql, exclusion_params, _} =
      build_disjuncts_sql(
        plan,
        unaffected,
        nil,
        nil,
        views,
        used_refs,
        next_param,
        ignore_trigger_polarity?: false
      )

    where =
      case exclusion_sql do
        nil -> candidate_sql
        excl -> "(#{candidate_sql}) AND NOT (#{excl})"
      end

    {where, candidate_params ++ exclusion_params}
  end

  def active_conditions_sql(plan) do
    Enum.map(0..(plan.position_count - 1), fn pos ->
      info = plan.positions[pos]
      base_sql = info.sql

      if info.negated do
        "(NOT COALESCE((#{base_sql})::boolean, false))::boolean"
      else
        "COALESCE((#{base_sql})::boolean, false)"
      end
    end)
  end

  def active_conditions_sql_for_views(plan, views, used_refs, start_param_idx \\ 1) do
    {sqls, params, next_param_idx} =
      Enum.reduce(0..(plan.position_count - 1), {[], [], start_param_idx}, fn pos,
                                                                              {sqls, params,
                                                                               param_idx} ->
        info = Map.fetch!(plan.positions, pos)

        {base_sql, sql_params, next_param_idx} =
          position_to_sql(info, nil, nil, views, used_refs, param_idx)

        sql =
          if info.negated do
            "(NOT COALESCE((#{base_sql})::boolean, false))::boolean"
          else
            "COALESCE((#{base_sql})::boolean, false)"
          end

        {[sql | sqls], params ++ sql_params, next_param_idx}
      end)

    {Enum.reverse(sqls), params, next_param_idx}
  end

  def tags_sql(plan, stack_id, shape_handle) do
    Enum.map(plan.disjuncts, fn conj ->
      positions_in_disjunct = MapSet.new(conj, &elem(&1, 0))

      slot_sqls =
        Enum.map(0..(plan.position_count - 1), fn pos ->
          if MapSet.member?(positions_in_disjunct, pos) do
            tag_slot_sql(plan.positions[pos], stack_id, shape_handle)
          else
            "''"
          end
        end)

      Enum.join(slot_sqls, " || '/' || ")
    end)
  end

  defp build_disjuncts_sql(
         _plan,
         [],
         _trigger_dep,
         _trigger_vals,
         _views,
         _used_refs,
         pidx,
         _opts
       ) do
    {nil, [], pidx}
  end

  defp build_disjuncts_sql(
         plan,
         disjunct_idxs,
         trigger_dep,
         trigger_vals,
         views,
         used_refs,
         pidx,
         opts
       ) do
    {sqls, params, next_pidx} =
      Enum.reduce(disjunct_idxs, {[], [], pidx}, fn didx, {sqls, params, pi} ->
        conj = Enum.at(plan.disjuncts, didx)

        {conj_sql, conj_params, next_pi} =
          build_conjunction_sql(
            plan,
            conj,
            trigger_dep,
            trigger_vals,
            views,
            used_refs,
            pi,
            opts
          )

        {[conj_sql | sqls], params ++ conj_params, next_pi}
      end)

    sql =
      case Enum.reverse(sqls) do
        [single] -> single
        multiple -> Enum.map_join(multiple, " OR ", &"(#{&1})")
      end

    {sql, params, next_pidx}
  end

  defp build_conjunction_sql(
         plan,
         conj,
         trigger_dep,
         trigger_vals,
         views,
         used_refs,
         pidx,
         opts
       ) do
    {parts, params, next_pi} =
      Enum.reduce(conj, {[], [], pidx}, fn {pos, polarity}, {parts, params, pi} ->
        info = plan.positions[pos]

        {sql, ps, next_pi} =
          position_to_sql(info, trigger_dep, trigger_vals, views, used_refs, pi)

        sql =
          if polarity == :negated and not ignore_polarity_for_trigger?(info, trigger_dep, opts) do
            "NOT (#{sql})"
          else
            sql
          end

        {[sql | parts], params ++ ps, next_pi}
      end)

    sql = parts |> Enum.reverse() |> Enum.join(" AND ")
    {sql, params, next_pi}
  end

  defp position_to_sql(%{is_subquery: false} = info, _, _, _, _, pidx) do
    {info.sql, [], pidx}
  end

  defp position_to_sql(
         %{is_subquery: true, dependency_index: dep_idx} = info,
         trigger_dep,
         trigger_vals,
         views,
         used_refs,
         pidx
       ) do
    lhs_sql = lhs_sql_from_ast(info.ast)
    ref_type = Map.get(used_refs, info.subquery_ref)

    values =
      if dep_idx == trigger_dep and trigger_vals != nil do
        trigger_vals
      else
        Map.get(views, info.subquery_ref, MapSet.new()) |> MapSet.to_list()
      end

    case ref_type do
      {:array, {:row, col_types}} ->
        casts = Enum.map(col_types, &Electric.Replication.Eval.type_to_pg_cast/1)

        params =
          case values do
            [] ->
              Enum.map(casts, fn _ -> [] end)

            _ ->
              values
              |> Utils.unzip_any()
              |> Tuple.to_list()
              |> Enum.zip(col_types)
              |> Enum.map(fn {col_vals, col_type} ->
                Enum.map(col_vals, &value_to_postgrex(&1, col_type))
              end)
          end

        sql =
          casts
          |> Enum.with_index(pidx)
          |> Enum.map_join(", ", fn {col, index} -> "$#{index}::#{col}[]" end)
          |> then(&"#{lhs_sql} IN (SELECT * FROM unnest(#{&1}))")

        {sql, params, pidx + length(casts)}

      {:array, element_type} ->
        type_cast = Electric.Replication.Eval.type_to_pg_cast(element_type)
        sql = "#{lhs_sql} = ANY ($#{pidx}::#{type_cast}[])"
        {sql, [Enum.map(values, &value_to_postgrex(&1, element_type))], pidx + 1}
    end
  end

  defp value_to_postgrex(value, type) do
    Electric.Replication.Eval.value_to_postgrex(value, type)
  end

  defp lhs_sql_from_ast(%Func{name: "sublink_membership_check", args: [testexpr, _]}) do
    SqlGenerator.to_sql(testexpr)
  end

  defp tag_slot_sql(%{is_subquery: true, tag_columns: [col]}, stack_id, shape_handle) do
    col_sql = ~s["#{col}"::text]
    namespaced = pg_namespace_value_sql(col_sql)
    ~s[md5('#{stack_id}#{shape_handle}' || #{namespaced})]
  end

  defp tag_slot_sql(
         %{is_subquery: true, tag_columns: {:hash_together, cols}},
         stack_id,
         shape_handle
       ) do
    column_parts =
      Enum.map(cols, fn col_name ->
        col = ~s["#{col_name}"::text]
        ~s['#{col_name}:' || #{pg_namespace_value_sql(col)}]
      end)

    ~s[md5('#{stack_id}#{shape_handle}' || #{Enum.join(column_parts, " || ")})]
  end

  defp tag_slot_sql(%{is_subquery: false}, _stack_id, _shape_handle) do
    "'1'"
  end

  defp ignore_polarity_for_trigger?(info, trigger_dep, opts) do
    Keyword.get(opts, :ignore_trigger_polarity?, false) and info.is_subquery and
      info.dependency_index == trigger_dep
  end

  defp active_conditions_json_expr(%{active_conditions_sqls: nil, tags_sqls: tags_sqls}) do
    List.duplicate(true, length(tags_sqls)) |> Jason.encode!()
  end

  defp active_conditions_json_expr(%{active_conditions_sqls: sqls}) do
    "' || to_json(ARRAY[" <> Enum.join(sqls, ", ") <> "]::boolean[])::text || '"
  end

  defp tags_json_expr(tags_sqls) do
    "' || to_json(ARRAY[" <> Enum.join(tags_sqls, ", ") <> "]::text[])::text || '"
  end

  # Generates SQL to namespace a value for tag hashing.
  # This MUST produce identical output to SubqueryTags.namespace_value/1 for
  # the same input values, or Elixir-side and SQL-side tag computation will diverge.
  defp pg_namespace_value_sql(col_sql) do
    ~s[CASE WHEN #{col_sql} IS NULL THEN '#{@null_sentinel}' ELSE '#{@value_prefix}' || #{col_sql} END]
  end
end
