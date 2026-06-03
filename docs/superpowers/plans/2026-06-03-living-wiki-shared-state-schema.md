# Living Wiki Shared State Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the minimal Living Wiki per-WikiSpace shared-state schema and typed DB helper layer needed by the demo substrate. This phase creates shared Zod/type schemas, Durable Streams state collection definitions, stable ID/timestamp/event helpers, and client-side helper factories for observing the Worker-proxied shared-state stream. It must not implement full source intake, graph generation, review workflows, or role entity orchestration.

**Architecture:** Keep Living Wiki domain schema in shared TypeScript modules that can be imported by Worker tests, runtime/entity code, and browser helper tests. Use `@durable-streams/state` collection definitions for the Agents shared-state DB, exposed to the browser only through the completed Worker proxy route `GET /api/observe/:wikiSpaceId/shared-state`. Browser helpers build app-owned proxy URLs and create typed read-only stream DBs; privileged shared-state creation/writes remain Worker/runtime-side. Preserve the secure Agents proxy boundary: the browser never receives or chooses upstream Agents runtime URLs, shared-state ids, entity URLs, tags, tokens, or principal values.

**Tech Stack:** TypeScript, Zod, Vitest, `@durable-streams/state` (`createStreamDB`, `createStateSchema`, collection definitions), `@electric-ax/agents-runtime` shared-state observation APIs as confirmed from source, TanStack DB / React DB read helpers, existing Living Wiki Cloudflare Worker proxy boundary.

---

## Scope

Included in this phase:

- Minimal shared-state collections for demo substrate records:
  - `wiki_spaces`
  - `actors`
  - `memberships`
  - `activity_events`
  - `sources`
  - `wiki_pages`
  - `wiki_links`
  - `review_items`
  - `agent_runs`
- Shared Zod schemas and exported TypeScript types for these records.
- Durable Streams collection-definition map with collection `type` and `primaryKey` values.
- Typed helpers for stable IDs, ISO timestamps, shared-state IDs, and activity-event append payloads.
- Typed browser/client helper functions that create/read a shared-state DB through `/api/observe/:wikiSpaceId/shared-state` at helper/test level.
- Unit tests for schema validation, event helper shapes, URL/security invariants, and stream DB factory construction with fake or injected dependencies where needed.

Not included in this phase:

- Source ingestion pipelines, source fetching, LLM summarization, graph generation, review-board resolution flows, or role-entity spawning.
- Real UI wiring beyond helper-level tests or tiny compile-only imports.
- Broad Agents control-plane commands from the browser.
- Direct ElectricSQL/Postgres shape syncing for these records. The shared-state stream is the source for this slice.

## Required pre-work before implementation or review

- [ ] Read the demo and proxy context:
  - `docs/superpowers/specs/2026-06-02-living-wiki-demo-plan.md`
  - `docs/superpowers/plans/2026-06-03-living-wiki-agents-proxy.md`
  - `docs/superpowers/plans/2026-06-03-living-wiki-agents-proxy-discovery.md`
  - `examples/living-wiki/README.md`
- [ ] Inspect the current Living Wiki proxy and shared schemas:
  - `examples/living-wiki/src/shared/space.ts`
  - `examples/living-wiki/src/shared/agents-proxy.ts`
  - `examples/living-wiki/src/app/api/agentsProxyApi.ts`
  - `examples/living-wiki/src/worker/agents-proxy/*`
- [ ] Inspect Agents/runtime shared-state APIs and do not guess APIs:
  - `packages/agents-runtime/src/agents-client.ts`
  - `packages/agents-runtime/src/observation-sources.ts`
  - `packages/agents-runtime/src/entity-stream-db.ts`
  - `packages/agents-runtime/src/runtime-server-client.ts`
  - Relevant installed `@durable-streams/state` source or skills for `createStreamDB`, `createStateSchema`, collection definitions, and transactions.
