# Galvanic: How the Core Algorithm Works

This document explains the core algorithm behind Galvanic — how data flows from a database change through the engine to clients. It covers two cases: a simple single-table shape, and a shape that uses `WHERE ... IN (subquery)` to filter against another table.

For the full design, see [galvanic_v1_design_proposal_v2.md](./galvanic_v1_design_proposal_v2.md).

---

## The key ideas

Galvanic is a **dataflow engine**. Data enters from a database change stream (the Postgres WAL), flows through a graph of operators, and exits as events delivered to subscribing clients. Three ideas make the algorithm work:

**1. Multiset diffs.** Every piece of data in the graph is a `+1` (insertion) or `-1` (retraction). An INSERT becomes `+1`. A DELETE becomes `-1`. An UPDATE is decomposed into `-1` of the old row followed by `+1` of the new row. This is the same model used by Differential Dataflow and DBSP. Operators never see "insert/update/delete" — they see `+1/-1` and process them uniformly.

**2. Shared graph with sparse fanout.** All shapes for a tenant share a single operator graph. When a change arrives, a reverse index (the `fanOutAttach` operator) looks up which shapes care about it and tags the row with that set. The row is not duplicated per-shape — it carries a compact recipient set and flows through a single path. This is what makes 100k+ shapes feasible.

**3. Up-queries for partial state.** Operators don't need to hold all data in memory. When an operator encounters a gap (e.g., a join operator gets a row but doesn't have the matching row from the other side), it sends a request backward through the graph to the source, asking for the missing data. This request — an **up-query** — accumulates context from each operator it passes through, so the database receives a precise, filtered query. The response flows forward through the same graph as normal data.

---

## Case 1: Simple single-table shape

### Shape definition

```sql
SELECT id, title, completed
FROM todos
WHERE list_id = $1 AND completed = false
```

This shape says: "give me all incomplete todos for a specific list." The `$1` is a parameter — each subscribing client provides a `list_id` value.

### The dataflow graph

The compiler lowers this into a chain of operators:

```
WAL stream
    │
    ▼
┌──────────────────┐
│ Source Controller │  Converts WAL events to +1/-1 diffs
│ (todos table)    │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Filter           │  completed = false
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ FanOutAttach     │  Reverse index: list_id → {shape IDs}
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Consolidate      │  Cancel net-zero diffs, enforce version ordering
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ SinkWrite        │  Classify to insert/update/delete, write to Durable Stream
└──────────────────┘
```

### Initial snapshot (shape attach)

When a client subscribes to this shape with `list_id = 42`:

