# Living Wiki Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable Living Wiki demo scaffold: a Wrangler/Cloudflare Worker + Vite/React/TanStack Router frontend with tRPC/REST health routes, Base UI/Inter styling, TanStack DB scaffold wiring, and local/prod commands.

**Architecture:** Create a new workspace example at `examples/living-wiki`. The browser runs a Vite React app with TanStack Router and calls a Cloudflare Worker API. The Worker exposes tRPC and REST health/config routes now, with an Electric Cloud proxy boundary stubbed behind typed environment config for later phases.

**Tech Stack:** pnpm workspace, TypeScript, Vite, React 19, TanStack Router, TanStack DB/React DB, Base UI, Inter font via CSS import, Cloudflare Workers, Wrangler, tRPC, Zod, Vitest.

---

## Scope

This plan intentionally covers only the scaffold/API foundation. It does **not** implement Electric Agent entities, Electric Cloud mutations, shared-state schema, graph rendering, intake, reviews, or agent chat. Those require later plans after this app shell is buildable and deployable.

## Files and responsibilities

Create these files:

- `examples/living-wiki/package.json` — package scripts and dependencies for the demo workspace.
- `examples/living-wiki/tsconfig.json` — TypeScript config extending repo base config.
- `examples/living-wiki/vite.config.ts` — Vite React config for frontend build and dev server.
- `examples/living-wiki/wrangler.toml` — Cloudflare Worker config, asset binding, local vars.
- `examples/living-wiki/index.html` — Vite app HTML entry.
- `examples/living-wiki/public/_headers` — minimal static/security headers for deployed assets.
- `examples/living-wiki/src/app/main.tsx` — React app bootstrap.
- `examples/living-wiki/src/app/router.tsx` — TanStack Router setup.
- `examples/living-wiki/src/app/routes/__root.tsx` — root route shell.
- `examples/living-wiki/src/app/routes/index.tsx` — landing page route.
- `examples/living-wiki/src/app/components/AppShell.tsx` — shared layout component.
- `examples/living-wiki/src/app/components/HealthPanel.tsx` — frontend component that calls tRPC and REST health endpoints.
- `examples/living-wiki/src/app/styles/globals.css` — Inter import and base visual tokens.
- `examples/living-wiki/src/shared/trpc.ts` — shared tRPC router type/client helpers.
- `examples/living-wiki/src/shared/db.ts` — TanStack DB scaffold exports for later collections.
- `examples/living-wiki/src/shared/types.ts` — shared environment/health types.
- `examples/living-wiki/src/worker/env.ts` — typed Cloudflare environment bindings.
- `examples/living-wiki/src/worker/trpc-router.ts` — tRPC router with health/config procedures.
- `examples/living-wiki/src/worker/routes.ts` — REST routing helpers.
- `examples/living-wiki/src/worker/electric-cloud.ts` — Electric Cloud proxy boundary stub.
- `examples/living-wiki/src/worker/index.ts` — Cloudflare Worker fetch handler.
- `examples/living-wiki/src/worker/index.test.ts` — Worker health route tests.
- `examples/living-wiki/src/app/components/HealthPanel.test.tsx` — frontend health panel test.
- `examples/living-wiki/vitest.config.ts` — Vitest config for worker/app tests.

Modify these files:

- `docs/superpowers/specs/2026-06-02-living-wiki-demo-plan.md` — add a note that the detailed scaffold plan lives in `docs/superpowers/plans/2026-06-02-living-wiki-scaffold.md`.

Do not modify these files in this plan:

- root `package.json`
- `pnpm-workspace.yaml`
- existing examples

The repo already includes `examples/*` in `pnpm-workspace.yaml`, so `examples/living-wiki` is automatically a workspace package after creation.

## Task 1: Create package, TypeScript, Vite, Wrangler, and HTML skeleton

**Files:**

- Create: `examples/living-wiki/package.json`
- Create: `examples/living-wiki/tsconfig.json`
- Create: `examples/living-wiki/vite.config.ts`
- Create: `examples/living-wiki/wrangler.toml`
- Create: `examples/living-wiki/index.html`
- Create: `examples/living-wiki/public/_headers`

- [ ] **Step 1: Create the example directory**

Run:

```bash
cd /Users/kylemathews/programs/electric
mkdir -p examples/living-wiki/public examples/living-wiki/src/{app,shared,worker}
```

