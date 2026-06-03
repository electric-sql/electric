# Living Wiki API Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement an independently testable Phase 0.5 slice: a typed Worker API boundary and frontend data-access layer for creating, joining, and reading demo WikiSpaces, backed by a local seeded in-memory adapter rather than full Electric Agents entities.
**Architecture:** Keep the browser behind the Cloudflare Worker boundary. Add a Worker-side `WikiSpaceStore` adapter interface with a deterministic local implementation for scaffold/dev/test. Expose `space.create`, `space.join`, and `space.get` through both tRPC and REST. Add a typed demo session identity helper, client API wrapper/hooks, and a `/spaces/:wikiSpaceId` route that reads space data through the Worker. Electric Cloud credentials remain Worker-only and are not returned to the browser.
**Tech Stack:** pnpm workspace, TypeScript, Vite, React 19, TanStack Router, tRPC, Zod, Vitest, Cloudflare Workers/Wrangler. TanStack DB remains scaffolded but is not required for this slice beyond typed client-access boundaries.

---

## Scope

This plan extends the completed scaffold in `examples/living-wiki` without implementing Electric Agents entities, Electric Cloud space creation, entity message proxying, shared-state database schemas, intake, reviews, subscriptions, graph rendering, or durable persistence. The deliverable is a tested API contract and client consumption path designed for adapter replacement without changing UI call sites.

The Worker-side store may be process-local memory for this slice because the goal is independently testable API shape. It must be explicit in naming and tests that this is the local demo adapter. Do not describe it as production persistence.

## Required pre-work for implementers/reviewers

- [ ] Inspect `docs/superpowers/specs/2026-06-02-living-wiki-demo-plan.md` and `docs/superpowers/plans/2026-06-02-living-wiki-scaffold.md` before editing.
- [ ] Inspect current `examples/living-wiki` files before editing, especially `src/worker/index.ts`, `src/worker/routes.ts`, `src/worker/trpc-router.ts`, `src/shared/trpc.ts`, `src/shared/types.ts`, `src/app/router.tsx`, and existing tests.
- [ ] Before TanStack Router work, inspect the repo-conventional route pattern in the current scaffold and current TanStack Router docs/skills available to the agent.
- [ ] Before tRPC work, inspect current scaffold tRPC usage and any available tRPC docs/skills; preserve the Worker `fetchRequestHandler` boundary.
- [ ] Before Cloudflare-specific work, inspect current `wrangler.toml`, Worker env typing, and Cloudflare Worker testing patterns in the scaffold.
- [ ] Before making Electric Cloud or Agents claims, inspect `examples/deep-survey`, `packages/agents/skills/quickstart.md`, and relevant `packages/agents*` APIs. For this plan, keep Cloud integration behind a typed adapter abstraction and do not call unverified Cloud APIs.

## File structure after this plan

Existing files retained:

```text
examples/living-wiki/
  README.md
  package.json
  tsconfig.json
  vite.config.ts
  vitest.config.ts
  wrangler.toml
  index.html
  public/_headers
  src/app/main.tsx
  src/app/router.tsx
  src/app/routes/__root.tsx
  src/app/routes/index.tsx
  src/app/components/AppShell.tsx
  src/app/components/HealthPanel.tsx
  src/app/components/HealthPanel.test.tsx
  src/app/styles/globals.css
  src/shared/db.ts
  src/shared/trpc.ts
  src/shared/types.ts
  src/worker/electric-cloud.ts
  src/worker/env.ts
  src/worker/index.ts
  src/worker/index.test.ts
  src/worker/routes.ts
  src/worker/trpc-router.ts
```

Create these files:

```text
examples/living-wiki/src/app/api/livingWikiApi.ts
examples/living-wiki/src/app/api/livingWikiApi.test.ts
examples/living-wiki/src/app/hooks/useSpace.ts
examples/living-wiki/src/app/hooks/useSpace.test.tsx
examples/living-wiki/src/app/routes/spaces.$wikiSpaceId.tsx
examples/living-wiki/src/app/routes/spaces.$wikiSpaceId.test.tsx
examples/living-wiki/src/shared/session.ts
examples/living-wiki/src/shared/session.test.ts
examples/living-wiki/src/shared/space.ts
examples/living-wiki/src/worker/demo-session.ts
examples/living-wiki/src/worker/demo-session.test.ts
examples/living-wiki/src/worker/wiki-space-store.ts
examples/living-wiki/src/worker/wiki-space-store.test.ts
```

