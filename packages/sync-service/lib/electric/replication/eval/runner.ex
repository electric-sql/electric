defmodule Electric.Replication.Eval.Runner do
  require Logger
  alias Electric.Utils
  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.Eval.Env
  alias Electric.Replication.Eval.Parser.{Const, Func, Ref}

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

  @doc """
  Run a PG function parsed by `Electric.Replication.Eval.Parser` based on the inputs
  """
  @spec execute(Expr.t(), map()) :: {:ok, term()} | {:error, {%Func{}, [term()]}}
  def execute(%Expr{} = tree, ref_values) do
    {:ok, do_execute(tree.eval, ref_values)}
  catch
    {:could_not_compute, func} -> {:error, func}
  end

  defp do_execute(%Const{value: value}, _), do: value
  defp do_execute(%Ref{path: path}, refs), do: Map.fetch!(refs, path)

  defp do_execute(%Func{variadic_arg: vararg_position} = func, refs) do
    {args, has_nils?} =
      Enum.map_reduce(Enum.with_index(func.args), false, fn
        {val, ^vararg_position}, has_nils? ->
          Enum.map_reduce(val, has_nils?, fn val, has_nils? ->
            case do_execute(val, refs) do
              nil -> {nil, true}
              val -> {val, has_nils?}
            end
          end)

        {val, _}, has_nils? ->
          case do_execute(val, refs) do
            nil -> {nil, true}
            val -> {val, has_nils?}
          end
      end)

    # Strict functions don't get applied to nils, so if it's strict and any of the arguments is nil
    if not func.strict? or not has_nils? do
      try_apply(func, args)
    else
      nil
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