Expected: command exits 0.

- [ ] **Step 2: Create `package.json`**

Write `examples/living-wiki/package.json`:

```json
{
  "name": "@electric-ax/example-living-wiki",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "concurrently \"pnpm run dev:vite\" \"pnpm run dev:worker\"",
    "dev:vite": "vite --host 0.0.0.0",
    "dev:worker": "pnpm build && wrangler dev --local --port 8787",
    "build": "vite build",
    "deploy": "pnpm build && wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "preview": "vite preview"
  },
  "dependencies": {
    "@base-ui/react": "^1.4.1",
    "@tanstack/db": "^0.6.6",
    "@tanstack/react-db": "^0.1.78",
    "@tanstack/react-router": "^1.139.7",
    "@trpc/client": "^11.7.2",
    "@trpc/server": "^11.7.2",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.8.80",
    "@cloudflare/workers-types": "^4.20251202.0",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.0",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.2.0",
    "concurrently": "^9.2.1",
    "jsdom": "^27.0.0",
    "typescript": "^5.7.0",
    "vite": "^7.2.4",
    "vitest": "^4.0.15",
    "wrangler": "^4.49.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

Write `examples/living-wiki/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types", "vitest/globals"],
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "baseUrl": ".",
    "paths": {
      "@app/*": ["src/app/*"],
      "@shared/*": ["src/shared/*"],
      "@worker/*": ["src/worker/*"]
    }
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 4: Create `vite.config.ts`**

Write `examples/living-wiki/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5177,
    proxy: {
      '/api': 'http://localhost:8787',
      '/trpc': 'http://localhost:8787',
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
})
```

- [ ] **Step 5: Create `wrangler.toml`**

Write `examples/living-wiki/wrangler.toml`:

```toml
name = "living-wiki-demo"
main = "src/worker/index.ts"
compatibility_date = "2026-06-02"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "./dist/client"
binding = "ASSETS"
not_found_handling = "single-page-application"

[vars]
APP_ENV = "local"
ELECTRIC_CLOUD_API_URL = "https://api.electric-sql.cloud"
ELECTRIC_AGENTS_SPACE_ID = "local-dev-space"
ENABLE_SEEDED_DEMO = "true"
```

Secrets to configure later with `wrangler secret put`:

```bash
ELECTRIC_CLOUD_API_TOKEN
```

- [ ] **Step 6: Create `index.html`**

Write `examples/living-wiki/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Living Wiki Demo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/app/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `_headers`**

Write `examples/living-wiki/public/_headers`:

```text
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
```

- [ ] **Step 8: Install dependencies**

Run:

```bash
cd /Users/kylemathews/programs/electric
pnpm install
```

Expected: lockfile updates successfully and no install errors.

- [ ] **Step 9: Typecheck expected failure**

Run:

```bash
cd /Users/kylemathews/programs/electric
pnpm --filter @electric-ax/example-living-wiki typecheck
```

Expected: FAIL because app/worker source files do not exist yet. Continue to Task 2.

- [ ] **Step 10: Commit Task 1**

Run:

```bash
cd /Users/kylemathews/programs/electric
git add examples/living-wiki/package.json examples/living-wiki/tsconfig.json examples/living-wiki/vite.config.ts examples/living-wiki/wrangler.toml examples/living-wiki/index.html examples/living-wiki/public/_headers pnpm-lock.yaml
git commit -m "feat(living-wiki): scaffold workspace config"
```

Expected: commit succeeds.

## Task 2: Add shared types, Electric Cloud proxy stub, REST health route, and Worker entrypoint

**Files:**

- Create: `examples/living-wiki/src/shared/types.ts`
- Create: `examples/living-wiki/src/worker/env.ts`
- Create: `examples/living-wiki/src/worker/electric-cloud.ts`
- Create: `examples/living-wiki/src/worker/routes.ts`
- Create: `examples/living-wiki/src/worker/index.ts`
- Create: `examples/living-wiki/src/worker/index.test.ts`
- Create: `examples/living-wiki/vitest.config.ts`

- [ ] **Step 1: Write failing Worker health tests**

Create `examples/living-wiki/src/worker/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import worker from './index'

