# Implementation Plan: Arbitrary Boolean Expressions with Subqueries

## Executive Summary

This plan implements RFC "Arbitrary Boolean Expressions with Subqueries" which extends Electric's subquery support from single `IN (SELECT ...)` conditions to arbitrary boolean expressions with OR, NOT, and multiple subqueries. The implementation introduces DNF-based decomposition, per-row `active_conditions` arrays, and position-based move-in/move-out broadcasts.

RFC: ../../docs/rfcs/arbitrary-boolean-expressions-with-subqueries.md

## Key Architectural Constraint: Do Not Modify the Shape Struct

The `Shape` struct (`lib/electric/shapes/shape.ex`) is a primitive in Electric — it is used everywhere, serialized across boundaries, and embedded in many subsystems. **No new fields should be added to `Shape`.**

Instead, all DNF-related state (decomposition, position-to-dependency mappings, negated positions) is held in a separate `DnfContext` struct that lives in `Consumer.State`. The `DnfContext` is computed from the `Shape` and its dependencies at consumer startup time and is passed explicitly to functions that need it.

### DnfContext (`lib/electric/shapes/consumer/dnf_context.ex`)

A new module that encapsulates all DNF decomposition state:

```elixir
defmodule Electric.Shapes.Consumer.DnfContext do
  defstruct [
    decomposition: nil,                # %Decomposer.decomposition{} - the DNF result
    position_to_dependency_map: %{},   # %{position => dep_handle}
    dependency_to_positions_map: %{},  # %{dep_handle => [position]} - reverse lookup
    negated_positions: MapSet.new()    # positions where condition is negated (NOT IN)
  ]

  @doc """
  Build from a Shape and its dependency mappings. Returns nil if not needed.

  Uses `shape.shape_dependencies_handles` to build the position-to-dependency
  mapping. Calls `Decomposer.decompose/1` once; the result is cached on the struct
  and should be used by all downstream consumers (querying, move_handling,
  subquery_moves, etc.) rather than re-decomposing.
  """
  def from_shape(shape)

  @doc "Which DNF positions does this dependency handle affect?"
  def get_positions_for_dependency(ctx, dep_handle)

  @doc "Is this position negated (NOT IN)?"
  def position_negated?(ctx, position)

  @doc "Does this context have a valid DNF with subqueries?"
  def has_valid_dnf?(ctx)

  @doc "Compute active_conditions for a record against the DNF."
  def compute_active_conditions(ctx, record, used_refs, extra_refs)
end
```

This keeps the `Shape` struct lean while giving the consumer everything it needs to process DNF-aware move-in/move-out operations. The `DnfContext` is computed once and stored in `Consumer.State`, passed to `move_handling`, `change_handling`, `subquery_moves`, and `querying` as needed. Functions that currently reach into `shape.dnf_decomposition` or `shape.position_to_dependency_map` should instead accept the `DnfContext`. Note: shapes without dependencies already take a separate fast path in `change_handling` (the `when not Shape.has_dependencies(shape)` guard), so the DNF code path is only reached for shapes that have a `DnfContext`.

### Single Decomposition, Two Lifecycle Points

`Decomposer.decompose/1` is called at two distinct lifecycle points:

1. **Shape creation** (`Shape.new/5` and `Shape.from_json_safe/1`): `fill_tag_structure` calls the decomposer to build the multi-disjunct `tag_structure` that is persisted on the Shape.
2. **Consumer startup** (`DnfContext.from_shape/1`): decomposes again to build position-to-dependency maps, negated position tracking, and the cached decomposition used throughout the consumer's lifetime.

Since decomposition is deterministic (same AST always produces the same result), both calls produce identical output. This two-call pattern is acceptable because the calls happen at different lifecycle stages — shape creation may happen in a different process or even a different server restart from consumer startup.

**Within the consumer's lifetime**, always use `DnfContext`'s cached decomposition. Never re-decompose in `querying.ex`, `subquery_moves.ex`, `move_handling.ex`, etc. — accept the decomposition from DnfContext instead.

### Data Formats: condition_hashes, tags, and wire format

There are three distinct representations of per-row hashed values, each optimised for its consumer. All three are computed independently from the underlying column values — none is derived from another in code.

#### 1. condition_hashes

One hash per DNF position, stored as a map with integer keys for O(1) positional access:

```elixir
%{0 => "hash_x", 1 => "hash_status", 2 => "hash_y"}
```

- **Where**: binary move-in snapshot files (on disk stored sequentially, decoded into a map in memory), `moved_out_tags` filtering
- **Purpose**: position-aware filtering — "is the hash at position P in the moved-out set?"
- **No nils**: every DNF position has exactly one condition with column(s) that produce a hash for every row (NULL column values get the existing `"NULL"` sentinel, non-null get `"v:" <> value`)

#### 2. tags (internal 2D array)

One inner list per disjunct, with `nil` at non-participating positions:

```elixir
[["hash_x", "hash_status", nil], [nil, nil, "hash_y"]]
```

- **Where**: `move_tags` on change structs, `fill_move_tags` output, consumer processing
- **Purpose**: per-disjunct tag tracking for client-side inclusion evaluation

#### 3. wire/API tags (slash-delimited per disjunct)

One string per disjunct, positions separated by `/`:

```json
{"tags": ["hash_x/hash_status/", "//hash_y"]}
```

- **Where**: JSON headers sent to clients over HTTP, embedded in snapshot/move-in JSON by Postgres
- **Purpose**: compact JSON representation for the wire

#### How each format is computed

- **Postgres SQL queries** (snapshot + move-in) generate both condition_hashes (as a separate `text[]` column) and wire-format tags (baked into the JSON headers string) directly from the underlying column values. The MD5 expressions are shared — Postgres deduplicates identical subexpressions.
- **Binary snapshot write** stores condition_hashes from the separate column. The JSON column (with wire tags already embedded) is stored alongside.
- **Binary snapshot read** decodes sequential condition_hashes into `%{position => hash}` map for filtering.
- **`fill_move_tags`** in `shape.ex` computes the **internal 2D array** directly from the record for replication-stream changes.
- **`log_items.ex`** converts the internal 2D array to slash-delimited wire format when building log entry headers (via `Enum.map(tags, &Enum.join(&1, "/"))`).

#### Binary move-in snapshot file format

```
<<key_size::32, json_size::64, op_type::8, hash_count::16,
  [hash_size::16, hash::binary(hash_size)]...,
  key::binary(key_size), json::binary(json_size)>>
```

On disk, condition_hashes are sequential (position 0 first, then 1, etc.). On read, decode into `%{0 => hash0, 1 => hash1, ...}` for O(1) position lookup. The JSON already contains wire-format tags in its headers — no Elixir-side tag derivation needed at splice time.

### Sublink Index Resolution

When multiple subqueries reference the same column (e.g., `parent_id IN (SELECT ... WHERE category='a') OR parent_id IN (SELECT ... WHERE category='b')`), the sublink index (which dependency shape each subquery corresponds to) MUST be extracted directly from the AST node, NOT resolved by column-name matching.

Column-name matching is ambiguous: both subexpressions have `column == "parent_id"`, so column matching always resolves to the first dependency, producing identical `active_conditions` for what should be distinct subqueries.

Use `extract_sublink_index/1` to pattern-match on the AST's `sublink_membership_check` function node and extract the canonical `$sublink` index from its argument:

```elixir
# Resolve sublink index from AST — NOT from column name matching.
# Each sublink_membership_check AST node carries a $sublink reference
# that uniquely identifies its dependency, even when multiple subqueries
# use the same column.
defp extract_sublink_index(%Func{name: "sublink_membership_check", args: [_, sublink_ref]}) do
  case sublink_ref.path do
    ["$sublink", idx_str] -> String.to_integer(idx_str)
    _ -> nil
  end
end

defp extract_sublink_index(_), do: nil
```

This function is used in both `querying.ex` (for `active_conditions` SELECT columns) and `subquery_moves.ex` (for exclusion clauses). It should be defined once in a shared location (e.g., a helper in `SubqueryMoves` or a utility module) and referenced by both.

## Current State Analysis

### Key Files and Their Roles

| File | Current Role | Changes Needed |
|------|--------------|----------------|
| `lib/electric/shapes/consumer/dnf_context.ex` | **(new)** | Holds DNF decomposition state, built from Shape |
| `lib/electric/replication/eval/sql_generator.ex` | **(new)** | Converts AST back to SQL — used by querying.ex and subquery_moves.ex |
| `lib/electric/shapes/shape/subquery_moves.ex` | Tag structure generation, move-out messages, move-in WHERE clause + exclusion clauses | Extend for DNF positions, DNF-aware exclusion clauses, accept DnfContext |
| `lib/electric/shapes/consumer/state.ex` | Detects `or_with_subquery?`/`not_with_subquery?` to invalidate | Remove invalidation flags, hold DnfContext |
| `lib/electric/shapes/consumer.ex` | Triggers invalidation on OR/NOT with subqueries | Handle multiple positions |
| `lib/electric/shapes/consumer/move_handling.ex` | Single-subquery move-in/out processing | Per-position broadcasts, use DnfContext |
| `lib/electric/shapes/consumer/change_handling.ex` | Filters changes, computes tags | Compute `active_conditions` via DnfContext |
| `lib/electric/shapes/shape.ex` | `fill_move_tags`, `convert_change` | Multi-disjunct tags — **no new struct fields** |
| `lib/electric/shapes/where_clause.ex` | `includes_record?` boolean check | Per-position evaluation |
| `lib/electric/shapes/querying.ex` | SQL for initial data, tags | Add `active_conditions` columns, add `condition_hashes` SELECT for move-in queries, accept DnfContext |
| `lib/electric/log_items.ex` | Formats messages with tags | Add `active_conditions` to headers, convert 2D tags to wire format |
| `lib/electric/replication/eval/parser.ex` | Parses WHERE, handles SubLinks | No changes needed |
| `lib/electric/replication/eval/walker.ex` | AST traversal | No changes needed |
| `packages/elixir-client/.../tag_tracker.ex` | Client-side tag tracking, DNF eval, synthetic deletes | Slash-delimited normalization, `removed_tags` parsing, position-based indexing |
| `packages/elixir-client/.../message/headers.ex` | Client message headers | Add `active_conditions` field |

