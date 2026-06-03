# Living Wiki Demo

Wrangler + Vite + React scaffold for the Living Wiki Electric Agents demo.

## Stack

- Cloudflare Workers / Wrangler
- Vite
- React
- TanStack Router
- TanStack DB / React DB
- Base UI
- Inter font
- tRPC
- REST health routes and WikiSpace API routes

## Local development

Install dependencies from the repo root:

```bash
pnpm install
```

Run the Vite dev server and local Worker together:

```bash
pnpm --filter @electric-ax/example-living-wiki dev
```

Or run them separately:

```bash
pnpm --filter @electric-ax/example-living-wiki dev:vite
pnpm --filter @electric-ax/example-living-wiki dev:worker
```

`dev:worker` builds the Vite client assets before starting Wrangler so a fresh checkout has the required Worker static assets.

Frontend: http://localhost:5177  
Worker: http://localhost:8787

## Commands

```bash
pnpm --filter @electric-ax/example-living-wiki test
pnpm --filter @electric-ax/example-living-wiki typecheck
pnpm --filter @electric-ax/example-living-wiki build
pnpm --filter @electric-ax/example-living-wiki dev
```

## Checks

```bash
pnpm --filter @electric-ax/example-living-wiki test
pnpm --filter @electric-ax/example-living-wiki typecheck
pnpm --filter @electric-ax/example-living-wiki build
```

## Deploy

```bash
pnpm --filter @electric-ax/example-living-wiki deploy
```

Set production secrets before deploying:

```bash
cd examples/living-wiki
pnpm wrangler secret put ELECTRIC_CLOUD_API_TOKEN
```

## API boundary

The browser calls the Worker through `/api/*` REST endpoints and `/trpc/*` tRPC procedures. The browser must not receive Electric Cloud secrets.

### REST endpoints

- `GET /api/health` returns Worker health status.
- `POST /api/spaces` creates a demo WikiSpace.
- `POST /api/spaces/:wikiSpaceId/join` joins an existing demo WikiSpace.
- `GET /api/spaces/:wikiSpaceId` gets a demo WikiSpace. Pass `actorId` as a query parameter when reading as a specific demo actor.
- `GET /api/spaces/:wikiSpaceId/shared-state-snapshot` returns Worker-local demo shared-state rows for the dashboard fallback path.
- `POST /api/spaces/:wikiSpaceId/sources` stores a submitted text or URL source row without fetching, scraping, digesting, or calling an LLM.

### tRPC procedures

- `health` returns Worker health status.
- `space.create` creates a demo WikiSpace.
- `space.join` joins an existing demo WikiSpace.
- `space.get` gets a demo WikiSpace.

This slice uses local demo Worker adapters (`LocalDemoWikiSpaceStore` and `LocalDemoWikiStateProducer`) backed by Worker-local memory. Create/join bootstraps `wiki_spaces`, `actors`, `memberships`, and `activity_events` rows; source submission stores `submitted` source metadata plus a `source_submitted` activity event. It is intended for the scaffolded demo flow only and does not persist across Worker isolates or deploys.

## Electric Agents Proxy Boundary

The Worker proxies Electric Agents runtime streams so the browser never contacts the Agents upstream directly.

### Environment Variables (Worker-only)

| Variable                        | Required        | Description                                                               |
| ------------------------------- | --------------- | ------------------------------------------------------------------------- |
| `ELECTRIC_AGENTS_BASE_URL`      | Yes (for proxy) | Electric Agents runtime base URL. Worker-only — never exposed to browser. |
| `ELECTRIC_AGENTS_TOKEN`         | No              | Bearer token for Agents runtime auth. Injected server-side.               |
| `ELECTRIC_AGENTS_PRINCIPAL_KEY` | No              | Principal key header value. Injected server-side.                         |

### Proxy Routes

**Entity Main Stream**

```
GET /api/agents/entities/:wikiSpaceId/:entityKind/:entityId/stream
```

Proxies the main durable stream for a specific entity. The Worker resolves the upstream entity metadata path, looks up the stream URL, and proxies it with server-side auth. Currently supports `entityKind: wiki-space`.

Query params forwarded: `offset`, `live` (only `long-poll`), `cursor`.

**Observe Stream**

```
GET /api/observe/:wikiSpaceId/:observeKind
```

Proxies observation streams for a wiki space. `observeKind` is one of:

- `entities` — membership stream (Worker ensures the stream with server-derived tags)
- `shared-state` — shared state stream (Worker derives the shared-state ID)

Query params forwarded: `offset`, `live` (only `long-poll`), `cursor`.

### Browser Client Helpers

```typescript
import { getEntityStreamUrl, getObserveUrl } from './app/api/agentsProxyApi'

// Entity stream URL
const streamUrl = getEntityStreamUrl({
  wikiSpaceId: 'wiki_demo',
  entityKind: 'wiki-space',
  entityId: 'entity_123',
})
// → /api/agents/entities/wiki_demo/wiki-space/entity_123/stream

// Observe URL with protocol params
const observeUrl = getObserveUrl(
  { wikiSpaceId: 'wiki_demo', observeKind: 'entities' },
  { offset: '0', live: 'long-poll' }
)
// → /api/observe/wiki_demo/entities?offset=0&live=long-poll
```

### Security Invariants

- Browser code must use `/api/agents/...` and `/api/observe/...` routes, never the Electric Agents upstream base URL
- All upstream auth (token, principal) is injected server-side — never sent to or readable by the browser
- Only allowlisted query params are forwarded; arbitrary params like `table`, `where`, `path` are dropped
- Browser request headers (`authorization`, `cookie`, etc.) are never forwarded upstream
- Response headers `content-encoding` and `content-length` are stripped from proxied responses
- Entity kinds and observe kinds are validated against an allowlist; unknown kinds return 400
- Route parameter IDs are validated to be URL-safe with no path traversal