const env = {
  APP_ENV: 'test',
  ELECTRIC_CLOUD_API_URL: 'https://api.example.test',
  ELECTRIC_CLOUD_API_TOKEN: 'test-token',
  ELECTRIC_AGENTS_SPACE_ID: 'space_test',
  ENABLE_SEEDED_DEMO: 'true',
} satisfies Record<string, string>

describe('living wiki worker', () => {
  it('returns REST health JSON', async () => {
    const request = new Request('https://living-wiki.test/api/health')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      app: 'living-wiki',
      env: 'test',
      electricCloudConfigured: true,
      seededDemoEnabled: true,
    })
  })

  it('returns 404 JSON for unknown API routes', async () => {
    const request = new Request('https://living-wiki.test/api/missing')
    const response = await worker.fetch(request, env, {} as ExecutionContext)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'Not found',
    })
  })
})
```

- [ ] **Step 2: Create Vitest config**

Write `examples/living-wiki/vitest.config.ts`:

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: [],
  },
})
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
cd /Users/kylemathews/programs/electric
pnpm --filter @electric-ax/example-living-wiki test -- src/worker/index.test.ts
```

Expected: FAIL with module resolution error for `./index`.

- [ ] **Step 4: Create shared types**

Write `examples/living-wiki/src/shared/types.ts`:

```ts
export type AppEnvName = 'local' | 'test' | 'preview' | 'production' | string

export type HealthResponse = {
  ok: true
  app: 'living-wiki'
  env: AppEnvName
  electricCloudConfigured: boolean
  electricAgentsSpaceId: string
  seededDemoEnabled: boolean
}

export type ErrorResponse = {
  ok: false
  error: string
}
```

- [ ] **Step 5: Create Worker env type**

Write `examples/living-wiki/src/worker/env.ts`:

```ts
export type WorkerEnv = {
  ASSETS?: Fetcher
  APP_ENV: string
  ELECTRIC_CLOUD_API_URL: string
  ELECTRIC_CLOUD_API_TOKEN?: string
  ELECTRIC_AGENTS_SPACE_ID: string
  ENABLE_SEEDED_DEMO?: string
}

export function isSeededDemoEnabled(env: WorkerEnv): boolean {
  return env.ENABLE_SEEDED_DEMO === 'true'
}
```

- [ ] **Step 6: Create Electric Cloud proxy boundary stub**

Write `examples/living-wiki/src/worker/electric-cloud.ts`:

```ts
import type { WorkerEnv } from './env'

export type ElectricCloudConfig = {
  apiUrl: string
  hasToken: boolean
  agentsSpaceId: string
}

export function getElectricCloudConfig(env: WorkerEnv): ElectricCloudConfig {
  return {
    apiUrl: env.ELECTRIC_CLOUD_API_URL,
    hasToken: Boolean(env.ELECTRIC_CLOUD_API_TOKEN),
    agentsSpaceId: env.ELECTRIC_AGENTS_SPACE_ID,
  }
}
```

- [ ] **Step 7: Create REST routes**

Write `examples/living-wiki/src/worker/routes.ts`:

```ts
import type { ErrorResponse, HealthResponse } from '../shared/types'
import { getElectricCloudConfig } from './electric-cloud'
import { isSeededDemoEnabled, type WorkerEnv } from './env'

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init?.headers ?? {}),
    },
  })
}

export function healthResponse(env: WorkerEnv): HealthResponse {
  const electric = getElectricCloudConfig(env)

  return {
    ok: true,
    app: 'living-wiki',
    env: env.APP_ENV,
    electricCloudConfigured: electric.hasToken,
    electricAgentsSpaceId: electric.agentsSpaceId,
    seededDemoEnabled: isSeededDemoEnabled(env),
  }
}

export async function handleRestRequest(
  request: Request,
  env: WorkerEnv
): Promise<Response | undefined> {
  const url = new URL(request.url)

  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json(healthResponse(env))
  }

  if (url.pathname.startsWith('/api/')) {
    const body: ErrorResponse = { ok: false, error: 'Not found' }
    return json(body, { status: 404 })
  }

  return undefined
}
```

- [ ] **Step 8: Create Worker entrypoint**

Write `examples/living-wiki/src/worker/index.ts`:

```ts
import { handleRestRequest } from './routes'
import type { WorkerEnv } from './env'

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const restResponse = await handleRestRequest(request, env)
    if (restResponse) return restResponse

    if (env.ASSETS) {
      return env.ASSETS.fetch(request)
    }

    return new Response('Living Wiki API', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  },
}
```