### Current Limitations Being Addressed

1. **Lines 291-297 in `consumer.ex`**: Shape invalidation on OR/NOT with subqueries or multiple dependencies
2. **Lines 32-33 in `consumer/state.ex`**: `or_with_subquery?` and `not_with_subquery?` flags
3. **Single tag structure**: `tag_structure` is `[[column_name]]` - single disjunct
4. **No `active_conditions`**: Client cannot determine which conditions are satisfied

---

## Implementation Steps

### Phase 1: DNF Decomposer (New Module)

**Create** `lib/electric/replication/eval/decomposer.ex`

```elixir
defmodule Electric.Replication.Eval.Decomposer do
  @moduledoc """
  Converts WHERE clause AST to Disjunctive Normal Form (DNF).

  DNF is a disjunction (OR) of conjunctions (AND) of literals.
  Each literal is either a positive or negated atomic condition.
  """

  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Eval.Walker

  @type position :: non_neg_integer()
  @type literal :: {position(), :positive | :negated}
  @type conjunction :: [literal()]
  @type dnf :: [conjunction()]

  @type subexpression :: %{
    ast: Parser.tree_part(),
    is_subquery: boolean(),
    negated: boolean()
  }

  @type decomposition :: %{
    disjuncts: dnf(),
    disjuncts_positions: [[position()]],  # polarity-stripped version for evaluate_dnf
    subexpressions: %{position() => subexpression()},
    position_count: non_neg_integer()
  }

  @max_disjuncts 100

  @spec decompose(Parser.tree_part()) :: {:ok, decomposition()} | {:error, term()}
  def decompose(ast) do
    # Implementation:
    # 1. Collect all atomic conditions (subqueries + field comparisons)
    # 2. Apply De Morgan's laws to push NOT inward
    # 3. Distribute AND over OR to get DNF
    # 4. Assign positions to each unique atomic condition
    # 5. Check complexity guard
    # 6. Return disjuncts as position references
  end
end
```

**Key Functions**:
- `decompose/1` - Main entry point
- `push_negation_inward/1` - De Morgan's laws
- `distribute_and_over_or/1` - DNF conversion
- `collect_atomics/1` - Extract atomic conditions
- `assign_positions/1` - Map conditions to positions

**Error handling**: If decomposition fails (e.g., unsupported AST structure) or the complexity guard triggers (`length(disjuncts) > @max_disjuncts`), return `{:error, reason}`. Callers during shape creation (`Shape.new/5`) propagate the error as a 400 response to the client with a descriptive message like `"WHERE clause too complex for DNF decomposition (N disjuncts exceeds limit of 100)"`. The shape is never created — there is no silent fallback to invalidation.

#### Position Stability Algorithm

Position assignment must be deterministic to ensure the same WHERE clause always produces the same position assignments across shape restarts:

```elixir
def assign_positions(atomics) do
  # Sort atomics by their AST string representation for determinism
  atomics
  |> Enum.sort_by(fn atomic ->
    # Use a canonical string representation
    :erlang.term_to_binary(atomic.ast)
  end)
  |> Enum.with_index()
  |> Enum.map(fn {atomic, idx} -> {idx, atomic} end)
  |> Map.new()
end
```

### Phase 2: SQL Generator (New Module)

**Create** `lib/electric/replication/eval/sql_generator.ex`

A general-purpose module that converts the parsed AST (from `Parser`) back into SQL strings.
Lives alongside `parser.ex`, `walker.ex`, `runner.ex`, and `decomposer.ex` in the `eval`
directory. Used by `querying.ex` (for `active_conditions` SELECT columns) and
`subquery_moves.ex` (for exclusion clauses) — both call `SqlGenerator.to_sql/1` instead of
inlining their own AST-to-SQL conversion.

```elixir
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

  alias Electric.Replication.Eval.Parser.{Const, Ref, Func, Array}

  @doc """
  Convert an AST node to a SQL string.

  Handles: comparison operators (=, <>, <, >, <=, >=), pattern matching
  (LIKE, ILIKE), nullability (IS NULL, IS NOT NULL), membership (IN),
  logical operators (AND, OR, NOT), column references, and constants
  (strings, integers, floats, booleans, NULL).

  Raises `ArgumentError` for unrecognised AST nodes.
  """
  @spec to_sql(Parser.tree_part()) :: String.t()

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

  # Nullability
  def to_sql(%Func{name: "is null", args: [arg]}),
    do: "(#{to_sql(arg)} IS NULL)"

  def to_sql(%Func{name: "is not null", args: [arg]}),
    do: "(#{to_sql(arg)} IS NOT NULL)"

  # Membership (IN with literal array)
  def to_sql(%Func{name: "in", args: [left, %Array{elements: elements}]}) do
    values = Enum.map_join(elements, ", ", &to_sql/1)
    "(#{to_sql(left)} IN (#{values}))"
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

  # Column references
  def to_sql(%Ref{path: path}) do
    ~s|"#{Enum.join(path, "\".\"")}"|
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

  # Catch-all — fail loudly so unsupported operators are caught at shape
  # creation time, not at query time.
  def to_sql(other) do
    raise ArgumentError,
      "SqlGenerator.to_sql/1: unsupported AST node: #{inspect(other)}. " <>
      "This WHERE clause contains an operator or expression type that " <>
      "cannot be converted back to SQL for active_conditions generation."
  end
end
```

**Tests**: `test/electric/replication/eval/sql_generator_test.exs`

Comprehensive unit tests covering all operator types (=, <>, <, >, <=, >=, LIKE, ILIKE,
IS NULL, IS NOT NULL, IN), logical connectives (AND, OR, NOT), column references
(simple and schema-qualified), constant types (nil, bool, string, integer, float with
single-quote escaping), error handling for unsupported AST nodes, and complex nested
expressions. All tests construct AST structs directly and assert `SqlGenerator.to_sql/1`
output. Representative examples:

```elixir
# Comparison: construct AST, assert SQL
test "equals" do
  ast = %Func{name: "\"=\"", args: [%Ref{path: ["status"]}, %Const{value: "active"}]}
  assert SqlGenerator.to_sql(ast) == ~s|("status" = 'active')|
end

# Nested logical: AND within OR
test "nested AND within OR" do
  a = %Func{name: "\"=\"", args: [%Ref{path: ["x"]}, %Const{value: 1}]}
  b = %Func{name: "\"=\"", args: [%Ref{path: ["y"]}, %Const{value: 2}]}
  c = %Func{name: "\"=\"", args: [%Ref{path: ["z"]}, %Const{value: 3}]}
  ast = %Func{name: "or", args: [%Func{name: "and", args: [a, b]}, c]}
  assert SqlGenerator.to_sql(ast) == ~s|((("x" = 1) AND ("y" = 2)) OR ("z" = 3))|
end

# Error handling: unsupported nodes raise ArgumentError
test "raises ArgumentError for unsupported AST node" do
  assert_raise ArgumentError, ~r/unsupported AST node/, fn ->
    SqlGenerator.to_sql(%{unexpected: :node})
  end
end
```

**Coverage invariant**: `SqlGenerator` must handle every AST node that `Parser` can produce.
The hardcoded operator list above must stay in sync with `known_functions.ex` and the
parser's built-in node types (boolean tests, casts, etc.). To enforce this, add a
property-based round-trip test using `stream_data`:

```elixir
describe "round-trip: SQL -> Parser -> SqlGenerator -> SQL" do
  # Normalize by stripping outer parens and collapsing whitespace,
  # so `((x = 1))` and `(x = 1)` compare equal.
  defp normalize_sql(sql) do
    sql
    |> String.trim()
    |> String.replace(~r/\s+/, " ")
    |> strip_outer_parens()
  end

  defp strip_outer_parens("(" <> _ = s) do
    if String.ends_with?(s, ")") do
      inner = s |> String.slice(1..-2//1) |> String.trim()
      # Only strip if the parens are balanced (not part of nested expr)
      if balanced?(inner), do: strip_outer_parens(inner), else: s
    else
      s
    end
  end
  defp strip_outer_parens(s), do: s

  property "any parseable WHERE clause round-trips through SqlGenerator" do
    check all sql <- where_clause_generator() do
      {:ok, ast} = Parser.parse_and_validate_expression(sql)
      regenerated = SqlGenerator.to_sql(ast)
      assert normalize_sql(sql) == normalize_sql(regenerated)
    end
  end
end
```

The `where_clause_generator/0` should produce arbitrary combinations of supported
operators, column refs, constants, and logical connectives — ensuring that any expression
the parser accepts can be regenerated. If `SqlGenerator.to_sql/1` raises `ArgumentError`
for a parseable expression, the test fails, catching coverage gaps immediately.

### Phase 3: DnfContext (New Module)