### Test Commands

```bash
# Run proxy boundary tests
pnpm --filter @electric-ax/example-living-wiki test src/worker/agents-proxy/
pnpm --filter @electric-ax/example-living-wiki test src/app/api/agentsProxyApi.test.ts
pnpm --filter @electric-ax/example-living-wiki test src/shared/agents-proxy.test.ts

# Run all tests
pnpm --filter @electric-ax/example-living-wiki test
```

## Living Wiki Shared State

Living Wiki shared-state rows are defined in `src/shared/wiki-state.ts` and observed in the browser through the Worker proxy route:

```text
GET /api/observe/:wikiSpaceId/shared-state
```

The current shared-state schema includes:

- `wiki_spaces`
- `actors`
- `memberships`
- `activity_events`
- `sources`
- `wiki_pages`
- `wiki_links`
- `review_items`
- `agent_runs`

Browser code can use `createLivingWikiStateDb` from `src/app/db/wikiStateDb.ts` to create a typed stream DB for the real observe path. The helper calls `createStreamDB` with the Worker-local observe URL and does not call `preload()` automatically. While the demo Worker is still backed by local memory rather than a real shared-state producer, the route uses `GET /api/spaces/:wikiSpaceId/shared-state-snapshot` as a clearly named fallback read path.

```typescript
import { createLivingWikiStateDb } from './app/db/wikiStateDb'

const db = createLivingWikiStateDb({ wikiSpaceId: 'wiki_demo' })
```

Shared event helpers live in `src/shared/wiki-state-events.ts`. They build validated rows and durable insert events without appending to a real stream.

```typescript
import { buildActivityEventRow } from './shared/wiki-state-events'

const event = buildActivityEventRow({
  wiki_space_id: 'wiki_demo',
  actor_id: 'actor_alice',
  actor_kind: 'human',
  event_type: 'space_joined',
  summary: 'Alice joined the workspace',
  subject_type: 'membership',
  subject_id: 'membership_wiki_demo_actor_alice',
})
```

Shared-state security invariants:

- Browser code observes shared state only through `/api/observe/:wikiSpaceId/shared-state`.
- Browser code must not import Worker env modules or Agents proxy internals.
- Browser helpers must not expose raw `living-wiki:*` shared-state IDs, `/_electric/shared-state` paths, upstream Agents URLs, tokens, or principal keys.

Shared-state test commands:

```bash
pnpm --filter @electric-ax/example-living-wiki test src/shared/wiki-state.test.ts src/shared/wiki-state-ids.test.ts src/shared/wiki-state-events.test.ts src/app/db/wikiStateDb.test.ts
pnpm --filter @electric-ax/example-living-wiki test
pnpm --filter @electric-ax/example-living-wiki typecheck
```

## Entity and Dashboard Scaffold

The current server-side Agents scaffold lives under `src/server/**`. It defines an inert `wiki_space` entity registration and role/manual text modules for:

- curator
- synthesizer
- reviewer
- source-ingester

This scaffold does not host a runtime webhook yet and does not run LLMs, ingest sources, generate graph content, resolve reviews, or orchestrate roles. The `wiki_space` handler only derives the per-space shared-state identity and registers the shared-state collection map on first wake; tests use fake runtime context objects.

```typescript
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import { registerWikiSpace } from './server/entities/wiki-space'

const registry = createEntityRegistry()
registerWikiSpace(registry)
```

The `/spaces/:wikiSpaceId` route now renders a read-only shared-state dashboard shell. Dashboard selectors and components live under:

- `src/app/selectors/wikiStateViewModels.ts`
- `src/app/components/wiki-state/*`

The dashboard has two read paths: `useLivingWikiStateViewModels` wires the future live StreamDB observe path, while the current route uses `useLivingWikiStateSnapshot` to read Worker-local demo rows from the fallback snapshot endpoint. The dashboard remains read-only: it does not mutate shared state directly or send entity commands.

The source submission form posts to the Worker API and stores only submitted text/URL metadata. URL submissions are not fetched or scraped, text submissions are bounded, and no digesting, LLM calls, graph/page generation, review resolution, or role orchestration is implemented in this slice.

Entity/dashboard test commands:

```bash
pnpm --filter @electric-ax/example-living-wiki test src/server src/app/selectors src/app/components/wiki-state 'src/app/routes/spaces.$wikiSpaceId.test.tsx'
pnpm --filter @electric-ax/example-living-wiki test
pnpm --filter @electric-ax/example-living-wiki typecheck
```

## Security boundary

Configure `ELECTRIC_CLOUD_API_TOKEN` only as a Worker secret. Do not import it into browser code, expose it through public configuration, or include it in JSON responses. Browser-facing REST and tRPC responses should contain only the data needed by the Living Wiki UI.

### Manual page proposal and review flow

The demo dashboard can now turn a submitted source into a proposed wiki page and an open page review item through Worker-local REST endpoints. The proposal is deterministic and manual-review oriented: text sources use only the stored `text_preview`, while URL sources use only submitted URL metadata. URL sources are not fetched, scraped, or digested, and no LLM/AI generation is performed.

Any local demo human actor that belongs to the space may approve or reject an open page review. Approval marks the review `approved` and the page `canonical`; rejection marks the review `rejected` and the page `rejected`. This remains an in-memory demo flow only. Graph/link generation, source digesting, LLM calls, Agents runtime role orchestration, upstream shared-state writes, and durable persistence are not implemented in this phase.