- [ ] **Step 9: Run Worker health tests**

Run:

```bash
cd /Users/kylemathews/programs/electric
pnpm --filter @electric-ax/example-living-wiki test -- src/worker/index.test.ts
```

Expected: PASS, 2 tests pass.

- [ ] **Step 10: Typecheck**

Run:

```bash
cd /Users/kylemathews/programs/electric
pnpm --filter @electric-ax/example-living-wiki typecheck
```

Expected: may still FAIL because frontend files do not exist. Continue to Task 3.

- [ ] **Step 11: Commit Task 2**

Run:

```bash
cd /Users/kylemathews/programs/electric
git add examples/living-wiki/src/shared/types.ts examples/living-wiki/src/worker/env.ts examples/living-wiki/src/worker/electric-cloud.ts examples/living-wiki/src/worker/routes.ts examples/living-wiki/src/worker/index.ts examples/living-wiki/src/worker/index.test.ts examples/living-wiki/vitest.config.ts
git commit -m "feat(living-wiki): add worker health boundary"
```

Expected: commit succeeds.

## Task 3: Add tRPC router and client helpers

**Files:**

- Create: `examples/living-wiki/src/worker/trpc-router.ts`
- Modify: `examples/living-wiki/src/worker/index.ts`
- Create: `examples/living-wiki/src/shared/trpc.ts`
- Modify: `examples/living-wiki/src/worker/index.test.ts`

- [ ] **Step 1: Add failing tRPC health test**

Append this test to `examples/living-wiki/src/worker/index.test.ts` inside the `describe` block:

```ts
it('returns tRPC health JSON', async () => {
  const request = new Request('https://living-wiki.test/trpc/health', {
    method: 'GET',
  })
  const response = await worker.fetch(request, env, {} as ExecutionContext)

  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.result.data).toMatchObject({
    ok: true,
    app: 'living-wiki',
    env: 'test',
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/kylemathews/programs/electric
pnpm --filter @electric-ax/example-living-wiki test -- src/worker/index.test.ts
```

Expected: FAIL because `/trpc/health` returns non-tRPC fallback.

- [ ] **Step 3: Create tRPC router**

Write `examples/living-wiki/src/worker/trpc-router.ts`:

```ts
import { initTRPC } from '@trpc/server'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { healthResponse } from './routes'
import type { WorkerEnv } from './env'

export type TrpcContext = {
  env: WorkerEnv
}

const t = initTRPC.context<TrpcContext>().create()

export const appRouter = t.router({
  health: t.procedure.query(({ ctx }) => healthResponse(ctx.env)),
})

export type AppRouter = typeof appRouter

export function handleTrpcRequest(
  request: Request,
  env: WorkerEnv
): Promise<Response> {
  return fetchRequestHandler({
    endpoint: '/trpc',
    req: request,
    router: appRouter,
    createContext: () => ({ env }),
  })
}
```

- [ ] **Step 4: Wire tRPC into Worker entrypoint**

Modify `examples/living-wiki/src/worker/index.ts` to exactly:

```ts
import { handleRestRequest } from './routes'
import { handleTrpcRequest } from './trpc-router'
import type { WorkerEnv } from './env'

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/trpc')) {
      return handleTrpcRequest(request, env)
    }

    const restResponse = await handleRestRequest(request, env)
    if (restResponse) return restResponse

    if (env.ASSETS) {
      return env.ASSETS.fetch(request)
    }

    return new Response('Living Wiki API', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  },
}
```

- [ ] **Step 5: Create shared tRPC client helper**

Write `examples/living-wiki/src/shared/trpc.ts`:

```ts
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { AppRouter } from '../worker/trpc-router'

export function createLivingWikiTrpcClient(baseUrl = '') {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl}/trpc`,
      }),
    ],
  })
}
```

- [ ] **Step 6: Run tRPC tests**

Run:

```bash
cd /Users/kylemathews/programs/electric
pnpm --filter @electric-ax/example-living-wiki test -- src/worker/index.test.ts
```

Expected: PASS, 3 tests pass.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
cd /Users/kylemathews/programs/electric
git add examples/living-wiki/src/worker/trpc-router.ts examples/living-wiki/src/worker/index.ts examples/living-wiki/src/shared/trpc.ts examples/living-wiki/src/worker/index.test.ts
git commit -m "feat(living-wiki): add trpc health route"
```