**Create** `lib/electric/shapes/consumer/dnf_context.ex` (see "Key Architectural Constraint" above)

`DnfContext.from_shape/1` calls `Decomposer.decompose/1` once and caches the result. All downstream consumers use this cached decomposition.

#### Dependency Handle to Position Mapping

Built inside `DnfContext.from_shape/1` using `shape.shape_dependencies_handles`:

```elixir
# Inside DnfContext.from_shape/1
defp build_position_to_dependency_map(decomposition, dep_handles) do
  decomposition.subexpressions
  |> Enum.filter(fn {_pos, subexpr} -> subexpr.is_subquery end)
  |> Enum.map(fn {pos, subexpr} ->
    # Use extract_sublink_index/1 (see "Sublink Index Resolution" above)
    # to get the dependency index from the AST, NOT by column-name matching.
    dep_index = extract_sublink_index(subexpr.ast)
    dep_handle = Enum.at(dep_handles, dep_index)
    {pos, dep_handle}
  end)
  |> Map.new()
end

# DnfContext also builds the reverse map
defp build_dependency_to_positions_map(pos_to_dep) do
  Enum.group_by(pos_to_dep, fn {_pos, handle} -> handle end, fn {pos, _} -> pos end)
end

# Used by move_handling.ex via DnfContext.get_positions_for_dependency/2
```

**Note:** Same subquery can appear at multiple positions (e.g., `x IN sq AND y IN sq`).

#### Protocol Validation

```elixir
# In lib/electric/shapes/api.ex or shape validation
defp validate_protocol_compatibility(dnf_context, protocol_version) do
  has_complex_subqueries? = dnf_context != nil and
    DnfContext.has_valid_dnf?(dnf_context) and
    (length(dnf_context.decomposition.disjuncts) > 1 or
     MapSet.size(dnf_context.negated_positions) > 0)

  cond do
    protocol_version == 1 and has_complex_subqueries? ->
      {:error, :protocol_version_too_low,
        "WHERE clauses with OR or NOT combined with subqueries require protocol version 2. " <>
        "Please upgrade your client."}

    true ->
      :ok
  end
end
```

**Protocol version detection:**
- Client sends `Electric-Protocol-Version: 2` header
- Server checks before shape creation
- Returns 400 with descriptive error for v1 clients with complex shapes

### Phase 4: Shape Tag Structure and fill_move_tags

**Modify** `lib/electric/shapes/shape.ex` — **no new struct fields**

1. Update `fill_tag_structure/1` to produce multi-disjunct tag structures using the decomposer. The `tag_structure` field already exists on Shape and is the right place for this — it's the pattern used to hash column values into tags. For DNF shapes it becomes a list of lists (one per disjunct) where each inner list has an entry per DNF position (`nil` for positions not in that disjunct, column name(s) for participating positions):

```elixir
defp fill_tag_structure(shape) do
  case shape.where do
    nil -> shape
    where ->
      case Decomposer.decompose(where.eval) do
        {:ok, decomposition} ->
          # Build tag_structure as list of lists (one per disjunct)
          tag_structure = build_tag_structure_from_dnf(decomposition)
          %{shape | tag_structure: tag_structure}

        {:error, reason} ->
          # Propagate error — shape creation fails with 400
          raise "DNF decomposition failed: #{inspect(reason)}"
      end
  end
end
```

This is one of two lifecycle points where `Decomposer.decompose/1` is called (see "Single Decomposition, Two Lifecycle Points" above). The result is used only to build the tag_structure; the full decomposition is re-derived at consumer startup in `DnfContext.from_shape/1`.

2. Update `fill_move_tags/4` to produce the **internal 2D array** format (not slash-delimited strings). The existing `make_tags_from_pattern` currently calls `Enum.join("/")` to produce slash-delimited strings; this changes to return lists directly:

```elixir
def fill_move_tags(%Changes.NewRecord{record: record} = change, shape, stack_id, shape_handle) do
  tags = Enum.map(shape.tag_structure, fn disjunct_pattern ->
    Enum.map(disjunct_pattern, fn
      nil -> nil  # Position not in this disjunct
      column_spec -> hash_column_value(column_spec, record, stack_id, shape_handle)
    end)
  end)

  %{change | move_tags: tags}
end
```

The conversion from internal 2D arrays to slash-delimited wire format happens in `log_items.ex` (Phase 8), not here.

### Phase 5: Consumer State Updates

**Modify** `lib/electric/shapes/consumer/state.ex`

Remove invalidation flags and add `dnf_context`:

```elixir
defstruct [
  # ... existing fields ...
  # REMOVE: or_with_subquery?: false,
  # REMOVE: not_with_subquery?: false,
  # ADD:
  dnf_context: nil,  # %DnfContext{} - built from shape at init time
]
```

Also remove `has_or_with_subquery?/1`, `has_not_with_subquery?/1`, and `subtree_has_sublink?/1` helper functions.

Build DnfContext during initialization:

```elixir
@spec initialize_shape(uninitialized_t(), Shape.t()) :: uninitialized_t()
def initialize_shape(%__MODULE__{} = state, shape) do
  %{state | shape: shape, dnf_context: DnfContext.from_shape(shape)}
end
```

The `DnfContext` holds all position-to-dependency mappings, negated position tracking, and the decomposition itself. No per-position state is added to `Shape` or `Consumer.State` directly — it all lives on the `DnfContext`.

### Phase 6: Active Conditions Computation

**Modify** `lib/electric/shapes/where_clause.ex`

`compute_active_conditions` is called via `DnfContext.compute_active_conditions/4` which delegates here. The decomposition is passed in from the DnfContext, not read from the Shape.

```elixir
defmodule Electric.Shapes.WhereClause do
  @doc """
  Compute active_conditions array for a record.
  Returns list of **effective** booleans, one per position in the DNF.
  For negated positions, the stored AST is the un-negated form, so we
  apply NOT here to produce the value clients can use directly without
  needing polarity information.
  The decomposition is passed from DnfContext, not from the Shape struct.
  """
  @spec compute_active_conditions(Decomposer.decomposition(), map(), map(), map()) :: [boolean()]
  def compute_active_conditions(decomposition, record, used_refs, extra_refs) do
    %{subexpressions: subexpressions, position_count: position_count} = decomposition

    Enum.map(0..(position_count - 1), fn position ->
      subexpr = Map.fetch!(subexpressions, position)
      value = evaluate_subexpression(subexpr, record, used_refs, extra_refs)
      # Apply negation so active_conditions stores the effective value.
      if subexpr.negated, do: not value, else: value
    end)
  end

  @doc """
  Evaluate DNF to determine if record is included.

  `active_conditions` stores effective values (negation already applied),
  so we only need position indices — polarity is irrelevant here.
  Callers strip polarity before calling this function (see
  `decomposition.disjuncts_positions`).
  """
  @spec evaluate_dnf([boolean()], [[Decomposer.position()]]) :: boolean()
  def evaluate_dnf(active_conditions, disjuncts_positions) do
    Enum.any?(disjuncts_positions, fn conjunction_positions ->
      Enum.all?(conjunction_positions, fn pos ->
        Enum.at(active_conditions, pos, false) == true
      end)
    end)
  end
end
```

### Phase 7: Move-in/Move-out Message Format + DNF-Aware Exclusion Clauses

**Modify** `lib/electric/shapes/shape/subquery_moves.ex`

> **IMPORTANT — exclusion clause logic lives here.** `move_in_where_clause/4` already
> generates the WHERE clause for move-in queries, including exclusion clauses that prevent
> duplicate inserts when a row is already in the shape via another disjunct. The existing
> index-based exclusion (`build_exclusion_clauses`) is **wrong for AND+OR combinations** —
> it excludes ALL other subquery dependencies by index, but should only exclude dependencies
> in disjuncts that do NOT contain the triggering dependency. For example, in
> `(x IN sq1 AND y IN sq2) OR z IN sq3`, when sq1 triggers, the old code excludes both sq2
> and sq3, but sq2 should NOT be excluded since it's in the same disjunct as sq1.
>
> Replace `build_exclusion_clauses` with `build_dnf_exclusion_clauses` that uses the
> decomposition to partition disjuncts into containing/not-containing the trigger position,
> and only generates `AND NOT (...)` for disjuncts not containing it.

#### 7a: DNF-aware exclusion clauses in `move_in_where_clause`

The function accepts `dnf_context` (from `Consumer.State`) to avoid re-decomposition:

```elixir
def move_in_where_clause(shape, shape_handle, move_ins, dnf_context, opts) do
  # ... existing code to find index, target_section, handle remove_not ...

  # Build exclusion clauses for other subqueries to avoid duplicate inserts
  # when a row is already in the shape via another disjunct.
  # Uses the cached decomposition from DnfContext.
  exclusion_clauses =
    case dnf_context do
      %DnfContext{decomposition: %{disjuncts: disjuncts} = decomposition}
          when length(disjuncts) > 1 ->
        build_dnf_exclusion_clauses(decomposition, shape_dependencies, comparison_expressions, index)
      _ ->
        ""
    end

  # ... rest of function, appending exclusion_clauses to the query ...
end

# Find all DNF positions that correspond to a given dependency index.
# A single dependency can appear at multiple positions (e.g., the same subquery
# referenced in different parts of the WHERE clause).
defp find_dnf_positions_for_dep_index(decomposition, dep_index) do
  Enum.flat_map(decomposition.subexpressions, fn {pos, subexpr} ->
    if subexpr.is_subquery and extract_sublink_index(subexpr.ast) == dep_index do
      [pos]
    else
      []
    end
  end)
end

# Build exclusion clauses using DNF decomposition.
# Only excludes subqueries in disjuncts that do NOT contain the triggering dependency.
# For example, in `(x IN sq1 AND y IN sq2) OR z IN sq3`:
#   - When sq1 triggers, sq2 is in the same disjunct so NOT excluded; sq3 IS excluded
defp build_dnf_exclusion_clauses(decomposition, shape_dependencies, comparison_expressions, trigger_dep_index) do
  trigger_positions = find_dnf_positions_for_dep_index(decomposition, trigger_dep_index)

  if trigger_positions == [] do
    ""
  else
    # Partition disjuncts into those containing vs not containing any trigger position
    {_containing, not_containing} =
      Enum.split_with(decomposition.disjuncts, fn conjunction ->
        Enum.any?(conjunction, fn {pos, _polarity} -> pos in trigger_positions end)
      end)

    # Generate exclusion for each disjunct NOT containing the trigger
    clauses =
      Enum.flat_map(not_containing, fn conjunction ->
        case generate_disjunct_exclusion(conjunction, decomposition, shape_dependencies, comparison_expressions) do
          nil -> []
          clause -> [clause]
        end
      end)

    Enum.join(clauses)
  end
end

# Generate an exclusion clause for a single disjunct (conjunction of literals).
# Returns nil if the disjunct contains any non-subquery positions (weaker exclusion
# is safe since the client deduplicates via tags).
# Otherwise returns " AND NOT (cond1 AND cond2 AND ...)"
defp generate_disjunct_exclusion(conjunction, decomposition, shape_dependencies, comparison_expressions) do
  all_subquery? = Enum.all?(conjunction, fn {pos, _polarity} ->
    case Map.get(decomposition.subexpressions, pos) do
      %{is_subquery: true} -> true
      _ -> false
    end
  end)

  if not all_subquery? do
    nil
  else
    conditions = Enum.flat_map(conjunction, fn {pos, polarity} ->
      info = Map.get(decomposition.subexpressions, pos)
      # Use extract_sublink_index/1 — see "Sublink Index Resolution" above
      case extract_sublink_index(info.ast) do
        nil -> []
        dep_index ->
          subquery_shape = Enum.at(shape_dependencies, dep_index)
          subquery_section = rebuild_subquery_section(subquery_shape)
          column_sql = get_column_sql(comparison_expressions, dep_index)
          if column_sql do
            condition = "#{column_sql} #{subquery_section}"
            case polarity do
              :positive -> [condition]
              :negated -> ["NOT #{condition}"]
            end
          else
            []
          end
      end
    end)

    if conditions == [], do: nil, else: " AND NOT (#{Enum.join(conditions, " AND ")})"
  end
end
```

#### 7b: Move-in/move-out control messages with position information

```elixir
@doc """
Generate move-in control message with position information.
"""
def make_move_in_control_message(shape, stack_id, shape_handle, position, values) do
  hashed_values = Enum.map(values, fn value ->
    make_value_hash(stack_id, shape_handle, value)
  end)

  %{
    headers: %{
      control: "move-in",
      position: position,
      values: hashed_values
    }
  }
end

@doc """
Generate move-out control message with position information.
"""
def make_move_out_control_message(shape, stack_id, shape_handle, position, values) do
  hashed_values = Enum.map(values, fn {_key, value} ->
    make_value_hash(stack_id, shape_handle, value)
  end)

  %{
    headers: %{
      control: "move-out",
      position: position,
      values: hashed_values
    }
  }
end
```

### Phase 8: Log Items Format

**Modify** `lib/electric/log_items.ex`

Two changes: add `active_conditions` to headers, and convert internal 2D tag arrays to slash-delimited wire format.

```elixir
def from_change(%Changes.NewRecord{} = change, txids, _, _replica) do
  headers = %{
    operation: :insert,
    txids: List.wrap(txids),
    relation: Tuple.to_list(change.relation),
    lsn: to_string(change.log_offset.tx_offset),
    op_position: change.log_offset.op_offset
  }
  |> put_if_true(:last, change.last?)
  |> put_if_true(:tags, change.move_tags != [], tags_to_wire(change.move_tags))
  |> put_if_true(:active_conditions, change.active_conditions != nil, change.active_conditions)

  [{change.log_offset, %{key: change.key, value: change.record, headers: headers}}]
end

# Convert internal 2D tag array to slash-delimited wire format.
# [["hash_x", "hash_status", nil], [nil, nil, "hash_y"]]
# → ["hash_x/hash_status/", "//hash_y"]
defp tags_to_wire(tags) do
  Enum.map(tags, fn disjunct ->
    Enum.map_join(disjunct, "/", fn
      nil -> ""
      hash -> hash
    end)
  end)
end
```

#### Message Format Migration

**Current format** (single-subquery, flat):
```json
{"tags": ["hash1/hash2"]}
```

**New format** (multi-disjunct):
```json
{"tags": ["hash1/hash2/", "//hash3"], "active_conditions": [true, true, false]}
{"control": "move-out", "position": 0, "values": ["hash1", "hash2"]}
```

**Migration strategy:**
The existing `tagged_subqueries` feature flag already gates all subquery move-in/move-out support. The new multi-disjunct format is an extension of the same mechanism — single-subquery shapes produce tags with one entry (unchanged semantics), while multi-disjunct shapes produce multiple entries. No second feature flag is needed. The `tagged_subqueries` flag continues to be the single gate for all subquery tag support.

Clients must be updated to handle the new format before shapes with OR/NOT subqueries are used (enforced by protocol version validation in Phase 3).

### Phase 9: Change Handling Updates

**Modify** `lib/electric/shapes/consumer/change_handling.ex`

Uses `state.dnf_context` (from `Consumer.State`) to compute active conditions and evaluate DNF inclusion. Per the RFC ("Replication Stream Updates"), `compute_active_conditions` replaces the separate `includes_record?` call — a single pass, not double evaluation.

```elixir
def do_process_changes([change | rest], %State{shape: shape, dnf_context: dnf_context} = state, ctx, acc, count) do
  # Compute active_conditions for this change via DnfContext
  active_conditions = DnfContext.compute_active_conditions(dnf_context, change.record, used_refs, ctx.extra_refs)

  # Evaluate DNF to check inclusion
  included = WhereClause.evaluate_dnf(
    active_conditions,
    dnf_context.decomposition.disjuncts_positions
  )

  if included do
    change_with_conditions = %{change | active_conditions: active_conditions}

    case Shape.convert_change(shape, change_with_conditions, opts) do
      [] -> do_process_changes(rest, state, ctx, acc, count)
      [converted] ->
        state = State.track_change(state, ctx.xid, converted)
        do_process_changes(rest, state, ctx, [converted | acc], count + 1)
    end
  else
    do_process_changes(rest, state, ctx, acc, count)
  end
end
```

#### `changes_only` Mode

The `changes_only` mode uses the same tag/active_conditions computation as full sync — no separate path needed. The existing `do_process_changes/5` pipeline in `change_handling.ex` is already agnostic to `log_mode`, and the new DNF fields (`move_tags`, `active_conditions`) are computed by `Shape.convert_change` uniformly for all shapes.

**Client behavior in `changes_only` mode:**
- Clients build state incrementally from WAL changes only (no initial snapshot)
- Move-in/move-out broadcasts for unknown rows are **ignored** (row not in local state)
- Tags and `active_conditions` on insert/update/delete are processed normally
- Since there is no snapshot, the client never needs to apply `moved_out` logic to snapshot rows — its DNF evaluator only handles tags/active_conditions on inserts, updates, and deletes

**How clients distinguish "unknown row" from "known row with all conditions false":**
Clients maintain a map of tracked row keys. A move-in/move-out broadcast for a key not in this map is simply ignored. A broadcast for a key that IS in the map triggers active_conditions re-evaluation and possible synthetic delete. This is the same pattern as existing single-subquery `changes_only` handling.

#### Struct Changes Required

**Modify `lib/electric/replication/changes.ex`:**

```elixir
defmodule Electric.Replication.Changes.NewRecord do
  defstruct [
    # ... existing fields ...
    :move_tags,           # [[hash | nil]] - 2D array, one inner list per disjunct
    :active_conditions,   # [boolean] - one per position
    :removed_tags         # [[hash | nil]] - for updates only
  ]
end

defmodule Electric.Replication.Changes.UpdatedRecord do
  defstruct [
    # ... existing fields ...
    :move_tags,
    :active_conditions,
    :removed_tags  # Tags from old record that no longer apply
  ]
end

defmodule Electric.Replication.Changes.DeletedRecord do
  defstruct [
    # ... existing fields ...
    :move_tags,  # Tags at time of deletion (for client cleanup)
    :active_conditions
  ]
end
```

### Phase 10: Querying Updates for Initial Snapshot

**Modify** `lib/electric/shapes/querying.ex`

> **IMPORTANT — condition_hashes vs wire tags:** `querying.ex` generates two different
> hash-based outputs (see "Data Formats" above): (1) wire/API tags sent to clients
> (slash-delimited per-disjunct via `make_tags`, embedded in JSON headers), and
> (2) condition_hashes used internally for `moved_out_tags` filtering (one hash per DNF
> position via `make_condition_hashes_select` — see Phase 12). `query_move_in` SELECTs
> both: condition_hashes as a separate `text[]` column, and wire tags baked into the JSON.
> Postgres deduplicates the MD5 calls across both columns.

