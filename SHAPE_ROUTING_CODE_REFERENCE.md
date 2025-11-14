# Electric Shape Routing - Code Reference Guide

## Quick Function Lookup

### Shape Definition & Creation
```
File: /lib/electric/shapes/shape.ex
- Shape.new/1 - Create new shape from options
- Shape.convert_change/3 - Filter a change for a shape (CRITICAL)
- Shape.is_affected_by_relation_change?/2 - Check if schema change affects shape
```

### Main Routing Orchestrator
```
File: /lib/electric/replication/shape_log_collector.ex (Lines: 229-363)
- store_transaction/2 - Entry point for transactions (Line 62)
- handle_transaction/2 - Process transaction (Line 310)
- publish/2 - Route to affected shapes (Line 329)
  - Filter.affected_shapes(state.filter, event) [Line 335] <- KEY ROUTING
  - DependencyLayers.get_for_handles [Line 346]
  - ConsumerRegistry.publish [Line 348]
```

### Shape-to-Table Routing with Indexing
```
File: /lib/electric/shapes/filter.ex (Lines: 96-114)
- affected_shapes/2 - Main routing entry point
- add_shape/3 - Register shape with filter
- remove_shape/2 - Unregister shape

Sub-function: shapes_affected_by_record (Lines: 157-165)
- Calls WhereCondition.affected_shapes (Line 163)
```

### Predicate Optimization & Index Creation
```
File: /lib/electric/shapes/filter/where_condition.ex (Lines: 34-115)
- add_shape/3 - Add shape to optimization tree (Line 34)
  - optimise_where/1 - Detect patterns (Line 66)
    - Lines 68-109: Pattern matching for:
      - field = const (Lines 68-80)
      - array @> const (Lines 82-96)
      - AND combinations (Lines 98-109)
  - add_shape_to_indexes - Update index tree (Line 50)

- affected_shapes/4 - Find shapes affected by change (Line 143)
  - indexed_shapes_affected (Line 159) -> EqualityIndex/InclusionIndex
  - other_shapes_affected (Line 173) -> WhereClause.includes_record?
```

### Indexed Shape Filtering

#### Equality Index
```
File: /lib/electric/shapes/filter/indexes/equality_index.ex (Lines: 42-50)
- affected_shapes/4 - O(1) lookup by field value
  - Extract field value from record (Line 43)
  - Map lookup in values (Line 43)
  - Recurse on sub-WhereCondition (Line 48)
```

#### Inclusion Index (Array Containment)
```
File: /lib/electric/shapes/filter/indexes/inclusion_index.ex (Lines: 133-155)
- affected_shapes/2 - Tree traversal for containment
  - shapes_affected_by_array (Line 141) - Sort/deduplicate record's array
  - shapes_affected_by_tree (Line 150) - Traverse tree
    - shapes_affected_by_node (Line 157) - Check shapes at current node
    - shapes_affected_by_children (Line 163) - Traverse to children
      - Binary search over keys list (Lines 176-190)
```

### Predicate Evaluation (Non-optimized)
```
File: /lib/electric/shapes/where_clause.ex (Lines: 4-14)
- includes_record?/3 - Evaluate full WHERE clause for a record
  - Runner.record_to_ref_values - Extract record values
  - Runner.execute - Evaluate parsed SQL expression

File: /lib/electric/replication/eval/runner.ex
- execute/2 - Execute parsed WHERE clause expression
```

### Change Filtering in Consumer
```
File: /lib/electric/shapes/consumer.ex (Lines: 654-672)
- filter_changes/4 - Filter transaction for shape (Line 643)
  - Accumulates changes that match shape
  - Calls Shape.convert_change for each change (Line 655)
  
- do_handle_txn/2 - Process single transaction (Line 459)
  - filter_changes (Line 470) - Get relevant changes
  - prepare_log_entries (Line 493) - Convert to log format
  - append_to_log! (Line 494) <- FINAL PERSISTENCE POINT

- prepare_log_entries/3 - Convert changes to shape log entries (Line 661)
  - LogItems.from_change/4 - Create log item from change
  - Jason.encode! - JSON serialize
```

