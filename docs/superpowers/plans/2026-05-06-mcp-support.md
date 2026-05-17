# MCP Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement MCP support per `docs/superpowers/specs/2026-05-05-mcp-support-design.md`. Greenfield — does not build on PR #4165.

**Architecture:** A new package `@electric-ax/agents-mcp` exposes the MCP Registry, Key Vault, OAuth Coordinator, and a `mcp.tools(...)` factory that produces `AgentTool[]` for `defineEntity()`. The `agents-server` package gains OAuth callback endpoints and a status API; the `agents-server-ui` package gains a Connected Services page. Tool calls are synchronous within the wake; auth failures resolve as structured errors.

**Tech Stack:** TypeScript, pnpm workspace, tsdown, vitest. Uses `@modelcontextprotocol/sdk` (the official MCP TypeScript SDK) for the MCP client primitives. Node `fs.watch` + `fs/promises` for config + vault file ops. `node:crypto` for PKCE and OAuth state.

---

## File Structure

### New package: `packages/agents-mcp/`

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts` | Workspace package boilerplate |
| `src/index.ts` | Public exports |
| `src/types.ts` | Shared types: `McpServerConfig`, `McpAuthMode`, `McpToolError`, `McpServerStatus` |
| `src/config/loader.ts` | Parse + validate `mcp.json` |
| `src/config/watcher.ts` | File-watch wrapper around `loader.ts` |
| `src/config/env-expand.ts` | `${env:VAR}` substitution |
| `src/vault/types.ts` | `KeyVault` interface |
| `src/vault/file-vault.ts` | Default file-on-disk implementation (`chmod 600`, OS-keychain encryption when available) |
| `src/transports/types.ts` | `McpTransport` interface |
| `src/transports/stdio.ts` | Stdio subprocess transport |
| `src/transports/http.ts` | Streamable HTTP transport |
| `src/transports/timeout.ts` | Per-call timeout helper |
| `src/auth/types.ts` | Auth-related types |
| `src/auth/api-key.ts` | `apiKey` mode header injection |
| `src/auth/client-credentials.ts` | OAuth `client_credentials` grant |
| `src/auth/authorization-code.ts` | OAuth authorization-code grant + PKCE |
| `src/auth/device-code.ts` | OAuth device-code grant (RFC 8628) |
| `src/auth/coordinator.ts` | Owns refresh exchange with per-`(server, scope)` mutex |
| `src/auth/dcr.ts` | Dynamic Client Registration (RFC 7591) |
| `src/auth/discovery.ts` | RFC 9728 protected-resource-metadata discovery |
| `src/registry.ts` | MCP Registry: server lifecycle, hot-reload, status tracking |
| `src/bridge/tool-bridge.ts` | Wraps MCP tool calls as `AgentTool`, prefixes names, handles errors |
| `src/tools.ts` | `mcp.tools(allowlist)` factory exposed to agent definitions |
| `test/**/*.test.ts` | Vitest unit + integration tests (one file per src module) |

### Modified packages

| File | Modification |
|---|---|
| `packages/agents-server/src/oauth-routes.ts` (new) | OAuth callback (`GET /oauth/callback/:server`) and device-flow endpoints |
| `packages/agents-server/src/mcp-status-routes.ts` (new) | Connected Services API (status + per-server actions) |
| `packages/agents-server/src/server.ts` | Mount the new routes |
| `packages/agents-server-ui/src/router.tsx` | Add `/connected-services` route |
| `packages/agents-server-ui/src/components/connected-services/*.tsx` (new) | The page itself + per-row components |
| `packages/agents/src/bootstrap.ts` | Wire `@electric-ax/agents-mcp` registry into runtime startup |
| `packages/agents/src/agents/horton.ts` | Compose `mcp.tools('*')` into Horton's tool set |
| `pnpm-workspace.yaml` | (already includes `packages/*`) |

---

## Phase 1 — Registry, Bridge, apiKey only

End state: an agent declaration like `tools: [...mcp.tools(['github'])]` causes the agent to call into a registered MCP server using a pre-stored API key, with hot-reload of `mcp.json`. No OAuth.

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
  it('exports VERSION', () => {
    expect(mcp.VERSION).toBeTypeOf('string')
  })
})
```

- [ ] **Step 2: Run the test**

Run: `pnpm -C packages/agents-mcp test`
Expected: FAIL — package not buildable yet.

- [ ] **Step 3: Create package.json mirroring `agents-runtime`**

```json
{
  "name": "@electric-ax/agents-mcp",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsdown",
    "dev": "tsdown --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "stylecheck": "eslint . --quiet"
  },
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    }
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@electric-ax/agents-runtime": "workspace:*"
  },
  "devDependencies": {
    "tsdown": "*",
    "vitest": "*",
    "typescript": "*"
  }
}
```

- [ ] **Step 4: Create tsconfig, tsdown, vitest configs**

Copy patterns from `packages/agents-runtime/` (tsconfig extends `../../tsconfig.base.json`; tsdown emits ESM+CJS; vitest with file aliases).

- [ ] **Step 5: Create `src/index.ts`**

```ts
export const VERSION = '0.1.0'
```

- [ ] **Step 6: Install + run test**

Run: `pnpm install && pnpm -C packages/agents-mcp test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/agents-mcp pnpm-lock.yaml
git commit -m "feat(agents-mcp): bootstrap package"
```

### Task 2: Define core types

**Files:**
- Create: `packages/agents-mcp/src/types.ts`
- Create: `packages/agents-mcp/test/types.test.ts`

- [ ] **Step 1: Write the types test (just compiles + exports)**

```ts
// test/types.test.ts
import { describe, expect, it } from 'vitest'
import type { McpServerConfig, McpAuthMode, McpToolError, McpServerStatus } from '../src/types'

describe('types', () => {
  it('McpAuthMode enumerates expected modes', () => {
    const modes: McpAuthMode[] = ['apiKey', 'clientCredentials', 'authorizationCode']
    expect(modes).toHaveLength(3)
  })
  it('McpToolError categories', () => {
    const errs: McpToolError['kind'][] = ['auth_unavailable', 'transport_error', 'timeout', 'server_error', 'tool_not_found', 'schema_violation']
    expect(errs).toHaveLength(6)
  })
})
```

- [ ] **Step 2: Run test (fails)**

Run: `pnpm -C packages/agents-mcp test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement types**

```ts
// src/types.ts
export type McpAuthMode = 'apiKey' | 'clientCredentials' | 'authorizationCode'

export type McpServerStatus = 'healthy' | 'expiring' | 'needs_auth' | 'error' | 'disabled'

export type McpTransport = 'stdio' | 'http'

export interface McpServerConfigBase {
  transport: McpTransport
}

export interface McpStdioConfig extends McpServerConfigBase {
  transport: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface McpHttpConfig extends McpServerConfigBase {
  transport: 'http'
  url: string
  auth: McpAuthConfig
}

export type McpServerConfig = McpStdioConfig | McpHttpConfig

export type McpAuthConfig =
  | { mode: 'apiKey'; headerName: string; valueRef: string }
  | { mode: 'clientCredentials'; clientIdRef: string; clientSecretRef: string; tokenUrl: string; scopes?: string[] }
  | { mode: 'authorizationCode'; flow: 'browser' | 'device'; scopes?: string[]; clientIdRef?: string; authorizationUrl?: string; tokenUrl?: string }

export type McpToolError =
  | { kind: 'auth_unavailable'; server: string; detail?: string }
  | { kind: 'transport_error'; server: string; detail: string }
  | { kind: 'timeout'; server: string; ms: number }
  | { kind: 'server_error'; server: string; code?: string | number; message: string }
  | { kind: 'tool_not_found'; server: string; tool: string }
  | { kind: 'schema_violation'; server: string; tool: string; detail: string }
```

- [ ] **Step 4: Re-export from index**

Add `export * from './types'` to `src/index.ts`.

- [ ] **Step 5: Run test**

Run: `pnpm -C packages/agents-mcp test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agents-mcp/src packages/agents-mcp/test
git commit -m "feat(agents-mcp): core types"
```

### Task 3: Env-var expansion utility

**Files:**
- Create: `packages/agents-mcp/src/config/env-expand.ts`
- Create: `packages/agents-mcp/test/config/env-expand.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from 'vitest'
import { expandEnv } from '../../src/config/env-expand'

describe('expandEnv', () => {
  const env = { GITHUB_TOKEN: 'gh_abc', WORKSPACE: '/repo' }
  it('expands ${env:VAR}', () => {
    expect(expandEnv('Bearer ${env:GITHUB_TOKEN}', env)).toBe('Bearer gh_abc')
  })
  it('expands multiple', () => {
    expect(expandEnv('${env:WORKSPACE}/${env:GITHUB_TOKEN}', env)).toBe('/repo/gh_abc')
  })
  it('throws on missing', () => {
    expect(() => expandEnv('${env:MISSING}', env)).toThrow(/MISSING/)
  })
  it('passes through plain strings', () => {
    expect(expandEnv('plain', env)).toBe('plain')
  })
})
```

- [ ] **Step 2: Run test (fails)**

Run: `pnpm -C packages/agents-mcp test`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/config/env-expand.ts
const PATTERN = /\$\{env:([A-Z_][A-Z0-9_]*)\}/g

export function expandEnv(input: string, env: NodeJS.ProcessEnv | Record<string, string | undefined>): string {
  return input.replace(PATTERN, (_, name: string) => {
    const v = env[name]
    if (v === undefined) throw new Error(`Missing env var: ${name}`)
    return v
  })
}
```

- [ ] **Step 4: Run test, commit**

Run: `pnpm -C packages/agents-mcp test`
Expected: PASS.

```bash
git add . && git commit -m "feat(agents-mcp): env-var expansion utility"
```

### Task 4: Config loader (parse + validate `mcp.json`)

**Files:**
- Create: `packages/agents-mcp/src/config/loader.ts`
- Create: `packages/agents-mcp/test/config/loader.test.ts`
- Create: `packages/agents-mcp/test/fixtures/valid.json`
- Create: `packages/agents-mcp/test/fixtures/invalid-mode.json`

- [ ] **Step 1: Create fixtures**

```jsonc
// test/fixtures/valid.json
{
  "servers": {
    "github": {
      "transport": "http",
      "url": "https://api.example.com/mcp",
      "auth": { "mode": "apiKey", "headerName": "Authorization", "valueRef": "vault://github/token" }
    },
    "git-local": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-git"]
    }
  }
}
```

```jsonc
// test/fixtures/invalid-mode.json
{ "servers": { "x": { "transport": "http", "url": "https://x", "auth": { "mode": "bogus" } } } }
```

- [ ] **Step 2: Write the test**

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig, parseConfig } from '../../src/config/loader'

const fixture = (name: string) => readFileSync(join(__dirname, '../fixtures', name), 'utf8')

describe('config loader', () => {
  it('parses valid config', () => {
    const cfg = parseConfig(fixture('valid.json'))
    expect(Object.keys(cfg.servers)).toEqual(['github', 'git-local'])
    expect(cfg.servers.github.transport).toBe('http')
  })
  it('rejects invalid auth mode', () => {
    expect(() => parseConfig(fixture('invalid-mode.json'))).toThrow(/auth.*mode/)
  })
  it('loadConfig reads from path', async () => {
    const cfg = await loadConfig(join(__dirname, '../fixtures/valid.json'))
    expect(cfg.servers.github).toBeDefined()
  })
})
```

- [ ] **Step 3: Run test (fails)**

- [ ] **Step 4: Implement loader**

```ts
// src/config/loader.ts
import { readFile } from 'node:fs/promises'
import type { McpServerConfig, McpAuthMode } from '../types'

export interface McpConfig {
  servers: Record<string, McpServerConfig>
}

const ALLOWED_MODES: McpAuthMode[] = ['apiKey', 'clientCredentials', 'authorizationCode']

export function parseConfig(text: string): McpConfig {
  const data: unknown = JSON.parse(text)
  if (typeof data !== 'object' || data === null || !('servers' in data)) {
    throw new Error('mcp.json must be an object with a "servers" key')
  }
  const servers = (data as { servers: Record<string, unknown> }).servers
  for (const [name, raw] of Object.entries(servers)) {
    validateServer(name, raw)
  }
  return data as McpConfig
}

function validateServer(name: string, raw: unknown): void {
  if (typeof raw !== 'object' || raw === null) throw new Error(`Server "${name}" must be an object`)
  const s = raw as Record<string, unknown>
  if (s.transport !== 'stdio' && s.transport !== 'http') {
    throw new Error(`Server "${name}": transport must be "stdio" or "http"`)
  }
  if (s.transport === 'stdio') {
    if (typeof s.command !== 'string') throw new Error(`Server "${name}" (stdio): command required`)
  } else {
    if (typeof s.url !== 'string') throw new Error(`Server "${name}" (http): url required`)
    const auth = s.auth as Record<string, unknown> | undefined
    if (!auth) throw new Error(`Server "${name}" (http): auth required`)
    if (!ALLOWED_MODES.includes(auth.mode as McpAuthMode)) {
      throw new Error(`Server "${name}": auth.mode must be one of ${ALLOWED_MODES.join(', ')}`)
    }
  }
}

export async function loadConfig(path: string): Promise<McpConfig> {
  const text = await readFile(path, 'utf8')
  return parseConfig(text)
}
```

- [ ] **Step 5: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): config loader with validation"
```

### Task 5: Config watcher (hot reload)

**Files:**
- Create: `packages/agents-mcp/src/config/watcher.ts`
- Create: `packages/agents-mcp/test/config/watcher.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { watchConfig } from '../../src/config/watcher'

describe('watchConfig', () => {
  let dir = ''
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'mcp-')); })

  it('emits initial + change events with debounce', async () => {
    const path = join(dir, 'mcp.json')
    await writeFile(path, JSON.stringify({ servers: {} }))
    const events: string[] = []
    const stop = watchConfig(path, (cfg) => {
      events.push(Object.keys(cfg.servers).join(',') || 'empty')
    }, { debounceMs: 50 })

    await new Promise((r) => setTimeout(r, 100))  // initial load
    await writeFile(path, JSON.stringify({ servers: { a: { transport: 'http', url: 'http://x', auth: { mode: 'apiKey', headerName: 'X', valueRef: 'v' } } } }))
    await new Promise((r) => setTimeout(r, 200))

    stop()
    expect(events).toEqual(['empty', 'a'])
  })
})
```

- [ ] **Step 2: Run test (fails)**

- [ ] **Step 3: Implement watcher**

```ts
// src/config/watcher.ts
import { watch } from 'node:fs'
import { loadConfig, type McpConfig } from './loader'

export interface WatchOptions { debounceMs?: number }

export function watchConfig(
  path: string,
  onChange: (cfg: McpConfig) => void,
  opts: WatchOptions = {}
): () => void {
  const debounceMs = opts.debounceMs ?? 500
  let timer: NodeJS.Timeout | undefined
  const reload = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      try { onChange(await loadConfig(path)) }
      catch (err) { console.error(`mcp.json reload failed:`, err) }
    }, debounceMs)
  }
  reload()
  const watcher = watch(path, () => reload())
  return () => { watcher.close(); if (timer) clearTimeout(timer) }
}
```

- [ ] **Step 4: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): config file watcher with debounce"
```

### Task 6: KeyVault interface + file-on-disk implementation

**Files:**
- Create: `packages/agents-mcp/src/vault/types.ts`
- Create: `packages/agents-mcp/src/vault/file-vault.ts`
- Create: `packages/agents-mcp/test/vault/file-vault.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import { mkdtemp, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFileVault } from '../../src/vault/file-vault'

describe('file-vault', () => {
  let dir = ''
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'vault-')) })

  it('round-trips secrets', async () => {
    const vault = createFileVault(join(dir, 'vault.json'))
    await vault.set('a/b', 'sekret')
    expect(await vault.get('a/b')).toBe('sekret')
    await vault.delete('a/b')
    expect(await vault.get('a/b')).toBeNull()
  })
  it('enforces 0600 permissions on write', async () => {
    const path = join(dir, 'vault.json')
    const vault = createFileVault(path)
    await vault.set('x', 'y')
    const s = await stat(path)
    expect((s.mode & 0o777).toString(8)).toBe('600')
  })
  it('lists by prefix', async () => {
    const vault = createFileVault(join(dir, 'vault.json'))
    await vault.set('a/1', '1')
    await vault.set('a/2', '2')
    await vault.set('b/1', '3')
    const a = await vault.list('a/')
    expect(a.map((e) => e.ref).sort()).toEqual(['a/1', 'a/2'])
  })
})
```

- [ ] **Step 2: Run test (fails)**

- [ ] **Step 3: Implement KeyVault interface + file-on-disk**

```ts
// src/vault/types.ts
export interface KeyVault {
  get(ref: string): Promise<string | null>
  set(ref: string, secret: string, opts?: { expiresAt?: Date }): Promise<void>
  delete(ref: string): Promise<void>
  list(prefix?: string): Promise<Array<{ ref: string; expiresAt?: Date }>>
}
```

```ts
// src/vault/file-vault.ts
import { readFile, writeFile, chmod, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { KeyVault } from './types'

interface Entry { secret: string; expiresAt?: string }
type Store = Record<string, Entry>

async function read(path: string): Promise<Store> {
  try { return JSON.parse(await readFile(path, 'utf8')) as Store }
  catch (err: any) { if (err.code === 'ENOENT') return {}; throw err }
}

async function write(path: string, store: Store): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(store, null, 2))
  await chmod(path, 0o600)
}

export function createFileVault(path: string): KeyVault {
  return {
    async get(ref) {
      const s = await read(path)
      return s[ref]?.secret ?? null
    },
    async set(ref, secret, opts) {
      const s = await read(path)
      s[ref] = { secret, ...(opts?.expiresAt ? { expiresAt: opts.expiresAt.toISOString() } : {}) }
      await write(path, s)
    },
    async delete(ref) {
      const s = await read(path)
      delete s[ref]
      await write(path, s)
    },
    async list(prefix = '') {
      const s = await read(path)
      return Object.entries(s)
        .filter(([k]) => k.startsWith(prefix))
        .map(([ref, v]) => ({ ref, ...(v.expiresAt ? { expiresAt: new Date(v.expiresAt) } : {}) }))
    },
  }
}
```

Note: OS-keychain encryption-at-rest is deferred to Task 6b below; this base path stores plaintext-but-mode-0600 to keep the initial commit small.

- [ ] **Step 4: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): KeyVault interface + file-on-disk default"
```

### Task 6b: OS-keychain encryption-at-rest (optional best-effort layer)

**Files:**
- Modify: `packages/agents-mcp/src/vault/file-vault.ts`
- Create: `packages/agents-mcp/src/vault/keychain.ts`
- Create: `packages/agents-mcp/test/vault/keychain.test.ts`

- [ ] **Step 1: Write the test (uses an in-memory keychain shim)**

```ts
import { describe, expect, it } from 'vitest'
import { encryptWithKey, decryptWithKey, generateVaultKey } from '../../src/vault/keychain'

describe('vault encryption', () => {
  it('round-trips through AES-256-GCM', () => {
    const key = generateVaultKey()
    const ct = encryptWithKey('hello', key)
    expect(decryptWithKey(ct, key)).toBe('hello')
  })
  it('rejects tampered ciphertext', () => {
    const key = generateVaultKey()
    const ct = encryptWithKey('hello', key)
    const tampered = ct.slice(0, -2) + 'aa'
    expect(() => decryptWithKey(tampered, key)).toThrow()
  })
})
```

- [ ] **Step 2: Implement `keychain.ts`**

```ts
// src/vault/keychain.ts
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

export function generateVaultKey(): Buffer { return randomBytes(32) }

export function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}

export function decryptWithKey(b64: string, key: Buffer): string {
  const buf = Buffer.from(b64, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ct = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
```

- [ ] **Step 3: Wire encryption into file-vault**

Modify `file-vault.ts` to optionally accept a `key: Buffer`. When provided, secrets are stored as ciphertext. The key location (OS keychain via `keytar` or fallback to a sibling `.vault.key` file with `chmod 600`) is configured by the caller.

- [ ] **Step 4: Update `createFileVault` signature**

```ts
export interface FileVaultOptions { keyPath?: string; key?: Buffer }
export function createFileVault(path: string, opts: FileVaultOptions = {}): KeyVault { /* ... */ }
```

- [ ] **Step 5: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): AES-256-GCM encryption for vault entries"
```