Modify these files:

```text
examples/living-wiki/src/app/router.tsx
examples/living-wiki/src/app/routes/index.tsx
examples/living-wiki/src/shared/types.ts
examples/living-wiki/src/worker/index.test.ts
examples/living-wiki/src/worker/routes.ts
examples/living-wiki/src/worker/trpc-router.ts
```

## Public API contract for this slice

Types and schemas to expose from `src/shared/space.ts`:

```ts
export type ActorKind = `human`

export type DemoActor = {
  id: string
  wikiSpaceId: string
  kind: ActorKind
  displayName: string
  avatarColor: string
  createdAt: string
}

export type WikiSpaceSummary = {
  id: string
  title: string
  createdAt: string
  createdByActorId: string
  memberCount: number
}

export type WikiSpaceSnapshot = {
  space: WikiSpaceSummary
  currentActor: DemoActor
  actors: DemoActor[]
}

export type CreateSpaceInput = {
  title: string
  displayName: string
  avatarColor: string
}

export type JoinSpaceInput = {
  wikiSpaceId: string
  displayName: string
  avatarColor: string
  actorId?: string
}

export type GetSpaceInput = {
  wikiSpaceId: string
  actorId?: string
}
```

Validation rules:

- Define and export `demoActorSchema`, `wikiSpaceSummarySchema`, and `wikiSpaceSnapshotSchema` alongside the input schemas. Client response validation must use `wikiSpaceSnapshotSchema`, and Worker tests should serialize snapshots through normal JSON responses rather than trusting TypeScript types alone.
- `title`: trimmed, 1 to 120 characters.
- `displayName`: trimmed, 1 to 80 characters.
- `avatarColor`: one of a fixed demo palette, such as `slate`, `blue`, `green`, `orange`, `purple`, `pink`.
- `wikiSpaceId`: generated as a URL-safe lowercase id with a stable prefix, e.g. `wiki_<suffix>`.
- `actorId`: generated as a URL-safe lowercase id with a stable prefix, e.g. `actor_<suffix>`.

HTTP/tRPC behavior:

- `POST /api/spaces` accepts `CreateSpaceInput` without `wikiSpaceId`, creates a space and creator actor, and returns `WikiSpaceSnapshot`.
- `POST /api/spaces/:id/join` accepts display-name/avatar fields plus an optional `actorId` from stored browser session identity, creates or updates the member for that demo identity, and returns `WikiSpaceSnapshot`. If `actorId` is omitted, the local demo store creates a new actor.
- `GET /api/spaces/:id?actorId=...` returns `WikiSpaceSnapshot` when the space exists. If `actorId` is omitted, return the first actor in the local demo store as `currentActor`.
- tRPC procedures mirror REST: `space.create`, `space.join`, `space.get`.
- Unknown spaces return 404 over REST and a tRPC not-found error over tRPC.
- Validation failures return 400 over REST and input validation errors over tRPC.
- Responses must not include `ELECTRIC_CLOUD_API_TOKEN`, full Electric Cloud config, or any secret-bearing environment values.

## Task 1: Add shared space and session types first

- [ ] Create `examples/living-wiki/src/shared/space.ts` with the public types above plus Zod schemas for `createSpaceInputSchema`, `joinSpaceInputSchema`, `getSpaceInputSchema`, `demoActorSchema`, `wikiSpaceSummarySchema`, and `wikiSpaceSnapshotSchema`.
- [ ] Export a `demoAvatarColors` readonly array and `DemoAvatarColor` type.
- [ ] Add helper schemas that trim strings before length validation.
- [ ] Create `examples/living-wiki/src/shared/session.ts` with pure browser-safe helpers:
  - `type DemoSessionIdentity = { actorId?: string; displayName?: string; avatarColor?: DemoAvatarColor }`
  - `readDemoSessionIdentity(storage: Pick<Storage, 'getItem'>): DemoSessionIdentity`
  - `writeDemoSessionIdentity(storage: Pick<Storage, 'setItem'>, identity: DemoSessionIdentity): void`
  - `clearDemoSessionIdentity(storage: Pick<Storage, 'removeItem'>): void`
  - Use storage key `living-wiki.demo-session.v1`.
  - Parse malformed JSON as an empty identity.
