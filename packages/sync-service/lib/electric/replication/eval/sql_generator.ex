defmodule Electric.Replication.Eval.SqlGenerator do
  @moduledoc """
  Converts a parsed WHERE clause AST back into a SQL string.

  This is the inverse of `Parser` — where `Parser` turns SQL text into an AST,
  `SqlGenerator` turns that AST back into SQL text. Used whenever the server
  needs to embed a condition in a generated query (snapshot active_conditions,
  move-in exclusion clauses, etc.).

  Uses precedence-aware parenthesization to produce minimal, readable SQL.
  Parentheses are only added when needed to preserve the AST's evaluation order.

  Must handle every AST node type that `Parser` can produce. Raises
  `ArgumentError` for unrecognised nodes so gaps are caught at shape
  creation time, but the property-based round-trip test (see Tests below)
  enforces that no parseable expression triggers this error.
  """

  alias Electric.Replication.Eval.Parser.{Const, Ref, Func, Array, RowExpr}

  # PostgreSQL operator precedence (higher number = tighter binding)
  # See: https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-PRECEDENCE
  @prec_or 10
  @prec_and 20
  @prec_not 30
  @prec_is 40
  @prec_comparison 50
  @prec_like_in 60
  @prec_other_op 70
  @prec_addition 80
  @prec_multiplication 90
  @prec_exponent 100
  @prec_unary 110
  @prec_cast 130
  @prec_atom 1000

  @doc """
  Convert an AST node to a SQL string.

  Handles: comparison operators (=, <>, <, >, <=, >=), pattern matching
  (LIKE, ILIKE, NOT LIKE, NOT ILIKE), nullability (IS NULL, IS NOT NULL),
  membership (IN), logical operators (AND, OR, NOT), boolean tests
  (IS TRUE, IS FALSE, IS UNKNOWN, etc.), column references, constants
  (strings, integers, floats, booleans, NULL), type casts, arithmetic
  operators (+, -, *, /, ^, |/, @, &, |, #, ~), string concatenation (||),
  array operators (@>, <@, &&), array/slice access, DISTINCT/NOT DISTINCT,
  ANY/ALL, and sublink membership checks.

  Raises `ArgumentError` for unrecognised AST nodes.
  """
  @spec to_sql(term()) :: String.t()
  def to_sql(ast) do
    {sql, _prec} = to_sql_prec(ast)
    sql
  end

  # --- Private: precedence-aware SQL generation ---
  # Each clause returns {sql_string, precedence_level}

  # Comparison operators
  defp to_sql_prec(%Func{name: "\"=\"", args: [left, right]}),
    do: binary_op(left, "=", right, @prec_comparison)

  defp to_sql_prec(%Func{name: "\"<>\"", args: [left, right]}),
    do: binary_op(left, "<>", right, @prec_comparison)

  defp to_sql_prec(%Func{name: "\"<\"", args: [left, right]}),
    do: binary_op(left, "<", right, @prec_comparison)

  defp to_sql_prec(%Func{name: "\">\"", args: [left, right]}),
    do: binary_op(left, ">", right, @prec_comparison)

  defp to_sql_prec(%Func{name: "\"<=\"", args: [left, right]}),
    do: binary_op(left, "<=", right, @prec_comparison)

  defp to_sql_prec(%Func{name: "\">=\"", args: [left, right]}),
    do: binary_op(left, ">=", right, @prec_comparison)

  # Pattern matching
  defp to_sql_prec(%Func{name: "\"~~\"", args: [left, right]}),
    do: binary_op(left, "LIKE", right, @prec_like_in)

  defp to_sql_prec(%Func{name: "\"~~*\"", args: [left, right]}),
    do: binary_op(left, "ILIKE", right, @prec_like_in)

  defp to_sql_prec(%Func{name: "\"!~~\"", args: [left, right]}),
    do: binary_op(left, "NOT LIKE", right, @prec_like_in)

  defp to_sql_prec(%Func{name: "\"!~~*\"", args: [left, right]}),
    do: binary_op(left, "NOT ILIKE", right, @prec_like_in)

  # Nullability — parser produces "is null"/"is not null" from constant folding
  # and "IS_NULL"/"IS_NOT_NULL" from NullTest on column refs
  defp to_sql_prec(%Func{name: name, args: [arg]}) when name in ["is null", "IS_NULL"],
    do: postfix_op(arg, "IS NULL", @prec_is)

  defp to_sql_prec(%Func{name: name, args: [arg]}) when name in ["is not null", "IS_NOT_NULL"],
    do: postfix_op(arg, "IS NOT NULL", @prec_is)

  # Boolean tests
  defp to_sql_prec(%Func{name: "IS_TRUE", args: [arg]}),
    do: postfix_op(arg, "IS TRUE", @prec_is)

  defp to_sql_prec(%Func{name: "IS_NOT_TRUE", args: [arg]}),
    do: postfix_op(arg, "IS NOT TRUE", @prec_is)

  defp to_sql_prec(%Func{name: "IS_FALSE", args: [arg]}),
    do: postfix_op(arg, "IS FALSE", @prec_is)

  defp to_sql_prec(%Func{name: "IS_NOT_FALSE", args: [arg]}),
    do: postfix_op(arg, "IS NOT FALSE", @prec_is)

  defp to_sql_prec(%Func{name: "IS_UNKNOWN", args: [arg]}),
    do: postfix_op(arg, "IS UNKNOWN", @prec_is)

  defp to_sql_prec(%Func{name: "IS_NOT_UNKNOWN", args: [arg]}),
    do: postfix_op(arg, "IS NOT UNKNOWN", @prec_is)

  # Membership (IN with literal array)
  defp to_sql_prec(%Func{name: "in", args: [left, %Array{elements: elements}]}) do
    values = Enum.map_join(elements, ", ", &to_sql/1)
    {"#{wrap(left, @prec_like_in)} IN (#{values})", @prec_like_in}
  end

  # Sublink membership check (IN with subquery) — rendered as a placeholder
  # since the actual subquery SQL is not in the AST
  defp to_sql_prec(%Func{name: "sublink_membership_check", args: [left, %Ref{path: path}]}) do
    sublink_ref = Enum.join(path, ".")
    {"#{wrap(left, @prec_like_in)} IN (SELECT #{sublink_ref})", @prec_like_in}
  end

  # Logical operators
  defp to_sql_prec(%Func{name: "not", args: [inner]}),
    do: prefix_op("NOT", inner, @prec_not)

  defp to_sql_prec(%Func{name: "and", args: args}) do
    conditions = Enum.map_join(args, " AND ", &wrap(&1, @prec_and))
    {conditions, @prec_and}
  end

  defp to_sql_prec(%Func{name: "or", args: args}) do
    conditions = Enum.map_join(args, " OR ", &wrap(&1, @prec_or))
    {conditions, @prec_or}
  end

  # DISTINCT / NOT DISTINCT — args are [left, right, comparison_func]
  defp to_sql_prec(%Func{name: "values_distinct?", args: [left, right | _]}),
    do: binary_op(left, "IS DISTINCT FROM", right, @prec_is)

  defp to_sql_prec(%Func{name: "values_not_distinct?", args: [left, right | _]}),
    do: binary_op(left, "IS NOT DISTINCT FROM", right, @prec_is)

  # ANY / ALL — arg is a single Func with map_over_array_in_pos
  defp to_sql_prec(%Func{name: "any", args: [%Func{} = inner]}) do
    {op_sql, left, right} = extract_mapped_operator(inner)
    {"#{wrap(left, @prec_comparison)} #{op_sql} ANY(#{to_sql(right)})", @prec_comparison}
  end

  defp to_sql_prec(%Func{name: "all", args: [%Func{} = inner]}) do
    {op_sql, left, right} = extract_mapped_operator(inner)
    {"#{wrap(left, @prec_comparison)} #{op_sql} ALL(#{to_sql(right)})", @prec_comparison}
  end

  # Arithmetic binary operators
  defp to_sql_prec(%Func{name: "\"+\"", args: [left, right]}),
    do: binary_op(left, "+", right, @prec_addition)

  defp to_sql_prec(%Func{name: "\"-\"", args: [left, right]}),
    do: binary_op(left, "-", right, @prec_addition)

  defp to_sql_prec(%Func{name: "\"*\"", args: [left, right]}),
    do: binary_op(left, "*", right, @prec_multiplication)

  defp to_sql_prec(%Func{name: "\"/\"", args: [left, right]}),
    do: binary_op(left, "/", right, @prec_multiplication)

  defp to_sql_prec(%Func{name: "\"^\"", args: [left, right]}),
    do: binary_op_right(left, "^", right, @prec_exponent)

  # Bitwise binary operators
  defp to_sql_prec(%Func{name: "\"&\"", args: [left, right]}),
    do: binary_op(left, "&", right, @prec_other_op)

  defp to_sql_prec(%Func{name: "\"|\"", args: [left, right]}),
    do: binary_op(left, "|", right, @prec_other_op)

  defp to_sql_prec(%Func{name: "\"#\"", args: [left, right]}),
    do: binary_op(left, "#", right, @prec_other_op)

  # Unary operators
  defp to_sql_prec(%Func{name: "\"+\"", args: [arg]}),
    do: prefix_op("+", arg, @prec_unary)

  defp to_sql_prec(%Func{name: "\"-\"", args: [arg]}),
    do: prefix_op("-", arg, @prec_unary)

  defp to_sql_prec(%Func{name: "\"~\"", args: [arg]}),
    do: prefix_op("~", arg, @prec_unary)

  defp to_sql_prec(%Func{name: "\"|/\"", args: [arg]}),
    do: prefix_op("|/", arg, @prec_unary)

  defp to_sql_prec(%Func{name: "\"@\"", args: [arg]}),
    do: prefix_op("@", arg, @prec_unary)

  # String concatenation
  defp to_sql_prec(%Func{name: "\"||\"", args: [left, right]}),
    do: binary_op(left, "||", right, @prec_other_op)

  # Array operators
  defp to_sql_prec(%Func{name: "\"@>\"", args: [left, right]}),
    do: binary_op(left, "@>", right, @prec_other_op)

  defp to_sql_prec(%Func{name: "\"<@\"", args: [left, right]}),
    do: binary_op(left, "<@", right, @prec_other_op)

  defp to_sql_prec(%Func{name: "\"&&\"", args: [left, right]}),
    do: binary_op(left, "&&", right, @prec_other_op)

  # Named functions (lower, upper, like, ilike, array_*, justify_*, timezone, casts, etc.)
  # These are Func nodes where the name is a plain identifier (no quotes around operators)
  defp to_sql_prec(%Func{name: name, args: args})
       when name in ~w(lower upper like ilike array_cat array_prepend array_append array_ndims
                       justify_days justify_hours justify_interval timezone
                       index_access slice_access) do
    arg_list = Enum.map_join(args, ", ", &to_sql/1)
    {"#{name}(#{arg_list})", @prec_atom}
  end

  # Type cast functions (e.g., "int4_to_bool", "text_to_int4")
  defp to_sql_prec(%Func{name: name, args: [arg]}) when is_binary(name) do
    if String.contains?(name, "_to_") do
      target_type = name |> String.split("_to_") |> List.last()
      {"#{wrap(arg, @prec_cast)}::#{target_type}", @prec_cast}
    else
      raise ArgumentError,
            "SqlGenerator.to_sql/1: unsupported AST node: %Func{name: #{inspect(name)}}. " <>
              "This WHERE clause contains an operator or expression type that " <>
              "cannot be converted back to SQL for active_conditions generation."
    end
  end

  # Column references
  defp to_sql_prec(%Ref{path: path}) do
    {Enum.map_join(path, ".", &~s|"#{&1}"|), @prec_atom}
  end

  # Constants
  defp to_sql_prec(%Const{value: nil}), do: {"NULL", @prec_atom}
  defp to_sql_prec(%Const{value: true}), do: {"true", @prec_atom}
  defp to_sql_prec(%Const{value: false}), do: {"false", @prec_atom}

  defp to_sql_prec(%Const{value: value}) when is_binary(value) do
    escaped = String.replace(value, "'", "''")
    {"'#{escaped}'", @prec_atom}
  end

  defp to_sql_prec(%Const{value: value}) when is_integer(value) or is_float(value),
    do: {"#{value}", @prec_atom}

  # Constant-folded arrays (parser evaluates e.g. ARRAY[1, 2] to %Const{value: [1, 2]})
  defp to_sql_prec(%Const{value: value}) when is_list(value) do
    elements = Enum.map_join(value, ", ", &const_list_element_to_sql/1)
    {"ARRAY[#{elements}]", @prec_atom}
  end

  # Date/time/interval constants — the parser constant-folds typed literals
  # (e.g. '2024-01-01'::date) into Const nodes with Elixir struct values.
  defp to_sql_prec(%Const{value: %Date{} = d}), do: {"'#{Date.to_iso8601(d)}'::date", @prec_atom}
  defp to_sql_prec(%Const{value: %Time{} = t}), do: {"'#{Time.to_iso8601(t)}'::time", @prec_atom}

  defp to_sql_prec(%Const{value: %NaiveDateTime{} = ndt}),
    do: {"'#{NaiveDateTime.to_iso8601(ndt)}'::timestamp", @prec_atom}

  defp to_sql_prec(%Const{value: %DateTime{} = dt}),
    do: {"'#{DateTime.to_iso8601(dt)}'::timestamptz", @prec_atom}

  defp to_sql_prec(%Const{value: %PgInterop.Interval{} = i}),
    do: {"'#{PgInterop.Interval.format(i)}'::interval", @prec_atom}

  # Row expressions — e.g. ROW(a, b) or (a, b) in row comparisons
  defp to_sql_prec(%RowExpr{elements: elements}) do
    values = Enum.map_join(elements, ", ", &to_sql/1)
    {"ROW(#{values})", @prec_atom}
  end

  # Array literals
  defp to_sql_prec(%Array{elements: elements}) do
    values = Enum.map_join(elements, ", ", &to_sql/1)
    {"ARRAY[#{values}]", @prec_atom}
  end

  # Catch-all — fail loudly so unsupported operators are caught at shape
  # creation time, not at query time.
  defp to_sql_prec(other) do
    raise ArgumentError,
          "SqlGenerator.to_sql/1: unsupported AST node: #{inspect(other)}. " <>
            "This WHERE clause contains an operator or expression type that " <>
            "cannot be converted back to SQL for active_conditions generation."
  end

  # --- Precedence helpers ---

  # Binary operator, left-associative: left child at prec, right child at prec+1
  defp binary_op(left, op, right, prec) do
    {"#{wrap(left, prec)} #{op} #{wrap(right, prec + 1)}", prec}
  end

  # Binary operator, right-associative: left child at prec+1, right child at prec
  defp binary_op_right(left, op, right, prec) do
    {"#{wrap(left, prec + 1)} #{op} #{wrap(right, prec)}", prec}
  end

  # Prefix unary operator: operand at same prec (same-level nesting is fine)
  defp prefix_op(op, operand, prec) do
    {"#{op} #{wrap(operand, prec)}", prec}
  end

  # Postfix unary operator: operand must be strictly higher precedence to avoid
  # ambiguity (e.g. `x IS DISTINCT FROM y IS NULL` is ambiguous)
  defp postfix_op(operand, op, prec) do
    {"#{wrap(operand, prec + 1)} #{op}", prec}
  end

  # Wrap an AST node in parens if its precedence is lower than the context
  defp wrap(ast, context_prec) do
    {sql, prec} = to_sql_prec(ast)
    if prec < context_prec, do: "(#{sql})", else: sql
  end

  # --- Unchanged helpers ---

  # Helper for rendering constant-folded array elements (plain Elixir values, not AST nodes)
  defp const_list_element_to_sql(nil), do: "NULL"
  defp const_list_element_to_sql(true), do: "true"
  defp const_list_element_to_sql(false), do: "false"

  defp const_list_element_to_sql(value) when is_binary(value) do
    escaped = String.replace(value, "'", "''")
    "'#{escaped}'"
  end

  defp const_list_element_to_sql(value) when is_integer(value) or is_float(value),
    do: "#{value}"

  defp const_list_element_to_sql(value) when is_list(value) do
    elements = Enum.map_join(value, ", ", &const_list_element_to_sql/1)
    "ARRAY[#{elements}]"
  end

  # Helper for ANY/ALL: extract the operator, left operand, and array right operand
  # from a Func with map_over_array_in_pos set
  defp extract_mapped_operator(%Func{name: name, args: [left, right]}) do
    op_sql =
      case name do
        ~s|"="| -> "="
        ~s|"<>"| -> "<>"
        ~s|"<"| -> "<"
        ~s|">"| -> ">"
        ~s|"<="| -> "<="
        ~s|">="| -> ">="
        ~s|"~~"| -> "LIKE"
        ~s|"~~*"| -> "ILIKE"
        other -> String.trim(other, "\"")
      end

    {op_sql, left, right}
  end
end
