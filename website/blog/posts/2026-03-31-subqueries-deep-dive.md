---
title: 'Expressive subqueries without resyncs — the engineering deep dive'
description: >-
  A deep dive into how we rebuilt Electric's subquery support — DNF decomposition, splice-point move handling, reverse-indexed stream routing, and oracle testing for correctness.
excerpt: >-
  We shipped a major upgrade to Electric's subquery support. More expressive cross-table filtering, no unnecessary resyncs when data moves in and out of shapes. This post dives into the engineering.
authors: [rob, icehaunter, balegas]
image: '/img/blog/subqueries/header.jpg'
tags: [electric, subqueries, sync, engineering]
outline: [2, 3]
post: true
published: true
---

[Subqueries](/docs/guides/shapes#subqueries) are a key feature of Electric's [Postgres Sync](/primitives/postgres-sync), enabling cross-table filtering when syncing [subsets of data](/docs/guides/shapes) into your apps.

With [v1.X](#) we've shipped a major upgrade to subqueries that makes them more expressive and powerful. Supporting more real-world data loading patterns and solving edge cases where data moving into and out of shapes caused unnecessary re-syncing.

This post dives into the engineering details and shows how we approached the problem with techniques including [DNF decomposition](#arbitrary-expressive-subqueries-via-dnf-decomposition) and [multi-timeline reverse indexes](#replication-stream-routing-with-reverse-indexes). And how we used our [Postgres oracle tests](#oracle-testing-for-correctness) to verify correctness and consistency.

> [!Warning] ✨&nbsp; Try it now
> [Read the docs](/docs/guides/shapes#subqueries), the [release notes](#) <!-- ASSET: link to release when version confirmed --> and the [move-in move-out visualiser](#) demo app<!-- ASSET: link to demo app when built -->.

<!-- ASSET: embed demo video here -->

<!-- ============================================================
     SITUATION / COMPLICATION
     ============================================================ -->

<!-- STRUCTURAL: Establish the shared reality then introduce the tension.
     Tone: matter-of-fact, then make the reader lean in. -->

<!-- ETHOS: Open with the real user story — a production app (HL) where every
     task addition triggered a full resync of all their data. Describe the
     pattern concretely enough that readers with similar apps recognise
     themselves. Keep anonymised. -->

## Understanding subqueries

Subqueries have been the most-requested feature in Electric since we introduced our sync model using shapes. Today we extend the query capabilities of our sync engine with arbitrary `WHERE` clauses across related tables.

A shape in Electric is a table plus a `WHERE` clause — the unit of partial replication that a client subscribes to. Subqueries extend that primitive across the schema. Where a plain `WHERE` clause picks rows out of one table, a subquery lets the clause reach into another table to decide who belongs, which is what most applications actually need: the documents a particular user can see, the tasks for projects that haven't been archived, the comments on issues belonging to this quarter's team. The membership of those sets lives in other tables, and those rows move.

`WHERE user_id IN (SELECT user_id FROM memberships WHERE org_id = $1)` says "the users in my organisation," and patterns like it cover most of how relational application data wants to be loaded. As a static query this is unremarkable. The interesting part starts the moment somebody joins the org — because the clause was true for one set of users a second ago and is true for a different set now, and getting from one to the other without throwing away everything in between is the problem this post is about.

<!-- COMPLICATION -->

### Previous limitations

Our previous subquery implementation handled the simplest case well, but the corners were sharp. A shape was allowed one subquery and a narrow shape of boolean logic around it; anything richer — multiple subqueries, real `AND`/`OR` combinations, negated dependencies, the expressions you reach for the moment you try to model authorisation — would invalidate on a dependency change and return a 409, forcing the client to discard its local copy and resync from scratch.

That isn't tolerable at any size. A resync means refetching data from the server and additional latency — every time somebody three tables away makes a small change. The shape was doing exactly what we'd built it to do. We just hadn't built it to do enough.

So we rebuilt it.

<!-- QUESTION (implicit in prose): How do you make subqueries expressive enough
     for real-world use AND handle move-in/move-out efficiently at every point
     in the replication stream? -->


## Arbitrary expressive subqueries via DNF decomposition

<!-- STRUCTURAL: First core technical section. Set up what changed for the user
     (expressiveness), then dive into the DNF mechanics. Reader should
     understand both what they can now do and why DNF is the right
     decomposition. -->

A shape's `WHERE` clause can now combine multiple subqueries, mix them with regular predicates, and use the full set of boolean operators — `AND`, `OR`, `NOT IN` — across any combination of dependencies. You can model your auth system using shapes:

```sql
-- Documents I own, or that are shared with me
WHERE owner_id = $1
   OR id IN (SELECT document_id FROM document_shares WHERE shared_with = $1)

-- Tasks in my team's projects, except ones I've hidden
WHERE project_id IN (SELECT id FROM projects WHERE team_id = $1)
  AND id NOT IN (SELECT task_id FROM hidden_tasks WHERE user_id = $1)

-- Comments on issues belonging to tasks in my project
WHERE issue_id IN (
  SELECT id FROM issues WHERE task_id IN (
    SELECT id FROM tasks WHERE project_id = $1
  )
)
```

### Matching changes in constant time

Every change replicated from Postgres has to be matched against every shape that could possibly contain it. With thousands of concurrent shapes, the budget for that work is small — to keep throughput flat as shape counts grow, matching needs to be effectively constant time per change.

Electric meets this budget by indexing the `WHERE` clause of every shape rather than evaluating it on the hot path. The matching engine carries a tree of conditions and a small set of index types tuned to common predicate patterns. When a change arrives, the engine asks the indexes which shapes care about the values in this row, and the answer comes back as a hash lookup.

<!-- ASSET: indexed shapes diagram — see ```diagram block below for the spec -->

````
```diagram
id: indexed-shapes

A change carrying a value flows into an index for the column it hits. The
index has one entry per distinct value the engine has seen in registered
shapes, and only the entry matching the incoming change's value is activated.
From the activated entry, lines fan out to the shapes that registered against
it. Other shapes — registered against other entries in the same index — sit
unconnected for this lookup.

The point: a single hash lookup picks one entry, and the entry's branches
reach a subset of all registered shapes. Throughput stays flat as the total
shape count grows, because the engine touches only the matched ones.
```
````

The structure of that index tree is where DNF earns its place. A tree of indexed conditions is naturally a disjunction of conjunctions: each `AND`-chain is a path through the indexes that narrows the candidate set step by step, and each `OR` is an independent path that contributes its own candidates. Disjunctive normal form — a flat `OR` of `AND`s — is the canonical shape that maps onto this architecture exactly. Compile any boolean expression to DNF first, and every disjunct becomes an independent indexed path; arbitrary boolean structure becomes routable in constant time without changing the engine underneath.

<!-- ASSET: Rob's diagram showing DNF decomposition of a complex where clause
     into disjuncts, with annotation showing which disjuncts are affected by
     a given dependency change — see ```diagram block below for the spec -->

````
```diagram
id: dnf-decomposition

A complex WHERE clause with OR (e.g. "active AND (owner_id = $1 OR
shared_with = $1)") is decomposed into DNF disjuncts. Each disjunct
registers as its own path inside the matching engine's index. Both
disjuncts share the same column of registered shapes; different disjuncts
reach different subsets of that column.

The two disjuncts should be visually distinct — different colours, or
different line styles — so the reader can see which shapes each one
reaches. Some shapes will be reached by D1, others by D2, others by
neither (those belong to other queries' indexed paths). Interleave the
matched shapes through the column rather than clustering them by disjunct.

The point: arbitrary boolean structure compiles down to independent indexed
paths over the same shape population, with no algorithmic change to the
matching engine itself.
```
````

The matching engine didn't need a new algorithm to support nested `OR`s and negations. It needed every shape's `WHERE` clause delivered in a form the existing indexes already knew how to handle.

<!-- PLACEHOLDER: Rob to fill in specifics of the compilation pipeline, edge
     cases, and how the decomposer works in practice -->

<!-- ASSET: Rob's diagram of the compilation pipeline if available -->

### Handling negation

<!-- PLACEHOLDER: Rob to write about the approach to NOT, what's supported,
     what falls back to 409/resync, and why -->

DNF resolves negation at compile time. De Morgan's law pushes `NOT` down to the leaves of the boolean tree, so after decomposition every condition carries a single fixed polarity — positive (`IN`) or negated (`NOT IN`). The engine stores polarity as a flag on each indexed path and subscribes to the corresponding event stream: joins for positive, exits for negated.

Within a shape, a single dependency can't appear with both polarities. `x IN sq AND x NOT IN sq` and `(x IN sq) OR (x NOT IN sq)` are both contradictions and get rejected at registration. Different dependencies can have different polarities — `(x IN A) OR (x NOT IN B)` is fine, each compiling to its own indexed path.


## Move-in and move-out without resync

<!-- STRUCTURAL: This is the money section — the thing that makes the biggest
     practical difference. Start with the user-facing impact (no more
     resyncs), then explain the splice model. Keep mechanics as scaffolding
     for Rob to fill in. -->

When a dependency changes, rows enter or leave the shape. Adding a user to an organisation brings hundreds of documents into their stream; archiving a project drops its tasks. The previous implementation responded to either event with a 409 and a full resync. The new one queries Postgres for the affected rows at the dependency change's LSN, splices the result into the live stream, and continues — clients see the new rows arrive in order without losing their existing state.

### The splice model

A shape's new rows live in Postgres at some LSN. The Electric server issues a catch-up query at that LSN to fetch them while the live stream keeps producing changes. The server buffers live transactions during the catch-up, then merges the catch-up rows in at their LSN and replays the buffered transactions on top.

The catch-up rows arrive at the LSN where they would have been visible to a fresh query, and the changes that landed during the catch-up follow in order. The shape's clients see one continuous timeline.

<!-- PLACEHOLDER: Rob to explain the splice boundary mechanics — how the
     snapshot metadata and LSN tracking ensure consistency -->

<!-- ASSET: splice timeline diagram — see ```diagram block below for the spec -->

````
```diagram
id: splice-model

The Electric server handles a move-in by issuing a catch-up query against
Postgres, splicing the resulting rows into the live WAL stream, and emitting
a single ordered output to the client.

The Electric server should appear as a container with two operations inside:
a Move step that runs the catch-up query at LSN N, and a Splice step that
merges the catch-up rows with the buffered live WAL. Postgres feeds two
inputs: the catch-up rows from the query, and the live WAL from replication.
The client receives a single stream from the server, ordered as
"... N-1 → N + rows → N+1 ...".

The point: the splice is server-side. The client never sees the buffering
window; it sees a continuous LSN-ordered stream with the move-in rows
arriving at the right point.
```
````

### Move-in planning with DNF

Most dependency changes touch a single disjunct. When a user joins an organisation, only the disjunct that depends on `org_id` needs new rows; the others are unaffected. DNF makes that targeted: each disjunct's predicates form a single, plannable SQL query, so the catch-up runs against just the rows that newly satisfy the changed disjunct.

The engine compiles each disjunct into a parametrised query at registration time. When a dependency moves, it picks the disjuncts that depend on the changed value, binds the new parameters, and runs the query at the dependency's commit LSN. The result is a row set scoped to those disjuncts, not a re-evaluation of the full WHERE clause.

<!-- PLACEHOLDER: Rob to walk through a concrete example, e.g.
     `WHERE x IN sq1 OR y IN sq2` when sq1 gains a value -->

<!-- ASSET: Rob's annotated SQL or diagram showing the generated move-in query
     for a concrete example -->

### Move-out handling

Move-outs are the inverse: a dependency change drops rows from the shape. A user removed from an organisation, a project archived, a share revoked. The split between "row no longer matches" and "row was deleted" matters — the client needs a delete event in the first case (the row still exists in Postgres but isn't ours anymore) and nothing else in the second.

The server doesn't re-deliver the affected rows. It emits a small control message — a move-out broadcast — naming the position and the tag hash that no longer applies. The client flips that position to inactive for every row carrying the matching tag and re-evaluates membership locally. Rows where no disjunct still matches produce a synthetic delete to the application; rows where another disjunct still matches stay in the shape unchanged.

<!-- PLACEHOLDER: Rob to add detail on the serialisation guarantees — one move
     at a time per shape, queue ordering -->

### Tags and active_conditions

Every row in a subquery shape arrives with two arrays. `tags` is per-disjunct: each disjunct carries an MD5 hash for every position it uses, computed from the shape handle and the row's column values at that position. `active_conditions` is per-position: one boolean saying whether each predicate is currently true for this row.

When a dependency moves, the server emits a move broadcast — a small control message naming a position and a hash. The client keeps an inverted index from `(position, hash)` to row keys; on a broadcast, it flips `active_conditions[position]` for all rows whose tag at that position matches. The lookup is O(1) per row. Membership re-evaluates with boolean algebra: a row stays in the shape if any disjunct has all its positions active. Rows that no longer satisfy any disjunct trigger a synthetic delete.

A row's tags are computed by the server when the row enters the shape, and recomputed if its column values change. After that, every dependency change is a few bytes on the wire — the move broadcast — and an in-memory boolean flip on the client.

<!-- PLACEHOLDER: Rob to add a concrete example showing tag/active_conditions
     state through a move-in then move-out sequence -->

<!-- ASSET: Rob's diagram or table showing a row's tags and active_conditions
     evolving through a sequence of moves -->


## Replication stream routing with reverse indexes

<!-- STRUCTURAL: The performance/scaling section. Previous sections explain
     correctness — this explains how we make it fast. Shorter section. -->

The matching engine has to answer two different questions about every shape with a subquery. On the hot path, when a change arrives from Postgres, the engine needs to know which shapes might be affected; the answer can be approximate, since downstream verification rejects false positives. Separately, when evaluating a shape's `WHERE` clause against a candidate row, the engine needs to know whether a specific value is currently in that shape's subquery view, and the answer has to be precise. Both questions hit the same underlying data: the set of values each shape's subquery currently matches.

A single ETS-backed reverse index serves both.

### Two roles, one index

Splitting these into two indexes would be the obvious move. The reason we don't is consistency. Every dependency change updates both — when a value enters a subquery's view, the routing entries that include the value and the exact-membership entries that confirm it are written together. Splitting the index would force coordination across two writes, and a window where the routing layer says "this shape cares" while the membership layer says "this shape doesn't include the value" is a window for silent inconsistency.

A single ETS write per value avoids that. Routing and membership see the same world.

### Broadening during buffering

The harder invariant lives between a dependency change and the splice that resolves it. The matching engine doesn't pause while the catch-up query runs; live changes from Postgres keep arriving and have to be routed somewhere. We resolve this by broadening the index in advance — making it more permissive than steady-state truth — so that no change relevant to the eventual post-splice membership is missed during the window.

The asymmetry is what makes this safe. False positives during buffering are absorbed by the splice's `views_before_move` / `views_after_move` mechanism — over-routed transactions get evaluated against the correct view for their position relative to the splice boundary, and rows that don't actually belong are filtered out. False negatives — changes routed past a shape that should match but isn't yet recognised in the index — would be silent correctness bugs, lost updates the splice can't recover. So the rule is: when in doubt, broaden. Tighten only when it's safe.

The specifics fall out of polarity. A positive move-in adds the new value to the index at buffer start, before the catch-up query runs, so concurrent inserts referencing it are routed correctly. A positive move-out keeps the old value in the index until the splice completes, so concurrent updates that still match under `views_before_move` continue to reach the shape. Negated dependencies invert the rule — adding a value to a `NOT IN` index narrows the set rather than broadens it, so the timing flips. The result is one index that's always a superset of the truth during buffering, and the splice that converges it back to exact at the boundary.

<!-- PLACEHOLDER: Rob to add detail on the fallback path for shapes not yet
     ready or with unsupported expressions — three confidence levels in the
     brief: seeded shapes get O(1) exact lookups; unseeded shapes are
     conservatively included in the candidate set; error fallback returns
     all shapes. Worth a paragraph if it fits. -->

<!-- NOTE: Rob — the similarity to d2ts / incremental view maintenance is
     worth drawing out here if it fits naturally. The "materialised views at
     multiple timelines" angle. -->


## Oracle testing for correctness

<!-- STRUCTURAL: Shifts gear from "how it works" to "how we know it works".
     Software engineering craft content — developers love this. Tone: pride
     in methodology, practical lessons. -->

Distributed systems are unusually hard to test. Electric runs as a server processing the Postgres replication stream, dispatching to per-shape consumers, each with its own state machine, holding move-in queries open against Postgres while live transactions stream past. The space of inputs is combinatorial — any boolean structure of WHERE clauses, any ordering of mutations, any timing between transactions and the catch-up queries that run alongside them — and the failure modes are subtle. A bug doesn't crash the system; it produces a shape that's slightly wrong, missing one row out of ten thousand, or holding onto a row that should have left. Unit tests cover individual modules. Integration tests cover scripted scenarios. Neither catches the cases nobody thought to write.

So we built an oracle.

### Postgres as the source of truth

<!-- PLACEHOLDER: Rob to explain the oracle test harness — how tests are
     structured, how operations are generated, how comparison works -->

The principle is straightforward: for any sequence of mutations, the rows Electric materialises in a shape must exactly match the rows a fresh `SELECT ... WHERE <clause>` returns from Postgres at the same point in time. Postgres is the definition of correctness. Electric is incremental machinery that has to agree with it.

The oracle harness wires this up directly. A property-based generator produces random WHERE clauses across a 4-level hierarchy of tables — atomic predicates, single-level subqueries, multi-level subqueries, AND/OR compositions, NOT, all the structures DNF has to handle. Another generator produces random mutations: toggling active flags, reparenting rows, adding and removing tags, updating root-table columns. The harness runs hundreds of shapes in parallel, applies thousands of mutations in batches, and after each batch asks every shape: does your incremental state match what Postgres says?

If the answer is no, that's a bug.

<!-- ASSET: Rob's diagram or code snippet showing the oracle test loop:
     apply operation → incremental result → full query result → compare -->

### What the oracle catches that nothing else does

<!-- PLACEHOLDER: Rob to write about specific bugs or edge cases the oracle
     tests caught — the war stories. The more specific and honest, the better.
     What surprised you? What broke in ways you didn't expect? -->

<!-- NOTE: This section is prime "software factory" content. Readers want to
     learn the methodology AND hear the war stories. Both matter. -->

Three classes of bugs are essentially invisible to anything but property testing.

The first is combinatorial interaction. A toggle on `level_1` affects a subquery on `level_2`, which affects a subquery on `level_3`, which changes membership for a shape using `(subquery_a) OR (subquery_b AND value > 'v5')`. Nobody is going to write that test case. The generator does, by accident, hundreds of times per run.

The second is concurrency. A hundred shapes processing the same mutation stream concurrently, each with different WHERE structures, exposes races between consumer seeding, move buffering, and transactions that commit during a catch-up query. Sequential unit tests can't reach these states.

The third is regression coverage. The generator covers the full expression space the DNF compiler is meant to handle. Any change to the compiler, the splice algorithm, or the routing index that breaks any combination gets caught — not just the cases someone happened to anticipate.

The oracle isn't checking what we think correct looks like. It's checking what Postgres says correct is.

### Reproducibility

The generator is seeded deterministically. Every failure can be reproduced exactly with `mix test --include oracle --seed <seed>`, which makes shrinking from a 500-mutation failure to a minimal repro tractable. Most of the bugs caught during development surfaced first in oracle runs and were fixed against the seed that found them.

This methodology generalises. Any system that claims to be incrementally equivalent to a batch computation has a natural oracle in the batch version. We use Postgres because Postgres is what we're shadowing, but the pattern works anywhere the ground truth is computable independently of the system under test.


## Next steps

- Try it now: subqueries work with any where clause — see the
  [shapes guide](/docs/guides/shapes#subqueries-experimental) for syntax and
  examples
- <!-- ASSET: Link to demo app visualising move-in/move-out behaviour and
     the log — spec: show shape log, data flowing in/out incrementally,
     contrast with full resync -->
- Subquery support ships in Electric vX.X — upgrade and start using richer
  cross-table filtering in your shapes
- Works with [TanStack DB 0.6](/blog/2026/03/25/tanstack-db-0.6-app-ready-with-persistence-and-includes)'s
  query-driven sync for progressive data loading with relational filtering
- Join the conversation on [Discord](https://discord.electric-sql.com) — we'd
  love to hear what data loading patterns you're building


***

<!-- DELETE EVERYTHING BELOW THIS LINE BEFORE PUBLISHING -->

<!-- ==========================================================
     META — for the author, not the reader
     ========================================================== -->

<!-- INTENT

     What is this post about?
     Subqueries are a key feature of Electric for cross-table filtering when
     syncing data subsets. Major upgrade: more expressive, handles move-in/out
     without resync. Deep engineering using DNF decomposition and multi-timeline
     reverse indexes. Post dives into engineering details and oracle testing.

     What's interesting about it?
     The algorithms are insanely cool engineering. The affordances — arbitrary
     subqueries, no unnecessary resyncs — are major unlocks for real-world
     app development. Making your apps faster.

     What's the reader takeaway?
     They want to try the new subquery features. Electric is battle-tested,
     advanced, production-ready engineering.

     What are the CTAs?
     Shapes guide docs. Try any where clause. Demo app visualising
     move-ins/move-outs.

     Why are we the right people to write this?
     Built Electric. Team has 6 PhDs in distributed databases, invented CRDTs.
     World experts on this.
-->

<!-- TITLE BRIEF
     Direction: sentence case, lead with the feature not the technique.
     Something like "How we rebuilt subqueries in Electric" or "Making
     subqueries work for real-world apps". Should signal technical depth
     without being jargon-first. Avoid "announcing" framing — this is an
     engineering post not a release post.
-->

<!-- DESCRIPTION BRIEF (SEO, no HTML)
     Should convey: Electric's subquery support has been significantly
     upgraded — more expressive where clauses, efficient move-in/move-out
     handling without resyncs. Post covers the engineering: DNF decomposition,
     splice-point move handling, reverse-indexed stream routing, oracle
     testing. Target readers searching for partial replication, cross-table
     sync filtering, incremental view maintenance.
-->

<!-- EXCERPT BRIEF (blog listing card, max 3 short sentences)
     Lead with what changed for users (richer subquery support, no unnecessary
     resyncs), hint at the engineering depth (DNF, oracle testing), invite the
     reader into the technical details. Match length of existing Electric blog
     excerpts.
-->

<!-- IMAGE PROMPT
     Concept: abstract visualisation of data flowing through a filter /
     decomposition — could represent a where clause being split into DNF
     disjuncts with data streams routing through them.
     Dark theme background.
     Brand colours: #D0BCFF purple, #00d2a0 green, #75fbfd cyan.
     16:9, ~1536x950px, center-center composition.
     For a detailed DALL-E prompt, use /blog-image-brief.
-->

<!-- ASSET CHECKLIST
     [ ] Code examples: before/after subquery where clauses (§1)
     [x] DNF decomposition diagram — spec embedded inline as ```diagram block (§2)
     [x] Indexed shapes / matching engine diagram — spec embedded inline as ```diagram block (§2)
     [ ] Rob's diagram: compilation pipeline (§2)
     [x] Splice timeline diagram — spec embedded inline as ```diagram block (§3)
     [ ] Rob's annotated SQL: generated move-in query (§3)
     [ ] Rob's diagram/table: tags + active_conditions through moves (§3)
     [ ] §4 diagram (optional) — could visualise the broadening invariant:
         the index as a superset during buffering, converging at splice boundary
     [ ] Rob's diagram/code: oracle test loop (§5)
     [ ] Demo app: move-in/move-out visualiser (Next steps) — NEEDS BUILDING
     [ ] User story evidence: HL, anonymised (Situation) — REMOVED FROM PROSE; decide whether to reintroduce
     [ ] Version number for the release — TBD
     [ ] TanStack DB 0.6 post link — confirm correct URL
     [ ] Author config: add robacourt and balegas to blog author config if new
-->

<!-- OPEN QUESTIONS
     - Version number for the release?
     - User story anonymised as HL — currently removed from prose at author's
       request; reintroduce in opening or leave out?
     - Demo app spec: visualise shape log showing move-ins/move-outs
       incrementally vs full resync — who builds this?
     - How much detail on NOT support? "Falls back to 409 for now" or more?
     - Rob's existing diagrams — which ones map to which sections?
     - d2ts / incremental view maintenance angle — include or cut?
     - TanStack DB 0.6 post URL — is it published and correct?
-->

<!-- TYPESETTING CHECKLIST
     [ ] Non-breaking spaces where appropriate to avoid widows/orphans
     [ ] Title uses sentence case, not Title Case
     [ ] Check title, image, and general post at different screen widths
     [ ] No LLM tells: "it's worth noting", "importantly", "in conclusion",
         "let's dive in", "at its core", "in today's landscape"
-->
