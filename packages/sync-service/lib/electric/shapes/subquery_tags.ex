defmodule Electric.Shapes.SubqueryTags do
  @moduledoc false

  alias Electric.Replication.Eval
  alias Electric.Replication.Eval.Walker
  alias Electric.Shapes.Shape

  @value_prefix "v:"
  @null_sentinel "NULL"

  def value_prefix, do: @value_prefix
  def null_sentinel, do: @null_sentinel

  @spec move_in_tag_structure(Shape.t()) ::
          {list(list(String.t() | {:hash_together, [String.t(), ...]})), map()}
  def move_in_tag_structure(%Shape{} = shape)
      when is_nil(shape.where)
      when shape.shape_dependencies == [],
      do: {[], %{}}

  def move_in_tag_structure(shape) do
    {:ok, {tag_structure, comparison_expressions}} =
      Walker.reduce(
        shape.where.eval,
        fn
          %Eval.Parser.Func{name: "sublink_membership_check", args: [testexpr, sublink_ref]},
          {[current_tag | others], comparison_expressions},
          _ ->
            tags =
              case testexpr do
                %Eval.Parser.Ref{path: [column_name]} ->
                  [[column_name | current_tag] | others]

                %Eval.Parser.RowExpr{elements: elements} ->
                  elements =
                    Enum.map(elements, fn %Eval.Parser.Ref{path: [column_name]} ->
                      column_name
                    end)

                  [[{:hash_together, elements} | current_tag] | others]
              end

            {:ok, {tags, Map.put(comparison_expressions, sublink_ref.path, testexpr)}}

          _, acc, _ ->
            {:ok, acc}
        end,
        {[[]], %{}}
      )

    comparison_expressions
    |> Map.new(fn {path, expr} -> {path, Eval.Expr.wrap_parser_part(expr)} end)
    |> then(&{tag_structure, &1})
  end

  @spec namespace_value(nil | binary()) :: binary()
  def namespace_value(nil), do: @null_sentinel
  def namespace_value(value), do: @value_prefix <> value

  @spec make_value_hash(binary(), binary(), nil | binary()) :: binary()
  def make_value_hash(stack_id, shape_handle, value) do
    make_value_hash_raw(stack_id, shape_handle, namespace_value(value))
  end

  @spec make_value_hash_raw(binary(), binary(), binary()) :: binary()
  def make_value_hash_raw(stack_id, shape_handle, namespaced_value) do
    :crypto.hash(:md5, "#{stack_id}#{shape_handle}#{namespaced_value}")
    |> Base.encode16(case: :lower)
  end
end