### Task 7: Stdio transport

**Files:**
- Create: `packages/agents-mcp/src/transports/types.ts`
- Create: `packages/agents-mcp/src/transports/stdio.ts`
- Create: `packages/agents-mcp/test/transports/stdio.test.ts`

- [ ] **Step 1: Write the test using a fixture echo server**

The MCP TS SDK has built-in transports — wrap them rather than reimplementing. The test asserts the wrapper exposes the canonical methods.

```ts
import { describe, expect, it } from 'vitest'
import { createStdioTransport } from '../../src/transports/stdio'

describe('stdio transport', () => {
  it('exposes connect/send/close', () => {
    const t = createStdioTransport({ transport: 'stdio', command: 'echo', args: [] })
    expect(typeof t.connect).toBe('function')
    expect(typeof t.send).toBe('function')
    expect(typeof t.close).toBe('function')
  })
})
```

- [ ] **Step 2: Implement (delegates to MCP SDK)**

```ts
// src/transports/types.ts
export interface McpTransportHandle {
  connect(): Promise<void>
  send(message: unknown): Promise<unknown>
  close(): Promise<void>
}
```

```ts
// src/transports/stdio.ts
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { McpStdioConfig } from '../types'
import type { McpTransportHandle } from './types'

export function createStdioTransport(cfg: McpStdioConfig): McpTransportHandle {
  let client: Client | undefined
  let transport: StdioClientTransport | undefined
  return {
    async connect() {
      transport = new StdioClientTransport({ command: cfg.command, args: cfg.args ?? [], env: cfg.env })
      client = new Client({ name: 'agents-mcp', version: '0.1.0' }, { capabilities: {} })
      await client.connect(transport)
    },
    async send(message) {
      if (!client) throw new Error('not connected')
      return client.request(message as any, undefined as any)
    },
    async close() {
      await client?.close()
      client = undefined
      transport = undefined
    },
  }
}
```

- [ ] **Step 3: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): stdio transport wrapping MCP SDK"
```

### Task 8: HTTP transport

**Files:**
- Create: `packages/agents-mcp/src/transports/http.ts`
- Create: `packages/agents-mcp/test/transports/http.test.ts`

- [ ] **Step 1: Write the test (mirrors stdio test)**

```ts
import { describe, expect, it } from 'vitest'
import { createHttpTransport } from '../../src/transports/http'

describe('http transport', () => {
  it('exposes connect/send/close', () => {
    const t = createHttpTransport(
      { transport: 'http', url: 'http://x', auth: { mode: 'apiKey', headerName: 'X', valueRef: 'v' } },
      async () => 'token'
    )
    expect(typeof t.connect).toBe('function')
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/transports/http.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpHttpConfig } from '../types'
import type { McpTransportHandle } from './types'

export type GetToken = () => Promise<string | null>

export function createHttpTransport(cfg: McpHttpConfig, getToken: GetToken): McpTransportHandle {
  let client: Client | undefined
  let transport: StreamableHTTPClientTransport | undefined
  return {
    async connect() {
      const token = await getToken()
      transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
        requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
      })
      client = new Client({ name: 'agents-mcp', version: '0.1.0' }, { capabilities: {} })
      await client.connect(transport)
    },
    async send(message) {
      if (!client) throw new Error('not connected')
      return client.request(message as any, undefined as any)
    },
    async close() { await client?.close(); client = undefined; transport = undefined },
  }
}
```

(For `apiKey` mode where the header isn't `Authorization: Bearer …`, the registry layer in Task 11 picks the right `getToken` adapter.)

- [ ] **Step 3: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): Streamable HTTP transport"
```

### Task 9: Per-call timeout helper

**Files:**
- Create: `packages/agents-mcp/src/transports/timeout.ts`
- Create: `packages/agents-mcp/test/transports/timeout.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from 'vitest'
import { withTimeout, TimeoutError } from '../../src/transports/timeout'

describe('withTimeout', () => {
  it('resolves when fast enough', async () => {
    expect(await withTimeout(Promise.resolve(7), 50)).toBe(7)
  })
  it('rejects on timeout', async () => {
    await expect(withTimeout(new Promise(() => {}), 20)).rejects.toBeInstanceOf(TimeoutError)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/transports/timeout.ts
export class TimeoutError extends Error { constructor(public ms: number) { super(`timed out after ${ms}ms`) } }

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(ms)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}
```

- [ ] **Step 3: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): per-call timeout helper"
```

### Task 10: apiKey auth adapter

**Files:**
- Create: `packages/agents-mcp/src/auth/api-key.ts`
- Create: `packages/agents-mcp/test/auth/api-key.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from 'vitest'
import { createApiKeyAuth } from '../../src/auth/api-key'

