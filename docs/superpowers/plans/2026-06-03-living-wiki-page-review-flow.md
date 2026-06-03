# Living Wiki page proposal and review flow implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` for parallel lanes, or `superpowers:executing-plans` if implementing serially. Before touching shared-state row schemas, Worker route contracts, or dashboard view-model plumbing, re-read the source intake plan and producer discovery notes listed below and inspect the current schemas/source files. Do not guess new runtime APIs, Durable Streams protocol behavior, or Agents runtime write methods for this phase.

**Goal:** After the Worker-local shared-state source intake flow, add a deterministic, non-LLM, non-fetch flow that turns a submitted source into a proposed wiki page plus an open review item. A demo-authorized human can approve or reject the review item, causing the proposed page to become canonical or rejected and causing the dashboard to show page, review, activity, and existing graph-empty state. Keep the flow manual, deterministic, Worker-local, and demo-safe.

**Architecture:** Extend the existing Worker API and Worker-local demo shared-state producer. The browser continues to submit commands through REST endpoints and refreshes the Worker-local shared-state snapshot path. Pure shared builders should construct validated `WikiPageRow` and `ReviewItemRow` values from existing submitted `SourceRow` values. Worker-local producer methods should upsert proposal rows, resolve review items, update page status, and emit deterministic activity events. Do not wire this to real Electric Agents runtime writes, upstream observe streams, LLMs, fetchers, source digesters, graph generators, or role orchestration. The existing real observe proxy path remains separate; the demo dashboard uses the temporary snapshot read path established by source intake.

**Tech Stack:** TypeScript, Zod, Vitest, React, TanStack Router, existing Living Wiki shared-state schemas, existing Worker REST boundary, Worker-local in-memory demo producer, existing dashboard components/selectors, no external APIs.

---

## Source-read requirements

Before implementation, read or re-read:

- `docs/superpowers/plans/2026-06-03-living-wiki-bootstrap-and-source-intake.md`
- `docs/superpowers/plans/2026-06-03-living-wiki-bootstrap-producer-discovery.md`
- `examples/living-wiki/src/shared/wiki-state.ts`
- `examples/living-wiki/src/shared/wiki-state-ids.ts`
- `examples/living-wiki/src/shared/wiki-state-events.ts`
- `examples/living-wiki/src/shared/wiki-state-sources.ts`
- `examples/living-wiki/src/worker/wiki-state-producer.ts`
- `examples/living-wiki/src/worker/routes.ts`
- `examples/living-wiki/src/app/routes/spaces.$wikiSpaceId.tsx`
- `examples/living-wiki/src/app/components/wiki-state/*`

Use existing discovery notes and inspect committed schemas/source before adding API shapes. No new runtime API guessing: do not infer Agents runtime writes, Durable Streams observe protocols, collection insert APIs, or upstream stream response shapes.

