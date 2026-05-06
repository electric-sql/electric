# MCP Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement MCP support per [`docs/superpowers/specs/2026-05-05-mcp-support-design.md`](../specs/2026-05-05-mcp-support-design.md). Greenfield — no prior implementation. Feature ships behind an **experimental** flag.

**Architecture:** A new package `@electric-ax/agents-mcp` exposes the MCP Registry (in-memory, runtime-owned), a `CredentialStore` seam with built-in stores, an adapter for the MCP SDK's `OAuthClientProvider`, and `mountMcpHttp()` which exposes the runtime's MCP HTTP surface. `agents-runtime` gains a `registerToolProvider` hook so MCP tools light up for every entity type without per-agent wiring. `agents-server` gains nothing MCP-specific except a `/api/runtimes` discovery endpoint and a `publicUrl` field on the type-registration handshake — the UI talks to runtimes directly. Tool calls are synchronous within the wake; auth failures resolve as structured errors.

**Tech Stack:** TypeScript, pnpm workspace, tsdown, vitest. Uses `@modelcontextprotocol/sdk` (the official MCP TypeScript SDK) for both client primitives and the `OAuthClientProvider` interface — we do not implement PKCE, DCR, discovery, refresh, or 401-retry ourselves. Node `fs.watch` + `fs/promises` for config + credential file ops. `node:crypto` for AES-256-GCM (optional file-store encryption). `keytar` is an optional/peer dependency (lazy-required) for OS keychain storage.

---

## File Structure

### New package: `packages/agents-mcp/`

| File                                                                    | Responsibility                                                                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `package.json`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts` | Workspace package boilerplate.                                                                                         |
| `src/index.ts`                                                          | Public exports + once-per-process `EXPERIMENTAL` console warning.                                                      |
| `src/types.ts`                                                          | Shared types: `McpServerConfig`, `McpAuthConfig`, `McpAuthMode`, `McpServerStatus`, `AddServerResult`, `McpToolError`. |
| `src/config/loader.ts`                                                  | Parse + validate `mcp.json` (no secret refs).                                                                          |
| `src/config/watcher.ts`                                                 | Debounced `fs.watch` wrapper around the loader.                                                                        |
| `src/config/env-expand.ts`                                              | `${env:VAR}` substitution.                                                                                             |
| `src/credentials/types.ts`                                              | `CredentialStore` interface (all methods optional).                                                                    |
| `src/credentials/in-memory.ts`                                          | `inMemoryCredentialStore()`.                                                                                           |
| `src/credentials/env.ts`                                                | `envCredentialStore()` — `MCP_<SERVER>_API_KEY` / `_CLIENT_ID` / `_CLIENT_SECRET`.                                     |
| `src/credentials/file.ts`                                               | `fileCredentialStore(path)` — `chmod 0600`, AES-256-GCM when keychain key available.                                   |
| `src/credentials/os-keychain.ts`                                        | `osKeychainCredentialStore()` — lazy-required `keytar`, silent skip if missing.                                        |
| `src/credentials/composed.ts`                                           | `composedCredentialStore(...stores)` — read-first, write-first-supporting-method.                                      |
| `src/transports/types.ts`                                               | `McpTransport` interface.                                                                                              |
| `src/transports/stdio.ts`                                               | Stdio subprocess transport.                                                                                            |
| `src/transports/http.ts`                                                | Streamable HTTP transport (apiKey header injection here; OAuth provider plugged in Phase 3).                           |
| `src/transports/timeout.ts`                                             | Per-call timeout helper.                                                                                               |
| `src/registry.ts`                                                       | MCP Registry: `addServer`, `applyConfig` (idempotent), `removeServer`, status tracking, hot-reload.                    |
| `src/bridge/tool-bridge.ts`                                             | Wraps MCP tools as `AgentTool` with `mcp__<server>__<tool>` naming + per-call timeout + structured errors.             |
| `src/bridge/resource-bridge.ts`                                         | (Phase 2) Resources/list + read.                                                                                       |
| `src/bridge/prompt-bridge.ts`                                           | (Phase 2) Prompts/list + get.                                                                                          |
| `src/auth/api-key.ts`                                                   | Header-injection helper for `apiKey` mode.                                                                             |
| `src/auth/sdk-provider.ts`                                              | (Phase 3) Adapter implementing the SDK's `OAuthClientProvider`, persisting via `CredentialStore`.                      |
| `src/http/mount.ts`                                                     | `mountMcpHttp({ server, registry, credentials, publicUrl, corsOrigin, requireAuth? })`.                                |
| `src/http/cors.ts`                                                      | Tiny CORS allowlist helper.                                                                                            |
| `src/http/oauth-callback.ts`                                            | (Phase 3) `GET /oauth/callback/:server` handler.                                                                       |
| `src/http/oauth-device.ts`                                              | (Phase 5) `POST /oauth/device/:server/start` handler.                                                                  |
| `src/tools.ts`                                                          | `mcp.tools(allowlist)` factory + `registerToolProvider` integration helper.                                            |
| `test/**/*.test.ts`                                                     | Vitest unit + integration tests, one file per src module.                                                              |
| `test/fixtures/mock-mcp-server.ts`                                      | (Phase 2) In-process mock MCP server (stdio + http). Used for unit + e2e tests.                                        |

### Modified packages

| File                                                                      | Modification                                                                                                                                                         |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agents-runtime/src/tool-providers.ts` (new)                     | `registerToolProvider({ name, tools })` API; runtime composes registered providers at wake time.                                                                     |
| `packages/agents-runtime/src/index.ts`                                    | Export `registerToolProvider`.                                                                                                                                       |
| `packages/agents-runtime/src/create-handler.ts`                           | Accept optional `publicUrl` + `name`; include in `POST /_electric/agents/types` body.                                                                                |
| `packages/agents-server/src/runtime-registry.ts` (new)                    | In-memory `(name, publicUrl, types[])` map populated by the type-registration handshake.                                                                             |
| `packages/agents-server/src/server.ts`                                    | Accept `publicUrl` in `/_electric/agents/types`; mount `GET /api/runtimes`. **No MCP routes, no proxy.**                                                             |
| `packages/agents-server-ui/src/hooks/useRuntimes.ts` (new, Phase 4)       | Fetches `/api/runtimes`, refresh on focus + every 60s.                                                                                                               |
| `packages/agents-server-ui/src/hooks/useMcpServers.ts` (new, Phase 4)     | Per-runtime polling of `${runtime.publicUrl}/api/mcp/servers` (10s idle, 2s during active OAuth).                                                                    |
| `packages/agents-server-ui/src/components/connected-services/*.tsx` (new) | Connected Services page.                                                                                                                                             |
| `packages/agents/src/bootstrap.ts`                                        | Construct `composedCredentialStore(env, osKeychain, file)`, build registry, call `mountMcpHttp` and `registerToolProvider`. Pass `publicUrl` to the runtime handler. |

---

## Phase 1 — Foundations + apiKey direct-call

End state: an entity-type definition that needs no MCP-specific wiring (the runtime injects MCP tools via `registerToolProvider`) can call into a registered MCP server using a pre-stored API key. `mcp.json` hot-reloads. The runtime exposes `/api/mcp/servers` directly to the UI; agents-server only knows where the runtime is.

**No OAuth in this phase.** All OAuth-related plumbing is Phase 3.

### Task 1: Bootstrap `agents-mcp` package

**Files:**

- Create: `packages/agents-mcp/package.json`
- Create: `packages/agents-mcp/tsconfig.json`
- Create: `packages/agents-mcp/tsdown.config.ts`
- Create: `packages/agents-mcp/vitest.config.ts`
- Create: `packages/agents-mcp/src/index.ts`
- Create: `packages/agents-mcp/test/smoke.test.ts`

- [ ] **Step 1: Write the smoke test**

```ts
// test/smoke.test.ts
import { describe, expect, it } from 'vitest'
import * as mcp from '../src/index'

describe('package boots', () => {
  it('exports VERSION and EXPERIMENTAL', () => {
    expect(mcp.VERSION).toBeTypeOf('string')
    expect(mcp.EXPERIMENTAL).toBe(true)
  })
})
```

- [ ] **Step 2: Run — FAIL (package not buildable yet)**

Run: `pnpm -C packages/agents-mcp test`

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "@electric-ax/agents-mcp",
  "version": "0.1.0-experimental.0",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsdown",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "peerDependencies": {
    "keytar": "^7.9.0"
  },
  "peerDependenciesMeta": {
    "keytar": { "optional": true }
  },
  "devDependencies": {
    "tsdown": "workspace:*",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 4: Create `tsconfig.json`** mirroring `packages/agents-runtime/tsconfig.json` (strict, ESNext, NodeNext).

- [ ] **Step 5: Create `tsdown.config.ts`**

```ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
})
```

- [ ] **Step 6: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', testTimeout: 15_000 },
})
```

- [ ] **Step 7: Create `src/index.ts` with experimental warning**

```ts
export const VERSION = '0.1.0-experimental.0'
export const EXPERIMENTAL = true

let warned = false
function warnExperimental(): void {
  if (warned) return
  warned = true
  // eslint-disable-next-line no-console
  console.warn(
    '[@electric-ax/agents-mcp] EXPERIMENTAL — public surfaces may change without a deprecation cycle.'
  )
}
warnExperimental()
```

- [ ] **Step 8: Run — PASS**

- [ ] **Step 9: `pnpm install` at workspace root**

- [ ] **Step 10: Commit**

```bash
git add packages/agents-mcp pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(agents-mcp): bootstrap experimental package"
```

---

### Task 2: Core types

**Files:**

- Create: `packages/agents-mcp/src/types.ts`
- Create: `packages/agents-mcp/test/types.test.ts`
- Modify: `packages/agents-mcp/src/index.ts` — re-export types

- [ ] **Step 1: Write the failing test**

```ts
// test/types.test.ts
import { describe, expect, it } from 'vitest'
import type {
  AddServerResult,
  McpAuthConfig,
  McpServerConfig,
  McpServerStatus,
  McpToolError,
} from '../src/types'