- [ ] Run and record the TanStack Intent skill list:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
npx @tanstack/intent@latest list
```

- [ ] Load/read the relevant skills before writing or reviewing DB helper code:

```bash
pnpm dlx @tanstack/intent@latest load @tanstack/db#db-core/collection-setup @tanstack/db#db-core/live-queries @tanstack/react-db#react-db @durable-streams/state#state-schema @durable-streams/state#stream-db @electric-ax/agents-runtime#entity-stream-queries
```

- [ ] Read Electric proxy skills if any helper touches shape/proxy conventions or stream proxying:
  - `packages/typescript-client/skills/electric-shapes/SKILL.md`
  - `packages/typescript-client/skills/electric-proxy-auth/SKILL.md`
- [ ] Confirm the Living Wiki package name and scripts in `examples/living-wiki/package.json` before running commands. Expected filter: `@electric-ax/example-living-wiki`.

## Key findings to preserve

- `createAgentsClient({ baseUrl })` can observe `db(id, schema)`, but direct browser use would need `baseUrl` pointed at the Living Wiki Worker compatibility routes. For this slice, prefer narrow Living Wiki helpers that build `/api/observe/:wikiSpaceId/shared-state` URLs.
- `db(id, schema)` in `packages/agents-runtime/src/observation-sources.ts` maps a shared-state id to `/_electric/shared-state/:id` through `getSharedStateStreamPath`.
- The completed proxy derives shared-state id server-side as `living-wiki:${wikiSpaceId}` and exposes it through `GET /api/observe/:wikiSpaceId/shared-state`; do not expose the raw upstream shared-state id or upstream URL to the browser.
- Durable-stream protocol query parameters confirmed for Agents stream reads are `offset`, `live`, and `cursor`; this phase should reuse existing proxy helpers instead of adding a second stream proxy.
- TanStack DB collections created by `@durable-streams/state` are read through the returned stream DB collections. Use TanStack live query helpers against those collections; do not create parallel local-only collections for the same server-backed data.

## Proposed file structure

Create:

```text
examples/living-wiki/src/shared/wiki-state.ts
examples/living-wiki/src/shared/wiki-state.test.ts
examples/living-wiki/src/shared/wiki-state-ids.ts
examples/living-wiki/src/shared/wiki-state-ids.test.ts
examples/living-wiki/src/app/db/wikiStateDb.ts
examples/living-wiki/src/app/db/wikiStateDb.test.ts
```

Modify only if needed:

```text
examples/living-wiki/src/app/api/agentsProxyApi.ts        # add typed shared-state URL wrapper only if current getObserveUrl is too broad for call sites
examples/living-wiki/README.md                            # document shared-state helper commands and boundary, if implementation creates public helper APIs
```

Do not add role-entity source files, intake pipelines, graph-generation workers, review routes, or UI route wiring in this phase.

## Shared-state schema design

Use snake_case field names for shared-state rows because Durable Streams state events and cross-runtime JSON inspection in subsequent phases are easiest when record shapes match collection names and event payloads. Keep existing scaffold REST snapshots in `space.ts` unchanged unless implementation explicitly adds mapping helpers.

### Common scalar schemas

- `wikiSpaceId`: `wiki_[a-z0-9_-]+`; this matches the existing demo/API boundary prefix and remains URL-safe for Worker proxy routes.
- `actorId`: `actor_[a-z0-9_-]+`.
- Other row ids: prefixed, URL-safe, slash-free strings such as `source_...`, `page_...`, `link_...`, `review_...`, `event_...`, `agent_run_...`.
- `isoTimestamp`: `z.string().datetime({ offset: true })`.
- `jsonObject`: a conservative JSON-object schema for metadata fields; avoid broad `unknown` unless the source API requires it.

### Collections included now

1. `wiki_spaces`
   - Primary key: `id`
   - Fields: `id`, `title`, `created_at`, `created_by_actor_id`, `status`
   - `status`: `active | archived`

2. `actors`
   - Primary key: `id`
   - Fields: `id`, `wiki_space_id`, `kind`, `display_name`, `avatar_color`, `created_at`
   - `kind`: `human | agent`. Include `agent` now because demo activity events need agent-authored rows even before role entity orchestration is implemented.

3. `memberships`
   - Primary key: `id`
   - Fields: `id`, `wiki_space_id`, `actor_id`, `role`, `joined_at`, `status`
   - `role`: `owner | member | observer`
   - `status`: `active | left`

4. `activity_events`
   - Primary key: `id`
   - Fields: `id`, `wiki_space_id`, `occurred_at`, `actor_id`, `actor_kind`, `event_type`, `summary`, `subject_type`, `subject_id`, `visibility`, `metadata`
   - `visibility`: `ambient | inspector | system`
   - Keep actor-kind reveal support by storing `actor_kind` while UI can hide it by default.

5. `sources`
   - Primary key: `id`
   - Fields: `id`, `wiki_space_id`, `kind`, `status`, `title`, `url`, `text_preview`, `submitted_by_actor_id`, `submitted_at`, `published_at`, `metadata`
   - `kind`: `url | text`
   - `status`: `submitted | published | rejected`

6. `wiki_pages`
   - Primary key: `id`
   - Fields: `id`, `wiki_space_id`, `slug`, `title`, `status`, `summary`, `body`, `source_ids`, `created_at`, `updated_at`, `created_by_run_id`
   - `status`: `proposed | canonical | rejected`
   - Keep `body` optional/nullable for generated stubs; do not model sections in this slice.

7. `wiki_links`
   - Primary key: `id`
   - Fields: `id`, `wiki_space_id`, `from_page_id`, `to_page_id`, `status`, `label`, `rationale`, `source_ids`, `created_at`, `created_by_run_id`
   - `status`: `proposed | canonical | rejected`

8. `review_items`
   - Primary key: `id`
   - Fields: `id`, `wiki_space_id`, `kind`, `status`, `target_type`, `target_id`, `suggested_change`, `rationale`, `created_at`, `created_by_run_id`, `resolved_at`, `resolved_by_actor_id`, `resolution_note`
   - `kind`: `page | link | source`
   - `status`: `open | approved | rejected`

9. `agent_runs`
   - Primary key: `id`
   - Fields: `id`, `wiki_space_id`, `agent_kind`, `status`, `input_ref_type`, `input_ref_id`, `started_at`, `finished_at`, `error_message`
   - `agent_kind`: string enum for known demo roles only if already named in docs; otherwise a narrow string with max length and tests.
   - `status`: `queued | running | succeeded | failed`

### Field optionality and conditional rules

- `sources.url`: required and valid URL when `kind === 'url'`; omitted or `null` when `kind === 'text'`.
- `sources.text_preview`: required non-empty preview for `kind === 'text'`; optional/nullable for URL sources.
- `sources.published_at`: nullable; set only when `status === 'published'`.
- `wiki_pages.body`: nullable; generated stubs may have no body yet.
- `wiki_pages.created_by_run_id`, `wiki_links.created_by_run_id`, and `review_items.created_by_run_id`: nullable because human-created/demo-seeded rows may not come from an agent run.
- `review_items.resolved_at`, `review_items.resolved_by_actor_id`, and `review_items.resolution_note`: nullable when `status === 'open'`; required where appropriate for approved/rejected rows once resolution logic is implemented.
- `agent_runs.finished_at`: nullable while `status` is `queued` or `running`; required for terminal statuses `succeeded` and `failed`.
- `agent_runs.error_message`: nullable except required for `status === 'failed'`.
- Optional fields should be represented consistently as nullable properties in persisted rows rather than sometimes-missing keys unless `@durable-streams/state` discovery requires a different convention.

### Intentionally not included in this slice

- `wiki_sections`: omit until page body/section editing is implemented.
- `topics`: omit until topic clustering has real producer semantics.
- `review_boards` / `review_requests`: represented minimally as `review_items` here to support subsequent UI without creating board orchestration records.
- `chat_messages`: omit until entity inspector/chat APIs are implemented.
- Source content blobs or fetched document bodies: keep only metadata and preview fields.

## Task 1: Discovery — confirm shared-state DB construction APIs

- [ ] Inspect installed `@durable-streams/state` exports and examples for the exact signatures of:
  - `createStreamDB`
  - `createStateSchema`
  - `CollectionDefinition`
  - `createTransaction` / event helper APIs if used for append payload tests
- [ ] Inspect `packages/agents-runtime/src/observation-sources.ts` for the exact `db(id, schema)` helper and whether Living Wiki should import it in browser helpers or use `createStreamDB` directly against the Worker proxy URL.
- [ ] Inspect any existing examples that define shared-state schemas with `ctx.mkdb(...)`, `ctx.observe(db(...))`, or browser shared-state reads.
- [ ] Decide and record in the implementation summary whether `wikiStateDb.ts` uses:
  - direct `createStreamDB({ streamOptions: { url: getObserveUrl(...), contentType: 'application/json' }, state: livingWikiStateCollections })`, or
  - `createAgentsClient({ baseUrl: workerBaseUrl }).observe(db(sharedStateId, livingWikiStateCollections))` through Worker compatibility routes.
- [ ] Use direct `createStreamDB` unless discovery proves the Agents client path is safer and compatible with the existing proxy. Do not expose raw shared-state ids to the browser.

Suggested discovery commands:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
grep -R "function createStreamDB\|export .*createStreamDB\|interface CollectionDefinition\|createStateSchema" -n node_modules/.pnpm packages | head -200
grep -R "ctx.mkdb\|observe(db\|db(.*schema\|shared-state" -n examples packages/agents-runtime packages/agents-server | head -200
```

