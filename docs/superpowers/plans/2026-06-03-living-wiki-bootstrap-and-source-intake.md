# Living Wiki Bootstrap and Source Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for parallel lanes, or `superpowers:executing-plans` if implementing serially. Before touching runtime writes or live query APIs, load/use the relevant Agents Runtime and TanStack/Durable Streams skills or inspect the committed discovery notes named below.

**Goal:** Give the Living Wiki dashboard real producer-side shared-state rows from the current create/join flow and add a non-LLM, non-fetch source submission path. This phase should make the live UI shell show actual `wiki_spaces`, `actors`, `memberships`, `activity_events`, and optionally `sources` rows without starting full source fetching, digesting, graph generation, review workflows, role orchestration, or LLM calls.

**Architecture:** Keep the existing Worker API as the product boundary. The browser submits create/join/source commands to Worker REST/tRPC routes and observes shared state only through `GET /api/observe/:wikiSpaceId/shared-state`. Because a real Agents runtime producer is not wired into the demo Worker, implement a safe producer adapter backed by the existing Worker-local demo store and pure shared-state row/event builders. Do not present this as a real Electric Agents runtime producer. The WikiSpace entity remains a server/runtime scaffold that can `ctx.mkdb(...)` on first wake, but Worker-local demo producer writes must be adapter/fake-backed and testable without a live runtime.

**Tech Stack:** TypeScript, Zod, Vitest, React, TanStack Router, TanStack DB / React DB, `@durable-streams/state`, existing Cloudflare Worker REST/tRPC boundary, existing Agents proxy boundary, existing `@electric-ax/agents-runtime` entity scaffold.

---

## Current substrate summary

Already present and stable enough to build on:

- `examples/living-wiki/src/shared/wiki-state.ts` defines shared-state schemas and row types for `wiki_spaces`, `actors`, `memberships`, `activity_events`, `sources`, `wiki_pages`, `wiki_links`, `review_items`, and `agent_runs`.
- `examples/living-wiki/src/shared/wiki-state-ids.ts` defines deterministic ID helpers and `deriveLivingWikiSharedStateId(wikiSpaceId)`.
- `examples/living-wiki/src/shared/wiki-state-events.ts` builds validated `activity_events` rows and durable insert events, but does not append them.
- `examples/living-wiki/src/server/entities/wiki-space.ts` registers an inert `wiki_space` entity and calls `ctx.mkdb(sharedStateId, livingWikiStateCollections)` on first wake. It should not be used as evidence that Worker-local create/join is connected to a real runtime.
- `examples/living-wiki/src/worker/wiki-space-store.ts` owns the current local demo create/join/get state in memory and returns `WikiSpaceSnapshot` objects.
- `examples/living-wiki/src/worker/routes.ts` exposes REST create/join/get space endpoints.
- `examples/living-wiki/src/app/routes/spaces.$wikiSpaceId.tsx` renders the live UI dashboard shell with empty view models.
- `examples/living-wiki/src/app/components/wiki-state/*` and app selectors render/test the read-only shared-state dashboard surface.
- Committed discovery notes confirm API constraints:
  - `docs/superpowers/plans/2026-06-03-living-wiki-entity-discovery.md`
  - `docs/superpowers/plans/2026-06-03-living-wiki-live-ui-discovery.md`

## Producer boundary decision

Recommendation for this phase:

1. Add a `WikiStateProducer` interface whose methods append/record shared-state rows through a test adapter.
2. Provide a Worker-local implementation backed by in-memory per-space row maps/event arrays. This gives deterministic demo data and can be observed via existing or extended Worker-local observe handling.
3. Keep the interface shaped so a later implementation can swap to real Agents runtime shared-state writes using `ctx.observe(db(sharedStateId, livingWikiStateCollections))` or runtime producer APIs after explicit discovery.
4. Do not wire browser code to raw shared-state IDs or upstream runtime URLs.

Rationale:

- The entity discovery note confirms real writes happen through runtime context APIs (`ctx.mkdb`, `ctx.observe(db(...))`, collection `.insert(...)`) during wakes.
- The current Worker create/join flow is a local demo store, not a live Agents runtime host.
- A fake-backed producer is sufficient to make the dashboard non-empty and demonstrate command-to-shared-state flow while avoiding unsafe guessed runtime APIs.

## Decisions needed, with recommendations

