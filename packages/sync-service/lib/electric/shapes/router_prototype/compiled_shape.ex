defmodule Electric.Shapes.RouterPrototype.CompiledShape do
  @moduledoc """
  Compiled representation of a shape for fast evaluation.

  Compiles simple WHERE clauses into direct field comparisons,
  bypassing the full Eval.Runner machinery.

  ## Motivation

  The current `Electric.Replication.Eval.Runner` is correct and handles
  complex expressions, but has overhead:
  - Runtime type resolution
  - Operator overload lookups
  - AST traversal
  - MapSet allocations for refs

  For simple shapes like `WHERE id = 42`, we can skip all this and
  do a direct comparison.

  ## Supported Fast Paths

  1. **Simple equality**: `field = constant`
     - Pre-normalize the constant value at compile time
     - At runtime: extract field, compare directly

  2. **Simple AND of equalities**: `field1 = const1 AND field2 = const2`
     - Pre-normalize all constants
     - At runtime: extract fields, short-circuit on first non-match

  3. **Array inclusion**: `array_field @> [const1, const2]`
     - Pre-sort the constant array
     - At runtime: check if record array is a superset

  ## Slow Path Fallback

  For shapes that don't fit the fast path patterns:
  - Store the original `WhereClause.t()`
  - Evaluate using `WhereClause.includes_record?/3` as today

  ## Example

      # Compile at shape registration
      shape = CompiledShape.compile(%{
        id: 1,
        table: "users",
        where: "id = 42 AND status = 'active'",
        inspector: inspector
      })

      # Fast evaluation at runtime
      record = %{"id" => "42", "status" => "active", "name" => "Alice"}
      CompiledShape.matches?(shape, record)  # Direct field comparison, no Eval.Runner
      #=> true
  """

  alias Electric.Shapes.WhereClause
  alias Electric.Replication.Eval.Parser
  alias Electric.Postgres.Inspector

  defstruct [
    :id,
    :type,
    :fast_path,
    :slow_path
  ]

  @type shape_id :: non_neg_integer()
  @type table_name :: String.t()
  @type field_name :: String.t()
  @type value :: term()

  @type fast_path ::
          {:simple_eq, field_name(), value()}
          | {:and_eq, [{field_name(), value()}]}
          | {:inclusion, field_name(), [value()]}
          | nil

  @type slow_path :: WhereClause.t() | nil

  @type t :: %__MODULE__{
          id: shape_id(),
          type: :fast | :slow,
          fast_path: fast_path(),
          slow_path: slow_path()
        }

  @doc """
  Compiles a shape for fast evaluation.

  ## Options

  - `:id` - Shape ID (required)
  - `:table` - Table name (required)
  - `:where` - WHERE clause string (optional, nil means "all records")
  - `:inspector` - Postgres inspector for type information (required)

  ## Returns

  A `%CompiledShape{}` with either:
  - `type: :fast` - Can use direct comparison
  - `type: :slow` - Must use full WHERE clause evaluation
  """
  @spec compile(keyword() | map()) :: t()
  def compile(opts) when is_list(opts) do
    compile(Map.new(opts))
  end

  def compile(%{id: id, table: table, where: where_string, inspector: inspector})
      when is_binary(where_string) do
    case Parser.parse_and_validate_expression(where_string, table, inspector) do
      {:ok, where_clause} ->
        compile_where_clause(id, where_clause, inspector)

      {:error, _reason} ->
        # If parsing fails, fall back to slow path
        %__MODULE__{
          id: id,
          type: :slow,
          fast_path: nil,
          slow_path: where_clause
        }
    end
  end

  def compile(%{id: id, where: nil}) do
    # No WHERE clause = matches all records
    %__MODULE__{
      id: id,
      type: :fast,
      fast_path: :match_all,
      slow_path: nil
    }
  end

  # Attempts to compile a WHERE clause into a fast path
  defp compile_where_clause(id, where_clause, inspector) do
    case try_compile_fast_path(where_clause, inspector) do
      {:ok, fast_path} ->
        %__MODULE__{
          id: id,
          type: :fast,
          fast_path: fast_path,
          slow_path: nil
        }

      :error ->
        %__MODULE__{
          id: id,
          type: :slow,
          fast_path: nil,
          slow_path: where_clause
        }
    end
  end

  # Attempts to compile simple patterns into fast paths
  defp try_compile_fast_path(where_clause, inspector) do
    # Try to extract simple patterns from the WHERE clause
    # This is a simplified version - real implementation would need
    # to walk the expression tree properly

    # For now, just return error to use slow path
    # Real implementation would pattern match on where_clause structure
    :error
  end

  @doc """
  Evaluates whether a record matches this compiled shape.

  Uses the fast path when available, falls back to slow path otherwise.

  ## Example

      record = %{"id" => "42", "status" => "active"}
      CompiledShape.matches?(compiled_shape, record)
      #=> true
  """
  @spec matches?(t(), map(), function()) :: boolean()
  def matches?(%__MODULE__{type: :fast, fast_path: :match_all}, _record, _refs_fun) do
    true
  end

  def matches?(%__MODULE__{type: :fast, fast_path: {:simple_eq, field, expected_value}}, record, _refs_fun) do
    # Direct field comparison - no Eval.Runner overhead
    case Map.get(record, field) do
      ^expected_value -> true
      actual_value when is_binary(actual_value) and is_integer(expected_value) ->
        # Handle string "42" vs integer 42
        case Integer.parse(actual_value) do
          {parsed, ""} -> parsed == expected_value
          _ -> false
        end
      actual_value when is_integer(actual_value) and is_binary(expected_value) ->
        # Handle integer 42 vs string "42"
        Integer.to_string(actual_value) == expected_value
      _ ->
        false
    end
  end

  def matches?(%__MODULE__{type: :fast, fast_path: {:and_eq, conditions}}, record, _refs_fun) do
    # Short-circuit AND evaluation
    Enum.all?(conditions, fn {field, expected_value} ->
      Map.get(record, field) == expected_value
    end)
  end

  def matches?(%__MODULE__{type: :fast, fast_path: {:inclusion, field, expected_array}}, record, _refs_fun) do
    # Array inclusion check
    case Map.get(record, field) do
      actual_array when is_list(actual_array) ->
        # Check if actual_array is a superset of expected_array
        expected_set = MapSet.new(expected_array)
        actual_set = MapSet.new(actual_array)
        MapSet.subset?(expected_set, actual_set)

      _ ->
        false
    end
  end

  def matches?(%__MODULE__{type: :slow, slow_path: where_clause}, record, refs_fun) do
    # Fall back to full WHERE clause evaluation
    WhereClause.includes_record?(where_clause, record, refs_fun)
  end

  @doc """
  Extracts the routing key from a shape's WHERE clause.

  For shapes with equality conditions like `id = 42`, returns `{:ok, {"id", 42}}`.
  This is used to determine which shard should handle the shape.

  Returns `:error` if no clear routing key exists.
  """
  @spec routing_key(t()) :: {:ok, {field_name(), value()}} | :error
  def routing_key(%__MODULE__{fast_path: {:simple_eq, field, value}}) do
    {:ok, {field, value}}
  end

  def routing_key(%__MODULE__{fast_path: {:and_eq, [{field, value} | _rest]}}) do
    # Use first equality condition as routing key
    {:ok, {field, value}}
  end

  def routing_key(%__MODULE__{fast_path: {:inclusion, field, [first_value | _rest]}}) do
    # Use first array element as routing key
    {:ok, {field, first_value}}
  end

  def routing_key(_) do
    :error
  end

  @doc """
  Returns statistics about fast vs slow path usage.

  Useful for monitoring how many shapes benefit from compilation.
  """
  @spec type(t()) :: :fast | :slow
  def type(%__MODULE__{type: type}), do: type

  @doc """
  Returns a simple representation for debugging.
  """
  def debug_info(%__MODULE__{id: id, type: type, fast_path: fast_path}) do
    %{
      id: id,
      type: type,
      fast_path: fast_path
    }
  end
end
