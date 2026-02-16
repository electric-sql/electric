defmodule Electric.Replication.Eval.SqlGenerator do
  @moduledoc """
  Converts a parsed WHERE clause AST back into a SQL string.

  This is the inverse of `Parser` — where `Parser` turns SQL text into an AST,
  `SqlGenerator` turns that AST back into SQL text. Used whenever the server
  needs to embed a condition in a generated query (snapshot active_conditions,
  move-in exclusion clauses, etc.).

  Must handle every AST node type that `Parser` can produce. Raises
  `ArgumentError` for unrecognised nodes so gaps are caught at shape
  creation time, but the property-based round-trip test (see Tests below)
  enforces that no parseable expression triggers this error.
  """

  alias Electric.Replication.Eval.Parser.{Const, Ref, Func, Array, RowExpr}

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

  # Comparison operators — names are stored with surrounding quotes
  def to_sql(%Func{name: "\"=\"", args: [left, right]}),
    do: "(#{to_sql(left)} = #{to_sql(right)})"

  def to_sql(%Func{name: "\"<>\"", args: [left, right]}),
    do: "(#{to_sql(left)} <> #{to_sql(right)})"

  def to_sql(%Func{name: "\"<\"", args: [left, right]}),
    do: "(#{to_sql(left)} < #{to_sql(right)})"

  def to_sql(%Func{name: "\">\"", args: [left, right]}),
    do: "(#{to_sql(left)} > #{to_sql(right)})"

  def to_sql(%Func{name: "\"<=\"", args: [left, right]}),
    do: "(#{to_sql(left)} <= #{to_sql(right)})"

  def to_sql(%Func{name: "\">=\"", args: [left, right]}),
    do: "(#{to_sql(left)} >= #{to_sql(right)})"

  # Pattern matching
  def to_sql(%Func{name: "\"~~\"", args: [left, right]}),
    do: "(#{to_sql(left)} LIKE #{to_sql(right)})"

  def to_sql(%Func{name: "\"~~*\"", args: [left, right]}),
    do: "(#{to_sql(left)} ILIKE #{to_sql(right)})"

  def to_sql(%Func{name: "\"!~~\"", args: [left, right]}),
    do: "(#{to_sql(left)} NOT LIKE #{to_sql(right)})"

  def to_sql(%Func{name: "\"!~~*\"", args: [left, right]}),
    do: "(#{to_sql(left)} NOT ILIKE #{to_sql(right)})"

  # Nullability — parser produces "is null"/"is not null" from constant folding
  # and "IS_NULL"/"IS_NOT_NULL" from NullTest on column refs
  def to_sql(%Func{name: name, args: [arg]}) when name in ["is null", "IS_NULL"],
    do: "(#{to_sql(arg)} IS NULL)"

  def to_sql(%Func{name: name, args: [arg]}) when name in ["is not null", "IS_NOT_NULL"],
    do: "(#{to_sql(arg)} IS NOT NULL)"

  # Boolean tests
  def to_sql(%Func{name: "IS_TRUE", args: [arg]}),
    do: "(#{to_sql(arg)} IS TRUE)"

  def to_sql(%Func{name: "IS_NOT_TRUE", args: [arg]}),
    do: "(#{to_sql(arg)} IS NOT TRUE)"

  def to_sql(%Func{name: "IS_FALSE", args: [arg]}),
    do: "(#{to_sql(arg)} IS FALSE)"

  def to_sql(%Func{name: "IS_NOT_FALSE", args: [arg]}),
    do: "(#{to_sql(arg)} IS NOT FALSE)"

  def to_sql(%Func{name: "IS_UNKNOWN", args: [arg]}),
    do: "(#{to_sql(arg)} IS UNKNOWN)"

  def to_sql(%Func{name: "IS_NOT_UNKNOWN", args: [arg]}),
    do: "(#{to_sql(arg)} IS NOT UNKNOWN)"

  # Membership (IN with literal array)
  def to_sql(%Func{name: "in", args: [left, %Array{elements: elements}]}) do
    values = Enum.map_join(elements, ", ", &to_sql/1)
    "(#{to_sql(left)} IN (#{values}))"
  end

  # Sublink membership check (IN with subquery) — rendered as a placeholder
  # since the actual subquery SQL is not in the AST
  def to_sql(%Func{name: "sublink_membership_check", args: [left, %Ref{path: path}]}) do
    sublink_ref = Enum.join(path, ".")
    "(#{to_sql(left)} IN (SELECT #{sublink_ref}))"
  end

  # Logical operators
  def to_sql(%Func{name: "not", args: [inner]}),
    do: "(NOT #{to_sql(inner)})"

  def to_sql(%Func{name: "and", args: args}) do
    conditions = Enum.map_join(args, " AND ", &to_sql/1)
    "(#{conditions})"
  end

  def to_sql(%Func{name: "or", args: args}) do
    conditions = Enum.map_join(args, " OR ", &to_sql/1)
    "(#{conditions})"
  end

  # DISTINCT / NOT DISTINCT — args are [left, right, comparison_func]
  def to_sql(%Func{name: "values_distinct?", args: [left, right | _]}),
    do: "(#{to_sql(left)} IS DISTINCT FROM #{to_sql(right)})"

  def to_sql(%Func{name: "values_not_distinct?", args: [left, right | _]}),
    do: "(#{to_sql(left)} IS NOT DISTINCT FROM #{to_sql(right)})"

  # ANY / ALL — arg is a single Func with map_over_array_in_pos
  def to_sql(%Func{name: "any", args: [%Func{} = inner]}) do
    {op_sql, left, right} = extract_mapped_operator(inner)
    "(#{to_sql(left)} #{op_sql} ANY(#{to_sql(right)}))"
  end

  def to_sql(%Func{name: "all", args: [%Func{} = inner]}) do
    {op_sql, left, right} = extract_mapped_operator(inner)
    "(#{to_sql(left)} #{op_sql} ALL(#{to_sql(right)}))"
  end

  # Arithmetic binary operators
  def to_sql(%Func{name: "\"+\"", args: [left, right]}),
    do: "(#{to_sql(left)} + #{to_sql(right)})"

  def to_sql(%Func{name: "\"-\"", args: [left, right]}),
    do: "(#{to_sql(left)} - #{to_sql(right)})"

  def to_sql(%Func{name: "\"*\"", args: [left, right]}),
    do: "(#{to_sql(left)} * #{to_sql(right)})"

  def to_sql(%Func{name: "\"/\"", args: [left, right]}),
    do: "(#{to_sql(left)} / #{to_sql(right)})"

  def to_sql(%Func{name: "\"^\"", args: [left, right]}),
    do: "(#{to_sql(left)} ^ #{to_sql(right)})"

  # Bitwise binary operators
  def to_sql(%Func{name: "\"&\"", args: [left, right]}),
    do: "(#{to_sql(left)} & #{to_sql(right)})"

  def to_sql(%Func{name: "\"|\"", args: [left, right]}),
    do: "(#{to_sql(left)} | #{to_sql(right)})"

  def to_sql(%Func{name: "\"#\"", args: [left, right]}),
    do: "(#{to_sql(left)} # #{to_sql(right)})"

  # Unary operators
  def to_sql(%Func{name: "\"+\"", args: [arg]}),
    do: "(+ #{to_sql(arg)})"

  def to_sql(%Func{name: "\"-\"", args: [arg]}),
    do: "(- #{to_sql(arg)})"

  def to_sql(%Func{name: "\"~\"", args: [arg]}),
    do: "(~ #{to_sql(arg)})"

  def to_sql(%Func{name: "\"|/\"", args: [arg]}),
    do: "(|/ #{to_sql(arg)})"

  def to_sql(%Func{name: "\"@\"", args: [arg]}),
    do: "(@ #{to_sql(arg)})"

  # String concatenation
  def to_sql(%Func{name: "\"||\"", args: [left, right]}),
    do: "(#{to_sql(left)} || #{to_sql(right)})"

  # Array operators
  def to_sql(%Func{name: "\"@>\"", args: [left, right]}),
    do: "(#{to_sql(left)} @> #{to_sql(right)})"

  def to_sql(%Func{name: "\"<@\"", args: [left, right]}),
    do: "(#{to_sql(left)} <@ #{to_sql(right)})"

  def to_sql(%Func{name: "\"&&\"", args: [left, right]}),
    do: "(#{to_sql(left)} && #{to_sql(right)})"

  # Named functions (lower, upper, like, ilike, array_*, justify_*, timezone, casts, etc.)
  # These are Func nodes where the name is a plain identifier (no quotes around operators)
  def to_sql(%Func{name: name, args: args})
      when name in ~w(lower upper like ilike array_cat array_prepend array_append array_ndims
                      justify_days justify_hours justify_interval timezone
                      index_access slice_access) do
    arg_list = Enum.map_join(args, ", ", &to_sql/1)
    "#{name}(#{arg_list})"
  end

  # Type cast functions (e.g., "int4_to_bool", "text_to_int4")
  def to_sql(%Func{name: name, args: [arg]}) when is_binary(name) do
    if String.contains?(name, "_to_") do
      target_type = name |> String.split("_to_") |> List.last()
      "(#{to_sql(arg)})::#{target_type}"
    else
      raise ArgumentError,
            "SqlGenerator.to_sql/1: unsupported AST node: %Func{name: #{inspect(name)}}. " <>
              "This WHERE clause contains an operator or expression type that " <>
              "cannot be converted back to SQL for active_conditions generation."
    end
  end

  # Column references
  def to_sql(%Ref{path: path}) do
    Enum.map_join(path, ".", &~s|"#{&1}"|)
  end

  # Constants
  def to_sql(%Const{value: nil}), do: "NULL"
  def to_sql(%Const{value: true}), do: "true"
  def to_sql(%Const{value: false}), do: "false"

  def to_sql(%Const{value: value}) when is_binary(value) do
    escaped = String.replace(value, "'", "''")
    "'#{escaped}'"
  end

  def to_sql(%Const{value: value}) when is_integer(value) or is_float(value),
    do: "#{value}"

  # Constant-folded arrays (parser evaluates e.g. ARRAY[1, 2] to %Const{value: [1, 2]})
  def to_sql(%Const{value: value}) when is_list(value) do
    elements = Enum.map_join(value, ", ", &const_list_element_to_sql/1)
    "ARRAY[#{elements}]"
  end

  # Date/time/interval constants — the parser constant-folds typed literals
  # (e.g. '2024-01-01'::date) into Const nodes with Elixir struct values.
  def to_sql(%Const{value: %Date{} = d}), do: "'#{Date.to_iso8601(d)}'::date"
  def to_sql(%Const{value: %Time{} = t}), do: "'#{Time.to_iso8601(t)}'::time"

  def to_sql(%Const{value: %NaiveDateTime{} = ndt}),
    do: "'#{NaiveDateTime.to_iso8601(ndt)}'::timestamp"

  def to_sql(%Const{value: %DateTime{} = dt}),
    do: "'#{DateTime.to_iso8601(dt)}'::timestamptz"

  def to_sql(%Const{value: %PgInterop.Interval{} = i}),
    do: "'#{PgInterop.Interval.format(i)}'::interval"

  # Row expressions — e.g. ROW(a, b) or (a, b) in row comparisons
  def to_sql(%RowExpr{elements: elements}) do
    values = Enum.map_join(elements, ", ", &to_sql/1)
    "ROW(#{values})"
  end

  # Array literals
  def to_sql(%Array{elements: elements}) do
    values = Enum.map_join(elements, ", ", &to_sql/1)
    "ARRAY[#{values}]"
  end

  # Catch-all — fail loudly so unsupported operators are caught at shape
  # creation time, not at query time.
  def to_sql(other) do
    raise ArgumentError,
          "SqlGenerator.to_sql/1: unsupported AST node: #{inspect(other)}. " <>
            "This WHERE clause contains an operator or expression type that " <>
            "cannot be converted back to SQL for active_conditions generation."
  end

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