- **Where to write producer rows?** Recommend adding a Worker-local shared-state producer/store next to `wiki-space-store.ts`, not in browser code and not inside the server entity scaffold.
- **Should bootstrap happen on create or entity first wake?** Recommend Worker create/join bootstrap for this phase, because current UI commands already hit the Worker. Keep entity first-wake `mkdb` behavior as future runtime initialization only.
- **Should source intake accept URLs?** Recommend accepting URL metadata submission as a row only: validate URL and title, store status `submitted`, do not fetch the URL.
- **Should text sources be accepted?** Recommend yes, with required title/body or body-derived preview, capped length, status `submitted`, and no digesting.
- **Should source submission emit review items or agent runs?** Recommend no. Emit one ambient activity event only.
- **Should tRPC mirror REST?** Recommend adding tRPC only if current project conventions already mirror all commands; REST is sufficient if time is tight.

---

## Task breakdown

### Task 0: Discovery before uncertain write/observe APIs

- [ ] Re-read the committed discovery notes listed above.
- [ ] Inspect current Worker observe/proxy code before deciding how Worker-local rows are surfaced to `/api/observe/:wikiSpaceId/shared-state`.
- [ ] Inspect `@durable-streams/state` local stream/test helpers only if implementation intends to serialize actual durable stream events instead of returning a simpler adapter-backed snapshot for tests.
- [ ] If any real Agents runtime write is proposed, stop and inspect `packages/agents-runtime/src/entity-stream-db.ts`, `packages/agents-runtime/src/process-wake.ts`, and examples that call collection `.insert(...)`; record exact APIs before implementation.
- [ ] If adding a React DB live hook, follow `docs/superpowers/plans/2026-06-03-living-wiki-live-ui-discovery.md` and load the TanStack/Durable Streams skills again if type signatures differ.

