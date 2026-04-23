---
name: entity-stream-queries
description: >
  Querying electric agent runtime entity streams and manifest state with
  @durable-streams/state queryOnce and useLiveQuery. Use when reading built-in
  entity collections like manifests, wakes, child_status, inbox, runs, or
  shared state from runtime code, tests, examples, or CLI code. Prefer direct
  typed queries over one-off read helpers.
---

Read `packages/state/skills/stream-db/SKILL.md` first for StreamDB and query basics.

# Electric Agent Runtime Entity Stream Queries

Use direct typed queries against `db.collections.*`.

Principles:

- Prefer `queryOnce(...)` for one-shot reads and `useLiveQuery(...)` or shared live query collections for reactive UI.
- Do not add exported convenience read helpers for obvious queries. The query itself is already the API.
- Keep code helpers only for real invariants:
  - manifest key builders
  - typed event/write helpers
  - shared product-facing projections such as the entity timeline query
- In runtime, tests, examples, and CLI code, favor direct queries over raw `toArray` scans when the read is naturally query-shaped.
- Do not cast around `db.collections.*`. The row types come from the schema.

Read these references as needed:

- `references/collections.md` for the built-in entity collections and manifest row kinds
- `references/common-queries.md` for common query patterns

When writing to entity or shared-state streams, use the typed event helpers/server APIs. Do not hand-build stream event envelopes.
