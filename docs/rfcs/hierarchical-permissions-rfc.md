# RFC: Hierarchical Permission Inheritance (Electric-Side Implementation)

**Status**: Draft
**Author**: Electric Team
**Date**: December 2025
**Target Audience**: Engineers implementing hierarchical ACL patterns with Electric

---

## Executive Summary

This RFC describes how to solve the hierarchical permission inheritance problem **inside Electric** by maintaining a derived permission anchor index from the WAL stream. This approach requires no changes to the source database schema.

**The core insight**: Recursive permission inheritance can be precomputed as a simple column (`perm_anchor_id`), turning unbounded tree walks into O(1) lookups. Electric maintains this derived index internally and uses it during shape filtering.

**Prototype location**: `packages/sync-service/lib/electric/shapes/tree_index/`

---

## Problem Statement

### The Notion Use Case

Notion's blocks are organized in a tree:

```
Page (root)
├── Block A
│   ├── Block B
│   └── Block C (has explicit permissions)
│       └── Block D
└── Block E
```

**Permission rule**: A block's permissions come from the first ancestor (including itself) with explicit permissions.

**Current algorithm** (in Notion's API):
```python
def get_effective_permissions(block, blocks_map):
    current = block
    while current:
        if current.permissions is not None:
            return current.permissions
        current = blocks_map.get(current.parent_id)
    return default_permissions
```

This requires:
1. Loading all blocks into memory
2. Walking up the tree for each block

### Why This Breaks Electric's Model

Electric shapes use SQL WHERE clauses. Expressing "blocks where user has permission" would require:

```sql
-- IMPOSSIBLE: Recursive permission check in WHERE
WHERE user_can_access(walk_up_tree_until_permission(block.id))
```

This is an **unbounded self-join**. Electric's current subquery support handles cross-table membership, not recursive tree traversal.

### Requirements

1. **Permission revocation must be immediate** - Move-outs happen without query back
2. **Permission grants can have slight latency** - Move-ins may require querying
3. **Memory bounded by tables, not users/shapes** - Can't materialize per-user results
4. **No schema changes to source database**
5. **Generalizable pattern** - Useful beyond just Notion

---

## Solution: Permission Anchor Index

### Key Insight

Precompute `perm_anchor_id` for every block:

```
perm_anchor_id = id of the first ancestor (including self) with non-NULL permissions
```

| Block | has_acl? | perm_anchor_id |
|-------|----------|----------------|
| Page  | YES      | Page           |
| A     | NO       | Page           |
| B     | NO       | Page           |
| C     | YES      | C              |
| D     | NO       | C              |
| E     | NO       | Page           |

**With `perm_anchor_id`**, filtering becomes:

```sql
SELECT * FROM blocks
WHERE page_id = $page
  AND perm_anchor_id IN (user_accessible_anchors)
```

No recursion. Simple membership check.

---

## Architecture

```
┌─────────────────────┐
│   Source Postgres   │
│                     │
│  blocks (original)  │
└──────────┬──────────┘
           │ WAL Stream
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Electric Sync Service                         │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              Permission Anchor Index                        │  │
│  │                                                             │  │
│  │  ETS Tables:                                                │  │
│  │    anchors_table:  block_id -> {perm_anchor_id, has_acl}   │  │
│  │    children_table: parent_id -> [child_ids]                 │  │
│  │                                                             │  │
│  │  Subscribes to: blocks(id, parent_id, permissions)          │  │
│  │  Updates on: INSERT, UPDATE of parent_id/permissions, DELETE │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              ▼                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                   Shape Filter                              │  │
│  │                                                             │  │
│  │  Uses perm_anchor_id during WHERE clause evaluation         │  │
│  │  Filter: "Is record's anchor in user's accessible set?"     │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Implementation

### File Structure

```
packages/sync-service/lib/electric/shapes/tree_index/
├── permission_anchor_index.ex  # Main GenServer maintaining the index
├── supervisor.ex               # Supervisor for tree index processes
├── change_handler.ex           # Routes WAL changes to indexes
└── anchor_filter.ex            # Filter integration for shapes
```

### Core Module: PermissionAnchorIndex

**Location**: `lib/electric/shapes/tree_index/permission_anchor_index.ex`

The index is a GenServer that:
1. Maintains ETS tables for O(1) lookups
2. Processes changes from the WAL stream
3. Reanchors subtrees when blocks move or ACLs change

#### Data Structures

```elixir
# anchors_table: block_id -> {perm_anchor_id, has_acl}
:ets.new(:perm_anchor_stackid_public_blocks, [:set, :public, :named_table])

# children_table: parent_id -> child_id (bag for multiple children)
:ets.new(:perm_children_stackid_public_blocks, [:bag, :public, :named_table])
```

Using ETS with `:public` access and `:named_table` allows:
- Direct lookups without GenServer calls (for filtering hot path)
- Read concurrency across shape consumers
- Named access from any process

#### Configuration

```elixir
%{
  stack_id: "my-stack",
  table: {"public", "blocks"},
  id_column: "id",
  parent_column: "parent_id",
  has_acl_column: "permissions"  # or {:not_null, "col"} or {:expr, fn -> ... end}
}
```

#### Core Algorithm: Compute Anchor

```elixir
def compute_anchor(block_id, parent_id, has_acl, state) do
  if has_acl do
    # Block has its own ACL - it's its own anchor
    block_id
  else
    # Inherit from parent
    get_parent_anchor(parent_id, state) || block_id
  end
end

defp get_parent_anchor(nil, _state), do: nil
defp get_parent_anchor(parent_id, state) do
  case :ets.lookup(state.anchors_table, parent_id) do
    [{^parent_id, anchor_id, _has_acl}] -> anchor_id
    [] -> nil
  end
end
```

#### Core Algorithm: Reanchor Subtree

When a block moves or its ACL changes, we need to update anchors for the entire subtree:

```elixir
def reanchor_subtree(root_id, new_anchor, state) do
  case :ets.lookup(state.anchors_table, root_id) do
    [{^root_id, old_anchor, has_acl}] ->
      # Compute actual anchor (self if has_acl, otherwise inherited)
      actual_anchor = if has_acl, do: root_id, else: new_anchor

      # Update if changed
      if actual_anchor != old_anchor do
        :ets.insert(state.anchors_table, {root_id, actual_anchor, has_acl})
      end

      # Propagate to children (unless this block has own ACL - boundary)
      unless has_acl do
        propagate_to_children(root_id, actual_anchor, state)
      end

    [] ->
      :ok  # Not in index yet
  end
end

defp propagate_to_children(parent_id, parent_anchor, state) do
  children = get_children(parent_id, state)

  Enum.each(children, fn child_id ->
    case :ets.lookup(state.anchors_table, child_id) do
      [{^child_id, _old, has_acl}] ->
        if has_acl do
          :ok  # ACL boundary - stop propagation
        else
          :ets.insert(state.anchors_table, {child_id, parent_anchor, false})
          propagate_to_children(child_id, parent_anchor, state)
        end
      [] ->
        :ok
    end
  end)
end
```

**Complexity**: O(size of affected subtree), not O(total blocks).

### Change Processing

The index processes three types of changes:

#### 1. Insert

```elixir
defp handle_insert(record, state) do
  block_id = get_id(record, state)
  parent_id = get_parent_id(record, state)
  has_acl = check_has_acl(record, state)

  anchor_id = compute_anchor(block_id, parent_id, has_acl, state)

  :ets.insert(state.anchors_table, {block_id, anchor_id, has_acl})

  if parent_id do
    :ets.insert(state.children_table, {parent_id, block_id})
  end

  state
end
```

#### 2. Update (Move or ACL Change)

```elixir
defp handle_update(old_record, new_record, state) do
  block_id = get_id(new_record, state)
  old_parent = get_parent_id(old_record, state)
  new_parent = get_parent_id(new_record, state)
  old_has_acl = check_has_acl(old_record, state)
  new_has_acl = check_has_acl(new_record, state)

  cond do
    # Block moved
    old_parent != new_parent ->
      # Update children index
      :ets.delete_object(state.children_table, {old_parent, block_id})
      :ets.insert(state.children_table, {new_parent, block_id})

      # Reanchor subtree
      new_anchor = compute_anchor(block_id, new_parent, new_has_acl, state)
      reanchor_subtree(block_id, new_anchor, state)

    # ACL changed
    old_has_acl != new_has_acl ->
      new_anchor = if new_has_acl, do: block_id, else: get_parent_anchor(new_parent, state)
      reanchor_subtree(block_id, new_anchor, state)

    true ->
      state
  end
end
```

#### 3. Delete

```elixir
defp handle_delete(record, state) do
  block_id = get_id(record, state)
  parent_id = get_parent_id(record, state)

  :ets.delete(state.anchors_table, block_id)

  if parent_id do
    :ets.delete_object(state.children_table, {parent_id, block_id})
  end

  state
end
```

### Filter Integration

**Location**: `lib/electric/shapes/tree_index/anchor_filter.ex`

```elixir
@doc """
Check if a record passes the permission anchor filter.
"""
def includes_record?(stack_id, table, record, id_column, accessible_anchors) do
  block_id = Map.get(record, id_column)

  case PermissionAnchorIndex.get_anchor(stack_id, table, block_id) do
    nil ->
      false  # Not in index - fail safe

    anchor_id ->
      MapSet.member?(accessible_anchors, anchor_id)
  end
end

@doc """
Filter a batch of records (more efficient).
"""
def filter_records(stack_id, table, records, id_column, accessible_anchors) do
  block_ids = Enum.map(records, &Map.get(&1, id_column))
  anchors_map = PermissionAnchorIndex.get_anchors_for_blocks(stack_id, table, block_ids)

  Enum.filter(records, fn record ->
    block_id = Map.get(record, id_column)
    anchor_id = Map.get(anchors_map, block_id)
    anchor_id != nil and MapSet.member?(accessible_anchors, anchor_id)
  end)
end
```

### Integration with ShapeLogCollector

**Location**: `lib/electric/shapes/tree_index/change_handler.ex`

The ChangeHandler routes WAL changes to tree indexes **before** shapes process them:

```elixir
def process_changes(stack_id, changes, opts \\ []) do
  changes_by_table = group_by_table(changes)

  Enum.each(changes_by_table, fn {table, table_changes} ->
    case GenServer.whereis(PermissionAnchorIndex.name(stack_id, table)) do
      nil -> :ok  # No index for this table
      pid ->
        Enum.each(table_changes, fn change ->
          GenServer.cast(pid, {:handle_change, change})
        end)
    end
  end)
end
```

### Integration Point in ShapeLogCollector

To integrate with the existing codebase, add to `handle_txn_fragment/2` in `shape_log_collector.ex`:

```elixir
defp handle_txn_fragment(state, txn_fragment) do
  # Update tree indexes first (ensures anchors are current before shape filtering)
  TreeIndex.ChangeHandler.process_transaction(state.stack_id, txn_fragment, async: false)

  # Then proceed with existing shape routing...
  # ...existing code...
end
```

---

## Usage Example

### 1. Configure the Index

In stack configuration:

```elixir
tree_indexes: [
  %{
    type: :permission_anchor,
    table: {"public", "blocks"},
    id_column: "id",
    parent_column: "parent_id",
    has_acl_column: "permissions"
  }
]
```

### 2. Create a Shape with Permission Filtering

```typescript
// Client builds shape request with user's accessible anchors
const userAnchors = await fetchUserAnchors(userId);

const stream = new ShapeStream({
  url: `${ELECTRIC_URL}/v1/shape`,
  params: {
    table: 'blocks',
    where: `page_id = $1`,
    params: { 1: pageId },
    // Custom parameter for anchor filtering
    anchor_filter: JSON.stringify(userAnchors)
  }
});
```

### 3. Server-Side Filter Integration

In shape processing, apply anchor filter after WHERE clause:

```elixir
def convert_with_anchor_filter(shape, change, anchor_config) do
  case Shape.convert_change(shape, change, opts) do
    [] -> []
    [filtered_change] ->
      if AnchorFilter.includes_record?(
        stack_id,
        shape.root_table,
        filtered_change.record,
        anchor_config.id_column,
        anchor_config.accessible_anchors
      ) do
        [filtered_change]
      else
        []
      end
  end
end
```

---

## Move-In/Move-Out Semantics

The index maintains correct semantics for all move scenarios:

| Scenario | Index Update | Shape Effect |
|----------|--------------|--------------|
| Block inserted under accessible anchor | Anchor computed from parent | Move-in to shape |
| Block moved to accessible parent | Subtree reanchored | Move-in (query needed) |
| Block moved to inaccessible parent | Subtree reanchored | Move-out (immediate) |
| ACL added (new boundary) | Block becomes own anchor | Depends on new ACL |
| ACL removed | Inherits from parent | Depends on parent anchor |

**Key property**: Move-outs are immediate (anchor changes propagate instantly). Move-ins may require querying for newly-visible blocks.

---

## Performance Characteristics

### Time Complexity

| Operation | Complexity |
|-----------|------------|
| Lookup anchor for one block | O(1) ETS lookup |
| Insert new block | O(1) |
| Move block (no children) | O(1) |
| Move subtree of size N | O(N) to reanchor |
| ACL change affecting N descendants | O(N) to reanchor |

### Space Complexity

- **anchors_table**: O(num_blocks) entries
- **children_table**: O(num_blocks) entries

### Memory Estimate

For 1 million blocks:
- anchors_table: ~1M entries × ~100 bytes ≈ 100 MB
- children_table: ~1M entries × ~80 bytes ≈ 80 MB
- **Total**: ~180 MB per indexed table

---

## Comparison with Existing Subquery System

The Permission Anchor Index complements Electric's existing subquery support:

| Aspect | Current Subqueries | Permission Anchor Index |
|--------|-------------------|------------------------|
| **Use case** | Cross-table membership | Recursive tree inheritance |
| **Location** | `shape/subquery_moves.ex` | `tree_index/permission_anchor_index.ex` |
| **State storage** | In Consumer's `move_handling_state` | Dedicated ETS tables |
| **Triggered by** | Dependency shape changes | All table changes |
| **Filtering** | Via `extra_refs` in `convert_change` | Via `anchor_filter` parameter |

The two systems can work together - a shape could use subqueries for user→group→anchor resolution while using the anchor index for block→anchor lookups.

---

## Limitations and Future Work

### Current Limitations

1. **Single parent column**: Assumes one parent_id column per table
2. **Synchronous reanchoring**: Large subtree moves block change processing
3. **Memory-based**: Index is in ETS, not persisted across restarts
4. **No partial initialization**: Must process all blocks on startup

### Future Improvements

1. **Async reanchoring**: Process subtree updates in background worker
2. **Persistent storage**: Back ETS with embedded SQLite for large indexes
3. **Incremental initialization**: Build index lazily as blocks are queried
4. **Multi-column inheritance**: Support multiple inheritance paths

---

## Testing Strategy

### Unit Tests

```elixir
describe "PermissionAnchorIndex" do
  test "insert block without ACL inherits parent anchor" do
    insert_block("parent", nil, true)
    assert get_anchor("parent") == "parent"

    insert_block("child", "parent", false)
    assert get_anchor("child") == "parent"
  end

  test "move block reanchors subtree" do
    # Build tree: root -> A -> B -> C
    insert_block("root", nil, true)
    insert_block("A", "root", false)
    insert_block("B", "A", false)
    insert_block("C", "B", false)

    assert get_anchor("C") == "root"

    # Add ACL boundary at B
    update_acl("B", true)
    assert get_anchor("C") == "B"
  end

  test "delete block removes from index" do
    insert_block("parent", nil, true)
    insert_block("child", "parent", false)

    delete_block("child")
    assert get_anchor("child") == nil
  end
end
```

### Integration Tests

1. **End-to-end with shapes**: Verify records correctly filtered by anchor
2. **Concurrent updates**: Multiple moves don't corrupt index
3. **Large subtree moves**: Performance under load
4. **Recovery**: Index rebuilt correctly after restart

---

## Implementation Checklist

### Phase 1: Core Implementation (Complete)

- [x] `PermissionAnchorIndex` GenServer with ETS storage
- [x] Insert/Update/Delete handling
- [x] Subtree reanchoring algorithm
- [x] `AnchorFilter` for shape integration
- [x] `ChangeHandler` for routing changes
- [x] `Supervisor` for process management

### Phase 2: Integration

- [ ] Add to `StackSupervisor` startup
- [ ] Hook into `ShapeLogCollector.handle_txn_fragment/2`
- [ ] Add configuration parsing
- [ ] Add `anchor_filter` shape parameter
- [ ] Integration tests

### Phase 3: Production Hardening

- [ ] Persistent storage option (SQLite)
- [ ] Metrics/monitoring (anchor count, reanchor latency)
- [ ] Error recovery and resilience
- [ ] Load testing with realistic data

### Phase 4: Generalization

- [ ] Extract generic "tree inheritance" pattern
- [ ] Support other inheritance rules
- [ ] Documentation and examples

---

## Full API Reference

### PermissionAnchorIndex

```elixir
# Start the index
{:ok, pid} = PermissionAnchorIndex.start_link(config)

# Query single anchor
anchor = PermissionAnchorIndex.get_anchor(stack_id, table, block_id)

# Query multiple anchors (batch)
anchors = PermissionAnchorIndex.get_anchors_for_blocks(stack_id, table, block_ids)

# Check if block has own ACL
has_acl? = PermissionAnchorIndex.has_acl?(stack_id, table, block_id)

# Get all blocks with specific anchor
block_ids = PermissionAnchorIndex.get_blocks_with_anchor(stack_id, table, anchor_id)

# Get all unique anchors in index
anchors = PermissionAnchorIndex.all_anchors(stack_id, table)
```

### AnchorFilter

```elixir
# Check single record
passes? = AnchorFilter.includes_record?(stack_id, table, record, id_col, accessible)

# Filter batch of records
filtered = AnchorFilter.filter_records(stack_id, table, records, id_col, accessible)

# Build reusable filter function
filter_fn = AnchorFilter.build_filter_fn(stack_id, table, id_col, accessible)

# Get blocks visible for anchor set
blocks = AnchorFilter.blocks_for_anchors(stack_id, table, anchor_ids)
```

### ChangeHandler

```elixir
# Process list of changes
:ok = ChangeHandler.process_changes(stack_id, changes)

# Process full transaction
:ok = ChangeHandler.process_transaction(stack_id, txn)

# Check if table has index
has_index? = ChangeHandler.has_index_for_table?(stack_id, table)
```

---

## References

- **Prototype code**: `packages/sync-service/lib/electric/shapes/tree_index/`
- **Existing subquery system**: `packages/sync-service/lib/electric/shapes/shape/subquery_moves.ex`
- **Materializer pattern**: `packages/sync-service/lib/electric/shapes/consumer/materializer.ex`
- **Electric Shapes docs**: https://electric-sql.com/docs/guides/shapes
- **Notion data model**: https://www.notion.so/blog/data-model-behind-notion
