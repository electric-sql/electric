# Runtime DSL Coverage Matrix

This file is the canonical planning/coverage tracker for
`packages/agents-runtime/test/runtime-dsl.test.ts`.

Current state:

- `runtime-dsl.test.ts` has `83` scenario tests.
- The full runtime suite is currently green at `256` tests.
- This file tracks:
  - what is already covered
  - what is still missing
  - which ideas we are intentionally not blessing because they encode the wrong
    orchestration pattern

## DSL Rules

- Assert full stream history wherever possible, not spot checks.
- Prefer filtered snapshots over scheduler-sensitive raw history snapshots.
- Match from the beginning of the stream; no fixed sleeps.
- Assert eager durability for spawn args, manifest rows, and initial inbox
  messages.
- Force wake boundaries when testing replay or rehydration behavior.
- Use deterministic fake assistants/tools instead of playground-specific tool
  sprawl.
- Do not normalize bad orchestration patterns into the DSL just because they are
  easy to test.

## Covered Now

### A. Standalone Assistant

- [x] `A1` spawn writes `entity_created` immediately with spawn args
- [x] `A2` spawn with `initialMessage` writes inbox history before any run
- [x] `A3` single message produces a full run history
- [x] `A4` assistant text output is reflected in final history
- [x] `A5` multiple messages produce two completed runs
- [x] `A6` agent-less entity records only inbound messages
- [x] `A7` setup state writes appear before the run history
- [x] `A8` manifest history includes the configured agent
- [x] `A9` sync tool calls appear in-order within one completed run
- [x] `A10` async tool completion preserves a single clean run history
- [x] `A11` repeated tool calls keep ordering stable and use the last result
- [x] `A12` stateful note writes persist across wakes and can be read later
- [x] `A13` failing tools close the run cleanly with durable failure history
- [x] `A14` an entity can recover from a failed tool call in a later run

### B. Spawn Mechanics

- [x] `B1` spawn creates a child entity that can receive messages
- [x] `B2` spawn with `initialMessage` writes the child history
- [x] `B3` spawn manifest history includes the resolved `entityUrl`
- [x] `B4` spawn auto-creates an observe manifest entry

### C. State Collections

- [x] `C1` `ctx.db.actions` inserts are reflected in full stream history
- [x] `C2` setup-initialized state remains visible in final history
- [x] `C3` self-authored state writes do not trigger a second run

### D. Shared State

- [x] `D1` `createSharedState` produces entity history with a manifest entry
- [x] `D2` shared-state stream exists before any writes
- [x] `D3` writes to shared state are reflected in both histories
- [x] `D4` a second entity can connect to existing shared state and read prior rows
- [x] `D5` shared-state update/delete events remain durable across wakes
- [x] `D6` multi-collection shared state stays consistent across writer/reader entities
- [x] `D7` multiple entities can contribute durable rows to the same shared collection
- [x] `D8` a later writer can overwrite a shared row and a new reader sees the latest value
- [x] `D9` a setup-registered shared-state effect fires on the first wake write and survives a later wake
- [x] `D10` separate entities can contribute to different collections in one shared state
- [x] `D11` adjacent writers on the same shared key preserve full history and last-write-wins
- [x] `D12` mutating one shared collection does not disturb reads from another collection

### E. Observation Replay

- [x] `E1` observed effects do not duplicate old child rows after parent re-wake
- [x] `E2` updating an observed row preserves a single derived row key
- [x] `E3` an observed row update is replayed as an update, not a second insert

### F. Coordination Orchestration

- [x] `F1` dispatcher routes to the requested specialist type and records the child
- [x] `F2` manager-worker spawns, observes, and later collects all perspectives in a stable order
- [x] `F3` dispatcher increments dispatch count and keeps both child rows across wakes
- [x] `F4` dispatcher records the expected status progression during a dispatch
- [x] `F5` dispatcher returns the documented placeholder when a child produces no text
- [x] `F6` `wait_for_all` before spawning perspectives returns the documented error path
- [x] `F7` manager-worker uses placeholders when every perspective child is silent
- [x] `F8` repeated `spawn_perspectives` reuses the same children and returns only the latest outputs
- [x] `F9` manager-worker records a targeted child failure and uses a placeholder only for that perspective
- [x] `F10` manager-worker can retry after a targeted failure and later collect full results
- [x] `F11` dispatcher preserves counters and child rows when a specialist fails