Expected outcome: the implementer can name the real API calls and imports before writing helper code.

## Task 2: Add shared Zod schemas and collection definitions

- [ ] Create `examples/living-wiki/src/shared/wiki-state.ts`.
- [ ] Define reusable scalar schemas for ids, timestamps, bounded strings, nullable optional fields, and JSON metadata.
- [ ] Define one Zod row schema per included collection.
- [ ] Export TypeScript row types using `z.infer`.
- [ ] Export `livingWikiStateCollections` as a `Record<string, CollectionDefinition>`-compatible object with:
  - `schema`: matching Zod schema
  - `type`: stable event type string, preferably singular names such as `wiki_space`, `actor`, `membership`, `activity_event`, `source`, `wiki_page`, `wiki_link`, `review_item`, `agent_run`
  - `primaryKey`: `id`
- [ ] Export `livingWikiStateSchema` from `createStateSchema(livingWikiStateCollections)` only after confirming the exact API in Task 1.
- [ ] Avoid circular imports from Worker env/routes or browser API modules.
- [ ] Keep schemas strict unless `@durable-streams/state` requires passthrough fields; if passthrough is required, document exactly why in code comments.

Tests:

- [ ] Create `examples/living-wiki/src/shared/wiki-state.test.ts`.
- [ ] Test valid minimal rows for every collection.
- [ ] Test invalid id prefixes, invalid timestamps, unknown enum values, missing primary keys, overlong strings, and invalid URL/text source combinations.
- [ ] Test that each collection has a unique event `type` and `primaryKey === 'id'`.

