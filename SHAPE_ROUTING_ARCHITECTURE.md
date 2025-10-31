# Electric Shape Routing and WAL Processing Architecture

## Overview

Electric's shape routing system is designed to efficiently route WAL (Write-Ahead Log) operations to multiple shape subscriptions. The system uses a hierarchical filtering approach with indexed predicate evaluation to determine which shapes are affected by each WAL operation, then appends the filtered changes to the appropriate shape logs.

## Key Architectural Components

### 1. Shape Definition and Storage

**Module**: `Electric.Shapes.Shape` (`/lib/electric/shapes/shape.ex`)

Shape definitions are immutable structs that define what data a client should receive:
- **Root Table**: The primary table the shape selects from (`root_table`, `root_table_id`)
- **Where Clause**: Predicate for filtering rows (parsed SQL expressions)
- **Selected Columns**: Specific columns to include
- **Predicates**: Parsed and validated SQL WHERE clauses using `Electric.Replication.Eval.Expr`
- **Shape Dependencies**: Other shapes referenced in subqueries (for complex shapes)
- **Storage Config**: Per-shape storage settings (compaction enabled/disabled)
- **Replica Mode**: How the shape stores data (`:full` or `:default`)
- **Log Mode**: `:changes_only` or `:full` logging

Key function: `convert_change(shape, change, extra_refs)` - Determines if a change belongs to a shape and filters columns accordingly. Returns empty list if change doesn't match, or filtered change if it does.

### 2. Main Replication Orchestrator

**Module**: `Electric.Replication.ShapeLogCollector` (`/lib/electric/replication/shape_log_collector.ex`)

This is the central coordinator that receives transactions from PostgreSQL and routes them to affected shapes.

**Key responsibilities**:
- Subscribes to shapes and maintains active shape filters
- Receives WAL transactions via `store_transaction/2`
- Uses Filter to identify affected shapes: `affected_shapes = Filter.affected_shapes(state.filter, event)`
- Publishes events to shape consumers via `ConsumerRegistry`
- Maintains dependency layers for ordering event propagation
- Tracks LSN progress and flushed boundaries

**Flow**:
```
Transaction in → fill_keys_in_txn → Filter.affected_shapes → 
Partitions.handle_event → DependencyLayers.get_for_handles → 
ConsumerRegistry.publish → Shape Consumers
```

### 3. Efficient Change Routing with Indexes

**Module**: `Electric.Shapes.Filter` (`/lib/electric/shapes/filter.ex`)

Main entry point for determining which shapes are affected by a change.

**Structure**:
- `tables` map: Groups shapes by root table
- Each table has a `WhereCondition` that contains optimized indexes
- `shapes` map: Cache of shape definitions

**Key function**: `affected_shapes(filter, change) -> MapSet.t(shape_id)`

**Flow for each change**:
1. Extract table name from change
2. Look up WhereCondition for that table
3. Delegate to `WhereCondition.affected_shapes`

### 4. Predicate Optimization and Indexing

**Module**: `Electric.Shapes.Filter.WhereCondition` (`/lib/electric/shapes/filter/where_condition.ex`)

Intelligently optimizes shape predicates by creating indexes for patterns that can be efficiently looked up.

**Optimizable Patterns**:
- `field = const` → EqualityIndex
- `array_field @> const_array` → InclusionIndex (JSONB/array containment)
- Combinations with `AND`: `field = const AND other_condition`

**Non-optimized shapes** are kept in `other_shapes` map and evaluated fully for each change.

**Tree Structure**:
```
WhereCondition
├── indexes: {field, operation} -> Index
│   ├── EqualityIndex
│   │   └── values: const_value -> WhereCondition (recursive for AND conditions)
│   └── InclusionIndex
│       └── value_tree: sorted tree of array values
└── other_shapes: shape_id -> WhereClause (non-optimized)
```

### 5. Index Implementations

#### EqualityIndex (`Electric.Shapes.Filter.Indexes.EqualityIndex`)

For `field = const` patterns:
- Maps constant values to WhereConditions
- `affected_shapes(index, field, record, shapes)`:
  1. Extract field value from record
  2. Look up in values map (O(1))
  3. Return shapes at that value node

#### InclusionIndex (`Electric.Shapes.Filter.Indexes.InclusionIndex`)

For `array_field @> const_array` patterns (JSONB/array containment):
- Binary tree structure where nodes are array values
- `affected_shapes(index, field, record, shapes)`:
  1. Extract array from record, sort and deduplicate
  2. Traverse tree: if record's array contains index's array values as subset, shapes on the path are affected
  3. Optimization: Keep sorted list of keys to binary search only min(keys, values)

