# RFC: Hierarchical Permission Inheritance for Tree-Structured Data

**Status**: Draft
**Author**: Electric Team
**Date**: December 2025
**Target Audience**: Engineers implementing hierarchical ACL patterns with Electric

## Executive Summary

This RFC addresses the challenge of syncing hierarchically-permissioned data (like Notion's blocks) through Electric. The core problem is that permission inheritance in tree structures traditionally requires "walking up" the parent chain - an unbounded recursive operation that doesn't fit Electric's `WHERE`-clause-based filtering model.

We propose three implementation options, ordered by recommendation:

1. **Option A (Recommended)**: Read Replica with Triggers - Postgres computes a `perm_anchor_id` column on a dedicated read replica
2. **Option B**: Electric-side Derived Index - Electric maintains a permission anchor index from the WAL
3. **Option C**: Invalidation-only Mode - Electric only signals when permissions change, client recomputes

The key insight enabling all options: **compile the recursive inheritance into a precomputed column**, turning unbounded tree walks into simple equality checks.

---

## Problem Statement

### The Notion Use Case

Notion's data model represents content as a tree of "blocks":

```
Page (root)
├── Block A
│   ├── Block B
│   └── Block C
│       └── Block D
└── Block E
```

**Current Schema** (simplified):
```sql
CREATE TABLE blocks (
    id UUID PRIMARY KEY,
    parent_id UUID REFERENCES blocks(id),
    page_id UUID NOT NULL,
    permissions JSONB,  -- NULL means "inherit from parent"
    content JSONB,
    ...
);
```

**Permission inheritance rule**: A block's effective permissions come from the first ancestor (including itself) that has a non-NULL `permissions` column.

**Current algorithm** (in Notion's API layer):
```python
def get_effective_permissions(block, all_blocks_map):
    current = block
    while current:
        if current.permissions is not None:
            return current.permissions
        current = all_blocks_map.get(current.parent_id)
    return default_page_permissions
```

This requires loading the entire page's blocks into memory and walking up the tree for each block.

### Why This Breaks Electric's Model

Electric's shapes filter data using SQL `WHERE` clauses:
```
GET /v1/shape?table=blocks&where=page_id='abc'
```

To express "blocks where user U has permission", you'd need something like:

```sql
-- INVALID: Recursive permission check
WHERE get_effective_permissions(blocks.id, $user) = 'allowed'
```

This is an **unbounded self-join** - the depth of the tree is unknown, and Electric can't evaluate recursive functions in WHERE clauses.

Electric's current subquery support (`column IN (SELECT ...)`) handles cross-table membership but not recursive tree traversal.

### Requirements

1. **Permission revocation must be immediate** - When access is removed, affected data must stop syncing within milliseconds
2. **Permission grants can have slight latency** - Acceptable to query back for newly-visible data
3. **Memory bounded by tables, not users/shapes** - Can't materialize per-user query results
4. **No schema changes to primary database** (strongly preferred)
5. **Generalizable pattern** - Not a one-off Notion-only feature

---

## The Key Insight: Permission Anchors

The recursive "walk up until you find permissions" can be precomputed as a single column:

```
perm_anchor_id = id of the first ancestor (including self) with non-NULL permissions
```

**Examples using the tree above:**

| Block | has permissions? | perm_anchor_id |
|-------|------------------|----------------|
| Page  | YES              | Page           |
| A     | NO               | Page           |
| B     | NO               | Page           |
| C     | YES              | C              |
| D     | NO               | C              |
| E     | NO               | Page           |

**Once you have `perm_anchor_id`**, the permission check becomes:

```sql
SELECT * FROM blocks
WHERE page_id = $page
  AND perm_anchor_id IN (
    SELECT anchor_id
    FROM user_accessible_anchors
    WHERE user_id = $user
  )
```

This is exactly what Electric's subquery support is designed for - no recursion, just a membership check.

### Formal Definition

```
perm_anchor_id(block) =
    if block.permissions IS NOT NULL:
        return block.id
    else if block.parent_id IS NULL:
        return block.id  -- root, must have permissions
    else:
        return perm_anchor_id(parent(block))
```

---

## Option A: Read Replica with Triggers (Recommended)

### Architecture

```
┌─────────────────────┐     Logical Replication    ┌─────────────────────┐
│   Primary Postgres  │ ─────────────────────────► │   Electric Replica  │
│                     │                            │                     │
│  blocks (original)  │                            │  blocks (original)  │
│                     │                            │  block_anchors      │ ◄── Maintained by triggers
└─────────────────────┘                            │                     │
                                                   └──────────┬──────────┘
                                                              │
                                                              ▼
                                                   ┌─────────────────────┐
                                                   │   Electric Sync     │
                                                   │   Service           │
                                                   └─────────────────────┘
```

**Key points:**
- Primary database is unchanged
- Read replica receives changes via logical replication
- Triggers on replica compute and maintain `perm_anchor_id`
- Electric connects to the replica

### Schema on Replica

```sql
-- Sidecar table (doesn't modify replicated blocks table)
CREATE TABLE block_anchors (
    block_id UUID PRIMARY KEY,
    perm_anchor_id UUID NOT NULL,

    -- Optional: for faster subtree queries
    CONSTRAINT fk_block FOREIGN KEY (block_id) REFERENCES blocks(id) ON DELETE CASCADE
);

-- Index for joining with blocks
CREATE INDEX idx_block_anchors_anchor ON block_anchors(perm_anchor_id);
```

### Helper Function: Does Block Have ACL?

```sql
-- Adapt this to match actual Notion schema
CREATE OR REPLACE FUNCTION block_has_acl(p_block_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT (b.permissions IS NOT NULL)
    FROM blocks b
    WHERE b.id = p_block_id;
$$;
```

### Core Function: Recompute Subtree Anchors

This is the heart of the implementation. When anything changes (insert, move, ACL toggle), we recompute anchors for the affected subtree.

```sql
CREATE OR REPLACE FUNCTION recompute_subtree_anchors(
    p_root UUID,           -- Root of subtree to recompute
    p_parent_anchor UUID   -- Anchor inherited from above this subtree
)
RETURNS void
LANGUAGE sql
AS $$
    WITH RECURSIVE tree AS (
        -- Base case: the root of the subtree
        SELECT
            b.id,
            b.parent_id,
            block_has_acl(b.id) AS has_acl,
            CASE
                WHEN block_has_acl(b.id) THEN b.id
                ELSE p_parent_anchor
            END AS anchor
        FROM blocks b
        WHERE b.id = p_root

        UNION ALL

        -- Recursive case: children
        SELECT
            c.id,
            c.parent_id,
            block_has_acl(c.id) AS has_acl,
            CASE
                WHEN block_has_acl(c.id) THEN c.id
                ELSE t.anchor  -- Inherit from parent's computed anchor
            END AS anchor
        FROM blocks c
        JOIN tree t ON c.parent_id = t.id
    )
    INSERT INTO block_anchors AS ba (block_id, perm_anchor_id)
    SELECT id, anchor
    FROM tree
    ON CONFLICT (block_id)
        DO UPDATE SET perm_anchor_id = EXCLUDED.perm_anchor_id
        WHERE ba.perm_anchor_id IS DISTINCT FROM EXCLUDED.perm_anchor_id;
$$;
```

**Performance note**: The recursive CTE traverses the subtree once. The `WHERE ... IS DISTINCT FROM` clause ensures we only write changed rows, reducing I/O.

### Trigger Function: Handle Block Changes

```sql
CREATE OR REPLACE FUNCTION blocks_after_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent_anchor UUID;
BEGIN
    -- Determine the anchor from above this block
    IF NEW.parent_id IS NULL THEN
        -- Root block (page) - it's its own anchor
        v_parent_anchor := NEW.id;
    ELSE
        -- Look up parent's anchor
        SELECT perm_anchor_id
        INTO v_parent_anchor
        FROM block_anchors
        WHERE block_id = NEW.parent_id;

        -- Parent might not be computed yet (replication ordering)
        IF v_parent_anchor IS NULL THEN
            -- Fallback: treat parent as its own anchor
            -- This will be corrected when parent is processed
            v_parent_anchor := NEW.parent_id;
        END IF;
    END IF;

    -- Recompute this block and all descendants
    PERFORM recompute_subtree_anchors(NEW.id, v_parent_anchor);

    RETURN NEW;
END;
$$;
```

### Trigger: Fire on Replication Events

```sql
-- Main trigger for inserts and relevant updates
CREATE TRIGGER blocks_perm_anchor_trg
AFTER INSERT OR UPDATE OF parent_id, permissions
ON public.blocks
FOR EACH ROW
EXECUTE FUNCTION blocks_after_change();

-- CRITICAL: Enable trigger for logical replication
ALTER TABLE public.blocks ENABLE REPLICA TRIGGER blocks_perm_anchor_trg;

-- Cleanup trigger for deletes
CREATE OR REPLACE FUNCTION blocks_after_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    DELETE FROM block_anchors WHERE block_id = OLD.id;
    -- Note: children will also be deleted (cascade) or their parent will change
    RETURN OLD;
END;
$$;

CREATE TRIGGER blocks_perm_anchor_delete_trg
AFTER DELETE ON public.blocks
FOR EACH ROW
EXECUTE FUNCTION blocks_after_delete();

ALTER TABLE public.blocks ENABLE REPLICA TRIGGER blocks_perm_anchor_delete_trg;
```

### Initial Backfill

Run this once when setting up the replica:

```sql
DO $$
DECLARE
    r RECORD;
BEGIN
    -- Process each page root (parent_id IS NULL)
    FOR r IN SELECT id FROM blocks WHERE parent_id IS NULL LOOP
        PERFORM recompute_subtree_anchors(r.id, r.id);
    END LOOP;
END;
$$;
```

### Electric Shape Configuration

With `block_anchors` maintained on the replica, Electric shapes become simple:

```typescript
// User requests a page with their accessible blocks
const stream = new ShapeStream({
  url: `${ELECTRIC_URL}/v1/shape`,
  params: {
    table: 'blocks',
    where: `
      page_id = $1
      AND id IN (
        SELECT ba.block_id
        FROM block_anchors ba
        WHERE ba.perm_anchor_id IN (
          SELECT anchor_id
          FROM user_anchor_access
          WHERE user_id = $2
        )
      )
    `,
    params: { 1: pageId, 2: userId }
  }
})
```

### Handling Move-In/Move-Out Scenarios

The triggers handle all move scenarios automatically:

| Scenario | What Triggers | Result |
|----------|---------------|--------|
| Block inserted | `AFTER INSERT` | New block gets anchor from parent |
| Block moved (parent changed) | `UPDATE OF parent_id` | Subtree reanchored to new parent's anchor |
| ACL added to block | `UPDATE OF permissions` | This block becomes anchor for descendants |
| ACL removed from block | `UPDATE OF permissions` | This block inherits anchor from parent |
| Block deleted | `AFTER DELETE` | Anchor row removed |

### Pros & Cons

**Pros:**
- No changes to primary database
- All recursion happens in Postgres (proven, debuggable)
- Electric just sees a regular column - no new features needed
- Pattern is generalizable ("trigger-maintained derived columns on replica")
- Can be set up without Electric code changes

**Cons:**
- Requires managing a read replica
- Trigger execution adds latency to replication
- Large subtree moves can be expensive (but bounded by subtree size)

---

## Option B: Electric-Side Derived Index

If the read-replica approach isn't feasible, Electric can maintain the permission anchor mapping internally.

### Architecture

```
┌─────────────────────┐
│   Primary Postgres  │
│                     │
│  blocks (original)  │
└──────────┬──────────┘
           │ WAL Stream
           ▼
┌─────────────────────────────────────────────────────┐
│                Electric Sync Service                 │
│  ┌───────────────────────────────────────────────┐  │
│  │          Permission Anchor Index              │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  block_id -> perm_anchor_id mapping     │  │  │
│  │  │  (persistent KV store or embedded DB)   │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │                                               │  │
│  │  Subscribes to: blocks(id, parent_id, has_acl)│  │
│  │  Updates index on INSERT/UPDATE/DELETE       │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  Shape filtering uses index as virtual column       │
└─────────────────────────────────────────────────────┘
```

### Implementation Location in Codebase

Based on the codebase exploration, this would be implemented as a new module in the shapes subsystem:

```
packages/sync-service/lib/electric/shapes/
├── shape.ex                          # Shape struct (add perm_anchor support)
├── consumer/
│   ├── derived_index.ex              # NEW: Base module for derived indexes
│   └── permission_anchor_index.ex    # NEW: Permission anchor implementation
└── filter/
    └── permission_anchor_filter.ex   # NEW: Filter using the index
```

### Data Structures

```elixir
# packages/sync-service/lib/electric/shapes/consumer/permission_anchor_index.ex

defmodule Electric.Shapes.Consumer.PermissionAnchorIndex do
  @moduledoc """
  Maintains a mapping of block_id -> perm_anchor_id for tree-structured
  permission inheritance.

  The index is updated incrementally from the WAL stream and can be
  queried during shape filtering.
  """

  use GenServer

  defstruct [
    :stack_id,
    :table_relation,        # {schema, table} being indexed
    :parent_column,         # Column name containing parent reference
    :has_acl_column,        # Column name or function to check ACL presence
    :ets_table,             # ETS table for block_id -> anchor lookups
    :children_table         # ETS table for parent_id -> [child_ids] (for reanchoring)
  ]

  @type t :: %__MODULE__{
    stack_id: String.t(),
    table_relation: Electric.relation(),
    parent_column: String.t(),
    has_acl_column: String.t(),
    ets_table: :ets.tid(),
    children_table: :ets.tid()
  }

  # ... implementation
end
```

### Index Operations

```elixir
defmodule Electric.Shapes.Consumer.PermissionAnchorIndex do
  # ... struct definition above

  @doc """
  Process a new record from the WAL stream.
  """
  def handle_insert(state, %{record: record}) do
    block_id = Map.fetch!(record, "id")
    parent_id = Map.get(record, state.parent_column)
    has_acl = check_has_acl(record, state.has_acl_column)

    # Determine anchor
    anchor =
      if has_acl do
        block_id
      else
        get_parent_anchor(state, parent_id) || parent_id
      end

    # Store mapping
    :ets.insert(state.ets_table, {block_id, anchor, has_acl})

    # Track in children index for future reanchoring
    if parent_id do
      add_child(state.children_table, parent_id, block_id)
    end

    state
  end

  @doc """
  Process an update from the WAL stream.
  Handles: parent_id changes (moves), ACL changes
  """
  def handle_update(state, %{old_record: old, record: new}) do
    block_id = Map.fetch!(new, "id")
    old_parent = Map.get(old, state.parent_column)
    new_parent = Map.get(new, state.parent_column)
    old_has_acl = check_has_acl(old, state.has_acl_column)
    new_has_acl = check_has_acl(new, state.has_acl_column)

    cond do
      # Parent changed (block moved)
      old_parent != new_parent ->
        # Remove from old parent's children
        remove_child(state.children_table, old_parent, block_id)
        # Add to new parent's children
        add_child(state.children_table, new_parent, block_id)
        # Reanchor this block and descendants
        new_anchor = compute_anchor(state, block_id, new_parent, new_has_acl)
        reanchor_subtree(state, block_id, new_anchor)

      # ACL status changed
      old_has_acl != new_has_acl ->
        if new_has_acl do
          # Block now has its own ACL - becomes its own anchor
          reanchor_subtree(state, block_id, block_id)
        else
          # Block no longer has ACL - inherit from parent
          parent_anchor = get_parent_anchor(state, new_parent) || new_parent
          reanchor_subtree(state, block_id, parent_anchor)
        end

      true ->
        # No permission-relevant change
        :ok
    end

    state
  end

  @doc """
  Reanchor a subtree when its root's anchor changes.
  Uses BFS to propagate new anchor, stopping at ACL boundaries.
  """
  defp reanchor_subtree(state, root_id, new_anchor) do
    # Update root
    case :ets.lookup(state.ets_table, root_id) do
      [{^root_id, _old_anchor, has_acl}] ->
        actual_anchor = if has_acl, do: root_id, else: new_anchor
        :ets.insert(state.ets_table, {root_id, actual_anchor, has_acl})

        # Only propagate if this block doesn't have its own ACL
        unless has_acl do
          propagate_to_children(state, root_id, actual_anchor)
        end

      [] ->
        # Block not in index yet - will be handled on insert
        :ok
    end
  end

  defp propagate_to_children(state, parent_id, parent_anchor) do
    children = get_children(state.children_table, parent_id)

    Enum.each(children, fn child_id ->
      case :ets.lookup(state.ets_table, child_id) do
        [{^child_id, _old_anchor, has_acl}] ->
          if has_acl do
            # Child has own ACL - stop propagation here
            :ok
          else
            # Update child and recurse
            :ets.insert(state.ets_table, {child_id, parent_anchor, false})
            propagate_to_children(state, child_id, parent_anchor)
          end

        [] ->
          :ok
      end
    end)
  end

  @doc """
  Look up the permission anchor for a block.
  Used during shape filtering.
  """
  def get_anchor(state, block_id) do
    case :ets.lookup(state.ets_table, block_id) do
      [{^block_id, anchor, _has_acl}] -> anchor
      [] -> nil
    end
  end

  # Helper functions
  defp get_parent_anchor(state, nil), do: nil
  defp get_parent_anchor(state, parent_id), do: get_anchor(state, parent_id)

  defp check_has_acl(record, column) do
    value = Map.get(record, column)
    value != nil and value != ""
  end

  defp add_child(children_table, parent_id, child_id) do
    :ets.insert(children_table, {parent_id, child_id})
  end

  defp remove_child(children_table, parent_id, child_id) do
    :ets.delete_object(children_table, {parent_id, child_id})
  end

  defp get_children(children_table, parent_id) do
    :ets.lookup(children_table, parent_id)
    |> Enum.map(fn {_parent, child} -> child end)
  end

  defp compute_anchor(state, block_id, parent_id, has_acl) do
    if has_acl do
      block_id
    else
      get_parent_anchor(state, parent_id) || parent_id
    end
  end
end
```

### Integration with Shape Consumer

The permission anchor index would integrate with the existing Consumer module:

```elixir
# In packages/sync-service/lib/electric/shapes/consumer.ex

defmodule Electric.Shapes.Consumer do
  # ... existing code ...

  # Add permission anchor index to state
  defstruct [
    # ... existing fields ...
    :permission_anchor_index  # NEW
  ]

  # When processing transactions, update the index
  defp process_change(state, change) do
    # ... existing change processing ...

    # Update permission anchor index if configured
    state =
      if state.permission_anchor_index do
        PermissionAnchorIndex.handle_change(state.permission_anchor_index, change)
        state
      else
        state
      end

    # ... rest of processing ...
  end
end
```

### Filter Integration

For shape filtering to use the permission anchor:

```elixir
# In packages/sync-service/lib/electric/shapes/filter/permission_anchor_filter.ex

defmodule Electric.Shapes.Filter.PermissionAnchorFilter do
  @moduledoc """
  Filter that uses the permission anchor index to check if a record
  should be included in a shape based on ACL membership.
  """

  alias Electric.Shapes.Consumer.PermissionAnchorIndex

  @doc """
  Check if a record passes the permission anchor filter.

  The shape defines which anchors the user has access to.
  This function checks if the record's anchor is in that set.
  """
  def includes_record?(index, record, accessible_anchors) do
    block_id = Map.fetch!(record, "id")

    case PermissionAnchorIndex.get_anchor(index, block_id) do
      nil ->
        # Block not in index - might be newly inserted
        # Default to excluding (conservative)
        false

      anchor ->
        MapSet.member?(accessible_anchors, anchor)
    end
  end
end
```

### Persistence Considerations

For production use, the ETS-based index should be backed by persistent storage:

```elixir
defmodule Electric.Shapes.Consumer.PermissionAnchorIndex.Storage do
  @moduledoc """
  Persistent storage for permission anchor index.
  Options:
  1. Embedded SQLite (recommended for large datasets)
  2. DETS (simple but limited)
  3. RocksDB via ExLevelDB
  """

  # SQLite implementation sketch
  def init_sqlite(path) do
    {:ok, conn} = Exqlite.Sqlite3.open(path)

    Exqlite.Sqlite3.execute(conn, """
      CREATE TABLE IF NOT EXISTS anchors (
        block_id TEXT PRIMARY KEY,
        perm_anchor_id TEXT NOT NULL,
        has_acl INTEGER NOT NULL
      )
    """)

    Exqlite.Sqlite3.execute(conn, """
      CREATE TABLE IF NOT EXISTS children (
        parent_id TEXT,
        child_id TEXT,
        PRIMARY KEY (parent_id, child_id)
      )
    """)

    {:ok, conn}
  end
end
```

### Pros & Cons

**Pros:**
- No read replica needed
- All logic contained within Electric
- Generalizable as a "tree inheritance" module
- Can be optimized for Electric's specific access patterns

**Cons:**
- Significant new code in Electric
- Need to handle persistence/recovery
- Need adjacency index (parent->children) for efficient reanchoring
- Adds complexity to Electric's architecture

---

## Option C: Invalidation-Only Mode

A simpler approach where Electric handles data sync but not permission filtering.

### Architecture

```
┌─────────────────────┐
│   Primary Postgres  │
│                     │
│  blocks (original)  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────────────────────────┐
│                Electric Sync Service                 │
│                                                     │
│  Shape: blocks WHERE page_id = $1                   │
│  (No permission filtering - syncs all page blocks)  │
│                                                     │
│  Emits: "page P changed" events                     │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│               Client Application                     │
│                                                     │
│  On "page changed" event:                           │
│  1. Query backend for user's permitted blocks       │
│  2. Filter local shape data                         │
│  3. Re-render UI                                    │
└─────────────────────────────────────────────────────┘
```

### Implementation

Electric shape syncs all blocks for a page:

```typescript
const stream = new ShapeStream({
  url: `${ELECTRIC_URL}/v1/shape`,
  params: {
    table: 'blocks',
    where: `page_id = $1`,
    params: { 1: pageId }
  }
})
```

Client maintains permission state separately:

```typescript
// Fetch user's accessible anchors from backend
async function fetchAccessibleAnchors(userId: string, pageId: string) {
  const response = await fetch(`/api/permissions?user=${userId}&page=${pageId}`)
  return new Set(await response.json())
}

// Filter blocks based on permission anchors
function filterBlocksByPermission(blocks: Block[], accessibleAnchors: Set<string>) {
  const blockMap = new Map(blocks.map(b => [b.id, b]))

  function getAnchor(block: Block): string {
    if (block.permissions != null) return block.id
    const parent = blockMap.get(block.parent_id)
    return parent ? getAnchor(parent) : block.id
  }

  return blocks.filter(block => accessibleAnchors.has(getAnchor(block)))
}

// Usage
const shape = new Shape(stream)
let accessibleAnchors = await fetchAccessibleAnchors(userId, pageId)

shape.subscribe(async ({ rows }) => {
  // Re-filter on any change
  const visibleBlocks = filterBlocksByPermission(rows, accessibleAnchors)
  renderPage(visibleBlocks)
})

// Listen for permission changes (separate channel)
permissionEvents.on('changed', async () => {
  accessibleAnchors = await fetchAccessibleAnchors(userId, pageId)
  const visibleBlocks = filterBlocksByPermission(shape.currentValue, accessibleAnchors)
  renderPage(visibleBlocks)
})
```

### Pros & Cons

**Pros:**
- Minimal Electric changes needed
- Client has full control over permission logic
- Easy to implement quickly

**Cons:**
- All page blocks synced to client (privacy concern?)
- Client must re-run permission filtering on every change
- Doesn't solve the core value proposition (instant permission-aware sync)
- Permission changes require separate notification channel

---

## Comparison Matrix

| Aspect | Option A: Replica Triggers | Option B: Electric Index | Option C: Invalidation |
|--------|---------------------------|-------------------------|------------------------|
| **Primary DB changes** | None | None | None |
| **Electric code changes** | Minimal | Significant | Minimal |
| **Infrastructure** | Read replica | None | None |
| **Permission revocation latency** | ~100ms | ~50ms | ~100ms + client compute |
| **Memory usage** | In Postgres | In Electric | In client |
| **Generalizability** | High | High | Low |
| **Implementation effort** | Medium | High | Low |
| **Operational complexity** | Medium | Low | Low |

---

## Recommended Approach

**For the Notion partnership**: Start with **Option A (Read Replica with Triggers)**.

**Rationale:**
1. No changes needed to Notion's primary database
2. No new features needed in Electric (uses existing subquery support)
3. All recursion handled by proven Postgres triggers
4. Pattern is reusable for other customers with hierarchical ACLs
5. Read replica is a common pattern they likely already use

**Future direction**: If demand warrants, implement **Option B** as a first-class Electric feature called "Tree Inheritance Index" that can be enabled for any table with parent-child relationships.

---

## Implementation Checklist for Option A

### Phase 1: Replica Setup (Week 1)

- [ ] Set up logical replication subscriber database
- [ ] Create `block_anchors` table
- [ ] Implement `block_has_acl()` function (adapted to actual schema)
- [ ] Implement `recompute_subtree_anchors()` function
- [ ] Create and enable replica triggers

### Phase 2: Backfill & Verification (Week 2)

- [ ] Run initial backfill for all existing blocks
- [ ] Verify anchor computation matches expected results
- [ ] Test move scenarios (indent, outdent, cross-page move)
- [ ] Test ACL toggle scenarios
- [ ] Load test with large page trees

### Phase 3: Electric Integration (Week 3)

- [ ] Configure Electric to connect to replica
- [ ] Create shape definition using `block_anchors`
- [ ] Implement `user_anchor_access` table/view
- [ ] End-to-end test permission filtering
- [ ] Test move-in/move-out behavior

### Phase 4: Performance & Polish (Week 4)

- [ ] Benchmark trigger performance on large subtrees
- [ ] Add monitoring for anchor computation latency
- [ ] Document operational procedures
- [ ] Create runbook for common issues

---

## Appendix: Electric Subquery Implementation Reference

The current Electric subquery implementation (relevant code locations):

- **Shape struct**: `packages/sync-service/lib/electric/shapes/shape.ex`
  - `shape_dependencies` - list of nested shapes from subqueries
  - `shape_dependencies_handles` - handles to dependency shapes
  - `tag_structure` - for tracking which dependency caused row inclusion

- **Subquery handling**: `packages/sync-service/lib/electric/shapes/shape/subquery_moves.ex`
  - `move_in_where_clause/3` - transforms `IN (SELECT...)` to `= ANY($1::type[])`
  - `make_move_out_control_message/4` - generates control messages for removed values
  - `move_in_tag_structure/1` - generates tag structure for tracking

- **Move-in state**: `packages/sync-service/lib/electric/shapes/consumer/move_ins.ex`
  - Tracks waiting/filtering move-in states
  - Manages snapshot visibility for concurrent move-ins

- **Move handling**: `packages/sync-service/lib/electric/shapes/consumer/move_handling.ex`
  - `process_move_ins/3` - handles new values in dependency shapes
  - `process_move_outs/3` - handles removed values

**Current limitations** (from code TODOs):
- Single subquery only (multi-subquery support planned)
- Single column per pattern in tag structure
- No nested subquery optimization

---

## Appendix: Test Scenarios

### Scenario 1: Basic Permission Inheritance

```
Setup:
  Page (has ACL: admin)
  ├── Block A (no ACL)
  └── Block B (no ACL)

User: admin (has access to Page anchor)

Expected:
  - User sees: Page, Block A, Block B
  - All blocks have perm_anchor_id = Page.id
```

### Scenario 2: Mid-Tree ACL Boundary

```
Setup:
  Page (has ACL: admin)
  ├── Block A (no ACL)
  │   └── Block B (has ACL: editor)
  │       └── Block C (no ACL)
  └── Block D (no ACL)

User: editor (has access to Block B anchor)

Expected:
  - User sees: Block B, Block C
  - Block B anchor = Block B
  - Block C anchor = Block B
```

### Scenario 3: Block Move Changes Visibility

```
Initial:
  Page (has ACL: admin)
  ├── Block A (has ACL: team1)
  │   └── Block B (no ACL)
  └── Block C (has ACL: team2)

User: team1 member

Move Block B under Block C:
  Page
  ├── Block A (has ACL: team1)
  └── Block C (has ACL: team2)
      └── Block B (no ACL)

Expected:
  - Before move: User sees Block A, Block B
  - After move: User sees only Block A
  - Block B's anchor changes from Block A to Block C
```

### Scenario 4: ACL Removed Mid-Tree

```
Initial:
  Page (has ACL: admin)
  └── Block A (has ACL: team1)
      └── Block B (no ACL)

Remove ACL from Block A:
  Page (has ACL: admin)
  └── Block A (no ACL)
      └── Block B (no ACL)

Expected:
  - Block A anchor: Page (was Block A)
  - Block B anchor: Page (was Block A)
  - Users who had access via Block A now need Page access
```

---

## References

- [Electric Shapes Documentation](https://electric-sql.com/docs/guides/shapes)
- [Electric Subquery Support](https://github.com/electric-sql/electric/discussions/2931)
- [Notion Block Data Model](https://www.notion.so/blog/data-model-behind-notion)
- [PostgreSQL Logical Replication Row Filtering](https://www.postgresql.org/docs/17/logical-replication-row-filter.html)
