---
title: 'Expressive subqueries with zero resyncs — the engineering deep dive'
description: >-
  A deep dive into how we rebuilt Electric's subquery support — DNF decomposition, splice-point move handling, reverse-indexed stream routing, and oracle testing for correctness.
excerpt: >-
  We shipped a major upgrade to Electric's subquery support. More expressive cross-table filtering, no unnecessary resyncs when data moves in and out of shapes. This post dives into the engineering.
authors: [rob]
image: ''
tags: [electric, subqueries, sync, engineering]
outline: [2, 3]
post: true
published: false
---

Subqueries are a key feature of Electric for cross-table filtering when syncing
data subsets into your apps. We've shipped a major upgrade that makes subqueries
much more expressive, matching more real-world data loading patterns. And solves
edge cases where data moving into and out of shapes caused unnecessary
resyncing. Using some advanced algorithmic techniques including DNF
decomposition and multi-timeline reverse indexes.

This post dives into the engineering details and shows how we approached the
problem and used our Postgres oracle tests to verify correctness and
consistency.

> [!Warning] ✨&nbsp; Try it now
> - [Shapes guide — subqueries](/docs/guides/shapes#subqueries-experimental)
> - [Demo app — move-in/move-out visualiser](#) <!-- ASSET: link to demo app when built -->
> - [GitHub release vX.X](#) <!-- ASSET: link to release when version confirmed -->

<!-- ============================================================
     SITUATION / COMPLICATION
     ============================================================ -->

<!-- STRUCTURAL: Establish the shared reality then introduce the tension.
     Tone: matter-of-fact, then make the reader lean in. -->

<!-- ETHOS: Open with the real user story — a production app (HL) where every
     task addition triggered a full resync of all their data. Describe the
     pattern concretely enough that readers with similar apps recognise
     themselves. Keep anonymised. -->

- Electric syncs subsets of Postgres into local apps using shapes — table +
  where clause + optional columns
- Real-world apps have relational data; you often need to filter what you sync
  based on related tables
- Subqueries solve this:
  `WHERE user_id IN (SELECT user_id FROM memberships WHERE org_id = $1)`
- This is how you get "sync the users in my org" or "sync tasks for active
  projects" — the bread and butter of app data loading
- When the underlying data changes — a user joins an org, a project gets
  archived — rows need to move in and out of shapes dynamically

<!-- COMPLICATION -->

- Our previous subquery support handled the common case well but was
  constrained: single subquery per shape, limited boolean logic
- The really hard problem: when related data changes and rows move in/out, how
  do you update the shape incrementally without resending everything?
- You need to know exactly which rows are newly included or excluded, at a
  precise point in the replication stream, without race conditions or duplicates
- Real-world apps with complex filtering logic and dynamic relational data were
  hitting these limitations, causing unnecessary resyncs and data reloading

<!-- QUESTION (implicit in prose): How do you make subqueries expressive enough
     for real-world use AND handle move-in/move-out efficiently at every point
     in the replication stream? -->


## Arbitrary expressive subqueries via DNF decomposition

<!-- STRUCTURAL: First core technical section. Set up what changed for the user
     (expressiveness), then dive into the DNF mechanics. Reader should
     understand both what they can now do and why DNF is the right
     decomposition. -->

- Previously limited to a single subquery per shape with constrained boolean
  logic
- Now supports arbitrary combinations: `WHERE x IN sq1 OR y IN sq2`, `AND`,
  `NOT IN`, nested expressions
- Show before/after examples of what you can now express

<!-- ASSET: Code examples showing before (limited) vs after (expressive)
     subquery where clauses — pull from shapes guide + real user patterns -->

### Why DNF?

- The core insight: a single subquery move maps cleanly to one "what newly
  entered?" query
- With `WHERE x IN sq1 OR y IN sq2`, a move in sq1 should only fetch rows
  newly included by sq1 that weren't already present via sq2
- DNF gives the right planning unit — each disjunct is one independent reason
  a row can be in a shape
- A move only affects the disjuncts that reference the changed dependency
- Move-in queries can be scoped to just those disjuncts

<!-- ASSET: Rob's diagram showing DNF decomposition of a complex where clause
     into disjuncts, with annotation showing which disjuncts are affected by
     a given dependency change -->

### DNF compilation

- Where clause is normalised to positive DNF:
  `(term AND term) OR (term AND term) OR ...`
- Each term is either a plain row predicate or a positive `IN (SELECT ...)`
  subquery predicate
- The shape keeps compiled metadata: disjuncts, position count,
  dependency-to-position mapping

<!-- PLACEHOLDER: Rob to fill in specifics of the compilation pipeline, edge
     cases, and how the decomposer works in practice -->

<!-- ASSET: Rob's diagram of the compilation pipeline if available -->

### The NOT problem

- NOT with subqueries is genuinely hard — negation breaks the clean
  disjunct-scoping model

<!-- PLACEHOLDER: Rob to write about the approach to NOT, what's supported,
     what falls back to 409/resync, and why -->


## Efficient move-in/move-out without resync

<!-- STRUCTURAL: This is the money section — the thing that makes the biggest
     practical difference. Start with the user-facing impact (no more
     resyncs), then explain the splice model. Keep mechanics as scaffolding
     for Rob to fill in. -->

- When related data changes, rows move in and out of shapes — a user joins an
  org, a project gets archived
- Previously this triggered a full resync — client gets a 409, reloads
  everything
- Now Electric computes exactly which rows are newly included or excluded and
  streams just those changes

### The splice model

- Core idea: buffer replication stream changes while running a precise move-in
  query, then splice the results into the stream at exactly the right point

<!-- PLACEHOLDER: Rob to explain the splice boundary mechanics — how the
     snapshot metadata and LSN tracking ensure consistency -->

<!-- ASSET: Rob's diagram showing the timeline — buffering starts, move-in
     query runs in repeatable-read snapshot, splice point found,
     pre-boundary/query-rows/post-boundary written in order -->

### Move-in planning with DNF

- A move in dependency D with new values V: identify impacted disjuncts, build
  a candidate predicate scoped to just those disjuncts, exclude rows already
  present via other disjuncts
- The query is narrow — only fetches rows that are genuinely new to the shape

<!-- PLACEHOLDER: Rob to walk through a concrete example, e.g.
     `WHERE x IN sq1 OR y IN sq2` when sq1 gains a value -->

<!-- ASSET: Rob's annotated SQL or diagram showing the generated move-in query
     for a concrete example -->

### Move-out handling

- Move-outs are simpler — emit position-aware broadcasts, clients re-evaluate
  inclusion locally
- No query needed; the client already has the row and just needs updated
  active_conditions

<!-- PLACEHOLDER: Rob to add detail on the serialisation guarantees — one move
     at a time per shape, queue ordering -->

### Tags and active_conditions

- Rows carry per-disjunct tags and per-position active_conditions booleans
- Clients evaluate inclusion: for each tag, AND the active_conditions at its
  positions, OR the results across tags
- Move broadcasts update active_conditions for rows already on the client
  without resending the row data

<!-- PLACEHOLDER: Rob to add a concrete example showing tag/active_conditions
     state through a move-in then move-out sequence -->

<!-- ASSET: Rob's diagram or table showing a row's tags and active_conditions
     evolving through a sequence of moves -->


## Replication stream routing with reverse indexes

<!-- STRUCTURAL: The performance/scaling section. Previous sections explain
     correctness — this explains how we make it fast. Shorter section. -->

- When a change arrives from Postgres, Electric needs to figure out which
  shapes it's relevant to
- With many shapes using subqueries, naively evaluating every shape's where
  clause for every change doesn't scale
- We use a reverse index backed by ETS that maps typed values to shape
  handles — a single lookup finds candidate shapes instead of iterating

### How the reverse index works

<!-- PLACEHOLDER: Rob to explain the index structure and lookup mechanics -->

- For positive predicates (`x IN sq`): look up the value, get shapes whose
  membership contains it
- For negated predicates (`x NOT IN sq`): complement at read time — all
  negated shapes minus those containing the value
- Candidates are verified against the full where clause to handle non-subquery
  branches

<!-- ASSET: Rob's diagram showing a change arriving, value extracted, reverse
     index lookup, candidate shapes returned -->

### Consistency during moves

- During a move-in, the index needs to be broad enough to capture changes
  relevant to both pre-splice and post-splice views
- For positive dependencies: store the union of before and after membership
- For negative dependencies: store the intersection
- This may over-route changes, but correctness is enforced downstream by
  `convert_change` using the right subquery view for the change's position
  relative to the splice boundary

<!-- PLACEHOLDER: Rob to add detail on the fallback path for shapes not yet
     ready or with unsupported expressions -->

<!-- NOTE: Rob — the similarity to d2ts / incremental view maintenance is
     worth drawing out here if it fits naturally. The "materialised views at
     multiple timelines" angle. -->


## Oracle testing for correctness

<!-- STRUCTURAL: Shifts gear from "how it works" to "how we know it works".
     Software engineering craft content — developers love this. Tone: pride
     in methodology, practical lessons. -->

- Incremental view maintenance with splice points and multi-timeline routing
  is hard to get right
- Edge cases are combinatorial — boolean logic × move timing × concurrent
  changes × multiple dependencies
- Unit tests can't cover the state space; you need a fundamentally different
  testing approach

### Postgres as oracle

- The core idea: Postgres already knows the right answer — run the full query
  and compare
- For any sequence of operations, the oracle runs the equivalent `SELECT`
  against the current database state
- Our incremental system must produce exactly the same result set at every
  point

<!-- PLACEHOLDER: Rob to explain the oracle test harness — how tests are
     structured, how operations are generated, how comparison works -->

<!-- ASSET: Rob's diagram or code snippet showing the oracle test loop:
     apply operation → incremental result → full query result → compare -->

### What we found

<!-- PLACEHOLDER: Rob to write about specific bugs or edge cases the oracle
     tests caught — the war stories. The more specific and honest, the better.
     What surprised you? What broke in ways you didn't expect? -->

<!-- NOTE: This section is prime "software factory" content. Readers want to
     learn the methodology AND hear the war stories. Both matter. -->


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
     [ ] Rob's diagram: DNF decomposition into disjuncts (§1)
     [ ] Rob's diagram: compilation pipeline (§1)
     [ ] Rob's diagram: splice timeline (§2)
     [ ] Rob's annotated SQL: generated move-in query (§2)
     [ ] Rob's diagram/table: tags + active_conditions through moves (§2)
     [ ] Rob's diagram: reverse index lookup flow (§3)
     [ ] Rob's diagram/code: oracle test loop (§4)
     [ ] Demo app: move-in/move-out visualiser (Next steps) — NEEDS BUILDING
     [ ] User story evidence: HL, anonymised (Situation) — NEEDS SOURCING
     [ ] Version number for the release — TBD
     [ ] TanStack DB 0.6 post link — confirm correct URL
     [ ] Author config: add robacourt to blog author config if new
-->

<!-- OPEN QUESTIONS
     - Version number for the release?
     - User story anonymised as HL — confirm this is sufficient
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
