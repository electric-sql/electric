defmodule Electric.Replication.Eval.Lookups do
  alias Electric.Utils
  alias Electric.Replication.Eval.Env

  @doc """
  Given multiple possible operator overloads (same name and arity), try to
  find a concrete implementation that matches the argument types.

  Operators can only be 1 or 2-arity.

  Rules for picking a operation overload closely mimic those outlined in [postgres
  documentation](https://www.postgresql.org/docs/current/typeconv-oper.html), and
  mostly match `pick_concrete_function_overload/3`.
  """
  @spec pick_concrete_operator_overload(list(), [struct()], Env.t()) :: {:ok, term()} | :error
  def pick_concrete_operator_overload(choices, args, env) do
    # If only one of the arguments is unknown, we try to assume it's type is the same
    {arg_types, maybe_assumed_arg_types, any_unknowns?} =
      case args do
        [%{type: type}] -> {[type], nil, false}
        [_] -> {[:unknown], nil, true}
        [%{type: type1}, %{type: type2}] -> {[type1, type2], nil, false}
        [%{type: type1}, _] -> {[type1, :unknown], [type1, type1], true}
        [_, %{type: type1}] -> {[:unknown, type1], [type1, type1], true}
        [_, _] -> {[:unknown, :unknown], nil, true}
      end

    no_assume? = is_nil(maybe_assumed_arg_types)

    # This is the main difference with `pick_concrete_function_overload` - we're trying to match assumed types before trying anything else
    with :error <- overload_find_exact_match(choices, arg_types, any_unknowns?),
         :error <- overload_find_exact_match(choices, maybe_assumed_arg_types, not no_assume?) do
      filter_overloads_on_heuristics(choices, arg_types, any_unknowns?, env)
    end
  end

  @doc """
  Given multiple possible function overloads (same name and arity), try to
  find a concrete implementation that matches the argument types.

  Rules for picking a function overload closely mimic those outlined in [postgres
  documentation](https://www.postgresql.org/docs/current/typeconv-func.html):

  1. Check if there is an overload where all variable types match exactly
  2. Check if only one overload remains based on implicit conversion rules
     (unknowns are considered always matching), discard those that cannot
     be applied even after implicit conversion
  3. Check if only one overload remains based on most exact type matches
  4. Keep overloads that accept most preferred types in each conversion spot
  5. If there are any unknowns, for each position first look for any overloads that
     accept `string` category, and if none found, check if all overloads accept
     the same type category. If that fails, keep all overloads, or pick any that
     don't accept picked category
  6. If there are both unknown and known arguments, and all known arguments have
     the same type category, assume unknowns have the same type category and look
     for overloads that fit.

  If exactly one overload matched after those steps, pick it, otherwise fail.
  """
  @spec pick_concrete_function_overload(list(), [struct()], Env.t()) ::
          {:ok, term()} | :error
  def pick_concrete_function_overload(choices, args, env) do
    {arg_types, any_unknowns?} =
      Enum.map_reduce(args, false, fn
        %{type: type}, any_unknowns? -> {type, any_unknowns?}
        _, _ -> {:unknown, true}
      end)

    with :error <- overload_find_exact_match(choices, arg_types, any_unknowns?) do
      filter_overloads_on_heuristics(choices, arg_types, any_unknowns?, env)
    end
  end

  defp filter_overloads_on_heuristics(choices, arg_types, any_unknowns?, env) do
    steps = [
      &filter_overloads_on_implicit_conversion/4,
      &filter_overloads_on_most_exact_match/4,
      &filter_overloads_on_most_preferred/4,
      &filter_overloads_on_unknown_categories/4,
      &filter_overloads_using_knowns/4
    ]

    # Apply all filters, halting if only one or none options remain after filtering
    Enum.reduce_while(steps, choices, fn
      _, [] ->
        {:halt, []}

      fun, choices ->
        case fun.(choices, arg_types, any_unknowns?, env) do
          [found] -> {:halt, {:ok, found}}
          choices -> {:cont, choices}
        end
    end)
    |> case do
      {:ok, choice} -> {:ok, choice}
      _ -> :error
    end
  end

  # Exact matches are possible only if there are no unknowns
  defp overload_find_exact_match(_, _, true), do: :error

  defp overload_find_exact_match(choices, args, false) do
    case Enum.find(choices, &(&1.args == args)) do
      nil -> :error
      found -> {:ok, found}
    end
  end

  defp filter_overloads_on_implicit_conversion(choices, args, _, env) do
    Enum.filter(choices, &Env.can_implicitly_coerce_types?(env, args, &1.args))
  end

  # "Most exact" here is defined as "how many arguments of the function do match exactly with provided"
  defp filter_overloads_on_most_exact_match(choices, args, _, _) do
    Utils.all_max_by(choices, &count_exact_matches(&1, args))
  end

  defp count_exact_matches(%{args: args}, target_args) do
    Enum.zip_reduce(args, target_args, 0, fn
      arg1, arg2, acc when arg1 == arg2 -> acc + 1
      _, _, acc -> acc
    end)
  end

  defp filter_overloads_on_most_preferred(choices, args, _, env) do
    Utils.all_max_by(choices, &count_preferred(&1, args, env))
  end

  defp count_preferred(%{args: args}, target_args, env) do
    Enum.zip_reduce(args, target_args, 0, fn
      # If conversion is not required, don't count
      arg1, arg2, acc when arg1 == arg2 -> acc
      # Otherwise, count preferred
      arg1, _, acc -> if(Env.is_preferred?(env, arg1), do: acc + 1, else: acc)
    end)
  end

  defp filter_overloads_on_unknown_categories(choices, _, false, _), do: choices

  defp filter_overloads_on_unknown_categories(choices, args, _, env) do
    # For all `:unknown` positions in `args`, check if either
    #   - any of choices have string type category in that position
    #   - or all of choices accept the same type category in that position.
    # If either is true for all positions, use the inferred type categories to keep
    # the functions that match them. If none left, keep all.
    type_categories =
      [args | Enum.map(choices, & &1.args)]
      |> Enum.zip()
      |> Enum.map(fn
        [:unknown | arg_lists] ->
          arg_lists
          |> Enum.map(&Env.get_type_category(env, &1))
          |> Enum.frequencies()
          |> case do
            # At least one `:string` category is present, use it
            %{string: _} -> :string
            # All choices agree in this position, use it
            m when map_size(m) == 1 -> List.first(Map.keys(m))
            # Oh well
            _ -> throw(:multiple_category_candidates_in_same_position)
          end

        _ ->
          nil
      end)

    case Enum.filter(choices, &args_match_type_categories?(&1, type_categories, env)) do
      # Filtered too harsh, keep all
      [] -> choices
      results -> results
    end
  catch
    # Could not determine anything, keep all
    :multiple_category_candidates_in_same_position -> choices
  end

  defp filter_overloads_using_knowns(choices, _, false, _), do: choices

  defp filter_overloads_using_knowns(choices, args, _, env) do
    # If all known args are of the exact same type, then we can apply the heuristic
    # of assuming unknowns are also of the same type
    arg_count = length(args)

    case Enum.uniq(args) do
      # Only unknowns, nothing we can do
      [:unknown] ->
        choices

      # Exactly one type, check for options
      [type, :unknown] ->
        args = List.duplicate(type, arg_count)
        filter_overloads_on_implicit_conversion(choices, args, false, env)

      # Exactly one type, check for options
      [:unknown, type] ->
        args = List.duplicate(type, arg_count)
        filter_overloads_on_implicit_conversion(choices, args, false, env)

      # More than one type, bail
      _ ->
        choices
    end
  end

  defp args_match_type_categories?(func, categories, env) do
    func.args
    |> Enum.zip_with(categories, &(Env.get_type_category(env, &1) == &2))
    |> Enum.all?()
  end
end