```elixir
defp build_active_conditions_select(dnf_context) do
  case dnf_context do
    nil -> ""
    %DnfContext{decomposition: %{subexpressions: subexpressions, position_count: position_count}} ->
      conditions = Enum.map(0..(position_count - 1), fn pos ->
        subexpr = Map.fetch!(subexpressions, pos)
        sql = case subexpr do
          %{is_subquery: true} ->
            generate_subquery_condition_sql(subexpr, comparison_expressions, shape_dependencies)
          %{is_subquery: false} ->
            # Non-subquery conditions (field comparisons like status = 'active')
            # MUST be converted to real SQL — returning "true" is WRONG for OR
            # shapes where a row can be in the result via a different disjunct.
            SqlGenerator.to_sql(subexpr.ast)
        end
        # For negated positions, wrap in NOT to produce the effective condition
        # value. The decomposer stores the un-negated AST with negated=true,
        # so we must apply the negation here to match the Elixir-side semantics
        # in compute_active_conditions/4.
        if subexpr.negated, do: "(NOT #{sql})", else: sql
      end)

      ", ARRAY[#{Enum.join(conditions, ", ")}]::boolean[] as active_conditions"
  end
end
```

For subquery subexpressions, use `extract_sublink_index/1` (see "Sublink Index Resolution" above) to resolve the dependency index from the AST:

```elixir
# For subquery subexpressions, generate SQL like:
#   ("parent_id" IN (SELECT id FROM parent WHERE category = 'a'))
defp generate_subquery_condition_sql(subexpr, comparison_expressions, shape_dependencies) do
  # Use extract_sublink_index/1 — see "Sublink Index Resolution" above
  sublink_index = extract_sublink_index(subexpr.ast)

  dep_shape = if sublink_index, do: Enum.at(shape_dependencies, sublink_index)

  if dep_shape do
    subquery_section = rebuild_subquery_section(dep_shape)
    column_sql = get_column_sql_for_subexpr(subexpr, comparison_expressions, sublink_index)

    # Return the un-negated condition — negation is applied by
    # build_active_conditions_select's outer wrapper so that all
    # positions (subquery and non-subquery) are negated uniformly.
    ~s[(#{column_sql} #{subquery_section})]
  else
    raise "Could not resolve dependency shape for sublink index #{inspect(sublink_index)}"
  end
end
```

```elixir
defp build_headers_part({schema, table}, additional_headers, tags, active_conditions_sql) do
  # Include active_conditions in headers JSON
  # ...
end
```

### Phase 11: Move Handling for Multiple Positions

**Modify** `lib/electric/shapes/consumer/move_handling.ex`

> **IMPORTANT:** This phase changes how move-in/move-out events are processed, but does NOT
> update the `moved_out_tags` filtering that prevents stale query results. That is Phase 12,
> which MUST be implemented immediately after — without it, `moved_out_tags` compares bare
> hashes against slash-delimited tag strings and never matches, silently allowing stale
> rows through.

Uses `state.dnf_context` for position lookups and negation checks. Delegates WHERE clause
generation (including DNF-aware exclusion clauses) to `SubqueryMoves.move_in_where_clause/5`
(Phase 7a). This module handles the **orchestration** (which positions to activate/deactivate,
when to query vs broadcast), not the SQL generation.

```elixir
def process_move_ins(%State{dnf_context: dnf_context} = state, dep_handle, new_values) do
  # Find which positions this dependency affects via DnfContext
  positions = DnfContext.get_positions_for_dependency(dnf_context, dep_handle)

  # Separate negated from positive positions
  negated_positions = Enum.filter(positions, &DnfContext.position_negated?(dnf_context, &1))
  positive_positions = positions -- negated_positions

  state =
    if negated_positions != [] do
      # Move-in to subquery = deactivation of NOT IN condition -> move-out
      broadcast_deactivation(state, negated_positions, new_values)
    else
      state
    end

  if positive_positions != [] do
    # Move-in to subquery = activation of IN condition -> query for new rows
    # SubqueryMoves.move_in_where_clause handles DNF-aware exclusion (Phase 7a)
    formed_where_clause = SubqueryMoves.move_in_where_clause(shape, dep_handle, values, dnf_context)
    do_move_in_with_where(state, dep_handle, new_values, formed_where_clause)
  else
    state
  end
end

def process_move_outs(%State{dnf_context: dnf_context} = state, dep_handle, removed_values) do
  positions = DnfContext.get_positions_for_dependency(dnf_context, dep_handle)

  negated_positions = Enum.filter(positions, &DnfContext.position_negated?(dnf_context, &1))
  positive_positions = positions -- negated_positions

  state =
    if positive_positions != [] do
      # Move-out from subquery = deactivation of IN condition -> broadcast move-out
      broadcast_deactivation(state, positive_positions, removed_values)
    else
      state
    end

  if negated_positions != [] do
    # Move-out from subquery = activation of NOT IN condition -> query for new rows
    # Pass remove_not: true to strip NOT from the WHERE clause
    formed_where_clause = SubqueryMoves.move_in_where_clause(shape, dep_handle, values, dnf_context, remove_not: true)
    do_move_in_with_where(state, dep_handle, removed_values, formed_where_clause)
  else
    state
  end
end
```

#### Negation Handling in Move Processing

Move handling inverts behavior for negated positions:
- Move-in to subquery + negated position = **deactivation** (NOT IN now false)
- Move-out from subquery + negated position = **activation** (NOT IN now true)

**Same value at multiple positions** (e.g., `x IN sq OR x NOT IN sq`):
```elixir
# Positions: 0 (positive), 1 (negated)
# Row with x='a' where 'a' is in subquery:
tags: [[hash(a), nil], [nil, hash(a)]]  # Same hash, different positions
active_conditions: [true, false]  # Opposite values
```

### Phase 12: Position-aware `moved_out_tags` (condition_hashes + Filtering)

**CRITICAL — correctness requirement, not optional.** Without this phase, move-out filtering
is silently broken for all multi-disjunct shapes.

The existing `moved_out_tags` mechanism (which prevents stale move-in query results from
entering the log) compares bare hashes against values stored in snapshot files. When Phase 4
changes wire tags to slash-delimited per-disjunct strings (embedded in JSON), the old
approach of storing wire tags in the binary file and filtering against them no longer works.

The solution uses the **condition_hashes** format (see "Data Formats" above): store one hash
per DNF position separately from the JSON. Additionally, filtering must be position-aware:
a move-out at position 0 should not affect position 1 even if both positions contain the
same hash (e.g., `x IN sq1 OR x IN sq2` where both reference the same column).

This phase has two parts:

#### Part 1: Move-in snapshot files store condition_hashes (not tags)

**Modify** `lib/electric/shapes/querying.ex`

Add `make_condition_hashes_select/3` alongside the existing `make_tags/3`.
Uses `extract_columns_from_ast/1` to get the column name(s) from each subexpression's
AST — the subexpression type itself only stores `{ast, is_subquery, negated}`, so column
extraction is done here at SQL generation time rather than at decomposition time.

```elixir
# Extract column name(s) referenced by a subexpression's AST.
# Returns a list of column names (single-element for simple `x IN (SELECT ...)`).
defp extract_columns_from_ast(ast) do
  # Walk the AST to find column references. For ScalarArrayOpExpr the left
  # operand is the column ref; for RowCompareExpr it's a list of column refs.
  case ast do
    %{left: %{name: column_name}} -> [column_name]
    %{left: %{args: args}} -> Enum.map(args, & &1.name)
  end
end

# make_tags:                    [[x, y], [nil, z]] -> ["md5(x)/md5(y)", "/md5(z)"]
# make_condition_hashes_select: positions [x, y, z] -> ["md5(x)", "md5(y)", "md5(z)"]
#
# One hash per DNF position. No nils — every position has a condition with column(s)
# that produce a hash for every row (NULL column values use the existing sentinel).
defp make_condition_hashes_select(dnf_context, stack_id, shape_handle) do
  escaped_prefix = escape_sql_string(to_string(stack_id) <> to_string(shape_handle))

  dnf_context.decomposition.subexpressions
  |> Enum.sort_by(fn {pos, _} -> pos end)
  |> Enum.map(fn {_pos, subexpr} ->
    columns = extract_columns_from_ast(subexpr.ast)

    column_parts =
      Enum.map(columns, fn col_name ->
        col = pg_cast_column_to_text(col_name)
        ~s['#{col_name}:' || #{pg_namespace_value_sql(col)}]
      end)

    ~s[md5('#{escaped_prefix}' || #{Enum.join(column_parts, " || ")})]
  end)
end
```

`query_move_in/6` SELECTs both condition_hashes (separate column for binary file)
and wire-format tags (embedded in JSON headers). Postgres deduplicates the MD5 calls:

```elixir
def query_move_in(conn, stack_id, shape_handle, shape, dnf_context, {where, params}) do
  table = Utils.relation_to_sql(shape.root_table)

  {json_like_select, _} =
    json_like_select(shape, %{"is_move_in" => true}, stack_id, shape_handle)

  key_select = key_select(shape)
  condition_hashes_select =
    make_condition_hashes_select(dnf_context, stack_id, shape_handle) |> Enum.join(", ")

  query =
    Postgrex.prepare!(
      conn,
      table,
      ~s|SELECT #{key_select}, ARRAY[#{condition_hashes_select}]::text[], #{json_like_select} FROM #{table} WHERE #{where}|
    )

  Postgrex.stream(conn, query, params)
  |> Stream.flat_map(& &1.rows)
end
```