- [ ] Create `examples/living-wiki/src/shared/session.test.ts` covering empty storage, valid identity round-trip, partial identity, and malformed JSON.
- [ ] Run `pnpm --filter @electric-ax/example-living-wiki test src/shared/session.test.ts` and confirm failure only if the file is not yet implemented; then implement until it passes.

## Task 2: Add Worker demo session helper

- [ ] Create `examples/living-wiki/src/worker/demo-session.ts` with deterministic helpers:
  - `normalizeDisplayName(value: string): string`
  - `normalizeSpaceTitle(value: string): string`
  - `isDemoAvatarColor(value: string): value is DemoAvatarColor`
  - `createDemoId(prefix: 'wiki' | 'actor', source?: string): string`
- [ ] `createDemoId` should use `crypto.randomUUID()` when no source is provided and should create predictable lowercase ids when a source is provided for tests.
- [ ] Create `examples/living-wiki/src/worker/demo-session.test.ts` covering trimming, palette validation, generated id prefixes, URL-safe output, and deterministic seeded ids.
- [ ] Run the new test file and make it pass.

## Task 3: Add Worker-side store adapter and tests

- [ ] Create `examples/living-wiki/src/worker/wiki-space-store.ts` with:
  - `type WikiSpaceStore`
  - `type CreateSpaceCommand`
  - `type JoinSpaceCommand`
  - `type GetSpaceCommand`
  - `class LocalDemoWikiSpaceStore implements WikiSpaceStore`
  - `getWikiSpaceStore(env: WorkerEnv): WikiSpaceStore`
- [ ] `WikiSpaceStore` must define `createSpace`, `joinSpace`, and `getSpace` methods returning `Promise<WikiSpaceSnapshot>`.
- [ ] `LocalDemoWikiSpaceStore` should keep state in a module-level `Map<string, InternalSpaceRecord>` so Worker tests can exercise create/join/get across requests in one process.
- [ ] Add `resetLocalDemoWikiSpaceStoreForTests()` exported only for tests and use it in test setup. Keep the name explicit so nobody mistakes this for durable storage.
- [ ] Seed behavior: on first access, optionally create a stable demo space only when a test or local caller asks for it through the adapter constructor. Do not implicitly make every unknown id exist.
- [ ] `createSpace` creates a new space plus creator actor and returns a snapshot with `memberCount: 1`.
- [ ] `joinSpace` adds a new actor for an existing space and returns a snapshot with incremented `memberCount`.
- [ ] If `joinSpace` receives the same `actorId` for an existing actor, update display name/avatar and do not increase `memberCount`.
- [ ] `getSpace` returns a snapshot for an existing space and chooses `currentActor` by requested `actorId`, falling back to first actor.
- [ ] Unknown space lookups should throw a typed `WikiSpaceNotFoundError` with `wikiSpaceId`.
- [ ] Create `examples/living-wiki/src/worker/wiki-space-store.test.ts` covering create, join, idempotent join by actor id, get, unknown-space error, and no secret fields in serialized snapshots.
- [ ] Run `pnpm --filter @electric-ax/example-living-wiki test src/worker/wiki-space-store.test.ts` and make it pass.

## Task 4: Add tRPC space procedures with tests

- [ ] Modify `examples/living-wiki/src/worker/trpc-router.ts` to import shared schemas and `getWikiSpaceStore`.
- [ ] Add nested router:

```ts
space: t.router({
  create: t.procedure.input(createSpaceInputSchema).mutation(...),
  join: t.procedure.input(joinSpaceInputSchema).mutation(...),
  get: t.procedure.input(getSpaceInputSchema).query(...),
})
```

