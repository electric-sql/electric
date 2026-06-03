# Living Wiki Entity and Live UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Advance Living Wiki in two coordinated parallel lanes: Lane A scaffolds the minimal WikiSpace entity/runtime/manual producer surface, and Lane B wires a read-only shared-state live UI consumer surface. Both lanes build on the completed Worker API boundary, secure Agents proxy boundary, and typed shared-state schema without implementing source ingestion, LLM generation, review resolution, or full role orchestration.

**Architecture:** Keep the producer and consumer sides separated by the already-stable shared contract. Lane A may import shared schema/id/event helpers and Agents runtime APIs after discovery confirms exact registration patterns. Lane B may import browser DB helpers and shared row types, and should use fake/injected data in tests rather than depending on live agents. Browser code continues to observe only through `/api/observe/:wikiSpaceId/shared-state`; Worker/runtime code remains responsible for upstream Agents runtime configuration and privileged behavior.

**Tech Stack:** TypeScript, Zod, Vitest, React, TanStack Router, TanStack DB / React DB, `@durable-streams/state`, `@electric-ax/agents-runtime`, existing Cloudflare Worker REST/tRPC/proxy boundary.

---

## Scope boundaries

Included:

- Lane A: minimal WikiSpace entity registration scaffold, role/manual text modules, basic boot/init/status/no-op wake behavior, and tests proving registration/manual exports and shared-state id wiring.
- Lane B: read-only browser hooks/selectors/components for shared-state-backed activity, members, sources, graph/review empty shells, plus route integration once components are independently tested.
- Cross-lane integration checks that both sides use the same shared contract and do not import across forbidden boundaries.

Not included:

- Source fetching or source ingestion pipelines.
- LLM calls, graph generation, page synthesis, review resolution, curator/reviewer/synthesizer orchestration, or external web/API fetches.
- Browser commands that send entity messages/signals.
- Direct browser access to upstream Agents runtime URLs, raw shared-state IDs, tokens, principals, or Worker env modules.

## Required pre-work before implementation or review

- [ ] Read current phase context:
  - `docs/superpowers/specs/2026-06-02-living-wiki-demo-plan.md`
  - `docs/superpowers/plans/2026-06-03-living-wiki-agents-proxy.md`
  - `docs/superpowers/plans/2026-06-03-living-wiki-shared-state-schema.md`
  - `docs/superpowers/plans/2026-06-03-living-wiki-shared-state-schema-discovery.md`
  - `examples/living-wiki/README.md`
- [ ] Read current shared and browser code:
  - `examples/living-wiki/src/shared/wiki-state.ts`
  - `examples/living-wiki/src/shared/wiki-state-ids.ts`
  - `examples/living-wiki/src/shared/wiki-state-events.ts`
  - `examples/living-wiki/src/app/db/wikiStateDb.ts`
  - `examples/living-wiki/src/app/routes/spaces.$wikiSpaceId.tsx`
  - `examples/living-wiki/src/app/hooks/useSpace.ts`
  - `examples/living-wiki/src/worker/agents-proxy/*`
- [ ] For Lane A, inspect Agents runtime/entity APIs before writing runtime code:
  - `packages/agents/skills/quickstart.md`
  - `packages/agents-runtime/src/index.ts`
  - `packages/agents-runtime/src/types.ts`
  - `packages/agents-runtime/src/process-wake.ts`
  - `packages/agents-runtime/src/agent.ts` if present
  - `examples/deep-survey/src/server/*`