Run:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
pnpm --filter @electric-ax/example-living-wiki test src/shared/wiki-state.test.ts
```

## Task 3: Add stable ID, timestamp, and shared-state derivation helpers

- [ ] Create `examples/living-wiki/src/shared/wiki-state-ids.ts`.
- [ ] Export prefix constants and helper functions for row ids:
  - `createWikiSpaceId(seed?: string): string`
  - `createActorId(seed?: string): string`
  - `createMembershipId(wikiSpaceId, actorId): string`
  - `createSourceId(seed?: string): string`
  - `createWikiPageId(seedOrSlug): string`
  - `createWikiLinkId(fromPageId, toPageId, labelOrSeed?)`
  - `createReviewItemId(seed?: string)`
  - `createActivityEventId(seed?: string)`
  - `createAgentRunId(seed?: string)`
- [ ] Use deterministic, sanitized helpers where rows need stable identity across retries. Use `crypto.randomUUID()` only behind an injectable/random helper for non-deterministic demo records.
- [ ] Export `nowIsoTimestamp(clock?: () => Date): string` with tests using an injected clock.
- [ ] Re-export or mirror the existing proxy's shared-state derivation only if it can be imported without Worker dependencies. The shared derivation must match `living-wiki:${wikiSpaceId}` from `examples/living-wiki/src/worker/agents-proxy/targets.ts`; if importing from Worker code would create an app/worker coupling, duplicate the pure function in shared code and add a test asserting both outputs match.
- [ ] Do not import Worker env or upstream proxy code into browser modules.

Tests:

- [ ] Create `examples/living-wiki/src/shared/wiki-state-ids.test.ts`.
- [ ] Test deterministic output, URL-safe output, prefix validation, timestamp formatting, and parity with the proxy shared-state derivation helper.

Run:

```bash
pnpm --filter @electric-ax/example-living-wiki test src/shared/wiki-state-ids.test.ts
```

## Task 4: Add typed activity-event and state-event helper shapes

- [ ] In `wiki-state.ts` or a small adjacent shared module, export helper input schemas for append shapes rather than performing writes:
  - `createActivityEventInputSchema`
  - `createSourceSubmittedEventInputSchema` if useful for tests
  - `createPageProposedEventInputSchema` if useful for tests
- [ ] Add pure builders such as `buildActivityEventRow(input, options?: { id?: string; now?: () => Date })` that return validated row objects.
- [ ] If `createStateSchema` event helpers are used, add pure functions that return `ChangeEvent` objects for insert/upsert operations using the real `@durable-streams/state` API confirmed in Task 1.
- [ ] Keep builders side-effect free. Do not append to a real stream in this phase.
- [ ] Ensure event builders never accept raw upstream entity URLs, stream paths, tokens, or proxy URLs.

Tests:

- [ ] Extend `wiki-state.test.ts` or add a focused test file for event builders.
- [ ] Assert builder defaults, validation failures, deterministic ids, and exact event types if `ChangeEvent` helpers are generated.

Run:

```bash
pnpm --filter @electric-ax/example-living-wiki test src/shared/wiki-state.test.ts src/shared/wiki-state-ids.test.ts
```

## Task 5: Add browser/shared-state DB helper factory

- [ ] Create `examples/living-wiki/src/app/db/wikiStateDb.ts`.
- [ ] Export a narrow helper such as `createLivingWikiStateDb(input, options?)` where `input` includes only `wikiSpaceId` and optional Worker-relative base path.
- [ ] Use `getObserveUrl({ wikiSpaceId, observeKind: 'shared-state' })` from `agentsProxyApi.ts` or add a more specific wrapper like `getSharedStateObserveUrl({ wikiSpaceId })`.
- [ ] Construct the stream DB with the real `@durable-streams/state` API confirmed in Task 1. Expected pattern if confirmed:

```ts
createStreamDB({
  streamOptions: {
    url: getObserveUrl({ wikiSpaceId, observeKind: 'shared-state' }),
    contentType: 'application/json',
  },
  state: livingWikiStateCollections,
})
```

- [ ] Export the inferred DB type if useful for route loaders/hooks.
- [ ] Export small collection accessors or selectors only if they reduce repeated string indexing without hiding TanStack DB behavior.
- [ ] Do not preload in the factory unless the helper name and tests make that behavior explicit. Provide a separate `preloadLivingWikiStateDb(db)` wrapper only if needed.
- [ ] Do not import Worker env, upstream URLs, or secrets.
- [ ] Do not create local-only TanStack DB collections that duplicate stream-backed collections.

Tests:

- [ ] Create `examples/living-wiki/src/app/db/wikiStateDb.test.ts`.
- [ ] Mock or inject `createStreamDB` if needed to assert exact URL and schema passed to the factory without opening network streams.
- [ ] Assert the helper builds Worker-relative `/api/observe/.../shared-state` URLs and rejects invalid ids.
- [ ] Assert no upstream `ELECTRIC_AGENTS_BASE_URL`, `/_electric/shared-state`, token, principal, or raw shared-state id appears in browser helper output.

Run:

```bash
pnpm --filter @electric-ax/example-living-wiki test src/app/db/wikiStateDb.test.ts
```

## Task 6: Optional React helper surface at compile/test level only

- [ ] If implementation needs React DB ergonomics, add only a small helper or documented pattern for using `useLiveQuery` against `db.collections.*`.
- [ ] Do not wire a route, graph, feed, review panel, or inspector UI in this phase.
- [ ] If a React helper is added, read `@tanstack/react-db#react-db` first and add a focused test or type-only fixture demonstrating the query function shape.
- [ ] Prefer leaving React wiring to the UI phase if stream DB collection typing is already clear.