Suggested inspection commands:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
grep -R "wiki_pages\|review_items\|WikiPageRow\|ReviewItemRow\|submitSource\|shared-state-snapshot\|resolve" -n examples/living-wiki/src docs/superpowers/plans | head -300
find examples/living-wiki/src/app/components/wiki-state -type f -maxdepth 1 -print
```

---

## Current substrate summary

- Shared schemas already include `sources`, `wiki_pages`, `wiki_links`, `review_items`, `activity_events`, and row types.
- Source intake currently stores `SourceRow` rows with `status: 'submitted'` and emits `source_submitted` activity events through a Worker-local producer.
- `LocalDemoWikiStateProducer` currently stores wiki spaces, actors, memberships, activity events, and sources in memory, while returning empty arrays for pages, links, review items, and agent runs.
- `GET /api/spaces/:wikiSpaceId/shared-state-snapshot` is the safe demo read path. Do not adapt `/api/observe/:wikiSpaceId/shared-state` for this plan.
- The dashboard route already has a source submit form and refreshes the snapshot after source submission.

## Key design choices for this phase

- **Page proposal input:** Require an existing submitted source ID plus actor ID. Optionally accept a human-edited title/slug/body override in the propose request, but defaults must be deterministic from the source row.
- **Page body generation:** Non-LLM template only. For text sources, use the stored `text_preview` and safe metadata such as body length. For URL sources, use title and URL metadata only; never fetch the URL.
- **Page status:** New proposals start as `wiki_pages.status: 'proposed'`. Approval sets page status to `canonical`; rejection sets page status to `rejected`.
- **Review item:** New page proposal creates one open `ReviewItemRow` with `kind: 'page'`, `target_type: 'wiki_page'`, and `target_id` equal to the proposed page ID.
- **Review resolution:** Approving or rejecting a review item updates the review row and linked page in one Worker-local operation and emits an activity event.
- **IDs:** Use existing deterministic helpers (`createWikiPageId`, `createReviewItemId`, `createActivityEventId`). Use seed strings based on `wikiSpaceId`, `sourceId`, and proposal/review action to avoid duplicate rows/events on retries.
- **Authorization:** Keep all humans authorized in the demo. Still validate that the acting `actorId` belongs to the local demo space.
- **Links/graph:** No link generation by default. Leave `wiki_links: []` unless implementation proves an extremely low-risk deterministic same-source/self link is useful; recommendation is no links in this phase.

---

## Task breakdown

### Task 0: Discovery and schema inspection

- [ ] Re-read the two Living Wiki plans/discovery notes named above.
- [ ] Inspect `wikiPageSchema`, `reviewItemSchema`, `sourceSchema`, and existing ID helper behavior.
- [ ] Inspect current `WikiStateDashboard` panels/selectors to confirm how page and review rows appear.
- [ ] Inspect current `LocalDemoWikiStateProducer` storage shape before adding pages/reviews.
- [ ] Confirm the snapshot endpoint remains the dashboard read path; do not modify the upstream observe proxy.

### Task 1: Add pure page proposal builders

- [ ] Add pure shared helpers that build a validated `WikiPageRow` from a submitted `SourceRow`.
- [ ] Default `slug` deterministically from the source title; normalize to schema-compatible lowercase hyphen form and fall back to a source-ID-derived slug when needed.
- [ ] Default `title` from the source title, bounded by schema limits.
- [ ] Default `summary` with a short deterministic sentence based on source kind and title.
- [ ] Default `body` with a deterministic manual-review template; include only `text_preview` for text sources and URL metadata for URL sources.
- [ ] Set `source_ids` to `[source.id]`, `status: 'proposed'`, `created_by_run_id: null`, and timestamps from an injected clock.
- [ ] Add focused tests for text source, URL source, slug sanitization, length bounds, invalid source status if rejected/published is not allowed by chosen policy, and schema validity.

Suggested file ownership:

```text
examples/living-wiki/src/shared/wiki-state-pages.ts
examples/living-wiki/src/shared/wiki-state-pages.test.ts
```

### Task 2: Add pure review item builders

- [ ] Add pure shared helpers that build an open `ReviewItemRow` for a proposed page.
- [ ] Use `kind: 'page'`, `status: 'open'`, `target_type: 'wiki_page'`, and `target_id: page.id`.
- [ ] Build deterministic `suggested_change` such as `Review proposed page: <title>`.
- [ ] Build deterministic `rationale` referencing the source ID and source kind, without claiming fetch/LLM/digest work occurred.
- [ ] Set `created_by_run_id: null`, `resolved_at: null`, `resolved_by_actor_id: null`, and `resolution_note: null`.
- [ ] Add tests for schema validity, deterministic IDs, and open review fields.

Suggested file ownership:

```text
examples/living-wiki/src/shared/wiki-state-reviews.ts
examples/living-wiki/src/shared/wiki-state-reviews.test.ts
```

### Task 3: Add activity event builders or conventions

- [ ] Reuse `buildActivityEventRow` or existing `activityEventSchema` parsing for deterministic events.
- [ ] Emit `page_proposed` when a source creates a proposed page/review item.
- [ ] Emit `review_approved` when a page review is approved.
- [ ] Emit `review_rejected` when a page review is rejected.
- [ ] Keep actor kind `human`, visibility `ambient`, and metadata minimal (`source_id`, `page_id`, `review_item_id`, `resolution`).
- [ ] Add or extend tests to prove event rows are valid and deterministic.

### Task 4: Extend Worker-local producer storage and methods

- [ ] Extend `WikiStateProducer` with methods such as:
  - `proposePageFromSource(command)`;
  - `resolveReviewItem(command)`;
  - existing `getRows(wikiSpaceId)` returning non-empty pages/reviews.
- [ ] Add in-memory maps for `wikiPages` and `reviewItems` to the Worker-local storage shape.
- [ ] `proposePageFromSource` should verify the source exists in producer state and has `status: 'submitted'`.
- [ ] Upsert the proposed page and open review item by deterministic IDs.
- [ ] Avoid duplicate proposal activity events on retry by deterministic event ID.
- [ ] `resolveReviewItem` should verify the review exists, is `open`, targets a known page, and action is `approve` or `reject`.
- [ ] On approve, update review to `approved` and page to `canonical`.
- [ ] On reject, update review to `rejected` and page to `rejected`.
- [ ] Set `resolved_at`, `resolved_by_actor_id`, and optional bounded `resolution_note` on review resolution.
- [ ] Keep all writes Worker-local; do not call `ctx.mkdb`, `ctx.observe`, upstream Agents proxy code, browser hooks, `fetch`, or LLM APIs.
- [ ] Add producer tests for successful proposal, retry idempotence, approve, reject, already-resolved review, missing source, missing page/review, and snapshot rows.

### Task 5: Add REST endpoints

- [ ] Add `POST /api/spaces/:wikiSpaceId/pages/propose`.
- [ ] Request body should include `actorId` and `sourceId`; optional low-risk fields may include `title`, `slug`, or `body` overrides if bounded and validated.
- [ ] Validate route `wikiSpaceId`, `actorId`, `sourceId`, and optional fields with Zod.
- [ ] Verify the local demo space exists and the actor belongs to it using the existing local store.
- [ ] Call the Worker-local producer proposal method.
- [ ] Return `{ page, reviewItem, activityEventId }` only.
- [ ] Add `POST /api/spaces/:wikiSpaceId/reviews/:reviewItemId/resolve`.
- [ ] Request body should include `actorId`, `resolution: 'approve' | 'reject'`, and optional bounded `note`.
- [ ] Verify the local demo space exists and the actor belongs to it.
- [ ] Call the Worker-local producer resolution method.
- [ ] Return `{ page, reviewItem, activityEventId }` only.
- [ ] Keep REST-only; do not add tRPC unless current implementation already requires a mirrored procedure.
- [ ] Add route tests for success cases, invalid JSON, invalid IDs, missing actor, missing space, missing source/review, already resolved review, and unsupported methods.

### Task 6: Add app API helpers and UI controls

- [ ] Extend the existing Living Wiki API client with `proposePageFromSource` and `resolveReviewItem` helpers.
- [ ] Add a propose control near source rows or a compact standalone propose form that selects/enters a source ID from submitted sources.
- [ ] Prefer source-row buttons if existing `SourcesPanel` can accept callbacks without large refactors; otherwise add a small form near the dashboard.
- [ ] Disable proposal controls when no actor is joined/current, source list is empty, or action is in flight.
- [ ] Add review queue controls for open page reviews: approve and reject buttons plus optional note field.
- [ ] After every successful propose/approve/reject action, refresh the shared-state snapshot path.
- [ ] Show API errors with accessible `role="alert"` text.
- [ ] Keep UI copy explicit: proposals are deterministic/manual, no URL fetch or AI generation has occurred.
- [ ] Add React tests for proposing from a source, approving a review, rejecting a review, error display, and refresh-after-action behavior.

### Task 7: Dashboard/selector checks

- [ ] Confirm existing dashboard panels render `wiki_pages` and `review_items` rows from the snapshot view model.
- [ ] If current selectors omit pages/reviews, add minimal selector mapping without graph generation.
- [ ] Ensure graph state remains empty or unchanged when no `wiki_links` exist.
- [ ] Add component/selector tests proving page/review counts and statuses update after proposal and resolution snapshots.

### Task 8: Documentation

- [ ] Update `examples/living-wiki/README.md` to explain the manual page proposal/review flow.
- [ ] State that proposed pages are deterministic templates from submitted source metadata only.
- [ ] State that URL sources are not fetched and text sources use only stored preview data.
- [ ] State that review approval/rejection is demo-authorized for any local human actor.
- [ ] State that graph/link generation, source digesting, LLM calls, Agents runtime role orchestration, and durable persistence are still not implemented.

---

## Verification commands

Targeted verification:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
pnpm --filter @electric-ax/example-living-wiki test src/shared/wiki-state-pages.test.ts src/shared/wiki-state-reviews.test.ts
pnpm --filter @electric-ax/example-living-wiki test src/worker/wiki-state-producer.test.ts src/worker/routes.test.ts
pnpm --filter @electric-ax/example-living-wiki test src/app/components/wiki-state src/app/routes/spaces.\$wikiSpaceId.test.tsx
```

