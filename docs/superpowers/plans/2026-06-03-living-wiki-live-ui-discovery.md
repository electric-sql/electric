# Living Wiki Live UI Discovery

Date: 2026-06-03
Task: Lane B Task B1 discovery for `docs/superpowers/plans/2026-06-03-living-wiki-entity-and-live-ui.md`.

## 1. Files, skills, and source read

Read current plan and app/shared code:

- `docs/superpowers/plans/2026-06-03-living-wiki-entity-and-live-ui.md`
- `examples/living-wiki/src/shared/wiki-state.ts`
- `examples/living-wiki/src/app/db/wikiStateDb.ts`
- `examples/living-wiki/src/app/routes/spaces.$wikiSpaceId.tsx`
- `examples/living-wiki/src/app/hooks/useSpace.ts`
- `examples/living-wiki/src/app/db/wikiStateDb.test.ts`
- `examples/living-wiki/src/app/components/HealthPanel.test.tsx`
- `examples/living-wiki/package.json`
- App file layout under `examples/living-wiki/src/app/**`

Ran TanStack Intent discovery:

```bash
npx @tanstack/intent@latest list
pnpm dlx @tanstack/intent@latest load @tanstack/db#db-core/live-queries @tanstack/react-db#react-db @durable-streams/state#stream-db @electric-ax/agents-runtime#entity-stream-queries
```

The multi-skill load output returned the TanStack DB live-query skill content. I then loaded the other requested skills individually to avoid relying on truncated/partial output:

```bash
pnpm dlx @tanstack/intent@latest load @tanstack/react-db#react-db
pnpm dlx @tanstack/intent@latest load @durable-streams/state#stream-db
pnpm dlx @tanstack/intent@latest load @electric-ax/agents-runtime#entity-stream-queries
```

Also scanned installed examples/source references for `useLiveQuery`, `createLiveQueryCollection`, and `createStreamDB` usage with repository grep.

Intent list noted local version skew: Living Wiki package declares `@tanstack/db` `^0.6.6` and `@tanstack/react-db` `^0.1.78`; Intent selected local `@tanstack/react-db` `0.1.84` from `examples/living-wiki/node_modules`, while `@tanstack/db` selection in the list was `0.6.5` from another example and other installed versions existed. Do not infer behavior from only one installed copy if implementation hits type mismatches; verify against the Living Wiki package resolution.

## 2. Actual React DB / live query APIs found

Confirmed APIs and patterns from loaded skills:

- Import React bindings from `@tanstack/react-db`; it re-exports TanStack DB helpers/operators.
- `useLiveQuery` return shape includes `data`, `state`, `collection`, `status`, `isLoading`, `isReady`, `isError`, `isIdle`, and `isCleanedUp`.
- `useLiveQuery` supports query function plus dependency array, config object with `query`, pre-created collection input, and disabled state by returning `undefined` or `null`.
- `useLiveSuspenseQuery` exists; data is always defined but requires Suspense/Error Boundary wiring.
- `useLiveInfiniteQuery` exists for cursor pagination.
- TanStack DB live queries use query-builder syntax: `q.from({ alias: collection })`, expression operators such as `eq`/`gt`/`and`, equality-only joins, and `orderBy` before `limit`/`offset`.
- `createLiveQueryCollection` creates derived collections; docs recommend creating derived collections once and reusing them rather than recreating on every render/navigation.
- `queryOnce` exists for one-shot queries.
- `@durable-streams/state` `createStreamDB` returns a StreamDB whose `db.collections.*` entries are TanStack DB collections suitable for `useLiveQuery`.
- StreamDB initialization is lazy: `db.preload()` connects/loads the stream. The existing Living Wiki DB factory intentionally does not call `preload()`.
- StreamDB cleanup should call `db.close()` when a component/hook owns the DB lifecycle.
- For StreamDB React usage, loaded guidance stresses destructuring with defaults, for example `const { data: users = [] } = useLiveQuery(...)`.
- `@electric-ax/agents-runtime#entity-stream-queries` says to prefer direct typed queries over convenience read helpers for obvious query-shaped reads, while keeping product-facing projections as helpers where they encode real UI/view-model invariants.

## 3. Recommended approach for this phase

Recommendation: implement pure selectors/view models and presentational components first; do not wire real `useLiveQuery` hooks in the next Lane B step unless route integration explicitly needs them after selectors/components are stable.

Reasons:

- The plan explicitly allows and prefers pure selectors/components first if live-query APIs add complexity or flakiness.
- Current Living Wiki app already has a safe DB factory (`createLivingWikiStateDb`) and tests proving it does not preload or expose upstream internals. There is no current hook owning StreamDB lifecycle/preload/close.
- Lane B B2/B3 deliverables are naturally pure transformations and presentational UI: recent activity, member cards, source status groups, graph summary counts, and review summary counts. These can be fully tested with deterministic fake rows and shared row types.
- Avoiding live hooks initially keeps tests offline and prevents accidental network stream opens during component/route tests.
- Real live-query wiring can remain a narrow B4 wrapper around already-tested selectors. That keeps React DB concerns localized and avoids coupling every component to DB shape.

