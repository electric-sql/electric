# Pattern triggers

Use this file during **phase 2 (Clarify)** of the skill. It maps phrases and structural signals from the developer's description to one of seven patterns.

## Trigger phrase table

Match case-insensitively. A single strong match is usually enough; multiple matches across patterns means ask a disambiguation question (see below).

| Phrase families in description                                                                                                                   | Suggests pattern       |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| "multiple perspectives", "specialists", "different angles", "fan out and synthesize", "analyze from different viewpoints", "N experts"           | **manager-worker**     |
| "sequential stages", "step by step", "chain stages", "preprocessing then analysis", "pipeline", "feed output to next"                            | **pipeline**           |
| "parallel", "all at once", "chunks", "divide and process", "batch", "fan out and collect", "process in parallel", "map over"                     | **map-reduce**         |
| "classify and route", "dispatch", "different types of requests", "router", "distribute to specialists", "dynamic routing"                        | **dispatcher**         |
| "shared knowledge base", "collaborative writing", "debate", "wiki", "shared state", "collective intelligence", "workers updating the same board" | **blackboard**         |
| "monitor", "watch", "dashboard", "react to changes", "observe and report", "event-driven response", "track another entity"                       | **reactive-observers** |
| (none of the above; no other entities involved; single LLM loop)                                                                                 | **single-agent**       |

## Disambiguation flow

When two or more patterns tie (or the description gives no coordination signal), ask **one structural question** per message. Stop as soon as the pattern is unambiguous.

Ask in this priority order:

1. **Spawns/coordinates other entities?** No → `single-agent`. Yes → continue.
2. **Parallel vs sequential spawning?** All at once → `map-reduce` or `manager-worker`. One after another → `pipeline`.
3. **Fixed specialist roles or dynamic types?** (Only if parallel.) Fixed set (e.g. {economic, political, social}) → `manager-worker`. Variable count / dynamic type picked at runtime → `map-reduce` (per-chunk) or `dispatcher` (per-request).
4. **Per-chunk or per-request type selection?** Per-chunk of a dataset → `map-reduce`. Per incoming request → `dispatcher`.
5. **Do multiple entities read/write the same dataset?** Yes → `blackboard` (can be layered on top of any spawn pattern).
6. **Does the entity watch another entity's stream for changes?** Yes → `reactive-observers`.

A pattern can layer on top of another — e.g. manager-worker + blackboard (workers share findings). Treat the primary pattern as the one that defines the handler shape, and note any secondary pattern as additional state/wake requirements.

## Worked examples

### Example 1 — clear single match

> "I want an agent that summarizes PRs when they change."

- Triggers matched: "when they change" → reactive-observers.
- Action: infer `reactive-observers`. Confirm with one question: _"Is there one entity per PR (that your summarizer watches), or does a single entity watch a stream of inbox messages?"_ If the former: reactive-observer watching a PR entity. If the latter: single-agent consuming inbox.

### Example 2 — ambiguous coordination

> "Break a research question into 5 subtopics, research each in parallel, merge the findings."

- Triggers matched: "in parallel", "merge" → map-reduce; "subtopics" could also read as fixed specialists.
- Action: ask _"Are the 5 subtopics fixed specialists (always the same 5 roles, e.g. economic/political/social/technical/historical) or dynamically generated per question?"_ Fixed → manager-worker. Dynamic → map-reduce.

### Example 3 — no coordination signal

> "An agent that answers questions using web search."

- Triggers matched: none for coordination.
- Action: confirm with _"Does this entity spawn or observe other entities, or is it a single LLM loop?"_ → if just a loop with tools → `single-agent`.

### Example 4 — layered patterns

> "Multiple workers research a topic and write their findings to a shared board that the manager reads to produce a final report."

- Triggers matched: "multiple workers" (manager-worker), "shared board" (blackboard).
- Action: confirm with _"Is the parent waiting for all workers to finish before synthesizing, or reacting as findings land on the board?"_ Waiting on all → manager-worker with blackboard for shared findings. Reacting live → manager-worker + blackboard with `wake: { on: "change" }` on the shared state.

## Inference output format (phase 3)

Always print the match explicitly so the developer can override:

```
Inferred pattern: map-reduce
Why: "in parallel" + "merge findings" + "per-subtopic worker" (dynamic count)
Canonical example: examples/durable-agents-playground/src/coordination/map-reduce.ts
```

If the developer overrides ("actually use blackboard"), switch without arguing — load the new pattern file and redo phase 3 for that pattern.
