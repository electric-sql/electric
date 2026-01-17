# Shape System Implementation

This document provides a deep implementation dive into the Shape system in Electric's sync-service.

## Overview

The Shape system is Electric's core abstraction for defining and managing synchronized subsets of PostgreSQL data. Shapes support filtering via WHERE clauses, column selection, and dependency tracking through subqueries.

## 1. Shape Definition

**File**: `lib/electric/shapes/shape.ex`

### Core Data Structure

```elixir
defstruct [
  :root_table,              # {schema, table} tuple
  :root_table_id,           # PostgreSQL OID
  :root_pk,                 # Primary key columns
  :root_column_count,       # Total columns in table
  :where,                   # Parsed WHERE clause (Expr.t() | nil)
  :selected_columns,        # All columns needed (includes PK)
  :explicitly_selected_columns,  # User-requested columns only
  shape_dependencies: [],   # Dependent shapes for subqueries
  shape_dependencies_handles: [],  # Handles for dependencies
  tag_structure: [],        # Move-in/out tracking pattern
  subquery_comparison_expressions: %{},  # Subquery column refs
  log_mode: :full,          # :full | :changes_only
  flags: %{},               # Boolean feature flags
  storage: %{compaction: :disabled},
  replica: :default         # :default | :full
]
```

### Flags System

Flags are computed during shape creation to optimize runtime behavior:

```elixir
flags = [
  if(is_nil(Map.get(opts, :columns)), do: :selects_all_columns),
  if(any_columns_generated?(column_info, selected_columns),
    do: :selects_generated_columns),
  if(any_columns_non_primitive?(column_info, where),
    do: :non_primitive_columns_in_where)
]
|> Enum.reject(&is_nil/1)
|> Map.new(fn k -> {k, true} end)
```

**Flag purposes:**

- `:selects_all_columns` - Enables fast-path change processing (no column filtering needed)
- `:selects_generated_columns` - Marks presence of generated columns (PG 12+ feature)
- `:non_primitive_columns_in_where` - Indicates enums/domains/composites in WHERE clause

### Shape Handle Generation Algorithm

```elixir
def comparable_hash(%__MODULE__{} = shape) do
  comparable = comparable(shape)
  {comparable, :erlang.phash2(comparable)}
end

def generate_id(%__MODULE__{} = shape) do
  hash = hash(shape)
  # Use microseconds to avoid collisions within the same millisecond
  {hash, "#{hash}-#{DateTime.utc_now() |> DateTime.to_unix(:microsecond)}"}
end
```

**Handle format:** `<hash>-<microsecond_timestamp>`

**Comparable representation:**

```elixir
def comparable(%__MODULE__{} = shape) do
  {:shape, {shape.root_table_id, shape.root_table}, shape.root_pk,
   Comparable.comparable(shape.where), shape.selected_columns,
   Enum.flat_map(shape.flags, fn {k, v} -> if(v, do: [k], else: []) end) |> Enum.sort(),
   shape.replica, shape.log_mode}
end
```

**Key insight**: Storage configuration is deliberately excluded from the comparable representation, so shapes with different storage settings but identical queries share the same hash.

## 2. WHERE Clause Evaluation

### Parsing Architecture

**File**: `lib/electric/replication/eval/parser.ex`

**Flow:**

1. **SQL to AST**: Uses PgQuery library to parse SQL into PostgreSQL AST
2. **AST to Internal Tree**: Converts PG nodes to Electric's internal representation
3. **Type Resolution**: Resolves all types and operator overloads
4. **Constant Folding**: Pre-evaluates immutable functions on constant arguments
5. **Validation**: Ensures expression returns boolean

**Internal AST Node Types:**

```elixir
defmodule Const do
  defstruct [:value, :type, :meta, location: 0]
end

defmodule Ref do
  defstruct [:path, :type, location: 0]
end

defmodule Func do
  defstruct [
    :args, :type, :implementation, :name,
    strict?: true, immutable?: true,
    map_over_array_in_pos: nil, variadic_arg: nil, location: 0
  ]
end

defmodule Array do
  defstruct [:elements, :type, location: 0]
end
```

### Expression Evaluation

**Expr struct** (`lib/electric/replication/eval/expr.ex`):

```elixir
defstruct [:query, :eval, :used_refs, :returns]

@type t() :: %__MODULE__{
  query: String.t(),        # Normalized SQL
  eval: term(),             # Internal AST for evaluation
  used_refs: used_refs(),   # Map of column references to types
  returns: Env.pg_type()    # Return type (must be :bool for WHERE)
}
```

**Record evaluation** (`lib/electric/shapes/where_clause.ex`):

