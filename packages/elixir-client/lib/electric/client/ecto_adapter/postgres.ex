if Code.ensure_loaded?(Ecto) do
  defmodule Electric.Client.EctoAdapter.Postgres do
    @moduledoc false

    # This is a horrendously hacked-at version of
    # `Ecto.Adapters.Postgres.Connection` which just contains the query
    # generation for simple WHERE clauses.
    #
    # Because only the top-level query generation code is behind a public API
    # and the alternative was to use the full query generation code then
    # somehow parse out just the `WHERE` clause, this seems like the best
    # option until we come up with something better.
    #
    # Assuming, that is, that the original doesn't change much...

    @dialyzer :no_improper_lists

    binary_ops = [
      ==: " = ",
      !=: " != ",
      <=: " <= ",
      >=: " >= ",
      <: " < ",
      >: " > ",
      +: " + ",
      -: " - ",
      *: " * ",
      /: " / ",
      and: " AND ",
      or: " OR ",
      ilike: " ILIKE ",
      like: " LIKE "
    ]

    @binary_ops Keyword.keys(binary_ops)
    alias Ecto.Query.BooleanExpr

    Enum.map(binary_ops, fn {op, str} ->
      defp handle_call(unquote(op), 2), do: {:binary_op, unquote(str)}
    end)

    defp handle_call(fun, _arity), do: {:fun, Atom.to_string(fun)}

    def where(%{wheres: wheres} = query, sources, bindings) do
      processed_bindings = process_bindings(query, bindings)
      boolean("", wheres, sources, query, processed_bindings)
    end

    defp process_bindings(%{wheres: wheres} = query, bindings) do
      type_map =
        wheres
        |> Enum.flat_map(&collect_param_types(&1.expr, query))
        |> Map.new()

      bindings
      |> Enum.with_index(1)
      |> Enum.map(fn {val, idx} ->
        dump_binding(Map.get(type_map, idx), val)
      end)
    end

    defp boolean(_name, [], _sources, _query, _bindings), do: []

    defp boolean(name, [%{expr: expr, op: op} | query_exprs], sources, query, bindings) do
      [
        name
        | Enum.reduce(query_exprs, {op, paren_expr(expr, sources, query, bindings)}, fn
            %BooleanExpr{expr: expr, op: op}, {op, acc} ->
              {op, [acc, operator_to_boolean(op), paren_expr(expr, sources, query, bindings)]}

            %BooleanExpr{expr: expr, op: op}, {_, acc} ->
              {op,
               [?(, acc, ?), operator_to_boolean(op), paren_expr(expr, sources, query, bindings)]}
          end)
          |> elem(1)
      ]
    end

    defp operator_to_boolean(:and), do: " AND "
    defp operator_to_boolean(:or), do: " OR "

    defp parens_for_select([first_expr | _] = expr) do
      if is_binary(first_expr) and String.match?(first_expr, ~r/^\s*select\s/i) do
        [?(, expr, ?)]
      else
        expr
      end
    end

    defp paren_expr(expr, sources, query, bindings) do
      [?(, expr(expr, sources, query, bindings), ?)]
    end

    defp expr({:^, [], [ix]}, sources, query, bindings) do
      bindings
      |> bound_value(ix)
      |> expr(sources, query, bindings)
    end

    defp expr({{:., _, [{:&, _, [_idx]}, field]}, _, []}, _sources, _query, _bindings)
         when is_atom(field) do
      # TODO: our expression parser fails when you qualify column names with the table name
      # quote_qualified_name(field, sources, idx)
      quote_name(field)
    end

    defp expr({:&, _, [idx]}, sources, _query, _bindings) do
      {_, source, _} = elem(sources, idx)
      source
    end

    defp expr({:in, _, [_left, []]}, _sources, _query, _bindings) do
      "false"
    end

    defp expr({:in, _, [left, right]}, sources, query, bindings) when is_list(right) do
      args = Enum.map_intersperse(right, ?,, &expr(&1, sources, query, bindings))
      [expr(left, sources, query, bindings), " IN (", args, ?)]
    end

    defp expr({:in, _, [left, {:^, _, [ix, _]}]}, sources, query, bindings) do
      [expr({:in, [], [left, bound_value(bindings, ix)]}, sources, query, bindings)]
    end

    # defp expr({:in, _, [left, %Ecto.SubQuery{} = subquery]}, sources, query) do
    #   [expr(left, sources, query), " IN ", expr(subquery, sources, query)]
    # end

    defp expr({:in, _, [left, right]}, sources, query, bindings) do
      [expr(left, sources, query, bindings), " = ANY(", expr(right, sources, query, bindings), ?)]
    end

    defp expr({:is_nil, _, [arg]}, sources, query, bindings) do
      [expr(arg, sources, query, bindings) | " IS NULL"]
    end

    defp expr({:not, _, [expr]}, sources, query, bindings) do
      ["NOT (", expr(expr, sources, query, bindings), ?)]
    end

    # defp expr(%Ecto.SubQuery{query: query}, sources, parent_query) do
    #   combinations =
    #     Enum.map(query.combinations, fn {type, combination_query} ->
    #       {type, put_in(combination_query.aliases[@parent_as], {parent_query, sources})}
    #     end)
    #
    #   query = put_in(query.combinations, combinations)
    #   query = put_in(query.aliases[@parent_as], {parent_query, sources})
    #   [?(, all(query, subquery_as_prefix(sources)), ?)]
    # end

    defp expr({:fragment, _, [kw]}, _sources, query, _bindings)
         when is_list(kw) or tuple_size(kw) == 3 do
      error!(query, "PostgreSQL adapter does not support keyword or interpolated fragments")
    end

    defp expr({:fragment, _, parts}, sources, query, bindings) do
      Enum.map(parts, fn
        {:raw, part} -> part
        {:expr, expr} -> expr(expr, sources, query, bindings)
      end)
      |> parens_for_select
    end

    defp expr({:literal, _, [literal]}, _sources, _query, _bindings) do
      quote_name(literal)
    end

    defp expr({:splice, _, [{:^, _, [idx, length]}]}, sources, query, bindings) do
      bindings
      |> Enum.slice(idx - 1, length)
      |> Enum.map_join(",", &expr(bound_value(&1), sources, query, bindings))
    end

    defp expr({:selected_as, _, [name]}, _sources, _query, _bindings) do
      [quote_name(name)]
    end

    defp expr({:datetime_add, _, [datetime, count, interval]}, sources, query, bindings) do
      [
        expr(datetime, sources, query, bindings),
        type_unless_typed(datetime, "timestamp"),
        " + ",
        interval(count, interval, sources, query, bindings)
      ]
    end

    defp expr({:date_add, _, [date, count, interval]}, sources, query, bindings) do
      [
        ?(,
        expr(date, sources, query, bindings),
        type_unless_typed(date, "date"),
        " + ",
        interval(count, interval, sources, query, bindings) | ")::date"
      ]
    end

    defp expr({:json_extract_path, _, [expr, path]}, sources, query, bindings) do
      json_extract_path(expr, path, sources, query, bindings)
    end

    defp expr({:filter, _, [agg, filter]}, sources, query, bindings) do
      aggregate = expr(agg, sources, query, bindings)
      [aggregate, " FILTER (WHERE ", expr(filter, sources, query, bindings), ?)]
    end

    defp expr({:over, _, [agg, name]}, sources, query, bindings) when is_atom(name) do
      aggregate = expr(agg, sources, query, bindings)
      [aggregate, " OVER " | quote_name(name)]
    end

    defp expr({:{}, _, elems}, sources, query, bindings) do
      [?(, Enum.map_intersperse(elems, ?,, &expr(&1, sources, query, bindings)), ?)]
    end

    defp expr({:count, _, []}, _sources, _query, _bindings), do: "count(*)"

    defp expr(
           {:==, _, [{:json_extract_path, _, [expr, path]} = left, right]},
           sources,
           query,
           bindings
         )
         when is_binary(right) or is_integer(right) or is_boolean(right) do
      case Enum.split(path, -1) do
        {path, [last]} when is_binary(last) ->
          extracted = json_extract_path(expr, path, sources, query, bindings)
          [?(, extracted, "@>'{", escape_json(last), ": ", escape_json(right) | "}')"]

        _ ->
          [
            maybe_paren(left, sources, query, bindings),
            " = " | maybe_paren(right, sources, query, bindings)
          ]
      end
    end

    defp expr({fun, _, args}, sources, query, bindings) when is_atom(fun) and is_list(args) do
      {modifier, args} =
        case args do
          [rest, :distinct] -> {"DISTINCT ", [rest]}
          _ -> {[], args}
        end

      case handle_call(fun, length(args)) do
        {:binary_op, op} ->
          [left, right] = args

          [
            maybe_paren(left, sources, query, bindings),
            op | maybe_paren(right, sources, query, bindings)
          ]

        {:fun, fun} ->
          [
            fun,
            ?(,
            modifier,
            Enum.map_intersperse(args, ", ", &expr(&1, sources, query, bindings)),
            ?)
          ]
      end
    end

    defp expr([], _sources, _query, _bindings) do
      # We cannot compare in postgres with the empty array
      # i. e. `where array_column = ARRAY[];`
      # as that will result in an error:
      #   ERROR:  cannot determine type of empty array
      #   HINT:  Explicitly cast to the desired type, for example ARRAY[]::integer[].
      #
      # On the other side comparing with '{}' works
      # because '{}' represents the pseudo-type "unknown"
      # and thus the type gets inferred based on the column
      # it is being compared to so `where array_column = '{}';` works.
      "'{}'"
    end

    defp expr(list, sources, query, bindings) when is_list(list) do
      ["ARRAY[", Enum.map_intersperse(list, ?,, &expr(&1, sources, query, bindings)), ?]]
    end

    defp expr(%Decimal{} = decimal, _sources, _query, _bindings) do
      Decimal.to_string(decimal, :normal)
    end

    defp expr(%Ecto.Query.Tagged{value: binary, type: :binary}, _sources, _query, _bindings)
         when is_binary(binary) do
      ["'\\x", Base.encode16(binary, case: :lower) | "'::bytea"]
    end

    defp expr(%Ecto.Query.Tagged{value: bitstring, type: :bitstring}, _sources, _query, _bindings)
         when is_bitstring(bitstring) do
      bitstring_literal(bitstring)
    end

    defp expr(%Ecto.Query.Tagged{value: other, type: type}, sources, query, bindings) do
      [maybe_paren(other, sources, query, bindings), ?:, ?: | tagged_to_db(type)]
    end

    defp expr(nil, _sources, _query, _bindings), do: "NULL"
    defp expr(true, _sources, _query, _bindings), do: "TRUE"
    defp expr(false, _sources, _query, _bindings), do: "FALSE"

    defp expr(literal, _sources, _query, _bindings) when is_binary(literal) do
      [?\', escape_string(literal), ?\']
    end

    defp expr(literal, _sources, _query, _bindings) when is_integer(literal) do
      Integer.to_string(literal)
    end

    defp expr(literal, _sources, _query, _bindings) when is_float(literal) do
      [Float.to_string(literal) | "::float"]
    end

    defp expr(%NaiveDateTime{} = datetime, _sources, _query, _bindings) do
      [?\', NaiveDateTime.to_iso8601(datetime), ?\' | "::timestamp"]
    end

    defp expr(%DateTime{utc_offset: 0, std_offset: 0} = datetime, _sources, _query, _bindings) do
      [?\', DateTime.to_iso8601(datetime), ?\' | "::timestamptz"]
    end

    defp expr(%DateTime{} = datetime, _sources, query, _bindings) do
      error!(query, "#{inspect(datetime)} is not in UTC")
    end

    defp expr(%Date{} = date, _sources, _query, _bindings) do
      [?\', Date.to_iso8601(date), ?\' | "::date"]
    end

    defp expr(expr, _sources, query, _bindings) do
      error!(query, "unsupported expression: #{inspect(expr)}")
    end

    defp json_extract_path(expr, [], sources, query, bindings) do
      expr(expr, sources, query, bindings)
    end

    defp json_extract_path(expr, path, sources, query, bindings) do
      path = Enum.map_intersperse(path, ?,, &escape_json/1)
      [?(, expr(expr, sources, query, bindings), "#>'{", path, "}')"]
    end

    defp type_unless_typed(%Ecto.Query.Tagged{}, _type), do: []
    defp type_unless_typed(_, type), do: [?:, ?: | type]

    # Always use the largest possible type for integers
    defp tagged_to_db(:id), do: "bigint"
    defp tagged_to_db(:integer), do: "bigint"
    defp tagged_to_db({:array, type}), do: [tagged_to_db(type), ?[, ?]]
    defp tagged_to_db(type), do: ecto_to_db(type)

    defp interval(count, interval, _sources, _query, _bindings) when is_integer(count) do
      ["interval '", String.Chars.Integer.to_string(count), ?\s, interval, ?\']
    end

    defp interval(count, interval, _sources, _query, _bindings) when is_float(count) do
      count = :erlang.float_to_binary(count, [:compact, decimals: 16])
      ["interval '", count, ?\s, interval, ?\']
    end

    defp interval(count, interval, sources, query, bindings) do
      [
        ?(,
        expr(count, sources, query, bindings),
        "::numeric * ",
        interval(1, interval, sources, query, bindings),
        ?)
      ]
    end

    defp maybe_paren({op, _, [_, _]} = expr, sources, query, bindings) when op in @binary_ops,
      do: paren_expr(expr, sources, query, bindings)

    defp maybe_paren({:is_nil, _, [_]} = expr, sources, query, bindings),
      do: paren_expr(expr, sources, query, bindings)

    defp maybe_paren(expr, sources, query, bindings),
      do: expr(expr, sources, query, bindings)

    # defp quote_qualified_name(name, sources, ix) do
    #   {_, source, _} = elem(sources, ix)
    #   [source, ?. | quote_name(name)]
    # end

    defp quote_name(name) when is_atom(name) do
      quote_name(Atom.to_string(name))
    end

    defp quote_name(name) when is_binary(name) do
      if String.contains?(name, "\"") do
        error!(nil, "bad literal/field/index/table name #{inspect(name)} (\" is not permitted)")
      end

      [?", name, ?"]
    end

    defp bitstring_literal(value) do
      size = bit_size(value)
      <<val::size(^size)>> = value

      [?b, ?', val |> Integer.to_string(2) |> String.pad_leading(size, ["0"]), ?']
    end

    defp escape_string(value) when is_binary(value) do
      :binary.replace(value, "'", "''", [:global])
    end

    defp escape_json(value) when is_binary(value) do
      escaped =
        value
        |> escape_string()
        |> :binary.replace("\"", "\\\"", [:global])

      [?", escaped, ?"]
    end

    defp escape_json(value) when is_integer(value) do
      Integer.to_string(value)
    end

    defp escape_json(true), do: ["true"]
    defp escape_json(false), do: ["false"]

    defp ecto_to_db({:array, t}), do: [ecto_to_db(t), ?[, ?]]
    defp ecto_to_db(:id), do: "integer"
    defp ecto_to_db(:identity), do: "bigint"
    defp ecto_to_db(:serial), do: "serial"
    defp ecto_to_db(:bigserial), do: "bigserial"
    defp ecto_to_db(:binary_id), do: "uuid"
    defp ecto_to_db(:string), do: "varchar"
    defp ecto_to_db(:bitstring), do: "varbit"
    defp ecto_to_db(:binary), do: "bytea"
    defp ecto_to_db(:map), do: Application.fetch_env!(:ecto_sql, :postgres_map_type)
    defp ecto_to_db({:map, _}), do: Application.fetch_env!(:ecto_sql, :postgres_map_type)
    defp ecto_to_db(:time_usec), do: "time"
    defp ecto_to_db(:utc_datetime), do: "timestamp"
    defp ecto_to_db(:utc_datetime_usec), do: "timestamp"
    defp ecto_to_db(:naive_datetime), do: "timestamp"
    defp ecto_to_db(:naive_datetime_usec), do: "timestamp"
    defp ecto_to_db(:duration), do: "interval"
    defp ecto_to_db(atom) when is_atom(atom), do: Atom.to_string(atom)

    defp ecto_to_db(type) do
      raise ArgumentError,
            "unsupported type `#{inspect(type)}`. The type can either be an atom, a string " <>
              "or a tuple of the form `{:map, t}` or `{:array, t}` where `t` itself follows the same conditions."
    end

    defp error!(nil, message) do
      raise ArgumentError, message
    end

    defp error!(query, message) do
      raise Ecto.QueryError, query: query, message: message
    end

    def bound_value({value, _cast}) do
      value
    end

    def bound_value(bindings, idx) do
      bindings
      |> Enum.at(idx - 1)
      |> bound_value()
    end

    defp collect_param_types(
           {op, _, [{{:., _, [{:&, _, [_]}, field]}, _, []}, {:^, _, [ix]}]},
           %{from: %Ecto.Query.FromExpr{source: {_, schema_mod}}}
         )
         when op in @binary_ops and is_atom(field) do
      ecto_type = schema_mod.__schema__(:type, field)
      [{ix, ecto_type}]
    end

    defp collect_param_types(
           {:in, _, [{{:., _, [{:&, _, [_]}, field]}, _, []}, {:^, _, [ix, _len]}]},
           %{from: %Ecto.Query.FromExpr{source: {_, schema_mod}}}
         ) do
      ecto_type = schema_mod.__schema__(:type, field)
      [{ix, ecto_type}]
    end

    defp collect_param_types({:fragment, _, parts}, query) do
      Enum.flat_map(parts, &collect_fragment_part_types(&1, parts, query))
    end

    defp collect_param_types({_, _, args}, query) when is_list(args) do
      Enum.flat_map(args, &collect_param_types(&1, query))
    end

    defp collect_param_types(_, _), do: []

    defp collect_fragment_part_types(
           {:expr, {:splice, _, [{:^, _, [idx, length]}]}},
           parts,
           query
         ) do
      case find_field_type_in_fragment(parts, query) do
        nil -> []
        field_type -> Enum.map(idx..(idx + length - 1), &{&1, field_type})
      end
    end

    defp collect_fragment_part_types(
           {:expr, {:^, _, [idx]}},
           parts,
           query
         ) do
      case find_field_type_in_fragment(parts, query) do
        nil -> []
        field_type -> [{idx, field_type}]
      end
    end

    defp collect_fragment_part_types({:raw, _}, _, _), do: []

    defp collect_fragment_part_types({:expr, expr}, _, query),
      do: collect_param_types(expr, query)

    defp find_field_type_in_fragment(fragment_parts, query) do
      Enum.find_value(fragment_parts, fn
        {:expr, {{:., _, [{:&, _, [0]}, field]}, _, []}} when is_atom(field) ->
          case query do
            %{from: %Ecto.Query.FromExpr{source: {_, schema_mod}}} ->
              schema_mod.__schema__(:type, field)

            _ ->
              nil
          end

        _ ->
          nil
      end)
    end

    defp dump_binding({:parameterized, _} = type, {value, cast}) when is_list(value) do
      value
      |> Enum.zip(cast)
      |> Enum.map(&dump_binding(type, &1))
      |> Enum.unzip()
    end

    defp dump_binding({:parameterized, {mod, params}} = type, {value, _cast}) do
      case Ecto.Type.dump(type, value) do
        {:ok, dumped} ->
          # Look at the underlying type for special handling.
          #
          # Columns backed by :uuid are dumped to a raw binary format, which postgrex
          # expects. But we want the string representation in the query.
          #
          # Don't want to hand-roll each type here, but I don't see a better way since
          # we're taking postgrex's role of converting the result of dump to the
          # expected format.
          case mod.type(params) do
            :uuid ->
              {Ecto.UUID.cast!(dumped), dumped}

            _other ->
              {dumped, dumped}
          end

        :error ->
          raise ArgumentError,
                "cannot dump value #{inspect(value)} for type #{inspect(type)}"
      end
    end

    defp dump_binding(_, value), do: value
  end
end