### 6. Where Clause Predicate Evaluation

**Module**: `Electric.Shapes.WhereClause` (`/lib/electric/shapes/where_clause.ex`)

Evaluates non-optimized predicates against records using the expression evaluator.

**Function**: `includes_record?(where_clause, record, extra_refs)`
1. Extract reference values from record
2. Execute parsed expression against record data
3. Return boolean result

Uses `Electric.Replication.Eval.Runner` for SQL expression evaluation.

### 7. Partition Handling

**Module**: `Electric.Shapes.Partitions` (`/lib/electric/shapes/partitions.ex`)

Manages PostgreSQL table partitions - expands partition changes to parent table changes.

**Key responsibilities**:
- Track parent → children partition relationships
- When a partition receives a change, emit equivalent change on parent
- Ensures shapes on partitioned tables receive changes from all partitions

### 8. Dependency Management

**Module**: `Electric.Shapes.DependencyLayers` (`/lib/electric/shapes/dependency_layers.ex`)

Organizes shapes into dependency layers to ensure correct publication order.

**Structure**: List of MapSets representing topological layers
- Layer 0: Shapes with no dependencies
- Layer N: Shapes whose dependencies are all in layers 0..N-1

**Key function**: `get_for_handles(layers, shape_handles)` returns which layers are affected.

### 9. Shape Consumer and Change Application

**Module**: `Electric.Shapes.Consumer` (`/lib/electric/shapes/consumer.ex`)

Per-shape process that applies changes to a shape's log.

**Key flow** (`handle_event -> do_handle_txn`):
1. Receive transaction from ShapeLogCollector
2. Check if xid should be filtered based on PG snapshot
3. Call `filter_changes(changes, shape, extra_refs)` which:
   - Iterates through changes
   - Calls `Shape.convert_change` for each
   - Accumulates relevant changes
4. Convert to log entries: `prepare_log_entries(changes, xid, shape)`
5. **Append to shape log**: `ShapeCache.Storage.append_to_log!(lines, writer)`

**Line 494** is where filtered WAL operations are persisted to shape logs.

### 10. Shape Log Storage

**Module**: `Electric.ShapeCache.Storage` (`/lib/electric/shape_cache/storage.ex`)

Abstraction over shape log persistence (file-based or in-memory).

**Key operations**:
- `append_to_log!(lines, writer)` - Append filtered changes
- `get_log_stream(offset, max_offset, storage)` - Retrieve changes for client
- `get_current_position(storage)` - Get latest offset
- Handles chunking, compaction, and log rotation

### 11. Materializer for Dependency Values

**Module**: `Electric.Shapes.Consumer.Materializer` (`/lib/electric/shapes/consumer/materializer.ex`)

Maintains materialized values for shape dependencies used in WHERE clause evaluation.

**Function**: `get_all_as_refs(shape, stack_id)`
- Returns map of sublink values for shapes referenced in WHERE clauses
- Used as `extra_refs` during `Shape.convert_change`

### 12. Consumer Registry

**Module**: `Electric.Shapes.ConsumerRegistry` (`/lib/electric/shapes/consumer_registry.ex`)

Routes events to shape consumers organized by dependency layers.

**Key function**: `publish(layer, {:handle_event, event, context}, state)`
- Sends event to all shape consumers in a dependency layer synchronously

## Data Flow: WAL Operation to Shape Logs

### Complete Journey of a Single Change

```
PostgreSQL Transaction
        ↓
Replication Stream → ShapeLogCollector.store_transaction(txn)
        ↓
fill_keys_in_txn (Add primary keys)
        ↓
publish(txn)
        ↓
Filter.affected_shapes(filter, txn)
    ├─ For each change in txn:
    │  ├─ Partitions.handle_event (expand partition changes)
    │  ├─ Filter.shapes_affected_by_change
    │  │  ├─ Extract table from change
    │  │  ├─ WhereCondition.affected_shapes
    │  │  │  ├─ Check indexed_shapes (EqualityIndex/InclusionIndex)
    │  │  │  └─ Check other_shapes (full evaluation)
    │  │  └─ Return MapSet of affected shape_ids
    │  └─ Union into total affected_shapes
    └─ Return MapSet[shape_id, ...]
        ↓
DependencyLayers.get_for_handles(affected_shapes)
        ↓
ConsumerRegistry.publish(layer, {:handle_event, event})
        ↓
Shapes.Consumer.handle_event(txn)
    ├─ Filter transaction using PG snapshot (xmin/xmax/xip_list)
    ├─ For each change:
    │  ├─ Shape.convert_change(shape, change, extra_refs)
    │  │  ├─ Check if table matches
    │  │  ├─ Check WHERE clause using WhereClause.includes_record?
    │  │  ├─ For updates: check old and new record separately
    │  │  └─ Convert to new/updated/deleted as appropriate
    │  └─ Accumulate matching changes
    ├─ prepare_log_entries(matching_changes, xid, shape)
    │  └─ Convert to JSON log entries with offset/key/operation
    ├─ ShapeCache.Storage.append_to_log!(lines, writer) ← PERSISTS HERE
    └─ Notify consumers of new changes
        ↓
Client reads shape log via Shapes API
```