### G. Map-Reduce

- [x] `G1` map-reduce returns results in chunk order even when completions differ
- [x] `G2` single-chunk map-reduce still uses the orchestration path
- [x] `G3` later map-reduce runs reuse chunk children without leaking prior chunk outputs
- [x] `G4` map-reduce uses a placeholder only for a failed chunk while keeping the others

### H. Pipeline

- [x] `H1` pipeline writes its state row during the first wake before stage execution
- [x] `H2` pipeline feeds each stage the previous stage output and persists final state
- [x] `H3` pipeline status caps at `stage_5` while longer pipelines still complete
- [x] `H4` pipeline persists stage-by-stage `currentInput` updates through the run
- [x] `H5` later pipeline runs reuse stage children but reset to the newest input chain
- [x] `H6` pipeline carries a failed stage forward as placeholder input for later stages

### I. Peer Review

- [x] `I1` peer review aggregates reviewer writes through shared state
- [x] `I2` `summarize_reviews` before any reviews exist returns the empty-state path
- [x] `I3` peer review with one configured reviewer summarizes only that durable row
- [x] `I4` peer review with two configured reviewers summarizes only those durable rows

### J. Debate

- [x] `J1` debate parent reads both sides from shared state before issuing a ruling
- [x] `J2` `end_debate` before any arguments exist returns the empty-state path
- [x] `J3` debate stays partial after one side and resolves once the missing side arrives

### K. Wiki

- [x] `K1` wiki specialists accumulate shared articles that a later query can read
- [x] `K2` repeating `create_wiki` reuses existing specialists and only spawns missing subtopics
- [x] `K3` `get_wiki_status` reports complete coverage after specialist articles land
- [x] `K4` `create_wiki` rejects switching the topic on an existing wiki
- [x] `K5` `query_wiki` before any articles exist returns the empty-state message
- [x] `K6` repeating `create_wiki` with the same topic/subtopics is idempotent
- [x] `K7` `get_wiki_status` before creating a wiki reports the empty state
- [x] `K8` wiki mirrors durable child/article notification metadata
- [x] `K9` idempotent wiki recreation does not duplicate shared article rows
- [x] `K10` same-topic wiki expansion adds only the missing article and updates later query coverage

### L. Reactive Observation Flows

- [x] `L1` explicit `observe + createEffect` forwards insert, update, and delete notices
- [x] `L2` re-waking the watcher without new child changes does not duplicate prior notices
- [x] `L3` a child delete while the watcher is asleep replays as one delete notice
- [x] `L4` watching the same child twice stays deduped
- [x] `L5` one watcher can observe multiple children and preserve source attribution

## Active Backlog

### 1. Shared State

- [x] shared-state write contention on the same key from two entities in adjacent wakes
- [x] shared-state readers observing one collection while writers mutate another collection
- [ ] shared-state effect coverage for setup-time and dynamic update/delete combinations on mutable rows

### 2. Coordination Failure And Recovery

- [ ] dispatcher child failure path once dispatcher stops depending on same-wake `child.text()` aggregation
- [ ] dispatcher repeated failures across multiple wakes preserve child rows and counters
- [ ] child failure plus later replacement child on the same parent

### 3. Map-Reduce And Pipeline Edge Cases

- [x] map-reduce placeholder behavior when one chunk fails
- [x] map-reduce duplicate chunk id reuse across later wakes
- [x] pipeline stage failure semantics
- [x] pipeline later-run reset semantics after reaching `done`

### 4. Peer Review And Debate

- [ ] peer review wake-boundary summary after reviews are already durable
- [x] peer review reviewer-count variants (`1`, `2`, `3`)
- [x] debate partial state before both sides exist

### 5. Deep Researcher

- [x] spawn-time `initialMessage` coverage for researcher workers
- [x] `wait_for_results` before spawn error path
- [x] multi-child researcher isolation across wakes

### 6. Wiki Autonomy

