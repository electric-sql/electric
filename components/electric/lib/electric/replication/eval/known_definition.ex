defmodule Electric.Replication.Eval.KnownDefinition do
  @moduledoc """
  Special module to be `use`-d to define translation of PostgreSQL
  operators and functions into Elixir calls.
  """
  defmacro __using__(_) do
    quote do
      import Electric.Replication.Eval.KnownDefinition

      Module.register_attribute(__MODULE__, :known_postgres_implementations, accumulate: true)

      @before_compile {Electric.Replication.Eval.KnownDefinition, :before_compile}
    end
  end

  @known_definition_keys [
    :args,
    :returns,
    :strict?,
    :immutable?,
    :commutative_overload?,
    :implementation,
    :name
  ]

  defmacro before_compile(env) do
    %{operator: operators, function: functions} =
      Module.get_attribute(env.module, :known_postgres_implementations)
      |> Enum.group_by(&{&1.kind, &1.name, &1.arity})
      |> Enum.group_by(fn {{kind, _, _}, _} -> kind end, fn {{_, name, arity}, overloads} ->
        overloads =
          Enum.map(overloads, fn overloads ->
            Map.take(overloads, @known_definition_keys)
          end)

        {{name, arity}, overloads}
      end)

    quote do
      def known_functions() do
        unquote(Macro.escape(Map.new(functions)))
      end

      def known_operators() do
        unquote(Macro.escape(Map.new(operators)))
      end
    end
  end

  def expand_categories(impl) do
    category = Enum.find([impl.returns | impl.args], &type_category_atom?/1)

    if not is_nil(category) do
      for concrete_type <- expand_type_category(category) do
        impl
        |> Map.update!(:args, &replace_category(&1, with: concrete_type))
        |> Map.update!(:returns, &replace_category(&1, with: concrete_type))
      end
    else
      [impl]
    end
  end

  @doc """
  Define a postgres operator or function and it's implementation in Elixir.
  """
  defmacro defpostgres(operator_or_func, opts, do_block \\ []) when is_binary(operator_or_func) do
    {immutable?, opts} = Keyword.pop(opts ++ do_block, :immutable?, true)
    {strict?, opts} = Keyword.pop(opts, :strict?, true)
    {commutative?, opts} = Keyword.pop(opts, :commutative?, false)

    {map, impl, insertion} =
      operator_or_func
      |> parse_definition(__CALLER__)
      |> Map.put(:defined_at, __CALLER__.line)
      |> Map.put(:immutable?, immutable?)
      |> Map.put(:strict?, strict?)
      |> Map.put(:commutative_overload?, false)
      |> validate_at_most_one_category()
      |> put_implementation_function(opts, __CALLER__)

    maps = build_commutative_definitions(map, commutative?, __CALLER__)

    quote do
      for map <- unquote(Macro.escape(maps)),
          definition <- unquote(__MODULE__).expand_categories(map) do
        definition
        |> Map.put(:implementation, unquote(impl))
        |> then(&Module.put_attribute(__MODULE__, :known_postgres_implementations, &1))
      end

      unquote(insertion)
    end
  end

  defmacro defcompare(datatype, opts) when is_binary(datatype) do
    case Macro.expand_literals(opts, __CALLER__) do
      [using: Kernel] ->
        for op <- ~w|= != < > <= >=|a do
          kernel_op = if(op == :=, do: :==, else: op)

          quote do
            map = %{
              kind: :operator,
              name: ~s|"#{unquote(op)}"|,
              arity: 2,
              args: [String.to_atom(unquote(datatype)), String.to_atom(unquote(datatype))],
              returns: :bool,
              defined_at: unquote(__CALLER__.line),
              immutable?: true,
              strict?: true,
              commutative_overload?: false,
              implementation: &(Kernel.unquote(kernel_op) / 2)
            }

            for definition <- unquote(__MODULE__).expand_categories(map) do
              Module.put_attribute(__MODULE__, :known_postgres_implementations, definition)
            end
          end
        end

      [using: compare_fn] ->
        validate_ampersand_fn(compare_fn, 2, __CALLER__, ":using")
        {definitions, insertions} = build_compare_operator(datatype, compare_fn, __CALLER__)

        quote do
          for definition <- unquote(Macro.escape(definitions)) do
            Module.put_attribute(__MODULE__, :known_postgres_implementations, definition)
          end

          unquote(insertions)
        end

      _ ->
        raise CompileError,
          line: __CALLER__.line,
          description:
            "defcompare must either specify `using: Kernel` to use Kernel comparison functions, or `using: &Module.fn/2` to use a comparison function that returns `:lt`, `:eq`, or `:gt`."
    end
  end

  defp build_compare_operator(datatype, func_ast, caller) do
    truth_table = %{
      =: [:eq],
      <: [:lt],
      <=: [:lt, :eq],
      >=: [:eq, :gt],
      >: [:gt],
      !=: [:lt, :gt]
    }

    {module, compare_fn, _} = ampersand_to_mfa(func_ast)

    for {op, expected_values} <- truth_table do
      func_name = :"__comparison_operator_#{datatype}_#{op}"

      op = %{
        kind: :operator,
        name: ~s|"#{op}"|,
        arity: 2,
        args: [String.to_atom(datatype), String.to_atom(datatype)],
        returns: :bool,
        defined_at: caller.line,
        immutable?: true,
        strict?: true,
        commutative_overload?: false,
        implementation: {caller.module, func_name}
      }

      definition =
        quote do
          def unquote(func_name)(arg1, arg2) do
            unquote(module).unquote(compare_fn)(arg1, arg2) in unquote(expected_values)
          end
        end

      {op, definition}
    end
    |> Enum.unzip()
  end

  # e.g.: + int4 -> int4
  @unary_op_regex ~r/^(?<operator>[+\-*\/<>=~!@#%^&|`?]+) (?<type>[[:alnum:]*_]+) -> (?<return_type>[[:alnum:]*_]+)$/
  # e.g.: int4 + int4 -> int4
  @binary_op_regex ~r/^(?<type1>[[:alnum:]*_]+) (?<operator>[+\-*\/<>=~!@#%^&|`?]+) (?<type2>[[:alnum:]*_]+) -> (?<return_type>[[:alnum:]*_]+)$/
  # e.g.: ceil(float4) -> int4
  @func_regex ~r/^(?<name>[[:alnum:]*_]+)\((?<args>[^\)]*)\) -> (?<return_type>[[:alnum:]*_]+)/

  defp parse_definition(operator_or_func, caller) do
    cond do
      Regex.match?(@unary_op_regex, operator_or_func) ->
        parse_unary_operator(operator_or_func)

      Regex.match?(@binary_op_regex, operator_or_func) ->
        parse_binary_operator(operator_or_func)

      Regex.match?(@func_regex, operator_or_func) ->
        parse_function(operator_or_func)

      true ->
        raise CompileError,
          line: caller.line,
          description:
            "defpostgres must specify either a function in form of `func(arg1) -> returns` or an operator, in form of `type1 + type2 -> returns`"
    end
  end

  defp parse_unary_operator(operator) do
    %{"operator" => operator, "type" => type, "return_type" => return} =
      Regex.named_captures(@unary_op_regex, operator)

    %{
      kind: :operator,
      name: ~s|"#{operator}"|,
      arity: 1,
      args: [String.to_atom(type)],
      returns: String.to_atom(return)
    }
  end

  defp parse_binary_operator(operator) do
    %{"operator" => operator, "type1" => type1, "type2" => type2, "return_type" => return} =
      Regex.named_captures(@binary_op_regex, operator)

    %{
      kind: :operator,
      name: ~s|"#{operator}"|,
      arity: 2,
      args: [String.to_atom(type1), String.to_atom(type2)],
      returns: String.to_atom(return)
    }
  end

  defp parse_function(function) do
    %{"name" => name, "args" => args, "return_type" => return} =
      Regex.named_captures(@func_regex, function)

    # TODO: doesn't support default or optional arguments
    arg_types =
      args
      |> String.split(",", trim: true)
      |> Enum.map(fn arg ->
        String.to_atom(String.trim(arg))
      end)

    %{
      kind: :function,
      name: name,
      arity: length(arg_types),
      args: arg_types,
      returns: String.to_atom(return)
    }
  end

  defp put_implementation_function(map, opts, caller) do
    {implementation, insertion} =
      case opts do
        [delegate: delegate] ->
          validate_ampersand_fn(delegate, map.arity, caller)

        [do: do_block] ->
          do_block_to_mfa(do_block, map.arity, caller)

        _ ->
          raise CompileError,
            line: caller.line,
            description:
              "defpostgres must have either a `delegate: &Mod.fun/1` or `do: def func(args)` block"
      end

    {map, implementation, insertion}
  end

  defp type_category_atom?(atom), do: atom in ~w|*numeric_type* *integral_type*|a

  defp expand_type_category(:"*numeric_type*"), do: ~w|int2 int4 int8 numeric float4 float8|a
  defp expand_type_category(:"*integral_type*"), do: ~w|int2 int4 int8|a

  defp replace_category(args, with: new) when is_list(args),
    do: Enum.map(args, &replace_category(&1, with: new))

  defp replace_category(arg, with: new), do: if(type_category_atom?(arg), do: new, else: arg)

  defp validate_ampersand_fn(ast, arity, caller, key \\ ":delegate")

  defp validate_ampersand_fn(
         {:&, _, [{:/, _, [{{:., _, [_, _]}, _, _}, arity]}]} = ast,
         target_arity,
         caller,
         _
       ) do
    if arity == target_arity do
      {ast, []}
    else
      raise CompileError,
        line: caller.line,
        description: "&#{Macro.to_string(ast)} doesn't match expected arity of #{target_arity}"
    end
  end

  defp validate_ampersand_fn({:&, _, _} = ast, _, caller, key) do
    raise CompileError,
      line: caller.line,
      description:
        "`#{key}` must be a &Mod.fun/1 function pointer to an external module, got #{Macro.to_string(ast)}"
  end

  defp validate_ampersand_fn(_, _, caller, key) do
    raise CompileError,
      line: caller.line,
      description: "`#{key}` must be a &Mod.fun/1 function pointer"
  end

  defp do_block_to_mfa({:__block__, _, contents} = do_block, target_arity, caller) do
    {name, arity, context} =
      contents
      |> Enum.filter(&match?({:def, _, _}, &1))
      |> Enum.map(&get_fun_name_arity/1)
      |> Enum.reduce(fn
        {name, arity, _}, {name, arity, _} = acc ->
          acc

        {name, arity, context}, {prev_name, prev_arity, _} ->
          raise CompileError,
            line: context[:line],
            description:
              "All `def`s in `defpostgres` must have the same name and arity, but found #{name}/#{arity} after #{prev_name}/#{prev_arity}"
      end)

    if arity == target_arity do
      {{caller.module, name}, do_block}
    else
      raise CompileError,
        line: context[:line],
        description: "def #{name}/#{arity} doesn't match expected arity of #{target_arity}"
    end
  rescue
    Enum.EmptyError ->
      raise CompileError,
        description: "At least 1 `def` should be present in the `do` block of `defpostgres"
  end

  defp do_block_to_mfa({_, ctx, _} = contents, target_arity, caller),
    do: do_block_to_mfa({:__block__, ctx, [contents]}, target_arity, caller)

  defp validate_at_most_one_category(%{defined_at: line, args: args} = map) do
    args
    |> Enum.map(&to_string/1)
    |> Enum.filter(&Regex.match?(~r/\*[[:alnum:]_]+\*/, &1))
    |> Enum.uniq()
    |> case do
      [_, _ | _] = keys ->
        raise CompileError,
          line: line,
          description:
            "defpostgres function cannot have more that one type category in definition, got #{inspect(keys)}"

      [category] when category not in ~w|*numeric_type* *integral_type*| ->
        raise CompileError,
          line: line,
          description: "unknown category #{category} - cannot expand definitions"

      _ ->
        map
    end
  end

  defp get_fun_name_arity({:def, context, [{:when, _, [{fun, _, args} | _]} | _]}),
    do: {fun, length(args), context}

  defp get_fun_name_arity({:def, context, [{fun, _, args} | _]}), do: {fun, length(args), context}

  defp ampersand_to_mfa({:&, _, [{:/, _, [{{:., _, [module, function]}, _, _}, arity]}]}) do
    {module, function, arity}
  end

  defp build_commutative_definitions(map, false, _caller), do: [map]

  defp build_commutative_definitions(%{kind: :function}, true, caller),
    do:
      raise(CompileError,
        line: caller.line,
        description: "functions cannot be commutative, only operators can"
      )

  defp build_commutative_definitions(%{arity: x}, true, caller) when x != 2,
    do:
      raise(CompileError,
        line: caller.line,
        description: "operator with arity #{x} cannot be commutative"
      )

  defp build_commutative_definitions(%{args: [arg, arg]}, true, caller),
    do:
      raise(CompileError,
        line: caller.line,
        description: "operators with same argument types are implicitly commutative"
      )

  defp build_commutative_definitions(%{args: [arg1, arg2]} = map, true, _caller),
    do: [map, %{map | args: [arg2, arg1], commutative_overload?: true}]
end