describe('types', () => {
  it('AddServerResult discriminates on state', () => {
    const ready: AddServerResult = { state: 'ready', id: 's', toolCount: 3 }
    const auth: AddServerResult = {
      state: 'authenticating',
      id: 's',
      authUrl: 'https://x',
    }
    const err: AddServerResult = {
      state: 'error',
      id: 's',
      error: { kind: 'transport_error', message: 'boom' },
    }
    expect([ready.state, auth.state, err.state]).toEqual([
      'ready',
      'authenticating',
      'error',
    ])
  })

  it('McpServerConfig http with apiKey allows headerName', () => {
    const c: McpServerConfig = {
      name: 'x',
      transport: 'http',
      url: 'https://x/mcp',
      auth: { mode: 'apiKey', headerName: 'X-Api-Key' },
    }
    expect(c.transport).toBe('http')
  })

  it('McpServerStatus enum matches HTTP API contract', () => {
    const s: McpServerStatus[] = [
      'connecting',
      'authenticating',
      'ready',
      'error',
      'disabled',
    ]
    expect(s.length).toBe(5)
  })

  // Type-only sanity: mode 'authorizationCode' requires a flow.
  it('authorizationCode requires flow', () => {
    const a: McpAuthConfig = {
      mode: 'authorizationCode',
      flow: 'browser',
      scopes: ['x'],
    }
    expect(a.mode).toBe('authorizationCode')
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `src/types.ts`**

```ts
export type McpAuthMode =
  | 'none'
  | 'apiKey'
  | 'clientCredentials'
  | 'authorizationCode'

export type McpAuthConfig =
  | { mode: 'none' }
  | {
      mode: 'apiKey'
      headerName?: string /* default: Authorization */
      valuePrefix?: string /* e.g. 'Bearer ' */
    }
  | {
      mode: 'clientCredentials'
      tokenUrl: string
      scopes?: string[]
      audience?: string
      resource?: string
    }
  | {
      mode: 'authorizationCode'
      flow: 'browser' | 'device'
      scopes?: string[]
      resource?: string
      /** Override redirect URI; default `${publicUrl}/oauth/callback/<server>`. */
      redirectUri?: string
      /** Reference into a per-process map of pre-built OAuthClientProvider instances. */
      oauthProviderRef?: string
    }

export interface McpHttpServerConfig {
  name: string
  transport: 'http'
  url: string
  auth: McpAuthConfig
  /** Per-server timeout override in ms. Default 30000. */
  timeoutMs?: number
}

export interface McpStdioServerConfig {
  name: string
  transport: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
  auth?: McpAuthConfig /* typically 'none' for stdio */
  /** Per-server timeout override in ms. Default 30000. */
  timeoutMs?: number
}

export type McpServerConfig = McpHttpServerConfig | McpStdioServerConfig

export type McpServerStatus =
  | 'connecting'
  | 'authenticating'
  | 'ready'
  | 'error'
  | 'disabled'

export type McpToolErrorKind =
  | 'auth_unavailable'
  | 'transport_error'
  | 'timeout'
  | 'server_error'
  | 'tool_not_found'

export interface McpToolError {
  kind: McpToolErrorKind
  message: string
  details?: unknown
}

export type AddServerResult =
  | { state: 'ready'; id: string; toolCount: number }
  | { state: 'authenticating'; id: string; authUrl: string }
  | { state: 'error'; id: string; error: McpToolError }
```

- [ ] **Step 4: Re-export from `src/index.ts`**

```ts
export * from './types'
```

- [ ] **Step 5: Run — PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/agents-mcp/src packages/agents-mcp/test
git commit -m "feat(agents-mcp): core types — server config (no secret refs), AddServerResult, status enum"
```

---

### Task 3: Env-var expansion utility

**Files:**

- Create: `packages/agents-mcp/src/config/env-expand.ts`
- Create: `packages/agents-mcp/test/env-expand.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/env-expand.test.ts
import { describe, expect, it } from 'vitest'
import { expandEnv } from '../src/config/env-expand'

describe('expandEnv', () => {
  it('substitutes ${env:VAR}', () => {
    expect(expandEnv('${env:HOME}/x', { HOME: '/u/me' })).toBe('/u/me/x')
  })

  it('leaves unknown vars empty and reports them', () => {
    const { value, missing } = expandEnv.detailed('${env:NOPE}', {})
    expect(value).toBe('')
    expect(missing).toEqual(['NOPE'])
  })

  it('passes through plain strings', () => {
    expect(expandEnv('plain', {})).toBe('plain')
  })

  it('expands inside nested object values', () => {
    const out = expandEnv.deep(
      { a: '${env:X}', b: { c: ['${env:Y}', 'z'] } },
      { X: '1', Y: '2' }
    )
    expect(out).toEqual({ a: '1', b: { c: ['2', 'z'] } })
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```ts
// src/config/env-expand.ts
const RE = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g

export interface ExpandResult {
  value: string
  missing: string[]
}

function expandString(s: string, env: NodeJS.ProcessEnv): ExpandResult {
  const missing: string[] = []
  const value = s.replace(RE, (_, name: string) => {
    const v = env[name]
    if (v === undefined) {
      missing.push(name)
      return ''
    }
    return v
  })
  return { value, missing }
}

export function expandEnv(
  s: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  return expandString(s, env).value
}

expandEnv.detailed = (
  s: string,
  env: NodeJS.ProcessEnv = process.env
): ExpandResult => expandString(s, env)

expandEnv.deep = function deep<T>(
  input: T,
  env: NodeJS.ProcessEnv = process.env
): T {
  if (typeof input === 'string')
    return expandString(input, env).value as unknown as T
  if (Array.isArray(input))
    return input.map((x) => deep(x, env)) as unknown as T
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = deep(v, env)
    }
    return out as T
  }
  return input
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/config/env-expand.ts packages/agents-mcp/test/env-expand.test.ts
git commit -m "feat(agents-mcp): \${env:VAR} expansion helper"
```

---

### Task 4: Config loader (parse + validate `mcp.json`)

**Files:**

- Create: `packages/agents-mcp/src/config/loader.ts`
- Create: `packages/agents-mcp/test/loader.test.ts`
- Create: `packages/agents-mcp/test/fixtures/mcp-good.json`
- Create: `packages/agents-mcp/test/fixtures/mcp-bad.json`

- [ ] **Step 1: Write fixtures**

`test/fixtures/mcp-good.json`:

```jsonc
{
  "servers": {
    "honeycomb": {
      "transport": "http",
      "url": "https://mcp.honeycomb.io/mcp",
      "auth": {
        "mode": "authorizationCode",
        "flow": "browser",
        "scopes": ["mcp:read", "mcp:write"],
      },
    },
    "internal-api": {
      "transport": "http",
      "url": "https://api.example.com/mcp",
      "auth": { "mode": "apiKey", "headerName": "X-Api-Key" },
    },
    "git-local": {
      "transport": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-git",
        "--repository",
        "${env:HOME}/repo",
      ],
    },
  },
}
```

`test/fixtures/mcp-bad.json`:

```jsonc
{
  "servers": {
    "x": { "transport": "http" },
    "y": { "transport": "stdio", "command": "true", "auth": { "mode": "wat" } },
  },
}
```

- [ ] **Step 2: Write the failing test**

```ts
// test/loader.test.ts
import { describe, expect, it } from 'vitest'
import { loadConfig, parseConfig } from '../src/config/loader'
import path from 'node:path'

const FIX = path.resolve(__dirname, 'fixtures')

describe('loader', () => {
  it('parses a good config and expands env refs in args/url', async () => {
    const cfg = await loadConfig(path.join(FIX, 'mcp-good.json'), {
      HOME: '/h',
    })
    expect(cfg.servers.length).toBe(3)
    const git = cfg.servers.find((s) => s.name === 'git-local')!
    expect(git.transport).toBe('stdio')
    expect((git as any).args).toContain('/h/repo')
  })

  it('rejects unknown auth modes with a clear error', () => {
    expect(() =>
      parseConfig({
        servers: {
          y: { transport: 'stdio', command: 'true', auth: { mode: 'wat' } },
        },
      })
    ).toThrow(/auth.mode/)
  })

  it('rejects http server without url', () => {
    expect(() =>
      parseConfig({ servers: { x: { transport: 'http' } } })
    ).toThrow(/url/)
  })

  it('rejects unknown top-level fields (typo guard)', () => {
    expect(() => parseConfig({ servers: {}, severs: {} })).toThrow(/severs/)
  })

  it('refuses configs with secret refs (legacy schema rejected)', () => {
    expect(() =>
      parseConfig({
        servers: {
          x: {
            transport: 'http',
            url: 'https://x',
            auth: { mode: 'apiKey', valueRef: 'secret/api-key' },
          },
        },
      })
    ).toThrow(/valueRef/)
  })
})
```

- [ ] **Step 3: Run — FAIL**

- [ ] **Step 4: Implement loader**

```ts
// src/config/loader.ts
import fs from 'node:fs/promises'
import { expandEnv } from './env-expand'
import type { McpServerConfig } from '../types'

export interface McpConfig {
  servers: McpServerConfig[]
  raw: unknown
}

const KNOWN_AUTH_MODES = new Set([
  'none',
  'apiKey',
  'clientCredentials',
  'authorizationCode',
])
const FORBIDDEN_REF_KEYS = ['valueRef', 'clientIdRef', 'clientSecretRef']

function fail(msg: string): never {
  throw new Error(`mcp.json: ${msg}`)
}

export function parseConfig(
  raw: unknown,
  env: NodeJS.ProcessEnv = process.env
): McpConfig {
  if (!raw || typeof raw !== 'object') fail('not an object')
  const top = Object.keys(raw as object)
  for (const k of top)
    if (k !== 'servers') fail(`unknown top-level field "${k}"`)
  const serversObj = (raw as Record<string, unknown>).servers
  if (!serversObj || typeof serversObj !== 'object')
    fail('missing "servers" object')

  const servers: McpServerConfig[] = []
  for (const [name, entry] of Object.entries(
    serversObj as Record<string, unknown>
  )) {
    if (!entry || typeof entry !== 'object')
      fail(`server "${name}" not an object`)
    const e = entry as Record<string, unknown>
    if (e.transport !== 'http' && e.transport !== 'stdio')
      fail(`server "${name}" transport must be 'http' or 'stdio'`)
    const auth = (e.auth ?? { mode: 'none' }) as Record<string, unknown>
    if (typeof auth.mode !== 'string' || !KNOWN_AUTH_MODES.has(auth.mode))
      fail(`server "${name}" auth.mode invalid`)
    for (const k of FORBIDDEN_REF_KEYS) {
      if (k in auth)
        fail(
          `server "${name}" uses forbidden "${k}" — secrets are not configured in mcp.json (use the CredentialStore at bootstrap)`
        )
    }

    if (e.transport === 'http') {
      if (typeof e.url !== 'string') fail(`server "${name}" missing url`)
      servers.push({
        name,
        transport: 'http',
        url: expandEnv(e.url, env),
        auth: expandEnv.deep(auth, env) as McpServerConfig['auth'],
        timeoutMs: typeof e.timeoutMs === 'number' ? e.timeoutMs : undefined,
      })
    } else {
      if (typeof e.command !== 'string')
        fail(`server "${name}" missing command`)
      const args = Array.isArray(e.args)
        ? (e.args as unknown[]).map((a) => expandEnv(String(a), env))
        : []
      servers.push({
        name,
        transport: 'stdio',
        command: expandEnv(e.command, env),
        args,
        env:
          e.env && typeof e.env === 'object'
            ? Object.fromEntries(
                Object.entries(e.env as Record<string, unknown>).map(
                  ([k, v]) => [k, expandEnv(String(v), env)]
                )
              )
            : undefined,
        auth: expandEnv.deep(auth, env) as McpServerConfig['auth'],
        timeoutMs: typeof e.timeoutMs === 'number' ? e.timeoutMs : undefined,
      })
    }
  }
  return { servers, raw }
}

export async function loadConfig(
  path: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<McpConfig> {
  const text = await fs.readFile(path, 'utf-8')
  return parseConfig(JSON.parse(text), env)
}
```

- [ ] **Step 5: Run — PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/agents-mcp/src/config/loader.ts packages/agents-mcp/test
git commit -m "feat(agents-mcp): mcp.json loader — schema with no secret refs"
```

---

### Task 5: Config watcher (hot reload)

**Files:**

- Create: `packages/agents-mcp/src/config/watcher.ts`
- Create: `packages/agents-mcp/test/watcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/watcher.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { watchConfig } from '../src/config/watcher'

describe('watchConfig', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-'))
    file = path.join(dir, 'mcp.json')
    await fs.writeFile(file, '{ "servers": {} }')
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('fires onChange after debounce when file is rewritten', async () => {
    const onChange = vi.fn()
    const stop = await watchConfig(file, { onChange, debounceMs: 50 })
    try {
      await fs.writeFile(
        file,
        '{ "servers": { "a": { "transport": "stdio", "command": "true" } } }'
      )
      await new Promise((r) => setTimeout(r, 200))
      expect(onChange).toHaveBeenCalled()
      const cfg = onChange.mock.calls[onChange.mock.calls.length - 1]![0]
      expect(cfg.servers.length).toBe(1)
    } finally {
      stop()
    }
  })

  it('reports parse errors via onError without throwing', async () => {
    const onChange = vi.fn()
    const onError = vi.fn()
    const stop = await watchConfig(file, { onChange, onError, debounceMs: 50 })
    try {
      await fs.writeFile(file, 'not json')
      await new Promise((r) => setTimeout(r, 200))
      expect(onError).toHaveBeenCalled()
    } finally {
      stop()
    }
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```ts
// src/config/watcher.ts
import fs from 'node:fs'
import { loadConfig, type McpConfig } from './loader'

export interface WatchOpts {
  onChange: (cfg: McpConfig) => void
  onError?: (err: unknown) => void
  debounceMs?: number
  env?: NodeJS.ProcessEnv
}

export async function watchConfig(
  path: string,
  opts: WatchOpts
): Promise<() => void> {
  const debounce = opts.debounceMs ?? 200
  let timer: NodeJS.Timeout | undefined
  const reload = async () => {
    try {
      const cfg = await loadConfig(path, opts.env)
      opts.onChange(cfg)
    } catch (err) {
      opts.onError?.(err)
    }
  }
  await reload()
  const watcher = fs.watch(path, () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(reload, debounce)
  })
  return () => {
    if (timer) clearTimeout(timer)
    watcher.close()
  }
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/config/watcher.ts packages/agents-mcp/test/watcher.test.ts
git commit -m "feat(agents-mcp): debounced mcp.json watcher with onError fallback"
```

> ⚠️ **Note for Phase 1 verification:** macOS `fs.watch` is unreliable for in-place file rewrites (some editors atomically replace the file via rename). The watcher is good-enough for v1; if hot-reload doesn't fire on your editor, log a known-issue note and rely on registry-level idempotency (Task 15) so a subsequent registration round-trip is a no-op.

---

### Task 6: `CredentialStore` interface

**Files:**

- Create: `packages/agents-mcp/src/credentials/types.ts`
- Create: `packages/agents-mcp/test/credentials/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/credentials/types.test.ts
import { describe, expect, it } from 'vitest'
import type {
  CredentialStore,
  OAuthClientInfo,
  OAuthTokens,
} from '../../src/credentials/types'

describe('CredentialStore', () => {
  it('all methods are optional — null store is valid', () => {
    const store: CredentialStore = {}
    expect(store).toBeDefined()
  })

  it('typed surface matches spec', () => {
    const store: CredentialStore = {
      getApiKey: async () => undefined,
      getClientCredentials: async () => undefined,
      getOAuthTokens: async () => undefined,
      saveOAuthTokens: async (_s: string, _t: OAuthTokens) => {},
      getOAuthClientInfo: async () => undefined,
      saveOAuthClientInfo: async (_s: string, _c: OAuthClientInfo) => {},
    }
    expect(store).toBeDefined()
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```ts
// src/credentials/types.ts
export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: number /* unix seconds */
  tokenType?: string
  scope?: string
}

export interface OAuthClientInfo {
  clientId: string
  clientSecret?: string
  redirectUris?: string[]
  registeredAt?: number /* unix seconds */
}

export interface CredentialStore {
  getApiKey?(server: string): string | undefined | Promise<string | undefined>
  getClientCredentials?(
    server: string
  ):
    | { clientId: string; clientSecret: string }
    | undefined
    | Promise<{ clientId: string; clientSecret: string } | undefined>
  getOAuthTokens?(
    server: string
  ): OAuthTokens | undefined | Promise<OAuthTokens | undefined>
  saveOAuthTokens?(server: string, tokens: OAuthTokens): void | Promise<void>
  getOAuthClientInfo?(
    server: string
  ): OAuthClientInfo | undefined | Promise<OAuthClientInfo | undefined>
  saveOAuthClientInfo?(
    server: string,
    info: OAuthClientInfo
  ): void | Promise<void>
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/credentials/types.ts packages/agents-mcp/test/credentials
git commit -m "feat(agents-mcp): CredentialStore interface — all methods optional"
```

---

### Task 7: `inMemoryCredentialStore`

**Files:**

- Create: `packages/agents-mcp/src/credentials/in-memory.ts`
- Create: `packages/agents-mcp/test/credentials/in-memory.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/credentials/in-memory.test.ts
import { describe, expect, it } from 'vitest'
import { inMemoryCredentialStore } from '../../src/credentials/in-memory'

describe('inMemoryCredentialStore', () => {
  it('round-trips api keys, tokens, and client info', async () => {
    const s = inMemoryCredentialStore()
    s.setApiKey('a', 'k')
    expect(await s.getApiKey?.('a')).toBe('k')

    await s.saveOAuthTokens?.('a', { accessToken: 'at', refreshToken: 'rt' })
    expect((await s.getOAuthTokens?.('a'))?.accessToken).toBe('at')

    await s.saveOAuthClientInfo?.('a', { clientId: 'cid' })
    expect((await s.getOAuthClientInfo?.('a'))?.clientId).toBe('cid')
  })

  it('returns undefined for unknown server', async () => {
    const s = inMemoryCredentialStore()
    expect(await s.getApiKey?.('nope')).toBeUndefined()
    expect(await s.getOAuthTokens?.('nope')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```ts
// src/credentials/in-memory.ts
import type { CredentialStore, OAuthClientInfo, OAuthTokens } from './types'

export interface InMemoryCredentialStore extends CredentialStore {
  setApiKey(server: string, key: string): void
  setClientCredentials(
    server: string,
    c: { clientId: string; clientSecret: string }
  ): void
}

export function inMemoryCredentialStore(): InMemoryCredentialStore {
  const apiKeys = new Map<string, string>()
  const cc = new Map<string, { clientId: string; clientSecret: string }>()
  const tokens = new Map<string, OAuthTokens>()
  const clientInfo = new Map<string, OAuthClientInfo>()

  return {
    setApiKey: (s, k) => void apiKeys.set(s, k),
    setClientCredentials: (s, v) => void cc.set(s, v),
    getApiKey: (s) => apiKeys.get(s),
    getClientCredentials: (s) => cc.get(s),
    getOAuthTokens: (s) => tokens.get(s),
    saveOAuthTokens: (s, t) => void tokens.set(s, t),
    getOAuthClientInfo: (s) => clientInfo.get(s),
    saveOAuthClientInfo: (s, c) => void clientInfo.set(s, c),
  }
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/credentials/in-memory.ts packages/agents-mcp/test/credentials/in-memory.test.ts
git commit -m "feat(agents-mcp): inMemoryCredentialStore"
```

---

### Task 8: `envCredentialStore`

**Files:**

- Create: `packages/agents-mcp/src/credentials/env.ts`
- Create: `packages/agents-mcp/test/credentials/env.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/credentials/env.test.ts
import { describe, expect, it } from 'vitest'
import { envCredentialStore } from '../../src/credentials/env'

describe('envCredentialStore', () => {
  it('reads MCP_<SERVER>_API_KEY', async () => {
    const s = envCredentialStore({
      MCP_STRIPE_API_KEY: 'rk_x',
    } as NodeJS.ProcessEnv)
    expect(await s.getApiKey?.('stripe')).toBe('rk_x')
    expect(await s.getApiKey?.('STRIPE')).toBe('rk_x')
    expect(await s.getApiKey?.('other')).toBeUndefined()
  })

  it('reads MCP_<SERVER>_CLIENT_ID and CLIENT_SECRET as a pair', async () => {
    const env = {
      MCP_X_CLIENT_ID: 'id',
      MCP_X_CLIENT_SECRET: 'sec',
    } as NodeJS.ProcessEnv
    const s = envCredentialStore(env)
    expect(await s.getClientCredentials?.('x')).toEqual({
      clientId: 'id',
      clientSecret: 'sec',
    })
  })

  it('returns undefined when only one of id/secret is set', async () => {
    const s = envCredentialStore({ MCP_X_CLIENT_ID: 'id' } as NodeJS.ProcessEnv)
    expect(await s.getClientCredentials?.('x')).toBeUndefined()
  })

  it('does not implement save methods', () => {
    const s = envCredentialStore()
    expect(s.saveOAuthTokens).toBeUndefined()
    expect(s.saveOAuthClientInfo).toBeUndefined()
  })

  it('handles dashes by converting to underscores', async () => {
    const s = envCredentialStore({
      MCP_FOO_BAR_API_KEY: 'k',
    } as NodeJS.ProcessEnv)
    expect(await s.getApiKey?.('foo-bar')).toBe('k')
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```ts
// src/credentials/env.ts
import type { CredentialStore } from './types'

function envKey(server: string, suffix: string): string {
  return `MCP_${server.toUpperCase().replace(/-/g, '_')}_${suffix}`
}

export function envCredentialStore(
  env: NodeJS.ProcessEnv = process.env
): CredentialStore {
  return {
    getApiKey: (server) => env[envKey(server, 'API_KEY')],
    getClientCredentials: (server) => {
      const clientId = env[envKey(server, 'CLIENT_ID')]
      const clientSecret = env[envKey(server, 'CLIENT_SECRET')]
      if (!clientId || !clientSecret) return undefined
      return { clientId, clientSecret }
    },
  }
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/credentials/env.ts packages/agents-mcp/test/credentials/env.test.ts
git commit -m "feat(agents-mcp): envCredentialStore (read-only, MCP_<server>_* convention)"
```

---

### Task 9: `fileCredentialStore`

**Files:**

- Create: `packages/agents-mcp/src/credentials/file.ts`
- Create: `packages/agents-mcp/test/credentials/file.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/credentials/file.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileCredentialStore } from '../../src/credentials/file'

describe('fileCredentialStore', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-cred-'))
    file = path.join(dir, 'credentials.json')
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('round-trips tokens and persists across reopens', async () => {
    const s1 = fileCredentialStore(file)
    await s1.saveOAuthTokens?.('a', { accessToken: 'at', refreshToken: 'rt' })
    const s2 = fileCredentialStore(file)
    expect((await s2.getOAuthTokens?.('a'))?.accessToken).toBe('at')
  })

  it('writes the file with mode 0600', async () => {
    const s = fileCredentialStore(file)
    await s.saveOAuthTokens?.('a', { accessToken: 'at' })
    const stat = await fs.stat(file)
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('refuses to read a file with permissive mode', async () => {
    await fs.writeFile(file, '{}', { mode: 0o644 })
    const s = fileCredentialStore(file)
    await expect(s.getOAuthTokens?.('a')).rejects.toThrow(/permissions/i)
  })

  it('round-trips client info', async () => {
    const s = fileCredentialStore(file)
    await s.saveOAuthClientInfo?.('a', { clientId: 'cid' })
    expect((await s.getOAuthClientInfo?.('a'))?.clientId).toBe('cid')
  })

  it('does not expose API keys (file store is for OAuth state by default)', () => {
    const s = fileCredentialStore(file)
    expect(s.getApiKey).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```ts
// src/credentials/file.ts
import fs from 'node:fs/promises'
import path from 'node:path'
import type { CredentialStore, OAuthClientInfo, OAuthTokens } from './types'

interface FileShape {
  tokens?: Record<string, OAuthTokens>
  clientInfo?: Record<string, OAuthClientInfo>
}

async function readSafe(file: string): Promise<FileShape> {
  try {
    const stat = await fs.stat(file)
    if ((stat.mode & 0o777) !== 0o600) {
      throw new Error(
        `${file} has permissions ${(stat.mode & 0o777).toString(8)}; refusing to read (require 0600).`
      )
    }
    const text = await fs.readFile(file, 'utf-8')
    return text.trim() ? (JSON.parse(text) as FileShape) : {}
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
}

async function writeSafe(file: string, data: FileShape): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  await fs.rename(tmp, file)
  await fs.chmod(file, 0o600)
}

export interface FileCredentialStoreOptions {
  /** Reserved for future use: layer AES-256-GCM encryption when a keychain key is available. */
  encrypt?: { key: Buffer }
}

export function fileCredentialStore(
  file: string,
  _opts: FileCredentialStoreOptions = {}
): CredentialStore {
  return {
    async getOAuthTokens(server) {
      const data = await readSafe(file)
      return data.tokens?.[server]
    },
    async saveOAuthTokens(server, tokens) {
      const data = await readSafe(file)
      data.tokens = { ...(data.tokens ?? {}), [server]: tokens }
      await writeSafe(file, data)
    },
    async getOAuthClientInfo(server) {
      const data = await readSafe(file)
      return data.clientInfo?.[server]
    },
    async saveOAuthClientInfo(server, info) {
      const data = await readSafe(file)
      data.clientInfo = { ...(data.clientInfo ?? {}), [server]: info }
      await writeSafe(file, data)
    },
  }
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/credentials/file.ts packages/agents-mcp/test/credentials/file.test.ts
git commit -m "feat(agents-mcp): fileCredentialStore — chmod 0600 + permission guard"
```

---

### Task 10: `osKeychainCredentialStore` (lazy keytar)

**Files:**

- Create: `packages/agents-mcp/src/credentials/os-keychain.ts`
- Create: `packages/agents-mcp/test/credentials/os-keychain.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/credentials/os-keychain.test.ts
import { describe, expect, it, vi } from 'vitest'
import { osKeychainCredentialStore } from '../../src/credentials/os-keychain'

const fakeKeytar = (() => {
  const store = new Map<string, string>()
  return {
    setPassword: vi.fn(async (svc: string, acct: string, val: string) => {
      store.set(`${svc}::${acct}`, val)
    }),
    getPassword: vi.fn(
      async (svc: string, acct: string) => store.get(`${svc}::${acct}`) ?? null
    ),
  }
})()

describe('osKeychainCredentialStore', () => {
  it('round-trips tokens via the injected keytar adapter', async () => {
    const s = osKeychainCredentialStore({
      keytar: fakeKeytar as any,
      service: 'electric-agents-test',
    })
    await s.saveOAuthTokens?.('honeycomb', {
      accessToken: 'AT',
      refreshToken: 'RT',
    })
    const t = await s.getOAuthTokens?.('honeycomb')
    expect(t?.accessToken).toBe('AT')
    expect(fakeKeytar.setPassword).toHaveBeenCalled()
  })

  it('returns a noop store when keytar is missing', async () => {
    const s = osKeychainCredentialStore({ keytar: undefined as any })
    expect(await s.getOAuthTokens?.('x')).toBeUndefined()
    await s.saveOAuthTokens?.('x', { accessToken: 'AT' })
    expect(await s.getOAuthTokens?.('x')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```ts
// src/credentials/os-keychain.ts
import type { CredentialStore, OAuthClientInfo, OAuthTokens } from './types'

interface KeytarLike {
  setPassword(service: string, account: string, password: string): Promise<void>
  getPassword(service: string, account: string): Promise<string | null>
}

export interface OsKeychainOptions {
  service?: string /* default: 'electric-agents' */
  /** Override for tests. Default: lazy require('keytar'). */
  keytar?: KeytarLike
}

function tryLoadKeytar(): KeytarLike | undefined {
  try {
    // Lazy require so the package builds without keytar's native deps.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('keytar') as KeytarLike
  } catch {
    return undefined
  }
}

const TOKENS_PREFIX = 'tokens'
const CLIENT_PREFIX = 'client'

export function osKeychainCredentialStore(
  opts: OsKeychainOptions = {}
): CredentialStore {
  const service = opts.service ?? 'electric-agents'
  const keytar = opts.keytar ?? tryLoadKeytar()
  if (!keytar) {
    // eslint-disable-next-line no-console
    console.warn(
      '[agents-mcp] os-keychain unavailable (keytar not installed); skipping'
    )
    return {}
  }
  return {
    async getOAuthTokens(server) {
      const raw = await keytar.getPassword(
        service,
        `${TOKENS_PREFIX}:${server}`
      )
      return raw ? (JSON.parse(raw) as OAuthTokens) : undefined
    },
    async saveOAuthTokens(server, tokens) {
      await keytar.setPassword(
        service,
        `${TOKENS_PREFIX}:${server}`,
        JSON.stringify(tokens)
      )
    },
    async getOAuthClientInfo(server) {
      const raw = await keytar.getPassword(
        service,
        `${CLIENT_PREFIX}:${server}`
      )
      return raw ? (JSON.parse(raw) as OAuthClientInfo) : undefined
    },
    async saveOAuthClientInfo(server, info) {
      await keytar.setPassword(
        service,
        `${CLIENT_PREFIX}:${server}`,
        JSON.stringify(info)
      )
    },
  }
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/credentials/os-keychain.ts packages/agents-mcp/test/credentials/os-keychain.test.ts
git commit -m "feat(agents-mcp): osKeychainCredentialStore (lazy keytar, silent skip)"
```

---

### Task 11: `composedCredentialStore`

**Files:**

- Create: `packages/agents-mcp/src/credentials/composed.ts`
- Create: `packages/agents-mcp/test/credentials/composed.test.ts`
- Modify: `packages/agents-mcp/src/index.ts` — re-export all stores

- [ ] **Step 1: Write the failing test**

```ts
// test/credentials/composed.test.ts
import { describe, expect, it } from 'vitest'
import { composedCredentialStore } from '../../src/credentials/composed'
import { envCredentialStore } from '../../src/credentials/env'
import { inMemoryCredentialStore } from '../../src/credentials/in-memory'

describe('composedCredentialStore', () => {
  it('reads from the first store with a non-undefined value', async () => {
    const env = envCredentialStore({
      MCP_X_API_KEY: 'env-val',
    } as NodeJS.ProcessEnv)
    const mem = inMemoryCredentialStore()
    mem.setApiKey('x', 'mem-val')
    const composed = composedCredentialStore(env, mem)
    expect(await composed.getApiKey?.('x')).toBe('env-val')
  })

  it('falls through when the first store returns undefined', async () => {
    const env = envCredentialStore({} as NodeJS.ProcessEnv)
    const mem = inMemoryCredentialStore()
    mem.setApiKey('x', 'mem-val')
    const composed = composedCredentialStore(env, mem)
    expect(await composed.getApiKey?.('x')).toBe('mem-val')
  })

  it('writes to the first store that implements the relevant save method', async () => {
    const env = envCredentialStore() // read-only — no saveOAuthTokens
    const mem = inMemoryCredentialStore()
    const composed = composedCredentialStore(env, mem)
    await composed.saveOAuthTokens?.('x', { accessToken: 'at' })
    expect((await mem.getOAuthTokens?.('x'))?.accessToken).toBe('at')
  })

  it('throws a clear error when no child can persist', async () => {
    const env = envCredentialStore()
    const composed = composedCredentialStore(env)
    await expect(
      composed.saveOAuthTokens?.('x', { accessToken: 'at' })
    ).rejects.toThrow(/no writable store/i)
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```ts
// src/credentials/composed.ts
import type { CredentialStore } from './types'

type ReadKey =
  | 'getApiKey'
  | 'getClientCredentials'
  | 'getOAuthTokens'
  | 'getOAuthClientInfo'
type WriteKey = 'saveOAuthTokens' | 'saveOAuthClientInfo'

async function readFirst<R>(
  stores: CredentialStore[],
  method: ReadKey,
  arg: string
): Promise<R | undefined> {
  for (const s of stores) {
    const fn = s[method]
    if (!fn) continue
    const v = await (fn as (a: string) => Promise<unknown>).call(s, arg)
    if (v !== undefined) return v as R
  }
  return undefined
}

async function writeFirst<A>(
  stores: CredentialStore[],
  method: WriteKey,
  server: string,
  value: A
): Promise<void> {
  for (const s of stores) {
    const fn = s[method]
    if (!fn) continue
    await (fn as (s: string, v: A) => Promise<void>).call(s, server, value)
    return
  }
  throw new Error(
    `composedCredentialStore: no writable store implements ${method}`
  )
}

export function composedCredentialStore(
  ...stores: CredentialStore[]
): CredentialStore {
  return {
    getApiKey: (s) => readFirst(stores, 'getApiKey', s),
    getClientCredentials: (s) => readFirst(stores, 'getClientCredentials', s),
    getOAuthTokens: (s) => readFirst(stores, 'getOAuthTokens', s),
    getOAuthClientInfo: (s) => readFirst(stores, 'getOAuthClientInfo', s),
    saveOAuthTokens: (s, t) => writeFirst(stores, 'saveOAuthTokens', s, t),
    saveOAuthClientInfo: (s, c) =>
      writeFirst(stores, 'saveOAuthClientInfo', s, c),
  }
}
```

- [ ] **Step 4: Re-export from `src/index.ts`**

```ts
export * from './credentials/types'
export { inMemoryCredentialStore } from './credentials/in-memory'
export { envCredentialStore } from './credentials/env'
export { fileCredentialStore } from './credentials/file'
export { osKeychainCredentialStore } from './credentials/os-keychain'
export { composedCredentialStore } from './credentials/composed'
```

- [ ] **Step 5: Run — PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/agents-mcp/src/credentials/composed.ts packages/agents-mcp/test/credentials/composed.test.ts packages/agents-mcp/src/index.ts
git commit -m "feat(agents-mcp): composedCredentialStore + index exports"
```

---

### Task 12: Stdio transport

**Files:**

- Create: `packages/agents-mcp/src/transports/types.ts`
- Create: `packages/agents-mcp/src/transports/stdio.ts`
- Create: `packages/agents-mcp/test/transports/stdio.test.ts`

- [ ] **Step 1: Define `McpTransport` interface in `types.ts`**

```ts
// src/transports/types.ts
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

export interface McpTransport {
  client: Client
  connect(): Promise<void>
  close(): Promise<void>
}
```

- [ ] **Step 2: Write the failing test**

```ts
// test/transports/stdio.test.ts
import { describe, expect, it } from 'vitest'
import { createStdioTransport } from '../../src/transports/stdio'

describe('stdio transport', () => {
  it('connects to the official everything server and lists tools', async () => {
    const t = createStdioTransport({
      name: 'everything',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-everything'],
    })
    await t.connect()
    try {
      const tools = await t.client.listTools()
      expect(tools.tools.length).toBeGreaterThan(0)
    } finally {
      await t.close()
    }
  }, 30_000)
})
```

- [ ] **Step 3: Run — FAIL**

- [ ] **Step 4: Implement**

```ts
// src/transports/stdio.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpTransport } from './types'

export interface StdioTransportOpts {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

export function createStdioTransport(opts: StdioTransportOpts): McpTransport {
  const transport = new StdioClientTransport({
    command: opts.command,
    args: opts.args ?? [],
    env: opts.env,
  })
  const client = new Client(
    { name: '@electric-ax/agents-mcp', version: '0.1.0-experimental.0' },
    { capabilities: {} }
  )
  return {
    client,
    async connect() {
      await client.connect(transport)
    },
    async close() {
      await client.close()
    },
  }
}
```

- [ ] **Step 5: Run — PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/agents-mcp/src/transports packages/agents-mcp/test/transports
git commit -m "feat(agents-mcp): stdio transport via SDK"
```

---

### Task 13: HTTP transport (with apiKey injection)

**Files:**

- Create: `packages/agents-mcp/src/transports/http.ts`
- Create: `packages/agents-mcp/src/auth/api-key.ts`
- Create: `packages/agents-mcp/test/transports/http.test.ts`

- [ ] **Step 1: Implement `auth/api-key.ts`**

```ts
// src/auth/api-key.ts
export interface ApiKeyAuthOpts {
  headerName?: string /* default: Authorization */
  valuePrefix?: string /* e.g. 'Bearer ' */
}

export function buildApiKeyHeader(
  apiKey: string,
  opts: ApiKeyAuthOpts = {}
): { name: string; value: string } {
  return {
    name: opts.headerName ?? 'Authorization',
    value: (opts.valuePrefix ?? '') + apiKey,
  }
}
```

- [ ] **Step 2: Write the failing test**

```ts
// test/transports/http.test.ts
import { describe, expect, it } from 'vitest'
import { createHttpTransport } from '../../src/transports/http'

describe('http transport', () => {
  it('composes the Authorization header from the headerProvider', async () => {
    let captured: Headers | undefined
    const t = createHttpTransport({
      name: 'mock',
      url: 'http://127.0.0.1:9/mcp',
      headerProvider: async () => ({
        name: 'Authorization',
        value: 'Bearer test-key',
      }),
      fetchImpl: async (_url, init) => {
        captured = new Headers(init?.headers)
        return new Response('', { status: 500 })
      },
    })
    await expect(t.connect()).rejects.toBeDefined()
    expect(captured?.get('Authorization')).toBe('Bearer test-key')
  })
})
```

- [ ] **Step 3: Run — FAIL**

- [ ] **Step 4: Implement**

```ts
// src/transports/http.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpTransport } from './types'

export interface HttpTransportOpts {
  name: string
  url: string
  /** Returns a header to add on every request (e.g. apiKey or OAuth bearer). */
  headerProvider?: () => Promise<{ name: string; value: string } | undefined>
  /** Test-only override. */
  fetchImpl?: typeof fetch
}

export function createHttpTransport(opts: HttpTransportOpts): McpTransport {
  const fetchImpl = opts.fetchImpl ?? fetch
  const transport = new StreamableHTTPClientTransport(new URL(opts.url), {
    fetch: async (url, init) => {
      const headers = new Headers(init?.headers)
      const h = await opts.headerProvider?.()
      if (h) headers.set(h.name, h.value)
      return fetchImpl(url, { ...init, headers })
    },
  })
  const client = new Client(
    { name: '@electric-ax/agents-mcp', version: '0.1.0-experimental.0' },
    { capabilities: {} }
  )
  return {
    client,
    async connect() {
      await client.connect(transport)
    },
    async close() {
      await client.close()
    },
  }
}
```

- [ ] **Step 5: Run — PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/agents-mcp/src/transports/http.ts packages/agents-mcp/src/auth/api-key.ts packages/agents-mcp/test/transports/http.test.ts
git commit -m "feat(agents-mcp): http transport + apiKey header builder"
```

---

### Task 14: Per-call timeout helper

**Files:**

- Create: `packages/agents-mcp/src/transports/timeout.ts`
- Create: `packages/agents-mcp/test/transports/timeout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/transports/timeout.test.ts
import { describe, expect, it } from 'vitest'
import { withTimeout } from '../../src/transports/timeout'

describe('withTimeout', () => {
  it('resolves when the inner promise resolves first', async () => {
    expect(await withTimeout(Promise.resolve(1), 100)).toBe(1)
  })

  it('rejects with kind=timeout when slower than the budget', async () => {
    await expect(
      withTimeout(new Promise((r) => setTimeout(() => r(1), 50)), 5)
    ).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('passes through rejections unchanged', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('boom')), 100)
    ).rejects.toThrow('boom')
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```ts
// src/transports/timeout.ts
import type { McpToolError } from '../types'

export const DEFAULT_TIMEOUT_MS = 30_000

class TimeoutError extends Error implements McpToolError {
  kind = 'timeout' as const
  constructor(ms: number) {
    super(`MCP tool call timed out after ${ms}ms`)
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const guard = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms)
  })
  return Promise.race([p, guard]).finally(() => {
    if (timer) clearTimeout(timer)
  }) as Promise<T>
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/transports/timeout.ts packages/agents-mcp/test/transports/timeout.test.ts
git commit -m "feat(agents-mcp): per-call timeout helper (kind=timeout error)"
```

---

### Task 15: MCP Registry — `addServer`, `applyConfig`, idempotency

**Files:**

- Create: `packages/agents-mcp/src/registry.ts`
- Create: `packages/agents-mcp/test/registry.test.ts`

> Two key invariants from the spec:
>
> - `addServer` returns a discriminated `AddServerResult` so callers can branch on `state` (no introspection of status fields).
> - Idempotency: when re-applied with an unchanged config tuple `(name, url, transport, authMode, scopes, command, args)`, the existing transport and tool cache are preserved.

- [ ] **Step 1: Write the failing test**

```ts
// test/registry.test.ts
import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../src/registry'
import { inMemoryCredentialStore } from '../src/credentials/in-memory'

describe('Registry', () => {
  it('addServer with unauthenticated apiKey resolves to error (no key in store)', async () => {
    const credentials = inMemoryCredentialStore()
    const reg = createRegistry({ credentials })
    const result = await reg.addServer({
      name: 'a',
      transport: 'http',
      url: 'https://example.com/mcp',
      auth: { mode: 'apiKey' },
    })
    expect(result.state).toBe('error')
    if (result.state === 'error')
      expect(result.error.kind).toBe('auth_unavailable')
  })

  it('addServer with apiKey present transitions to ready and lists tools', async () => {
    const credentials = inMemoryCredentialStore()
    credentials.setApiKey('mock', 'KEY')
    const reg = createRegistry({
      credentials,
      transportFactoryOverride: () => makeFakeTransport(['t1', 't2']),
    })
    const result = await reg.addServer({
      name: 'mock',
      transport: 'http',
      url: 'https://mock/mcp',
      auth: { mode: 'apiKey' },
    })
    expect(result.state).toBe('ready')
    if (result.state === 'ready') expect(result.toolCount).toBe(2)
  })

  it('applyConfig is idempotent on unchanged config — does not close existing transport', async () => {
    const credentials = inMemoryCredentialStore()
    credentials.setApiKey('mock', 'KEY')
    const closeSpy = vi.fn()
    const reg = createRegistry({
      credentials,
      transportFactoryOverride: () => ({
        ...makeFakeTransport(['t1']),
        close: closeSpy,
      }),
    })
    const cfg = {
      servers: [
        {
          name: 'mock',
          transport: 'http' as const,
          url: 'https://mock/mcp',
          auth: { mode: 'apiKey' as const },
        },
      ],
      raw: {},
    }
    await reg.applyConfig(cfg)
    await reg.applyConfig(cfg)
    expect(closeSpy).not.toHaveBeenCalled()
  })

  it('applyConfig with drifted config closes the old transport and opens a new one', async () => {
    const credentials = inMemoryCredentialStore()
    credentials.setApiKey('mock', 'KEY')
    const closeSpy = vi.fn()
    const reg = createRegistry({
      credentials,
      transportFactoryOverride: () => ({
        ...makeFakeTransport(['t1']),
        close: closeSpy,
      }),
    })
    const v1 = mkCfg('https://a/mcp')
    const v2 = mkCfg('https://b/mcp')
    await reg.applyConfig(v1)
    await reg.applyConfig(v2)
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('removeServer fully tears down', async () => {
    const credentials = inMemoryCredentialStore()
    credentials.setApiKey('mock', 'KEY')
    const closeSpy = vi.fn()
    const reg = createRegistry({
      credentials,
      transportFactoryOverride: () => ({
        ...makeFakeTransport(['t1']),
        close: closeSpy,
      }),
    })
    await reg.addServer({
      name: 'mock',
      transport: 'http',
      url: 'https://mock/mcp',
      auth: { mode: 'apiKey' },
    })
    await reg.removeServer('mock')
    expect(closeSpy).toHaveBeenCalled()
    expect(reg.list().length).toBe(0)
  })
})

function mkCfg(url: string) {
  return {
    servers: [
      {
        name: 'mock',
        transport: 'http' as const,
        url,
        auth: { mode: 'apiKey' as const },
      },
    ],
    raw: {},
  }
}

function makeFakeTransport(toolNames: string[]) {
  return {
    client: {
      listTools: async () => ({
        tools: toolNames.map((name) => ({
          name,
          description: name,
          inputSchema: { type: 'object' },
        })),
      }),
      callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      close: async () => {},
    } as any,
    connect: async () => {},
    close: async () => {},
  }
}
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```ts
// src/registry.ts
import type {
  AddServerResult,
  McpServerConfig,
  McpServerStatus,
  McpToolError,
} from './types'
import type { CredentialStore } from './credentials/types'
import type { McpTransport } from './transports/types'
import { createHttpTransport } from './transports/http'
import { createStdioTransport } from './transports/stdio'
import { buildApiKeyHeader } from './auth/api-key'
import type { McpConfig } from './config/loader'

interface Entry {
  config: McpServerConfig
  configHash: string
  status: McpServerStatus
  error?: McpToolError
  authUrl?: string
  transport?: McpTransport
  tools: Array<{ name: string; description?: string; inputSchema: unknown }>
}

export interface RegistryOpts {
  credentials: CredentialStore
  transportFactoryOverride?: (
    cfg: McpServerConfig,
    hp?: HeaderProvider
  ) => McpTransport
  /** Reserved for Phase 3 — supplies an OAuthClientProvider per server. */
  oauthProviderFactory?: (cfg: McpServerConfig) => unknown
}

export type HeaderProvider = () => Promise<
  { name: string; value: string } | undefined
>

export interface ListedEntry {
  name: string
  status: McpServerStatus
  toolCount: number
  authUrl?: string
  error?: McpToolError
  tools: Entry['tools']
}

export interface Registry {
  addServer(cfg: McpServerConfig): Promise<AddServerResult>
  applyConfig(cfg: McpConfig): Promise<AddServerResult[]>
  removeServer(name: string): Promise<void>
  list(): ReadonlyArray<ListedEntry>
  get(name: string): Entry | undefined
}

function hashConfig(c: McpServerConfig): string {
  const parts = [
    c.name,
    c.transport,
    (c as any).url ?? '',
    c.auth?.mode ?? 'none',
  ]
  if (
    c.auth &&
    (c.auth.mode === 'authorizationCode' || c.auth.mode === 'clientCredentials')
  ) {
    parts.push((c.auth.scopes ?? []).slice().sort().join(','))
  }
  if (c.transport === 'stdio') {
    parts.push(c.command, (c.args ?? []).join(' '))
  }
  return parts.join('|')
}

function makeError(kind: McpToolError['kind'], message: string): McpToolError {
  return { kind, message }
}

export function createRegistry(opts: RegistryOpts): Registry {
  const entries = new Map<string, Entry>()

  const buildTransport = async (
    cfg: McpServerConfig
  ): Promise<{
    transport?: McpTransport
    error?: McpToolError
    authUrl?: string
  }> => {
    if (opts.transportFactoryOverride) {
      return { transport: opts.transportFactoryOverride(cfg) }
    }
    if (cfg.transport === 'stdio') {
      return {
        transport: createStdioTransport({
          name: cfg.name,
          command: cfg.command,
          args: cfg.args,
          env: cfg.env,
        }),
      }
    }
    if (cfg.auth.mode === 'apiKey') {
      const key = await opts.credentials.getApiKey?.(cfg.name)
      if (!key)
        return {
          error: makeError('auth_unavailable', `no apiKey for ${cfg.name}`),
        }
      const header = buildApiKeyHeader(key, {
        headerName: cfg.auth.headerName,
        valuePrefix: cfg.auth.valuePrefix,
      })
      const headerProvider: HeaderProvider = async () => header
      return {
        transport: createHttpTransport({
          name: cfg.name,
          url: cfg.url,
          headerProvider,
        }),
      }
    }
    return {
      error: makeError(
        'auth_unavailable',
        `auth.mode=${cfg.auth.mode} not implemented in Phase 1`
      ),
    }
  }

  const connectAndList = async (entry: Entry): Promise<AddServerResult> => {
    if (!entry.transport) {
      return {
        state: 'error',
        id: entry.config.name,
        error: entry.error ?? makeError('transport_error', 'no transport'),
      }
    }
    try {
      await entry.transport.connect()
      const out = await entry.transport.client.listTools()
      entry.tools = out.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }))
      entry.status = 'ready'
      return {
        state: 'ready',
        id: entry.config.name,
        toolCount: entry.tools.length,
      }
    } catch (err) {
      entry.status = 'error'
      const e = makeError('transport_error', (err as Error).message)
      entry.error = e
      return { state: 'error', id: entry.config.name, error: e }
    }
  }

  const registry: Registry = {
    async addServer(cfg) {
      const existing = entries.get(cfg.name)
      const hash = hashConfig(cfg)
      if (
        existing &&
        existing.configHash === hash &&
        existing.status === 'ready'
      ) {
        return {
          state: 'ready',
          id: cfg.name,
          toolCount: existing.tools.length,
        }
      }
      if (existing) {
        await existing.transport?.close().catch(() => {})
        entries.delete(cfg.name)
      }
      const built = await buildTransport(cfg)
      const entry: Entry = {
        config: cfg,
        configHash: hash,
        status: built.transport ? 'connecting' : 'error',
        transport: built.transport,
        error: built.error,
        authUrl: built.authUrl,
        tools: [],
      }
      entries.set(cfg.name, entry)
      if (built.error)
        return { state: 'error', id: cfg.name, error: built.error }
      if (built.authUrl) {
        entry.status = 'authenticating'
        return { state: 'authenticating', id: cfg.name, authUrl: built.authUrl }
      }
      return await connectAndList(entry)
    },

    async applyConfig(cfg) {
      const seen = new Set(cfg.servers.map((s) => s.name))
      const results: AddServerResult[] = []
      for (const s of cfg.servers) results.push(await registry.addServer(s))
      for (const name of [...entries.keys()]) {
        if (!seen.has(name)) await registry.removeServer(name)
      }
      return results
    },

    async removeServer(name) {
      const e = entries.get(name)
      if (!e) return
      await e.transport?.close().catch(() => {})
      entries.delete(name)
    },

    list() {
      return [...entries.values()].map((e) => ({
        name: e.config.name,
        status: e.status,
        toolCount: e.tools.length,
        authUrl: e.authUrl,
        error: e.error,
        tools: e.tools,
      }))
    },

    get(name) {
      return entries.get(name)
    },
  }

  return registry
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/registry.ts packages/agents-mcp/test/registry.test.ts
git commit -m "feat(agents-mcp): registry — addServer/applyConfig with AddServerResult + idempotency"
```

---

### Task 16: Tool bridge — `mcp__server__tool` naming

**Files:**

- Create: `packages/agents-mcp/src/bridge/tool-bridge.ts`
- Create: `packages/agents-mcp/test/bridge/tool-bridge.test.ts`

> Tool naming: `mcp__<server>__<toolName>`. The full prefix string must satisfy Anthropic's regex `^[a-zA-Z0-9_-]{1,128}$`. We sanitize server/tool names (replace any char outside `[A-Za-z0-9_-]` with `_`) and truncate the resulting full name when needed.

- [ ] **Step 1: Write the failing test**

```ts
// test/bridge/tool-bridge.test.ts
import { describe, expect, it, vi } from 'vitest'
import { bridgeMcpTool, prefixToolName } from '../../src/bridge/tool-bridge'

describe('prefixToolName', () => {
  it('produces mcp__server__tool', () => {
    expect(prefixToolName('honeycomb', 'list_datasets')).toBe(
      'mcp__honeycomb__list_datasets'
    )
  })

  it('sanitizes server names with disallowed characters', () => {
    expect(prefixToolName('foo.bar', 'baz')).toBe('mcp__foo_bar__baz')
  })

  it('matches Anthropic regex', () => {
    const re = /^[a-zA-Z0-9_-]{1,128}$/
    expect(re.test(prefixToolName('honeycomb', 'list_datasets'))).toBe(true)
  })

  it('truncates names longer than 128 chars while keeping the prefix', () => {
    const long = 'x'.repeat(200)
    const name = prefixToolName('s', long)
    expect(name.length).toBeLessThanOrEqual(128)
    expect(name.startsWith('mcp__s__')).toBe(true)
  })
})

describe('bridgeMcpTool', () => {
  it('invokes the SDK callTool and returns its result', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'hi' }],
    }))
    const tool = bridgeMcpTool({
      server: 'mock',
      tool: { name: 'echo', description: 'd', inputSchema: { type: 'object' } },
      client: { callTool } as any,
      timeoutMs: 1000,
    })
    expect(tool.name).toBe('mcp__mock__echo')
    const result = await tool.call({ msg: 'hi' })
    expect(callTool).toHaveBeenCalledWith({
      name: 'echo',
      arguments: { msg: 'hi' },
    })
    expect(result).toEqual({ content: [{ type: 'text', text: 'hi' }] })
  })

  it('returns a structured timeout error when slower than budget', async () => {
    const callTool = () =>
      new Promise((r) => setTimeout(() => r({ content: [] }), 50))
    const tool = bridgeMcpTool({
      server: 'mock',
      tool: { name: 'slow', description: 'd', inputSchema: { type: 'object' } },
      client: { callTool } as any,
      timeoutMs: 5,
    })
    await expect(tool.call({})).rejects.toMatchObject({ kind: 'timeout' })
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```ts
// src/bridge/tool-bridge.ts
import { withTimeout, DEFAULT_TIMEOUT_MS } from '../transports/timeout'
import type { McpToolError } from '../types'

const PREFIX = 'mcp'
const MAX_LEN = 128

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_')
}

export function prefixToolName(server: string, tool: string): string {
  const full = `${PREFIX}__${sanitize(server)}__${sanitize(tool)}`
  return full.length > MAX_LEN ? full.slice(0, MAX_LEN) : full
}

export interface BridgeToolOpts {
  server: string
  tool: { name: string; description?: string; inputSchema: unknown }
  /** Subset of MCP SDK Client we use here. */
  client: {
    callTool: (args: { name: string; arguments?: unknown }) => Promise<unknown>
  }
  timeoutMs?: number
}

export interface BridgedTool {
  name: string
  description?: string
  inputSchema: unknown
  call(args: unknown): Promise<unknown>
}

export function bridgeMcpTool(opts: BridgeToolOpts): BridgedTool {
  const name = prefixToolName(opts.server, opts.tool.name)
  const ms = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return {
    name,
    description: opts.tool.description,
    inputSchema: opts.tool.inputSchema,
    async call(args) {
      try {
        return await withTimeout(
          opts.client.callTool({ name: opts.tool.name, arguments: args }),
          ms
        )
      } catch (err) {
        const e = err as Partial<McpToolError> & { message?: string }
        if (e.kind === 'timeout') throw err
        const wrapped: McpToolError = {
          kind: 'transport_error',
          message: e.message ?? String(err),
        }
        throw wrapped
      }
    },
  }
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/bridge packages/agents-mcp/test/bridge
git commit -m "feat(agents-mcp): tool bridge with mcp__server__tool naming + timeout"
```

---

### Task 17: `registerToolProvider` in `agents-runtime`

**Files:**

- Create: `packages/agents-runtime/src/tool-providers.ts`
- Create: `packages/agents-runtime/test/tool-providers.test.ts`
- Modify: `packages/agents-runtime/src/index.ts` — export `registerToolProvider`
- Modify: `packages/agents-runtime/src/<wake-time tool composition>` — append registered providers' tools at compose time. Locate the existing site by grepping for where `entityType.tools` is used to build the per-wake tool list.

> The hook is process-global (a single `Map` keyed by provider name). Bootstrap calls `registerToolProvider` once; the runtime's wake-time composition merges every registered provider's tools into the entity-type's static list. Idempotent registration: same `name` replaces the previous registration.

- [ ] **Step 1: Write the failing test**

```ts
// test/tool-providers.test.ts
import { describe, expect, it, beforeEach } from 'vitest'
import {
  registerToolProvider,
  unregisterToolProvider,
  resolveToolProviders,
  __resetToolProvidersForTest,
} from '../src/tool-providers'

describe('tool-providers', () => {
  beforeEach(() => __resetToolProvidersForTest())

  it('registers and resolves provider tools', async () => {
    registerToolProvider({ name: 'mcp', tools: () => [{ name: 'x' } as any] })
    const tools = await resolveToolProviders()
    expect(tools.length).toBe(1)
    expect((tools[0] as any).name).toBe('x')
  })

  it('idempotent re-registration replaces previous', async () => {
    registerToolProvider({ name: 'mcp', tools: () => [{ name: 'a' } as any] })
    registerToolProvider({ name: 'mcp', tools: () => [{ name: 'b' } as any] })
    const tools = await resolveToolProviders()
    expect((tools as any[]).map((t) => t.name)).toEqual(['b'])
  })

  it('unregister removes tools', async () => {
    registerToolProvider({ name: 'mcp', tools: () => [{ name: 'a' } as any] })
    unregisterToolProvider('mcp')
    expect(await resolveToolProviders()).toEqual([])
  })

  it('supports async tools()', async () => {
    registerToolProvider({
      name: 'mcp',
      tools: async () => [{ name: 'c' } as any],
    })
    expect((await resolveToolProviders())[0]).toMatchObject({ name: 'c' })
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```ts
// src/tool-providers.ts
// Process-global registry of tool providers. Wake-time tool composition appends
// each registered provider's tools to whatever the entity type declared.

export interface ToolProviderEntry {
  name: string
  tools: () => unknown[] | Promise<unknown[]>
}

const providers = new Map<string, ToolProviderEntry>()

export function registerToolProvider(p: ToolProviderEntry): void {
  providers.set(p.name, p)
}

export function unregisterToolProvider(name: string): void {
  providers.delete(name)
}

export async function resolveToolProviders(): Promise<unknown[]> {
  const out: unknown[] = []
  for (const p of providers.values()) {
    const t = await p.tools()
    out.push(...t)
  }
  return out
}

/** @internal — used in unit tests. */
export function __resetToolProvidersForTest(): void {
  providers.clear()
}
```

- [ ] **Step 4: Wire into wake-time tool composition**

Grep for the place where the runtime builds `tools` for an entity type at wake time. The change is:

```ts
import { resolveToolProviders } from './tool-providers'

// when composing the per-wake tool list:
const providerTools = await resolveToolProviders()
const composedTools = [...entityType.tools, ...providerTools]
```

If the runtime currently constructs the tool list synchronously, lift the call site into the async setup path (the wake-time setup in `create-handler.ts` is the right place).

Add an integration test asserting that an entity type with no `tools` gets the registered provider's tools at runtime — mirror an existing `create-handler` test.

- [ ] **Step 5: Export from `src/index.ts`**

```ts
export { registerToolProvider, unregisterToolProvider } from './tool-providers'
export type { ToolProviderEntry } from './tool-providers'
```

- [ ] **Step 6: Run — PASS** (`pnpm -C packages/agents-runtime test tool-providers`)

- [ ] **Step 7: Commit**

```bash
git add packages/agents-runtime/src/tool-providers.ts packages/agents-runtime/src/index.ts packages/agents-runtime/test/tool-providers.test.ts packages/agents-runtime/src/create-handler.ts
git commit -m "feat(agents-runtime): registerToolProvider hook for wake-time tool composition"
```

---

### Task 18: `mountMcpHttp` — runtime HTTP surface

**Files:**

- Create: `packages/agents-mcp/src/http/cors.ts`
- Create: `packages/agents-mcp/src/http/mount.ts`
- Create: `packages/agents-mcp/test/http/mount.test.ts`

- [ ] **Step 1: Implement `cors.ts`**

```ts
// src/http/cors.ts
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface CorsOpts {
  origins: string[] | '*'
}

export function applyCors(
  req: IncomingMessage,
  res: ServerResponse,
  opts: CorsOpts
): boolean {
  const origin = req.headers.origin ?? ''
  const allowed =
    opts.origins === '*' ||
    (typeof origin === 'string' && opts.origins.includes(origin))
  if (allowed) {
    res.setHeader(
      'Access-Control-Allow-Origin',
      opts.origins === '*' ? '*' : origin
    )
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Max-Age', '600')
  }
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return true
  }
  return false
}
```

- [ ] **Step 2: Write the failing test**

```ts
// test/http/mount.test.ts
import { describe, expect, it } from 'vitest'
import http from 'node:http'
import { createRegistry } from '../../src/registry'
import { inMemoryCredentialStore } from '../../src/credentials/in-memory'
import { mountMcpHttp } from '../../src/http/mount'

async function startServer(reg: ReturnType<typeof createRegistry>) {
  const server = http.createServer()
  mountMcpHttp({
    server,
    registry: reg,
    publicUrl: 'http://localhost:0',
    corsOrigin: '*',
  })
  await new Promise<void>((r) => server.listen(0, r))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('no addr')
  return { server, base: `http://127.0.0.1:${addr.port}` }
}

describe('mountMcpHttp — Phase 1 surface', () => {
  it('GET /api/mcp/servers returns []', async () => {
    const reg = createRegistry({ credentials: inMemoryCredentialStore() })
    const { server, base } = await startServer(reg)
    try {
      const res = await fetch(`${base}/api/mcp/servers`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { servers: unknown[] }
      expect(body.servers).toEqual([])
    } finally {
      server.close()
    }
  })

  it('POST /api/mcp/servers returns AddServerResult envelope', async () => {
    const credentials = inMemoryCredentialStore()
    credentials.setApiKey('mock', 'KEY')
    const reg = createRegistry({
      credentials,
      transportFactoryOverride: () => ({
        client: {
          listTools: async () => ({
            tools: [{ name: 't', inputSchema: { type: 'object' } }],
          }),
          callTool: async () => ({ content: [] }),
          close: async () => {},
        } as any,
        connect: async () => {},
        close: async () => {},
      }),
    })
    const { server, base } = await startServer(reg)
    try {
      const res = await fetch(`${base}/api/mcp/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'mock',
          transport: 'http',
          url: 'https://mock/mcp',
          auth: { mode: 'apiKey' },
        }),
      })
      const body = (await res.json()) as { state: string }
      expect(body.state).toBe('ready')
    } finally {
      server.close()
    }
  })

  it('CORS preflight returns 204 with allowed origin', async () => {
    const reg = createRegistry({ credentials: inMemoryCredentialStore() })
    const { server, base } = await startServer(reg)
    try {
      const res = await fetch(`${base}/api/mcp/servers`, {
        method: 'OPTIONS',
        headers: { origin: 'http://example' },
      })
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
    } finally {
      server.close()
    }
  })
})
```

- [ ] **Step 3: Run — FAIL**

- [ ] **Step 4: Implement**

```ts
// src/http/mount.ts
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Registry } from '../registry'
import type { CredentialStore } from '../credentials/types'
import { applyCors } from './cors'

export interface MountMcpHttpOpts {
  /** Plain Node http.Server. Caller is responsible for `listen`. */
  server: Server
  registry: Registry
  /** Used in Phase 3 for OAuth. */
  credentials?: CredentialStore
  /** Publicly-reachable URL of the runtime (used for OAuth redirect URIs in Phase 3). */
  publicUrl: string
  corsOrigin?: string[] | '*'
  /** Reserved for production: bearer-token check. Default: allow all. */
  requireAuth?: (req: IncomingMessage) => boolean
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => {
      try {
        resolve(
          chunks.length
            ? JSON.parse(Buffer.concat(chunks).toString('utf8'))
            : {}
        )
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export function mountMcpHttp(opts: MountMcpHttpOpts): void {
  const cors = { origins: opts.corsOrigin ?? '*' }
  const auth = opts.requireAuth ?? (() => true)

  opts.server.on('request', async (req, res) => {
    if (applyCors(req, res, cors)) return
    if (!req.url) return
    if (!req.url.startsWith('/api/mcp/') && !req.url.startsWith('/oauth/'))
      return
    if (!auth(req)) {
      send(res, 401, { error: 'unauthorized' })
      return
    }

    try {
      const u = new URL(req.url, 'http://x')

      if (req.method === 'GET' && u.pathname === '/api/mcp/servers') {
        send(res, 200, { servers: opts.registry.list() })
        return
      }

      if (req.method === 'POST' && u.pathname === '/api/mcp/servers') {
        const body = (await readJson(req)) as Parameters<
          Registry['addServer']
        >[0]
        const result = await opts.registry.addServer(body)
        send(res, 200, result)
        return
      }

      const match = u.pathname.match(
        /^\/api\/mcp\/servers\/([^/]+)(?:\/(authorize|disable|enable|reconnect))?$/
      )
      if (match) {
        const name = decodeURIComponent(match[1]!)
        const action = match[2]
        if (req.method === 'DELETE') {
          await opts.registry.removeServer(name)
          send(res, 200, { ok: true })
          return
        }
        if (req.method === 'POST' && action === 'reconnect') {
          const entry = opts.registry.get(name)
          if (!entry) {
            send(res, 404, { error: 'unknown server' })
            return
          }
          const result = await opts.registry.addServer(entry.config)
          send(res, 200, result)
          return
        }
        // disable/enable/authorize wired in later phases
        send(res, 501, { error: `action ${action} not yet implemented` })
        return
      }

      send(res, 404, { error: 'not found' })
    } catch (err) {
      send(res, 500, { error: (err as Error).message })
    }
  })
}
```

- [ ] **Step 5: Run — PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/agents-mcp/src/http packages/agents-mcp/test/http
git commit -m "feat(agents-mcp): mountMcpHttp — Phase 1 surface (list/add/reconnect/delete + CORS)"
```

---

### Task 19: agents-server — `publicUrl` handshake + `/api/runtimes`

**Files:**

- Create: `packages/agents-server/src/runtime-registry.ts`
- Create: `packages/agents-server/test/runtime-registry.test.ts`
- Modify: `packages/agents-server/src/server.ts` — accept `publicUrl` in type-registration; mount `GET /api/runtimes`
- Modify: `packages/agents-runtime/src/create-handler.ts` — accept and forward `publicUrl` + `name`

- [ ] **Step 1: Write the failing test**

```ts
// test/runtime-registry.test.ts
import { describe, expect, it } from 'vitest'
import { createRuntimeRegistry } from '../src/runtime-registry'

describe('runtime-registry', () => {
  it('register stores (name, publicUrl, types) and replaces on re-registration', () => {
    const reg = createRuntimeRegistry()
    reg.register({ name: 'r1', publicUrl: 'http://h:1', types: ['horton'] })
    reg.register({
      name: 'r1',
      publicUrl: 'http://h:2',
      types: ['horton', 'worker'],
    })
    expect(reg.list()).toEqual([
      { name: 'r1', publicUrl: 'http://h:2', types: ['horton', 'worker'] },
    ])
  })

  it('omits entries with no publicUrl', () => {
    const reg = createRuntimeRegistry()
    reg.register({ name: 'r1', types: ['horton'] })
    expect(reg.list()).toEqual([])
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `runtime-registry.ts`**

```ts
// src/runtime-registry.ts
export interface RuntimeRegistration {
  name: string
  publicUrl?: string
  types: string[]
}

export interface RuntimeRegistry {
  register(r: RuntimeRegistration): void
  list(): Array<Required<RuntimeRegistration>>
}

export function createRuntimeRegistry(): RuntimeRegistry {
  const map = new Map<string, RuntimeRegistration>()
  return {
    register(r) {
      if (!r.publicUrl) {
        // eslint-disable-next-line no-console
        console.warn(
          `[agents-server] runtime "${r.name}" registered without publicUrl; omitted from /api/runtimes`
        )
      }
      map.set(r.name, r)
    },
    list() {
      return [...map.values()].filter((r) => !!r.publicUrl) as Array<
        Required<RuntimeRegistration>
      >
    },
  }
}
```

- [ ] **Step 4: Wire into `agents-server/src/server.ts`**

Locate the existing `POST /_electric/agents/types` handler. Two changes:

1. Read optional `name` and `publicUrl` from the JSON body. Call `runtimeRegistry.register({ name, publicUrl, types })`.
2. Add a new route:

```ts
if (req.method === 'GET' && url.pathname === '/api/runtimes') {
  send(res, 200, { runtimes: runtimeRegistry.list(), experimental: true })
  return
}
```

The `runtimeRegistry` is constructed once in `server.ts`'s setup path alongside the existing `wakeRegistry`.

- [ ] **Step 5: Update `agents-runtime/src/create-handler.ts`**

Add `publicUrl?: string` and `name?: string` to `RegisterEntityTypesOpts`. Pass them in the body of the existing `POST /_electric/agents/types` request:

```ts
// inside the existing fetch(...) call
body: JSON.stringify({
  types: /* existing */,
  publicUrl: opts.publicUrl,
  name: opts.name ?? 'default',
}),
```

- [ ] **Step 6: Add an integration test for `/api/runtimes`**

In `packages/agents-server/test/server.test.ts` (or a new `runtimes-discovery.test.ts`): POST to `/_electric/agents/types` with `publicUrl: 'http://r:4448'`, then GET `/api/runtimes`, assert it returns the runtime.

- [ ] **Step 7: Run — `pnpm -C packages/agents-server test`** PASS

- [ ] **Step 8: Commit**

```bash
git add packages/agents-server/src/runtime-registry.ts packages/agents-server/src/server.ts packages/agents-server/test/runtime-registry.test.ts packages/agents-runtime/src/create-handler.ts
git commit -m "feat(agents-server,agents-runtime): publicUrl handshake + GET /api/runtimes (experimental)"
```

---

### Task 20: Bootstrap wiring in `packages/agents`

**Files:**

- Modify: `packages/agents/src/bootstrap.ts`

- [ ] **Step 1: Plan the additions**

Five additions to `bootstrap.ts`:

1. Construct the default `composedCredentialStore(env, osKeychain, file)`.
2. Build the registry from `mcp.json` (if present); register a watcher.
3. Mount `mountMcpHttp` on the runtime's HTTP server.
4. Compute the runtime's `publicUrl` (env var `MCP_RUNTIME_PUBLIC_URL`, default `http://localhost:4448`).
5. Register the MCP tool provider so every entity type sees MCP tools at wake time. Pass `publicUrl` to the runtime handler's registration.

- [ ] **Step 2: Implement**

```ts
// inside packages/agents/src/bootstrap.ts (additions)
import path from 'node:path'
import {
  composedCredentialStore,
  envCredentialStore,
  fileCredentialStore,
  osKeychainCredentialStore,
  createRegistry as createMcpRegistry,
  loadConfig as loadMcpConfig,
  watchConfig as watchMcpConfig,
  mountMcpHttp,
  bridgeMcpTool,
} from '@electric-ax/agents-mcp'
import { registerToolProvider } from '@electric-ax/agents-runtime'

const PUBLIC_URL = process.env.MCP_RUNTIME_PUBLIC_URL ?? 'http://localhost:4448'

const credentials = composedCredentialStore(
  envCredentialStore(),
  osKeychainCredentialStore({ service: 'electric-agents' }),
  fileCredentialStore(path.resolve('.electric-agents/credentials.json'))
)

console.log(
  '[mcp] credentials store: env + os-keychain + file:./.electric-agents/credentials.json'
)
console.log(`[mcp] runtime publicUrl: ${PUBLIC_URL}`)

const mcpRegistry = createMcpRegistry({ credentials })
const mcpConfigPath = path.resolve('mcp.json')

try {
  const cfg = await loadMcpConfig(mcpConfigPath, process.env)
  await mcpRegistry.applyConfig(cfg)
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  console.log(`[mcp] no ${mcpConfigPath} — start with no servers`)
}

await watchMcpConfig(mcpConfigPath, {
  onChange: (cfg) =>
    mcpRegistry
      .applyConfig(cfg)
      .catch((e) => console.error('[mcp] applyConfig:', e)),
  onError: (e) => console.error('[mcp] config error:', e),
}).catch(() => {
  /* file may not exist initially */
})

// httpServer here is the same Node http.Server that the runtime handler listens on.
// Locate it where the handler is constructed in the existing bootstrap code.
mountMcpHttp({
  server: httpServer,
  registry: mcpRegistry,
  credentials,
  publicUrl: PUBLIC_URL,
  corsOrigin: process.env.MCP_CORS_ORIGIN?.split(',') ?? '*',
})

registerToolProvider({
  name: 'mcp',
  tools: () => {
    const tools: ReturnType<typeof bridgeMcpTool>[] = []
    for (const entry of mcpRegistry.list()) {
      if (entry.status !== 'ready') continue
      const live = mcpRegistry.get(entry.name)
      if (!live?.transport) continue
      for (const t of entry.tools) {
        tools.push(
          bridgeMcpTool({
            server: entry.name,
            tool: t,
            client: live.transport.client,
            timeoutMs: live.config.timeoutMs,
          })
        )
      }
    }
    return tools
  },
})

// And finally, in the existing entity-type registration call site, pass publicUrl.
// e.g.: `createHandler({ ..., publicUrl: PUBLIC_URL, name: 'builtin-agents' })`
```

- [ ] **Step 3: Add a smoke test for the bootstrap wiring**

`packages/agents/test/bootstrap-mcp.test.ts` (sketch): start the bootstrap in a test fixture; assert that without `mcp.json` the `/api/mcp/servers` endpoint returns `{ servers: [] }`; with a stubbed `mcp.json` containing an apiKey server (and the env var set) the endpoint returns one entry with `status: 'ready'`.

- [ ] **Step 4: Run — `pnpm -C packages/agents test`** PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agents
git commit -m "feat(agents): bootstrap MCP — credentials, registry, mountMcpHttp, registerToolProvider, publicUrl handshake"
```

---

### Task 21: Phase 1 verification — manual end-to-end with `apiKey`

- [ ] **Step 1: Type and test sweep**

```bash
pnpm -r typecheck
pnpm -r test --run
```

Expected: clean across all packages.

- [ ] **Step 2: Manual smoke — apiKey end-to-end**

1. Create `mcp.json` at the workspace root:

```jsonc
{
  "servers": {
    "demo": {
      "transport": "http",
      "url": "https://api.example.com/mcp",
      "auth": { "mode": "apiKey", "headerName": "X-Api-Key" },
    },
  },
}
```

2. Set the env var: `export MCP_DEMO_API_KEY=...`
3. Boot agents-server + the agents runtime as you normally would.
4. Verify discovery and listing:

```bash
curl http://localhost:4437/api/runtimes
# expect [{ name: 'builtin-agents', publicUrl: 'http://localhost:4448', types: [...] }]

curl http://localhost:4448/api/mcp/servers
# expect a `demo` row with status: 'ready' and toolCount > 0
```

5. Open Horton (or any registered entity) and confirm the model sees `mcp__demo__*` tools and can call one.

- [ ] **Step 3: Commit a milestone**

```bash
git commit --allow-empty -m "milestone: agents-mcp phase 1 complete — apiKey direct-call works"
```

---

## Phase 2 — Protocol coverage + E2E

End state: Resources, prompts, progress notifications, cancellation, and capability negotiation all work. The package has a comprehensive end-to-end test suite that runs the bridge against the **official MCP `everything` server** in both stdio and HTTP modes.

We use the official server (`@modelcontextprotocol/server-everything`) instead of a hand-rolled mock to keep tests aligned with the real protocol. Phase 2 adds no public API surface that the runtime cares about — these are SDK-driven protocol features the bridge needs to forward correctly.

### Task 22: Resources bridge

**Files:**

- Create: `packages/agents-mcp/src/bridge/resource-bridge.ts`
- Create: `packages/agents-mcp/test/bridge/resource-bridge.test.ts`

> The bridge surfaces two synthetic tools per server: `mcp__<server>__list_resources` and `mcp__<server>__read_resource`. The model uses these like any other tool to enumerate and fetch resources.

- [ ] **Step 1: Write the failing test**

```ts
// test/bridge/resource-bridge.test.ts
import { describe, expect, it, vi } from 'vitest'
import { buildResourceTools } from '../../src/bridge/resource-bridge'

describe('resource bridge', () => {
  it('emits list_resources and read_resource tools with correct prefixed names', () => {
    const client = {
      listResources: vi.fn(async () => ({
        resources: [{ uri: 'file:///a', name: 'a' }],
      })),
      readResource: vi.fn(async () => ({
        contents: [{ uri: 'file:///a', text: 'data' }],
      })),
    } as any
    const tools = buildResourceTools({ server: 'mock', client })
    expect(tools.map((t) => t.name)).toEqual([
      'mcp__mock__list_resources',
      'mcp__mock__read_resource',
    ])
  })

  it('list_resources returns the raw SDK result', async () => {
    const client = {
      listResources: vi.fn(async () => ({
        resources: [{ uri: 'u', name: 'n' }],
      })),
    } as any
    const [list] = buildResourceTools({ server: 'mock', client })
    expect(await list!.call({})).toEqual({
      resources: [{ uri: 'u', name: 'n' }],
    })
  })

  it('read_resource forwards uri', async () => {
    const readResource = vi.fn(async () => ({
      contents: [{ uri: 'u', text: 'x' }],
    }))
    const client = {
      listResources: async () => ({ resources: [] }),
      readResource,
    } as any
    const [, read] = buildResourceTools({ server: 'mock', client })
    await read!.call({ uri: 'u' })
    expect(readResource).toHaveBeenCalledWith({ uri: 'u' })
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```ts
// src/bridge/resource-bridge.ts
import { prefixToolName } from './tool-bridge'
import { withTimeout, DEFAULT_TIMEOUT_MS } from '../transports/timeout'

export interface BuildResourceToolsOpts {
  server: string
  client: {
    listResources: () => Promise<unknown>
    readResource: (args: { uri: string }) => Promise<unknown>
  }
  timeoutMs?: number
}

export interface BridgedTool {
  name: string
  description?: string
  inputSchema: unknown
  call(args: unknown): Promise<unknown>
}

export function buildResourceTools(
  opts: BuildResourceToolsOpts
): BridgedTool[] {
  const ms = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return [
    {
      name: prefixToolName(opts.server, 'list_resources'),
      description: `List resources on ${opts.server}`,
      inputSchema: { type: 'object', properties: {} },
      call: () => withTimeout(opts.client.listResources(), ms),
    },
    {
      name: prefixToolName(opts.server, 'read_resource'),
      description: `Read a resource from ${opts.server}`,
      inputSchema: {
        type: 'object',
        properties: { uri: { type: 'string' } },
        required: ['uri'],
      },
      call: (args) =>
        withTimeout(opts.client.readResource(args as { uri: string }), ms),
    },
  ]
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/bridge/resource-bridge.ts packages/agents-mcp/test/bridge/resource-bridge.test.ts
git commit -m "feat(agents-mcp): resource bridge — list_resources + read_resource synthetic tools"
```

---

### Task 23: Prompts bridge

**Files:**

- Create: `packages/agents-mcp/src/bridge/prompt-bridge.ts`
- Create: `packages/agents-mcp/test/bridge/prompt-bridge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/bridge/prompt-bridge.test.ts
import { describe, expect, it, vi } from 'vitest'
import { buildPromptTools } from '../../src/bridge/prompt-bridge'

describe('prompt bridge', () => {
  it('emits list_prompts and get_prompt tools with prefixed names', () => {
    const client = {
      listPrompts: async () => ({ prompts: [] }),
      getPrompt: async () => ({ messages: [] }),
    } as any
    const tools = buildPromptTools({ server: 'mock', client })
    expect(tools.map((t) => t.name)).toEqual([
      'mcp__mock__list_prompts',
      'mcp__mock__get_prompt',
    ])
  })

  it('get_prompt forwards name and arguments', async () => {
    const getPrompt = vi.fn(async () => ({ messages: [] }))
    const client = {
      listPrompts: async () => ({ prompts: [] }),
      getPrompt,
    } as any
    const [, get] = buildPromptTools({ server: 'mock', client })
    await get!.call({ name: 'p', arguments: { a: 1 } })
    expect(getPrompt).toHaveBeenCalledWith({ name: 'p', arguments: { a: 1 } })
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```ts
// src/bridge/prompt-bridge.ts
import { prefixToolName } from './tool-bridge'
import { withTimeout, DEFAULT_TIMEOUT_MS } from '../transports/timeout'
import type { BridgedTool } from './tool-bridge'

export interface BuildPromptToolsOpts {
  server: string
  client: {
    listPrompts: () => Promise<unknown>
    getPrompt: (args: {
      name: string
      arguments?: Record<string, unknown>
    }) => Promise<unknown>
  }
  timeoutMs?: number
}

export function buildPromptTools(opts: BuildPromptToolsOpts): BridgedTool[] {
  const ms = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return [
    {
      name: prefixToolName(opts.server, 'list_prompts'),
      description: `List prompts on ${opts.server}`,
      inputSchema: { type: 'object', properties: {} },
      call: () => withTimeout(opts.client.listPrompts(), ms),
    },
    {
      name: prefixToolName(opts.server, 'get_prompt'),
      description: `Get a prompt template from ${opts.server}`,
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          arguments: { type: 'object', additionalProperties: true },
        },
        required: ['name'],
      },
      call: (args) =>
        withTimeout(
          opts.client.getPrompt(
            args as { name: string; arguments?: Record<string, unknown> }
          ),
          ms
        ),
    },
  ]
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Wire resources + prompts into the bootstrap tool provider**

Modify the `tools()` callback registered in Task 20 (`packages/agents/src/bootstrap.ts`) to include resource and prompt tools per server when the server's capabilities advertise them:

```ts
import { buildResourceTools, buildPromptTools } from '@electric-ax/agents-mcp'

// inside the tools() callback, per ready server:
const caps = live.transport.client.getServerCapabilities()
if (caps?.resources) {
  tools.push(
    ...buildResourceTools({
      server: entry.name,
      client: live.transport.client as any,
      timeoutMs: live.config.timeoutMs,
    })
  )
}
if (caps?.prompts) {
  tools.push(
    ...buildPromptTools({
      server: entry.name,
      client: live.transport.client as any,
      timeoutMs: live.config.timeoutMs,
    })
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/agents-mcp/src/bridge/prompt-bridge.ts packages/agents-mcp/test/bridge/prompt-bridge.test.ts packages/agents/src/bootstrap.ts
git commit -m "feat(agents-mcp): prompt bridge + bootstrap wires resources/prompts when advertised"
```

---

### Task 24: Progress notifications passthrough

**Files:**

- Modify: `packages/agents-mcp/src/bridge/tool-bridge.ts`
- Create: `packages/agents-mcp/test/bridge/progress.test.ts`

> MCP servers can emit progress notifications during a long tool call. The SDK exposes them via a callback on `callTool`. Phase 2 forwards progress to a per-call optional callback so callers (the runtime, eventually the UI) can surface them. Phase 1 callers ignore progress; Phase 2 keeps that the default but adds the hook.

- [ ] **Step 1: Write the failing test**

```ts
// test/bridge/progress.test.ts
import { describe, expect, it, vi } from 'vitest'
import { bridgeMcpTool } from '../../src/bridge/tool-bridge'

describe('progress passthrough', () => {
  it('forwards progress notifications to the optional callback', async () => {
    const callTool = vi.fn(
      async (_args, opts: { onProgress?: (p: unknown) => void }) => {
        opts.onProgress?.({ progress: 0.5 })
        return { content: [{ type: 'text', text: 'done' }] }
      }
    )
    const onProgress = vi.fn()
    const tool = bridgeMcpTool({
      server: 'mock',
      tool: { name: 'long', description: 'd', inputSchema: { type: 'object' } },
      client: { callTool } as any,
      timeoutMs: 1000,
      onProgress,
    })
    await tool.call({})
    expect(onProgress).toHaveBeenCalledWith({ progress: 0.5 })
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Update `bridgeMcpTool` to accept `onProgress`**

```ts
// edit src/bridge/tool-bridge.ts BridgeToolOpts:
export interface BridgeToolOpts {
  server: string
  tool: { name: string; description?: string; inputSchema: unknown }
  client: {
    callTool: (
      args: { name: string; arguments?: unknown },
      opts?: { onProgress?: (p: unknown) => void; signal?: AbortSignal }
    ) => Promise<unknown>
  }
  timeoutMs?: number
  onProgress?: (p: unknown) => void
}

// In the call() body:
return await withTimeout(
  opts.client.callTool(
    { name: opts.tool.name, arguments: args },
    opts.onProgress ? { onProgress: opts.onProgress } : undefined
  ),
  ms
)
```

- [ ] **Step 4: Run — PASS** (existing tool-bridge tests still pass; new progress test passes)

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/bridge/tool-bridge.ts packages/agents-mcp/test/bridge/progress.test.ts
git commit -m "feat(agents-mcp): forward MCP progress notifications via optional onProgress hook"
```

---

### Task 25: Cancellation

**Files:**

- Modify: `packages/agents-mcp/src/bridge/tool-bridge.ts`
- Modify: `packages/agents-mcp/src/transports/timeout.ts`
- Create: `packages/agents-mcp/test/bridge/cancellation.test.ts`

> Two cancellation paths: (a) the timeout helper aborts the call when the budget is exceeded; (b) callers can pass an `AbortSignal` they control. The SDK's `callTool` accepts `signal`; we surface it.

- [ ] **Step 1: Write the failing test**

```ts
// test/bridge/cancellation.test.ts
import { describe, expect, it, vi } from 'vitest'
import { bridgeMcpTool } from '../../src/bridge/tool-bridge'

describe('cancellation', () => {
  it('aborts the SDK call when the caller-supplied signal aborts', async () => {
    let abortedFromSdk = false
    const callTool = vi.fn(async (_args, o: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        o.signal?.addEventListener('abort', () => {
          abortedFromSdk = true
          reject(new Error('aborted'))
        })
      })
    })
    const ctrl = new AbortController()
    const tool = bridgeMcpTool({
      server: 'mock',
      tool: { name: 't', description: 'd', inputSchema: { type: 'object' } },
      client: { callTool } as any,
      timeoutMs: 5000,
      signal: ctrl.signal,
    })
    const p = tool.call({})
    ctrl.abort()
    await expect(p).rejects.toBeDefined()
    expect(abortedFromSdk).toBe(true)
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Add `signal` to `BridgeToolOpts` and forward it**

```ts
// In BridgeToolOpts:
signal?: AbortSignal

// In call():
return await withTimeout(
  opts.client.callTool(
    { name: opts.tool.name, arguments: args },
    {
      onProgress: opts.onProgress,
      signal: opts.signal,
    },
  ),
  ms,
)
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/bridge/tool-bridge.ts packages/agents-mcp/test/bridge/cancellation.test.ts
git commit -m "feat(agents-mcp): forward AbortSignal to SDK callTool for cancellation"
```

---

### Task 26: Capability negotiation assertions

**Files:**

- Modify: `packages/agents-mcp/src/registry.ts` — record server capabilities on connect
- Create: `packages/agents-mcp/test/registry-capabilities.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/registry-capabilities.test.ts
import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/registry'
import { inMemoryCredentialStore } from '../src/credentials/in-memory'

describe('Registry — capabilities', () => {
  it('records the server-advertised capabilities after connect', async () => {
    const credentials = inMemoryCredentialStore()
    credentials.setApiKey('mock', 'KEY')
    const reg = createRegistry({
      credentials,
      transportFactoryOverride: () => ({
        client: {
          listTools: async () => ({ tools: [] }),
          getServerCapabilities: () => ({ resources: {}, prompts: {} }),
          callTool: async () => ({ content: [] }),
          close: async () => {},
        } as any,
        connect: async () => {},
        close: async () => {},
      }),
    })
    await reg.addServer({
      name: 'mock',
      transport: 'http',
      url: 'https://mock/mcp',
      auth: { mode: 'apiKey' },
    })
    const entry = reg.get('mock')
    expect(entry?.capabilities).toEqual({ resources: {}, prompts: {} })
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Capture capabilities in the registry**

```ts
// In Entry interface, add:
capabilities?: unknown

// In connectAndList(), after listTools():
entry.capabilities = entry.transport.client.getServerCapabilities?.()
```

Update `ListedEntry` to include `capabilities` and the `list()` projection to surface it.

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/registry.ts packages/agents-mcp/test/registry-capabilities.test.ts
git commit -m "feat(agents-mcp): record server capabilities at connect time"
```

---

### Task 27: E2E suite — official `everything` server (stdio)

**Files:**

- Create: `packages/agents-mcp/test/e2e/everything-stdio.test.ts`

> The everything server is the official protocol-coverage reference. It exposes a known-good set of tools, resources, prompts, and sampling. We use it for both stdio and HTTP transport coverage.

- [ ] **Step 1: Write the test**

```ts
// test/e2e/everything-stdio.test.ts
import { describe, expect, it } from 'vitest'
import { createRegistry } from '../../src/registry'
import { inMemoryCredentialStore } from '../../src/credentials/in-memory'
import { bridgeMcpTool } from '../../src/bridge/tool-bridge'
import { buildResourceTools } from '../../src/bridge/resource-bridge'
import { buildPromptTools } from '../../src/bridge/prompt-bridge'

describe('E2E — everything server (stdio)', () => {
  it('connects, lists tools, calls echo', async () => {
    const reg = createRegistry({ credentials: inMemoryCredentialStore() })
    const result = await reg.addServer({
      name: 'everything',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-everything'],
    })
    expect(result.state).toBe('ready')
    const entry = reg.get('everything')!
    expect(entry.tools.length).toBeGreaterThan(0)

    const echoTool = entry.tools.find((t) => t.name === 'echo')
    expect(echoTool).toBeDefined()
    const tool = bridgeMcpTool({
      server: 'everything',
      tool: echoTool!,
      client: entry.transport!.client as any,
      timeoutMs: 5000,
    })
    const out = (await tool.call({ message: 'hi' })) as {
      content: Array<{ type: string; text: string }>
    }
    expect(
      out.content.some((c) => c.type === 'text' && c.text.includes('hi'))
    ).toBe(true)

    await reg.removeServer('everything')
  }, 60_000)

  it('lists resources and reads one', async () => {
    const reg = createRegistry({ credentials: inMemoryCredentialStore() })
    await reg.addServer({
      name: 'everything',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-everything'],
    })
    const entry = reg.get('everything')!
    const [list, read] = buildResourceTools({
      server: 'everything',
      client: entry.transport!.client as any,
      timeoutMs: 5000,
    })
    const listed = (await list!.call({})) as {
      resources: Array<{ uri: string }>
    }
    expect(listed.resources.length).toBeGreaterThan(0)
    const first = listed.resources[0]!
    const got = (await read!.call({ uri: first.uri })) as {
      contents: unknown[]
    }
    expect(got.contents.length).toBeGreaterThan(0)
    await reg.removeServer('everything')
  }, 60_000)

  it('lists prompts and gets one', async () => {
    const reg = createRegistry({ credentials: inMemoryCredentialStore() })
    await reg.addServer({
      name: 'everything',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-everything'],
    })
    const entry = reg.get('everything')!
    const [list, get] = buildPromptTools({
      server: 'everything',
      client: entry.transport!.client as any,
      timeoutMs: 5000,
    })
    const listed = (await list!.call({})) as {
      prompts: Array<{ name: string }>
    }
    expect(listed.prompts.length).toBeGreaterThan(0)
    const first = listed.prompts[0]!
    const out = (await get!.call({ name: first.name })) as {
      messages: unknown[]
    }
    expect(out.messages.length).toBeGreaterThan(0)
    await reg.removeServer('everything')
  }, 60_000)

  it('connection idempotency: re-adding the same config does not respawn the subprocess', async () => {
    const reg = createRegistry({ credentials: inMemoryCredentialStore() })
    const cfg = {
      name: 'everything',
      transport: 'stdio' as const,
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-everything'],
    }
    await reg.addServer(cfg)
    const transportBefore = reg.get('everything')?.transport
    await reg.addServer(cfg)
    const transportAfter = reg.get('everything')?.transport
    expect(transportAfter).toBe(transportBefore)
    await reg.removeServer('everything')
  }, 60_000)
})
```

- [ ] **Step 2: Run — `pnpm -C packages/agents-mcp test e2e/everything-stdio`**

Expected: PASS. (Tests are slow because of `npx`; allow 60s.)

- [ ] **Step 3: Commit**

```bash
git add packages/agents-mcp/test/e2e/everything-stdio.test.ts
git commit -m "test(agents-mcp): e2e — everything server over stdio (tools, resources, prompts, idempotency)"
```

---

### Task 28: E2E suite — official `everything` server (HTTP)

**Files:**

- Create: `packages/agents-mcp/test/e2e/everything-http.test.ts`

> The everything server can run as an HTTP server (`npx ... --port=NNNN`). Phase 2's HTTP E2E spawns it as a subprocess in `beforeAll`, points the registry at `http://127.0.0.1:NNNN/mcp`, and reuses the stdio test's coverage shape.

- [ ] **Step 1: Write the test**

```ts
// test/e2e/everything-http.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRegistry } from '../../src/registry'
import { inMemoryCredentialStore } from '../../src/credentials/in-memory'
import { bridgeMcpTool } from '../../src/bridge/tool-bridge'

const PORT = 38421

async function waitFor(url: string, timeoutMs = 15_000): Promise<void> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' })
      if (res.status < 500) return
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`server not ready: ${url}`)
}

describe('E2E — everything server (HTTP)', () => {
  let proc: ChildProcess

  beforeAll(async () => {
    proc = spawn(
      'npx',
      [
        '-y',
        '@modelcontextprotocol/server-everything',
        '--transport=http',
        `--port=${PORT}`,
      ],
      { stdio: 'pipe' }
    )
    await waitFor(`http://127.0.0.1:${PORT}/`, 30_000)
  }, 60_000)

  afterAll(() => {
    proc?.kill('SIGTERM')
  })

  it('connects via HTTP and lists tools', async () => {
    const reg = createRegistry({ credentials: inMemoryCredentialStore() })
    const r = await reg.addServer({
      name: 'everything-http',
      transport: 'http',
      url: `http://127.0.0.1:${PORT}/mcp`,
      auth: { mode: 'none' },
    })
    expect(r.state).toBe('ready')
    expect(reg.get('everything-http')?.tools.length).toBeGreaterThan(0)
    await reg.removeServer('everything-http')
  }, 60_000)

  it('calls echo via HTTP', async () => {
    const reg = createRegistry({ credentials: inMemoryCredentialStore() })
    await reg.addServer({
      name: 'everything-http',
      transport: 'http',
      url: `http://127.0.0.1:${PORT}/mcp`,
      auth: { mode: 'none' },
    })
    const entry = reg.get('everything-http')!
    const echoTool = entry.tools.find((t) => t.name === 'echo')!
    const tool = bridgeMcpTool({
      server: 'everything-http',
      tool: echoTool,
      client: entry.transport!.client as any,
      timeoutMs: 5000,
    })
    const out = (await tool.call({ message: 'hello' })) as {
      content: Array<{ type: string; text: string }>
    }
    expect(out.content.some((c) => c.text.includes('hello'))).toBe(true)
    await reg.removeServer('everything-http')
  }, 60_000)
})
```

- [ ] **Step 2: Allow `auth.mode: 'none'` in the registry's HTTP path**

`createRegistry`'s `buildTransport` for `transport: 'http'` currently only handles `apiKey`. Add an explicit branch:

```ts
if (cfg.auth.mode === 'none') {
  return { transport: createHttpTransport({ name: cfg.name, url: cfg.url }) }
}
```

Also update the parser/types if `auth: { mode: 'none' }` isn't already accepted on http servers (`McpHttpServerConfig.auth` already permits it via `McpAuthConfig`).

- [ ] **Step 3: Run — PASS**

- [ ] **Step 4: Commit**

```bash
git add packages/agents-mcp/src/registry.ts packages/agents-mcp/test/e2e/everything-http.test.ts
git commit -m "test(agents-mcp): e2e — everything server over HTTP; allow auth.mode='none' for unauth http"
```

---

### Task 29: Phase 2 verification

- [ ] **Step 1: Test suite green across the package**

Run: `pnpm -C packages/agents-mcp test --run`
Expected: PASS, including the slow E2E tests.

- [ ] **Step 2: Confirm protocol coverage map**

Manually walk the spec's "MCP spec conformance" section and check:

- [x] Tools listing + invocation (Phase 1).
- [x] Resources list + read (Task 22, E2E).
- [x] Prompts list + get (Task 23, E2E).
- [x] Progress notifications (Task 24).
- [x] Cancellation (Task 25).
- [x] Capability negotiation (Task 26).
- [ ] OAuth 2.1 + PKCE + DCR + RFC 9728 + RFC 8707 — **Phase 3**.

- [ ] **Step 3: Commit milestone**

```bash
git commit --allow-empty -m "milestone: agents-mcp phase 2 complete — protocol coverage + E2E"
```

---

## Phase 3 — OAuth via SDK provider

End state: An MCP server declared with `auth.mode: 'authorizationCode'` (browser flow) goes through PKCE + DCR + RFC 9728 discovery + token exchange + 401-retry / refresh transparently — and **none of that code lives in our repo**. The MCP SDK does it all via its `OAuthClientProvider` interface; we provide a thin adapter that persists tokens and client info via `CredentialStore`. `clientCredentials` mode is also wired in this phase (simpler — it's just a token-fetch using stored client credentials).

The OAuth callback (`GET /oauth/callback/:server`) lives on the **runtime**, not agents-server.

### Task 30: SDK `OAuthClientProvider` adapter

**Files:**

- Create: `packages/agents-mcp/src/auth/sdk-provider.ts`
- Create: `packages/agents-mcp/test/auth/sdk-provider.test.ts`

> The MCP SDK exports `OAuthClientProvider` (interface) and supporting types (`OAuthClientInformation`, `OAuthTokens`). Methods we implement:
>
> - `redirectUrl` — getter returning the per-server redirect URL.
> - `clientMetadata` — getter returning DCR client metadata.
> - `clientInformation()` — load saved client info (or undefined → triggers DCR).
> - `saveClientInformation(info)` — persist DCR result.
> - `tokens()` — load saved tokens.
> - `saveTokens(tokens)` — persist after refresh / first auth.
> - `redirectToAuthorization(url)` — invoked on first auth; we record the URL so `addServer` can return it in the `authenticating` envelope.
> - `saveCodeVerifier(v)` / `codeVerifier()` — round-trip the PKCE verifier in memory keyed by server.

- [ ] **Step 1: Write the failing test**

```ts
// test/auth/sdk-provider.test.ts
import { describe, expect, it } from 'vitest'
import { createSdkOAuthProvider } from '../../src/auth/sdk-provider'
import { inMemoryCredentialStore } from '../../src/credentials/in-memory'

describe('createSdkOAuthProvider', () => {
  it('round-trips tokens via CredentialStore', async () => {
    const credentials = inMemoryCredentialStore()
    const p = createSdkOAuthProvider({
      server: 'mock',
      publicUrl: 'http://r:4448',
      credentials,
      scopes: ['mcp:read'],
    })
    expect(p.redirectUrl).toBe('http://r:4448/oauth/callback/mock')
    await p.saveTokens({ access_token: 'AT', token_type: 'Bearer' } as any)
    expect((await p.tokens())?.access_token).toBe('AT')
  })

  it('captures the authorize URL via redirectToAuthorization for the addServer envelope', async () => {
    const credentials = inMemoryCredentialStore()
    const p = createSdkOAuthProvider({
      server: 'mock',
      publicUrl: 'http://r:4448',
      credentials,
      scopes: ['mcp:read'],
    })
    p.redirectToAuthorization(new URL('https://provider/authorize?x=1'))
    expect(p.peekAuthUrl()).toBe('https://provider/authorize?x=1')
  })

  it('round-trips DCR client info', async () => {
    const credentials = inMemoryCredentialStore()
    const p = createSdkOAuthProvider({
      server: 'mock',
      publicUrl: 'http://r:4448',
      credentials,
      scopes: ['mcp:read'],
    })
    await p.saveClientInformation({ client_id: 'cid' } as any)
    expect((await p.clientInformation())?.client_id).toBe('cid')
  })

  it('honors a redirectUri override from auth config', () => {
    const credentials = inMemoryCredentialStore()
    const p = createSdkOAuthProvider({
      server: 'mock',
      publicUrl: 'http://r:4448',
      credentials,
      scopes: ['mcp:read'],
      redirectUri: 'http://custom/cb',
    })
    expect(p.redirectUrl).toBe('http://custom/cb')
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```ts
// src/auth/sdk-provider.ts
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens as SdkOAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  CredentialStore,
  OAuthClientInfo,
  OAuthTokens,
} from '../credentials/types'

export interface CreateSdkOAuthProviderOpts {
  server: string
  publicUrl: string
  credentials: CredentialStore
  scopes?: string[]
  redirectUri?: string
  /** RFC 8707 resource indicator. */
  resource?: string
}

/**
 * Adapter that implements MCP SDK's OAuthClientProvider, persisting via CredentialStore.
 * The SDK handles PKCE, DCR (RFC 7591), discovery (RFC 9728), token exchange, refresh,
 * and 401-retry. We only persist.
 */
export interface SdkOAuthProvider extends OAuthClientProvider {
  /** Returns the most recent authorize URL captured by redirectToAuthorization. */
  peekAuthUrl(): string | undefined
  /** Resets the captured authorize URL. */
  clearAuthUrl(): void
}

export function createSdkOAuthProvider(
  opts: CreateSdkOAuthProviderOpts
): SdkOAuthProvider {
  const redirect =
    opts.redirectUri ??
    `${opts.publicUrl.replace(/\/$/, '')}/oauth/callback/${opts.server}`
  let codeVerifier: string | undefined
  let lastAuthUrl: string | undefined

  const toSdkTokens = (t: OAuthTokens): SdkOAuthTokens =>
    ({
      access_token: t.accessToken,
      refresh_token: t.refreshToken,
      expires_in: t.expiresAt
        ? Math.max(0, t.expiresAt - Math.floor(Date.now() / 1000))
        : undefined,
      token_type: t.tokenType,
      scope: t.scope,
    }) as SdkOAuthTokens

  const fromSdkTokens = (t: SdkOAuthTokens): OAuthTokens => ({
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: t.expires_in
      ? Math.floor(Date.now() / 1000) + t.expires_in
      : undefined,
    tokenType: t.token_type,
    scope: t.scope,
  })

  const toSdkClientInfo = (c: OAuthClientInfo): OAuthClientInformationFull =>
    ({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      redirect_uris: c.redirectUris ?? [redirect],
    }) as OAuthClientInformationFull

  const fromSdkClientInfo = (c: OAuthClientInformation): OAuthClientInfo => ({
    clientId: c.client_id,
    clientSecret: (c as OAuthClientInformationFull).client_secret,
    redirectUris: (c as OAuthClientInformationFull).redirect_uris,
    registeredAt: Math.floor(Date.now() / 1000),
  })

  return {
    get redirectUrl() {
      return redirect
    },
    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: '@electric-ax/agents-mcp',
        redirect_uris: [redirect],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
        scope: opts.scopes?.join(' '),
      } as OAuthClientMetadata
    },

    async clientInformation() {
      const saved = await opts.credentials.getOAuthClientInfo?.(opts.server)
      return saved ? toSdkClientInfo(saved) : undefined
    },

    async saveClientInformation(info: OAuthClientInformationFull) {
      if (!opts.credentials.saveOAuthClientInfo) {
        throw new Error(
          `No CredentialStore.saveOAuthClientInfo available — cannot persist DCR result for "${opts.server}"`
        )
      }
      await opts.credentials.saveOAuthClientInfo(
        opts.server,
        fromSdkClientInfo(info)
      )
    },

    async tokens(): Promise<SdkOAuthTokens | undefined> {
      const saved = await opts.credentials.getOAuthTokens?.(opts.server)
      return saved ? toSdkTokens(saved) : undefined
    },

    async saveTokens(tokens: SdkOAuthTokens) {
      if (!opts.credentials.saveOAuthTokens) {
        throw new Error(
          `No CredentialStore.saveOAuthTokens available — cannot persist tokens for "${opts.server}"`
        )
      }
      await opts.credentials.saveOAuthTokens(opts.server, fromSdkTokens(tokens))
    },

    redirectToAuthorization(url: URL) {
      lastAuthUrl = url.toString()
    },

    saveCodeVerifier(v: string) {
      codeVerifier = v
    },
    async codeVerifier() {
      if (!codeVerifier)
        throw new Error(`No PKCE codeVerifier set for "${opts.server}"`)
      return codeVerifier
    },

    peekAuthUrl() {
      return lastAuthUrl
    },
    clearAuthUrl() {
      lastAuthUrl = undefined
    },
  }
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/auth/sdk-provider.ts packages/agents-mcp/test/auth/sdk-provider.test.ts
git commit -m "feat(agents-mcp): SDK OAuthClientProvider adapter — persists via CredentialStore"
```

---

### Task 31: Wire OAuth into the registry

**Files:**

- Modify: `packages/agents-mcp/src/registry.ts` — handle `authorizationCode` (browser) + `clientCredentials`
- Modify: `packages/agents-mcp/src/transports/http.ts` — accept an `oauthProvider` and let the SDK transport handle auth automatically
- Modify: `packages/agents-mcp/test/registry.test.ts` — extend with OAuth scenarios

> The MCP SDK's `StreamableHTTPClientTransport` accepts an `authProvider` (the `OAuthClientProvider` instance). When supplied, the SDK auto-handles the OAuth dance: 401-retry, refresh, DCR if no client info present, etc. Our registry's job is to construct the provider, hand it to the transport, and translate "needs first authorization" into an `authenticating` envelope.

- [ ] **Step 1: Update `createHttpTransport` to accept `authProvider`**

```ts
// src/transports/http.ts
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'

export interface HttpTransportOpts {
  name: string
  url: string
  headerProvider?: () => Promise<{ name: string; value: string } | undefined>
  authProvider?: OAuthClientProvider
  fetchImpl?: typeof fetch
}

export function createHttpTransport(opts: HttpTransportOpts): McpTransport {
  const fetchImpl = opts.fetchImpl ?? fetch
  const transport = new StreamableHTTPClientTransport(new URL(opts.url), {
    authProvider: opts.authProvider,
    fetch: opts.headerProvider
      ? async (url, init) => {
          const headers = new Headers(init?.headers)
          const h = await opts.headerProvider!()
          if (h) headers.set(h.name, h.value)
          return fetchImpl(url, { ...init, headers })
        }
      : fetchImpl,
  })
  // ... rest unchanged
}
```

- [ ] **Step 2: Extend the registry — handle `authorizationCode` + `clientCredentials`**

```ts
// inside src/registry.ts buildTransport(), add to the http branch:

if (cfg.auth.mode === 'authorizationCode') {
  const provider = createSdkOAuthProvider({
    server: cfg.name,
    publicUrl: opts.publicUrl ?? '',
    credentials: opts.credentials,
    scopes: cfg.auth.scopes,
    redirectUri: cfg.auth.redirectUri,
    resource: cfg.auth.resource,
  })
  // Bind the provider into the transport. After connect(), if the SDK had to
  // call redirectToAuthorization, peekAuthUrl() will have a URL.
  return {
    transport: createHttpTransport({
      name: cfg.name,
      url: cfg.url,
      authProvider: provider,
    }),
    provider,
  }
}

if (cfg.auth.mode === 'clientCredentials') {
  const cc = await opts.credentials.getClientCredentials?.(cfg.name)
  if (!cc)
    return {
      error: makeError(
        'auth_unavailable',
        `no clientCredentials for ${cfg.name}`
      ),
    }
  // The SDK's clientCredentials grant lives in the auth provider. We construct
  // a provider-shaped object here that fetches a token using cc.
  const provider = createClientCredentialsProvider({
    tokenUrl: cfg.auth.tokenUrl,
    clientId: cc.clientId,
    clientSecret: cc.clientSecret,
    scopes: cfg.auth.scopes,
    audience: cfg.auth.audience,
    resource: cfg.auth.resource,
  })
  return {
    transport: createHttpTransport({
      name: cfg.name,
      url: cfg.url,
      authProvider: provider,
    }),
  }
}
```

The registry must also pass `publicUrl` through. Add it to `RegistryOpts`:

```ts
export interface RegistryOpts {
  credentials: CredentialStore
  /** Used as the base for OAuth callback URLs. */
  publicUrl?: string
  // ...
}
```

- [ ] **Step 3: After `connectAndList`, check `peekAuthUrl()` and surface in the result**

The flow: the SDK transport may, on first connect, call `redirectToAuthorization` and then throw an `UnauthorizedError`. Catch it, read `provider.peekAuthUrl()`, and return `{ state: 'authenticating', authUrl }` from `addServer`.

Update the connect flow:

```ts
async function connectAndList(
  entry: Entry,
  provider?: SdkOAuthProvider
): Promise<AddServerResult> {
  if (!entry.transport) return { state: 'error' /* ... */ }
  try {
    await entry.transport.connect()
    // ... list tools, ready
  } catch (err) {
    const url = provider?.peekAuthUrl()
    if (url) {
      entry.status = 'authenticating'
      entry.authUrl = url
      return { state: 'authenticating', id: entry.config.name, authUrl: url }
    }
    // ... error path
  }
}
```

Pass `provider` from `buildTransport` through `addServer` into `connectAndList`.

- [ ] **Step 4: Implement the clientCredentials provider**

```ts
// src/auth/client-credentials.ts (helper used by sdk-provider.ts via direct construction)
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'

export interface ClientCredentialsOpts {
  tokenUrl: string
  clientId: string
  clientSecret: string
  scopes?: string[]
  audience?: string
  resource?: string
}

/**
 * Minimal OAuthClientProvider implementing only what's needed for clientCredentials:
 * lazy fetches a token on `tokens()`. The SDK's transport uses `tokens()` to attach
 * Authorization headers and re-calls on 401.
 */
export function createClientCredentialsProvider(
  opts: ClientCredentialsOpts
): OAuthClientProvider {
  let cached: { access_token: string; expiresAt: number } | undefined
  return {
    get redirectUrl() {
      return ''
    },
    get clientMetadata() {
      return {} as any
    },
    async clientInformation() {
      return {
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
      } as any
    },
    async saveClientInformation() {},
    async tokens() {
      const now = Math.floor(Date.now() / 1000)
      if (cached && cached.expiresAt - 30 > now) {
        return {
          access_token: cached.access_token,
          token_type: 'Bearer',
        } as any
      }
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
      })
      if (opts.scopes?.length) body.set('scope', opts.scopes.join(' '))
      if (opts.audience) body.set('audience', opts.audience)
      if (opts.resource) body.set('resource', opts.resource)
      const res = await fetch(opts.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
      if (!res.ok)
        throw new Error(`clientCredentials token endpoint ${res.status}`)
      const json = (await res.json()) as {
        access_token: string
        expires_in?: number
      }
      cached = {
        access_token: json.access_token,
        expiresAt: now + (json.expires_in ?? 300),
      }
      return { access_token: json.access_token, token_type: 'Bearer' } as any
    },
    async saveTokens() {},
    redirectToAuthorization() {
      /* unused */
    },
    saveCodeVerifier() {},
    async codeVerifier() {
      return ''
    },
  }
}
```

- [ ] **Step 5: Add registry tests for OAuth modes**

```ts
// test/registry-oauth.test.ts
import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/registry'
import { inMemoryCredentialStore } from '../src/credentials/in-memory'

describe('Registry — OAuth', () => {
  it('authorizationCode without saved tokens returns authenticating + authUrl', async () => {
    const credentials = inMemoryCredentialStore()
    // Register a synthetic clientInfo so the SDK doesn't try DCR in the unit test.
    await credentials.saveOAuthClientInfo?.('mock', { clientId: 'cid' })
    const reg = createRegistry({
      credentials,
      publicUrl: 'http://r:4448',
      // Use a transport override that synthesizes an authentication redirect when the
      // provider has no tokens yet. (Wires the SDK provider's redirectToAuthorization.)
      transportFactoryOverride: (cfg, hp, provider) => ({
        client: {
          listTools: async () => ({ tools: [] }),
          close: async () => {},
        } as any,
        connect: async () => {
          provider!.redirectToAuthorization(
            new URL('https://provider/authorize?x=1')
          )
          throw new Error('UnauthorizedError')
        },
        close: async () => {},
      }),
    } as any)
    const r = await reg.addServer({
      name: 'mock',
      transport: 'http',
      url: 'https://mock/mcp',
      auth: {
        mode: 'authorizationCode',
        flow: 'browser',
        scopes: ['mcp:read'],
      },
    })
    expect(r.state).toBe('authenticating')
    if (r.state === 'authenticating') expect(r.authUrl).toContain('authorize')
  })

  it('clientCredentials: connects when tokens exchange succeeds', async () => {
    const credentials = inMemoryCredentialStore()
    credentials.setClientCredentials('mock', {
      clientId: 'cid',
      clientSecret: 'sec',
    })
    const reg = createRegistry({
      credentials,
      publicUrl: 'http://r:4448',
      transportFactoryOverride: () => ({
        client: {
          listTools: async () => ({ tools: [{ name: 't', inputSchema: {} }] }),
          close: async () => {},
        } as any,
        connect: async () => {},
        close: async () => {},
      }),
    } as any)
    const r = await reg.addServer({
      name: 'mock',
      transport: 'http',
      url: 'https://mock/mcp',
      auth: { mode: 'clientCredentials', tokenUrl: 'https://x/token' },
    })
    expect(r.state).toBe('ready')
  })
})
```

- [ ] **Step 6: Update `transportFactoryOverride` signature** to receive the provider as third argument so unit tests can drive `redirectToAuthorization`. Update existing override callsites in `test/registry.test.ts` accordingly.

- [ ] **Step 7: Run — PASS**

- [ ] **Step 8: Commit**

```bash
git add packages/agents-mcp/src/registry.ts packages/agents-mcp/src/transports/http.ts packages/agents-mcp/src/auth/client-credentials.ts packages/agents-mcp/test/registry-oauth.test.ts packages/agents-mcp/test/registry.test.ts
git commit -m "feat(agents-mcp): wire authorizationCode + clientCredentials via SDK OAuthClientProvider"
```

---

### Task 32: Runtime-side `/oauth/callback/:server`

**Files:**

- Create: `packages/agents-mcp/src/http/oauth-callback.ts`
- Create: `packages/agents-mcp/test/http/oauth-callback.test.ts`
- Modify: `packages/agents-mcp/src/http/mount.ts` — mount the callback route

> The callback endpoint receives the authorization code from the OAuth provider's redirect, hands it to the SDK's `auth.finishAuth(code)` flow (which performs PKCE-protected token exchange and persists via `saveTokens`), then renders a "you can close this tab" page. The registry retries the connect after callback completes.

- [ ] **Step 1: Write the failing test**

```ts
// test/http/oauth-callback.test.ts
import { describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { createRegistry } from '../../src/registry'
import { inMemoryCredentialStore } from '../../src/credentials/in-memory'
import { mountMcpHttp } from '../../src/http/mount'

describe('GET /oauth/callback/:server', () => {
  it('completes auth via the registry hook and renders success', async () => {
    const credentials = inMemoryCredentialStore()
    const reg = createRegistry({ credentials, publicUrl: 'http://localhost:0' })
    const finishAuthSpy = vi.fn(async () => ({
      state: 'ready',
      id: 'mock',
      toolCount: 1,
    }))
    ;(reg as any).finishAuth = finishAuthSpy

    const server = http.createServer()
    mountMcpHttp({
      server,
      registry: reg,
      publicUrl: 'http://localhost:0',
      corsOrigin: '*',
    })
    await new Promise<void>((r) => server.listen(0, r))
    const addr = server.address()!
    const port = typeof addr === 'string' ? 0 : addr.port

    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/oauth/callback/mock?code=AC&state=S`
      )
      expect(res.status).toBe(200)
      expect(await res.text()).toMatch(/close this/i)
      expect(finishAuthSpy).toHaveBeenCalledWith('mock', 'AC', 'S')
    } finally {
      server.close()
    }
  })

  it('renders a 400 when the provider returned an error', async () => {
    const credentials = inMemoryCredentialStore()
    const reg = createRegistry({ credentials, publicUrl: 'http://localhost:0' })
    const server = http.createServer()
    mountMcpHttp({
      server,
      registry: reg,
      publicUrl: 'http://localhost:0',
      corsOrigin: '*',
    })
    await new Promise<void>((r) => server.listen(0, r))
    const addr = server.address()!
    const port = typeof addr === 'string' ? 0 : addr.port
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/oauth/callback/mock?error=access_denied`
      )
      expect(res.status).toBe(400)
    } finally {
      server.close()
    }
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `oauth-callback.ts`**

```ts
// src/http/oauth-callback.ts
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Registry } from '../registry'

export async function handleOAuthCallback(
  req: IncomingMessage,
  res: ServerResponse,
  registry: Registry,
  serverName: string
): Promise<void> {
  const u = new URL(req.url ?? '/', 'http://x')
  const code = u.searchParams.get('code')
  const state = u.searchParams.get('state') ?? undefined
  const error = u.searchParams.get('error')

  if (error) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'text/html')
    res.end(renderPage(`Authorization failed: ${error}`, 'error'))
    return
  }
  if (!code) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'text/html')
    res.end(renderPage('Missing authorization code.', 'error'))
    return
  }

  try {
    await (
      registry as Registry & {
        finishAuth: (s: string, c: string, st?: string) => Promise<unknown>
      }
    ).finishAuth(serverName, code, state)
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html')
    res.end(
      renderPage(`Authorized "${serverName}". You can close this tab.`, 'ok')
    )
  } catch (err) {
    res.statusCode = 500
    res.setHeader('Content-Type', 'text/html')
    res.end(
      renderPage(`Token exchange failed: ${(err as Error).message}`, 'error')
    )
  }
}

function renderPage(body: string, kind: 'ok' | 'error'): string {
  const color = kind === 'ok' ? '#0a7' : '#a00'
  return `<!doctype html><meta charset=utf-8><title>MCP OAuth</title>
<style>body{font:14px system-ui;padding:2rem;color:${color}}</style><p>${body}</p>`
}
```

- [ ] **Step 4: Add `finishAuth(serverName, code, state)` to the registry**

```ts
// src/registry.ts — extend the Registry interface and impl:

export interface Registry {
  // ... existing
  finishAuth(serverName: string, code: string, state?: string): Promise<AddServerResult>
}

// impl:
async finishAuth(serverName, code, state) {
  const e = entries.get(serverName)
  if (!e) throw new Error(`unknown server "${serverName}"`)
  // The SDK's auth.finishAuth wraps the token exchange; we get there via the
  // transport that holds the provider. The MCP SDK exposes the helper via
  // `auth.finishAuth(provider, { authorizationCode: code })`.
  const { auth } = await import('@modelcontextprotocol/sdk/client/auth.js')
  const provider = e.provider as SdkOAuthProvider | undefined
  if (!provider) throw new Error(`server "${serverName}" has no OAuth provider`)
  await auth.finishAuth(provider, { authorizationCode: code })
  provider.clearAuthUrl()
  // After tokens are persisted, retry connect:
  return await registry.addServer(e.config)
}
```

Add `provider?: SdkOAuthProvider` to `Entry`. Set it in `buildTransport` for `authorizationCode` mode.

- [ ] **Step 5: Mount `/oauth/callback/:server` in `mount.ts`**

Inside `mountMcpHttp`'s request handler, before the `/api/mcp/*` routing:

```ts
const cb = u.pathname.match(/^\/oauth\/callback\/([^/]+)$/)
if (cb && req.method === 'GET') {
  const serverName = decodeURIComponent(cb[1]!)
  await handleOAuthCallback(req, res, opts.registry, serverName)
  return
}
```

- [ ] **Step 6: Run — PASS**

- [ ] **Step 7: Commit**

```bash
git add packages/agents-mcp/src/http/oauth-callback.ts packages/agents-mcp/src/http/mount.ts packages/agents-mcp/src/registry.ts packages/agents-mcp/test/http/oauth-callback.test.ts
git commit -m "feat(agents-mcp): /oauth/callback/:server on the runtime; registry.finishAuth"
```

---

### Task 33: Wire `addServer` `authorize` action

**Files:**

- Modify: `packages/agents-mcp/src/http/mount.ts`
- Modify: `packages/agents-mcp/test/http/mount.test.ts`

> Phase 1 mounted `POST /api/mcp/servers/:name/authorize` as 501. Phase 3 wires it: re-run `addServer` for an existing entry to re-trigger the OAuth flow, returning the `authenticating` envelope.

- [ ] **Step 1: Update the action handler**

```ts
// inside mount.ts where action === 'authorize':
if (req.method === 'POST' && action === 'authorize') {
  const entry = opts.registry.get(name)
  if (!entry) {
    send(res, 404, { error: 'unknown server' })
    return
  }
  // Force a re-auth: clear tokens via CredentialStore so the SDK provider runs the dance.
  if (opts.credentials?.saveOAuthTokens) {
    // We can't "delete" via CredentialStore — just expire by overwriting with empty.
    // Better approach: call provider.clearAuthUrl() and removeServer + addServer.
  }
  await opts.registry.removeServer(name)
  const result = await opts.registry.addServer(entry.config)
  send(res, 200, result)
  return
}
```

- [ ] **Step 2: Update test**

Add a test in `mount.test.ts` that POSTs to `/api/mcp/servers/mock/authorize` for an OAuth-mode server and asserts it returns `state: 'authenticating'` with an `authUrl`.

- [ ] **Step 3: Run — PASS**

- [ ] **Step 4: Commit**

```bash
git add packages/agents-mcp/src/http/mount.ts packages/agents-mcp/test/http/mount.test.ts
git commit -m "feat(agents-mcp): authorize action re-triggers OAuth (re-add + capture authUrl)"
```

---

### Task 34: Bootstrap — pass `publicUrl` to the registry

**Files:**

- Modify: `packages/agents/src/bootstrap.ts`

- [ ] **Step 1: Add `publicUrl` when constructing the registry**

```ts
const mcpRegistry = createMcpRegistry({ credentials, publicUrl: PUBLIC_URL })
```

- [ ] **Step 2: Run typecheck + tests**

```bash
pnpm -r typecheck && pnpm -C packages/agents test
```

- [ ] **Step 3: Commit**

```bash
git add packages/agents/src/bootstrap.ts
git commit -m "feat(agents): pass publicUrl into MCP registry for OAuth callback URLs"
```

---

### Task 35: Phase 3 verification — Honeycomb manual E2E

- [ ] **Step 1: Test sweep**

```bash
pnpm -r test --run
```

Expected: green.

- [ ] **Step 2: Manual E2E against Honeycomb**

1. Create `mcp.json`:

```jsonc
{
  "servers": {
    "honeycomb": {
      "transport": "http",
      "url": "https://mcp.honeycomb.io/mcp",
      "auth": {
        "mode": "authorizationCode",
        "flow": "browser",
        "scopes": ["mcp:read", "mcp:write"],
      },
    },
  },
}
```

2. Boot the runtime; `curl http://localhost:4448/api/mcp/servers` should show `status: 'authenticating'` with an `authUrl`.

3. Open `authUrl` in a browser, consent, get redirected to `http://localhost:4448/oauth/callback/honeycomb?code=...&state=...`.

4. Page should render "Authorized — you can close this tab".

5. `curl http://localhost:4448/api/mcp/servers` should now show `status: 'ready'` with `toolCount > 0`.

6. Restart the runtime — Honeycomb should come back up `ready` (tokens persisted in OS keychain or `.electric-agents/credentials.json`).

7. From a Horton chat, ask the agent to call a Honeycomb tool (`mcp__honeycomb__list_datasets`). Confirm it succeeds.

- [ ] **Step 3: Commit milestone**

```bash
git commit --allow-empty -m "milestone: agents-mcp phase 3 complete — OAuth via SDK provider, Honeycomb E2E green"
```

---

## Phase 4 — Connected Services UI

End state: A new "Connected Services" page in `agents-server-ui` that fetches `/api/runtimes` from agents-server, then talks to each runtime's `${publicUrl}/api/mcp/*` endpoints **directly** (CORS). Each row shows server status, tool count, last error, and per-row actions (Authorize / Re-authorize / Disable / Enable / Reconnect / Disconnect). Polling: 10s when idle, ramps to 2s when any row is in `authenticating` state.

> The UI is build-time isolated from `@electric-ax/agents-mcp` (it doesn't import the package). It only knows the HTTP contract.

### Task 36: `useRuntimes` hook

**Files:**

- Create: `packages/agents-server-ui/src/hooks/useRuntimes.ts`
- Create: `packages/agents-server-ui/src/hooks/useRuntimes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/hooks/useRuntimes.test.ts
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useRuntimes } from './useRuntimes'

describe('useRuntimes', () => {
  it('fetches /api/runtimes once on mount', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            runtimes: [
              { name: 'r', publicUrl: 'http://r:1', types: ['horton'] },
            ],
            experimental: true,
          })
        )
    )
    const { result } = renderHook(() =>
      useRuntimes({ baseUrl: 'http://server', fetchImpl })
    )
    await waitFor(() => expect(result.current.runtimes.length).toBe(1))
    expect(result.current.runtimes[0]).toMatchObject({
      name: 'r',
      publicUrl: 'http://r:1',
    })
  })

  it('reports an error when the discovery endpoint is down', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 500 }))
    const { result } = renderHook(() =>
      useRuntimes({ baseUrl: 'http://server', fetchImpl })
    )
    await waitFor(() => expect(result.current.error).toBeTruthy())
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```ts
// src/hooks/useRuntimes.ts
import { useEffect, useState } from 'react'

export interface Runtime {
  name: string
  publicUrl: string
  types: string[]
}

export interface UseRuntimesOpts {
  baseUrl?: string /* default: '' (same-origin) */
  fetchImpl?: typeof fetch
  /** ms; default 60000. */
  refreshIntervalMs?: number
}

export function useRuntimes(opts: UseRuntimesOpts = {}) {
  const [runtimes, setRuntimes] = useState<Runtime[]>([])
  const [error, setError] = useState<Error | undefined>()
  const fetchImpl = opts.fetchImpl ?? fetch
  const baseUrl = opts.baseUrl ?? ''
  const interval = opts.refreshIntervalMs ?? 60_000

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetchImpl(`${baseUrl}/api/runtimes`)
        if (!res.ok) throw new Error(`/api/runtimes ${res.status}`)
        const json = (await res.json()) as { runtimes: Runtime[] }
        if (!cancelled) {
          setRuntimes(json.runtimes)
          setError(undefined)
        }
      } catch (err) {
        if (!cancelled) setError(err as Error)
      }
    }

    void load()
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    const timer = setInterval(load, interval)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
      clearInterval(timer)
    }
  }, [baseUrl, fetchImpl, interval])

  return { runtimes, error }
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/agents-server-ui/src/hooks/useRuntimes.ts packages/agents-server-ui/src/hooks/useRuntimes.test.ts
git commit -m "feat(agents-server-ui): useRuntimes — discovery via /api/runtimes"
```

---

### Task 37: `useMcpServers` hook (per-runtime polling)

**Files:**

- Create: `packages/agents-server-ui/src/hooks/useMcpServers.ts`
- Create: `packages/agents-server-ui/src/hooks/useMcpServers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/hooks/useMcpServers.test.ts
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useMcpServers } from './useMcpServers'

describe('useMcpServers', () => {
  it('polls every 10s when idle and 2s when a row is authenticating', async () => {
    let calls = 0
    let phase: 'idle' | 'auth' = 'idle'
    const fetchImpl = vi.fn(async () => {
      calls += 1
      const status = phase === 'idle' ? 'ready' : 'authenticating'
      return new Response(
        JSON.stringify({ servers: [{ name: 'a', status, toolCount: 0 }] })
      )
    })
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useMcpServers({
        runtimeUrl: 'http://r:1',
        fetchImpl,
        idleMs: 10_000,
        authMs: 2_000,
      })
    )
    await waitFor(() => expect(result.current.servers.length).toBe(1))
    const baseline = calls

    vi.advanceTimersByTime(9_000)
    expect(calls).toBe(baseline)

    vi.advanceTimersByTime(1_000)
    await waitFor(() => expect(calls).toBe(baseline + 1))

    phase = 'auth'
    vi.advanceTimersByTime(10_000)
    await waitFor(() =>
      expect(result.current.servers[0]!.status).toBe('authenticating')
    )

    const after = calls
    vi.advanceTimersByTime(2_000)
    await waitFor(() => expect(calls).toBeGreaterThan(after))

    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```ts
// src/hooks/useMcpServers.ts
import { useEffect, useState } from 'react'

export type McpStatus =
  | 'connecting'
  | 'authenticating'
  | 'ready'
  | 'error'
  | 'disabled'

export interface McpServerRow {
  name: string
  transport?: 'http' | 'stdio'
  url?: string
  authMode?: string
  status: McpStatus
  authUrl?: string
  error?: { kind: string; message: string }
  toolCount: number
  tools?: Array<{ name: string; description?: string }>
}

export interface UseMcpServersOpts {
  runtimeUrl: string
  fetchImpl?: typeof fetch
  idleMs?: number /* default 10_000 */
  authMs?: number /* default 2_000 */
}

export function useMcpServers(opts: UseMcpServersOpts) {
  const [servers, setServers] = useState<McpServerRow[]>([])
  const [error, setError] = useState<Error | undefined>()
  const fetchImpl = opts.fetchImpl ?? fetch
  const idle = opts.idleMs ?? 10_000
  const authMs = opts.authMs ?? 2_000

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const load = async () => {
      try {
        const res = await fetchImpl(`${opts.runtimeUrl}/api/mcp/servers`)
        if (!res.ok) throw new Error(`servers ${res.status}`)
        const json = (await res.json()) as { servers: McpServerRow[] }
        if (cancelled) return
        setServers(json.servers)
        setError(undefined)
        const wait = json.servers.some((s) => s.status === 'authenticating')
          ? authMs
          : idle
        timer = setTimeout(load, wait)
      } catch (err) {
        if (cancelled) return
        setError(err as Error)
        timer = setTimeout(load, idle)
      }
    }

    void load()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [opts.runtimeUrl, fetchImpl, idle, authMs])

  return { servers, error }
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/agents-server-ui/src/hooks/useMcpServers.ts packages/agents-server-ui/src/hooks/useMcpServers.test.ts
git commit -m "feat(agents-server-ui): useMcpServers — polling 10s idle / 2s during OAuth"
```

---

### Task 38: Connected Services route + page

**Files:**

- Create: `packages/agents-server-ui/src/components/connected-services/ConnectedServicesPage.tsx`
- Create: `packages/agents-server-ui/src/components/connected-services/ServerRow.tsx`
- Create: `packages/agents-server-ui/src/components/connected-services/ConnectedServicesPage.module.css`
- Modify: `packages/agents-server-ui/src/router.tsx` — add `/connected-services` route + sidebar entry

- [ ] **Step 1: Implement the page**

```tsx
// src/components/connected-services/ConnectedServicesPage.tsx
import { useRuntimes } from '../../hooks/useRuntimes'
import { useMcpServers } from '../../hooks/useMcpServers'
import { ServerRow } from './ServerRow'
import styles from './ConnectedServicesPage.module.css'

export function ConnectedServicesPage(): JSX.Element {
  const { runtimes, error: runtimesError } = useRuntimes()

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1>Connected Services</h1>
        <span className={styles.experimental}>experimental</span>
      </header>
      {runtimesError && (
        <p className={styles.error}>
          Discovery failed: {runtimesError.message}
        </p>
      )}
      {runtimes.length === 0 && !runtimesError && (
        <p>No runtimes registered.</p>
      )}
      {runtimes.map((rt) => (
        <RuntimeSection key={rt.name} runtime={rt} />
      ))}
    </main>
  )
}

function RuntimeSection({
  runtime,
}: {
  runtime: { name: string; publicUrl: string }
}): JSX.Element {
  const { servers, error } = useMcpServers({ runtimeUrl: runtime.publicUrl })
  return (
    <section className={styles.runtime}>
      <h2>{runtime.name}</h2>
      <p className={styles.publicUrl}>{runtime.publicUrl}</p>
      {error && <p className={styles.error}>{error.message}</p>}
      {servers.length === 0 ? (
        <p className={styles.empty}>
          No MCP servers registered on this runtime.
        </p>
      ) : (
        <ul className={styles.list}>
          {servers.map((s) => (
            <li key={s.name}>
              <ServerRow server={s} runtimeUrl={runtime.publicUrl} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Implement `ServerRow`**

```tsx
// src/components/connected-services/ServerRow.tsx
import { useState } from 'react'
import type { McpServerRow } from '../../hooks/useMcpServers'

export function ServerRow({
  server,
  runtimeUrl,
}: {
  server: McpServerRow
  runtimeUrl: string
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const post = async (action: string) => {
    setBusy(true)
    try {
      await fetch(
        `${runtimeUrl}/api/mcp/servers/${encodeURIComponent(server.name)}/${action}`,
        { method: 'POST' }
      )
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!confirm(`Remove ${server.name}?`)) return
    setBusy(true)
    try {
      await fetch(
        `${runtimeUrl}/api/mcp/servers/${encodeURIComponent(server.name)}`,
        { method: 'DELETE' }
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <article>
      <h3>{server.name}</h3>
      <dl>
        <dt>Status</dt>
        <dd>{server.status}</dd>
        <dt>Tools</dt>
        <dd>{server.toolCount}</dd>
        {server.transport && (
          <>
            <dt>Transport</dt>
            <dd>{server.transport}</dd>
          </>
        )}
        {server.authMode && (
          <>
            <dt>Auth</dt>
            <dd>{server.authMode}</dd>
          </>
        )}
        {server.error && (
          <>
            <dt>Error</dt>
            <dd>
              {server.error.kind}: {server.error.message}
            </dd>
          </>
        )}
      </dl>
      <div role="group" aria-label="Actions">
        {server.status === 'authenticating' && server.authUrl && (
          <a href={server.authUrl} target="_blank" rel="noopener noreferrer">
            Authorize
          </a>
        )}
        <button disabled={busy} onClick={() => post('authorize')}>
          Re-authorize
        </button>
        <button disabled={busy} onClick={() => post('reconnect')}>
          Reconnect
        </button>
        {server.status === 'disabled' ? (
          <button disabled={busy} onClick={() => post('enable')}>
            Enable
          </button>
        ) : (
          <button disabled={busy} onClick={() => post('disable')}>
            Disable
          </button>
        )}
        <button disabled={busy} onClick={remove}>
          Disconnect
        </button>
      </div>
    </article>
  )
}
```

- [ ] **Step 3: Add the route in `router.tsx`**

Locate the existing route definitions in `packages/agents-server-ui/src/router.tsx`. Add `/connected-services` → `<ConnectedServicesPage />`. Add a sidebar entry alongside other nav items.

- [ ] **Step 4: Add the CSS module**

```css
/* src/components/connected-services/ConnectedServicesPage.module.css */
.page {
  padding: var(--spacing-6);
  display: grid;
  gap: var(--spacing-6);
}
.header {
  display: flex;
  align-items: baseline;
  gap: var(--spacing-3);
}
.experimental {
  font-size: var(--font-size-1);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  padding: 2px 6px;
}
.runtime {
  display: grid;
  gap: var(--spacing-2);
}
.publicUrl {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--font-size-1);
}
.error {
  color: var(--color-danger);
}
.empty {
  color: var(--color-text-muted);
}
.list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: var(--spacing-3);
}
```

- [ ] **Step 5: Manual smoke**

Boot agents-server, agents runtime, and the UI dev server. Visit `/connected-services`. Confirm it renders the runtime, polls `/api/mcp/servers`, and per-row buttons issue requests to the runtime (visible cross-origin requests in devtools).

- [ ] **Step 6: Commit**

```bash
git add packages/agents-server-ui/src/components/connected-services packages/agents-server-ui/src/router.tsx
git commit -m "feat(agents-server-ui): Connected Services page (talks to runtimes directly)"
```

---

### Task 39: Phase 4 verification

- [ ] **Step 1: Run UI tests**

```bash
pnpm -C packages/agents-server-ui test --run
```

- [ ] **Step 2: Manual smoke — full flow**

1. Boot agents-server + agents runtime + UI dev server.
2. Add an apiKey-mode server in `mcp.json`; set the env var; verify it shows `ready` in the UI without reloading.
3. Add Honeycomb (`authorizationCode`); confirm the row shows `authenticating` with an Authorize link.
4. Click Authorize, complete OAuth in the popup, return to the page; within 2s the row should flip to `ready`.
5. Click Reconnect on the Honeycomb row; confirm a fresh connect happens.
6. Click Disconnect; confirm the row disappears from the list.

- [ ] **Step 3: Commit milestone**

```bash
git commit --allow-empty -m "milestone: agents-mcp phase 4 complete — Connected Services UI talks directly to runtimes"
```

---

## Phase 5 — Device-code flow

End state: An MCP server declared with `auth.mode: 'authorizationCode', flow: 'device'` performs the RFC 8628 device-authorization grant. The runtime exposes `POST /oauth/device/:server/start` returning `{ user_code, verification_uri, expires_in }`; the UI surfaces these so a user on a different machine can complete authorization. After consent the runtime polls the token endpoint and persists tokens via `CredentialStore`.

This phase is independent — `apiKey`, `clientCredentials`, and `authorizationCode (browser)` from prior phases are unchanged.

### Task 40: Device-code grant helper

**Files:**

- Create: `packages/agents-mcp/src/auth/device-code.ts`
- Create: `packages/agents-mcp/test/auth/device-code.test.ts`

> Implement the grant against RFC 8628. The interface we need: a one-shot `startDeviceFlow()` that calls the device-authorization endpoint and returns a handle exposing `userCode`, `verificationUri`, `expiresAt`, `interval`, plus `poll()` (resolves with tokens once the user authorizes) and `cancel()`.

- [ ] **Step 1: Write the failing test**

```ts
// test/auth/device-code.test.ts
import { describe, expect, it, vi } from 'vitest'
import { startDeviceFlow } from '../../src/auth/device-code'

describe('startDeviceFlow', () => {
  it('parses device_authorization response', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            device_code: 'DEV',
            user_code: 'ABCD-EFGH',
            verification_uri: 'https://x/device',
            expires_in: 600,
            interval: 5,
          })
        )
    )
    const handle = await startDeviceFlow({
      deviceAuthorizationEndpoint: 'https://x/device_authorization',
      tokenEndpoint: 'https://x/token',
      clientId: 'cid',
      scopes: ['mcp:read'],
      fetchImpl,
    })
    expect(handle.userCode).toBe('ABCD-EFGH')
    expect(handle.verificationUri).toBe('https://x/device')
    expect(handle.interval).toBe(5)
  })

  it('poll resolves with tokens after success', async () => {
    let pollCount = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('device_authorization')) {
        return new Response(
          JSON.stringify({
            device_code: 'DEV',
            user_code: 'X',
            verification_uri: 'v',
            expires_in: 600,
            interval: 1,
          })
        )
      }
      pollCount += 1
      if (pollCount < 2) {
        return new Response(
          JSON.stringify({ error: 'authorization_pending' }),
          { status: 400 }
        )
      }
      return new Response(
        JSON.stringify({
          access_token: 'AT',
          expires_in: 3600,
          token_type: 'Bearer',
        })
      )
    })
    const handle = await startDeviceFlow({
      deviceAuthorizationEndpoint: 'https://x/device_authorization',
      tokenEndpoint: 'https://x/token',
      clientId: 'cid',
      fetchImpl,
    })
    const tokens = await handle.poll({ intervalMs: 5 })
    expect(tokens.access_token).toBe('AT')
  })

  it('poll rejects on access_denied', async () => {
    let pollCount = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('device_authorization')) {
        return new Response(
          JSON.stringify({
            device_code: 'DEV',
            user_code: 'X',
            verification_uri: 'v',
            expires_in: 600,
            interval: 1,
          })
        )
      }
      pollCount += 1
      return new Response(JSON.stringify({ error: 'access_denied' }), {
        status: 400,
      })
    })
    const handle = await startDeviceFlow({
      deviceAuthorizationEndpoint: 'https://x/device_authorization',
      tokenEndpoint: 'https://x/token',
      clientId: 'cid',
      fetchImpl,
    })
    await expect(handle.poll({ intervalMs: 5 })).rejects.toThrow(
      /access_denied/
    )
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```ts
// src/auth/device-code.ts
import type { OAuthTokens as SdkTokens } from '@modelcontextprotocol/sdk/shared/auth.js'

export interface StartDeviceFlowOpts {
  deviceAuthorizationEndpoint: string
  tokenEndpoint: string
  clientId: string
  clientSecret?: string
  scopes?: string[]
  resource?: string
  fetchImpl?: typeof fetch
}

export interface DeviceFlowHandle {
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  expiresAt: number /* unix seconds */
  interval: number /* seconds */
  poll(opts?: { intervalMs?: number }): Promise<SdkTokens>
  cancel(): void
}

export async function startDeviceFlow(
  opts: StartDeviceFlowOpts
): Promise<DeviceFlowHandle> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const body = new URLSearchParams({ client_id: opts.clientId })
  if (opts.scopes?.length) body.set('scope', opts.scopes.join(' '))
  if (opts.resource) body.set('resource', opts.resource)

  const res = await fetchImpl(opts.deviceAuthorizationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`device_authorization endpoint ${res.status}`)
  const json = (await res.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    verification_uri_complete?: string
    expires_in: number
    interval?: number
  }

  const expiresAt = Math.floor(Date.now() / 1000) + json.expires_in
  let cancelled = false

  const poll = async (
    pollOpts: { intervalMs?: number } = {}
  ): Promise<SdkTokens> => {
    const intervalMs = pollOpts.intervalMs ?? (json.interval ?? 5) * 1000
    while (!cancelled) {
      if (Math.floor(Date.now() / 1000) > expiresAt) {
        throw new Error('expired_token')
      }
      const tokenBody = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: json.device_code,
        client_id: opts.clientId,
      })
      if (opts.clientSecret) tokenBody.set('client_secret', opts.clientSecret)
      const tr = await fetchImpl(opts.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody,
      })
      const result = (await tr.json()) as {
        error?: string
        access_token?: string
        expires_in?: number
        refresh_token?: string
        token_type?: string
      }
      if (result.access_token) {
        return result as SdkTokens
      }
      if (
        result.error === 'authorization_pending' ||
        result.error === 'slow_down'
      ) {
        await new Promise((r) => setTimeout(r, intervalMs))
        continue
      }
      throw new Error(result.error ?? 'device flow failed')
    }
    throw new Error('cancelled')
  }

  return {
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    verificationUriComplete: json.verification_uri_complete,
    expiresAt,
    interval: json.interval ?? 5,
    poll,
    cancel() {
      cancelled = true
    },
  }
}
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/auth/device-code.ts packages/agents-mcp/test/auth/device-code.test.ts
git commit -m "feat(agents-mcp): RFC 8628 device-code grant helper"
```

---

### Task 41: Wire device-flow into the registry

**Files:**

- Modify: `packages/agents-mcp/src/types.ts` — extend `AddServerResult` with `deviceCode`
- Modify: `packages/agents-mcp/src/registry.ts`
- Create: `packages/agents-mcp/test/registry-device-flow.test.ts`

> When `auth.mode === 'authorizationCode'` and `flow === 'device'`, `addServer` returns `{ state: 'authenticating', authUrl: verification_uri, deviceCode: { userCode, expiresAt, ... } }`. The registry kicks off `handle.poll()` in the background; once tokens arrive it persists them via `CredentialStore` and re-runs `addServer(cfg)` to connect the transport.

- [ ] **Step 1: Extend `AddServerResult` to carry `deviceCode`**

```ts
// src/types.ts
export type AddServerResult =
  | { state: 'ready'; id: string; toolCount: number }
  | {
      state: 'authenticating'
      id: string
      authUrl: string
      deviceCode?: {
        userCode: string
        expiresAt: number
        verificationUriComplete?: string
      }
    }
  | { state: 'error'; id: string; error: McpToolError }
```

- [ ] **Step 2: Extend the registry's `buildTransport` for device flow**

```ts
// inside src/registry.ts buildTransport():

if (cfg.auth.mode === 'authorizationCode' && cfg.auth.flow === 'device') {
  // Endpoints discovery: phase 5 requires explicit `auth.deviceEndpoints` in mcp.json.
  const eps = (cfg.auth as any).deviceEndpoints as
    | { deviceAuthorizationEndpoint: string; tokenEndpoint: string }
    | undefined
  if (!eps) {
    return {
      error: makeError(
        'auth_unavailable',
        'device flow requires auth.deviceEndpoints in mcp.json'
      ),
    }
  }
  const cc = await opts.credentials.getClientCredentials?.(cfg.name)
  if (!cc) {
    return {
      error: makeError(
        'auth_unavailable',
        `no clientCredentials for ${cfg.name} (device flow needs at minimum a clientId)`
      ),
    }
  }
  const handle = await startDeviceFlow({
    deviceAuthorizationEndpoint: eps.deviceAuthorizationEndpoint,
    tokenEndpoint: eps.tokenEndpoint,
    clientId: cc.clientId,
    clientSecret: cc.clientSecret,
    scopes: cfg.auth.scopes,
    resource: cfg.auth.resource,
  })
  // Background poll — on success, persist tokens and re-add the server to connect.
  void handle
    .poll()
    .then(async (tokens) => {
      await opts.credentials.saveOAuthTokens?.(cfg.name, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expires_in
          ? Math.floor(Date.now() / 1000) + tokens.expires_in
          : undefined,
        tokenType: tokens.token_type,
      })
      void registry.addServer(cfg).catch(() => {
        /* re-entry handled by next caller */
      })
    })
    .catch((err) => {
      const e = entries.get(cfg.name)
      if (e) {
        e.status = 'error'
        e.error = makeError('auth_unavailable', String(err))
      }
    })
  return {
    authUrl: handle.verificationUri,
    deviceHandle: handle,
  }
}
```

Add `deviceHandle?: DeviceFlowHandle` to `Entry`. Update `Entry`'s teardown to call `deviceHandle?.cancel()` in `removeServer`.

- [ ] **Step 3: Surface `deviceCode` in the `addServer` envelope**

```ts
// In addServer(), after buildTransport returns:
if (built.authUrl && built.deviceHandle) {
  entry.status = 'authenticating'
  entry.authUrl = built.authUrl
  entry.deviceHandle = built.deviceHandle
  return {
    state: 'authenticating',
    id: cfg.name,
    authUrl: built.authUrl,
    deviceCode: {
      userCode: built.deviceHandle.userCode,
      expiresAt: built.deviceHandle.expiresAt,
      verificationUriComplete: built.deviceHandle.verificationUriComplete,
    },
  }
}
```

- [ ] **Step 4: Surface device fields through `list()`**

Extend `ListedEntry` with optional `deviceCode` and include it in the projection.

- [ ] **Step 5: Add a registry test for device flow**

```ts
// test/registry-device-flow.test.ts
import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../src/registry'
import { inMemoryCredentialStore } from '../src/credentials/in-memory'

describe('Registry — device flow', () => {
  it('addServer with device flow returns user code; background poll completes', async () => {
    let pollCount = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('device_authorization')) {
        return new Response(
          JSON.stringify({
            device_code: 'DEV',
            user_code: 'CODE-1234',
            verification_uri: 'https://x/device',
            expires_in: 600,
            interval: 0,
          })
        )
      }
      pollCount += 1
      if (pollCount < 2)
        return new Response(
          JSON.stringify({ error: 'authorization_pending' }),
          { status: 400 }
        )
      return new Response(
        JSON.stringify({
          access_token: 'AT',
          expires_in: 3600,
          token_type: 'Bearer',
        })
      )
    })
    // Inject fetchImpl by wrapping startDeviceFlow at the module level (test fixture).
    // ... see device-code.test.ts pattern; or thread fetchImpl through Registry opts.
    // Simplified: we assert the immediate envelope here; background-poll is covered in
    // device-code.test.ts.
    const credentials = inMemoryCredentialStore()
    credentials.setClientCredentials('mock', {
      clientId: 'cid',
      clientSecret: 'sec',
    })
    const reg = createRegistry({
      credentials,
      publicUrl: 'http://r:4448',
      deviceFlowFetch: fetchImpl /* new opt for testing — see step 6 */,
    } as any)
    const r = await reg.addServer({
      name: 'mock',
      transport: 'http',
      url: 'https://mock/mcp',
      auth: {
        mode: 'authorizationCode',
        flow: 'device',
        scopes: ['mcp:read'],
        // @ts-expect-error — extension for device flow
        deviceEndpoints: {
          deviceAuthorizationEndpoint: 'https://x/device_authorization',
          tokenEndpoint: 'https://x/token',
        },
      },
    })
    expect(r.state).toBe('authenticating')
    if (r.state === 'authenticating') {
      expect(r.deviceCode?.userCode).toBe('CODE-1234')
      expect(r.authUrl).toBe('https://x/device')
    }
  })
})
```

- [ ] **Step 6: Thread an optional `deviceFlowFetch` through `RegistryOpts`** so tests can inject the fetch implementation. In production this defaults to global `fetch`.

- [ ] **Step 7: Run — PASS**

- [ ] **Step 8: Commit**

```bash
git add packages/agents-mcp/src/registry.ts packages/agents-mcp/src/types.ts packages/agents-mcp/test/registry-device-flow.test.ts
git commit -m "feat(agents-mcp): wire RFC 8628 device flow into registry"
```

---

### Task 42: Runtime endpoint `POST /oauth/device/:server/start`

**Files:**

- Modify: `packages/agents-mcp/src/http/mount.ts`
- Modify: `packages/agents-mcp/test/http/mount.test.ts`

- [ ] **Step 1: Add the route**

```ts
// inside mountMcpHttp's request handler, alongside existing routes:
const dev = u.pathname.match(/^\/oauth\/device\/([^/]+)\/start$/)
if (dev && req.method === 'POST') {
  const serverName = decodeURIComponent(dev[1]!)
  const entry = opts.registry.get(serverName)
  if (!entry) {
    send(res, 404, { error: 'unknown server' })
    return
  }
  // Re-trigger by removing + adding the server. addServer returns the device code
  // in `deviceCode` when the server is in device flow.
  await opts.registry.removeServer(serverName)
  const result = await opts.registry.addServer(entry.config)
  send(res, 200, result)
  return
}
```

- [ ] **Step 2: Add a test**

In `mount.test.ts`, register a device-flow server and POST to `/oauth/device/<name>/start`; assert the response includes `state: 'authenticating'` and `deviceCode.userCode`.

- [ ] **Step 3: Run — PASS**

- [ ] **Step 4: Commit**

```bash
git add packages/agents-mcp/src/http/mount.ts packages/agents-mcp/test/http/mount.test.ts
git commit -m "feat(agents-mcp): /oauth/device/:server/start endpoint"
```

---

### Task 43: UI surface for device flow

**Files:**

- Modify: `packages/agents-server-ui/src/hooks/useMcpServers.ts` — add optional `deviceCode` field
- Modify: `packages/agents-server-ui/src/components/connected-services/ServerRow.tsx`

- [ ] **Step 1: Extend the `McpServerRow` type**

```ts
// add to McpServerRow:
deviceCode?: {
  userCode: string
  expiresAt: number
  verificationUriComplete?: string
}
```

- [ ] **Step 2: Render device-code details in `ServerRow`**

```tsx
{
  server.deviceCode && (
    <div role="region" aria-label="Device authorization">
      <p>
        Enter code <code>{server.deviceCode.userCode}</code> at{' '}
        <a
          href={server.deviceCode.verificationUriComplete ?? server.authUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          the verification URL
        </a>
        .
      </p>
      <p>
        Expires at{' '}
        {new Date(server.deviceCode.expiresAt * 1000).toLocaleTimeString()}.
      </p>
    </div>
  )
}
```

The "Re-authorize" button already POSTs to `/api/mcp/servers/:name/authorize` for browser flow; for device flow, also wire a "Restart device flow" affordance that POSTs to `/oauth/device/${name}/start`.

- [ ] **Step 3: Manual smoke (best-effort if a device-flow MCP server is reachable)**

Configure a device-flow server with `auth.deviceEndpoints`; expect the UI to show the user code and the verification link, and to flip to `ready` after the user completes consent on another device.

- [ ] **Step 4: Commit**

```bash
git add packages/agents-server-ui/src/components/connected-services/ServerRow.tsx packages/agents-server-ui/src/hooks/useMcpServers.ts
git commit -m "feat(agents-server-ui): surface device-code (user_code + verification URL) in Connected Services"
```

---

### Task 44: Phase 5 verification

- [ ] **Step 1: Run the full test sweep**

```bash
pnpm -r typecheck
pnpm -r test --run
```

- [ ] **Step 2: Manual smoke (depends on access to a device-flow MCP server)**

If no device-flow MCP server is reachable, validate via the unit + integration tests added in Tasks 40–42.

- [ ] **Step 3: Commit milestone**

```bash
git commit --allow-empty -m "milestone: agents-mcp phase 5 complete — device-code flow"
```

---

## Cross-cutting verification

Run after each phase, and again at the end:

- [ ] `pnpm install` clean
- [ ] `pnpm -r typecheck` clean
- [ ] `pnpm -r test --run` passes
- [ ] All three user stories from the spec smoke-tested manually:
  - **US-1 (Incident response factory)**: webhook spawns an agent that uses two MCP servers, produces a summary.
  - **US-2 (Coding agent factory)**: developer chats with Horton; agent uses GitHub MCP via `authorizationCode` flow.
  - **US-3 (Continuous knowledge factory)**: scheduled agent runs against multiple MCP sources, produces a digest.

## Open implementation choices

- **OS keychain library.** `keytar` is the de facto choice but has native deps. We treat it as an optional peer; without it, the file store covers local dev (chmod 0600).
- **Token cache persistence.** Tokens persist via `CredentialStore`. Refresh tokens survive across runtime restarts; access tokens are re-derived from refresh tokens.
- **Resource Indicators (RFC 8707).** Already passable via `auth.resource` in `mcp.json`; the SDK provider forwards them on `clientMetadata` / token requests.
- **Device-flow endpoint discovery.** Phase 5 requires explicit `auth.deviceEndpoints` in `mcp.json`. RFC 8414 metadata discovery could replace this once we encounter a real-world server that publishes it.

## Future / out of scope (tracked for later iterations)

- **Stream-based MCP registration** via the `entity_types` shape pattern. Considered, deferred — direct calls ship first; revisit with multi-runtime + multi-tab UI in real use.
- **Bearer-token auth on the runtime API.** Hook reserved (`requireAuth` on `mountMcpHttp`); implementation when we deploy a non-localhost setup.
- **SSE on `/api/mcp/events`.** Polling is fine until it isn't.
- **Tunnel the OAuth callback through agents-server** so the runtime doesn't need a public URL.
- **Wake-level suspend for long-running tool calls.** Spec Non-goal.
- **User identity / per-user credentials.** Spec Non-goal until the project gains a user record.