- [ ] build-and-answer flow without a second user poke
- [ ] pending query state that resolves automatically once enough articles exist
- [ ] partial wiki answers when only some specialists have written
- [ ] explicit subtopic expansion with a later follow-up query on the same entity
- [ ] clearer parent-side high-level progress surface for observers

### 7. Observation / Effects

- [ ] invalid observe target error path
- [ ] observe-once with first-write-wins config mismatch pinned explicitly
- [ ] live `.send()` through observed handles in more than one orchestration pattern
- [ ] shared-state mutable-row effect replay/update/delete once upstream effect gating lands
- [ ] multi-source joined effects once the underlying `createEffect` behavior is settled
      Current gap: ElectricAgents now has source-namespaced StreamDB collection ids and per-message offsets, but stable upstream `createEffect` replay semantics are still not reliable enough for us to bless the slept mutable-row and multi-source joined cases.

### 8. Trading Floor

- [ ] open-market seeding and clock initialization
- [ ] news injection fanout
- [ ] clock advancement across sessions
- [ ] market summary derived from durable shared state

### 9. Cross-Cutting Stress

- [ ] mixed scenario combining spawn, observe, shared state, replay, and multiple children
- [ ] long multi-wake scenario with repeated rehydration and filtered snapshots

## Imported Idea Triage (2026-03-21)

These map the newer brainstorm into the DSL plan. The important distinction is:

- some ideas are already covered here
- some are real gaps for the DSL
- some belong in lower-level runtime tests, not black-box DSL scenarios

### Already Covered In DSL

- `1-8` basic entity lifecycle
  covered by `A1-A14`, `C1-C3`
- `9-19` spawn mechanics except `child.run`
  covered by `B1-B4`, `A1-A2`, `F3`, `F8`
- `21-27` core state collection behavior
  covered by `C1-C3`, `A12`, `D1-D10`
- `29-38`, `41-43` shared-state server/connect/read/write/update/delete/cross-entity durability
  covered by `D1-D10`
- `44-51` observe mechanics
  covered by `E1-E3`, `L1-L5`, `B4`
- `80-85` coordination and blackboard basics
  covered by `F1-F10`, `G1-G2`, `H1-H4`, `I1-I2`, `J1-J2`, `K1-K10`
- `88-93` debate / peer-review / wiki basics
  covered by `I1-I2`, `J1-J2`, `K1-K10`
- `96` send during setup throws unless targeting child
  covered outside the DSL already; not a missing behavior hole
- `100` bad `createEffect` function ref throws immediately
  covered outside the DSL already; not a missing behavior hole

### Better Covered Outside The DSL

These are important, but the right place is unit/integration tests around
`setup-context`, `wake-handler`, or `process-wake`, not black-box DSL cases.

- `17` spawn manifest entry includes `entityUrl` after creation
- `18` spawn auto-creates observe entry in manifest
- `30` createSharedState manifest entry persisted
- `32` connectSharedState manifest entry with `mode=connect`
- `52-61` `createEffect` manifest/functionRef/dedupe/internal activation rules
- `62-79` agent factory and re-wake replay internals
- `98-99` spawn/setup failure crash-only behavior

### Not Current Product Direction

- `20` `child.run` resolves when child run completes
  we do not want to build the DSL around `await child.run()` orchestration
- `87` child completion resolves parent `child.run` promise
  same reason; this bakes in the wrong orchestration shape

### Real Remaining DSL Backlog From The Imported List

- `15` state delete stream coverage
- `28` guarded state-transition example
- `39-40` shared state created in agent factory and idempotent create behavior
- `86` coordination entity stays alive until all children complete
- `94-95` trading-floor scenarios
- `97` invalid guard transition error path

Those now roll into the backlog sections above rather than living as a separate
unsorted list.

## Explicitly Rejected Patterns

These are not good DSL targets unless the underlying product/runtime shape changes.

- Repeated same-entity map-reduce reaggregation that relies on synchronous
  `child.text()` reads within the same wake.
- Repeated same-entity pipeline reruns that assume we can safely bless
  same-wake child reuse and immediate aggregation.
- Tests that rely on incidental scheduler ordering rather than durable semantic
  history.
