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

    def where(%{wheres: wheres} = query, sources) do
      boolean("", wheres, sources, query)
    end

    defp boolean(_name, [], _sources, _query), do: []

    defp boolean(name, [%{expr: expr, op: op} | query_exprs], sources, query) do
      [
        name
        | Enum.reduce(query_exprs, {op, paren_expr(expr, sources, query)}, fn
            %BooleanExpr{expr: expr, op: op}, {op, acc} ->
              {op, [acc, operator_to_boolean(op), paren_expr(expr, sources, query)]}

            %BooleanExpr{expr: expr, op: op}, {_, acc} ->
              {op, [?(, acc, ?), operator_to_boolean(op), paren_expr(expr, sources, query)]}
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

    defp paren_expr(expr, sources, query) do
      [?(, expr(expr, sources, query), ?)]
    end

    defp expr({:^, [], [ix]}, _sources, _query) do
      [?$ | Integer.to_string(ix + 1)]
    end

    defp expr({{:., _, [{:&, _, [_idx]}, field]}, _, []}, _sources, _query) when is_atom(field) do
      # TODO: our expression parser fails when you qualify column names with the table name
      # quote_qualified_name(field, sources, idx)
      quote_name(field)
    end

    defp expr({:&, _, [idx]}, sources, _query) do
      {_, source, _} = elem(sources, idx)
      source
    end

    defp expr({:in, _, [_left, []]}, _sources, _query) do
      "false"
    end

    defp expr({:in, _, [left, right]}, sources, query) when is_list(right) do
      args = Enum.map_intersperse(right, ?,, &expr(&1, sources, query))
      [expr(left, sources, query), " IN (", args, ?)]
    end

    defp expr({:in, _, [left, {:^, _, [ix, _]}]}, sources, query) do
      [expr(left, sources, query), " = ANY($", Integer.to_string(ix + 1), ?)]
    end

    defp expr({:in, _, [left, %Ecto.SubQuery{} = subquery]}, sources, query) do
      [expr(left, sources, query), " IN ", expr(subquery, sources, query)]
    end

    defp expr({:in, _, [left, right]}, sources, query) do
      [expr(left, sources, query), " = ANY(", expr(right, sources, query), ?)]
    end

    defp expr({:is_nil, _, [arg]}, sources, query) do
      [expr(arg, sources, query) | " IS NULL"]
    end

    defp expr({:not, _, [expr]}, sources, query) do
      ["NOT (", expr(expr, sources, query), ?)]
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

    defp expr({:fragment, _, [kw]}, _sources, query) when is_list(kw) or tuple_size(kw) == 3 do
      error!(query, "PostgreSQL adapter does not support keyword or interpolated fragments")
    end

    defp expr({:fragment, _, parts}, sources, query) do
      Enum.map(parts, fn
        {:raw, part} -> part
        {:expr, expr} -> expr(expr, sources, query)
      end)
      |> parens_for_select
    end

    defp expr({:values, _, [types, idx, num_rows]}, _, _query) do
      [?(, values_list(types, idx + 1, num_rows), ?)]
    end

    defp expr({:literal, _, [literal]}, _sources, _query) do
      quote_name(literal)
    end

    defp expr({:splice, _, [{:^, _, [idx, length]}]}, _sources, _query) do
      Enum.map_join(1..length, ",", &"$#{idx + &1}")
    end

    defp expr({:selected_as, _, [name]}, _sources, _query) do
      [quote_name(name)]
    end

    defp expr({:datetime_add, _, [datetime, count, interval]}, sources, query) do
      [
        expr(datetime, sources, query),
        type_unless_typed(datetime, "timestamp"),
        " + ",
        interval(count, interval, sources, query)
      ]
    end

    defp expr({:date_add, _, [date, count, interval]}, sources, query) do
      [
        ?(,
        expr(date, sources, query),
        type_unless_typed(date, "date"),
        " + ",
        interval(count, interval, sources, query) | ")::date"
      ]
    end

    defp expr({:json_extract_path, _, [expr, path]}, sources, query) do
      json_extract_path(expr, path, sources, query)
    end

    defp expr({:filter, _, [agg, filter]}, sources, query) do
      aggregate = expr(agg, sources, query)
      [aggregate, " FILTER (WHERE ", expr(filter, sources, query), ?)]
    end

    defp expr({:over, _, [agg, name]}, sources, query) when is_atom(name) do
      aggregate = expr(agg, sources, query)
      [aggregate, " OVER " | quote_name(name)]
    end

    # defp expr({:over, _, [agg, kw]}, sources, query) do
    #   aggregate = expr(agg, sources, query)
    #   [aggregate, " OVER ", window_exprs(kw, sources, query)]
    # end

    defp expr({:{}, _, elems}, sources, query) do
      [?(, Enum.map_intersperse(elems, ?,, &expr(&1, sources, query)), ?)]
    end

    defp expr({:count, _, []}, _sources, _query), do: "count(*)"

    defp expr({:==, _, [{:json_extract_path, _, [expr, path]} = left, right]}, sources, query)
         when is_binary(right) or is_integer(right) or is_boolean(right) do
      case Enum.split(path, -1) do
        {path, [last]} when is_binary(last) ->
          extracted = json_extract_path(expr, path, sources, query)
          [?(, extracted, "@>'{", escape_json(last), ": ", escape_json(right) | "}')"]

        _ ->
          [maybe_paren(left, sources, query), " = " | maybe_paren(right, sources, query)]
      end
    end

    defp expr({fun, _, args}, sources, query) when is_atom(fun) and is_list(args) do
      {modifier, args} =
        case args do
          [rest, :distinct] -> {"DISTINCT ", [rest]}
          _ -> {[], args}
        end

      case handle_call(fun, length(args)) do
        {:binary_op, op} ->
          [left, right] = args
          [maybe_paren(left, sources, query), op | maybe_paren(right, sources, query)]

        {:fun, fun} ->
          [fun, ?(, modifier, Enum.map_intersperse(args, ", ", &expr(&1, sources, query)), ?)]
      end
    end

    defp expr([], _sources, _query) do
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

    defp expr(list, sources, query) when is_list(list) do
      ["ARRAY[", Enum.map_intersperse(list, ?,, &expr(&1, sources, query)), ?]]
    end

    defp expr(%Decimal{} = decimal, _sources, _query) do
      Decimal.to_string(decimal, :normal)
    end

    defp expr(%Ecto.Query.Tagged{value: binary, type: :binary}, _sources, _query)
         when is_binary(binary) do
      ["'\\x", Base.encode16(binary, case: :lower) | "'::bytea"]
    end

    defp expr(%Ecto.Query.Tagged{value: bitstring, type: :bitstring}, _sources, _query)
         when is_bitstring(bitstring) do
      bitstring_literal(bitstring)
    end

    defp expr(%Ecto.Query.Tagged{value: other, type: type}, sources, query) do
      [maybe_paren(other, sources, query), ?:, ?: | tagged_to_db(type)]
    end

    defp expr(nil, _sources, _query), do: "NULL"
    defp expr(true, _sources, _query), do: "TRUE"
    defp expr(false, _sources, _query), do: "FALSE"

    defp expr(literal, _sources, _query) when is_binary(literal) do
      [?\', escape_string(literal), ?\']
    end

    defp expr(literal, _sources, _query) when is_integer(literal) do
      Integer.to_string(literal)
    end

    defp expr(literal, _sources, _query) when is_float(literal) do
      [Float.to_string(literal) | "::float"]
    end

    defp expr(expr, _sources, query) do
      error!(query, "unsupported expression: #{inspect(expr)}")
    end

    defp json_extract_path(expr, [], sources, query) do
      expr(expr, sources, query)
    end

    defp json_extract_path(expr, path, sources, query) do
      path = Enum.map_intersperse(path, ?,, &escape_json/1)
      [?(, expr(expr, sources, query), "#>'{", path, "}')"]
    end

    defp values_list(types, idx, num_rows) do
      rows = Enum.to_list(1..num_rows)

      [
        "VALUES ",
        intersperse_reduce(rows, ?,, idx, fn _, idx ->
          {value, idx} = values_expr(types, idx)
          {[?(, value, ?)], idx}
        end)
        |> elem(0)
      ]
    end

    defp values_expr(types, idx) do
      intersperse_reduce(types, ?,, idx, fn {_field, type}, idx ->
        {[?$, Integer.to_string(idx), ?:, ?: | tagged_to_db(type)], idx + 1}
      end)
    end

    defp type_unless_typed(%Ecto.Query.Tagged{}, _type), do: []
    defp type_unless_typed(_, type), do: [?:, ?: | type]

    # Always use the largest possible type for integers
    defp tagged_to_db(:id), do: "bigint"
    defp tagged_to_db(:integer), do: "bigint"
    defp tagged_to_db({:array, type}), do: [tagged_to_db(type), ?[, ?]]
    defp tagged_to_db(type), do: ecto_to_db(type)

    defp interval(count, interval, _sources, _query) when is_integer(count) do
      ["interval '", String.Chars.Integer.to_string(count), ?\s, interval, ?\']
    end

    defp interval(count, interval, _sources, _query) when is_float(count) do
      count = :erlang.float_to_binary(count, [:compact, decimals: 16])
      ["interval '", count, ?\s, interval, ?\']
    end

    defp interval(count, interval, sources, query) do
      [?(, expr(count, sources, query), "::numeric * ", interval(1, interval, sources, query), ?)]
    end

    defp maybe_paren({op, _, [_, _]} = expr, sources, query) when op in @binary_ops,
      do: paren_expr(expr, sources, query)

    defp maybe_paren({:is_nil, _, [_]} = expr, sources, query),
      do: paren_expr(expr, sources, query)

    defp maybe_paren(expr, sources, query),
      do: expr(expr, sources, query)

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
      <<val::size(size)>> = value

      [?b, ?', val |> Integer.to_string(2) |> String.pad_leading(size, ["0"]), ?']
    end

    defp intersperse_reduce(list, separator, user_acc, reducer, acc \\ [])

    defp intersperse_reduce([], _separator, user_acc, _reducer, acc),
      do: {acc, user_acc}

    defp intersperse_reduce([elem], _separator, user_acc, reducer, acc) do
      {elem, user_acc} = reducer.(elem, user_acc)
      {[acc | elem], user_acc}
    end

    defp intersperse_reduce([elem | rest], separator, user_acc, reducer, acc) do
      {elem, user_acc} = reducer.(elem, user_acc)
      intersperse_reduce(rest, separator, user_acc, reducer, [acc, elem, separator])
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
  end
end
