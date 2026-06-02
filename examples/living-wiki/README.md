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

Frontend: http://localhost:5177  
Worker: http://localhost:8787

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

The browser calls the Worker through `/api/*` REST endpoints and `/trpc/*` tRPC procedures. The browser must not receive Electric Cloud secrets. Later phases will add Worker proxy methods for Electric Agents space creation, entity messaging, and shared-state access.