- [ ] In each resolver, call the store and return `WikiSpaceSnapshot`.
- [ ] Convert `WikiSpaceNotFoundError` to `new TRPCError({ code: 'NOT_FOUND', message: ... })`.
- [ ] Preserve existing `health` procedure and `AppRouter` export.
- [ ] Extend `examples/living-wiki/src/worker/index.test.ts` with tRPC tests:
  - create returns a space id, creator actor, and member count 1.
  - join returns the same space id and member count 2.
  - get returns the current actor when `actorId` is provided.
  - unknown get returns a tRPC not-found response.
  - returned JSON does not contain the configured token string.
- [ ] Run `pnpm --filter @electric-ax/example-living-wiki test src/worker/index.test.ts` and make it pass.

## Task 5: Add REST create/join/get endpoints with tests

- [ ] Modify `examples/living-wiki/src/worker/routes.ts` to add REST routes while preserving `/api/health` and unknown `/api/*` 404 behavior.
- [ ] Add a local `parseJsonBody(request)` helper that rejects invalid JSON with a 400 JSON response.
- [ ] Validate inputs with the same Zod schemas used by tRPC.
- [ ] Implement:
  - `POST /api/spaces`
  - `POST /api/spaces/:wikiSpaceId/join`
  - `GET /api/spaces/:wikiSpaceId`
- [ ] Include `actorId` from `GET` query string when present.
- [ ] Map `WikiSpaceNotFoundError` to 404 JSON `{ ok: false, error: 'Space not found' }`.
- [ ] Map validation and JSON parse errors to 400 JSON with a concise message.
- [ ] Keep responses as JSON with `content-type: application/json; charset=utf-8`.
- [ ] Extend `examples/living-wiki/src/worker/index.test.ts` with REST tests for create, join, get, invalid payload, unknown space, and no token exposure.
- [ ] Run the Worker tests and make them pass.

## Task 6: Add typed client API wrapper and tests

- [ ] Create `examples/living-wiki/src/app/api/livingWikiApi.ts` exporting:
  - `type LivingWikiApiClient`
  - `createLivingWikiApiClient(options?: { baseUrl?: string; fetch?: typeof fetch })`
  - methods `createSpace(input)`, `joinSpace(input)`, and `getSpace(input)`.
- [ ] Use REST endpoints for this wrapper in this slice because they are easy to test in browser utilities and remain behind the Worker boundary. Keep tRPC client support in `src/shared/trpc.ts` for future command paths.
- [ ] The wrapper should validate returned snapshots with a shared Zod response schema before returning typed data.
- [ ] The wrapper should throw `LivingWikiApiError` containing `status` and `message` for non-2xx responses.
- [ ] Create `examples/living-wiki/src/app/api/livingWikiApi.test.ts` covering URL construction, create/join/get methods, response validation, non-2xx errors, and base URL support.
- [ ] Run the client API tests and make them pass.

## Task 7: Add React hook for space reads and mutations

- [ ] Create `examples/living-wiki/src/app/hooks/useSpace.ts` exporting:
  - `useSpace(wikiSpaceId: string, actorId?: string)` for initial load and refresh.
  - `useCreateSpace()` returning `createSpace(input)` plus loading/error state.
  - `useJoinSpace(wikiSpaceId: string)` returning `joinSpace(input)` plus loading/error state.
- [ ] Use React state/effect primitives and `createLivingWikiApiClient`; do not introduce a new query library in this slice.
- [ ] Persist returned `currentActor` through `writeDemoSessionIdentity(window.localStorage, ...)` when browser storage is available.
- [ ] Avoid reading `window` during module evaluation so tests and server-like environments can import the hook file.
- [ ] Create `examples/living-wiki/src/app/hooks/useSpace.test.tsx` with mocked `fetch`, covering successful load, error load, create persistence, and join persistence.
- [ ] Run the hook tests and make them pass.

## Task 8: Add `/spaces/:wikiSpaceId` route and landing-page flow

- [ ] Create `examples/living-wiki/src/app/routes/spaces.$wikiSpaceId.tsx` as a TanStack Router route under the existing root route.
- [ ] The route should read `wikiSpaceId` from params, read optional stored `actorId`, call `useSpace`, and render:
  - space title
  - member count
  - current actor display name
  - actor list
  - refresh button
  - simple join form for display name and avatar color