Suggested discovery commands:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
grep -R "observe/:wikiSpaceId\|shared-state\|createStreamDB\|mkdb\|\.insert(" -n examples/living-wiki/src packages/agents-runtime/src packages/*/src | head -300
pnpm dlx @tanstack/intent@latest load @durable-streams/state#stream-db @tanstack/react-db#react-db @electric-ax/agents-runtime#entity-stream-queries
```

### Task 1: Add shared-state bootstrap row builders

- [ ] Add pure shared helpers that convert `WikiSpaceSnapshot` / `DemoActor` data into validated shared rows:
  - `WikiSpaceRow` with `status: 'active'`;
  - one `ActorRow` per demo actor;
  - one `MembershipRow` per demo actor, owner for creator/current first actor and member for joins;
  - ambient `ActivityEventRow` for `space_created` and `space_joined`.
- [ ] Use existing ID helpers where possible: `createMembershipId`, `createActivityEventId`, and shared schemas for validation.
- [ ] Preserve original `createdAt` values from the local store where available; use injected clocks in tests for event timestamps.
- [ ] Keep helpers pure: no Worker env imports, no runtime URLs, no network, no stream writes.
- [ ] Add focused tests for row validity, deterministic IDs, event summaries, and duplicate actor/join behavior.

Suggested file ownership:

```text
examples/living-wiki/src/shared/wiki-state-bootstrap.ts
examples/living-wiki/src/shared/wiki-state-bootstrap.test.ts
```

### Task 2: Add source intake row/activity builders

- [ ] Define a Worker command schema for source submission with:
  - `wikiSpaceId`;
  - `actorId`;
  - `kind: 'text' | 'url'`;
  - `title`;
  - for text: body or text content used to create `text_preview`;
  - for URL: `url`, no fetch, no scraping.
- [ ] Add pure builders for `SourceRow` with `status: 'submitted'`, `published_at: null`, metadata limited to safe demo fields.
- [ ] Add an ambient activity event such as `source_submitted` with actor kind `human`, subject type `source`, and source ID as subject.
- [ ] Ensure text previews are bounded to schema limits and do not store unbounded content in shared state.
- [ ] Add tests for text source, URL source, invalid URL, oversized text preview truncation/rejection according to chosen behavior, and invalid actor/space IDs.

Suggested file ownership:

```text
examples/living-wiki/src/shared/wiki-state-sources.ts
examples/living-wiki/src/shared/wiki-state-sources.test.ts
```

### Task 3: Add Worker-local shared-state producer adapter

- [ ] Define a small interface, for example:
  - `bootstrapSpace(snapshot)`;
  - `recordJoin(snapshot, actorId)`;
  - `submitSource(command)`;
  - `getRows(wikiSpaceId)` or collection-specific getters for tests/observe adapter.
- [ ] Implement the default Worker-local producer using in-memory per-space row maps, co-located with current local demo store code.
- [ ] Make writes idempotent where create/join can be retried:
  - upsert same `wiki_spaces`, `actors`, and `memberships` rows by ID;
  - append activity events only once per deterministic event key or explicitly document event append behavior.
- [ ] Keep this adapter fake-backed; it must not call `ctx.mkdb`, `ctx.observe`, upstream Agents runtime, or browser code.
- [ ] Expose a reset helper for tests, similar to `resetLocalDemoWikiSpaceStoreForTests()`.
- [ ] Add tests proving create/join flow produces the expected shared rows.

Suggested file ownership:

```text
examples/living-wiki/src/worker/wiki-state-producer.ts
examples/living-wiki/src/worker/wiki-state-producer.test.ts
```

### Task 4: Wire create/join Worker flow to bootstrap producer

- [ ] Update `LocalDemoWikiSpaceStore.createSpace` or route handling so successful create records shared rows.
- [ ] Update join flow so new joins record actor/membership and activity rows; existing actor refreshes should update actor display fields without emitting misleading duplicate join events.
- [ ] Keep returned `WikiSpaceSnapshot` API unchanged unless tests require a documented additive field.
- [ ] Extend existing Worker route/store tests for create and join to assert producer side effects.
- [ ] Verify `getSpace` remains read-only and does not emit events.

### Task 5: Add source submission Worker API

- [ ] Add REST endpoint `POST /api/spaces/:wikiSpaceId/sources`.
- [ ] Validate request body and route `wikiSpaceId` with Zod; reject mismatched IDs if body includes a space ID.
- [ ] Confirm the submitting `actorId` exists in the local demo space before writing a source row.
- [ ] Call the Worker-local producer to insert source row and source activity event.
- [ ] Return the created source row and activity event ID, not raw shared-state IDs or upstream stream metadata.
- [ ] Add tRPC procedure `source.submit` only if current API mirror conventions make this low-risk; otherwise document REST-only for this phase.
- [ ] Add route tests for success, missing actor, missing space, invalid kind, invalid URL, invalid text, and method not found.

### Task 6: Surface local producer rows to the dashboard

- [ ] Decide, after Task 0 discovery, the smallest safe way for the app dashboard to consume Worker-local producer rows.
- [ ] Preferred path: adapt existing `/api/observe/:wikiSpaceId/shared-state` local/demo branch so `createLivingWikiStateDb` can observe the same rows without changing browser route contracts.
- [ ] If the existing proxy route cannot safely serve local rows yet, add a temporary Worker-local `GET /api/spaces/:wikiSpaceId/shared-state-snapshot` endpoint and a clearly named app hook, but document that it is demo fallback and not the final observe protocol.
- [ ] Do not expose `living-wiki:${wikiSpaceId}` shared-state IDs in browser responses, logs, route state, or UI.
- [ ] Add tests for the chosen read path and for dashboard selectors receiving real rows from the producer.

### Task 7: Add source submission UI

- [ ] Add a compact source submission form to `spaces.$wikiSpaceId.tsx` or a `SourceSubmitForm` component.
- [ ] Support text and URL modes, with user-facing validation errors.
- [ ] Submit through Worker API, not directly to shared-state streams.
- [ ] On success, refresh/reload the local shared-state data path used by the dashboard; do not synthesize graph/page/review rows.
- [ ] Render submitted source rows in the existing `SourcesPanel` as `submitted`.
- [ ] Add React tests for form validation, successful submit, API error display, and dashboard update/refresh trigger.

### Task 8: Documentation

- [ ] Update `examples/living-wiki/README.md` to explain:
  - create/join now bootstraps Worker-local shared-state demo rows;
  - source submission stores `submitted` text/URL metadata only;
  - no URL fetching, digesting, LLM, graph generation, review resolution, or role orchestration is implemented;
  - Worker-local demo state is not durable across isolates/deploys;
  - browser security boundaries remain unchanged.

---

## Parallelization matrix

| Work                       | Can run in parallel?    | Notes                                                                                |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| Task 0 discovery           | Yes                     | Runtime/observe discovery can happen while pure builders are designed.               |
| Task 1 bootstrap builders  | Yes                     | Pure shared code; coordinate exported names with Task 3.                             |
| Task 2 source builders     | Yes                     | Pure shared code; independent from bootstrap builders except common ID/time helpers. |
| Task 3 producer adapter    | After builder API shape | Worker-only; can proceed before UI.                                                  |
| Task 4 create/join wiring  | After Task 3            | Touches existing store/routes; avoid concurrent edits there.                         |
| Task 5 source API          | After Task 2/3          | Worker routes and possibly tRPC; coordinate with Task 4 route edits.                 |
| Task 6 dashboard data path | After Task 0/3          | Requires observe/snapshot decision.                                                  |
| Task 7 source UI           | After Task 5/6 contract | App route/components; can start presentational form earlier with fake submit prop.   |
| Task 8 docs                | Last                    | Summarize actual implemented boundary, not planned aspirations.                      |

## Targeted verification commands

Adapt individual file names if implementation chooses different names.

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
pnpm --filter @electric-ax/example-living-wiki test src/shared/wiki-state-bootstrap.test.ts src/shared/wiki-state-sources.test.ts
pnpm --filter @electric-ax/example-living-wiki test src/worker/wiki-state-producer.test.ts src/worker/routes.test.ts src/worker/wiki-space-store.test.ts
pnpm --filter @electric-ax/example-living-wiki test src/app/components/wiki-state src/app/routes/spaces.\$wikiSpaceId.test.tsx
```

Full verification:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
pnpm --filter @electric-ax/example-living-wiki test
pnpm --filter @electric-ax/example-living-wiki typecheck
pnpm --filter @electric-ax/example-living-wiki build
```

## Security scan

Run after implementation, using dynamically constructed strings so the command does not flag itself:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
python3 - <<'SCAN'
from pathlib import Path
marker_terms = ['TO'+'DO', 'FIX'+'ME', 'HA'+'CK', 'post'+'poned']
secret_terms = ['ELECTRIC_AGENTS_'+'TOKEN', 'ELECTRIC_AGENTS_'+'PRINCIPAL_KEY', 'ELECTRIC_AGENTS_'+'BASE_URL', 'living'+'-wiki:']
fetch_terms = ['fetch(', 'XMLHttpRequest', 'openai', 'anthropic', 'useAgent(', 'agent.run(']
roots = [Path('examples/living-wiki/src'), Path('examples/living-wiki/README.md')]
found = False
for root in roots:
    paths = [root] if root.is_file() else list(root.rglob('*')) if root.exists() else []
    for path in paths:
        if not path.is_file() or path.suffix not in {'.ts', '.tsx', '.md'}:
            continue
        text = path.read_text(errors='ignore')
        for term in marker_terms + secret_terms:
            if term in text:
                print(f'{path}: contains {term}')
                found = True
        if 'src/shared/wiki-state-sources' in str(path) or 'src/worker' in str(path) or 'src/app' in str(path):
            for term in fetch_terms:
                if term in text:
                    print(f'{path}: inspect unexpected network/LLM term {term}')
                    found = True
if found:
    raise SystemExit(1)
SCAN
```

Manual security checklist:

- [ ] Browser code never imports Worker env modules, producer adapter internals, Agents proxy internals, or server entity files.
- [ ] Browser responses do not include upstream Agents URLs, tokens, principal headers, or raw shared-state IDs.
- [ ] Source URL submissions are stored as metadata only; there is no fetch, scrape, digest, or LLM call.
- [ ] Text submissions are bounded and do not store unbounded content in `metadata`.
- [ ] Worker validates `wikiSpaceId`, `actorId`, source kind, URL, and text/title lengths.
- [ ] Activity feed continues to hide actor implementation details unless existing reveal behavior intentionally shows them.

## Out of scope for this phase

- Real Electric Agents runtime write integration from Worker commands.
- External URL fetching, HTML extraction, source digesting, embeddings, or summaries.
- LLM calls or `ctx.useAgent()` / `ctx.agent.run()`.
- Wiki page synthesis, graph generation, topic clustering, and review resolution.
- Agent role orchestration beyond inert manuals already scaffolded.
- Durable persistence guarantees for the Worker-local demo store.

## Final reporting template

When implementation finishes, report:

```text
Status: DONE or BLOCKED
Files changed:
- ...
Key choices:
- Producer boundary used: Worker-local demo adapter / other
- Shared-state read path used: observe route / snapshot fallback / other
Verification:
- command: result
Security scan:
- result
Unresolved risks:
- ...
```