#### Part 2: `moved_out_tags` becomes position-aware

**Modify** `lib/electric/shapes/consumer/move_ins.ex`

Change the type from `%{name => MapSet}` to `%{name => %{position => MapSet}}`:

```elixir
@type t() :: %__MODULE__{
  moved_out_tags: %{move_in_name() => %{non_neg_integer() => MapSet.t(String.t())}}
}

def add_waiting(state, name, moved_values) do
  # ... existing logic ...
  # Initialize with empty map — positions are added by move_out_happened
  moved_out_tags: Map.put(state.moved_out_tags, name, %{})
end

def move_out_happened(state, position, new_hashes) do
  moved_out_tags =
    Map.new(state.moved_out_tags, fn {name, per_pos_tags} ->
      updated = Map.update(per_pos_tags, position, new_hashes, &MapSet.union(&1, new_hashes))
      {name, updated}
    end)
  %{state | moved_out_tags: moved_out_tags}
end
```

**Modify** `lib/electric/shapes/consumer/move_handling.ex`

Pass position through to `move_out_happened`. Extract position from control message patterns:

```elixir
# Move-out: extract {position, hashes} from control message patterns
patterns_by_pos =
  message.headers.patterns
  |> Enum.group_by(& &1[:pos], & &1[:value])

Enum.each(patterns_by_pos, fn {position, hashes} ->
  MoveIns.move_out_happened(state.move_handling_state, position, MapSet.new(hashes))
end)

# At query_complete, pass the per-position map to storage filtering:
state.move_handling_state.moved_out_tags[name] || %{}
```

**Modify** `lib/electric/shape_cache/storage.ex` — update type spec:

```elixir
condition_hashes_to_skip :: %{non_neg_integer() => MapSet.t(String.t())}
```

**Modify** `lib/electric/shape_cache/pure_file_storage.ex` and `in_memory_storage.ex`

Replace `all_parents_moved_out?/2` with position-aware filtering.

On read, decode the sequential binary condition_hashes into a map for O(1) lookup:

```elixir
defp read_condition_hashes(file, hash_count) do
  for i <- 0..(hash_count - 1)//1, into: %{} do
    <<hash_size::16>> = IO.binread(file, 2)
    <<hash::binary-size(hash_size)>> = IO.binread(file, hash_size)
    {i, hash}
  end
end
```

Position-aware filtering — ANY match means skip (the move-in query's exclusion
clause already filtered out rows present via other disjuncts, so any match at a
tracked position means this row was returned for a now-invalid reason):

```elixir
defp should_skip_for_moved_out?(_condition_hashes, condition_hashes_to_skip)
     when map_size(condition_hashes_to_skip) == 0,
     do: false

defp should_skip_for_moved_out?(condition_hashes, condition_hashes_to_skip) do
  Enum.any?(condition_hashes_to_skip, fn {position, skip_set} ->
    case condition_hashes do
      %{^position => hash} -> MapSet.member?(skip_set, hash)
      _ -> false
    end
  end)
end
```

Bump `@version` from 1 -> 2 in `pure_file_storage.ex` to invalidate old-format snapshots. This means in-flight shapes will restart with fresh snapshots on deployment — a brief interruption, not data loss.

Rename `tags` variables in binary read/write functions to `condition_hashes` for clarity.

#### Why this is easy to miss

This phase fixes the **interaction** between new multi-disjunct tag formats (Phase 4) and
pre-existing race-condition filtering in the storage layer. Each piece works correctly in
isolation — the bug only manifests when wire-format tags (slash-delimited strings in JSON)
are compared against bare hashes at filtering time. The solution is to store
condition_hashes (per-position hashes) separately from the JSON, so filtering never touches
the wire format. No test will catch this unless it specifically exercises the
move-out-while-move-in-in-flight race condition with a multi-disjunct shape.

#### Files changed

- `querying.ex` — add `extract_columns_from_ast/1` and `make_condition_hashes_select/3`, SELECT condition_hashes as separate column alongside JSON with embedded wire tags in `query_move_in/6`
- `move_ins.ex` — change `moved_out_tags` type to `%{name => %{position => MapSet}}`, update `add_waiting/2` and `move_out_happened/3`
- `move_handling.ex` — extract position from control message patterns, pass to `move_out_happened`
- `storage.ex` — update `condition_hashes_to_skip` type in behaviour spec
- `pure_file_storage.ex` — rename binary tag read/write to `condition_hashes`, decode into map on read, replace `all_parents_moved_out?` with `should_skip_for_moved_out?`, bump `@version`
- `in_memory_storage.ex` — same filtering change
- `storage_implementations_test.exs` — test position-aware filtering

### Phase 13: Remove Shape Invalidation

**Modify** `lib/electric/shapes/consumer.ex`

This phase removes the entire `should_invalidate?` block, which currently guards on four conditions:

1. `not tagged_subqueries_enabled?` — retained as the feature flag check
2. `state.or_with_subquery?` — removed; DNF decomposition handles OR correctly
3. `state.not_with_subquery?` — removed; negation is handled via polarity in the DNF
4. `length(state.shape.shape_dependencies) > 1` — **also removed**; this was the guard
   preventing *any* multi-subquery shape from working, even pure AND. With position-based
   tagging and `DnfContext`, we can correctly attribute move-ins/move-outs to the specific
   dependency that caused them via `dep_handle`, so this blanket restriction is no longer needed.

```elixir
def handle_info({:materializer_changes, dep_handle, %{move_in: move_in, move_out: move_out}}, state) do
  feature_flags = Electric.StackConfig.lookup(state.stack_id, :feature_flags, [])
  tagged_subqueries_enabled? = "tagged_subqueries" in feature_flags

  if not tagged_subqueries_enabled? do
    stop_and_clean(state)
  else
    {state, notification} =
      state
      |> MoveHandling.process_move_ins(dep_handle, move_in)
      |> MoveHandling.process_move_outs(dep_handle, move_out)

    notify_new_changes(state, notification)

    {:noreply, state}
  end
end
```

### Phase 14: Elixir Client Updates

The Elixir client (`packages/elixir-client`) is our example client implementation and is used
in the integration tests. It must handle the new wire format (slash-delimited tags,
`active_conditions`, position-based move-in/move-out) correctly.

**Modify** `packages/elixir-client/lib/electric/client/tag_tracker.ex`

1. **Slash-delimited tag normalization**: Tags arrive as slash-delimited strings
   (e.g., `"hash1/hash2/"`, `"//hash3"`). Normalize to 2D arrays internally:
   `["hash1/hash2/", "//hash3"]` -> `[["hash1", "hash2", ""], ["", "", "hash3"]]` -> replace `""` with `nil`

2. **`removed_tags` normalization**: `removed_tags` arrive in the **same slash-delimited
   format** as `tags`. They must be normalized through the same split pipeline before
   comparison against internal position hashes. Without this, `filter_removed_tags` compares
   bare hashes against raw slash-delimited strings — never matches.

3. **DNF-based visibility evaluation**: `row_visible?/2` evaluates OR over disjuncts, where
   each disjunct is AND over non-null `active_conditions` positions.

4. **Position-based `tag_to_keys` index**: Index by `{position, hash_value}` tuples for
   efficient move-in/move-out lookups.

5. **Move-out synthetic deletes**: `generate_synthetic_deletes/4` deactivates positions
   matching `{pos, value}` patterns and generates deletes only when no disjunct evaluates
   to true.

6. **Move-in activation**: `handle_move_in/4` activates positions for matching keys.

```elixir
# Key normalization — removed_tags must use the same pipeline as tags
removed_tags_set =
  removed_tags
  |> normalize_tags()
  |> Enum.flat_map(fn disjunct -> Enum.reject(disjunct, &is_nil/1) end)
  |> MapSet.new()
```

**Modify** `packages/elixir-client/lib/electric/client/message/headers.ex`

- Add `active_conditions` field to `Headers` struct
- Parse `active_conditions` from incoming messages in `from_message/2`

**Tests**: `packages/elixir-client/test/electric/client/tag_tracker_test.exs`

```elixir
describe "tag_tracker with DNF wire format" do
  test "normalizes slash-delimited tags to 2D structure"
  test "removed_tags in slash-delimited format are correctly filtered"
  test "row_visible? evaluates DNF correctly"
  test "generate_synthetic_deletes only deletes when all disjuncts unsatisfied"
  test "handle_move_in activates correct positions"
  test "position-based tag_to_keys index for multi-disjunct shapes"
end
```

---

## Test Strategy

### Unit Tests

#### 1. DNF Decomposer Tests (`test/electric/replication/eval/decomposer_test.exs`)

```elixir
describe "decompose/1" do
  test "simple AND - single conjunction" do
    # WHERE x IN subquery AND y = 1
    # Expected: [[{0, :positive}, {1, :positive}]]
  end

  test "simple OR - multiple disjuncts" do
    # WHERE x IN subquery1 OR y IN subquery2
    # Expected: [[{0, :positive}], [{1, :positive}]]
  end

  test "NOT with subquery" do
    # WHERE x NOT IN subquery
    # Expected: [[{0, :negated}]]
  end

  test "De Morgan's law - NOT (A AND B)" do
    # WHERE NOT (x IN sq1 AND y IN sq2)
    # Expected: [[{0, :negated}], [{1, :negated}]]
  end

  test "De Morgan's law - NOT (A OR B)" do
    # WHERE NOT (x IN sq1 OR y IN sq2)
    # Expected: [[{0, :negated}, {1, :negated}]]
  end

  test "complex mixed expression" do
    # WHERE (x IN sq1 AND status='active') OR y IN sq2
    # Expected: [[{0, :positive}, {1, :positive}], [{2, :positive}]]
  end

  test "nested NOT - double negation" do
    # WHERE NOT NOT (x IN subquery)
    # Expected: [[{0, :positive}]]
  end

  test "complexity guard rejects excessive disjuncts" do
    # Build expression that would exceed @max_disjuncts
    # Expected: {:error, :too_complex}
  end
end
```