1. The sink issues an **up-query** backward through the graph: "I need all rows matching this shape."
2. The up-query passes backward through FanOutAttach (strips recipient info, it's about data not routing) → Filter (augments the predicate: adds `AND completed = false`) → Source Controller.
3. The source controller compiles the accumulated predicate into SQL:
   ```sql
   SELECT * FROM todos WHERE list_id = 42 AND completed = false
   ```
4. It runs this against Postgres (with a version snapshot marker so it knows where the result fits in the replication stream).
5. The result rows flow **forward** through the graph as `diff=+1` rows, tagged with the up-query ID.
6. Each operator processes them like normal data — the filter checks them (they should all pass), FanOutAttach tags them with the recipient set, consolidate buffers them.
7. Once all rows arrive and the frontier advances past the query version, consolidate emits the stable result. SinkWrite classifies each `+1` as an `insert` operation and writes it to the Durable Stream.
8. The client reads from the Durable Stream and gets its initial snapshot.

### Live maintenance (a row changes)

A user marks todo #7 as completed. Postgres writes an UPDATE to the WAL:

1. The **source controller** receives the WAL event. It decomposes the UPDATE into two diffs:
   - `-1` of the old row: `{id:7, title:"Buy milk", completed:false, list_id:42}`
   - `+1` of the new row: `{id:7, title:"Buy milk", completed:true, list_id:42}`

2. Both diffs flow through the **filter** (`completed = false`):
   - The `-1` (old row, `completed=false`) **passes** the filter.
   - The `+1` (new row, `completed=true`) is **dropped** by the filter.

3. Only the `-1` reaches **FanOutAttach**. The reverse index looks up `list_id=42` and finds the shapes subscribed to list 42. The row is tagged with that recipient set.

4. **Consolidate** buffers the diff until the frontier advances, then emits it.

5. **SinkWrite** examines its output state: it previously emitted todo #7 as an insert. Now it sees a `-1` retraction. The state transition is `row → none`, which classifies as a **delete** operation on the wire protocol.

6. The delete is appended to the Durable Stream. The client picks it up and removes todo #7 from its local view.

The important thing: the `+1` for the new row (with `completed=true`) was dropped by the filter. The client never sees it. The engine correctly computed that completing a todo means it should leave the "incomplete todos" shape.

---

## Case 2: Shape with `WHERE ... IN (subquery)`

### Shape definition

```sql
SELECT i.id, i.title, i.project_id
FROM issues i
WHERE i.project_id IN (
  SELECT p.id FROM projects p WHERE p.active = true
)
```

This shape says: "give me all issues belonging to active projects." It crosses two tables: `issues` and `projects`.

### Compiler lowering

The compiler transforms `IN (subquery)` into a **semi-join** — an operator that checks whether a matching row exists on the right side, without duplicating:

```
WAL stream (issues)               WAL stream (projects)
    │                                   │
    ▼                                   ▼
┌──────────────────┐         ┌──────────────────┐
│ Source Controller │         │ Source Controller │
│ (issues table)   │         │ (projects table)  │
└────────┬─────────┘         └────────┬─────────┘
         │                            │
         │                            ▼
         │                   ┌──────────────────┐
         │                   │ Filter           │  active = true
         │                   └────────┬─────────┘
         │                            │
         ▼                            ▼
     ┌────────────────────────────────────┐
     │ SemiJoin                           │
     │ (issues.project_id = projects.id)  │
     │                                    │
     │ State:                             │
     │   right index: {project_id → exists}│
     │   left tracking: minimal for       │
     │   retract correctness              │
     └──────────────┬─────────────────────┘
                    │
                    ▼
          ┌──────────────────┐
          │ FanOutAttach     │
          └────────┬─────────┘
                   │
                   ▼
          ┌──────────────────┐
          │ Consolidate      │
          └────────┬─────────┘
                   │
                   ▼
          ┌──────────────────┐
          │ SinkWrite        │
          └──────────────────┘
```

The semi-join passes rows from `issues` (left side) only when a matching `project_id` exists in the filtered `projects` set (right side). It emits issue rows, not project rows.

### Initial snapshot (shape attach)

This is where the up-query mechanism becomes interesting. The engine needs the initial data, but neither the semi-join nor the filter hold any state yet — they're empty.

1. The sink issues an up-query backward: "I need all matching rows."

2. The up-query reaches the **semi-join**. The planner has pre-decided: for this path, query-back through the **projects (right) side** first.

3. The semi-join forwards the up-query to the filter on the projects side.

4. The **filter** augments the predicate: adds `AND active = true`.

5. The **projects source controller** receives the augmented up-query and compiles it to SQL:

   ```sql
   SELECT * FROM projects WHERE active = true
   ```

6. The projects source controller runs the query and injects the result rows as `diff=+1` forward through the graph. They flow through the filter (pass, since they're all active) and into the semi-join's **right-side index**, populating it.

7. Now the semi-join knows which project IDs are active. It needs the issues. It issues a **dependent up-query** to the issues source controller. This can use either:
   - **Key-list mode**: `SELECT * FROM issues WHERE project_id IN (3, 7, 12, ...)` — listing the specific project IDs it learned from step 6. Good when the set is small.
   - **Subquery pushdown mode**: `SELECT * FROM issues WHERE project_id IN (SELECT id FROM projects WHERE active = true)` — pushing the entire filter logic to Postgres as a single query. Good for large sets and initial snapshots.

8. The issues rows flow forward through the semi-join. For each issue row, the semi-join checks: does `project_id` exist in my right-side index? If yes, emit the row. If no, drop it. (All should match, since the up-query was constructed to fetch only matching rows.)

9. Rows flow through FanOutAttach → Consolidate → SinkWrite. The client gets its initial snapshot: all issues belonging to active projects.

### Live maintenance: a project is deactivated

A user sets project #7 to `active = false`. Postgres writes an UPDATE:

1. The **projects source controller** decomposes the UPDATE:
   - `-1` of old row: `{id:7, name:"Alpha", active:true}`
   - `+1` of new row: `{id:7, name:"Alpha", active:false}`

2. Both diffs flow through the **filter** (`active = true`):
   - The `-1` (old row, `active=true`) **passes**.
   - The `+1` (new row, `active=false`) is **dropped**.

3. Only the `-1` reaches the **semi-join's right side**. The semi-join updates its right-side index: project #7 is no longer active.

4. The semi-join now knows that all issues with `project_id = 7` should be retracted. It emits `-1` diffs for each issue row it previously passed through for project #7. (It tracks enough left-side state to know which issue rows it emitted.)

5. These `-1` diffs flow through FanOutAttach → Consolidate → SinkWrite.

6. SinkWrite classifies each `-1` as a **delete** on the wire protocol. The client removes those issues from its view.

The issues table didn't change at all. But because the _projects_ table changed, the semi-join correctly computed that those issues should leave the shape.

### Live maintenance: a new issue is added

A user creates a new issue for project #3 (which is active):

1. The **issues source controller** converts the INSERT to a `+1` diff:
   - `+1`: `{id:99, title:"New bug", project_id:3}`

2. The `+1` reaches the **semi-join's left side**. The semi-join checks: does `project_id = 3` exist in my right-side index?
   - **Yes** → emit the `+1` downstream. The issue belongs to an active project.
   - **No (miss)** → the semi-join doesn't have project #3 in its index. This could mean project #3 isn't active, or it could mean the index is incomplete (partial state). The semi-join issues a **point up-query** to the projects side: "does project #3 exist and is it active?" Once answered, it processes the issue row accordingly.

3. If emitted, the `+1` flows through FanOutAttach → Consolidate → SinkWrite → client sees a new issue appear.

---

## How the two cases compare

| Aspect                         | Simple shape                                | WHERE IN (subquery) shape                                                                               |
| ------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Tables involved                | 1                                           | 2                                                                                                       |
| Graph operators                | filter → fanout → sink                      | filter + semi-join → fanout → sink                                                                      |
| Initial snapshot               | Single up-query to one source               | Chained up-queries: first the right side (projects), then dependent up-query for the left side (issues) |
| Live changes to filtered table | Filter drops/passes diffs                   | Semi-join drops/passes diffs based on right-side index                                                  |
| Live changes to "other" table  | N/A                                         | Semi-join updates its right-side index and emits/retracts left-side rows accordingly                    |
| State required                 | Reverse index for fanout                    | Semi-join right-side index + minimal left-side tracking + reverse index for fanout                      |
| Up-query on miss               | Source controller queries Postgres directly | May cascade: semi-join miss → dependent up-query to other source                                        |

---

## The multiset diff model — why it matters

The `+1/-1` model is not just an implementation detail. It's what makes the algorithm compositional:

- **Filters** are trivial: pass or drop each diff independently. A `-1` that passes the filter correctly retracts a previously-passed `+1`.
- **Joins / semi-joins** work on diffs: a `-1` on the right side of a semi-join triggers `-1` retractions of all matching left-side rows that were previously emitted.
- **Consolidation** cancels `+1` and `-1` pairs for the same row: if a row is retracted and re-inserted at the same version, the net effect is zero (no client-visible change).
- **The sink** uses state transitions (`none → row` = insert, `row → none` = delete, `row_a → row_b` = update) to classify diffs into wire protocol operations. It never needs to know _why_ a diff happened.

This model extends naturally to aggregates, group-by, and other algebraic operators in the future — they all compose over `+1/-1` diffs.

---

## The up-query round-trip — step by step

Every data fetch (initial snapshots, join misses, eviction recovery) follows the same pattern:

```
Step 1: An operator detects missing state
        It retains its Timely capability (prevents frontier advancement)
        It creates an UpQuery with a structured predicate

Step 2: The up-query travels BACKWARD through the graph
        Each operator on the path augments the predicate:
          filter  → adds AND clause
          join    → selects query-back side
          fanout  → strips recipient info
        The up-query arrives at the source controller

Step 3: The source controller compiles the predicate to SQL
        It runs the query against Postgres
        It captures a version snapshot marker (LSN) so it knows
        where the result fits in the replication stream

Step 4: Response rows flow FORWARD through the normal graph
        Tagged with the up-query ID
        Each operator processes them through its normal logic
        (filters filter, joins look them up, fanout tags recipients)

Step 5: The requesting operator matches response rows to its pending state
        Clears the pending tracking
        Drops the Timely capability
        The frontier advances
        Data becomes stable
```

This is the same mechanism for a simple snapshot, a join miss, and a recovery after eviction. One path, one set of operators, one set of correctness invariants.