describe('apiKey auth', () => {
  const vault = { get: async (r: string) => (r === 'vault://x/key' ? 'TOKEN' : null) } as any
  it('reads from vault', async () => {
    const auth = createApiKeyAuth(
      { mode: 'apiKey', headerName: 'X-Token', valueRef: 'vault://x/key' },
      vault
    )
    expect(await auth.getToken()).toBe('TOKEN')
    expect(auth.headerName).toBe('X-Token')
  })
  it('null when missing', async () => {
    const auth = createApiKeyAuth(
      { mode: 'apiKey', headerName: 'X-Token', valueRef: 'vault://missing' },
      vault
    )
    expect(await auth.getToken()).toBeNull()
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/auth/api-key.ts
import type { KeyVault } from '../vault/types'

export interface ApiKeyAuth {
  headerName: string
  getToken(): Promise<string | null>
}

export function createApiKeyAuth(
  cfg: { mode: 'apiKey'; headerName: string; valueRef: string },
  vault: KeyVault
): ApiKeyAuth {
  return {
    headerName: cfg.headerName,
    getToken: () => vault.get(cfg.valueRef),
  }
}
```

- [ ] **Step 3: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): apiKey auth adapter"
```

### Task 11: MCP Registry

**Files:**
- Create: `packages/agents-mcp/src/registry.ts`
- Create: `packages/agents-mcp/test/registry.test.ts`

The registry owns: server lifecycle (connect/close), tool list per server, status per server, hot-reload from a config source. v1 supports apiKey auth; OAuth modes throw `Not implemented` until Task 14+.

- [ ] **Step 1: Write the test (using fakes for transport + vault)**

```ts
import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/registry'
import type { KeyVault } from '../src/vault/types'

const vault: KeyVault = {
  get: async (r) => (r === 'vault://github/token' ? 'TOKEN' : null),
  set: async () => {}, delete: async () => {}, list: async () => [],
}

describe('registry', () => {
  it('registers servers and tracks status', async () => {
    const reg = createRegistry({ vault, transportFactory: fakeFactory() })
    await reg.applyConfig({
      servers: {
        gh: { transport: 'http', url: 'http://x', auth: { mode: 'apiKey', headerName: 'A', valueRef: 'vault://github/token' } }
      }
    })
    expect(reg.list()).toEqual([
      expect.objectContaining({ name: 'gh', status: 'healthy' })
    ])
  })

  it('flips status to needs_auth when token absent', async () => {
    const reg = createRegistry({ vault, transportFactory: fakeFactory() })
    await reg.applyConfig({
      servers: {
        bad: { transport: 'http', url: 'http://x', auth: { mode: 'apiKey', headerName: 'A', valueRef: 'vault://missing' } }
      }
    })
    expect(reg.list().find((s) => s.name === 'bad')?.status).toBe('needs_auth')
  })
})

function fakeFactory() { /* see implementation below — return a stub transport */ }
```

- [ ] **Step 2: Implement registry**

```ts
// src/registry.ts
import type { McpConfig } from './config/loader'
import type { KeyVault } from './vault/types'
import type { McpServerConfig, McpServerStatus } from './types'
import type { McpTransportHandle } from './transports/types'

export interface ServerEntry {
  name: string
  config: McpServerConfig
  status: McpServerStatus
  lastError?: string
  transport?: McpTransportHandle
  tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>
}

export interface RegistryOpts {
  vault: KeyVault
  transportFactory: (name: string, cfg: McpServerConfig, vault: KeyVault) => McpTransportHandle
}

export interface Registry {
  applyConfig(cfg: McpConfig): Promise<void>
  list(): ServerEntry[]
  get(name: string): ServerEntry | undefined
  invokeTool(server: string, tool: string, args: unknown, timeoutMs: number): Promise<unknown>
}

export function createRegistry(opts: RegistryOpts): Registry {
  const servers = new Map<string, ServerEntry>()

  async function checkAuth(name: string, cfg: McpServerConfig): Promise<McpServerStatus> {
    if (cfg.transport === 'stdio') return 'healthy'
    if (cfg.auth.mode === 'apiKey') {
      const tok = await opts.vault.get(cfg.auth.valueRef)
      return tok ? 'healthy' : 'needs_auth'
    }
    return 'needs_auth'  // OAuth flows handled later
  }

  return {
    async applyConfig(cfg) {
      // remove gone
      for (const name of Array.from(servers.keys())) {
        if (!(name in cfg.servers)) {
          await servers.get(name)?.transport?.close()
          servers.delete(name)
        }
      }
      // upsert remaining
      for (const [name, sc] of Object.entries(cfg.servers)) {
        const existing = servers.get(name)
        if (existing) await existing.transport?.close()
        const status = await checkAuth(name, sc)
        servers.set(name, { name, config: sc, status })
      }
    },
    list: () => Array.from(servers.values()),
    get: (n) => servers.get(n),
    async invokeTool(serverName, tool, args, timeoutMs) {
      const e = servers.get(serverName)
      if (!e) throw new Error(`unknown server: ${serverName}`)
      if (!e.transport) {
        e.transport = opts.transportFactory(serverName, e.config, opts.vault)
        await e.transport.connect()
      }
      const { withTimeout } = await import('./transports/timeout')
      return withTimeout(
        e.transport.send({ method: 'tools/call', params: { name: tool, arguments: args } }),
        timeoutMs
      )
    },
  }
}
```

- [ ] **Step 3: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): registry with hot-reload-capable applyConfig"
```

### Task 12: Tool bridge — wrap MCP tools as `AgentTool`

**Files:**
- Create: `packages/agents-mcp/src/bridge/tool-bridge.ts`
- Create: `packages/agents-mcp/test/bridge/tool-bridge.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from 'vitest'
import { bridgeMcpTool } from '../../src/bridge/tool-bridge'

describe('bridgeMcpTool', () => {
  it('prefixes name and forwards args', async () => {
    const calls: any[] = []
    const tool = bridgeMcpTool({
      server: 'github',
      tool: { name: 'create_issue', description: 'create' },
      invoke: async (s, t, a, tm) => { calls.push({ s, t, a, tm }); return { ok: true } },
      timeoutMs: 30_000,
    })
    expect(tool.name).toBe('github.create_issue')
    const result = await tool.run({ repo: 'foo' })
    expect(result).toEqual({ ok: true })
    expect(calls[0]).toEqual({ s: 'github', t: 'create_issue', a: { repo: 'foo' }, tm: 30_000 })
  })

  it('maps timeout to structured error', async () => {
    const tool = bridgeMcpTool({
      server: 'gh', tool: { name: 'x' },
      invoke: async () => { const { TimeoutError } = await import('../../src/transports/timeout'); throw new TimeoutError(30) },
      timeoutMs: 30,
    })
    const r = await tool.run({})
    expect(r).toEqual({ error: { kind: 'timeout', server: 'gh', ms: 30 } })
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/bridge/tool-bridge.ts
import { TimeoutError } from '../transports/timeout'
import type { McpToolError } from '../types'

export interface BridgeOpts {
  server: string
  tool: { name: string; description?: string; inputSchema?: unknown }
  invoke: (server: string, tool: string, args: unknown, timeoutMs: number) => Promise<unknown>
  timeoutMs: number
}

export function bridgeMcpTool(opts: BridgeOpts): { name: string; description?: string; run: (args: unknown) => Promise<unknown> } {
  const fullName = `${opts.server}.${opts.tool.name}`
  return {
    name: fullName,
    description: opts.tool.description,
    async run(args) {
      try {
        return await opts.invoke(opts.server, opts.tool.name, args, opts.timeoutMs)
      } catch (err) {
        return { error: toToolError(err, opts.server, opts.tool.name) }
      }
    },
  }
}

function toToolError(err: unknown, server: string, tool: string): McpToolError {
  if (err instanceof TimeoutError) return { kind: 'timeout', server, ms: err.ms }
  const msg = err instanceof Error ? err.message : String(err)
  if (/auth/i.test(msg)) return { kind: 'auth_unavailable', server, detail: msg }
  return { kind: 'transport_error', server, detail: msg }
}
```

(Output is shaped to match `AgentTool`'s expected return; adapt to the actual `AgentTool` interface from `@mariozechner/pi-agent-core` when integrating in Task 13.)

- [ ] **Step 3: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): tool bridge with prefixing and structured errors"
```

### Task 13: `mcp.tools(...)` factory + AgentTool integration

**Files:**
- Create: `packages/agents-mcp/src/tools.ts`
- Create: `packages/agents-mcp/test/tools.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from 'vitest'
import { createMcpTools } from '../src/tools'

const fakeRegistry = {
  list: () => [
    { name: 'github', config: {} as any, status: 'healthy', tools: [{ name: 'create_issue' }, { name: 'get_pr' }] },
    { name: 'sentry', config: {} as any, status: 'healthy', tools: [{ name: 'list_events' }] },
  ],
  get: (n: string) => fakeRegistry.list().find((s) => s.name === n),
  applyConfig: async () => {},
  invokeTool: async () => ({}),
}

describe('createMcpTools', () => {
  it('selects by allowlist', () => {
    const tools = createMcpTools(fakeRegistry as any, ['github']).tools()
    expect(tools.map((t) => t.name)).toEqual(['github.create_issue', 'github.get_pr'])
  })
  it('returns all on wildcard', () => {
    const tools = createMcpTools(fakeRegistry as any, '*').tools()
    expect(tools.map((t) => t.name)).toEqual(['github.create_issue', 'github.get_pr', 'sentry.list_events'])
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/tools.ts
import type { Registry } from './registry'
import { bridgeMcpTool } from './bridge/tool-bridge'

const DEFAULT_TIMEOUT_MS = 30_000

export interface McpToolsHandle {
  tools(): Array<ReturnType<typeof bridgeMcpTool>>
}

export function createMcpTools(
  registry: Registry,
  allowlist: string[] | '*',
  opts: { timeoutMs?: number } = {}
): McpToolsHandle {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return {
    tools() {
      const all = registry.list()
      const selected = allowlist === '*' ? all : all.filter((s) => allowlist.includes(s.name))
      return selected.flatMap((s) =>
        (s.tools ?? []).map((t) =>
          bridgeMcpTool({
            server: s.name,
            tool: t,
            invoke: registry.invokeTool.bind(registry),
            timeoutMs,
          })
        )
      )
    },
  }
}
```

- [ ] **Step 3: Add tool list discovery to the registry**

Modify `applyConfig` in `src/registry.ts` to fetch the tool list per server (`tools/list` MCP request) after a successful connect. Lazy-connect on first invocation; for v1 also pre-connect on apply for healthy servers so `list()` returns tools right away. Add a test:

```ts
it('fetches tool list at apply time', async () => {
  // configure a fake transport that responds to tools/list
})
```

- [ ] **Step 4: Re-export from `src/index.ts`**

```ts
export { createMcpTools } from './tools'
export { createRegistry } from './registry'
```

- [ ] **Step 5: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): mcp.tools(...) factory with allowlist + wildcard"
```

### Task 14: Wire into `agents` package + Horton

**Files:**
- Modify: `packages/agents/src/bootstrap.ts`
- Modify: `packages/agents/src/agents/horton.ts`
- Modify: `packages/agents/package.json`

- [ ] **Step 1: Add dependency**

In `packages/agents/package.json` add `"@electric-ax/agents-mcp": "workspace:*"` to dependencies.

- [ ] **Step 2: Bootstrap registry on server start**

In `packages/agents/src/bootstrap.ts` (read first to understand current shape), construct the vault + registry + watcher:

```ts
import { createFileVault, createRegistry, createMcpTools } from '@electric-ax/agents-mcp'
import { watchConfig } from '@electric-ax/agents-mcp/dist/config/watcher'  // adjust per actual exports
// ... existing imports

const vault = createFileVault(process.env.MCP_VAULT_PATH ?? '.electric-agents/vault.json')
const registry = createRegistry({ vault, transportFactory: defaultTransportFactory })
const stop = watchConfig(process.env.MCP_CONFIG_PATH ?? 'mcp.json', (cfg) => registry.applyConfig(cfg).catch(console.error))

// expose registry to agent definitions
export const mcpHandle = createMcpTools(registry, '*')
```

- [ ] **Step 3: Compose into Horton**

In `packages/agents/src/agents/horton.ts`, add `...mcpHandle.tools()` to Horton's tool array.

- [ ] **Step 4: Smoke test**

Stand up the dev stack per `AGENTS.md` (`pnpm -C packages/agents-runtime dev`, `pnpm -C packages/agents-server dev`, `pnpm -C packages/agents dev`, then run the entrypoints). Create a sample `mcp.json` with one apiKey-protected stdio echo server (use `@modelcontextprotocol/server-everything`). From a Horton chat, invoke a tool and verify it round-trips.

- [ ] **Step 5: Commit**

```bash
git add . && git commit -m "feat(agents): wire agents-mcp into bootstrap + Horton"
```

### Task 15: Phase 1 end-of-phase verification

- [ ] **Step 1: Run the full package test suite**

Run: `pnpm -C packages/agents-mcp test --run && pnpm -C packages/agents test --run`
Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `pnpm -C packages/agents-mcp typecheck`
Expected: clean.

- [ ] **Step 3: Manual end-to-end smoke**

Walk through the README quick-start with one apiKey server registered. Invoke at least one tool from a Horton chat. Confirm: success result; auth-missing → `auth_unavailable`; timeout → `timeout`.

- [ ] **Step 4: Commit + tag the phase**

```bash
git add . && git commit --allow-empty -m "milestone: agents-mcp phase 1 complete (apiKey only)"
```

---

## Phase 1.5 — MCP Protocol Coverage and E2E Tests

End state: a hermetic mock MCP server fixture exercises the registry + bridge across the entire MCP protocol surface (tools, resources, prompts, progress notifications, cancellation, capability negotiation). E2E tests run in CI without external network or subprocess flake.

### Task 15a: Mock MCP server fixture (stdio + HTTP modes)

**Files:**
- Create: `packages/agents-mcp/test/fixtures/mock-mcp-server.ts`
- Create: `packages/agents-mcp/test/fixtures/mock-mcp-server.test.ts`

The fixture is a single TypeScript module that can be invoked two ways:
1. **As a stdio subprocess** — `node dist/test-fixtures/mock-mcp-server.js [scenario]` reads JSON-RPC from stdin and writes to stdout.
2. **As an in-process HTTP handler** — exposes a `Fetch`-style handler the HTTP transport tests can call directly without a real server.

Scenarios encode behaviors: `default`, `error`, `slow`, `progress`, `auth-required`, `tools-changed`.

- [ ] **Step 1: Test the fixture itself**

```ts
import { describe, expect, it } from 'vitest'
import { createMockServer } from './mock-mcp-server'

describe('mock MCP server', () => {
  it('responds to initialize with capabilities', async () => {
    const srv = createMockServer({ scenario: 'default' })
    const res = await srv.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } } })
    expect(res.result.capabilities.tools).toBeDefined()
  })

  it('lists tools', async () => {
    const srv = createMockServer({ scenario: 'default' })
    const res = await srv.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    expect(res.result.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'echo' })]))
  })

  it('echoes tools/call', async () => {
    const srv = createMockServer({ scenario: 'default' })
    const res = await srv.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { msg: 'hi' } } })
    expect(res.result.content[0]).toEqual({ type: 'text', text: 'hi' })
  })

  it('emits progress notifications when scenario=progress', async () => {
    const srv = createMockServer({ scenario: 'progress' })
    const events: any[] = []
    srv.onNotification = (n) => events.push(n)
    await srv.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'long', arguments: {}, _meta: { progressToken: 'p1' } } })
    expect(events.some((e) => e.method === 'notifications/progress')).toBe(true)
  })
})
```

- [ ] **Step 2: Implement the fixture**

```ts
// test/fixtures/mock-mcp-server.ts
export type Scenario = 'default' | 'error' | 'slow' | 'progress' | 'auth-required' | 'tools-changed'