#### 2. Active Conditions Tests (`test/electric/shapes/where_clause_test.exs`)

```elixir
describe "compute_active_conditions/3" do
  test "all conditions true" do
    # Given: x='a', sq1 contains 'a', status='active'
    # Expected: [true, true]
  end

  test "mixed true/false conditions" do
    # Given: x='a', sq1 contains 'a', sq2 does NOT contain 'b'
    # Expected: [true, false]
  end

  test "negated position inverts result" do
    # Given: x='a', sq1 contains 'a' (negated position)
    # Expected: active_conditions[0] = false (because NOT IN fails)
  end
end

describe "evaluate_dnf/2" do
  test "OR - any disjunct true means included" do
    # active_conditions: [true, false]
    # disjuncts_positions: [[0], [1]]
    # Expected: true (first disjunct satisfied)
  end

  test "AND - all positions in conjunction must be true" do
    # active_conditions: [true, false]
    # disjuncts_positions: [[0, 1]]
    # Expected: false (second position fails)
  end
end
```

### Integration Tests (`test/electric/plug/subquery_router_test.exs`)

#### 3. Basic OR with Subqueries

```elixir
describe "OR with subqueries" do
  setup [:with_unique_db, :with_subquery_tables, :with_sql_execute]
  setup :with_complete_stack

  @tag with_sql: [
    "INSERT INTO projects (id, active) VALUES ('p1', true)",
    "INSERT INTO users (id, admin) VALUES ('u1', true)",
    "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t1', 'p1', null)",
    "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t2', null, 'u1')",
    "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t3', 'p2', 'u2')"
  ]
  test "initial snapshot includes rows matching either condition", ctx do
    # WHERE project_id IN (active projects) OR assigned_to IN (admin users)
    # t1 matches first condition, t2 matches second, t3 matches neither
  end

  test "tags have correct structure for multiple disjuncts", ctx do
    # Verify tags: ["hash(project_id)/", "/hash(assigned_to)"]
  end

  test "active_conditions array included in response", ctx do
    # Verify headers include active_conditions: [true, false] etc.
  end
end
```

#### 4. NOT with Subqueries

```elixir
describe "NOT with subqueries" do
  @tag with_sql: [
    "INSERT INTO archived_projects (id) VALUES ('p1')",
    "INSERT INTO tasks (id, project_id) VALUES ('t1', 'p1')",
    "INSERT INTO tasks (id, project_id) VALUES ('t2', 'p2')"
  ]
  test "NOT IN excludes rows when value in subquery", ctx do
    # WHERE project_id NOT IN (SELECT id FROM archived_projects)
    # t1 excluded (p1 is archived), t2 included
  end

  test "move-in to NOT IN subquery triggers move-out", ctx do
    # Insert 'p2' into archived_projects
    # t2 should receive synthetic delete
  end

  test "move-out from NOT IN subquery triggers move-in", ctx do
    # Delete 'p1' from archived_projects
    # t1 should be queried and sent to client
  end
end
```

#### 5. Move-in Without Query (Row Already Present)

```elixir
describe "move-in without Postgres query" do
  @tag with_sql: [
    "INSERT INTO projects (id, active) VALUES ('p1', false)",
    "INSERT INTO users (id, admin) VALUES ('u1', true)",
    "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t1', 'p1', 'u1')"
  ]
  test "no query when row already in shape for another disjunct", ctx do
    # t1 is in shape because assigned_to IN (admin users)
    # Activate p1's project -> move-in for first disjunct
    # Should broadcast only, not query Postgres for t1
  end

  test "active_conditions updates without new insert message", ctx do
    # Verify client receives move-in broadcast
    # t1's active_conditions changes from [false, true] to [true, true]
    # No duplicate insert for t1
  end
end
```

#### 6. Move-out with Row Still In Shape

```elixir
describe "move-out with row still in shape" do
  @tag with_sql: [
    "INSERT INTO projects (id, active) VALUES ('p1', true)",
    "INSERT INTO users (id, admin) VALUES ('u1', true)",
    "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t1', 'p1', 'u1')"
  ]
  test "row stays when one disjunct deactivates but another satisfied", ctx do
    # t1 matches both disjuncts
    # Deactivate p1's project -> first disjunct false
    # Row stays because second disjunct (admin user) still true
  end

  test "row removed only when all disjuncts false", ctx do
    # Deactivate p1's project AND remove u1 from admins
    # Now t1 matches neither disjunct -> synthetic delete
  end
end
```

#### 7. Complex Expressions

```elixir
describe "complex boolean expressions" do
  test "nested AND within OR" do
    # WHERE (project_id IN sq1 AND status = 'active') OR assigned_to IN sq2
  end

  test "OR of two subqueries on same column" do
    # WHERE parent_id IN (SELECT id FROM parent WHERE category = 'a')
    #    OR parent_id IN (SELECT id FROM parent WHERE category = 'b')
    # Both subqueries reference parent_id — sublink index resolution must
    # use AST extraction (not column-name matching) to distinguish them.
    # Row with parent_id=1 (category='a'): active_conditions = [true, false]
    # Row with parent_id=2 (category='b'): active_conditions = [false, true]
    # Tags must also be distinct per disjunct (different slash positions).
  end

  test "De Morgan: NOT (A AND B)" do
    # WHERE NOT (project_id IN sq1 AND status = 'active')
    # Equivalent to: project_id NOT IN sq1 OR status != 'active'
  end

  test "De Morgan: NOT (A OR B)" do
    # WHERE NOT (project_id IN sq1 OR assigned_to IN sq2)
    # Equivalent to: project_id NOT IN sq1 AND assigned_to NOT IN sq2
  end

  test "mixed positive and negated at same position" do
    # WHERE x IN sq1 OR x NOT IN sq1
    # Always true, but tests position handling
  end
end
```

#### 8. Protocol Versioning

```elixir
describe "protocol versioning" do
  test "v1 clients rejected for complex WHERE with OR subqueries", ctx do
    # Request with protocol v1 header
    # WHERE with OR and subqueries
    # Should return 400 error
  end

  test "v2 clients accepted for complex WHERE", ctx do
    # Same request with protocol v2
    # Should succeed
  end

  test "simple single-subquery works with v1", ctx do
    # Backward compatibility for existing shapes
  end
end
```

#### 9. Edge Cases

```elixir
describe "edge cases" do
  test "NULL values in subquery columns" do
    # Row with NULL project_id
    # NULL IN (...) is always NULL/false
  end

  test "empty subquery results" do
    # Subquery returns no rows
    # IN empty = false, NOT IN empty = true
  end

  test "concurrent move-ins at different positions" do
    # Two dependency shapes change simultaneously
  end

  test "shape restart preserves position mapping" do
    # Verify deterministic position assignment
  end
end
```

---

## Order of Operations

```
Phase 1: DNF Decomposer
    |
    +---> Phase 2: SQL Generator (no dependencies beyond Parser AST types)
    |
    v
Phase 3: DnfContext (depends on Phase 1)
    |
    v
Phase 4: Shape tag_structure + fill_move_tags (depends on Phase 1, NO new Shape fields)
    |
    +---> Phase 5: Consumer State — holds DnfContext (depends on Phase 3)
    |         |
    |         +---> Phase 6: Active Conditions (depends on Phases 3, 5)
    |         |         |
    |         |         +---> Phase 9: Change Handling (depends on Phase 6, uses DnfContext)
    |         |
    |         +---> Phase 11: Move Handling (depends on Phases 5, 7, uses DnfContext)
    |                   |
    |                   +---> Phase 12: Position-aware moved_out_tags
    |                   |     ^^^ REQUIRED for correctness — without this, moved_out_tags
    |                   |         filtering is silently broken for multi-disjunct shapes
    |                   |
    |                   +---> Phase 13: Remove Invalidation (depends on Phase 11)
    |
    +---> Phase 7: Move Messages + Exclusion Clauses (depends on Phase 3)
    |
    +---> Phase 8: Log Items (depends on Phase 4 for tag format)
    |
    +---> Phase 10: Querying (depends on Phases 2, 3, 7)

Phase 14: Elixir Client (depends on Phases 7, 8 for wire format definition)
```

**Implementation order** (phases are numbered to match):

| Step | Phase | Name | Key dependency |
|------|-------|------|----------------|
| 1 | Phase 1 | DNF Decomposer | foundational, no dependencies |
| 2 | Phase 2 | SQL Generator | standalone, depends only on Parser AST types |
| 3 | Phase 3 | DnfContext | wraps decomposer output |
| 4 | Phase 4 | Shape tag_structure + fill_move_tags | uses decomposer, **no new Shape struct fields** |
| 5 | Phase 5 | Consumer State | holds DnfContext, built at init |
| 6 | Phase 6 | Active Conditions | uses DnfContext |
| 7 | Phase 7 | Move Messages + Exclusion Clauses | uses DnfContext for exclusion |
| 8 | Phase 8 | Log Items | 2D-to-wire tag conversion |
| 9 | Phase 9 | Change Handling | uses DnfContext, replaces `includes_record?` |
| 10 | Phase 10 | Querying | uses DnfContext + SqlGenerator |
| 11 | Phase 11 | Move Handling | uses DnfContext for position routing |
| 12 | Phase 12 | Position-aware moved_out_tags | **MUST follow Phase 11 immediately** |
| 13 | Phase 13 | Remove Invalidation | final cleanup |
| 14 | Phase 14 | Elixir Client | must handle new wire format; used by integration tests |