```elixir
def includes_record?(where_clause, record, extra_refs \\ %{})
def includes_record?(nil = _where_clause, _record, _), do: true

def includes_record?(where_clause, record, extra_refs) do
  with {:ok, refs} <- Runner.record_to_ref_values(where_clause.used_refs, record),
       {:ok, evaluated} <- Runner.execute(where_clause, Map.merge(refs, extra_refs)) do
    if is_nil(evaluated), do: false, else: evaluated
  else
    _ -> false
  end
end
```

**Execution engine** (`lib/electric/replication/eval/runner.ex`):

Key algorithm: Tree-walking evaluation with nil propagation for strict functions.

```elixir
def execute(%Expr{} = tree, ref_values) do
  Walker.fold(tree.eval, &do_execute/3, ref_values)
end

# Constant values are returned directly
defp do_execute(%Const{value: value}, _, _), do: {:ok, value}

# References are looked up in ref_values map
defp do_execute(%Ref{path: path}, _, refs), do: {:ok, Map.fetch!(refs, path)}

# Strict functions return nil if any arg is nil
defp do_execute(%Func{strict?: true} = func, %{args: args}, _) do
  has_nils? = Enum.any?(args, &is_nil/1)
  if has_nils?, do: {:ok, nil}, else: {:ok, try_apply(func, args)}
end
```

### Supported Operators and Functions

- **Binary operators**: `=`, `<>`, `<`, `>`, `<=`, `>=`, `LIKE`, `ILIKE`, `~~`, `!~~`
- **Boolean operators**: `AND`, `OR`, `NOT`
- **Array operators**: `ANY`, `ALL`, array indexing/slicing
- **Comparison**: `IS NULL`, `IS NOT NULL`, `IS DISTINCT FROM`, `BETWEEN`
- **Functions**: Type casts, string functions, numeric functions, date/time functions

## 3. Shape Dependencies (Subqueries)

### Dependency Creation

When parsing a WHERE clause with subqueries:

```elixir
defp build_shape_dependencies(subqueries, opts) do
  shared_opts = Map.drop(opts, [:where, :columns, :relation])

  Utils.map_while_ok(subqueries, fn subquery ->
    shared_opts
    |> Map.put(:select, subquery)
    |> Map.put(:autofill_pk_select?, true)  # Always include PK
    |> Map.put(:log_mode, :full)            # Dependencies always use full log
    |> new()
  end)
end
```

Each subquery becomes a full Shape with its own consumer and materializer.

### Tag Structure and Move Tracking

**File**: `lib/electric/shapes/shape/subquery_moves.ex`

Tag structure defines how to track "why" a row is in a shape:

```elixir
def move_in_tag_structure(%Shape{} = shape) do
  Walker.reduce(shape.where.eval, fn
    %Eval.Parser.Func{name: "sublink_membership_check",
                      args: [testexpr, sublink_ref]}, {tags, comparison_expressions}, _ ->
      # Build tags from subquery references
      tags = case testexpr do
        %Eval.Parser.Ref{path: [column_name]} ->
          [[column_name | current_tag] | others]
        %Eval.Parser.RowExpr{elements: elements} ->
          [[{:hash_together, column_names} | current_tag] | others]
      end
      {:ok, {tags, Map.put(comparison_expressions, sublink_ref.path, testexpr)}}
    _, acc, _ -> {:ok, acc}
  end, {[[]], %{}})
end
```

### Materializer Implementation

**File**: `lib/electric/shapes/consumer/materializer.ex`

The materializer maintains an in-memory index of subquery results:

```elixir
%{
  stack_id: stack_id,
  shape_handle: shape_handle,
  index: %{},              # key -> value mapping
  tag_indices: %{},        # tag -> MapSet of keys
  value_counts: %{},       # value -> count (for reference counting)
  offset: LogOffset.before_all(),
  columns: [...],
  materialized_type: {:array, type},
  subscribers: MapSet.new()
}
```

**Reference counting** ensures move-in/out events are only sent when values actually enter/leave the set.

## 4. Shape Lifecycle

### Shape Creation and Registration

**Entry point**: `Electric.Shapes.get_or_create_shape_handle/2`

```elixir
def get_or_create_shape_handle(shape, stack_id, opts) do
  # Try fast path: shape already exists
  with {:ok, handle} <- fetch_handle_by_shape(shape, stack_id),
       {:ok, offset} <- fetch_latest_offset(stack_id, handle) do
    {handle, offset}
  else
    :error ->
      # Slow path: create shape and its dependencies
      GenServer.call(name(stack_id), {:create_or_wait_shape_handle, shape, opts[:otel_ctx]})
  end
end
```

### ShapeStatus Tracking

**File**: `lib/electric/shape_cache/shape_status.ex`

**ETS Tables** (per stack):

1. **`shape_hash_lookup_table`**: `{shape_handle, hash}` - Fast handle validation
2. **`shape_relation_lookup_table`**: `{{oid, shape_handle}, nil}` - Schema change detection
3. **`shape_last_used_table`**: `{shape_handle, monotonic_time}` - LRU eviction
4. **ShapeDb** (CubDB-backed): Full shape definitions - Persisted to disk