### Shape Log Persistence
```
File: /lib/electric/shape_cache/storage.ex
- append_to_log!/2 - Append filtered changes to shape log
  - Implementation depends on storage backend:
    - PureFileStorage
    - InMemoryStorage
    
File: /lib/electric/shape_cache/pure_file_storage/*.ex
- LogFile - Handle log writing and rotation
- WriteLoop - Async write batching
```

### Dependency Management
```
File: /lib/electric/shapes/dependency_layers.ex (Lines: 1-40)
- add_dependency/3 - Add shape to correct layer
  - Determines layer based on shape.shape_dependencies_handles
- get_for_handles/2 - Get affected layers for shapes (Line 35)
- remove_dependency/2 - Remove shape from layers
```

### Partition Handling
```
File: /lib/electric/shapes/partitions.ex (Lines: 139-150)
- handle_event/2 - Process partition-related changes
  - handle_relation/2 - Update partition mappings (Line 115)
  - Expands partition changes to parent table (Lines: 150-173)
```

### Materializer for Dependencies
```
File: /lib/electric/shapes/consumer/materializer.ex (Lines: 44-58)
- get_all_as_refs/2 - Get dependency values as refs
  - get_link_values/1 - Retrieve values for shape dependency
  - Used in Consumer.do_handle_txn as extra_refs (Line 468)
```

### Consumer Registry
```
File: /lib/electric/shapes/consumer_registry.ex
- publish/3 - Send event to all consumers in layer
  - Synchronous dispatch to shape consumer processes
```

## Code Paths for Different Change Types

### Insert Operation
```
Transaction → ShapeLogCollector → Filter.affected_shapes
  ↓ (change is NewRecord)
  Filter.shapes_affected_by_record → WhereCondition.affected_shapes
    ↓
  Consumer.handle_event → do_handle_txn → filter_changes
    ↓
  Shape.convert_change → Check where clause on record
    ↓
  Consumer → append_to_log!
```

### Update Operation
```
Same as Insert but:
- Shape.convert_change checks BOTH old_record and new_record (Line 553)
- May convert to NewRecord if old ∉ shape but new ∈ shape
- May convert to DeletedRecord if old ∈ shape but new ∉ shape
- May change UpdatedRecord to UpdatedRecord with filtered columns
```

### Delete Operation
```
Same routing as Insert, but:
- Shape.convert_change checks old_record (Line 540)
- Returns DeletedRecord if old_record ∈ shape
```

### Relation Change (Schema)
```
Transaction → ShapeLogCollector.handle_relation
  ↓
Filter.shapes_affected_by_change → all shapes (Line 118)
  ↓
Consumer.handle_event → terminates shape (Line 360)
```

## Critical Performance Points

1. **Filter.affected_shapes** (shape_log_collector.ex:335)
   - Called once per transaction
   - Performance determines throughput

2. **WhereCondition.affected_shapes** (where_condition.ex:143)
   - Index lookup vs full evaluation decision
   - indexed_shapes_affected (O(1-log n))
   - other_shapes_affected (O(n) per shape)

3. **Shape.convert_change** (shape.ex:517-567)
   - Called for each matching change
   - Evaluates WHERE clause for record
   - Filters columns

4. **Storage.append_to_log!** (consumer.ex:494)
   - Actual persistence bottleneck
   - Handles writes to shape logs
   - Can batch writes

## Testing Key Points

- Test shape predicate optimization in WhereCondition.add_shape
- Test index lookups with various field values
- Test convert_change with records matching/not matching WHERE
- Test partition expansion in Partitions.handle_event
- Test dependency layer ordering in DependencyLayers
- Test PG snapshot filtering in Consumer.handle_txn

## Where to Add Routing Optimizations

1. **Improve Filter.affected_shapes** - Batch operations, parallel checks
2. **Enhance WhereCondition** - Add more optimizable patterns
3. **Optimize Index.affected_shapes** - Better data structures for lookups
4. **Cache predicate results** - Memoize WHERE clause evaluations
5. **Batch Storage.append_to_log!** - Group writes across shapes