When B4 is implemented, prefer a hook with injected/optional DB ownership rather than helpers that hide queries globally. Query directly against `db.collections.*`, then pass `data ?? []` into pure selectors.

## 4. Recommended Lane B file structure

Suggested files under `examples/living-wiki/src/app`:

```text
components/wiki-state/
  ActivityFeed.tsx
  MembersPanel.tsx
  SourcesPanel.tsx
  WikiGraphPanel.tsx
  ReviewQueuePanel.tsx
  WikiStateDashboard.tsx
  *.test.tsx

selectors/
  wikiStateViewModels.ts
  wikiStateViewModels.test.ts

hooks/
  useLivingWikiStateViewModels.ts        # add in B4 only if using real DB hooks
  useLivingWikiStateViewModels.test.tsx  # fake/injected DB; no network/preload
```

Selector module should import row types from `../../shared/wiki-state` (relative path adjusted from file location). Components should accept plain props/view models and should not construct DBs, call `preload()`, fetch, mutate, or know observe URLs.

Route integration in `routes/spaces.$wikiSpaceId.tsx` should come after selector/component tests. The route can render empty shell view models initially, then later consume the narrow DB hook once B4 lands.

## 5. Selector and component test strategy with fake rows/data

Selector tests:

- Use typed fake arrays for shared row types.
- Keep timestamps deterministic and assert exact ordering for activity (`occurred_at` descending).
- Assert member card joins by `membership.actor_id` to actors, including active/left membership handling according to intended view-model rules.
- Assert source groups by the schema statuses: `submitted`, `published`, `rejected`.
- Assert page/link graph counts by status, especially empty arrays and mixed `proposed`/`canonical`/`rejected` rows.
- Assert review queue counts by `open`, `approved`, `rejected`, with open count emphasized for UI.
- Include empty-input tests for every selector.

Component tests:

- Use `@testing-library/react` and `@testing-library/jest-dom/vitest`, matching existing `HealthPanel.test.tsx` style.
- Pass fake view-model props directly.
- Test friendly empty states and non-empty rendering without DB, network, timers, or route context.
- Keep component assertions user-facing (`screen.getByText`, roles where available) rather than internal implementation details.

## 6. If a DB hook is added, how to test without network streams/preload

If B4 adds a DB-backed hook:

- Define the hook to accept an already-created `LivingWikiStateDb` or a factory dependency. Do not require the hook test to call the real `createStreamDB` path.
- In tests, inject fake collections compatible with the query code, or mock `@tanstack/react-db` `useLiveQuery` at module boundary to return controlled `{ data, isLoading, isError, status }` values. The hook’s main behavior should be adapting query data to pure selectors, not validating TanStack internals.
- Do not call `db.preload()` in selector/component tests.
- If lifecycle ownership is tested, use a fake DB with `preload` and `close` spies and assert calls without opening a real stream. Prefer a separate small lifecycle test over mixing network lifecycle into view-model tests.
- Ensure `createLivingWikiStateDb` injection remains available as in current `wikiStateDb.test.ts`, and preserve the guarantee that factory creation alone does not preload.

## 7. Browser security constraints

Browser/app Lane B code must:

- Observe only through `/api/observe/:wikiSpaceId/shared-state` via `createLivingWikiStateDb` / `getObserveUrl`.
- Validate `wikiSpaceId` with the shared schema before constructing observe URLs when creating DBs.
- Never expose raw shared-state ids with the `living-wiki:` prefix in UI, serialized configs, test snapshots, logs, or route state.
- Never import Worker env modules, Agents proxy internals, upstream runtime URLs, principal values, or token names into app components/hooks/selectors.
- Never call upstream Agents runtime URLs directly from browser code.
- Avoid browser mutations/commands in this phase; live UI is read-only.
- Do not add source ingestion, external fetches, LLM calls, graph generation, review resolution, or role orchestration behavior from UI code.

## 8. Uncertainties and blockers

No blocker for B2/B3 pure selectors and components.

Open uncertainties for B4 live hook wiring:

- The exact Living Wiki package-resolved type signatures should be verified during implementation because Intent reported multiple installed TanStack DB / React DB versions.
- StreamDB collection shape is known at the skill level (`db.collections.*`), but a compile check should confirm `LivingWikiStateDb` exposes strongly typed collection fields exactly as expected after package resolution.
- Route-level ownership of `db.preload()`/`db.close()` still needs a product decision: route-owned DB lifecycle, hook-owned lifecycle, or parent/provider-owned DB lifecycle. For now, avoid introducing this decision into B2/B3.
- It is not yet confirmed whether the route should display purely empty shell panels before live data wiring, or whether B5 waits for B4. The plan permits empty shell panels, so this is not a blocker for selector/component work.

## Decision

Proceed with pure selectors/view models and presentational components first. Defer real `useLiveQuery` wiring to a narrow B4 hook after selectors/components are tested. When B4 lands, use direct typed queries against `LivingWikiStateDb.collections.*`, destructure `data` with empty-array defaults, and feed pure selectors; test with injected/mocked DB/query results and no real stream/network preload.
