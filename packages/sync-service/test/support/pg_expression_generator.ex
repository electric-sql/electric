defmodule Support.PgExpressionGenerator do
  @moduledoc """
  Generates Postgres expressions for testing purposes.
  """

  import StreamData

  ## TYPE GENERATORS

  defp null_gen, do: constant("NULL")
  defp bool_gen, do: member_of(["TRUE", "FALSE"])

  defp int_gen, do: integer() |> map(&Integer.to_string/1)
  defp double_gen, do: float(min: -1.0e6, max: 1.0e6) |> map(&Float.to_string/1)
  defp numeric_gen, do: one_of([int_gen(), double_gen()])

  defp str_gen,
    do:
      StreamData.string(:ascii, max_length: 10)
      |> map(&"'#{String.replace(&1, "'", "''") |> String.replace("\\", "\\\\")}'")

  defp array_gen(type_gen, opts) do
    dimension = Access.get(opts, :dimension, 1)
    min_length = Access.get(opts, :min_length, 1)
    max_length = Access.get(opts, :max_length, 5)

    Enum.reduce(1..dimension, type_gen, fn dim, gen ->
      list_gen =
        if dim == dimension do
          list_of(gen, min_length: min_length, max_length: max_length)
        else
          list_of(gen, length: Enum.random(min_length..max_length))
        end

      list_gen
      |> map(fn elements ->
        "ARRAY[" <> Enum.join(elements, ", ") <> "]"
      end)
    end)
  end

  defp nullable_type_gen(type_gen, null_ratio \\ 0.25),
    do: frequency([{floor(1.0 / null_ratio), type_gen}, {1, null_gen()}])

  ## OPERATION GENERATORS

  defp comparison_op_gen,
    do:
      member_of([
        "=",
        "!=",
        "<>",
        ">",
        "<",
        ">=",
        "<=",
        "IS DISTINCT FROM",
        "IS NOT DISTINCT FROM"
      ])

  defp bool_comparison_op_gen, do: member_of(["AND", "OR"])
  defp bool_unary_op_gen, do: constant("NOT")

  defp range_comparison_op_gen,
    do: member_of(["BETWEEN", "BETWEEN SYMMETRIC"]) |> with_negation()

  defp array_op_gen, do: member_of(["||"])
  defp array_function_op_gen, do: member_of(["array_ndims"])
  defp array_comparison_op_gen, do: member_of(["@>", "<@", "&&"])

  defp numeric_op_gen, do: member_of(["+", "-", "/", "*"])
  defp numeric_unary_op_gen, do: member_of(["+", "-", "@"])
  defp int_op_gen, do: one_of([numeric_op_gen(), member_of(["&", "|", "#"])])
  defp int_unary_op_gen, do: one_of([numeric_unary_op_gen(), member_of(["~"])])
  defp double_unary_op_gen, do: one_of([numeric_unary_op_gen(), member_of(["|/ @"])])

  defp string_op_gen, do: member_of(["||"])
  defp string_comparison_op_gen, do: member_of(["~~", "~~*", "!~~", "!~~*"])
  defp string_function_op_gen, do: member_of(["LOWER", "UPPER"])

  defp membership_op_gen, do: with_negation(constant("IN"))

  defp is_null_op_gen, do: null_gen() |> map(&"IS #{&1}")

  defp predicate_op_gen,
    do: one_of([bool_gen(), constant("UNKNOWN"), null_gen()]) |> map(&"IS #{&1}")

  ## OPERATION COMPOSITION UTILITIES

  defp with_negation(op_gen), do: one_of([op_gen, map(op_gen, &"NOT #{&1}")])

  defp compose_unary_op(type_gen, unary_op_gen),
    do: bind({type_gen, unary_op_gen}, fn {a, unary_op} -> constant("#{unary_op} #{a}") end)

  defp compose_predicate_op(type_gen, predicate_op_gen),
    do:
      bind({type_gen, predicate_op_gen}, fn {a, predicate_op} ->
        constant("#{a} #{predicate_op}")
      end)

  defp compose_op(type_gen, op_gen),
    do: bind({type_gen, op_gen, type_gen}, fn {a, op, b} -> constant("#{a} #{op} #{b}") end)

  defp compose_range_op(type_gen, range_op_gen),
    do:
      bind({type_gen, range_op_gen, type_gen, type_gen}, fn {a, range_op, b, c} ->
        constant("#{a} #{range_op} #{b} AND #{c}")
      end)

  defp compose_function_op(type_gen, op_gen) do
    bind({type_gen, op_gen}, fn {val, op} -> constant("#{op}(#{val})") end)
  end

  defp compose_membership_op(type_gen, op_gen, opts \\ []) do
    min_length = Access.get(opts, :min_length, 1)
    max_length = Access.get(opts, :max_length, 5)

    bind(
      {
        type_gen,
        op_gen,
        list_of(type_gen, min_length: min_length, max_length: max_length)
      },
      fn {val, op, values} -> constant("#{val} #{op} (#{Enum.join(values, ", ")})") end
    )
  end

  ## EXPRESSION GENERATORS

  defp expression_gen(type_gen, op_generators) do
    type_gen = nullable_type_gen(type_gen)

    op_generators
    |> Enum.concat([
      # this applies to every type
      {:predicate_op, is_null_op_gen()}
    ])
    |> Enum.map(fn
      {:combine_op, op_gen} -> compose_op(type_gen, op_gen)
      {:comparison_op, op_gen} -> compose_op(type_gen, op_gen)
      {:unary_op, op_gen} -> compose_unary_op(type_gen, op_gen)
      {:predicate_op, op_gen} -> compose_predicate_op(type_gen, op_gen)
      {:range_op, op_gen} -> compose_range_op(type_gen, op_gen)
      {:membership_op, op_gen} -> compose_membership_op(type_gen, op_gen)
      {:function_op, op_gen} -> compose_function_op(type_gen, op_gen)
    end)
    |> one_of()
  end

  defp nested_expression_gen(type_gen, ops, opts) do
    max_nesting = Access.get(opts, :max_nesting, 3)

    Enum.map(1..max_nesting, fn nest_level ->
      Enum.reduce(1..nest_level, type_gen, fn _, gen ->
        expression_gen(gen |> map(&"(#{&1})"), ops)
      end)
    end)
    |> one_of
  end

  def numeric_expression do
    one_of([
      expression_gen(numeric_gen() |> nullable_type_gen(), [
        {:combine_op, numeric_op_gen()},
        {:unary_op, numeric_unary_op_gen()},
        {:comparison_op, comparison_op_gen()},
        {:range_op, range_comparison_op_gen()},
        {:membership_op, membership_op_gen()}
      ]),
      expression_gen(int_gen() |> nullable_type_gen(), [
        {:combine_op, int_op_gen()},
        {:unary_op, int_unary_op_gen()},
        {:comparison_op, comparison_op_gen()},
        {:range_op, range_comparison_op_gen()},
        {:membership_op, membership_op_gen()}
      ]),
      expression_gen(double_gen() |> nullable_type_gen(), [
        {:combine_op, numeric_op_gen()},
        {:unary_op, double_unary_op_gen()},
        {:comparison_op, comparison_op_gen()},
        {:range_op, range_comparison_op_gen()},
        {:membership_op, membership_op_gen()}
      ])
    ])
  end

  def string_expression do
    expression_gen(str_gen() |> nullable_type_gen(), [
      {:combine_op, string_op_gen()},
      {:function_op, string_function_op_gen()},
      {:comparison_op, string_comparison_op_gen()},
      {:comparison_op, comparison_op_gen()},
      {:range_op, range_comparison_op_gen()},
      {:membership_op, membership_op_gen()}
    ])
  end

  def bool_expression do
    expression_gen(bool_gen() |> nullable_type_gen(), [
      {:comparison_op, bool_comparison_op_gen()},
      {:unary_op, bool_unary_op_gen()},
      {:predicate_op, predicate_op_gen()}
      # TODO: comparisons don't work on nullable booleans
      # {:range_op, range_comparison_op_gen()},
      # {:comparison_op, comparison_op_gen()}
      # {:range_op, range_comparison_op_gen()},
      # {:membership_op, membership_op_gen()}
    ])
  end

  def complex_bool_expression do
    nested_expression_gen(
      bool_expression(),
      [
        {:combine_op, bool_comparison_op_gen()},
        {:unary_op, bool_unary_op_gen()},
        {:predicate_op, predicate_op_gen()}
      ],
      max_nesting: 5
    )
  end

  def array_expression(opts \\ []) do
    max_dimensions = Access.get(opts, :max_dimensions, 3)

    Enum.zip(
      [int_gen(), double_gen(), bool_gen(), str_gen()]
      |> Enum.map(&nullable_type_gen/1),
      1..max_dimensions
    )
    |> Enum.map(fn {type_gen, dim} -> {type_gen, array_gen(type_gen, dimension: dim)} end)
    |> Enum.flat_map(fn {type_gen, array_type_gen} ->
      [
        expression_gen(array_type_gen, [
          {:combine_op, array_op_gen()},
          {:comparison_op, array_comparison_op_gen()},
          {:function_op, array_function_op_gen()},
          {:membership_op, membership_op_gen()}
        ]),
        bind({array_type_gen, nullable_type_gen(type_gen)}, fn {array, element} ->
          one_of([
            constant("array_append(#{array}, #{element})"),
            constant("array_prepend(#{element}, #{array})"),
            constant("#{array} || #{element}"),
            constant("#{element} || #{array}")
          ])
        end)
      ]
    end)
    |> one_of
  end

  def datatype_expression() do
    [
      numeric_expression(),
      string_expression(),
      bool_expression(),
      array_expression()
    ]
    |> one_of()
  end
end