export interface MockServer {
  handle(req: { jsonrpc: '2.0'; id: number | string; method: string; params?: any }): Promise<any>
  onNotification?: (n: { jsonrpc: '2.0'; method: string; params?: any }) => void
  setScenario(s: Scenario): void
}

const TOOLS = {
  default: [
    { name: 'echo', description: 'echo input', inputSchema: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] } },
    { name: 'add', description: 'add two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
  ],
  changed: [
    { name: 'echo2', description: 'echo v2', inputSchema: { type: 'object' } },
  ],
}

const RESOURCES = [
  { uri: 'mock://config.json', name: 'config', mimeType: 'application/json' },
  { uri: 'mock://readme.md', name: 'readme', mimeType: 'text/markdown' },
]

const PROMPTS = [
  { name: 'greet', description: 'greet user', arguments: [{ name: 'name', required: true }] },
]

export function createMockServer(opts: { scenario?: Scenario } = {}): MockServer {
  let scenario: Scenario = opts.scenario ?? 'default'
  const server: MockServer = {
    setScenario(s) { scenario = s },
    async handle(req) {
      switch (req.method) {
        case 'initialize':
          return { jsonrpc: '2.0', id: req.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} }, serverInfo: { name: 'mock', version: '0' } } }
        case 'tools/list': {
          const tools = scenario === 'tools-changed' ? TOOLS.changed : TOOLS.default
          return { jsonrpc: '2.0', id: req.id, result: { tools } }
        }
        case 'tools/call': {
          if (scenario === 'auth-required') return { jsonrpc: '2.0', id: req.id, error: { code: -32001, message: 'Unauthorized' } }
          if (scenario === 'error') return { jsonrpc: '2.0', id: req.id, error: { code: -32603, message: 'tool failed' } }
          if (scenario === 'slow') { await new Promise((r) => setTimeout(r, 100)); /* fallthrough */ }
          if (scenario === 'progress' && req.params?._meta?.progressToken) {
            const token = req.params._meta.progressToken
            for (let i = 1; i <= 3; i++) {
              await new Promise((r) => setTimeout(r, 5))
              server.onNotification?.({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: i, total: 3 } })
            }
          }
          const name = req.params?.name
          if (name === 'echo') return { jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: String(req.params.arguments.msg) }] } }
          if (name === 'add') return { jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: String(req.params.arguments.a + req.params.arguments.b) }] } }
          if (name === 'long') return { jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: 'done' }] } }
          return { jsonrpc: '2.0', id: req.id, error: { code: -32602, message: `unknown tool: ${name}` } }
        }
        case 'resources/list':
          return { jsonrpc: '2.0', id: req.id, result: { resources: RESOURCES } }
        case 'resources/read': {
          const uri = req.params?.uri
          if (uri === 'mock://config.json') return { jsonrpc: '2.0', id: req.id, result: { contents: [{ uri, mimeType: 'application/json', text: '{"hello":1}' }] } }
          if (uri === 'mock://readme.md') return { jsonrpc: '2.0', id: req.id, result: { contents: [{ uri, mimeType: 'text/markdown', text: '# mock' }] } }
          return { jsonrpc: '2.0', id: req.id, error: { code: -32602, message: 'unknown resource' } }
        }
        case 'prompts/list':
          return { jsonrpc: '2.0', id: req.id, result: { prompts: PROMPTS } }
        case 'prompts/get':
          return { jsonrpc: '2.0', id: req.id, result: { messages: [{ role: 'user', content: { type: 'text', text: `Hello, ${req.params.arguments.name}!` } }] } }
        default:
          return { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `method not found: ${req.method}` } }
      }
    },
  }
  return server
}

// Stdio mode entry point — when run as a subprocess.
if (import.meta.url === `file://${process.argv[1]}`) {
  const scenario = (process.argv[2] as Scenario) ?? 'default'
  const srv = createMockServer({ scenario })
  srv.onNotification = (n) => process.stdout.write(JSON.stringify(n) + '\n')
  let buf = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', async (chunk) => {
    buf += chunk
    let nl: number
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (!line.trim()) continue
      const req = JSON.parse(line)
      const res = await srv.handle(req)
      process.stdout.write(JSON.stringify(res) + '\n')
    }
  })
}
```

- [ ] **Step 3: Add fixture build to tsdown / vitest config**

Make sure the fixture is buildable as an ESM file we can spawn. Add a `test:fixtures` script that compiles `test/fixtures/mock-mcp-server.ts` to `dist/test-fixtures/mock-mcp-server.js` for stdio testing, OR have tests use `tsx` to run the TypeScript directly. (Pick whichever matches the repo's existing pattern.)

- [ ] **Step 4: Run, commit**

```bash
git add . && git commit -m "test(agents-mcp): mock MCP server fixture with scenarios"
```

### Task 15b: Resources bridge

**Files:**
- Create: `packages/agents-mcp/src/bridge/resource-bridge.ts`
- Create: `packages/agents-mcp/test/bridge/resource-bridge.test.ts`
- Modify: `packages/agents-mcp/src/registry.ts` (track resources alongside tools)
- Modify: `packages/agents-mcp/src/tools.ts` (expose resource tools)

MCP resources are exposed to the agent as two synthetic tools per server: `<server>.list_resources()` and `<server>.read_resource({ uri })`.

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from 'vitest'
import { bridgeResourceTools } from '../../src/bridge/resource-bridge'

describe('bridgeResourceTools', () => {
  it('exposes list + read', async () => {
    const invoked: any[] = []
    const tools = bridgeResourceTools({
      server: 'gh',
      invoke: async (s, method, args) => { invoked.push({ s, method, args }); return method === 'resources/list' ? { resources: [{ uri: 'x://y' }] } : { contents: [{ uri: args.uri, text: 'hi' }] } },
      timeoutMs: 30_000,
    })
    expect(tools.map((t) => t.name)).toEqual(['gh.list_resources', 'gh.read_resource'])
    const list = await tools[0].run({})
    expect((list as any).resources).toHaveLength(1)
    const read = await tools[1].run({ uri: 'x://y' })
    expect((read as any).contents[0].text).toBe('hi')
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/bridge/resource-bridge.ts
import { TimeoutError } from '../transports/timeout'

export interface ResourceBridgeOpts {
  server: string
  invoke: (server: string, method: string, args: any, timeoutMs: number) => Promise<unknown>
  timeoutMs: number
}

export function bridgeResourceTools(opts: ResourceBridgeOpts) {
  return [
    {
      name: `${opts.server}.list_resources`,
      description: `List resources exposed by ${opts.server}`,
      async run() {
        try { return await opts.invoke(opts.server, 'resources/list', {}, opts.timeoutMs) }
        catch (err) { return { error: { kind: err instanceof TimeoutError ? 'timeout' : 'transport_error', server: opts.server, detail: String(err) } } }
      },
    },
    {
      name: `${opts.server}.read_resource`,
      description: `Read a resource by URI from ${opts.server}`,
      async run(args: any) {
        try { return await opts.invoke(opts.server, 'resources/read', { uri: args.uri }, opts.timeoutMs) }
        catch (err) { return { error: { kind: err instanceof TimeoutError ? 'timeout' : 'transport_error', server: opts.server, detail: String(err) } } }
      },
    },
  ]
}
```

- [ ] **Step 3: Update registry to support arbitrary methods, not just tools/call**

In `registry.ts`, generalize `invokeTool` to `invokeMethod(server, method, args, timeoutMs)`. Keep `invokeTool` as a thin wrapper. Update the tool-bridge call site in `tools.ts`.

- [ ] **Step 4: Update `tools.ts` to include resource tools**

```ts
// In createMcpTools.tools():
return selected.flatMap((s) => [
  ...(s.tools ?? []).map((t) => bridgeMcpTool({ server: s.name, tool: t, invoke: registry.invokeMethod, timeoutMs })),
  ...bridgeResourceTools({ server: s.name, invoke: registry.invokeMethod, timeoutMs }),
])
```

- [ ] **Step 5: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): expose resources/list and resources/read as agent tools"
```

### Task 15c: Prompts bridge

**Files:**
- Create: `packages/agents-mcp/src/bridge/prompt-bridge.ts`
- Create: `packages/agents-mcp/test/bridge/prompt-bridge.test.ts`
- Modify: `packages/agents-mcp/src/tools.ts`

Symmetric to resources — expose `<server>.list_prompts()` and `<server>.get_prompt({ name, arguments })`.

- [ ] **Step 1: Test (mirrors resource-bridge.test.ts pattern)**

- [ ] **Step 2: Implement (mirrors `bridgeResourceTools` shape)**

```ts
// src/bridge/prompt-bridge.ts
import { TimeoutError } from '../transports/timeout'

