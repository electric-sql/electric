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
- REST health/proxy routes

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

- `POST /api/spaces` creates a demo WikiSpace.
- `POST /api/spaces/:wikiSpaceId/join` joins an existing demo WikiSpace.
- `GET /api/spaces/:wikiSpaceId` gets a demo WikiSpace. Pass `actorId` as a query parameter when reading as a specific demo actor.

### tRPC procedures

- `space.create` creates a demo WikiSpace.
- `space.join` joins an existing demo WikiSpace.
- `space.get` gets a demo WikiSpace.

This slice uses a local demo Worker adapter (`LocalDemoWikiSpaceStore`) backed by Worker-local memory. It is intended for the scaffolded create/join/get flow only and does not persist across Worker isolates or deploys.

## Security boundary

Configure `ELECTRIC_CLOUD_API_TOKEN` only as a Worker secret. Do not import it into browser code, expose it through public configuration, or include it in JSON responses. Browser-facing REST and tRPC responses should contain only the data needed by the Living Wiki UI.