Full verification:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
pnpm --filter @electric-ax/example-living-wiki test
pnpm --filter @electric-ax/example-living-wiki typecheck
pnpm --filter @electric-ax/example-living-wiki build
```

Manual smoke test:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
pnpm --filter @electric-ax/example-living-wiki dev
# In browser: create/join a space, submit a text source, propose a page, approve it, submit another source, propose and reject it, confirm dashboard page/review/activity state changes and graph stays empty.
```

---

## Security scan

Run after implementation, using dynamically constructed strings so the scan does not flag itself:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
python3 - <<'SCAN'
from pathlib import Path
marker_terms = ['TO'+'DO', 'FIX'+'ME', 'HA'+'CK', 'post'+'poned']
secret_terms = ['ELECTRIC_AGENTS_'+'TOKEN', 'ELECTRIC_AGENTS_'+'PRINCIPAL_KEY', 'ELECTRIC_AGENTS_'+'BASE_URL', 'living'+'-wiki:']
forbidden_runtime_terms = ['ctx.mkdb', 'ctx.observe', 'useAgent(', 'agent.run(', 'openai', 'anthropic']
network_terms = ['fetch(', 'XMLHttpRequest']
response_terms = ['_electric/shared-state', 'streamUrl', 'offset', 'cursor', 'Authorization', 'Bearer ']
roots = [Path('examples/living-wiki/src'), Path('examples/living-wiki/README.md')]
found = False
for root in roots:
    paths = [root] if root.is_file() else list(root.rglob('*')) if root.exists() else []
    for path in paths:
        if not path.is_file() or path.suffix not in {'.ts', '.tsx', '.md'}:
            continue
        text = path.read_text(errors='ignore')
        for term in marker_terms + secret_terms + forbidden_runtime_terms + response_terms:
            if term in text:
                print(f'{path}: contains {term}')
                found = True
        if 'wiki-state-pages' in str(path) or 'wiki-state-reviews' in str(path) or 'wiki-state-producer' in str(path):
            for term in network_terms:
                if term in text:
                    print(f'{path}: inspect unexpected network term {term}')
                    found = True
