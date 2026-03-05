defprotocol Electric.Walkable do
  @fallback_to_any true

  @doc """
  Returns a keyword list with all children of the node that should be processed.

  The keys are the names of the children groups, and the values are the children themselves.
  Values can be both further `Electric.Walkable` structures, or a list of `Electric.Walkable` structures.
  If it's a list, all items will be processed.
  """
  def children(node)
end

defmodule Electric.Replication.Eval.Walker do
  @type children_map :: %{atom() => nil | struct() | [struct()]}

  @doc """
  Given a `Electric.Walkable` structure, visit every node and apply the `fold_fn` to it, then apply the `acc_fn` to the result and the accumulated value to
  get a new structure.

  `fold_fn` is called with the current node, the result of processing the children nodes, the accumulated value and the context.
  Result of processing children nodes is a map with the same keys as the node, but with replaced children instead of originals.
  This function is expected to return a replacement for the current node, and that replacement will be propagated to the parent node.

  `acc_fn` is called with the current node, the result of processing the current node, the result of processing the children nodes, the accumulated value and the context.
  This function is expected to return a new accumulated value.

  Both `fold_fn` and `acc_fn` are expected to return an ok tuple, or an error tuple, any other value will raise an error.
  Returning the error tuple will halt the traversal.

  Tree traversal is depth-first, with accumulator being updated after each node is processed. Next nodes will see the updated accumulator.

  This function takes an optional `ctx` argument, which is passed to `fold_fn` and `acc_fn` as the last argument.
  """
  @spec accumulating_fold(
          target :: struct() | nil,
          fold_fn :: fold_fn,
          acc_fn :: acc_fn,
          acc :: acc,
          ctx :: context
        ) :: {:error, any()} | {:ok, {result | nil, acc}}
        when acc: any(),
             context: any(),
             result: any(),
             fold_fn: (struct(), children_map(), acc, context -> {:ok, result} | {:error, any()}),
             acc_fn: (struct(), result, children_map, acc, context ->
                        {:ok, acc} | {:error, any()})

  def accumulating_fold(tree, fold_fn, acc_fn, acc, ctx \\ [])
  def accumulating_fold(nil, _, _, acc, _), do: {:ok, {nil, acc}}

  def accumulating_fold(tree, fold_fn, acc_fn, acc, ctx)
      when is_function(fold_fn, 4) and is_function(acc_fn, 5) do
    children = Electric.Walkable.children(tree)

    with {:ok, {results_by_group, acc}} <-
           process_child_groups(children, fold_fn, acc_fn, acc, ctx),
         {:ok, result} <- fold_fn.(tree, results_by_group, acc, ctx),
         {:ok, acc} <- acc_fn.(tree, result, results_by_group, acc, ctx) do
      {:ok, {result, acc}}
    else
      {:error, reason} ->
        {:error, reason}

      malformed ->
        raise RuntimeError,
              "Fold or accumulator function was supposed to return and ok or error tuple, but got: #{inspect(malformed)}\nwhen processing #{inspect(tree)}"
    end
  end

  @doc """
  Given a `Electric.Walkable` structure, visit every node and apply the `fold_fn` to it to get a new structure.

  `fold_fn` is called with the current node, the result of processing the children nodes and the context.
  Result of processing children nodes is a map with the same keys as the node, but with replaced children instead of originals.
  This function is expected to return a replacement for the current node, and that replacement will be propagated to the parent node.
  Returning the error tuple will halt the traversal.

  `fold_fn` is expected to return an ok tuple, or an error tuple, any other value will raise an error.

  This function takes an optional `ctx` argument, which is passed to `fold_fn` as the last argument.
  """
  @spec fold(target :: struct() | nil, fold_fn :: fold_fn, ctx :: context) ::
          {:error, any()} | {:ok, result}
        when context: any(),
             result: any(),
             fold_fn: (struct(), children_map(), context -> {:ok, result} | {:error, any()})
  def fold(tree, fold_fn, ctx \\ []) when is_function(fold_fn, 3) do
    with {:ok, {result, _}} <-
           accumulating_fold(
             tree,
             fn item, children, _, ctx -> fold_fn.(item, children, ctx) end,
             fn _, _, _, _, _ -> {:ok, nil} end,
             nil,
             ctx
           ) do
      {:ok, result}
    end
  end

  @doc """
  Given a `Electric.Walkable` structure, visit every node and apply the `reduce_fn` to it to get an accumulated value.

  `reduce_fn` is called with the current node, the accumulated value and the context.
  This function is expected to return an ok tuple, or an error tuple, any other value will raise an error.
  Returning the error tuple will halt the traversal.

  This function takes an optional `ctx` argument, which is passed to `reduce_fn` as the last argument.
  """
  @spec reduce(target :: struct() | nil, reduce_fn, acc, context) ::
          {:error, any()} | {:ok, acc}
        when acc: any(),
             context: any(),
             reduce_fn: (struct(), acc, context -> {:ok, acc} | {:error, any()})
  def reduce(tree, reduce_fn, acc, ctx \\ []) when is_function(reduce_fn, 3) do
    with {:ok, {_, acc}} <-
           accumulating_fold(
             tree,
             fn _, _, _, _ -> {:ok, nil} end,
             fn preimage, _postimage, _children, acc, ctx -> reduce_fn.(preimage, acc, ctx) end,
             acc,
             ctx
           ) do
      {:ok, acc}
    end
  end

  @doc """
  Same as `reduce/4`, but raises on error instead of returning an error tuple.
  """
  @spec reduce!(target :: struct() | nil, reduce_fn, acc, context) :: acc
        when acc: any(),
             context: any(),
             reduce_fn: (struct(), acc, context -> {:ok, acc} | {:error, any()})
  def reduce!(tree, reduce_fn, acc, ctx \\ []) do
    case reduce(tree, reduce_fn, acc, ctx) do
      {:ok, acc} -> acc
      {:error, reason} -> raise "Walker.reduce! failed: #{inspect(reason)}"
    end
  end

  defp process_child_groups(child_groups, fold_fn, acc_fn, acc, ctx) do
    Enum.reduce_while(child_groups, {:ok, {%{}, acc}}, fn
      {group_name, children}, {:ok, {results, acc}} when is_list(children) ->
        case process_children(children, fold_fn, acc_fn, acc, ctx) do
          {:error, reason} ->
            {:halt, {:error, reason}}

          {:ok, {result, acc}} ->
            {:cont, {:ok, {Map.put(results, group_name, result), acc}}}
        end

      {group_name, child}, {:ok, {results, acc}} ->
        case accumulating_fold(child, fold_fn, acc_fn, acc, ctx) do
          {:error, reason} ->
            {:halt, {:error, reason}}

          {:ok, {result, acc}} ->
            {:cont, {:ok, {Map.put(results, group_name, result), acc}}}
        end
    end)
  end

  defp process_children(children, fold_alg, acc_alg, acc, ctx, results_acc \\ [])

  defp process_children([], _fold_alg, _acc_alg, acc, _ctx, results_acc),
    do: {:ok, {Enum.reverse(results_acc), acc}}

  defp process_children([child | rest], fold_fn, acc_fn, acc, ctx, results_acc) do
    case accumulating_fold(child, fold_fn, acc_fn, acc, ctx) do
      {:error, reason} ->
        {:error, reason}

      {:ok, {result, acc}} ->
        process_children(rest, fold_fn, acc_fn, acc, ctx, [result | results_acc])
    end
  end
