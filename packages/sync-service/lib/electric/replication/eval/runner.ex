defmodule Electric.Replication.Eval.Runner do
  require Logger
  alias Electric.Utils
  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.Eval.Env
  alias Electric.Replication.Eval.Parser.{Const, Func, Ref, RowExpr, Array}

  @doc """
  Generate a ref values object based on the record and a given table name

  ## Examples

      iex> used_refs = %{["id"] => :int8, ["created_at"] => :timestamp}
      iex> record_to_ref_values(used_refs, %{"id" => "80", "created_at" => "2020-01-01T11:00:00Z"})
      %{
        ["id"] => 80,
        ["created_at"] => ~N[2020-01-01 11:00:00]
      }
  """
  @spec record_to_ref_values(Expr.used_refs(), map(), Env.t()) :: {:ok, map()} | :error
  def record_to_ref_values(used_refs, record, env \\ Env.new()) do
    used_refs
    # Keep only used refs that are pointing to current table
    |> Enum.filter(&match?({[_], _}, &1))
    |> Enum.reduce_while({:ok, %{}}, fn {[key] = path, type}, {:ok, acc} ->
      value = record[key]

      case Env.parse_const(env, value, type) do
        {:ok, value} ->
          {:cont, {:ok, Map.put(acc, path, value)}}

        :error ->
          Logger.warning(
            "Could not parse #{inspect(value)} as #{inspect(type)} while casting #{inspect(key)}"
          )

          {:halt, :error}
      end
    end)
  end

  def execute_for_record(expr, record, extra_refs \\ %{}) do
    with {:ok, ref_values} <- record_to_ref_values(expr.used_refs, record),
         {:ok, evaluated} <- execute(expr, Map.merge(ref_values, extra_refs)) do
      {:ok, evaluated}
    end
  end

  @doc """
  Run a PG function parsed by `Electric.Replication.Eval.Parser` based on the inputs
  """
  @spec execute(Expr.t(), map(), keyword()) :: {:ok, term()} | {:error, {%Func{}, [term()]}}
  def execute(%Expr{} = tree, ref_values, opts \\ []) do
    ctx = %{refs: ref_values, subquery_member?: Keyword.get(opts, :subquery_member?)}
    execute_node(tree.eval, ctx)
  catch
    {:could_not_compute, func} -> {:error, func}
  end

  defp execute_node(%Const{value: value}, _ctx), do: {:ok, value}

  defp execute_node(
         %Ref{path: ["$sublink", _] = path},
         %{refs: refs, subquery_member?: subquery_member?}
       )
       when is_function(subquery_member?, 2) do
    {:ok, Map.get(refs, path, {:subquery_ref, path})}
  end

  defp execute_node(%Ref{path: path}, %{refs: refs}), do: {:ok, Map.fetch!(refs, path)}

  defp execute_node(%Array{elements: elements}, ctx) do
    Utils.map_while_ok(elements, &execute_node(&1, ctx))
  end

  defp execute_node(%RowExpr{elements: elements}, ctx) do
    with {:ok, elements} <- Utils.map_while_ok(elements, &execute_node(&1, ctx)) do
      {:ok, List.to_tuple(elements)}
    end
  end

  defp execute_node(
         %Func{name: "coalesce", variadic_arg: 0, args: [%Array{elements: elements}]},
         ctx
       ) do
    execute_coalesce(elements, ctx)
  end

  defp execute_node(
         %Func{name: "sublink_membership_check"} = func,
         %{subquery_member?: subquery_member?} = ctx
       )
       when is_function(subquery_member?, 2) do
    with {:ok, [value, {:subquery_ref, path}]} <-
           Utils.map_while_ok(func.args, &execute_node(&1, ctx)) do
      {:ok,
       try do
         subquery_member?.(path, value)
       rescue
         _ -> throw({:could_not_compute, %{func | args: [value, {:subquery_ref, path}]}})
       end}
    end
  end

  defp execute_node(%Func{args: args} = func, ctx) do
    with {:ok, args} <- Utils.map_while_ok(args, &execute_node(&1, ctx)) do
      apply_func(func, args)
    end
  end

  defp execute_coalesce([], _ctx), do: {:ok, nil}

  defp execute_coalesce([arg | rest], ctx) do
    case execute_node(arg, ctx) do
      {:ok, nil} -> execute_coalesce(rest, ctx)
      {:ok, value} -> {:ok, value}
    end
  end

  defp apply_func(%Func{strict?: false} = func, args) do
    # For a non-strict function, we don't care about nil values in the arguments
    {:ok, try_apply(func, args)}
  end

  defp apply_func(%Func{strict?: true, variadic_arg: vararg_position} = func, args) do
    has_nils? =
      case vararg_position do
        nil -> Enum.any?(args, &is_nil/1)
        pos -> Enum.any?(Enum.at(args, pos), &is_nil/1) or Enum.any?(args, &is_nil/1)
      end

    if has_nils? do
      {:ok, nil}
    else
      {:ok, try_apply(func, args)}
    end
  end

  defp try_apply(
         %Func{implementation: impl, map_over_array_in_pos: map_over_array_in_pos} = func,
         args
       ) do
    case {impl, map_over_array_in_pos} do
      {{module, fun}, nil} ->
        apply(module, fun, args)

      {fun, nil} ->
        apply(fun, args)

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
  rescue
    _ ->
      # Anything could have gone wrong here
      throw({:could_not_compute, %{func | args: args}})
  end
end