Expected: commit succeeds.

## Task 4: Add React/TanStack Router app shell with Base UI and Inter styling

**Files:**

- Create: `examples/living-wiki/src/app/main.tsx`
- Create: `examples/living-wiki/src/app/router.tsx`
- Create: `examples/living-wiki/src/app/routes/__root.tsx`
- Create: `examples/living-wiki/src/app/routes/index.tsx`
- Create: `examples/living-wiki/src/app/components/AppShell.tsx`
- Create: `examples/living-wiki/src/app/styles/globals.css`

- [ ] **Step 1: Create global styles**

Write `examples/living-wiki/src/app/styles/globals.css`:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

:root {
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
  color: #172033;
  background: #f7f5ef;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  --lw-panel: rgba(255, 255, 255, 0.78);
  --lw-border: rgba(23, 32, 51, 0.12);
  --lw-accent: #5b5ff0;
  --lw-muted: #667085;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
}

button,
input,
textarea {
  font: inherit;
}

.lw-page {
  min-height: 100vh;
  background:
    radial-gradient(
      circle at 20% 20%,
      rgba(91, 95, 240, 0.14),
      transparent 32rem
    ),
    radial-gradient(
      circle at 80% 10%,
      rgba(42, 186, 137, 0.14),
      transparent 28rem
    ),
    #f7f5ef;
}

.lw-shell {
  width: min(1180px, calc(100vw - 32px));
  margin: 0 auto;
  padding: 32px 0;
}

.lw-card {
  border: 1px solid var(--lw-border);
  border-radius: 24px;
  background: var(--lw-panel);
  box-shadow: 0 24px 80px rgba(23, 32, 51, 0.12);
  backdrop-filter: blur(16px);
}
```

- [ ] **Step 2: Create AppShell component**

Write `examples/living-wiki/src/app/components/AppShell.tsx`:

```tsx
import type { ReactNode } from 'react'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <main className="lw-page">
      <div className="lw-shell">{children}</div>
    </main>
  )
}
```

- [ ] **Step 3: Create root route**

Write `examples/living-wiki/src/app/routes/__root.tsx`:

```tsx
import { Outlet, createRootRoute } from '@tanstack/react-router'
import { AppShell } from '../components/AppShell'

export const Route = createRootRoute({
  component: RootRoute,
})

function RootRoute() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
```

- [ ] **Step 4: Create index route**

Write `examples/living-wiki/src/app/routes/index.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: IndexRoute,
})