end

defimpl Electric.Walkable, for: PgQuery.Node do
  def children(%PgQuery.Node{node: {_, node}}), do: [node: node]
end

defimpl Electric.Walkable, for: PgQuery.A_ArrayExpr do
  def children(%PgQuery.A_ArrayExpr{elements: elements}), do: [elements: elements]
end

defimpl Electric.Walkable, for: PgQuery.A_Indirection do
  def children(%PgQuery.A_Indirection{arg: arg, indirection: indirection}),
    do: [arg: arg, indirection: indirection]
end

defimpl Electric.Walkable, for: PgQuery.A_Indices do
  def children(%PgQuery.A_Indices{lidx: lidx, uidx: uidx}), do: [lidx: lidx, uidx: uidx]
end

defimpl Electric.Walkable, for: PgQuery.ColumnRef do
  def children(%PgQuery.ColumnRef{fields: fields}), do: [fields: fields]
end

defimpl Electric.Walkable, for: PgQuery.BoolExpr do
  def children(%PgQuery.BoolExpr{args: args}), do: [args: args]
end

defimpl Electric.Walkable, for: PgQuery.TypeCast do
  def children(%PgQuery.TypeCast{arg: arg, type_name: type_name}),
    do: [arg: arg, type_name: type_name]
end

defimpl Electric.Walkable, for: PgQuery.FuncCall do
  def children(%PgQuery.FuncCall{args: args}), do: [args: args]
end

defimpl Electric.Walkable, for: PgQuery.A_Expr do
  def children(%PgQuery.A_Expr{lexpr: lexpr, rexpr: rexpr, name: name}),
    do: [lexpr: lexpr, rexpr: rexpr, name: name]
end

defimpl Electric.Walkable, for: PgQuery.NullTest do
  def children(%PgQuery.NullTest{arg: arg}), do: [arg: arg]
end

defimpl Electric.Walkable, for: PgQuery.BooleanTest do
  def children(%PgQuery.BooleanTest{arg: arg}), do: [arg: arg]
end

defimpl Electric.Walkable, for: PgQuery.TypeName do
  def children(%PgQuery.TypeName{names: names}), do: [names: names]
end

defimpl Electric.Walkable, for: PgQuery.List do
  def children(%PgQuery.List{items: items}), do: [items: items]
end

defimpl Electric.Walkable, for: PgQuery.SubLink do
  def children(%PgQuery.SubLink{testexpr: testexpr}),
    do: [testexpr: testexpr]
end

defimpl Electric.Walkable, for: PgQuery.ResTarget do
  def children(%PgQuery.ResTarget{val: val}), do: [val: val]
end

defimpl Electric.Walkable, for: PgQuery.RowExpr do
  def children(%PgQuery.RowExpr{args: args}), do: [args: args]
end

defimpl Electric.Walkable, for: PgQuery.SortBy do
  def children(%PgQuery.SortBy{node: node, use_op: use_op}), do: [use_op: use_op, node: node]
end

defimpl Electric.Walkable, for: Electric.Replication.Eval.Parser.Func do
  def children(%Electric.Replication.Eval.Parser.Func{args: args}), do: [args: args]
end

defimpl Electric.Walkable, for: Electric.Replication.Eval.Parser.Array do
  def children(%Electric.Replication.Eval.Parser.Array{elements: elements}),
    do: [elements: elements]
end

defimpl Electric.Walkable, for: Electric.Replication.Eval.Parser.RowExpr do
  def children(%Electric.Replication.Eval.Parser.RowExpr{elements: elements}),
    do: [elements: elements]
end

defimpl Electric.Walkable,
  for: [
    Electric.Replication.Eval.Parser.Const,
    Electric.Replication.Eval.Parser.Ref,
    Electric.Replication.Eval.Parser.UnknownConst
  ] do
  def children(_), do: %{}
end

defimpl Electric.Walkable, for: Any do
  def children(_), do: %{}
end