- [ ] For Lane B, run and record TanStack Intent skill discovery before writing live query hooks:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
npx @tanstack/intent@latest list
pnpm dlx @tanstack/intent@latest load @tanstack/db#db-core/live-queries @tanstack/react-db#react-db @durable-streams/state#stream-db @electric-ax/agents-runtime#entity-stream-queries
```

## Shared contract for both lanes

Both lanes may rely on these stable interfaces:

- `wikiSpaceId`: `wiki_[a-z0-9_-]+`.
- Shared-state id derivation: `deriveLivingWikiSharedStateId(wikiSpaceId)` returns `living-wiki:${wikiSpaceId}`.
- Shared-state schema: `livingWikiStateSchema` and collection definitions in `src/shared/wiki-state.ts`.
- Collections: `wiki_spaces`, `actors`, `memberships`, `activity_events`, `sources`, `wiki_pages`, `wiki_links`, `review_items`, `agent_runs`.
- Browser observe route: `GET /api/observe/:wikiSpaceId/shared-state`.
- Browser DB factory: `createLivingWikiStateDb({ wikiSpaceId })`.
- Activity builder surface: `buildActivityEventRow(...)` and `buildActivityEventInsertEvent(...)`.

Do not add new shared collection names, entity kinds, observe kinds, route names, or browser command routes in this phase without a plan update and review.

## Parallelization matrix

| Work                                 | Can run in parallel?          | Notes                                                                                                                    |
| ------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Lane A API discovery                 | Yes, with Lane B discovery    | Reads runtime/server source only.                                                                                        |
| Lane B live-query discovery          | Yes, with Lane A discovery    | Reads React/TanStack docs and app source only.                                                                           |
| Lane A manuals/text scaffold         | Yes, after Lane A discovery   | Keep under server/entity/manual directories; no UI files.                                                                |
| Lane B components/hooks              | Yes, after Lane B discovery   | Keep under app components/hooks; no runtime files.                                                                       |
| Lane A entity runtime implementation | After Lane A discovery review | Must not guess Agents API shape.                                                                                         |
| Lane B route integration             | After component tests pass    | May modify `/spaces/:wikiSpaceId`; coordinate with any Lane A route changes, though Lane A should avoid app route files. |
| Cross-lane integration review        | After both lanes land         | Run full tests/typecheck/build and boundary scans.                                                                       |

File conflict avoidance:

- Lane A owns `examples/living-wiki/src/server/**` or a similarly confirmed runtime directory, plus manual files and Lane A tests.
- Lane B owns `examples/living-wiki/src/app/components/**`, `src/app/hooks/**` live UI hooks, `src/app/routes/spaces.$wikiSpaceId.tsx`, and related tests.
- Shared files under `src/shared/**` should only be edited by a coordination task unless both lane workers explicitly need the same exported type.
- README updates should wait until both lanes are reviewed.

## Lane A Task A1: Discovery — confirm entity registration/manual APIs

- [ ] Inspect the Agents quickstart, runtime exports, `process-wake`, entity types, and examples.
- [ ] Identify the actual API for defining/registering entities, manuals/instructions, and testable no-op wake behavior.
- [ ] Identify the correct directory conventions for an example app runtime/server entry point.
- [ ] Confirm how runtime code should reference `livingWikiStateSchema` and `deriveLivingWikiSharedStateId` without creating browser/Worker env coupling.
- [ ] Write a short discovery note or implementation summary with exact imports and APIs before implementing A2+.

Suggested commands:

```bash
grep -R "createAgent\|define.*entity\|register.*entity\|manual\|role\|processWake\|ctx\.mkdb\|ctx\.observe" -n packages examples/deep-survey examples | head -300
```

## Lane A Task A2: Add role/manual scaffold

- [ ] Create a small manual/role text module structure after A1 locks location and style.
- [ ] Include narrow manuals for `curator`, `synthesizer`, `reviewer`, and `source-ingester` as inert instructions only.
- [ ] Manuals should describe responsibilities and explicit non-actions for this phase: no external fetches, no LLM calls, no graph generation, no review resolution.
- [ ] Add tests that manuals export stable role IDs/names and include required safety constraints.

## Lane A Task A3: Add minimal WikiSpace entity scaffold

- [ ] Implement only the smallest entity/runtime registration shape confirmed in A1.
- [ ] Entity identity should map to `wikiSpaceId` and `deriveLivingWikiSharedStateId(wikiSpaceId)`.
- [ ] Basic behavior may be no-op, boot/status, or pure event-builder invocation only if the runtime API is confirmed.
- [ ] Do not write to a real stream unless A1 confirms a safe/testable local runtime write helper and tests use fakes.
- [ ] Add tests for registration shape, shared-state id derivation, manual linkage, and no secret/upstream URL exposure.

## Lane B Task B1: Discovery — confirm live-query/read helper approach

- [ ] Confirm actual TanStack DB / React DB APIs for `useLiveQuery` or query helpers from loaded skills/source.
- [ ] Decide whether this phase needs real `useLiveQuery` hooks or can first add pure selectors and presentational components fed by row arrays.
- [ ] Prefer pure selectors/components first if live-query API would add complexity or flakiness.
- [ ] Record the approach in the implementation summary before B2+.

## Lane B Task B2: Add pure selectors/view models

- [ ] Create app-level selector/view-model helpers for shared-state rows:
  - recent activity events sorted by `occurred_at` descending;
  - actors/memberships joined into member cards;
  - sources grouped by status;
  - wiki page/link graph summary counts;
  - review queue summary counts.
- [ ] Use row types from `src/shared/wiki-state.ts`.
- [ ] Add tests with deterministic fake rows.
- [ ] Do not import Worker env, proxy internals, or raw shared-state ids.

## Lane B Task B3: Add presentational components

- [ ] Add small components for:
  - activity feed;
  - members panel;
  - sources list empty/data state;
  - wiki graph empty shell/summary;
  - review queue empty shell/summary.
- [ ] Components should accept plain props/view models, not create DBs internally.
- [ ] Add React tests with fake props.
- [ ] Keep empty states friendly and Demo Day oriented.

## Lane B Task B4: Add live DB hook/factory wrapper if B1 confirms API

- [ ] Add a narrow hook that creates or receives a `LivingWikiStateDb` and returns collection-backed view models.
- [ ] If real live-query hooks are used, follow `@tanstack/react-db#react-db` guidance and test with fake/injected DB where practical.
- [ ] Do not call upstream Agents URLs or expose raw shared-state ids.
- [ ] Do not introduce browser command/mutation behavior.

## Lane B Task B5: Integrate route shell

- [ ] Update `examples/living-wiki/src/app/routes/spaces.$wikiSpaceId.tsx` only after B2/B3 tests pass.
- [ ] Preserve existing create/join/get route behavior and tests.
- [ ] Render the new shell panels with graceful empty states if no shared-state rows are loaded.
- [ ] Add/extend route tests for loaded space header plus new empty shell panels.

## Documentation task

- [ ] Update `examples/living-wiki/README.md` after both lanes land.
- [ ] Document entity/manual scaffold status and shared-state UI shell status.
- [ ] Re-state browser security boundaries.
- [ ] Avoid implying source ingestion, graph generation, or review workflows are implemented.

## Targeted verification commands

Lane A examples, adapted to actual file names after discovery:

```bash
pnpm --filter @electric-ax/example-living-wiki test src/server
pnpm --filter @electric-ax/example-living-wiki test src/shared
```

Lane B examples, adapted to actual file names:

```bash
pnpm --filter @electric-ax/example-living-wiki test src/app/components
pnpm --filter @electric-ax/example-living-wiki test src/app/hooks
pnpm --filter @electric-ax/example-living-wiki test 'src/app/routes/spaces.$wikiSpaceId.test.tsx'
```

Cross-lane and full checks:

```bash
pnpm --filter @electric-ax/example-living-wiki test src/worker/agents-proxy/ src/app/api/agentsProxyApi.test.ts src/shared/agents-proxy.test.ts
pnpm --filter @electric-ax/example-living-wiki test
pnpm --filter @electric-ax/example-living-wiki typecheck
pnpm --filter @electric-ax/example-living-wiki build
```

## Self-review checklist

- [ ] Lane A does not add source fetching, LLM calls, graph generation, review resolution, or active multi-role orchestration.
- [ ] Lane B does not depend on real agents producing data and handles empty shared-state rows gracefully.
- [ ] Browser/app code imports no Worker env modules and no upstream Agents proxy internals.
- [ ] Browser/app code does not expose raw `living-wiki:*` shared-state ids, `/_electric/shared-state`, Agents runtime base URLs, tokens, or principal values.
- [ ] Shared-state collection names and row types remain unchanged unless reviewed.
- [ ] Entity/manual code uses real Agents APIs confirmed by A1 discovery.
- [ ] Live UI code uses real TanStack/React DB APIs confirmed by B1 discovery, or remains pure selector/component code.
- [ ] Run a red-flag scan using dynamically constructed terms so the command does not match itself:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
python3 - <<'SCAN'
from pathlib import Path
marker_terms = ['TO'+'DO', 'FIX'+'ME', 'HA'+'CK', 'post'+'poned']
secret_terms = ['ELECTRIC_AGENTS_'+'TOKEN', 'ELECTRIC_AGENTS_'+'PRINCIPAL_KEY', 'ELECTRIC_AGENTS_'+'BASE_URL']
found = False
for root in [Path('examples/living-wiki/src/app'), Path('examples/living-wiki/src/shared'), Path('examples/living-wiki/src/server')]:
    if not root.exists():
        continue
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

Review any matches; test-only non-leakage assertions may mention secret names intentionally, but production browser files should not.

## Implementation summary template

When complete, report:

- Files changed by Lane A and Lane B.
- Discovery findings and exact APIs chosen.
- Which tasks ran in parallel and any reconciliation done.
- Verification commands and results.
- Security scan results and reviewed intentional matches.
- Explicit statement that source ingestion, LLM generation, graph generation, review resolution, and real role orchestration remain outside this phase.