## Task 7: Documentation updates

- [ ] Update `examples/living-wiki/README.md` only if new public helper names or commands need documentation.
- [ ] Document that Living Wiki shared state is observed through:

```text
GET /api/observe/:wikiSpaceId/shared-state
```

- [ ] Re-state security boundaries:
  - browser observes through Worker proxy URLs only;
  - browser never receives or imports upstream Agents runtime URLs, tokens, principals, or shared-state ids;
  - app code must not import Worker env modules;
  - source fetch credentials and cloud tokens stay Worker-only.

## Task 8: Targeted verification

Run focused tests as tasks are completed:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
pnpm --filter @electric-ax/example-living-wiki test src/shared/wiki-state.test.ts
pnpm --filter @electric-ax/example-living-wiki test src/shared/wiki-state-ids.test.ts
pnpm --filter @electric-ax/example-living-wiki test src/app/db/wikiStateDb.test.ts
pnpm --filter @electric-ax/example-living-wiki test src/shared/wiki-state.test.ts src/shared/wiki-state-ids.test.ts src/app/db/wikiStateDb.test.ts
```

Run existing proxy/security tests to ensure the new helpers did not weaken the boundary:

```bash
pnpm --filter @electric-ax/example-living-wiki test src/worker/agents-proxy/
pnpm --filter @electric-ax/example-living-wiki test src/app/api/agentsProxyApi.test.ts src/shared/agents-proxy.test.ts
```

Run full Living Wiki checks:

```bash
pnpm --filter @electric-ax/example-living-wiki test
pnpm --filter @electric-ax/example-living-wiki typecheck
pnpm --filter @electric-ax/example-living-wiki build
```

If repo-level checks are explicitly requested by the caller, run them separately. Focused Living Wiki checks are sufficient for this slice by default because broad repo checks may be expensive.

## Verification checklist

- [ ] All new shared-state schemas parse valid examples and reject invalid rows.
- [ ] `livingWikiStateCollections` has stable collection keys, stable event `type` strings, and `primaryKey: 'id'` for every collection.
- [ ] ID helpers produce URL-safe, deterministic ids where required and match proxy shared-state derivation.
- [ ] Activity-event builders are pure, typed, and validated.
- [ ] Browser DB helpers construct Worker-owned `/api/observe/:wikiSpaceId/shared-state` URLs only.
- [ ] Browser DB helpers do not expose `/_electric/shared-state`, `ELECTRIC_AGENTS_BASE_URL`, tokens, principal keys, or raw shared-state ids.
- [ ] Existing Agents proxy tests still pass.
- [ ] Full Living Wiki `test`, `typecheck`, and `build` pass.

## Self-review checklist

- [ ] Confirm no implementation in this phase creates source intake, LLM graph generation, review resolution, role entity spawning, or UI workflow wiring.
- [ ] Confirm there are no imports from `examples/living-wiki/src/worker/env.ts` in browser or shared browser modules.
- [ ] Confirm helper names are explicit about read/observe behavior and do not imply privileged write capability.
- [ ] Confirm no broad `unknown` or passthrough schemas were introduced without a source-backed reason.
- [ ] Confirm collection names and id prefixes are documented and tested.
- [ ] Confirm TanStack DB / Durable Streams APIs used in code were verified from installed source or loaded skills, not guessed.
- [ ] Run separate red-flag scans before handing off. Build marker terms in Python so the scan command does not match itself, and scan implementation files separately from plan/security-boundary documentation:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
python3 - <<'SCAN'
from pathlib import Path
marker_terms = ['TO'+'DO', 'FIX'+'ME', 'HA'+'CK', 'post'+'poned']
secret_terms = ['ELECTRIC_AGENTS_'+'TOKEN', 'ELECTRIC_AGENTS_'+'PRINCIPAL_KEY']
source_paths = [Path('examples/living-wiki/src')]
found = False
for root in source_paths:
    for path in root.rglob('*'):
        if path.is_file() and path.suffix in {'.ts', '.tsx', '.md'}:
            text = path.read_text(errors='ignore')
            for line_no, line in enumerate(text.splitlines(), 1):
                if any(term in line for term in marker_terms + secret_terms):
                    print(f'{path}:{line_no}:{line}')
                    found = True
raise SystemExit(1 if found else 0)
SCAN
```

Review any matches. New source files should not contain marker comments or browser-exposed secret names. Security-boundary documentation may mention secret names intentionally and should be reviewed manually rather than failing the source scan.

## Implementation summary template

When implementation is complete, report:

- Files changed.
- Skills/docs read and key API findings.
- Final shared-state collections and any schema changes from this plan.
- DB helper approach chosen (`createStreamDB` directly or Agents client path) and why.
- Targeted and full verification commands run, with results.
- Red-flag scan result and any reviewed intentional matches.