if found:
    raise SystemExit(1)
SCAN
```

Manual security checklist:

- [ ] Browser code never imports Worker env modules, producer adapter internals, Agents proxy internals, or server entity files.
- [ ] Browser responses do not include upstream Agents URLs, tokens, principal headers, raw shared-state IDs, Durable Streams offsets, cursors, or stream paths.
- [ ] Page proposal does not fetch URLs, scrape content, digest sources, call LLMs, or invoke agent runs.
- [ ] Text-source proposal uses bounded `text_preview` only, not unbounded original text content.
- [ ] Worker validates `wikiSpaceId`, `actorId`, `sourceId`, `reviewItemId`, resolution, title/slug/body overrides, and note lengths.
- [ ] All human actors remain demo-authorized intentionally; this is documented and not represented as production authorization.
- [ ] Activity metadata contains only safe IDs/statuses/kinds and no secrets or raw shared-state identifiers.

---

## Explicit out of scope

- Real Electric Agents runtime write integration from Worker commands.
- Adapting `/api/observe/:wikiSpaceId/shared-state` or implementing Durable Streams HTTP protocol locally.
- External URL fetching, scraping, HTML extraction, source digesting, embeddings, summaries, or content enrichment.
- LLM calls, `ctx.useAgent()`, `ctx.agent.run()`, automatic agent role orchestration, or agent-run lifecycle rows.
- Automatic graph generation, topic clustering, or wiki link synthesis.
- Production-grade authorization, moderation, ACLs, or durable persistence for Worker-local demo state.
- Concurrent multi-review conflict resolution beyond simple idempotent Worker-local status updates.

---

## Red-flag scan: no self-match

Use this after implementation to catch risky terms while avoiding matching the scan text itself:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
python3 - <<'SCAN'
from pathlib import Path
terms = [
  'living'+'-wiki:',
  '_electric/'+'shared-state',
  'ELECTRIC_AGENTS_'+'TOKEN',
  'ELECTRIC_AGENTS_'+'PRINCIPAL_KEY',
  'ctx.'+'mkdb',
  'ctx.'+'observe',
  'use'+'Agent(',
  'agent.'+'run(',
  'open'+'ai',
  'anth'+'ropic',
]
roots = [Path('examples/living-wiki/src'), Path('examples/living-wiki/README.md')]
found = False
for root in roots:
    for path in ([root] if root.is_file() else root.rglob('*')):
        if not path.is_file() or path.suffix not in {'.ts', '.tsx', '.md'}:
            continue
        text = path.read_text(errors='ignore')
        for term in terms:
            if term in text:
                print(f'{path}: red flag term {term}')
                found = True
if found:
    raise SystemExit(1)
SCAN
```

---

## Final reporting template

When implementation finishes, report:

```text
Status: DONE or BLOCKED
Files changed:
- ...
Key choices:
- Proposal source: submitted SourceRow only
- Producer boundary: Worker-local demo adapter
- Review resolution: human approve/reject updates page + review + activity
- Read path: shared-state snapshot refresh
Verification:
- command: result
Security scan:
- result
Unresolved risks:
- ...
```
