# Living Wiki entity lane discovery

Date: 2026-06-03

Scope: Lane A Task A1 discovery for a minimal `WikiSpace` Agents entity plus inert role/manual scaffold. This note records only APIs and implementation constraints confirmed from repository source.

## Files/source read

- `docs/superpowers/plans/2026-06-03-living-wiki-entity-and-live-ui.md`
- `docs/superpowers/specs/2026-06-02-living-wiki-demo-plan.md`
- `packages/agents/skills/quickstart.md`
- `packages/agents/skills/quickstart/scaffold/server.ts` via quickstart excerpts
- `packages/agents-runtime/src/index.ts`
- `packages/agents-runtime/src/types.ts`
- `packages/agents-runtime/src/process-wake.ts`
- `packages/agents-runtime/src/define-entity.ts`
- `packages/agents-runtime/src/entity-stream-db.ts` indirectly through runtime exports and `process-wake` wiring
- `packages/agents-runtime/src/observation-sources.ts`
- `examples/deep-survey/src/server/schema.ts`
- `examples/deep-survey/src/server/index.ts`
- `examples/deep-survey/src/server/orchestrator.ts`
- `examples/deep-survey/src/server/survey-worker.ts`
- `examples/deep-survey/src/server/shared-tools.ts`
- `examples/deep-survey/src/server/explorer.ts`
- `examples/deep-survey/src/server/model-config.ts`
- `examples/living-wiki/src/shared/wiki-state.ts`
- `examples/living-wiki/src/shared/wiki-state-ids.ts`
- `examples/living-wiki/src/shared/wiki-state-events.ts`
- `examples/living-wiki/package.json`

No `packages/agents-runtime/src/agent.ts` file is present in this worktree.

## Confirmed Agents runtime APIs/imports

### Entity definition/registration

Confirmed imports from `@electric-ax/agents-runtime`:

```ts
import type { EntityRegistry } from '@electric-ax/agents-runtime'
```

Registering into an app-owned registry is the documented/example pattern:

```ts
export function registerWikiSpace(registry: EntityRegistry): void {
  registry.define('wiki_space', {
    description: '...',
    async handler(ctx, wake) {
      // handler body
    },
  })
}
```

The concrete implementation is `EntityRegistry#define(name, definition)` in `packages/agents-runtime/src/define-entity.ts`. The definition supports:

- `description?: string`
- `creationSchema?: StandardTypedV1` such as Zod, with parsed args exposed as `ctx.args`
- `state?: Record<string, { schema?, type?, primaryKey? }>` for entity-local state
- `actions?: EntityActionsFactory`
- `handler(ctx, wake)`

The runtime also exports `createEntityRegistry`, `defineEntity`, `resolveDefine`, and default-registry helpers. Existing examples prefer accepting an `EntityRegistry` and calling `registry.define(...)`.

### Runtime/server wiring

Confirmed server entry pattern from `examples/deep-survey/src/server/index.ts` and quickstart:

```ts
import {
  createEntityRegistry,
  createRuntimeHandler,
} from '@electric-ax/agents-runtime'

const registry = createEntityRegistry()
registerOrchestrator(registry)
registerSurveyWorker(registry)

const runtime = createRuntimeHandler({
  baseUrl: DARIX_URL,
  serveEndpoint: `${SERVE_URL}/webhook`,
  registry,
})

// Node HTTP example:
if (req.url === `/webhook` && req.method === `POST`) {
  await runtime.onEnter(req, res)
}
```

`processWake(notification, { baseUrl, registry, ... })` is lower-level wake processing and is invoked by the runtime handler path. Minimal Living Wiki entity code should not call `processWake` directly unless adding a dedicated runtime host; this task can unit-test registration and handler shape without a live webhook server.

### Wake handling/no-op behavior

The handler receives `(ctx, wake)`, where `wake` is a `WakeEvent` with `source`, `type`, offsets, optional `payload`, and optional `summary/fullRef`. Confirmed handler context fields include:

- `ctx.firstWake: boolean`
- `ctx.entityUrl`, `ctx.entityType`, `ctx.args`
- `ctx.events`
- `ctx.mkdb(id, schema)`
- `ctx.observe(source, opts?)`
- `ctx.sleep()`
- `ctx.recordRun()` for non-LLM runs
- `ctx.useAgent(...)` and `ctx.agent.run()` for LLM agents

Safe inert behavior for this phase: handler may derive ids, optionally call `ctx.mkdb(...)` only when a real runtime is intentionally being exercised, and return or `ctx.sleep()`. Avoid `ctx.useAgent()`/`ctx.agent.run()` because manuals are inert and this phase excludes LLM work.

### Shared-state create/observe APIs

Confirmed imports:

```ts
import { db } from '@electric-ax/agents-runtime'
import type { SharedStateHandle } from '@electric-ax/agents-runtime'
```

Create/register a shared state stream during a wake:

```ts
const shared = ctx.mkdb(sharedStateId, sharedStateSchemaMap)
```

Observe/connect a shared state stream during a wake:

```ts
const shared = await ctx.observe(db(sharedStateId, sharedStateSchemaMap))
```

Observed writes use collection proxies, e.g. from Deep Survey:

```ts
shared.wiki.insert(row)
shared.xrefs.insert(row)
```

The schema expected by `ctx.mkdb`/`db(id, schema)` is a `SharedStateSchemaMap`: a map of collection names to `{ schema?, type, primaryKey }`. Living Wiki should pass `livingWikiStateCollections` from `examples/living-wiki/src/shared/wiki-state.ts`, not `livingWikiStateSchema`, because `livingWikiStateSchema` is the `createStateSchema(...)` action/event builder surface used by helpers like `buildActivityEventInsertEvent(...)`.

### Manuals/roles

No dedicated runtime API for manuals, roles, or instruction packs was found in the inspected runtime/entity examples. Existing role-like instructions are ordinary exported prompt strings/functions or tool descriptions, e.g. Deep Survey's `ORCHESTRATOR_SYSTEM_PROMPT` and `EXPLORER_SYSTEM_PROMPT`. Therefore, Living Wiki manuals should be plain TypeScript modules exporting typed constants/arrays for tests and future agent prompts. They should not be registered with the Agents runtime in this phase.

## Recommended Living Wiki file structure for Lane A

Use a server-owned directory and keep it separate from browser/app and Worker proxy code:

```text
examples/living-wiki/src/server/
  entities/
    wiki-space.ts          # WIKI_SPACE_ENTITY_TYPE, args schema, registerWikiSpace(...)
  manuals/
    roles.ts               # role ids/names and inert role metadata
    curator.ts             # prompt/manual text for curator
    synthesizer.ts         # prompt/manual text for synthesizer
    reviewer.ts            # prompt/manual text for reviewer
    source-ingester.ts     # prompt/manual text for source-ingester
    index.ts               # aggregate exports
  index.ts                 # optional later runtime registry entry point if a server host is added
```

Tests should live beside server files or in the same package test conventions, e.g.:

```text
examples/living-wiki/src/server/manuals/*.test.ts
examples/living-wiki/src/server/entities/wiki-space.test.ts
```

`examples/living-wiki/package.json` currently does not list `@electric-ax/agents-runtime` as a direct dependency. If A2/A3 adds runtime imports inside the Living Wiki package, add the dependency intentionally or confirm workspace package resolution policy first.

## Minimal WikiSpace entity behavior for A2/A3

Recommended entity type and args:

```ts
export const WIKI_SPACE_ENTITY_TYPE = 'wiki_space'

const wikiSpaceArgsSchema = z.object({
  wikiSpaceId: wikiSpaceIdSchema,
})
```

Minimal registration:

```ts
export function registerWikiSpace(registry: EntityRegistry): void {
  registry.define(WIKI_SPACE_ENTITY_TYPE, {
    description: 'Living Wiki space coordinator scaffold',
    creationSchema: wikiSpaceArgsSchema,
    async handler(ctx) {
      const sharedStateId = deriveLivingWikiSharedStateId(ctx.args.wikiSpaceId)
      // Prefer no real writes in this phase.
      // If runtime stream creation is explicitly desired, call:
      // if (ctx.firstWake) ctx.mkdb(sharedStateId, livingWikiStateCollections)
      ctx.sleep()
    },
  })
}
```

The entity should export a pure helper for testability, e.g. `getWikiSpaceRuntimeIds(wikiSpaceId)` returning `{ wikiSpaceId, entityUrl: `/wiki_space/${...}`, sharedStateId }`, while keeping the handler inert.

## Real shared-state writes: avoid for now

Avoid real shared-state writes in A2/A3. Reasons confirmed from source:

- `ctx.mkdb`/`ctx.observe(db(...))` are real runtime stream APIs; `processWake` wires actual shared state streams and producers.
- Shared-state writes return transactions and are persisted through runtime producer plumbing.
- The plan explicitly says not to write to a real stream unless A1 confirms a safe/testable local helper and tests use fakes.

A safe A3 can derive `deriveLivingWikiSharedStateId(wikiSpaceId)`, export registration shape, and optionally call `ctx.mkdb(sharedStateId, livingWikiStateCollections)` only in handler code that is unit-tested with a fake `ctx`. Do not insert `wiki_spaces`, `actors`, `activity_events`, `agent_runs`, or any other real rows yet.

If a single status/activity event is desired later, use the existing helper `buildActivityEventRow(...)` or `buildActivityEventInsertEvent(...)`, but only with fake writes in tests until an integration runtime harness is chosen.

## Test strategy

- Manual scaffold tests:
  - role ids are exactly `curator`, `synthesizer`, `reviewer`, `source-ingester`;
  - manuals include explicit constraints: no external fetches, no LLM calls, no graph generation, no review resolution;
  - aggregate exports are stable and contain all roles.
- Entity registration tests:
  - create a real `EntityRegistry`, call `registerWikiSpace(registry)`, assert `registry.get(WIKI_SPACE_ENTITY_TYPE)` exists;
  - assert `description` and `creationSchema` are present;
  - parse valid/invalid `wikiSpaceId` through the creation schema;
  - invoke handler with a minimal fake `ctx` if the implementation remains no-op, asserting shared-state id derivation and no `useAgent`, `spawn`, `send`, or shared insert calls;
  - assert `deriveLivingWikiSharedStateId('wiki_demo') === 'living-wiki:wiki_demo'`.
- Boundary tests/scans:
  - server entity/manual code must not import app/browser hooks, Worker env/proxy internals, or upstream secret names;
  - browser/app code should not import server entity/manual modules.
- Suggested commands after A2/A3:

```bash
pnpm --filter @electric-ax/example-living-wiki test src/server
pnpm --filter @electric-ax/example-living-wiki typecheck
```

## Uncertainties/blockers

- There is no confirmed first-class manuals/roles API in the runtime; manuals are plain code/text exports unless later docs identify another convention.
- Living Wiki currently has a Cloudflare Worker app but no `src/server` runtime host. A3 can add entity modules and tests without integrating a Node `createRuntimeHandler` server. Actual runtime hosting/deployment for the entity needs a separate plan decision.
- Direct package dependency on `@electric-ax/agents-runtime` is absent from `examples/living-wiki/package.json`; A2/A3 should either add it or confirm workspace dependency policy.
- `livingWikiStateCollections` is the correct schema-map-shaped export for `ctx.mkdb`/`db(...)`; `livingWikiStateSchema` remains useful for local event builders. If TypeScript rejects `livingWikiStateCollections` against `SharedStateSchemaMap` because of type-package differences, add a narrow type assertion or exported type in the implementation rather than changing collection names.
