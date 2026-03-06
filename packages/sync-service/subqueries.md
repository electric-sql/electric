# How Subqueries Work

## Overview

Subqueries allow shape WHERE clauses to reference rows from other tables. Currently, only
`value IN (SELECT ...)` is supported. Each subquery becomes a **shape dependency** -- a
separate Shape that is tracked independently and whose result set feeds into the parent
shape's WHERE evaluation.

```sql
-- Single-column subquery
WHERE project_id IN (SELECT id FROM projects WHERE active = true)

-- Composite-key subquery
WHERE (org_id, team_id) IN (SELECT org_id, team_id FROM memberships WHERE user_id = '1')

-- Nested subqueries (each level becomes its own dependency)
WHERE project_id IN (
  SELECT id FROM projects WHERE team_id IN (
    SELECT id FROM teams WHERE org_id = '42'
  )
)
```

Requires the `allow_subqueries` feature flag. Not allowed in subset WHERE clauses.

## Parsing

Entry point: `Shape.validate_where_clause/3` in `lib/electric/shapes/shape.ex`.

```
1. Parser.parse_query(where)        -- PgQuery parses SQL into AST
2. Parser.extract_subqueries(where) -- Walker finds all PgQuery.SubLink nodes,
                                       returns their inner SELECT statements
3. build_shape_dependencies(...)    -- Each subquery SELECT becomes a full Shape
                                       (recursively, so nested subqueries work)
4. build_dependency_refs(...)       -- Builds type refs like
                                       ["$sublink", "0"] => {:array, :int8}
5. Parser.validate_where_ast(...)   -- Validates and compiles the WHERE expression,
                                       with sublink_queries map for query reconstruction
```

### AST representation

`Parser.node_to_ast/4` (`parser.ex:775-821`) matches `PgQuery.SubLink` nodes and converts
them to a `Func` AST node:

```elixir
%Func{
  name: "sublink_membership_check",
  implementation: &PgInterop.Sublink.member?/2,
  type: :bool,
  args: [
    testexpr,                                    # Ref or RowExpr of Refs
    %Ref{path: ["$sublink", "0"], type: {:array, :int8}}  # placeholder for results
  ]
}
```

### Validation rules

- **SubLink type**: Only `:ANY_SUBLINK` (i.e. `IN (SELECT ...)`)
- **Operator**: Must be empty (plain `IN`, no `= ANY` etc.)
- **Left side**: Must be a column ref or a row of column refs -- no expressions
- **Type match**: Left-side type must match the subquery return type
- **Inner SELECT**: Must be a simple `SELECT cols FROM table [WHERE ...]` -- no DISTINCT,
  GROUP BY, HAVING, WINDOW, ORDER BY, LIMIT, WITH, or locking clauses

Anything else gets an error like `"only 'value IN (SELECT ...)' sublinks are supported right now"`.

## Shape struct fields

```elixir
defstruct [
  ...
  shape_dependencies: [],                # [Shape.t()] -- one per subquery
  shape_dependencies_handles: [],        # [String.t()] -- shape handles for each dep
  tag_structure: [],                     # for generating row tags (move-out tracking)
  subquery_comparison_expressions: %{},  # sublink path => Expr for comparing values
]
```

`shape_dependencies_handles` is populated later (not at parse time) when the dependency
shapes are registered with the shape cache.

## Runtime evaluation

### Record filtering (WhereClause)

`WhereClause.includes_record?/3` (`lib/electric/shapes/where_clause.ex`) evaluates whether
a row matches the shape's WHERE clause:

```elixir
def includes_record?(where_clause, record, extra_refs) do
  with {:ok, refs} <- Runner.record_to_ref_values(where_clause.used_refs, record),
       {:ok, evaluated} <- Runner.execute(where_clause, Map.merge(refs, extra_refs))
```

The `extra_refs` map provides subquery results:
- `%{["$sublink", "0"] => [value1, value2, ...]}` for single-column
- `%{["$sublink", "0"] => [{v1, v2}, ...]}` for composite keys

The `sublink_membership_check` function (`PgInterop.Sublink.member?/2`) does a simple
`Enum.member?/2` or `MapSet.member?/2` against the provided list/set.

## Dependency layers

`DependencyLayers` (`lib/electric/shapes/dependency_layers.ex`) ensures shapes are
processed in correct dependency order. Shapes are organized into layers:

- Layer 0: shapes with no dependencies
- Layer N: shapes whose dependencies are all in layers < N

When changes arrive, `ShapeLogCollector` publishes events layer-by-layer
(`shape_log_collector.ex:551`), so parent shapes always see updates before their dependents.

## Move-in / move-out

When the result set of a dependency shape changes, rows may need to enter or leave the
parent shape. This is handled by `Consumer.MoveHandling` and `Shape.SubqueryMoves`.

### Move-in

When new values appear in a dependency (`move_handling.ex:16-68`):

1. `SubqueryMoves.move_in_where_clause/3` transforms the original WHERE clause by replacing
   the subquery with the new values:
   - Single column: `IN (SELECT id FROM ...)` becomes `= ANY ($1::text[]::int8[])`
   - Composite key: becomes `IN (SELECT * FROM unnest($1::text[]::type1[], $2::text[]::type2[]))`
2. An async query runs against Postgres with this modified WHERE
3. Results are written as a "move-in snapshot" to storage
4. The snapshot is spliced into the main log, filtered against already-seen keys

### Move-out

When values disappear from a dependency (`move_handling.ex:74-96`):

1. `SubqueryMoves.make_move_out_control_message/4` generates a control message with
   `event: "move-out"` and a list of tag patterns
2. Each pattern contains a hash: `md5(stack_id <> shape_handle <> namespaced_value)`
3. The control message is appended to the shape log for clients to process

### Tags

Tags track *why* a row is in a shape (which dependency value matched). They are computed
both in Postgres (via `make_tags` in `querying.ex:153`) and in Elixir
(`SubqueryMoves.make_value_hash/3`), using the same hashing scheme:

- Values are namespaced: `"v:" <> value` for non-null, `"NULL"` for null
- Composite keys concatenate `column_name:namespaced_value` parts
- The hash is `md5(stack_id <> shape_handle <> namespaced_parts)` encoded as lowercase hex

The `tag_structure` field on Shape describes the column layout for tag generation, built by
`SubqueryMoves.move_in_tag_structure/1` which walks the WHERE AST looking for
`sublink_membership_check` nodes.

## Not supported

- `EXISTS (SELECT ...)`
- `NOT IN (SELECT ...)`
- Scalar subqueries
- `ANY`/`ALL` with comparison operators
- Subqueries in SELECT list or FROM clause
- Expressions on the left side of `IN` (only plain column refs)
- Subqueries in subset WHERE clauses
- Multiple independent subqueries have partial support (tag structure TODOs note DNF form
  is needed, and move-out has a stub guard for single dependencies)