function IndexRoute() {
  return (
    <section className="lw-card" style={{ padding: 32 }}>
      <p
        style={{
          color: 'var(--lw-muted)',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        Electric Agents Demo
      </p>
      <h1 style={{ fontSize: 56, lineHeight: 1, margin: '12px 0 16px' }}>
        Living Wiki
      </h1>
      <p
        style={{
          color: 'var(--lw-muted)',
          fontSize: 20,
          lineHeight: 1.5,
          maxWidth: 760,
        }}
      >
        A multiplayer substrate-engineering demo where humans and agents compile
        sources into a living wiki graph.
      </p>
      <div id="health-panel-root" />
    </section>
  )
}
```

- [ ] **Step 5: Create router setup**

Write `examples/living-wiki/src/app/router.tsx`:

```tsx
import { createRouter } from '@tanstack/react-router'
import { Route as rootRoute } from './routes/__root'
import { Route as indexRoute } from './routes/index'

const routeTree = rootRoute.addChildren({ indexRoute })

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
```

- [ ] **Step 6: Create React entrypoint**

Write `examples/living-wiki/src/app/main.tsx`:

```tsx
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { router } from './router'
import './styles/globals.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element #root was not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)
```

- [ ] **Step 7: Run typecheck**

Run:

```bash
cd /Users/kylemathews/programs/electric
pnpm --filter @electric-ax/example-living-wiki typecheck
```

Expected: PASS.

- [ ] **Step 8: Run build**

Run:

```bash
cd /Users/kylemathews/programs/electric
pnpm --filter @electric-ax/example-living-wiki build
```

Expected: PASS and writes `examples/living-wiki/dist/client`.

- [ ] **Step 9: Commit Task 4**

Run:

```bash
cd /Users/kylemathews/programs/electric
git add examples/living-wiki/src/app/main.tsx examples/living-wiki/src/app/router.tsx examples/living-wiki/src/app/routes/__root.tsx examples/living-wiki/src/app/routes/index.tsx examples/living-wiki/src/app/components/AppShell.tsx examples/living-wiki/src/app/styles/globals.css
git commit -m "feat(living-wiki): add react router shell"
```

Expected: commit succeeds.

## Task 5: Add frontend health panel using REST and tRPC

**Files:**

- Create: `examples/living-wiki/src/app/components/HealthPanel.tsx`
- Create: `examples/living-wiki/src/app/components/HealthPanel.test.tsx`
- Modify: `examples/living-wiki/src/app/routes/index.tsx`

- [ ] **Step 1: Write failing HealthPanel test**

Write `examples/living-wiki/src/app/components/HealthPanel.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HealthPanel } from './HealthPanel'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('HealthPanel', () => {
  it('renders REST health from the Worker API', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            app: 'living-wiki',
            env: 'test',
            electricCloudConfigured: true,
            electricAgentsSpaceId: 'space_test',
            seededDemoEnabled: true,
          }),
          { headers: { 'content-type': 'application/json' } }
        )
    ) as typeof fetch

    render(<HealthPanel />)

    expect(screen.getByText('Checking Worker API…')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText('Worker API: healthy')).toBeInTheDocument()
    )
    expect(
      screen.getByText('Electric Agents space: space_test')
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/kylemathews/programs/electric
pnpm --filter @electric-ax/example-living-wiki test -- src/app/components/HealthPanel.test.tsx
```

Expected: FAIL because `HealthPanel` does not exist.

- [ ] **Step 3: Create HealthPanel component**

Write `examples/living-wiki/src/app/components/HealthPanel.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { ErrorResponse, HealthResponse } from '../../shared/types'

type HealthState =
  | { status: 'loading' }
  | { status: 'ready'; health: HealthResponse }
  | { status: 'error'; error: string }

export function HealthPanel() {
  const [state, setState] = useState<HealthState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function loadHealth() {
      try {
        const response = await fetch('/api/health')
        const data = (await response.json()) as HealthResponse | ErrorResponse

        if (cancelled) return

        if (!response.ok || !data.ok) {
          setState({
            status: 'error',
            error: data.ok ? 'Unknown error' : data.error,
          })
          return
        }

        setState({ status: 'ready', health: data })
      } catch (error) {
        if (!cancelled) {
          setState({
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }
    }

    void loadHealth()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div
      style={{
        marginTop: 28,
        padding: 20,
        border: '1px solid var(--lw-border)',
        borderRadius: 16,
        background: 'rgba(255,255,255,0.64)',
      }}
    >
      {state.status === 'loading' ? <p>Checking Worker API…</p> : null}
      {state.status === 'error' ? (
        <p role="alert">Worker API error: {state.error}</p>
      ) : null}
      {state.status === 'ready' ? (
        <div>
          <p style={{ margin: 0, fontWeight: 700 }}>Worker API: healthy</p>
          <p style={{ margin: '8px 0 0', color: 'var(--lw-muted)' }}>
            Environment: {state.health.env}
          </p>
          <p style={{ margin: '4px 0 0', color: 'var(--lw-muted)' }}>
            Electric Agents space: {state.health.electricAgentsSpaceId}
          </p>
          <p style={{ margin: '4px 0 0', color: 'var(--lw-muted)' }}>
            Electric Cloud token configured:{' '}
            {state.health.electricCloudConfigured ? 'yes' : 'no'}
          </p>
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Mount HealthPanel on index route**

Modify `examples/living-wiki/src/app/routes/index.tsx` to exactly:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { HealthPanel } from '../components/HealthPanel'

export const Route = createFileRoute('/')({
  component: IndexRoute,
})

function IndexRoute() {
  return (
    <section className="lw-card" style={{ padding: 32 }}>
      <p
        style={{
          color: 'var(--lw-muted)',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        Electric Agents Demo
      </p>
      <h1 style={{ fontSize: 56, lineHeight: 1, margin: '12px 0 16px' }}>
        Living Wiki
      </h1>
      <p
        style={{
          color: 'var(--lw-muted)',
          fontSize: 20,
          lineHeight: 1.5,
          maxWidth: 760,
        }}
      >
        A multiplayer substrate-engineering demo where humans and agents compile
        sources into a living wiki graph.
      </p>
      <HealthPanel />
    </section>
  )
}
```

- [ ] **Step 5: Run HealthPanel test**

Run:

```bash
cd /Users/kylemathews/programs/electric
pnpm --filter @electric-ax/example-living-wiki test -- src/app/components/HealthPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run all tests/typecheck/build**

Run:

```bash
cd /Users/kylemathews/programs/electric
pnpm --filter @electric-ax/example-living-wiki test
pnpm --filter @electric-ax/example-living-wiki typecheck
pnpm --filter @electric-ax/example-living-wiki build
```

Expected: all PASS.

- [ ] **Step 7: Commit Task 5**

Run:

```bash
cd /Users/kylemathews/programs/electric
git add examples/living-wiki/src/app/components/HealthPanel.tsx examples/living-wiki/src/app/components/HealthPanel.test.tsx examples/living-wiki/src/app/routes/index.tsx
git commit -m "feat(living-wiki): show worker health in app shell"
```

Expected: commit succeeds.

## Task 6: Add TanStack DB scaffold module and document API boundary

**Files:**

- Create: `examples/living-wiki/src/shared/db.ts`
- Create: `examples/living-wiki/README.md`

- [ ] **Step 1: Create TanStack DB scaffold module**

Write `examples/living-wiki/src/shared/db.ts`:

```ts
export type LivingWikiCollectionName =
  | 'wiki_spaces'
  | 'actors'
  | 'activity_events'
  | 'sources'
  | 'wiki_pages'
  | 'wiki_edges'
  | 'review_requests'

export const livingWikiCollectionNames: LivingWikiCollectionName[] = [
  'wiki_spaces',
  'actors',
  'activity_events',
  'sources',
  'wiki_pages',
  'wiki_edges',
  'review_requests',
]

export function assertKnownCollectionName(
  name: string
): asserts name is LivingWikiCollectionName {
  if (!livingWikiCollectionNames.includes(name as LivingWikiCollectionName)) {
    throw new Error(`Unknown Living Wiki collection: ${name}`)
  }
}
```

- [ ] **Step 2: Create README with commands and boundary**

Write `examples/living-wiki/README.md`:

````md
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
````

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

````

- [ ] **Step 3: Run checks**

Run:

```bash
cd /Users/kylemathews/programs/electric
pnpm --filter @electric-ax/example-living-wiki test
pnpm --filter @electric-ax/example-living-wiki typecheck
pnpm --filter @electric-ax/example-living-wiki build
````

Expected: all PASS.

- [ ] **Step 4: Commit Task 6**

Run:

```bash
cd /Users/kylemathews/programs/electric
git add examples/living-wiki/src/shared/db.ts examples/living-wiki/README.md
git commit -m "docs(living-wiki): document scaffold commands"
```

Expected: commit succeeds.

## Task 7: Verify Wrangler local dev and deploy packaging

**Files:**

- Modify only if a command reveals a required config fix:
  - `examples/living-wiki/wrangler.toml`
  - `examples/living-wiki/package.json`
  - `examples/living-wiki/vite.config.ts`

- [ ] **Step 1: Build frontend assets**

Run:

```bash
cd /Users/kylemathews/programs/electric
pnpm --filter @electric-ax/example-living-wiki build
```

Expected: PASS and `examples/living-wiki/dist/client/index.html` exists.

- [ ] **Step 2: Run Wrangler deploy dry run**

Run:

```bash
cd /Users/kylemathews/programs/electric/examples/living-wiki
pnpm wrangler deploy --dry-run
```

Expected: PASS. If it fails due to Wrangler config syntax, fix `wrangler.toml` according to the error and rerun this step.

- [ ] **Step 3: Run Worker locally long enough to test health**

Run in terminal A:

```bash
cd /Users/kylemathews/programs/electric/examples/living-wiki
pnpm run dev:worker
```

This builds frontend assets before starting Worker dev. Run in terminal B:

```bash
curl -s http://localhost:8787/api/health | node -e 'let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => { const j = JSON.parse(s); if (!j.ok || j.app !== "living-wiki") process.exit(1); console.log(j.app, j.env); })'
```

Expected terminal B output:

```text
living-wiki local
```

Stop terminal A with `Ctrl-C`.

- [ ] **Step 4: Run Vite locally long enough to check HTML**

Run in terminal A:

```bash
cd /Users/kylemathews/programs/electric/examples/living-wiki
pnpm vite --host 0.0.0.0 --port 5177
```

Run in terminal B:

```bash
curl -s http://localhost:5177 | grep -q 'Living Wiki Demo'
```

Expected: command exits 0.

Stop terminal A with `Ctrl-C`.

- [ ] **Step 5: Commit any config fixes**

If Step 2–4 required fixes, run:

```bash
cd /Users/kylemathews/programs/electric
git add examples/living-wiki/package.json examples/living-wiki/wrangler.toml examples/living-wiki/vite.config.ts
git commit -m "fix(living-wiki): make scaffold dev and deploy commands work"
```

Expected: commit succeeds if there were changes. If there were no changes, skip this step.

## Task 8: Link detailed scaffold plan from the high-level implementation plan

**Files:**

- Modify: `docs/superpowers/specs/2026-06-02-living-wiki-demo-plan.md`

- [ ] **Step 1: Add detailed-plan note**

In `docs/superpowers/specs/2026-06-02-living-wiki-demo-plan.md`, after the `## Implementation phases` heading, add:

```md
Detailed implementation plans are split by independently testable subsystem. The first detailed plan is `docs/superpowers/plans/2026-06-02-living-wiki-scaffold.md`, covering the Wrangler/Vite/React/TanStack/tRPC scaffold and API foundation.
```

- [ ] **Step 2: Run red-flag scan**

Run:

```bash
cd /Users/kylemathews/programs/electric
python3 - <<'SCAN'
from pathlib import Path
terms = ['T'+'BD', 'TO'+'DO', 'implement'+' later', 'fill in'+' details']
paths = [
    Path('docs/superpowers/plans/2026-06-02-living-wiki-scaffold.md'),
    Path('docs/superpowers/specs/2026-06-02-living-wiki-demo-plan.md'),
]
found = False
for path in paths:
    for line_no, line in enumerate(path.read_text().splitlines(), 1):
        if any(term.lower() in line.lower() for term in terms):
            print(f'{path}:{line_no}:{line}')
            found = True
raise SystemExit(1 if found else 0)
SCAN
```

Expected: no output and exit code 0.

- [ ] **Step 3: Commit Task 8**

Run:

```bash
cd /Users/kylemathews/programs/electric
git add docs/superpowers/plans/2026-06-02-living-wiki-scaffold.md docs/superpowers/specs/2026-06-02-living-wiki-demo-plan.md
git commit -m "docs(living-wiki): add scaffold implementation plan"
```

Expected: commit succeeds.

## Self-review

### Spec coverage

This plan covers only the scaffold/API foundation slice of the design and high-level implementation plan:

- Wrangler project: covered by Tasks 1 and 7.
- Vite/React frontend: covered by Tasks 1 and 4.
- TanStack Router: covered by Task 4.
- TanStack DB: scaffold boundary covered by Task 6; real synced collections are deferred to a later plan.
- Base UI: dependency included in Task 1; concrete component usage is minimal in this scaffold and should be expanded in the UI shell plan.
- Inter font: covered by Task 4.
- Cloudflare/tRPC API: covered by Tasks 2 and 3.
- REST API: covered by Task 2.
- Worker proxy boundary to Electric Cloud: typed config/stub covered by Task 2; real proxy calls are deferred to a later Electric Cloud integration plan.
- Local development commands: covered by Tasks 1, 6, and 7.
- Production deploy command: covered by Tasks 1, 6, and 7.

### Intentional deferrals

- Electric Agents space creation and entity proxying.
- Shared-state schema and collection subscriptions.
- Intake, source digest, graph, review queues, and agent role manuals.
- Production secret values.

### Red-flag scan

The plan intentionally contains no deferred-work red-flag markers.

### Type consistency

- `HealthResponse` fields are used consistently by REST route, tRPC route, and `HealthPanel`.
- `WorkerEnv` fields match `wrangler.toml` vars and test env values.
- `AppRouter` is exported from `trpc-router.ts` and imported by `shared/trpc.ts`.