### Shape Rotation/Invalidation

Shapes are invalidated when:

- **Schema changes** affecting selected columns
- **Table rename/drop** (OID changes)
- **Dependency invalidation** (cascading)
- **Explicit deletion** via API

```elixir
def is_affected_by_relation_change?(shape, relation) do
  cond do
    # Different table entirely
    id != new_id and (schema != new_schema or table != new_table) -> false
    # OID changed but name same = table was dropped/recreated
    schema == new_schema and table == new_table and id != new_id -> true
    # Name changed but OID same = table was renamed
    id == new_id and (schema != new_schema or table != new_table) -> true
    # Column count changed for SELECT *
    flags.selects_all_columns and length(new_columns) != root_column_count -> true
    # Selected columns were affected
    true -> Enum.any?(selected_columns, &(&1 in affected_columns))
  end
end
```

## 5. Change Conversion and Filtering

### Change Types

**File**: `lib/electric/replication/changes.ex`

```elixir
defmodule NewRecord do
  defstruct [:relation, :record, :log_offset, :key, last?: false, move_tags: []]
end

defmodule UpdatedRecord do
  defstruct [:relation, :old_record, :record, :log_offset, :key, :old_key,
             move_tags: [], removed_move_tags: [], changed_columns: MapSet.new(), last?: false]
end

defmodule DeletedRecord do
  defstruct [:relation, :old_record, :log_offset, :key, last?: false, move_tags: []]
end
```

### Convert Change Algorithm

```elixir
def convert_change(shape, change, opts)

# Fast path: no WHERE, all columns selected
def convert_change(%{where: nil, flags: %{selects_all_columns: true}}, change, opts) do
  [fill_move_tags(change, shape, opts[:stack_id], opts[:shape_handle])]
end

# Updates: check both old and new records
def convert_change(%{where: where} = shape, %Changes.UpdatedRecord{} = change, opts) do
  old_in = WhereClause.includes_record?(where, old, extra_refs_old)
  new_in = WhereClause.includes_record?(where, new, extra_refs_new)

  case {old_in, new_in} do
    {true, true}   -> [change]                      # Normal update
    {true, false}  -> [convert_update(change, to: :deleted_record)]  # Move-out
    {false, true}  -> [convert_update(change, to: :new_record)]      # Move-in
    {false, false} -> []                            # Not in shape
  end
end
```

## 6. Key Algorithms Summary

### Shape Handle Generation

```
comparable = {:shape, table, pk, where_comparable, columns, flags, replica, log_mode}
hash = :erlang.phash2(comparable)
handle = "#{hash}-#{microsecond_timestamp}"
```

### WHERE Clause Evaluation

```
1. Parse SQL → PG AST (via PgQuery library)
2. Convert PG AST → Internal AST (Const, Ref, Func, Array)
3. Resolve types and operator overloads
4. Fold constants (immutable functions on constant args)
5. At runtime: Walk AST, evaluate bottom-up with nil propagation
```

### Change Conversion with WHERE

```
For INSERT:
  if where(record, extra_refs): emit NewRecord
  else: []

For DELETE:
  if where(old_record, extra_refs_old): emit DeletedRecord
  else: []

For UPDATE:
  old_in = where(old_record, extra_refs_old)
  new_in = where(record, extra_refs_new)

  case {old_in, new_in}:
    {true, true}   → UpdatedRecord
    {true, false}  → DeletedRecord (move-out)
    {false, true}  → NewRecord (move-in)
    {false, false} → []
```

## 7. Essential Files

| File                                           | Purpose                                         |
| ---------------------------------------------- | ----------------------------------------------- |
| `lib/electric/shapes/shape.ex`                 | Shape definition, validation, change conversion |
| `lib/electric/shapes/where_clause.ex`          | WHERE clause evaluation entry point             |
| `lib/electric/replication/eval/parser.ex`      | SQL parsing, AST building, type resolution      |
| `lib/electric/replication/eval/expr.ex`        | Evaluated expression wrapper                    |
| `lib/electric/replication/eval/runner.ex`      | Expression execution engine                     |
| `lib/electric/replication/eval/env.ex`         | Type system, functions, operators registry      |
| `lib/electric/shapes/shape/subquery_moves.ex`  | Move-in/out tag structure, query transformation |
| `lib/electric/shapes/consumer/materializer.ex` | Subquery result materialization                 |
| `lib/electric/shape_cache.ex`                  | Shape handle creation and lookup                |
| `lib/electric/shape_cache/shape_status.ex`     | Shape registration and ETS tracking             |
| `lib/electric/shapes/consumer.ex`              | Shape consumer process, change handling         |
| `lib/electric/replication/changes.ex`          | Change record data structures                   |
