defmodule Electric.Replication.Eval.Runner do
  require Logger
  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.Eval.Env
  alias Electric.Replication.Eval.Parser.{Const, Func, Ref}

  @type value() :: binary() | integer() | float() | boolean()
  @type val_map() :: %{optional([String.t(), ...]) => value()}

  # allow for references to the current row as `this.column`, `row.column`
  # `old.column` or `new.column`
  @row_prefixes ["this", "row", "old", "new"]

  @doc """
  All the prefixes we allow to refer to the current row.
  """
  def row_prefixes, do: @row_prefixes

  @doc """
  Generate a ref values object based on the record and a given table name
  """
  @spec record_to_ref_values(Expr.used_refs(), map(), Env.t()) :: {:ok, map()} | :error
  def record_to_ref_values(used_refs, record, env \\ Env.new()) do
    used_refs
    # Keep only used refs that are pointing to current table
    |> Enum.filter(&is_row_reference?/1)
    |> Enum.reduce_while({:ok, %{}}, fn {path, type}, {:ok, acc} ->
      key =
        case path do
          [key] -> key
          [_this, key] -> key
        end

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

  defp is_row_reference?({[this, _key], _}) when this in @row_prefixes, do: true
  defp is_row_reference?({[_key], _}), do: true
  defp is_row_reference?(_kv), do: false

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

  defp do_execute(%Func{} = func, refs) do
    {args, has_nils?} =
      Enum.map_reduce(func.args, false, fn val, has_nils? ->
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

  defp try_apply(%Func{implementation: impl} = func, args) do
    case impl do
      {module, fun} -> apply(module, fun, args)
      fun when is_function(fun) -> apply(fun, args)
    end
  rescue
    _ ->
      # Anything could have gone wrong here
      throw({:could_not_compute, %{func | args: args}})
  end
end