export function bridgePromptTools(opts: { server: string; invoke: (s: string, m: string, a: any, t: number) => Promise<unknown>; timeoutMs: number }) {
  return [
    { name: `${opts.server}.list_prompts`, description: `List prompts exposed by ${opts.server}`, async run() { try { return await opts.invoke(opts.server, 'prompts/list', {}, opts.timeoutMs) } catch (e) { return { error: { kind: e instanceof TimeoutError ? 'timeout' : 'transport_error', server: opts.server, detail: String(e) } } } } },
    { name: `${opts.server}.get_prompt`, description: `Get a prompt by name from ${opts.server}`, async run(args: any) { try { return await opts.invoke(opts.server, 'prompts/get', { name: args.name, arguments: args.arguments }, opts.timeoutMs) } catch (e) { return { error: { kind: e instanceof TimeoutError ? 'timeout' : 'transport_error', server: opts.server, detail: String(e) } } } } },
  ]
}
```

- [ ] **Step 3: Wire into `tools.ts`**

Add `...bridgePromptTools({ server: s.name, invoke: registry.invokeMethod, timeoutMs })` to the flat-map in `createMcpTools.tools()`.

- [ ] **Step 4: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): expose prompts/list and prompts/get as agent tools"
```

### Task 15d: Progress notifications passthrough

**Files:**
- Modify: `packages/agents-mcp/src/registry.ts`
- Modify: `packages/agents-mcp/src/types.ts`
- Create: `packages/agents-mcp/test/registry-progress.test.ts`

The bridge generates a unique `progressToken` per call, includes it in the `_meta` of the request, and accepts `notifications/progress` from the server. It exposes a `subscribeToProgress(callback)` hook so the agents-server-ui can render progress events on the entity timeline.

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/registry'
import { createMockServer } from './fixtures/mock-mcp-server'

describe('progress passthrough', () => {
  it('emits progress events to subscribers', async () => {
    // Build a transport that delegates to createMockServer({ scenario: 'progress' })
    // and forwards onNotification callbacks to the registry.
    const events: any[] = []
    const reg = createRegistry({ /* … */ })
    reg.subscribeToProgress((e) => events.push(e))
    await reg.applyConfig({ servers: { mock: { transport: 'stdio', command: 'node', args: ['./dist/test-fixtures/mock-mcp-server.js', 'progress'] } } })
    await reg.invokeMethod('mock', 'tools/call', { name: 'long', arguments: {} }, 5_000)
    expect(events.length).toBe(3)
    expect(events.every((e) => e.server === 'mock')).toBe(true)
  })
})
```

- [ ] **Step 2: Implement**

Add to `Registry`:

```ts
export interface ProgressEvent { server: string; progressToken: string | number; progress: number; total?: number; message?: string }

interface Registry {
  // … existing
  subscribeToProgress(cb: (e: ProgressEvent) => void): () => void
}
```

Implementation: keep an internal `Set<callback>`. The transport layer (stdio + HTTP) needs an `onNotification` hook so the registry receives `notifications/progress` and dispatches to subscribers. Add `progressToken` generation to `invokeMethod` (UUID per call) and include it as `_meta.progressToken` in the request.

- [ ] **Step 3: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): progress notifications passthrough with subscriber API"
```

### Task 15e: Cancellation

**Files:**
- Modify: `packages/agents-mcp/src/registry.ts`
- Modify: `packages/agents-mcp/src/transports/types.ts` (add cancel method)
- Create: `packages/agents-mcp/test/cancellation.test.ts`

When a tool call times out, the bridge sends `notifications/cancelled` to the server (per MCP spec) so the server can stop work. Same when an operator disables the server.

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/registry'

describe('cancellation', () => {
  it('sends notifications/cancelled to the server on timeout', async () => {
    // Configure registry to use a transport that records notifications/cancelled.
    const sent: any[] = []
    // … set up registry with mock transport that resolves slowly
    const reg = createRegistry({ /* … with transport that captures onNotificationSent */ })
    await reg.applyConfig({ servers: { mock: { transport: 'stdio', command: 'node', args: ['./dist/test-fixtures/mock-mcp-server.js', 'slow'] } } })
    await expect(reg.invokeMethod('mock', 'tools/call', { name: 'long', arguments: {} }, 10)).rejects.toBeInstanceOf((await import('../src/transports/timeout')).TimeoutError)
    // After timeout: assert cancelled was sent for the request id.
  })
})
```

- [ ] **Step 2: Implement**

In `invokeMethod`: generate a request id, use it for the call. If the timeout fires (caught at the registry layer), send `{ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId, reason: 'timeout' } }` via the transport before returning the error to the caller.

- [ ] **Step 3: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): send notifications/cancelled on timeout and disable"
```

### Task 15f: Capability negotiation assertions

**Files:**
- Modify: `packages/agents-mcp/src/registry.ts`
- Create: `packages/agents-mcp/test/capabilities.test.ts`

After connecting a server, the registry inspects the server's declared capabilities. Servers that don't advertise `tools` capability are flagged `error: server has no tools capability`; ditto resources/prompts (warning, not error — those are optional).

- [ ] **Step 1: Test**

```ts
it('flags server without tools capability as error', async () => {
  // mock server returns capabilities: { resources: {} } but no tools
  // expect status === 'error', lastError contains 'tools'
})
```

- [ ] **Step 2: Implement**

In the registry connect path, after the MCP SDK's `client.connect(transport)`, read `client.getServerCapabilities()`. If the server config implies tools usage but `capabilities.tools` is undefined, mark the server `error`.

- [ ] **Step 3: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): capability negotiation status checks"
```

### Task 15g: End-to-end tests against the mock server (stdio)

**Files:**
- Create: `packages/agents-mcp/test/e2e/stdio.e2e.test.ts`

A complete E2E suite that starts the mock server as a stdio subprocess and exercises the full registry → bridge → tool path.

- [ ] **Step 1: Write the test suite**

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { createRegistry } from '../../src/registry'
import { createFileVault } from '../../src/vault/file-vault'
import { createMcpTools } from '../../src/tools'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('E2E: stdio mock server', () => {
  let registry: ReturnType<typeof createRegistry>
  let vaultDir = ''

  beforeAll(async () => {
    vaultDir = mkdtempSync(join(tmpdir(), 'mcp-e2e-'))
    const vault = createFileVault(join(vaultDir, 'vault.json'))
    registry = createRegistry({ vault, oauth: nullOAuth(), transportFactory: defaultTransportFactory })
    await registry.applyConfig({
      servers: {
        mock: {
          transport: 'stdio',
          command: 'node',
          args: ['./dist/test-fixtures/mock-mcp-server.js', 'default'],
        },
      },
    })
  })

  afterAll(async () => {
    for (const s of registry.list()) await s.transport?.close()
  })

  it('lists tools via mcp.tools(...)', () => {
    const tools = createMcpTools(registry, ['mock']).tools()
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['mock.echo', 'mock.add', 'mock.list_resources', 'mock.read_resource', 'mock.list_prompts', 'mock.get_prompt']))
  })

  it('echo round-trip', async () => {
    const tools = createMcpTools(registry, ['mock']).tools()
    const echo = tools.find((t) => t.name === 'mock.echo')!
    const result = await echo.run({ msg: 'hello' })
    expect(result).toMatchObject({ content: [{ type: 'text', text: 'hello' }] })
  })

  it('add round-trip', async () => {
    const tools = createMcpTools(registry, ['mock']).tools()
    const add = tools.find((t) => t.name === 'mock.add')!
    expect(await add.run({ a: 2, b: 3 })).toMatchObject({ content: [{ type: 'text', text: '5' }] })
  })

  it('lists resources', async () => {
    const tools = createMcpTools(registry, ['mock']).tools()
    const list = tools.find((t) => t.name === 'mock.list_resources')!
    const r = await list.run({}) as any
    expect(r.resources.length).toBeGreaterThan(0)
  })

  it('reads a resource', async () => {
    const tools = createMcpTools(registry, ['mock']).tools()
    const read = tools.find((t) => t.name === 'mock.read_resource')!
    const r = await read.run({ uri: 'mock://config.json' }) as any
    expect(r.contents[0].text).toContain('hello')
  })

  it('returns timeout error on slow scenario', async () => {
    await registry.applyConfig({ servers: { slow: { transport: 'stdio', command: 'node', args: ['./dist/test-fixtures/mock-mcp-server.js', 'slow'] } } })
    const tools = createMcpTools(registry, ['slow'], { timeoutMs: 10 }).tools()
    const echo = tools.find((t) => t.name === 'slow.echo')!
    const r = await echo.run({ msg: 'x' }) as any
    expect(r.error).toMatchObject({ kind: 'timeout', server: 'slow' })
  })

  it('returns server_error on error scenario', async () => {
    await registry.applyConfig({ servers: { err: { transport: 'stdio', command: 'node', args: ['./dist/test-fixtures/mock-mcp-server.js', 'error'] } } })
    const tools = createMcpTools(registry, ['err']).tools()
    const echo = tools.find((t) => t.name === 'err.echo')!
    const r = await echo.run({ msg: 'x' }) as any
    expect(r.error).toBeDefined()
  })

  it('hot-reload picks up new server within applyConfig', async () => {
    await registry.applyConfig({ servers: { ...currentConfig, late: { transport: 'stdio', command: 'node', args: ['./dist/test-fixtures/mock-mcp-server.js', 'default'] } } })
    expect(registry.list().some((s) => s.name === 'late')).toBe(true)
  })

  it('progress notifications fire during a tool call', async () => {
    await registry.applyConfig({ servers: { p: { transport: 'stdio', command: 'node', args: ['./dist/test-fixtures/mock-mcp-server.js', 'progress'] } } })
    const events: any[] = []
    const unsub = registry.subscribeToProgress((e) => events.push(e))
    const tools = createMcpTools(registry, ['p']).tools()
    await tools.find((t) => t.name === 'p.echo')!.run({ msg: 'x' })
    unsub()
    expect(events.some((e) => e.server === 'p')).toBe(true)
  })
})
```

Note: the test uses `defaultTransportFactory` and `nullOAuth` helpers to be defined in test/helpers.ts (a shared utility module). Phase 2 will replace `nullOAuth` with the real coordinator.

- [ ] **Step 2: Implement test helpers**

```ts
// test/helpers.ts
import { createOAuthCoordinator } from '../src/auth/coordinator'
import { createStdioTransport } from '../src/transports/stdio'
import { createHttpTransport } from '../src/transports/http'
import type { McpServerConfig } from '../src/types'
import type { KeyVault } from '../src/vault/types'

export function nullOAuth() {
  return createOAuthCoordinator({
    cache: { get: () => undefined, set: () => {} },
    doRefresh: async () => { throw new Error('OAuth not configured for this test') },
  })
}

export function defaultTransportFactory(name: string, cfg: McpServerConfig, vault: KeyVault) {
  if (cfg.transport === 'stdio') return createStdioTransport(cfg)
  return createHttpTransport(cfg, async () => null)
}
```

- [ ] **Step 3: Run, commit**

```bash
pnpm -C packages/agents-mcp test --run
git add . && git commit -m "test(agents-mcp): E2E suite against stdio mock server"
```

### Task 15h: End-to-end tests against the mock server (HTTP)

**Files:**
- Create: `packages/agents-mcp/test/e2e/http.e2e.test.ts`

Same scenarios but driving the HTTP transport against an in-process HTTP server that wraps the mock fixture.

- [ ] **Step 1: Write the test using `node:http`**

```ts
import { createServer } from 'node:http'
import { createMockServer } from '../fixtures/mock-mcp-server'
// … boots an http.Server that bridges Streamable HTTP semantics to the mock
// (HTTP request body = JSON-RPC; response = JSON-RPC; SSE for notifications).
// Register the server with the registry under transport: 'http' + auth: { mode: 'apiKey', ... }
// Re-run the same battery of tool / resource / prompt / timeout / error / progress assertions.
```

- [ ] **Step 2: Implement HTTP wrapper**

A small adapter that turns `MockServer.handle` + `MockServer.onNotification` into a Streamable HTTP-compatible server. ~50 lines.

- [ ] **Step 3: Run, commit**

```bash
git add . && git commit -m "test(agents-mcp): E2E suite against HTTP mock server"
```

### Task 15i: Phase 1.5 verification

- [ ] **Step 1: Test suite green**

Run: `pnpm -C packages/agents-mcp test --run`
All E2E + unit tests pass.

- [ ] **Step 2: Coverage check**

Run: `pnpm -C packages/agents-mcp coverage`
Confirm `src/registry.ts`, `src/bridge/*`, `src/transports/*` all >80% line coverage.

- [ ] **Step 3: Commit milestone**

```bash
git add . && git commit --allow-empty -m "milestone: agents-mcp phase 1.5 complete (protocol coverage + E2E)"
```

