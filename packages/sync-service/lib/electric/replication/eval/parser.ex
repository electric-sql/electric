defmodule Electric.Replication.Eval.Parser do
  require Logger

  alias Electric.Replication.Eval.Walker
  alias Electric.Utils
  alias Electric.Replication.PostgresInterop.Casting
  import Electric.Replication.PostgresInterop.Casting
  alias Electric.Replication.Eval.Env
  alias Electric.Replication.Eval.Lookups
  alias Electric.Replication.Eval.Expr

  defmodule Const do
    defstruct [:value, :type, :meta, location: 0]

    defimpl Inspect do
      import Inspect.Algebra

      def inspect(%Const{value: value}, opts) do
        concat(["#Const(", to_doc(value, opts), ")"])
      end
    end

    defimpl Electric.Shapes.Shape.Comparable do
      def comparable(%Const{} = const), do: %{const | location: 0}
    end
  end

  defmodule UnknownConst do
    defstruct [:value, :meta, location: 0]

    defimpl Electric.Shapes.Shape.Comparable do
      def comparable(%UnknownConst{} = unknown_const), do: %{unknown_const | location: 0}
    end
  end

  defmodule Ref do
    defstruct [:path, :type, location: 0]

    defimpl Inspect do
      import Inspect.Algebra

      def inspect(%Ref{path: path}, _opts) do
        concat(["#Ref(", Enum.join(path, "."), ")"])
      end
    end

    defimpl Electric.Shapes.Shape.Comparable do
      def comparable(%Ref{} = ref), do: %{ref | location: 0}
    end
  end

  defmodule Array do
    defstruct [:elements, :type, location: 0]

    defimpl Inspect do
      import Inspect.Algebra

      def inspect(%Array{elements: elements}, opts) do
        concat(["#Array(", to_doc(elements, opts), ")"])
      end
    end

    defimpl Electric.Shapes.Shape.Comparable do
      def comparable(%Array{} = array), do: %{array | location: 0}
    end
  end

  defmodule RowExpr do
    defstruct [:elements, :type, :location]
  end

  defmodule Func do
    defstruct [
      :args,
      :type,
      :implementation,
      :name,
      strict?: true,
      immutable?: true,
      # So this parameter is (1) internal for now, i.e. `defpostgres` in known functions cannot set it,
      # and (2) is a bit of a hack. This allows us to specify that this function should be applied to each element of an array,
      # without supporting essentially anonymous functions in our AST for an equivalent of `Enum.map/2`.
      map_over_array_in_pos: nil,
      variadic_arg: nil,
      location: 0
    ]

    defimpl Inspect do
      import Inspect.Algebra

      def inspect(%Func{args: args, name: name}, opts) do
        concat(["Func(", name, ")", to_doc(args, opts)])
      end
    end

    defimpl Electric.Shapes.Shape.Comparable do
      alias Electric.Shapes.Shape.Comparable

      def comparable(%Func{} = func),
        do: %{func | location: 0, args: Enum.map(func.args, &Comparable.comparable/1)}
    end
  end

  @valid_types (Electric.Postgres.supported_types() ++
                  Electric.Postgres.supported_types_only_in_functions())
               |> Enum.map(&Atom.to_string/1)

  @type tree_part :: %Const{} | %Ref{} | %Func{} | %Array{}
  @type refs_map :: %{optional([String.t(), ...]) => Env.pg_type()}
  @type parse_opt ::
          {:env, Env.t()} | {:refs, refs_map()} | {:params, %{String.t() => String.t()}}

  @prefix_length String.length("SELECT 1 WHERE ")

  def validate_order_by(order_by, columns) do
    case PgQuery.parse("SELECT 1 ORDER BY #{order_by}") do
      {:ok, %{stmts: [%{stmt: %{node: {:select_stmt, stmt}}}]}} ->
        do_validate_order_by(stmt, columns)

      {:ok, _} ->
        {:error, "Unexpected `;` in order by"}

      {:error, %{cursorpos: loc, message: reason}} ->
        {:error, "At location #{loc}: #{reason}"}
    end
  end

  defp do_validate_order_by(select_stmt, columns) do
    with {:ok, sort_clause} <- extract_clause(select_stmt, :sort_clause),
         {:ok, _} <-
           Walker.reduce(
             %Array{elements: sort_clause},
             &check_valid_refs/3,
             :ok,
             Map.new(columns, fn %{name: name} -> {[name], :unknown} end)
           ) do
      :ok
    else
      {:error, {location, reason}} ->
        {:error, "At location #{location}: #{reason}"}
    end
  end

  defp check_valid_refs(%PgQuery.ColumnRef{} = ref, _, refs) do
    with {:ok, {%Ref{}, _}} <- query_to_ast(ref, %{refs: refs}) do
      {:ok, :ok}
    end
  end

  defp check_valid_refs(_, _, _), do: {:ok, :ok}

  def extract_subqueries(ast) do
    Walker.reduce(
      ast,
      fn
        %PgQuery.SubLink{subselect: %{node: {:select_stmt, stmt}}}, acc, _ ->
          {:ok, [stmt | acc]}

        _, acc, _ ->
          {:ok, acc}
      end,
      []
    )
  end

  def extract_parts_from_select(select) when is_binary(select) do
    case PgQuery.parse(select) do
      {:ok, %{stmts: [%{stmt: %{node: {:select_stmt, stmt}}}]}} ->
        extract_parts_from_select(stmt)

      {:ok, _} ->
        {:error, "Expected exactly one SELECT statement"}

      {:error, %{cursorpos: loc, message: reason}} ->
        {:error, "At location #{loc}: #{reason}"}
    end
  end

  def extract_parts_from_select(%PgQuery.SelectStmt{} = stmt) do
    with {:ok, columns} <- extract_columns(stmt.target_list),
         {:ok, from} <- extract_from(stmt.from_clause),
         :ok <- validate_select_stmt(stmt) do
      {:ok, {columns, from, stmt.where_clause}}
    end
  end

  defp validate_select_stmt(%PgQuery.SelectStmt{} = stmt)
       when stmt.distinct_clause != []
       when stmt.group_clause != []
       when stmt.having_clause != nil
       when stmt.window_clause != []
       when stmt.limit_offset != nil
       when stmt.sort_clause != []
       when stmt.locking_clause != []
       when stmt.with_clause != nil do
    {:error, "SELECT statement must not contain any clauses"}
  end

  defp validate_select_stmt(%PgQuery.SelectStmt{}), do: :ok

  defp extract_columns(target_list) do
    Enum.reduce_while(target_list, {:ok, []}, fn elem, {:ok, acc} ->
      case elem do
        %{
          node:
            {:res_target,
             %PgQuery.ResTarget{
               val: %{
                 node:
                   {:column_ref,
                    %PgQuery.ColumnRef{
                      fields: [
                        %{node: {:string, %PgQuery.String{sval: column_name}}}
                      ]
                    }}
               }
             }}
        } ->
          {:cont, {:ok, [column_name | acc]}}

        %{node: {:res_target, %PgQuery.ResTarget{location: loc}}} ->
          {:halt, {:error, "At location #{loc}: Expected a plain column reference"}}
      end
    end)
    |> case do
      {:ok, acc} -> {:ok, Enum.reverse(acc)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp extract_from(from_clause) do
    case from_clause do
      [
        %PgQuery.Node{
          node:
            {:range_var,
             %PgQuery.RangeVar{
               relname: table_name,
               schemaname: schema_name
             }}
        }
      ] ->
        schema_name = if schema_name == "", do: "public", else: schema_name
        {:ok, {schema_name, table_name}}

      _ ->
        {:error, "Expected a single table reference"}
    end
  end

  @doc """
  Parses a query into a Postgres AST
  """
  def parse_query(nil), do: {:ok, nil}
  def parse_query(query) when is_binary(query), do: get_where_internal_ast(query)
  def parse_query(ast) when is_map(ast), do: {:ok, ast}

  def validate_where_ast(ast, opts) do
    params = Keyword.get(opts, :params, %{})
    refs = Keyword.get(opts, :refs, %{})
    env = Keyword.get(opts, :env, Env.new())

    case parse_where_stmt(ast, params, refs, env) do
      {:ok, value, computed_params} ->
        sublink_queries = Keyword.get(opts, :sublink_queries, %{})

        updated_query =
          rebuild_query_with_substituted_parts(ast, {params, computed_params, sublink_queries})

        {:ok,
         %Expr{
           query: updated_query,
           eval: value,
           returns: value.type,
           used_refs: find_refs(value)
         }}

      {:error, {loc, reason}} ->
        {:error, "At location #{max(loc - @prefix_length, 0)}: #{reason}"}
    end
  end

  @doc """
  Parses and validates a WHERE clause in PostgreSQL SQL syntax.

  Returns a tuple of `{:ok, Expr.t()}` or `{:error, String.t()}`.

  Query may contain `$1` parameter references, which will be taken from a `params` keyword argument.
  `params` must be a map with both strings and values as keys. Because we're using this query later in
  places that won't support parameter references, the `Expr` will have a `query` field that contains
  normalized query with parameters substrituted with strings with explicit type casts. For example:

  ```elixir
  {:ok, %Expr{query: "1 > '0'::int4"}} =
    Parser.parse_and_validate_expression("1 > $1", params: %{"1" => "0"})

  Query will be always be normalized, i.e. extra whitespace removed and keywords converted to upper case.
  ```
  """
  @spec parse_and_validate_expression(String.t(), [parse_opt()]) ::
          {:ok, Expr.t()} | {:error, String.t()}
  def parse_and_validate_expression(query, opts \\ [])
      when is_binary(query) and is_list(opts) do
    with {:ok, ast} <- get_where_internal_ast(query) do
      validate_where_ast(ast, opts)
    end
  end

  @spec parse_and_validate_expression!(String.t(), [parse_opt()]) :: Expr.t()
  def parse_and_validate_expression!(query, opts \\ []) when is_list(opts) do
    {:ok, value} = parse_and_validate_expression(query, opts)
    value
  end

  defp get_where_internal_ast(query) do
    case PgQuery.parse("SELECT 1 WHERE #{query}") do
      {:ok, %{stmts: [%{stmt: %{node: {:select_stmt, stmt}}}]}} ->
        extract_clause(stmt, :where_clause)

      {:ok, %{stmts: _}} ->
        {:error, ~s'unescaped ";" causing statement split'}

      {:error, %{cursorpos: loc, message: reason}} ->
        {:error, "At location #{loc}: #{reason}"}
    end
  end

  @empty_list_clauses [
    :distinct_clause,
    :group_clause,
    :window_clause,
    :sort_clause,
    :locking_clause,
    :from_clause
  ]
  @nil_clauses [:having_clause, :limit_clause, :with_clause, :where_clause]
  @all_clauses @empty_list_clauses ++ @nil_clauses

  defp extract_clause(stmt, clause) when clause in @all_clauses do
    empty_list_extra_suffixes =
      stmt
      |> Map.take(@empty_list_clauses -- [clause])
      |> Enum.find(fn {_, value} -> value != [] end)

    nil_extra_suffixes =
      stmt
      |> Map.take(@nil_clauses -- [clause])
      |> Enum.find(fn {_, value} -> not is_nil(value) end)

    if is_nil(empty_list_extra_suffixes) and is_nil(nil_extra_suffixes) do
      {:ok, Map.fetch!(stmt, clause)}
    else
      {:error, "malformed query ending with SQL clauses"}
    end
  end

  defp parse_where_stmt(stmt, params, refs, env) do
    context = %{params: params, refs: refs, env: env}

    with {:ok, {ast, %{resolved_params: resolved_params}}} <- query_to_ast(stmt, context),
         {:ok, result} <- reduce_ast(ast) do
      case result do
        %UnknownConst{} = unknown -> {:ok, infer_unknown(unknown), resolved_params}
        value -> {:ok, value, resolved_params}
      end
    end
  end

  defp query_to_ast(stmt, context) do
    Walker.accumulating_fold(
      stmt,
      &node_to_ast/4,
      fn preimage, postimage, _, acc, _ ->
        with {:ok, acc} <- maybe_save_used_param(acc, postimage) do
          if is_struct(preimage, PgQuery.SubLink) do
            {:ok, %{acc | encountered_sublinks: acc.encountered_sublinks + 1}}
          else
            {:ok, acc}
          end
        end
      end,
      %{used_params: MapSet.new(), resolved_params: %{}, encountered_sublinks: 0},
      context
    )
  end

  defp maybe_save_used_param(acc, postimage) when is_struct(postimage) do
    acc
    |> count_used_param(postimage)
    |> save_used_param(postimage)
  end

  defp maybe_save_used_param(acc, _), do: {:ok, acc}

  defp count_used_param(acc, %UnknownConst{meta: %{param_ref: ref}}),
    do:
      Map.update(acc, :used_params, MapSet.new([to_string(ref)]), &MapSet.put(&1, to_string(ref)))

  defp count_used_param(acc, _), do: acc

  defp save_used_param(acc, param) do
    # Given an AST, we want to find any arguments that used to be refs but got replaced.
    # We'll save them so that they can be reused thus avoiding type conflicts.
    # Main mapper from query to AST can return nested AST, so we need to accumulating_fold the
    # returned AST. We're also double-checking that any const we see matches other consts
    # in case there is a type mismatch within one AST level.
    Walker.reduce(
      param,
      fn
        %Const{meta: %{param_ref: ref}, type: type} = const, acc, _ ->
          case Map.fetch(acc.resolved_params, ref) do
            {:ok, %Const{type: ^type}} ->
              {:ok, acc}

            :error ->
              {:ok,
               %{acc | resolved_params: Map.put(acc.resolved_params, ref, %{const | meta: %{}})}}

            {:ok, %Const{type: other_type}} ->
              {:error, "type conflict for $#{ref}: #{readable(type)} and #{readable(other_type)}"}
          end

        _, acc, _ ->
          {:ok, acc}
      end,
      acc
    )
  end

  defp reduce_ast(ast) do
    Walker.fold(ast, fn node, children, _ctx ->
      do_maybe_reduce(Map.merge(node, children))
    end)
  end

  @spec node_to_ast(struct(), map(), map(), map()) ::
          {:ok, %UnknownConst{} | tree_part()}
          | {:error, {non_neg_integer(), String.t()}}
  defp node_to_ast(node, children, accumulators, ctx)
  defp node_to_ast(%PgQuery.Node{}, %{node: node}, _, _), do: {:ok, node}

  defp node_to_ast(%PgQuery.A_Const{isnull: true, location: loc}, _, _, _),
    do: {:ok, %UnknownConst{value: nil, location: loc}}

  defp node_to_ast(%PgQuery.A_Const{val: {:sval, struct}, location: loc}, _, _, _),
    do: {:ok, %UnknownConst{value: Map.fetch!(struct, :sval), location: loc}}

  defp node_to_ast(%PgQuery.A_Const{val: {kind, struct}, location: loc}, _, _, _),
    do: make_const(kind, Map.fetch!(struct, kind), loc)

  defp node_to_ast(
         %PgQuery.A_ArrayExpr{location: loc},
         %{elements: elements},
         _,
         %{env: env}
       ) do
    element_len = length(elements)

    case Lookups.pick_union_type(elements, env) do
      {:ok, type} ->
        with {:ok, elements} <-
               cast_unknowns(elements, List.duplicate(type, element_len), env),
             {:ok, elements} <-
               try_cast_implicit(elements, List.duplicate(type, element_len), env) do
          {:ok,
           %Array{elements: elements, type: {:array, extract_base_type_name(type)}, location: loc}}
        end

      {:error, type, candidate} ->
        {:error,
         {loc, "ARRAY types #{readable(type)} and #{readable(candidate)} cannot be matched"}}
    end
  end

  defp node_to_ast(
         %PgQuery.A_Indirection{},
         %{arg: %{type: {:array, inner_type} = array_type} = arg, indirection: indirections},
         _,
         _
       ) do
    # If any of the indirections are slices, every access is treated as a slice access
    # (e.g. `a[1:2][3]` is treated by PG as `a[1:2][1:3]` implicitly).
    if Enum.any?(indirections, &(&1.type == {:internal, :slice})) do
      {:ok,
       %Func{
         location: arg.location,
         args: [
           arg,
           %Array{
             elements: indirections,
             type: {:internal, :slice_access},
             location: arg.location
           }
         ],
         type: array_type,
         name: "slice_access",
         implementation: &PgInterop.Array.slice_access/2,
         variadic_arg: 1
       }}
    else
      {:ok,
       %Func{
         location: arg.location,
         args: [
           arg,
           %Array{
             elements: indirections,
             type: {:internal, :index_access},
             location: arg.location
           }
         ],
         type: inner_type,
         name: "index_access",
         implementation: &PgInterop.Array.index_access/2,
         variadic_arg: 1
       }}
    end
  end

  defp node_to_ast(
         %PgQuery.A_Indices{is_slice: is_slice},
         %{lidx: lower_idx, uidx: upper_idx},
         _,
         %{env: env}
       ) do
    lower_idx =
      lower_idx || %Const{value: :unspecified, type: {:internal, :slice_boundary}, location: 0}

    upper_idx =
      upper_idx || %Const{value: :unspecified, type: {:internal, :slice_boundary}, location: 0}

    with {:ok, [lower_idx, upper_idx]} <-
           cast_unknowns([lower_idx, upper_idx], List.duplicate(:int8, 2), env),
         {:ok, [lower_idx, upper_idx]} <- round_numerics([lower_idx, upper_idx]),
         {:ok, [lower_idx, upper_idx]} <-
           try_cast_implicit([lower_idx, upper_idx], List.duplicate(:int8, 2), env) do
      if is_slice do
        {:ok,
         %Func{
           location: upper_idx.location,
           args: [lower_idx, upper_idx],
           type: {:internal, :slice},
           name: "internal_slice",
           implementation: &build_slice_structure/2
         }}
      else
        {:ok,
         %Func{
           location: upper_idx.location,
           args: [upper_idx],
           type: {:internal, :index},
           name: "internal_index",
           implementation: &build_index_structure/1
         }}
      end
    end
  end

  defp node_to_ast(%PgQuery.ColumnRef{location: loc}, %{fields: ref}, _, %{refs: refs}) do
    case Map.fetch(refs, ref) do
      {:ok, type} ->
        {:ok, %Ref{path: ref, type: type, location: loc}}

      :error ->
        message = "unknown reference #{identifier(ref)}"

        message =
          if match?([_], ref) and is_map_key(refs, ["this", List.first(ref)]),
            do: message <> " - did you mean `this.#{List.first(ref)}`?",
            else: message

        {:error, {loc, message}}
    end
  end

  defp node_to_ast(
         %PgQuery.BoolExpr{boolop: bool_op} = expr,
         %{args: args},
         _,
         %{env: env}
       ) do
    with {:ok, args} <- cast_unknowns(args, List.duplicate(:bool, length(args)), env) do
      case Enum.find(args, &(not Env.implicitly_castable?(env, &1.type, :bool))) do
        nil ->
          {fun, name, strict?} =
            case bool_op do
              # OR can handle nulls sometimes
              # e.g. select null or true => t
              :OR_EXPR -> {&pg_or/2, "or", false}
              :AND_EXPR -> {&pg_and/2, "and", false}
              :NOT_EXPR -> {&Kernel.not/1, "not", true}
            end

          func = %Func{
            implementation: fun,
            name: name,
            type: :bool,
            args: args,
            location: expr.location,
            strict?: strict?
          }

          func =
            case args do
              [_] -> func
              [_ | _] -> to_binary_operators(func)
            end

          {:ok, func}

        %{location: loc} = node ->
          {:error, {loc, "#{internal_node_to_error(node)} is not castable to bool"}}
      end
    end
  end

  defp node_to_ast(
         %PgQuery.TypeCast{},
         %{arg: arg, type_name: type},
         _,
         %{env: env}
       ) do
    case arg do
      %UnknownConst{} = unknown ->
        explicit_cast_const(infer_unknown(unknown), type, env)

      %{type: ^type} = subtree ->
        {:ok, subtree}

      %Const{} = known ->
        explicit_cast_const(known, type, env)

      %{type: _} = subtree ->
        as_dynamic_cast(subtree, type, env)
    end
  end

  defp node_to_ast(%PgQuery.FuncCall{} = call, _, _, _)
       when call.agg_order != []
       when not is_nil(call.agg_filter)
       when not is_nil(call.over)
       when call.agg_within_group
       when call.agg_star
       when call.agg_distinct,
       do: {:error, {call.location, "aggregation is not supported in this context"}}

  defp node_to_ast(
         %PgQuery.FuncCall{} = call,
         %{args: args},
         _,
         %{env: env}
       ) do
    with {:ok, choices} <- find_available_functions(call, env),
         {:ok, concrete} <- Lookups.pick_concrete_function_overload(choices, args, env),
         {:ok, args} <- cast_unknowns(args, concrete.args, env),
         {:ok, args} <- cast_implicit(args, concrete.args, env) do
      {:ok, from_concrete(concrete, args)}
    else
      {:error, {_loc, _msg}} = error ->
        error

      :error ->
        arg_list =
          Enum.map_join(args, ", ", fn
            %UnknownConst{} -> "unknown"
            %{type: type} -> to_string(type)
          end)

        {:error,
         {call.location,
          "Could not select a function overload for #{identifier(call.funcname)}(#{arg_list})"}}
    end
  end

  # Next block of overloads matches on `A_Expr`, which is any operator call, as well as special syntax calls (e.g. `BETWEEN` or `ANY`).
  # They all treat lexpr and rexpr differently, so we're just deferring to a concrete function implementation here for clarity.
  defp node_to_ast(
         %PgQuery.A_Expr{kind: kind, location: loc} = expr,
         children,
         _acc,
         %{env: env}
       ) do
    expr = Map.merge(expr, children)

    error_msg =
      "expression #{identifier(expr.name)} of #{inspect(kind)} is not currently supported"

    case {kind, expr.lexpr} do
      {:AEXPR_OP, nil} -> handle_unary_operator(expr, env)
      {:AEXPR_OP, _} -> handle_binary_operator(expr, env)
      # LIKE and ILIKE are expressed plainly as operators by the parser
      {:AEXPR_LIKE, _} -> handle_binary_operator(expr, env)
      {:AEXPR_ILIKE, _} -> handle_binary_operator(expr, env)
      {:AEXPR_DISTINCT, _} -> handle_distinct(expr, env)
      {:AEXPR_NOT_DISTINCT, _} -> handle_distinct(expr, env)
      {:AEXPR_IN, _} -> handle_in(expr, env)
      {:AEXPR_BETWEEN, _} -> handle_between(expr, env)
      {:AEXPR_BETWEEN_SYM, _} -> handle_between(expr, env)
      {:AEXPR_NOT_BETWEEN, _} -> handle_between(expr, env)
      {:AEXPR_NOT_BETWEEN_SYM, _} -> handle_between(expr, env)
      {:AEXPR_OP_ANY, _} -> handle_any_or_all(expr, env)
      {:AEXPR_OP_ALL, _} -> handle_any_or_all(expr, env)
      _ -> {:error, {loc, error_msg}}
    end
  end

  defp node_to_ast(
         %PgQuery.NullTest{argisrow: false, location: loc} = test,
         %{arg: arg},
         _,
         _
       ) do
    arg =
      case arg do
        %UnknownConst{} = unknown -> infer_unknown(unknown)
        arg -> arg
      end

    func =
      if test.nulltesttype == :IS_NULL, do: &Kernel.is_nil/1, else: &(not Kernel.is_nil(&1))

    {:ok,
     %Func{
       strict?: false,
       location: loc,
       args: [arg],
       implementation: func,
       type: :bool,
       name: Atom.to_string(test.nulltesttype)
     }}
  end

  defp node_to_ast(
         %PgQuery.BooleanTest{location: loc} = test,
         %{arg: arg},
         _,
         %{env: env}
       ) do
    with {:ok, [arg]} <- cast_unknowns([arg], [:bool], env) do
      if arg.type == :bool do
        func =
          case test.booltesttype do
            :IS_TRUE -> &(&1 == true)
            :IS_NOT_TRUE -> &(&1 != true)
            :IS_FALSE -> &(&1 == false)
            :IS_NOT_FALSE -> &(&1 != false)
            :IS_UNKNOWN -> &(&1 == nil)
            :IS_NOT_UNKNOWN -> &(&1 != nil)
          end

        {:ok,
         %Func{
           strict?: false,
           location: loc,
           args: [arg],
           implementation: func,
           type: :bool,
           name: Atom.to_string(test.booltesttype)
         }}
      else
        operator = unsnake(Atom.to_string(test.booltesttype))
        {:error, {loc, "argument of #{operator} must be bool, not #{arg.type}"}}
      end
    end
  end

  # This match only `... IN (SELECT ...)` sublinks
  defp node_to_ast(
         %PgQuery.SubLink{location: location, oper_name: [], sub_link_type: :ANY_SUBLINK},
         %{testexpr: testexpr},
         %{encountered_sublinks: nth_sublink},
         %{refs: refs}
       ) do
    testexpr_valid? =
      is_struct(testexpr, Ref) or
        (is_struct(testexpr, RowExpr) and Enum.all?(testexpr.elements, &is_struct(&1, Ref)))

    sublink_key = ["$sublink", "#{nth_sublink}"]

    cond do
      not testexpr_valid? ->
        {:error,
         {location,
          "currently, left side of `IN (SELECT ...)` can only be a column reference or a list of column references"}}

      {:array, testexpr.type} != Map.fetch!(refs, sublink_key) ->
        {:error,
         {location,
          "left side of `IN (SELECT ...)` has type #{readable(testexpr.type)} but subquery returns #{readable(Map.fetch!(refs, sublink_key))}"}}

      true ->
        {:ok,
         %Func{
           strict?: false,
           location: location,
           args: [
             testexpr,
             %Ref{
               path: ["$sublink", "#{nth_sublink}"],
               type: Map.fetch!(refs, ["$sublink", "#{nth_sublink}"]),
               location: location
             }
           ],
           type: :bool,
           name: "sublink_membership_check",
           implementation: &PgInterop.Sublink.member?/2
         }}
    end
  end

  defp node_to_ast(%PgQuery.SubLink{location: location}, _, _, _) do
    {:error, {location, "only `value IN (SELECT ...)` sublinks are supported right now"}}
  end

  defp node_to_ast(%PgQuery.ParamRef{} = ref, _, %{resolved_params: resolved}, %{
         params: params
       }) do
    case Map.fetch(resolved, ref.number) do
      {:ok, pre_resolved} ->
        {:ok, pre_resolved}

      :error ->
        case Map.fetch(params, to_string(ref.number)) do
          {:ok, value} ->
            {:ok,
             %UnknownConst{value: value, location: ref.location, meta: %{param_ref: ref.number}}}

          :error ->
            {:error, {ref.location, "parameter $#{ref.number} was not provided"}}
        end
    end
  end

  defp node_to_ast(%PgQuery.TypeName{} = name, %{names: names}, _, _) do
    with {:ok, type} <- get_type_from_pg_name(names, name.location) do
      case name.array_bounds do
        [_ | _] -> {:ok, {:array, type}}
        [] -> {:ok, type}
      end
    end
  end

  defp node_to_ast(%PgQuery.String{sval: str}, _, _, _) do
    {:ok, str}
  end

  defp node_to_ast(%PgQuery.List{}, %{items: items}, _, _) do
    {:ok, items}
  end

  defp node_to_ast(%PgQuery.RowExpr{location: location}, %{args: args}, _, _) do
    {:ok, %RowExpr{elements: args, type: {:row, Enum.map(args, & &1.type)}, location: location}}
  end

  # If nothing matched, fail
  defp node_to_ast(%type_module{} = node, _children, _, _) do
    {:error,
     {Map.get(node, :location, 0),
      "#{type_module |> Module.split() |> List.last()} is not supported in this context"}}
  end

  defp get_type_from_pg_name(["pg_catalog", type_name], _) when type_name in @valid_types,
    do: {:ok, String.to_existing_atom(type_name)}

  defp get_type_from_pg_name([type_name], _) when type_name in @valid_types,
    do: {:ok, String.to_existing_atom(type_name)}

  defp get_type_from_pg_name(type, loc),
    do: {:error, {loc, "unsupported type #{identifier(type)}"}}

  defp handle_unary_operator(%PgQuery.A_Expr{rexpr: rexpr, name: name} = expr, env) do
    find_operator_func(name, [rexpr], expr.location, env)
  end

  defp handle_binary_operator(%PgQuery.A_Expr{name: name} = expr, env) do
    find_operator_func(name, [expr.lexpr, expr.rexpr], expr.location, env)
  end

  defp handle_distinct(%PgQuery.A_Expr{kind: kind} = expr, env) do
    args = [expr.lexpr, expr.rexpr]

    fun =
      case kind do
        :AEXPR_DISTINCT -> :values_distinct?
        :AEXPR_NOT_DISTINCT -> :values_not_distinct?
      end

    with {:ok, func} <- find_operator_func(["<>"], args, expr.location, env) do
      # This is suboptimal at evaluation time, in that it duplicates same argument sub-expressions
      # to be at this level, as well as at the `=` operator level. I'm not sure how else to model
      # this as functions, without either introducing functions as arguments (to pass in the operator impl),
      # or without special-casing the `distinct` clause.
      {:ok,
       %Func{
         implementation: {Casting, fun},
         name: to_string(fun),
         type: :bool,
         args: func.args ++ [func],
         strict?: false
       }}
    end
  end

  defp handle_in(%PgQuery.A_Expr{name: name} = expr, env) do
    # `name` is "=" if it's `IN`, and "<>" if it's `NOT IN`.

    with {:ok, comparisons} <-
           Utils.map_while_ok(
             expr.rexpr,
             &find_operator_func(["="], [expr.lexpr, &1], expr.location, env)
           ),
         {:ok, reduced} <-
           build_bool_chain(
             %{name: "or", impl: &pg_or/2, strict?: false},
             comparisons,
             expr.location
           ) do
      # x NOT IN y is exactly equivalent to NOT (x IN y)
      case name do
        ["="] -> {:ok, reduced}
        ["<>"] -> negate(reduced)
      end
    end
  end

  defp handle_any_or_all(%PgQuery.A_Expr{lexpr: lexpr, rexpr: rexpr} = expr, env) do
    with {:ok, fake_rexpr} <- get_fake_array_elem(rexpr),
         {:ok, choices} <- find_available_operators(expr.name, 2, expr.location, env),
         # Get a fake element type for the array, if possible, to pick correct operator overload
         {:ok, %{args: [lexpr_type, rexpr_type], returns: :bool} = concrete} <-
           Lookups.pick_concrete_operator_overload(choices, [lexpr, fake_rexpr], env),
         {:ok, args} <- cast_unknowns([lexpr, rexpr], [lexpr_type, {:array, rexpr_type}], env),
         {:ok, [lexpr, rexpr]} <- cast_implicit(args, [lexpr_type, {:array, rexpr_type}], env) do
      bool_array =
        concrete
        |> from_concrete([lexpr, rexpr])
        |> Map.put(:map_over_array_in_pos, 1)

      {name, impl} =
        case expr.kind do
          :AEXPR_OP_ANY -> {"any", &Enum.any?/1}
          :AEXPR_OP_ALL -> {"all", &Enum.all?/1}
        end

      {:ok,
       %Func{
         implementation: impl,
         name: name,
         type: :bool,
         args: [bool_array]
       }}
    else
      {:error, {_loc, _msg}} = error -> error
      :error -> {:error, {expr.location, "Could not select an operator overload"}}
      {:ok, _} -> {:error, {expr.location, "ANY/ALL requires operator that returns bool"}}
    end
  end

  defp get_fake_array_elem(%UnknownConst{} = unknown), do: {:ok, unknown}

  defp get_fake_array_elem(%{type: {:array, inner_type}} = expr),
    do: {:ok, %{expr | type: inner_type}}

  defp get_fake_array_elem(other),
    do: {:error, {other.location, "argument of ANY must be an array"}}

  defp handle_between(%PgQuery.A_Expr{rexpr: [left_bound, right_bound]} = expr, env) do
    case expr.kind do
      :AEXPR_BETWEEN ->
        between(expr, left_bound, right_bound, env)

      :AEXPR_NOT_BETWEEN ->
        with {:ok, comparison} <- between(expr, left_bound, right_bound, env) do
          negate(comparison)
        end

      :AEXPR_BETWEEN_SYM ->
        between_sym(expr, left_bound, right_bound, env)

      :AEXPR_NOT_BETWEEN_SYM ->
        with {:ok, comparison} <- between_sym(expr, left_bound, right_bound, env) do
          negate(comparison)
        end
    end
  end

  defp between(expr, left_bound, right_bound, env) do
    with {:ok, left_comparison} <-
           find_operator_func(["<="], [left_bound, expr.lexpr], expr.location, env),
         {:ok, right_comparison} <-
           find_operator_func(["<="], [expr.lexpr, right_bound], expr.location, env),
         comparisons = [left_comparison, right_comparison],
         {:ok, reduced} <-
           build_bool_chain(
             %{name: "or", impl: &pg_and/2, strict?: false},
             comparisons,
             expr.location
           ) do
      {:ok, reduced}
    end
  end

  # This is suboptimal since it has to recalculate the subtree for the two comparisons
  defp between_sym(expr, left_bound, right_bound, env) do
    with {:ok, comparison1} <- between(expr, left_bound, right_bound, env),
         {:ok, comparison2} <- between(expr, right_bound, left_bound, env) do
      build_bool_chain(
        %{name: "or", impl: &pg_or/2, strict?: false},
        [comparison1, comparison2],
        expr.location
      )
    end
  end

  defp build_bool_chain(op, list, location) do
    {:ok,
     Enum.reduce(list, fn comparison, acc ->
       %Func{
         implementation: op.impl,
         name: op.name,
         type: :bool,
         args: [acc, comparison],
         location: location,
         strict?: op.strict?
       }
     end)}
  end

  # Returns an unreduced function so that caller has access to args
  @spec find_operator_func([String.t()], [term(), ...], non_neg_integer(), Env.t()) ::
          {:ok, %Func{}} | {:error, {non_neg_integer(), String.t()}}
  defp find_operator_func(name, args, location, %Env{} = env) do
    # Operators cannot have arity other than 1 or 2
    arity = if(match?([_, _], args), do: 2, else: 1)

    with {:ok, choices} <- find_available_operators(name, arity, location, env),
         {:ok, concrete} <- Lookups.pick_concrete_operator_overload(choices, args, env),
         {:ok, args} <- cast_unknowns(args, concrete.args, env),
         {:ok, args} <- cast_implicit(args, concrete.args, env) do
      {:ok, from_concrete(concrete, args)}
    else
      {:error, {_loc, _msg}} = error -> error
      :error -> {:error, {location, "Could not select an operator overload"}}
    end
  end

  defp explicit_cast_const(%Const{type: type, value: value} = const, target_type, %Env{} = env) do
    with {:ok, %Func{} = func} <- as_dynamic_cast(const, target_type, env) do
      case try_applying(%{func | args: [value]}) do
        {:ok, const} ->
          {:ok, const}

        {:error, _} ->
          {:error,
           {const.location,
            "could not cast value #{inspect(value)} from #{readable(type)} to #{readable(target_type)}"}}
      end
    end
  end

  defp find_available_functions(%PgQuery.FuncCall{} = call, %{funcs: funcs}) do
    name = identifier(call.funcname)
    arity = length(call.args)

    case Map.fetch(funcs, {name, arity}) do
      {:ok, options} -> {:ok, options}
      :error -> {:error, {call.location, "unknown or unsupported function #{name}/#{arity}"}}
    end
  end

  defp find_available_operators(name, arity, location, %{operators: operators})
       when arity in [1, 2] do
    name = identifier(name)

    case Map.fetch(operators, {name, arity}) do
      {:ok, options} ->
        {:ok, options}

      :error ->
        {:error,
         {location, "unknown #{if arity == 1, do: "unary", else: "binary"} operator #{name}"}}
    end
  end

  @spec as_dynamic_cast(tree_part(), Env.pg_type(), Env.t()) ::
          {:ok, tree_part()} | {:error, {non_neg_integer(), String.t()}}
  defp as_dynamic_cast(%{type: type, location: loc} = arg, target_type, env) do
    case Env.find_cast_function(env, type, target_type) do
      {:ok, :as_is} ->
        {:ok, %{arg | type: target_type}}

      {:ok, :array_cast, impl} ->
        {:ok,
         %Func{
           location: loc,
           type: extract_base_type_name(target_type),
           args: [arg],
           implementation: impl,
           map_over_array_in_pos: 0,
           name: "#{readable(type)}_to_#{readable(target_type)}"
         }}

      {:ok, impl} ->
        {:ok,
         %Func{
           location: loc,
           type: target_type,
           args: [arg],
           implementation: impl,
           name: "#{readable(type)}_to_#{readable(target_type)}"
         }}

      :error ->
        {:error,
         {loc, "unknown cast from type #{readable(type)} to type #{readable(target_type)}"}}
    end
  end

  defp readable(:unknown), do: "unknown"
  defp readable({:array, type}), do: "#{readable(type)}[]"
  defp readable({:enum, type}), do: "enum #{type}"
  defp readable({:internal, type}), do: "internal type #{readable(type)}"
  defp readable({:row, types}), do: "row of (#{Enum.map_join(types, ", ", &readable/1)})"
  defp readable(type), do: to_string(type)

  defp try_cast_implicit(processed_args, arg_list, env) do
    {:ok,
     Enum.zip_with(processed_args, arg_list, fn
       %{type: type} = arg, type ->
         arg

       %{type: {:internal, _}} = arg, _ ->
         arg

       %{type: from_type} = arg, to_type ->
         case Map.fetch(env.implicit_casts, {from_type, to_type}) do
           {:ok, :as_is} ->
             arg

           {:ok, impl} ->
             %Func{
               location: arg.location,
               type: to_type,
               args: [arg],
               implementation: impl,
               name: "#{from_type}_to_#{to_type}"
             }

           :error ->
             throw(
               {:error,
                {arg.location, "#{readable(from_type)} cannot be matched to #{readable(to_type)}"}}
             )
         end
     end)}
  catch
    {:error, {_loc, _message}} = error -> error
  end

  defp cast_implicit(processed_args, arg_list, env) do
    {:ok,
     Enum.zip_with(processed_args, arg_list, fn
       %{type: type} = arg, type ->
         arg

       %{type: {:array, from_type}} = arg, {:array, to_type} ->
         case Map.fetch!(env.implicit_casts, {from_type, to_type}) do
           :as_is ->
             arg

           impl ->
             %Func{
               location: arg.location,
               type: to_type,
               args: [arg],
               implementation: impl,
               name: "#{from_type}_to_#{to_type}",
               map_over_array_in_pos: 0
             }
         end

       %{type: from_type} = arg, to_type ->
         case Map.fetch!(env.implicit_casts, {from_type, to_type}) do
           :as_is ->
             arg

           impl ->
             %Func{
               location: arg.location,
               type: to_type,
               args: [arg],
               implementation: impl,
               name: "#{from_type}_to_#{to_type}"
             }
         end
     end)}
  catch
    {:error, {_loc, _message}} = error -> error
  end

  defp cast_unknowns(processed_args, arg_list, env) do
    {:ok,
     Enum.zip_with(processed_args, arg_list, fn
       %UnknownConst{value: nil, location: loc, meta: meta}, type ->
         %Const{type: type, value: nil, location: loc, meta: meta}

       %UnknownConst{value: value, location: loc, meta: meta}, type ->
         case Env.parse_const(env, value, type) do
           {:ok, value} -> %Const{type: type, location: loc, value: value, meta: meta}
           :error -> throw({:error, {loc, "invalid syntax for type #{readable(type)}: #{value}"}})
         end

       arg, _ ->
         arg
     end)}
  catch
    {:error, {_loc, _message}} = error -> error
  end

  defp infer_unknown(%UnknownConst{value: nil, location: loc}),
    do: %Const{type: :unknown, value: nil, location: loc}

  defp infer_unknown(%UnknownConst{value: value, location: loc}),
    do: %Const{type: :text, value: value, location: loc}

  defp make_const(kind, value, loc) do
    case {kind, value} do
      {:ival, value} when is_pg_int4(value) ->
        {:ok, %Const{type: :int4, value: value, location: loc}}

      {:ival, value} when is_pg_int8(value) ->
        {:ok, %Const{type: :int8, value: value, location: loc}}

      {:fval, value} ->
        {:ok, %Const{type: :numeric, value: String.to_float(value), location: loc}}

      {:boolval, value} ->
        {:ok, %Const{type: :bool, value: value, location: loc}}

      {:sval, value} ->
        {:ok, %Const{type: :text, value: value, location: loc}}

      {:bsval, _} ->
        {:error, {loc, "BitString values are not supported"}}
    end
  end

  defp from_concrete(concrete, args) do
    # Commutative overload is an operator overload that accepts same arguments
    # as normal overload but in reverse order. This only matters/happens when
    # arguments are of different types (e.g. `date + int8`)
    commutative_overload? = Map.get(concrete, :commutative_overload?, false)

    %Func{
      implementation: concrete.implementation,
      name: concrete.name,
      args: if(commutative_overload?, do: Enum.reverse(args), else: args),
      type: concrete.returns,
      # These two fields are always set by macro generation, but not always in tests
      strict?: Map.get(concrete, :strict?, true),
      immutable?: Map.get(concrete, :immutable?, true)
    }
  end

  defp do_maybe_reduce(%Func{} = fun), do: maybe_reduce(fun)
  defp do_maybe_reduce(%Const{} = const), do: {:ok, const}
  defp do_maybe_reduce(%Ref{} = ref), do: {:ok, ref}
  defp do_maybe_reduce(%UnknownConst{} = unknown), do: {:ok, unknown}

  defp do_maybe_reduce(%Array{elements: elements} = array) do
    if Enum.all?(elements, &is_struct(&1, Const)) do
      {:ok,
       %Const{type: array.type, value: Enum.map(elements, & &1.value), location: array.location}}
    else
      {:ok, array}
    end
  end

  defp do_maybe_reduce(%RowExpr{elements: elements} = row_expr) do
    if Enum.all?(elements, &is_struct(&1, Const)) do
      {:ok,
       %Const{
         type: row_expr.type,
         value: List.to_tuple(Enum.map(elements, & &1.value)),
         location: row_expr.location
       }}
    else
      {:ok, row_expr}
    end
  end

  defp do_maybe_reduce(list) when is_list(list), do: Utils.map_while_ok(list, &do_maybe_reduce/1)

  # Try reducing the function if all it's arguments are constants
  # but only immutable functions (although currently all functions are immutable)
  @spec maybe_reduce(%Func{}) ::
          {:ok, %Func{} | %Const{}} | {:error, {non_neg_integer(), String.t()}}
  defp maybe_reduce(%Func{immutable?: false} = func), do: {:ok, func}

  defp maybe_reduce(%Func{args: args, variadic_arg: position} = func) do
    {args, {any_nils?, all_const?}} =
      args
      |> Enum.with_index()
      |> Enum.map_reduce({false, true}, fn
        # Variadic argument can either be an array it can't be resolved to a constant, or a constant already
        # We need to check both cases. Variadic remains a bit of a hack, and maybe we should replace it with a function chain.
        {%Const{value: value}, ^position}, {any_nils?, all_const?} when is_list(value) ->
          {value, {any_nils? or Enum.any?(value, &is_nil/1), all_const?}}

        # Seeing an unreduced array guarantees that one of the elements is not a constant
        {%Array{elements: elements}, _}, {any_nils?, _all_const?} ->
          {elements, {any_nils? or Enum.any?(elements, &match?(%Const{value: nil}, &1)), false}}

        {%Const{value: nil}, _}, {_any_nils?, all_const?} ->
          {nil, {true, all_const?}}

        {%Const{value: value}, _}, {any_nils?, all_const?} ->
          {value, {any_nils?, all_const?}}

        _, {any_nils?, _all_const?} ->
          {:not_used, {any_nils?, false}}
      end)

    cond do
      # Strict functions will always collapse to nil
      func.strict? and any_nils? ->
        {:ok, %Const{type: func.type, location: func.location, value: nil}}

      # Otherwise we don't have enough information to run this at "compile time"
      not all_const? ->
        {:ok, func}

      # But if all are consts and either function is not strict or there are no nils, we can try applying
      true ->
        try_applying(%{func | args: args})
    end
  end

  defp try_applying(
         %Func{args: args, implementation: impl, map_over_array_in_pos: map_over_array_in_pos} =
           func
       ) do
    value =
      case {impl, map_over_array_in_pos} do
        {{module, function}, nil} ->
          apply(module, function, args)

        {function, nil} ->
          apply(function, args)

        {{module, function}, 0} ->
          Utils.deep_map(hd(args), &apply(module, function, [&1 | tl(args)]))

        {function, 0} ->
          Utils.deep_map(hd(args), &apply(function, [&1 | tl(args)]))

        {{module, function}, pos} ->
          Utils.deep_map(
            Enum.at(args, pos),
            &apply(module, function, List.replace_at(args, pos, &1))
          )

        {function, pos} ->
          Utils.deep_map(Enum.at(args, pos), &apply(function, List.replace_at(args, pos, &1)))
      end

    {:ok,
     %Const{
       value: value,
       type: if(not is_nil(map_over_array_in_pos), do: {:array, func.type}, else: func.type),
       location: func.location
     }}
  rescue
    e ->
      Logger.warning(Exception.format(:error, e, __STACKTRACE__))
      {:error, {func.location, "Failed to apply function to constant arguments"}}
  end

  defp identifier(ref) do
    case Enum.map(ref, &wrap_identifier/1) do
      ["pg_catalog", func] -> func
      identifier -> Enum.join(identifier, ".")
    end
  end

  defp wrap_identifier(%PgQuery.Node{} = node),
    do: node |> unwrap_node_string() |> wrap_identifier()

  defp wrap_identifier(%PgQuery.String{sval: val}), do: wrap_identifier(val)

  defp wrap_identifier(ref) when is_binary(ref) do
    if String.match?(ref, ~r/^[[:lower:]_][[:lower:][:digit:]_]*$/u) do
      ref
    else
      ~s|"#{String.replace(ref, ~S|"|, ~S|""|)}"|
    end
  end

  defp internal_node_to_error(%Ref{path: path, type: type}),
    do: "reference #{identifier(path)} of type #{type}"

  defp internal_node_to_error(%Func{type: type, name: name}),
    do: "function #{name} returning #{type}"

  def find_refs(tree, acc \\ %{})
  def find_refs(%Const{}, acc), do: acc
  def find_refs(%Ref{path: path, type: type}, acc), do: Map.put_new(acc, path, type)

  def find_refs(%Func{args: args}, acc),
    do: Enum.reduce(args, acc, &find_refs/2)

  def find_refs(%Array{elements: elements}, acc),
    do: Enum.reduce(elements, acc, &find_refs/2)

  def find_refs(%RowExpr{elements: elements}, acc),
    do: Enum.reduce(elements, acc, &find_refs/2)

  defp unsnake(string) when is_binary(string), do: :binary.replace(string, "_", " ", [:global])

  def unwrap_node_string(%PgQuery.Node{node: {:string, %PgQuery.String{sval: sval}}}), do: sval

  def unwrap_node_string(%PgQuery.Node{node: {:a_const, %PgQuery.A_Const{val: {:sval, sval}}}}),
    do: unwrap_node_string(sval)

  defp negate(tree_part) do
    {:ok,
     %Func{
       implementation: &Kernel.not/1,
       name: "not",
       type: :bool,
       args: [tree_part],
       location: tree_part.location
     }}
  end

  defp extract_base_type_name({:array, type}), do: extract_base_type_name(type)
  defp extract_base_type_name({:enum, type}), do: type
  defp extract_base_type_name(type), do: type

  defp build_index_structure(index) do
    {:index, index}
  end

  defp build_slice_structure(lower_idx, upper_idx) do
    {:slice, lower_idx, upper_idx}
  end

  defp round_numerics(args) do
    Utils.map_while_ok(args, fn
      %{type: x} = arg when x in [:numeric, :float4, :float8] ->
        {:ok,
         %Func{
           location: arg.location,
           type: :int8,
           args: [arg],
           implementation: &Kernel.round/1,
           name: "round"
         }}

      arg ->
        {:ok, arg}
    end)
  end

  # to_binary_operators/1 coverts a function with more than two arguments to a tree of binary operators
  defp to_binary_operators(%Func{args: [_, _]} = func) do
    # The function is already a binary operator (it has two arguments) so just return the function
    func
  end

  defp to_binary_operators(%Func{args: [arg | args]} = func) do
    # The function has more than two arguments, reduce the number of arguments to two: the first argument and a binary operator
    %{func | args: [arg, to_binary_operators(%{func | args: args})]}
  end

  defp rebuild_query_with_substituted_parts(query, ctx) do
    with {:ok, {rebuilt_protobuf, _}} <-
           Walker.accumulating_fold(
             query,
             &replace_query_parts/4,
             fn
               preimage, _, _, acc, _ when is_struct(preimage, PgQuery.SubLink) ->
                 {:ok, %{acc | encountered_sublinks: acc.encountered_sublinks + 1}}

               _, _, _, acc, _ ->
                 {:ok, acc}
             end,
             %{encountered_sublinks: 0},
             ctx
           ) do
      %PgQuery.ParseResult{
        version: 150_001,
        stmts: [
          %PgQuery.RawStmt{
            stmt: %PgQuery.Node{
              node:
                {:select_stmt,
                 %PgQuery.SelectStmt{
                   where_clause: rebuilt_protobuf
                 }}
            }
          }
        ]
      }
      |> PgQuery.protobuf_to_query!()
      |> String.replace_prefix("SELECT WHERE ", "")
    end
  end

  defp replace_query_parts(
         %PgQuery.ParamRef{number: number, location: location},
         _,
         _,
         {original_params, resolved_params, _}
       ) do
    %Const{type: type} = Map.fetch!(resolved_params, number)

    {:ok,
     %PgQuery.TypeCast{
       arg: %PgQuery.Node{
         node:
           {:a_const,
            %PgQuery.A_Const{
              val: {:sval, %PgQuery.String{sval: Map.fetch!(original_params, to_string(number))}}
            }}
       },
       type_name: %PgQuery.TypeName{
         names: [
           %PgQuery.Node{
             node: {:string, %PgQuery.String{sval: to_string(extract_base_type_name(type))}}
           }
         ],
         type_oid: 0,
         setof: false,
         pct_type: false,
         typmods: [],
         typemod: -1,
         array_bounds:
           if(match?({:array, _}, type),
             do: [
               %PgQuery.Node{
                 node: {:integer, %PgQuery.Integer{ival: -1}}
               }
             ],
             else: []
           ),
         location: location
       },
       location: location
     }}
  end

  defp replace_query_parts(%PgQuery.Node{node: {:param_ref, _}}, %{node: new_typecast}, _, _) do
    {:ok, %PgQuery.Node{node: {:type_cast, new_typecast}}}
  end

  defp replace_query_parts(%PgQuery.Node{node: {type, _}}, %{node: child}, _, _) do
    {:ok, %PgQuery.Node{node: {type, child}}}
  end

  defp replace_query_parts(
         %PgQuery.SubLink{} = sublink,
         %{testexpr: testexpr},
         %{encountered_sublinks: nth_sublink},
         {_, _, sublink_queries}
       ) do
    %{stmts: [%{stmt: select_node}]} =
      Map.fetch!(sublink_queries, nth_sublink) |> PgQuery.parse!()

    {:ok, %PgQuery.SubLink{sublink | testexpr: testexpr, subselect: select_node}}
  end

  defp replace_query_parts(node, children, _, _) when map_size(children) == 0, do: {:ok, node}

  defp replace_query_parts(anything_with_children, children, _, _) do
    {:ok, Map.merge(anything_with_children, children)}
  end
end