## Optimization Strategies

### 1. Index-Based Filtering
- **Equality Index**: O(1) lookup for exact matches
- **Inclusion Index**: Tree traversal for array containment with binary search optimization
- **Avoids full predicate evaluation** for common patterns

### 2. Predicate Analysis
- WhereCondition intelligently detects optimizable patterns during shape subscription
- Complex predicates broken into (optimized + remaining) parts
- Non-optimizable parts use full Runner.execute evaluation

### 3. Dependency Ordering
- Shapes with dependencies processed after dependency shapes
- Allows referencing dependency values in WHERE clauses
- Strict ordering prevents circular dependencies

### 4. PG Snapshot Filtering
- Transactions before snapshot xmin skipped (already in snapshot)
- Transactions in xip_list buffered until committed status known
- After xmax, all transactions processed (full filtering no longer needed)

### 5. Partition Expansion
- Changes to partitions automatically expanded to parent table
- Single shape on parent handles all partition changes

## Key Data Structures

### WhereCondition Tree (for a table)
```
WhereCondition
├── indexes: 
│   {("user_id", "=")} → EqualityIndex
│       values: 
│           1 → WhereCondition
│               other_shapes: [shape_A, shape_B]  // role_id = 'admin'
│           2 → WhereCondition
│               other_shapes: [shape_C]  // is_active = true
│   {("tags", "@>")} → InclusionIndex
│       value_tree: sorted tree for array containment
│           "feature_X" → "feature_Y" → WhereCondition
│               other_shapes: [shape_D]  // created_at > now()
└── other_shapes:
    shape_E → WHERE clause parser output  // Complex expression
```

### Filter State
```
Filter
├── tables: 
│   ("public", "users") → WhereCondition (optimized tree above)
│   ("public", "posts") → WhereCondition
├── shapes:
│   "shape_handle_A" → Shape struct (definition)
│   "shape_handle_B" → Shape struct
└── refs_fun: fn(shape) -> extra_refs end  // Dependency refs
```

### Dependency Layers
```
[
  MapSet["shape_A", "shape_B"],      // Layer 0: no dependencies
  MapSet["shape_C", "shape_D"],      // Layer 1: depends on layer 0
  MapSet["shape_E"]                  // Layer 2: depends on layers 0-1
]
```

## Files to Review for Prototyping

### Core Routing Logic
1. `/lib/electric/replication/shape_log_collector.ex` - Main orchestrator
2. `/lib/electric/shapes/filter.ex` - Routing decision point
3. `/lib/electric/shapes/filter/where_condition.ex` - Predicate optimization
4. `/lib/electric/shapes/filter/indexes/*.ex` - Actual indexing implementations

### Change Application
1. `/lib/electric/shapes/consumer.ex` - Per-shape consumer (lines 654-671 for filtering, 494 for appending)
2. `/lib/electric/shapes/shape.ex` - Shape definition and convert_change logic

### Support Systems
1. `/lib/electric/shapes/dependency_layers.ex` - Dependency ordering
2. `/lib/electric/shapes/partitions.ex` - Partition handling
3. `/lib/electric/shape_cache/storage.ex` - Log persistence abstraction

## Potential Optimization Opportunities

1. **Batch Shape Routing**: Route entire transactions to shape batches instead of individual shapes
2. **Pre-computed Routing Tables**: Build routing bitmaps/matrices for common predicates
3. **Parallel Filtering**: Process multiple shapes in parallel during filter stage
4. **Columnar Storage**: Store shape logs in columnar format for better compression
5. **Lazy Evaluation**: Delay predicate evaluation until absolutely needed
6. **Caching**: Cache recently evaluated predicates or operation results