## Phase 2 — OAuth (clientCredentials + authorizationCode browser)

End state: HTTP MCP servers using OAuth `clientCredentials` or `authorizationCode (browser)` work. Silent refresh on every call. Auth failures resolve as `auth_unavailable`.

### Task 16: PKCE generator

**Files:**
- Create: `packages/agents-mcp/src/auth/pkce.ts`
- Create: `packages/agents-mcp/test/auth/pkce.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from 'vitest'
import { generatePkcePair, codeChallengeS256 } from '../../src/auth/pkce'

describe('PKCE', () => {
  it('verifier is 43-128 url-safe chars', () => {
    const { verifier } = generatePkcePair()
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/)
  })
  it('challenge matches S256 of verifier', () => {
    const { verifier, challenge } = generatePkcePair()
    expect(challenge).toBe(codeChallengeS256(verifier))
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/)  // base64url, no padding
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/auth/pkce.ts
import { randomBytes, createHash } from 'node:crypto'

function base64Url(b: Buffer): string { return b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_') }

export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(64)).slice(0, 64)
  return { verifier, challenge: codeChallengeS256(verifier) }
}

export function codeChallengeS256(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier).digest())
}
```

- [ ] **Step 3: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): PKCE S256 generator"
```

### Task 17: clientCredentials grant

**Files:**
- Create: `packages/agents-mcp/src/auth/client-credentials.ts`
- Create: `packages/agents-mcp/test/auth/client-credentials.test.ts`

- [ ] **Step 1: Test using `fetch` mock**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { exchangeClientCredentials } from '../../src/auth/client-credentials'

beforeEach(() => { vi.restoreAllMocks() })

describe('exchangeClientCredentials', () => {
  it('POSTs and returns access token', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ access_token: 'AT', expires_in: 3600, token_type: 'Bearer' }) })) as any
    const tok = await exchangeClientCredentials({
      tokenUrl: 'https://x/token', clientId: 'id', clientSecret: 'sec', scopes: ['s'], fetch: f,
    })
    expect(tok.accessToken).toBe('AT')
    expect(tok.expiresAt.getTime()).toBeGreaterThan(Date.now())
    const [, init] = f.mock.calls[0]
    expect(init.body.toString()).toContain('grant_type=client_credentials')
  })
  it('throws on non-200', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 401, text: async () => 'no' })) as any
    await expect(exchangeClientCredentials({ tokenUrl: 'http://x', clientId: 'i', clientSecret: 's', fetch: f }))
      .rejects.toThrow(/401/)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/auth/client-credentials.ts
export interface TokenSet {
  accessToken: string
  refreshToken?: string
  expiresAt: Date
  tokenType: string
}

export async function exchangeClientCredentials(opts: {
  tokenUrl: string
  clientId: string
  clientSecret: string
  scopes?: string[]
  fetch?: typeof globalThis.fetch
}): Promise<TokenSet> {
  const f = opts.fetch ?? globalThis.fetch
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    ...(opts.scopes ? { scope: opts.scopes.join(' ') } : {}),
  })
  const res = await f(opts.tokenUrl, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  if (!res.ok) throw new Error(`token endpoint ${res.status}: ${await res.text()}`)
  const j = await res.json() as { access_token: string; expires_in?: number; token_type?: string; refresh_token?: string }
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: new Date(Date.now() + (j.expires_in ?? 3600) * 1000),
    tokenType: j.token_type ?? 'Bearer',
  }
}
```

- [ ] **Step 3: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): clientCredentials grant exchange"
```

### Task 18: authorizationCode (browser) — URL builder + state store

**Files:**
- Create: `packages/agents-mcp/src/auth/authorization-code.ts`
- Create: `packages/agents-mcp/test/auth/authorization-code.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from 'vitest'
import { buildAuthorizationUrl, exchangeAuthorizationCode } from '../../src/auth/authorization-code'

describe('authorizationCode', () => {
  it('builds URL with PKCE + state', () => {
    const { url, state, verifier } = buildAuthorizationUrl({
      authorizationUrl: 'https://x/authorize',
      clientId: 'cid', redirectUri: 'http://localhost/cb',
      scopes: ['repo', 'read:user'],
    })
    const u = new URL(url)
    expect(u.searchParams.get('client_id')).toBe('cid')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('state')).toBe(state)
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/auth/authorization-code.ts
import { randomBytes } from 'node:crypto'
import { generatePkcePair } from './pkce'
import type { TokenSet } from './client-credentials'

export interface AuthRequest {
  url: string
  state: string
  verifier: string
}

export function buildAuthorizationUrl(opts: {
  authorizationUrl: string
  clientId: string
  redirectUri: string
  scopes?: string[]
  resource?: string
}): AuthRequest {
  const { verifier, challenge } = generatePkcePair()
  const state = randomBytes(16).toString('hex')
  const u = new URL(opts.authorizationUrl)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', opts.clientId)
  u.searchParams.set('redirect_uri', opts.redirectUri)
  u.searchParams.set('state', state)
  u.searchParams.set('code_challenge', challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  if (opts.scopes?.length) u.searchParams.set('scope', opts.scopes.join(' '))
  if (opts.resource) u.searchParams.set('resource', opts.resource)
  return { url: u.toString(), state, verifier }
}

export async function exchangeAuthorizationCode(opts: {
  tokenUrl: string
  clientId: string
  redirectUri: string
  code: string
  verifier: string
  fetch?: typeof globalThis.fetch
}): Promise<TokenSet> {
  const f = opts.fetch ?? globalThis.fetch
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    code: opts.code,
    code_verifier: opts.verifier,
  })
  const res = await f(opts.tokenUrl, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  if (!res.ok) throw new Error(`token endpoint ${res.status}: ${await res.text()}`)
  const j = await res.json() as any
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: new Date(Date.now() + (j.expires_in ?? 3600) * 1000),
    tokenType: j.token_type ?? 'Bearer',
  }
}

export async function refreshToken(opts: {
  tokenUrl: string; clientId: string; refreshToken: string; fetch?: typeof globalThis.fetch
}): Promise<TokenSet> {
  const f = opts.fetch ?? globalThis.fetch
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: opts.clientId, refresh_token: opts.refreshToken })
  const res = await f(opts.tokenUrl, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  if (!res.ok) throw new Error(`refresh failed: ${res.status}`)
  const j = await res.json() as any
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: new Date(Date.now() + (j.expires_in ?? 3600) * 1000), tokenType: j.token_type ?? 'Bearer' }
}
```

- [ ] **Step 3: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): authorization-code URL + token + refresh"
```

### Task 19: Pending-auth state store (server-side, in-memory)

The OAuth flow is multi-step: build URL → user redirected → callback returns code → exchange. We need to remember `(state, verifier, server)` between the URL build and the callback.

**Files:**
- Create: `packages/agents-mcp/src/auth/pending-auth.ts`
- Create: `packages/agents-mcp/test/auth/pending-auth.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from 'vitest'
import { createPendingAuthStore } from '../../src/auth/pending-auth'

describe('pending-auth store', () => {
  it('stores and consumes by state', () => {
    const store = createPendingAuthStore({ ttlMs: 600_000 })
    store.put({ state: 's1', server: 'github', verifier: 'v1', clientId: 'cid', tokenUrl: 'http://t', redirectUri: 'http://cb' })
    const v = store.consume('s1')
    expect(v?.verifier).toBe('v1')
    expect(store.consume('s1')).toBeUndefined()  // consumed
  })
  it('expires after TTL', () => {
    const store = createPendingAuthStore({ ttlMs: 1, now: () => Date.now() + 100 })
    store.put({ state: 's', server: 's', verifier: 'v', clientId: 'c', tokenUrl: 't', redirectUri: 'r' })
    expect(store.consume('s')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/auth/pending-auth.ts
export interface PendingAuth {
  state: string
  server: string
  verifier: string
  clientId: string
  tokenUrl: string
  redirectUri: string
  insertedAt?: number
}

export interface PendingAuthStore {
  put(p: PendingAuth): void
  consume(state: string): PendingAuth | undefined
}

export function createPendingAuthStore(opts: { ttlMs: number; now?: () => number }): PendingAuthStore {
  const now = opts.now ?? (() => Date.now())
  const map = new Map<string, PendingAuth>()
  return {
    put(p) { map.set(p.state, { ...p, insertedAt: now() }) },
    consume(state) {
      const v = map.get(state)
      if (!v) return undefined
      map.delete(state)
      if (v.insertedAt && now() - v.insertedAt > opts.ttlMs) return undefined
      return v
    },
  }
}
```

- [ ] **Step 3: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): pending-auth state store"
```

### Task 20: OAuth Coordinator (refresh exchange with mutex)

**Files:**
- Create: `packages/agents-mcp/src/auth/coordinator.ts`
- Create: `packages/agents-mcp/test/auth/coordinator.test.ts`

The coordinator owns: "give me a current access token for server X" with serialization. If the cached token is valid → return it. If expired and refresh-token available → refresh under a mutex (concurrent callers wait on the same exchange). If refresh fails → throw `AuthUnavailableError`.

- [ ] **Step 1: Test**

```ts
import { describe, expect, it, vi } from 'vitest'
import { createOAuthCoordinator, AuthUnavailableError } from '../../src/auth/coordinator'