- [ ] Modify `examples/living-wiki/src/app/router.tsx` to import and add the new space route to the route tree.
- [ ] Modify `examples/living-wiki/src/app/routes/index.tsx` to add a create-space form with title, display name, avatar color, and submit button.
- [ ] On successful create, store the returned identity and navigate to `/spaces/${wikiSpaceId}` using TanStack Router navigation.
- [ ] Preserve the current manual TanStack Router pattern: define the new route with `createRoute`, add it with object `addChildren({ indexRoute, spaceRoute })`, keep the `Register` module declaration, and do not introduce generated route-tree assumptions, `createFileRoute`, or router casts.
- [ ] Keep the existing scaffold/health UI visible or linked from the landing page.
- [ ] Create `examples/living-wiki/src/app/routes/spaces.$wikiSpaceId.test.tsx` or route-component-level tests covering render of loaded space data and join form submission with mocked fetch.
- [ ] Run app tests and make them pass.

## Task 9: Update docs/readme for commands and security boundary

- [ ] Update `examples/living-wiki/README.md` with:
  - commands: `pnpm --filter @electric-ax/example-living-wiki test`, `typecheck`, `build`, `dev`.
  - API list: REST and tRPC create/join/get endpoints.
  - a short statement that this slice uses a local demo Worker adapter and does not persist across Worker isolates or deploys.
  - a security note that Electric Cloud token is configured only as a Worker secret and must not be exposed to browser code or JSON responses.
- [ ] Do not add speculative Electric Cloud endpoint names or deployment claims beyond the already scaffolded Worker boundary.

## Task 10: Full verification

- [ ] Run:

```bash
cd /Users/kylemathews/programs/electric/.worktrees/living-wiki-scaffold
pnpm --filter @electric-ax/example-living-wiki test
pnpm --filter @electric-ax/example-living-wiki typecheck
pnpm --filter @electric-ax/example-living-wiki build
```

- [ ] If a test runner requires a narrower command because of Worker/browser environment separation, document the exact successful commands in the implementation summary and keep the package `test` script passing if feasible.
- [ ] Manually smoke test local dev:

```bash
pnpm --filter @electric-ax/example-living-wiki dev
```

Then in a browser:

- [ ] Visit `/`.
- [ ] Create a space.
- [ ] Confirm navigation to `/spaces/<id>`.
- [ ] Join as another demo identity.
- [ ] Refresh and confirm get still works within the same local Worker process.
- [ ] Check browser devtools network responses and confirm no Electric Cloud token or secret env values appear.

## Task 11: Self-review and commit

- [ ] Review the diff for accidental `dist/`, `node_modules/`, or generated artifact changes. Revert generated artifacts unless the repo explicitly tracks them for this example.
- [ ] Review all new public types and route names against this plan's API contract.
- [ ] Confirm no browser-side file imports `src/worker/env.ts` or reads `ELECTRIC_CLOUD_API_TOKEN`.
- [ ] Confirm REST and tRPC behavior match for create/join/get success and not-found cases.
- [ ] Confirm the local demo adapter is clearly named and not represented as durable storage.
- [ ] Run a final wording scan for common postponed-work labels and remove or rephrase any that are not part of quoted instructions or historical docs.
- [ ] Commit only after tests/typecheck/build pass:

```bash
git status --short
git add examples/living-wiki docs/superpowers/plans/2026-06-03-living-wiki-api-boundary.md
git commit -m "Add living wiki API boundary slice"
```

## Acceptance criteria

- Worker REST endpoints support create, join, and get for demo WikiSpaces.
- tRPC procedures support equivalent create, join, and get operations.
- Shared request/response types and validation are used consistently by Worker and client utilities.
- The frontend can create a space, navigate to `/spaces/:wikiSpaceId`, read it back, and join it through Worker calls.
- Tests cover Worker adapter logic, REST/tRPC API behavior, session helpers, client wrapper, hooks, and the space route.
- Electric Cloud token and secret config remain Worker-only and are absent from browser responses.
- No full Electric Agents entity implementation is required for this slice.