---

## Gaps and Risks

### Technical Risks

1. **DNF Explosion**: Complex WHERE clauses can produce exponentially many disjuncts
   - Mitigation: Complexity guard in `Decomposer.decompose/1` — reject shapes where `length(disjuncts) > 100` with a descriptive error at shape creation time (400 response)
   - Document reasonable limits (~10 subqueries)

2. **Position Stability**: If positions change between shape restarts, clients will have stale `active_conditions`
   - Mitigation: Position assignment must be deterministic (sort by AST traversal order)

3. **Concurrent Move-ins**: Multiple positions activating simultaneously
   - Mitigation: Use existing snapshot-based ordering mechanism
   - Test: Add integration tests for concurrent scenarios

4. **NOT IN Edge Cases**: `NULL` handling in NOT IN is tricky in SQL
   - Mitigation: Follow PostgreSQL semantics exactly
   - Test: Include NULL value tests

5. **Avoid re-decomposition within consumer lifetime**: `Decomposer.decompose/1` is called at two lifecycle points (shape creation + consumer startup — see "Single Decomposition, Two Lifecycle Points" above). Within the consumer's lifetime, always use `DnfContext`'s cached decomposition. Do not re-decompose in `querying.ex`, `subquery_moves.ex`, `move_handling.ex`, etc. — accept the decomposition from DnfContext instead.

6. **Single-pass active_conditions**: Per the RFC, `compute_active_conditions` should *replace* the `includes_record?` call — not run alongside it. Avoid double evaluation in the replication stream path.

7. **Non-subquery conditions require real SQL generation (Phase 2)**: For OR shapes, a row can be in the snapshot result via one disjunct while another disjunct's non-subquery condition is false. The `active_conditions` SELECT column for that position must evaluate to `false`, not `true`. Returning a hardcoded `"true"` for non-subquery conditions is **wrong** — it makes the client think both disjuncts are satisfied when only one is. `SqlGenerator.to_sql/1` (Phase 2) converts the AST back to SQL for these positions. It raises `ArgumentError` for unsupported AST nodes so missing operators are caught at shape creation time, not at query time.

8. **condition_hashes vs wire tags (Phase 12)**: The binary move-in snapshot files must store condition_hashes (per-position hashes) separately from the JSON that contains wire-format tags. If filtering uses the wire-format tags instead, bare hashes are compared against slash-delimited strings and never match — a silent correctness bug. See Phase 12 for the full solution.

9. **Sublink index resolution by column name is ambiguous**: When generating SQL for subquery conditions, the sublink index MUST be extracted from the AST node's `sublink_membership_check` function, NOT resolved by matching column names. See "Sublink Index Resolution" above for the authoritative explanation and `extract_sublink_index/1` implementation. This applies to both `querying.ex` (Phase 10) and `subquery_moves.ex` (Phase 7).
   - Test: "OR of two subqueries on same column" (see Test Strategy, Complex Expressions)

10. **Decomposition failure at shape creation**: If `Decomposer.decompose/1` returns `{:error, reason}`, shape creation must fail with a 400 response and descriptive error message. There is no silent fallback to invalidation — users should know their WHERE clause is unsupported.

### Protocol Compatibility

1. **V1 Clients**: Must reject complex WHERE clauses for v1 protocol
   - Implementation: Protocol version check in shape validation (Phase 3)
   - Return 400 error with descriptive message

2. **Message Format**: New `active_conditions` field is additive
   - V1 clients will ignore unknown fields (safe)
   - V2 clients must handle missing `active_conditions` (for simple shapes)

### Performance Considerations

1. **Active Conditions Computation**: Done per-row in replication stream
   - Profile: Measure overhead vs current `includes_record?`
   - Optimize: Cache subquery results per transaction

2. **Tag Storage**: Multiple disjuncts = larger tags array
   - Profile: Measure storage overhead
   - Consider: Sparse representation if many positions

3. **Move-in Queries**: "Not in other disjuncts" clause may be expensive
   - Profile: EXPLAIN ANALYZE on typical queries
   - Optimize: Index recommendations for common patterns

---

## Critical Files for Implementation

- `lib/electric/replication/eval/decomposer.ex` - **(new)** DNF decomposition of WHERE clause ASTs
- `lib/electric/replication/eval/sql_generator.ex` - **(new)** Converts AST back to SQL — used by `querying.ex` for non-subquery `active_conditions` and by `subquery_moves.ex` for exclusion clauses
- `lib/electric/shapes/consumer/dnf_context.ex` - **(new)** DNF state container, built from Shape at consumer startup
- `lib/electric/shapes/shape/subquery_moves.ex` - Core tag and move message generation, **move-in WHERE clause + DNF-aware exclusion clauses**
- `lib/electric/shapes/shape.ex` - `fill_move_tags` (2D array output), `tag_structure` — **no new struct fields**
- `lib/electric/shapes/consumer/move_handling.ex` - Move-in/out orchestration (position routing, negation inversion), delegates SQL generation to `subquery_moves.ex`
- `lib/electric/shapes/where_clause.ex` - Record filtering and `active_conditions`
- `lib/electric/log_items.ex` - Message format with `active_conditions`, 2D-to-wire tag conversion
- `lib/electric/shapes/querying.ex` - SQL generation for snapshots and move-in queries. Move-in queries SELECT condition_hashes (separate column) + wire tags (in JSON). Accepts DnfContext, delegates non-subquery AST-to-SQL to `SqlGenerator`
- `packages/elixir-client/lib/electric/client/tag_tracker.ex` - Client-side tag tracking, DNF evaluation, synthetic deletes
- `packages/elixir-client/lib/electric/client/message/headers.ex` - Client message header parsing

## Additional Test Coverage

### Snapshot Positioning Tests

```elixir
describe "snapshot positioning for move-in queries" do
  test "move-in query runs in REPEATABLE READ isolation" do
    # Verify transaction isolation level
  end

  test "pg_current_snapshot captured and used for filtering" do
    # Insert row, start move-in query, insert another row during query
    # Second row should not appear in move-in results (filtered by snapshot)
  end

  test "touch tracking prevents duplicate rows" do
    # Row modified in stream after move-in query started
    # Move-in query returns that row
    # Stream change should be used, query result skipped
  end

  test "move-in results positioned correctly relative to stream" do
    # Move-in query completes while stream has concurrent changes
    # Results should appear at correct log offset
  end
end
```

### Resume and `changes_only` Mode Tests

```elixir
describe "resume with active_conditions" do
  test "resumed stream includes active_conditions on changes" do
    # Get initial data, disconnect, reconnect with resume
    # Verify subsequent changes include active_conditions
  end

  test "move-out during disconnect generates synthetic delete on resume" do
    # Disconnect, deactivate a disjunct, reconnect
    # Should receive synthetic delete
  end
end

describe "changes_only mode with DNF" do
  test "inserts include tags and active_conditions" do
    # Start with changes_only, insert row
    # Verify headers include both
  end

  test "updates include tags, removed_tags, and active_conditions" do
    # changes_only mode, update that changes tag-relevant column
    # Verify all three headers present
  end

  test "move-in broadcasts for unknown rows are handled gracefully" do
    # changes_only client receives move-in for row not in local state
    # Client checks tracked keys map — key not present, broadcast ignored
    # Should ignore without error
  end
end
```

### `removed_tags` Tests

```elixir
describe "removed_tags on updates" do
  test "update changing tag-relevant column includes removed_tags" do
    # Row with project_id='p1', update to project_id='p2'
    # Should include removed_tags with hash(p1)
  end

  test "update not changing tag-relevant column has empty removed_tags" do
    # Row with project_id='p1', update value column
    # removed_tags should be empty or absent
  end

  test "update changing multiple tag-relevant columns" do
    # Row with project_id='p1', assigned_to='u1'
    # Update both columns
    # removed_tags should include both old hashes
  end
end
```

### Additional Edge Cases

```elixir
describe "additional edge cases" do
  test "same subquery referenced at multiple positions" do
    # WHERE x IN sq1 OR y IN sq1
    # Single dependency affects two positions
    # Move-in should handle both positions
  end

  test "DNF complexity guard" do
    # Extremely complex WHERE clause
    # Should return error before explosion
  end

  test "double negation simplification" do
    # WHERE NOT NOT (x IN sq)
    # Should simplify to positive position
  end

  test "tautology detection" do
    # WHERE x IN sq OR x NOT IN sq
    # Should recognize as always-true (optional optimization)
  end
end
```

---

## Migration Checklist

Before enabling complex subquery shapes in production:

1. [ ] All clients updated to handle nested tag format
2. [ ] All clients updated to handle `active_conditions` field
3. [ ] All clients updated to handle position-based move-in/move-out messages
4. [ ] Protocol version negotiation implemented and tested
5. [ ] Existing shapes will continue working (backward compatibility verified)
6. [ ] Performance profiling completed for:
   - [ ] `compute_active_conditions` overhead
   - [ ] Multi-disjunct tag storage size
   - [ ] Move-in exclusion query performance
7. [ ] Shape handle invalidation strategy decided (if needed)