describe('OAuthCoordinator', () => {
  it('serializes refresh: only one exchange runs for concurrent callers', async () => {
    let exchangeCount = 0
    const coordinator = createOAuthCoordinator({
      vault: { get: async () => null, set: async () => {}, delete: async () => {}, list: async () => [] } as any,
      doRefresh: async () => {
        exchangeCount++
        await new Promise((r) => setTimeout(r, 20))
        return { accessToken: 'NEW', expiresAt: new Date(Date.now() + 60_000), tokenType: 'Bearer' }
      },
      cache: { get: () => ({ accessToken: 'OLD', refreshToken: 'rt', expiresAt: new Date(Date.now() - 1000), tokenType: 'Bearer' }), set: () => {} },
    } as any)
    const [a, b, c] = await Promise.all([coordinator.getToken('s', ['x']), coordinator.getToken('s', ['x']), coordinator.getToken('s', ['x'])])
    expect([a, b, c]).toEqual(['NEW', 'NEW', 'NEW'])
    expect(exchangeCount).toBe(1)
  })

  it('throws AuthUnavailable when no refresh token and no cached', async () => {
    const c = createOAuthCoordinator({
      vault: { get: async () => null } as any,
      doRefresh: async () => { throw new Error('no token') },
      cache: { get: () => undefined, set: () => {} },
    } as any)
    await expect(c.getToken('s', ['x'])).rejects.toBeInstanceOf(AuthUnavailableError)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/auth/coordinator.ts
import type { TokenSet } from './client-credentials'
import type { KeyVault } from '../vault/types'

export class AuthUnavailableError extends Error { constructor(public server: string, public detail: string) { super(`auth unavailable for ${server}: ${detail}`) } }

export interface TokenCache {
  get(server: string, scopeKey: string): TokenSet | undefined
  set(server: string, scopeKey: string, t: TokenSet): void
}

export interface OAuthCoordinator {
  getToken(server: string, scopes: string[] | undefined): Promise<string>
  setToken(server: string, scopes: string[] | undefined, t: TokenSet): void
}

export interface CoordinatorOpts {
  doRefresh: (server: string, scopes: string[] | undefined, cached: TokenSet | undefined) => Promise<TokenSet>
  cache: TokenCache
}

export function createOAuthCoordinator(opts: CoordinatorOpts): OAuthCoordinator {
  const inflight = new Map<string, Promise<TokenSet>>()
  const scopeKey = (s: string[] | undefined) => (s?.slice().sort().join(' ') ?? '')

  return {
    async getToken(server, scopes) {
      const key = `${server}::${scopeKey(scopes)}`
      const cached = opts.cache.get(server, scopeKey(scopes))
      if (cached && cached.expiresAt.getTime() > Date.now() + 30_000) return cached.accessToken
      let p = inflight.get(key)
      if (!p) {
        p = (async () => {
          try {
            const t = await opts.doRefresh(server, scopes, cached)
            opts.cache.set(server, scopeKey(scopes), t)
            return t
          } catch (err) {
            throw new AuthUnavailableError(server, err instanceof Error ? err.message : String(err))
          }
        })()
        inflight.set(key, p)
        p.finally(() => inflight.delete(key))
      }
      const t = await p
      return t.accessToken
    },
    setToken(server, scopes, t) { opts.cache.set(server, scopeKey(scopes), t) },
  }
}
```

- [ ] **Step 3: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): OAuth coordinator with refresh-exchange mutex"
```

### Task 21: Wire OAuth into the registry

**Files:**
- Modify: `packages/agents-mcp/src/registry.ts`
- Modify: `packages/agents-mcp/test/registry.test.ts`

The registry's `checkAuth` and `transportFactory` currently only handle `apiKey`. Extend to use the OAuth coordinator for `clientCredentials` and `authorizationCode` modes.

- [ ] **Step 1: Add tests for clientCredentials and authorizationCode statuses**

```ts
it('clientCredentials: healthy when client_id+secret in vault', async () => { /* … */ })
it('authorizationCode: needs_auth when no token cached', async () => { /* … */ })
```

- [ ] **Step 2: Inject the coordinator into `RegistryOpts`**

Update `createRegistry` signature:

```ts
export interface RegistryOpts {
  vault: KeyVault
  oauth: OAuthCoordinator
  transportFactory: (name: string, cfg: McpServerConfig, getAuthHeader: () => Promise<{ name: string; value: string } | null>) => McpTransportHandle
}
```

The registry computes `getAuthHeader` per server based on auth mode:
- `apiKey` → reads `valueRef` from vault, returns `{ name: cfg.headerName, value: <vault value> }`.
- `clientCredentials` / `authorizationCode` → calls `oauth.getToken(server, scopes)`, returns `{ name: 'Authorization', value: 'Bearer <token>' }`. Errors are mapped to `null` (transport then sees no header → server returns 401 → bridge maps to `auth_unavailable`).

- [ ] **Step 3: Update `bootstrap.ts` to construct the coordinator**

```ts
const tokenCache = createInMemoryTokenCache()
const coordinator = createOAuthCoordinator({
  cache: tokenCache,
  doRefresh: async (server, scopes, cached) => {
    const cfg = registry.get(server)?.config
    if (!cfg || cfg.transport !== 'http') throw new Error('not http')
    if (cfg.auth.mode === 'clientCredentials') {
      const id = await vault.get(cfg.auth.clientIdRef)
      const secret = await vault.get(cfg.auth.clientSecretRef)
      if (!id || !secret) throw new Error('missing client credentials')
      return exchangeClientCredentials({ tokenUrl: cfg.auth.tokenUrl, clientId: id, clientSecret: secret, scopes })
    }
    if (cfg.auth.mode === 'authorizationCode') {
      if (!cached?.refreshToken) throw new Error('no refresh token; reauth required')
      return refreshToken({ tokenUrl: cfg.auth.tokenUrl!, clientId: cfg.auth.clientIdRef!, refreshToken: cached.refreshToken })
    }
    throw new Error('unsupported auth mode')
  },
})
```

- [ ] **Step 4: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): registry uses OAuth coordinator for HTTP auth"
```

### Task 21a: Protected Resource Metadata discovery (RFC 9728)

**Files:**
- Create: `packages/agents-mcp/src/auth/discovery.ts`
- Create: `packages/agents-mcp/test/auth/discovery.test.ts`

When a server config omits explicit `authorizationUrl` / `tokenUrl`, the runtime discovers them per RFC 9728 by fetching `<resource>/.well-known/oauth-protected-resource`, then dereferencing the authorization server's metadata.

- [ ] **Step 1: Test (mock fetch)**

```ts
import { describe, expect, it, vi } from 'vitest'
import { discoverAuthServer } from '../../src/auth/discovery'

describe('discoverAuthServer', () => {
  it('follows RFC 9728 chain', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.endsWith('/.well-known/oauth-protected-resource')) {
        return { ok: true, json: async () => ({ authorization_servers: ['https://auth.example.com'] }) } as any
      }
      if (url === 'https://auth.example.com/.well-known/oauth-authorization-server') {
        return { ok: true, json: async () => ({ authorization_endpoint: 'https://auth.example.com/authorize', token_endpoint: 'https://auth.example.com/token', registration_endpoint: 'https://auth.example.com/register' }) } as any
      }
      return { ok: false, status: 404, text: async () => 'nope' } as any
    })
    const m = await discoverAuthServer('https://api.example.com/mcp', f)
    expect(m.authorizationEndpoint).toBe('https://auth.example.com/authorize')
    expect(m.tokenEndpoint).toBe('https://auth.example.com/token')
    expect(m.registrationEndpoint).toBe('https://auth.example.com/register')
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/auth/discovery.ts
export interface AuthServerMetadata {
  authorizationEndpoint: string
  tokenEndpoint: string
  deviceAuthorizationEndpoint?: string
  registrationEndpoint?: string
  scopesSupported?: string[]
}

export async function discoverAuthServer(resourceUrl: string, fetchFn: typeof globalThis.fetch = globalThis.fetch): Promise<AuthServerMetadata> {
  const u = new URL(resourceUrl)
  const wellKnown = `${u.origin}/.well-known/oauth-protected-resource`
  const r1 = await fetchFn(wellKnown)
  if (!r1.ok) throw new Error(`discovery: ${wellKnown} returned ${r1.status}`)
  const meta1 = await r1.json() as { authorization_servers?: string[] }
  const authServer = meta1.authorization_servers?.[0]
  if (!authServer) throw new Error('discovery: no authorization_servers in resource metadata')
  const r2 = await fetchFn(`${authServer}/.well-known/oauth-authorization-server`)
  if (!r2.ok) throw new Error(`discovery: auth server metadata ${r2.status}`)
  const meta2 = await r2.json() as any
  return {
    authorizationEndpoint: meta2.authorization_endpoint,
    tokenEndpoint: meta2.token_endpoint,
    deviceAuthorizationEndpoint: meta2.device_authorization_endpoint,
    registrationEndpoint: meta2.registration_endpoint,
    scopesSupported: meta2.scopes_supported,
  }
}
```

- [ ] **Step 3: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): RFC 9728 protected-resource-metadata discovery"
```

### Task 21b: Dynamic Client Registration (RFC 7591)

**Files:**
- Create: `packages/agents-mcp/src/auth/dcr.ts`
- Create: `packages/agents-mcp/test/auth/dcr.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it, vi } from 'vitest'
import { registerClient } from '../../src/auth/dcr'

describe('registerClient', () => {
  it('POSTs metadata and returns client_id + client_secret', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ client_id: 'cid', client_secret: 'csec' }) })) as any
    const r = await registerClient({
      registrationEndpoint: 'https://x/register',
      clientName: 'electric-agents',
      redirectUris: ['http://localhost:4437/oauth/callback/foo'],
      grantTypes: ['authorization_code', 'refresh_token'],
      fetch: f,
    })
    expect(r.clientId).toBe('cid')
    expect(r.clientSecret).toBe('csec')
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/auth/dcr.ts
export interface RegisteredClient { clientId: string; clientSecret?: string }

export async function registerClient(opts: {
  registrationEndpoint: string
  clientName: string
  redirectUris: string[]
  grantTypes: string[]
  scopes?: string[]
  fetch?: typeof globalThis.fetch
}): Promise<RegisteredClient> {
  const f = opts.fetch ?? globalThis.fetch
  const body = {
    client_name: opts.clientName,
    redirect_uris: opts.redirectUris,
    grant_types: opts.grantTypes,
    token_endpoint_auth_method: 'client_secret_post',
    ...(opts.scopes ? { scope: opts.scopes.join(' ') } : {}),
  }
  const res = await f(opts.registrationEndpoint, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
  if (!res.ok) throw new Error(`DCR ${res.status}: ${await res.text()}`)
  const j = await res.json() as { client_id: string; client_secret?: string }
  return { clientId: j.client_id, clientSecret: j.client_secret }
}
```

- [ ] **Step 3: Wire DCR + discovery into bootstrap**

In `bootstrap.ts`, when a server config omits `clientIdRef`, on first authorization attempt: discover the auth server metadata, run DCR if `registrationEndpoint` is present, store the resulting client_id/secret in vault under `vault://<server>/dcr/client_id` and `vault://<server>/dcr/client_secret`. Subsequent flows reuse them.

- [ ] **Step 4: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): RFC 7591 Dynamic Client Registration"
```

### Task 22: agents-server OAuth callback endpoint

**Files:**
- Create: `packages/agents-server/src/oauth-routes.ts`
- Modify: `packages/agents-server/src/server.ts`
- Create: `packages/agents-server/test/oauth-routes.test.ts`

- [ ] **Step 1: Test (using a fake registry + pending-auth store + token exchange)**

```ts
it('GET /oauth/callback/:server completes flow and stores token', async () => {
  // Setup: pre-seed pending-auth with state="s", server="gh"
  // Mock token exchange to return AT/RT.
  // Hit GET /oauth/callback/gh?state=s&code=abc
  // Expect: 200 page; vault has token; cache has token.
})

it('rejects unknown state', async () => { /* expect 400 */ })
```

- [ ] **Step 2: Implement route**

Read `packages/agents-server/src/server.ts` to understand current router conventions, then add:

```ts
// packages/agents-server/src/oauth-routes.ts
import type { Router } from 'express'  // or whatever the server uses
import { exchangeAuthorizationCode } from '@electric-ax/agents-mcp/auth/authorization-code'
import type { PendingAuthStore } from '@electric-ax/agents-mcp/auth/pending-auth'
import type { OAuthCoordinator } from '@electric-ax/agents-mcp/auth/coordinator'

export function mountOAuthRoutes(router: Router, deps: { pending: PendingAuthStore; coordinator: OAuthCoordinator }) {
  router.get('/oauth/callback/:server', async (req, res) => {
    const code = String(req.query.code ?? '')
    const state = String(req.query.state ?? '')
    if (!code || !state) return res.status(400).send('missing code or state')
    const pending = deps.pending.consume(state)
    if (!pending) return res.status(400).send('unknown state')
    try {
      const tokens = await exchangeAuthorizationCode({
        tokenUrl: pending.tokenUrl,
        clientId: pending.clientId,
        redirectUri: pending.redirectUri,
        code,
        verifier: pending.verifier,
      })
      deps.coordinator.setToken(pending.server, undefined, tokens)
      res.status(200).send('Authorization complete. You can close this window.')
    } catch (err) {
      res.status(500).send(`Token exchange failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  })
}
```

- [ ] **Step 3: Mount in `server.ts` + bootstrap deps**

- [ ] **Step 4: Run, commit**

```bash
git add . && git commit -m "feat(agents-server): OAuth callback route"
```

### Task 23: Initiate authorization-code flow API

**Files:**
- Create: `packages/agents-server/src/mcp-status-routes.ts` (placeholder for Phase 3 too)
- Modify: `packages/agents-server/src/server.ts`

- [ ] **Step 1: Add an endpoint `POST /api/mcp/servers/:server/authorize`**

It builds an authorization URL via `buildAuthorizationUrl`, stashes the `(state, verifier, …)` in the pending-auth store, and returns `{ url }`. The UI (Phase 3) opens this URL in a new tab; for now, this endpoint is callable from curl or test.

- [ ] **Step 2: Test**

```ts
it('POST /api/mcp/servers/:server/authorize returns auth URL', async () => {
  // hit endpoint, assert 200 with { url } where url contains state= and code_challenge=
})
```

- [ ] **Step 3: Commit**

```bash
git add . && git commit -m "feat(agents-server): initiate authorization-code flow"
```

### Task 24: Phase 2 verification

- [ ] **Step 1: End-to-end with a real OAuth MCP server**

Pick a public MCP server with OAuth (e.g. Linear's MCP, or a self-hosted one for testing). Configure `mcp.json` with `authorizationCode` mode. Hit the authorize endpoint, complete the flow in browser, verify the agent can call a tool.

- [ ] **Step 2: clientCredentials end-to-end**

Same with a clientCredentials-mode server.

- [ ] **Step 3: Confirm refresh works**

Force a token expiry (manipulate vault), trigger a tool call, assert silent refresh runs and the call succeeds.

- [ ] **Step 4: Commit**

```bash
git add . && git commit --allow-empty -m "milestone: agents-mcp phase 2 complete (OAuth)"
```

---

## Phase 3 — Connected Services UI

End state: an operator visits agents-server-ui, sees all configured servers with status, can click "Authorize" to start an OAuth flow, and watches the status flip to `healthy` after completion.

### Task 25: Status API

**Files:**
- Modify: `packages/agents-server/src/mcp-status-routes.ts`
- Create: `packages/agents-server/test/mcp-status-routes.test.ts`

- [ ] **Step 1: Test**

```ts
it('GET /api/mcp/servers returns list with status', async () => { /* … */ })
it('POST /api/mcp/servers/:s/disable + /enable toggle status', async () => { /* … */ })
it('DELETE /api/mcp/servers/:s/credentials revokes vault entry', async () => { /* … */ })
```

- [ ] **Step 2: Implement endpoints**

```ts
// GET /api/mcp/servers — list
// GET /api/mcp/servers/:server — single
// POST /api/mcp/servers/:server/authorize — initiate OAuth (Task 23)
// POST /api/mcp/servers/:server/disable — set status disabled
// POST /api/mcp/servers/:server/enable — clear disabled
// DELETE /api/mcp/servers/:server/credentials — clear vault entries for server
```

Implementation reads from the registry (`registry.list()`), augmented with last-error metadata kept in memory. Add a small wrapper around the registry to track per-server runtime state (last successful call timestamp, last error string).

- [ ] **Step 3: Commit**

```bash
git add . && git commit -m "feat(agents-server): MCP status + management API"
```

### Task 26: Connected Services route + page shell

**Files:**
- Modify: `packages/agents-server-ui/src/router.tsx`
- Create: `packages/agents-server-ui/src/components/connected-services/page.tsx`
- Create: `packages/agents-server-ui/src/components/connected-services/page.test.tsx` (if test infra exists)

- [ ] **Step 1: Read existing router**

Run: read `packages/agents-server-ui/src/router.tsx` to understand routing patterns.

- [ ] **Step 2: Add route `/connected-services`**

Wire the new page in the router.

- [ ] **Step 3: Implement minimal page**

Page fetches `GET /api/mcp/servers` on mount and renders a list (one row per server: name, transport, mode, status pill, last-refresh time).

```tsx
// page.tsx (skeleton — adapt to existing UI primitives in packages/agents-server-ui)
import { useEffect, useState } from 'react'

interface ServerRow { name: string; transport: string; authMode: string; status: string; lastRefresh?: string; lastError?: string }

export function ConnectedServicesPage() {
  const [rows, setRows] = useState<ServerRow[]>([])
  useEffect(() => { fetch('/api/mcp/servers').then((r) => r.json()).then(setRows) }, [])
  return (
    <div>
      <h1>Connected Services</h1>
      <table>
        <thead><tr><th>Name</th><th>Transport</th><th>Auth</th><th>Status</th><th>Last refresh</th><th>Actions</th></tr></thead>
        <tbody>{rows.map((r) => <Row key={r.name} row={r} />)}</tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add . && git commit -m "feat(agents-server-ui): Connected Services page shell"
```

### Task 27: Per-row actions (Authorize / Re-authorize / Disable / Enable / Disconnect)

**Files:**
- Modify: `packages/agents-server-ui/src/components/connected-services/page.tsx`
- Create: `packages/agents-server-ui/src/components/connected-services/row.tsx`

- [ ] **Step 1: Implement a Row component with action buttons**

```tsx
function Row({ row }: { row: ServerRow }) {
  const authorize = async () => {
    const { url } = await fetch(`/api/mcp/servers/${row.name}/authorize`, { method: 'POST' }).then((r) => r.json())
    window.open(url, '_blank')
  }
  const disable = () => fetch(`/api/mcp/servers/${row.name}/disable`, { method: 'POST' })
  const enable = () => fetch(`/api/mcp/servers/${row.name}/enable`, { method: 'POST' })
  const disconnect = () => fetch(`/api/mcp/servers/${row.name}/credentials`, { method: 'DELETE' })

  return (
    <tr>
      <td>{row.name}</td><td>{row.transport}</td><td>{row.authMode}</td>
      <td><StatusPill status={row.status} /></td>
      <td>{row.lastRefresh ?? '—'}</td>
      <td>
        {row.authMode !== 'apiKey' && <button onClick={authorize}>{row.status === 'healthy' ? 'Re-authorize' : 'Authorize'}</button>}
        {row.status !== 'disabled' ? <button onClick={disable}>Disable</button> : <button onClick={enable}>Enable</button>}
        <button onClick={disconnect}>Disconnect</button>
      </td>
    </tr>
  )
}
```

- [ ] **Step 2: Auto-refresh status every 5s**

```tsx
useEffect(() => { const i = setInterval(reload, 5000); return () => clearInterval(i) }, [])
```

- [ ] **Step 3: Manual smoke test**

Open the page, click Authorize on an authorizationCode server, complete OAuth, watch status flip to `healthy` within 5s.

- [ ] **Step 4: Commit**

```bash
git add . && git commit -m "feat(agents-server-ui): per-row actions on Connected Services page"
```

### Task 28: Phase 3 verification

- [ ] **Step 1: Run all UI / server tests**

Run: `pnpm -C packages/agents-server-ui test --run && pnpm -C packages/agents-server test --run`

- [ ] **Step 2: Manual end-to-end**

1. Start the dev stack.
2. Configure `mcp.json` with one apiKey server (healthy), one clientCredentials server (healthy after first call), and one authorizationCode server (needs_auth initially).
3. Open `/connected-services`.
4. Click Authorize on the authorizationCode server, complete OAuth.
5. Confirm status flips, last-refresh updates.
6. Click Disable on a server; assert tool calls fail with `auth_unavailable` from agents.
7. Click Enable; assert tools work again.

- [ ] **Step 3: Commit**

```bash
git add . && git commit --allow-empty -m "milestone: agents-mcp phase 3 complete (UI)"
```

---

## Phase 4 — Device-code flow

End state: `authorizationCode` mode with `flow: 'device'` works end-to-end. The catalog page surfaces the user code + verification URL while the flow is in progress.

### Task 29: Device authorization request (RFC 8628)

**Files:**
- Create: `packages/agents-mcp/src/auth/device-code.ts`
- Create: `packages/agents-mcp/test/auth/device-code.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it, vi } from 'vitest'
import { startDeviceFlow, pollDeviceFlow } from '../../src/auth/device-code'

describe('device flow', () => {
  it('startDeviceFlow returns user_code + verification_uri', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ device_code: 'd', user_code: 'ABCD-1234', verification_uri: 'http://x', interval: 5, expires_in: 600 }) })) as any
    const r = await startDeviceFlow({ deviceAuthorizationUrl: 'http://x/device', clientId: 'c', scopes: ['s'], fetch: f })
    expect(r.userCode).toBe('ABCD-1234')
    expect(r.deviceCode).toBe('d')
  })

  it('pollDeviceFlow handles authorization_pending and slow_down', async () => { /* … */ })
})
```

- [ ] **Step 2: Implement**

```ts
// src/auth/device-code.ts
import type { TokenSet } from './client-credentials'

export interface DeviceFlowStart { deviceCode: string; userCode: string; verificationUri: string; verificationUriComplete?: string; intervalSec: number; expiresAt: Date }

export async function startDeviceFlow(opts: {
  deviceAuthorizationUrl: string; clientId: string; scopes?: string[]; fetch?: typeof globalThis.fetch
}): Promise<DeviceFlowStart> {
  const f = opts.fetch ?? globalThis.fetch
  const body = new URLSearchParams({ client_id: opts.clientId, ...(opts.scopes ? { scope: opts.scopes.join(' ') } : {}) })
  const res = await f(opts.deviceAuthorizationUrl, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  if (!res.ok) throw new Error(`device authorization failed: ${res.status}`)
  const j = await res.json() as any
  return {
    deviceCode: j.device_code, userCode: j.user_code,
    verificationUri: j.verification_uri, verificationUriComplete: j.verification_uri_complete,
    intervalSec: j.interval ?? 5, expiresAt: new Date(Date.now() + (j.expires_in ?? 600) * 1000),
  }
}

export async function pollDeviceFlow(opts: {
  tokenUrl: string; clientId: string; deviceCode: string; intervalSec: number; expiresAt: Date; fetch?: typeof globalThis.fetch
}): Promise<TokenSet> {
  const f = opts.fetch ?? globalThis.fetch
  let interval = opts.intervalSec
  while (Date.now() < opts.expiresAt.getTime()) {
    await new Promise((r) => setTimeout(r, interval * 1000))
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: opts.deviceCode, client_id: opts.clientId,
    })
    const res = await f(opts.tokenUrl, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    const j = await res.json() as any
    if (res.ok) return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: new Date(Date.now() + (j.expires_in ?? 3600) * 1000), tokenType: j.token_type ?? 'Bearer' }
    if (j.error === 'authorization_pending') continue
    if (j.error === 'slow_down') { interval += 5; continue }
    throw new Error(`device flow error: ${j.error_description ?? j.error}`)
  }
  throw new Error('device flow timed out')
}
```

- [ ] **Step 3: Run, commit**

```bash
git add . && git commit -m "feat(agents-mcp): device-code flow"
```

### Task 30: Wire device flow into server + UI

**Files:**
- Modify: `packages/agents-server/src/oauth-routes.ts`
- Modify: `packages/agents-server-ui/src/components/connected-services/row.tsx`

- [ ] **Step 1: Add `POST /oauth/device/:server/start`**

```ts
router.post('/oauth/device/:server/start', async (req, res) => {
  const cfg = registry.get(req.params.server)?.config
  // … resolve clientId from vault, scopes from config
  const start = await startDeviceFlow({ deviceAuthorizationUrl, clientId, scopes })
  pollingMap.set(req.params.server, { ...start, status: 'pending' })
  pollDeviceFlow({ tokenUrl, clientId, deviceCode: start.deviceCode, intervalSec: start.intervalSec, expiresAt: start.expiresAt })
    .then((t) => { coordinator.setToken(req.params.server, undefined, t); pollingMap.set(req.params.server, { ...start, status: 'completed' }) })
    .catch((e) => pollingMap.set(req.params.server, { ...start, status: 'failed', error: String(e) }))
  res.json({ userCode: start.userCode, verificationUri: start.verificationUri, verificationUriComplete: start.verificationUriComplete })
})

router.get('/oauth/device/:server/status', (req, res) => res.json(pollingMap.get(req.params.server) ?? { status: 'idle' }))
```

- [ ] **Step 2: UI: when row's auth mode is device flow, show user code + verification URL**

```tsx
{row.authMode === 'authorizationCode' && row.flow === 'device' && row.deviceFlow && (
  <div>
    <p>Visit <a href={row.deviceFlow.verificationUri} target="_blank" rel="noreferrer">{row.deviceFlow.verificationUri}</a></p>
    <p>Enter code: <code>{row.deviceFlow.userCode}</code></p>
  </div>
)}
```

The Authorize button on a device-flow row calls the start endpoint, then polls `/oauth/device/:server/status` until completion.

- [ ] **Step 3: Manual end-to-end**

Configure a device-flow OAuth MCP server. Click Authorize. Visit verification URL, enter code, confirm. Watch status flip in the UI within `intervalSec`.

- [ ] **Step 4: Commit**

```bash
git add . && git commit -m "feat: device-code OAuth flow wired through server + UI"
```

### Task 31: Phase 4 verification

- [ ] **Step 1: Test suite green across all packages**

Run: `pnpm -C packages/agents-mcp test --run && pnpm -C packages/agents-server test --run && pnpm -C packages/agents-server-ui test --run`

- [ ] **Step 2: Test all four auth modes end-to-end**

apiKey, clientCredentials, authorizationCode (browser), authorizationCode (device).

- [ ] **Step 3: Commit + final milestone**

```bash
git add . && git commit --allow-empty -m "milestone: agents-mcp phase 4 complete — full v1 scope"
```

---

## Cross-cutting verification

Run after each phase, and again at the end:

- [ ] `pnpm install` clean
- [ ] `pnpm -r typecheck` clean
- [ ] `pnpm -r test --run` passes
- [ ] All four user stories from the spec smoke-tested manually:
  - **US-1 (Incident response)**: webhook spawns an agent that uses two MCP servers, produces a summary.
  - **US-2 (Coding agent)**: developer chats with Horton; agent uses GitHub MCP via `authorizationCode` flow.
  - **US-3 (Continuous knowledge)**: scheduled agent runs against multiple MCP sources, produces a digest.

## Open implementation choices

- **OS keychain library.** `keytar` is the de facto choice but has native deps. Alternative: write a sibling key file with `chmod 600`. For v1, default to the file-key fallback to avoid native dep complexity; document the option to layer keytar in.
- **Token cache persistence.** Phase 2's `TokenCache` is in-memory. Refresh tokens stored in the vault survive across runtime restarts; access tokens are re-derived from refresh tokens after restart. Acceptable for v1.
- **Resource Indicators (RFC 8707).** Already supported in `buildAuthorizationUrl` via the optional `resource` param. Operators set it in `mcp.json` if their auth server requires it; otherwise it's omitted.
