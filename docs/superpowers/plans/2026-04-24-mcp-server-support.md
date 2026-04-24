# MCP Server Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `@electric-ax/agents-mcp` package that lets Electric Agents entities use MCP servers as tool/resource providers, with OAuth auth, stdio + Streamable HTTP transports, connection pooling, and conversational config management via Horton.

**Architecture:** New package `packages/agents-mcp` bridges the official MCP TypeScript SDK into the existing `AgentTool` interface. An `McpClientPool` manages lazy connections with idle timeout. Config is stored in `.electric-agents/mcp.json` (project-scoped). The `agents` package wires MCP into Horton's tool set at bootstrap.

**Tech Stack:** `@modelcontextprotocol/sdk` (MCP client + transports + auth), `vitest` (testing), `tsdown` (build), `zod` (validation)

**Spec:** `docs/superpowers/specs/2026-04-24-mcp-server-support-design.md`

---

## File Map

### New package: `packages/agents-mcp/`

| File | Responsibility |
|------|---------------|
| `package.json` | Package metadata, dependencies, scripts |
| `tsconfig.json` | TypeScript config (Bundler module resolution, ES2022) |
| `tsdown.config.ts` | Build config (ESM + CJS, dts) |
| `vitest.config.ts` | Test config (v8 coverage, junit) |
| `src/index.ts` | Public exports |
| `src/types.ts` | `McpServerConfig`, `McpConfig`, `McpOverrides`, internal types |
| `src/config/env-expand.ts` | `${VAR}` and `${VAR:-default}` expansion in config values |
| `src/config/config-store.ts` | Read/write `.electric-agents/mcp.json`, auto-create `.gitignore` |
| `src/auth/token-store.ts` | Read/write `.electric-agents/mcp-auth.json` |
| `src/auth/oauth-provider.ts` | `OAuthClientProvider` implementation backed by token-store |
| `src/client.ts` | `McpClient` — wraps SDK Client, handles transport + auth setup |
| `src/pool.ts` | `McpClientPool` — lazy connect, idle timeout, reconnect backoff |
| `src/bridge/tool-bridge.ts` | MCP Tool -> `AgentTool` adapter with `mcp__` namespacing |
| `src/bridge/resource-bridge.ts` | `mcp__list_resources` and `mcp__read_resource` tools |
| `src/config/config-tools.ts` | Horton tools: `mcp__manage__add_server`, `remove`, `list_servers`, `list_tools` |
| `src/integration.ts` | `createMcpIntegration()` factory — main public API |
| `test/env-expand.test.ts` | Tests for env var expansion |
| `test/config-store.test.ts` | Tests for config read/write |
| `test/token-store.test.ts` | Tests for auth token persistence |
| `test/tool-bridge.test.ts` | Tests for MCP Tool -> AgentTool bridging |
| `test/resource-bridge.test.ts` | Tests for resource tools |
| `test/pool.test.ts` | Tests for connection pool lifecycle |
| `test/config-tools.test.ts` | Tests for config management tools |
| `test/integration.test.ts` | End-to-end integration test |

### Modified files in existing packages

| File | Change |
|------|--------|
| `packages/agents/package.json` | Add `@electric-ax/agents-mcp` dependency |
| `packages/agents/src/bootstrap.ts` | Wire MCP integration into runtime handler |
| `packages/agents/src/agents/horton.ts` | Accept + inject MCP tools, update system prompt |

---

## Task 1: Package Scaffolding

**Files:**
- Create: `packages/agents-mcp/package.json`
- Create: `packages/agents-mcp/tsconfig.json`
- Create: `packages/agents-mcp/tsdown.config.ts`
- Create: `packages/agents-mcp/vitest.config.ts`
- Create: `packages/agents-mcp/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@electric-ax/agents-mcp",
  "version": "0.0.1",
  "description": "MCP server integration for Electric Agents — tools, resources, OAuth auth",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsdown",
    "dev": "tsdown --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "coverage": "pnpm exec vitest --coverage",
    "typecheck": "tsc --noEmit",
    "stylecheck": "eslint . --quiet"
  },
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      },
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      }
    },
    "./package.json": "./package.json"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "zod": "^4.3.6"
  },
  "peerDependencies": {
    "@mariozechner/pi-agent-core": ">=0.57.0"
  },
  "peerDependenciesMeta": {
    "@mariozechner/pi-agent-core": {
      "optional": false
    }
  },
  "devDependencies": {
    "@mariozechner/pi-agent-core": "^0.57.1",
    "@vitest/coverage-v8": "^4.1.0",
    "tsdown": "^0.9.0",
    "typescript": "^5.7.0",
    "vitest": "^4.1.0"
  },
  "files": [
    "dist"
  ],
  "sideEffects": false,
  "license": "Apache-2.0"
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "isolatedDeclarations": false,
    "moduleResolution": "Bundler",
    "module": "ESNext",
    "target": "ES2022",
    "lib": ["ESNext"],
    "skipLibCheck": true,
    "noEmit": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "esModuleInterop": true,
    "outDir": "./dist",
    "baseUrl": "."
  },
  "include": ["src/**/*", "test/**/*", "*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create tsdown.config.ts**

```ts
import type { Options } from 'tsdown'

const config: Options = {
  entry: [`src/index.ts`],
  format: [`esm`, `cjs`],
  platform: `node`,
  dts: true,
  clean: true,
  external: [/^@modelcontextprotocol\//, /^@mariozechner\//],
}

export default config
```

- [ ] **Step 4: Create vitest.config.ts**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: `v8`,
      reporter: [`text`, `json`, `html`, `lcov`],
      include: [`src/**/*.{ts,tsx}`],
    },
    reporters: [`default`, `junit`],
    outputFile: `./junit/test-report.junit.xml`,
  },
})
```

- [ ] **Step 5: Create src/index.ts with placeholder export**

```ts
export {}
```

- [ ] **Step 6: Install dependencies and verify build**

Run: `cd packages/agents-mcp && pnpm install && pnpm build`
Expected: Build succeeds with empty output

- [ ] **Step 7: Commit**

```bash
git add packages/agents-mcp/
git commit -m "chore: scaffold @electric-ax/agents-mcp package"
```

---

## Task 2: Types

**Files:**
- Create: `packages/agents-mcp/src/types.ts`
- Modify: `packages/agents-mcp/src/index.ts`

- [ ] **Step 1: Create src/types.ts**

```ts
import type { AgentTool } from '@mariozechner/pi-agent-core'

// ── Config ──────────────────────────────────────────────────

export interface McpServerConfig {
  /** Stdio transport */
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string

  /** Streamable HTTP transport */
  url?: string

  /** Auth: OAuth flow, static token, or env var reference */
  auth?: `oauth` | { token: string } | { tokenEnvVar: string }
  /** Arbitrary static headers (values support ${VAR} expansion) */
  headers?: Record<string, string>

  /** OAuth specifics (only when auth is 'oauth') */
  oauth?: {
    clientId?: string
    scopes?: string[]
    callbackPort?: number
  }

  /** Toggle without removing config (default: true) */
  enabled?: boolean
  /** Connection timeout in ms (default: 10_000) */
  startupTimeoutMs?: number
  /** Per-tool-call timeout in ms (default: 60_000) */
  toolTimeoutMs?: number
  /** Idle time before disconnect in ms (default: 300_000) */
  idleTimeoutMs?: number
  /** Max chars in tool output before truncation (default: 25_000) */
  maxOutputChars?: number
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>
}

export type McpOverrides = Record<string, false | McpServerConfig>

// ── Defaults ────────────────────────────────────────────────

export const MCP_DEFAULTS = {
  startupTimeoutMs: 10_000,
  toolTimeoutMs: 60_000,
  idleTimeoutMs: 300_000,
  maxOutputChars: 25_000,
} as const

// ── Pool ────────────────────────────────────────────────────

export type McpServerStatus = `idle` | `connecting` | `connected` | `failed`

export interface McpServerState {
  name: string
  config: McpServerConfig
  status: McpServerStatus
  tools: Array<McpDiscoveredTool>
  resources: Array<McpDiscoveredResource>
  instructions?: string
  error?: string
  sessionId?: string
  protocolVersion?: string
}

export interface McpDiscoveredTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

export interface McpDiscoveredResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

// ── Integration ─────────────────────────────────────────────

export interface McpIntegration {
  /** Tools for managing MCP config (for Horton) */
  configTools: Array<AgentTool>
  /** Get all bridged MCP tools, applying overrides */
  getTools: (overrides?: McpOverrides) => Promise<Array<AgentTool>>
  /** Get server instructions for system prompt injection */
  getServerInstructions: () => Record<string, string>
  /** Get server summaries for system prompt */
  getServerSummary: () => Promise<string>
  /** Shut down all connections */
  close: () => Promise<void>
}
```

- [ ] **Step 2: Update src/index.ts to re-export types**

```ts
export type {
  McpServerConfig,
  McpConfig,
  McpOverrides,
  McpIntegration,
  McpServerStatus,
  McpServerState,
  McpDiscoveredTool,
  McpDiscoveredResource,
} from './types'

export { MCP_DEFAULTS } from './types'
```

- [ ] **Step 3: Run typecheck**

Run: `cd packages/agents-mcp && pnpm typecheck`
Expected: PASS, no errors

- [ ] **Step 4: Commit**

```bash
git add packages/agents-mcp/src/
git commit -m "feat(agents-mcp): add config and integration types"
```

---

## Task 3: Environment Variable Expansion

**Files:**
- Create: `packages/agents-mcp/src/config/env-expand.ts`
- Create: `packages/agents-mcp/test/env-expand.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { expandEnvVars } from '../src/config/env-expand'

describe(`expandEnvVars`, () => {
  it(`expands ${`\${VAR}`} with env value`, () => {
    const result = expandEnvVars(`hello \${MY_VAR} world`, { MY_VAR: `test` })
    expect(result).toBe(`hello test world`)
  })

  it(`expands ${`\${VAR:-default}`} to default when var missing`, () => {
    const result = expandEnvVars(`\${MISSING:-fallback}`, {})
    expect(result).toBe(`fallback`)
  })

  it(`expands ${`\${VAR:-default}`} to var value when present`, () => {
    const result = expandEnvVars(`\${MY_VAR:-fallback}`, { MY_VAR: `actual` })
    expect(result).toBe(`actual`)
  })

  it(`throws when required var is missing (no default)`, () => {
    expect(() => expandEnvVars(`\${REQUIRED_VAR}`, {})).toThrow(
      /REQUIRED_VAR/
    )
  })

  it(`handles multiple expansions in one string`, () => {
    const result = expandEnvVars(`\${A}-\${B}`, { A: `1`, B: `2` })
    expect(result).toBe(`1-2`)
  })

  it(`returns strings without variables unchanged`, () => {
    expect(expandEnvVars(`plain text`, {})).toBe(`plain text`)
  })

  it(`expands empty string default`, () => {
    const result = expandEnvVars(`\${X:-}`, {})
    expect(result).toBe(``)
  })
})

describe(`expandConfigValues`, () => {
  const { expandConfigValues } = await import(`../src/config/env-expand`)

  it(`recursively expands env vars in an object`, () => {
    const config = {
      command: `npx`,
      env: { TOKEN: `\${GH_TOKEN}` },
      url: `https://\${HOST:-localhost}:3000`,
    }
    const result = expandConfigValues(config, { GH_TOKEN: `abc` })
    expect(result).toEqual({
      command: `npx`,
      env: { TOKEN: `abc` },
      url: `https://localhost:3000`,
    })
  })

  it(`does not expand non-string values`, () => {
    const config = { enabled: true, timeout: 5000 }
    expect(expandConfigValues(config, {})).toEqual(config)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents-mcp && pnpm test -- test/env-expand.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement env-expand.ts**

```ts
export function expandEnvVars(
  template: string,
  env: Record<string, string | undefined>
): string {
  return template.replace(
    /\$\{([^}:]+?)(?::-(.*?))?\}/g,
    (_match, name: string, defaultValue?: string) => {
      const value = env[name]
      if (value !== undefined) return value
      if (defaultValue !== undefined) return defaultValue
      throw new Error(
        `Environment variable \${${name}} is required but not set`
      )
    }
  )
}

export function expandConfigValues<T>(
  obj: T,
  env: Record<string, string | undefined>
): T {
  if (typeof obj === `string`) {
    return expandEnvVars(obj, env) as T
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => expandConfigValues(item, env)) as T
  }
  if (obj !== null && typeof obj === `object`) {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandConfigValues(value, env)
    }
    return result as T
  }
  return obj
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents-mcp && pnpm test -- test/env-expand.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/config/env-expand.ts packages/agents-mcp/test/env-expand.test.ts
git commit -m "feat(agents-mcp): add env var expansion for config values"
```

---

## Task 4: Config Store

**Files:**
- Create: `packages/agents-mcp/src/config/config-store.ts`
- Create: `packages/agents-mcp/test/config-store.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigStore } from '../src/config/config-store'

describe(`ConfigStore`, () => {
  let workDir: string
  let store: ConfigStore

  beforeEach(() => {
    workDir = join(tmpdir(), `agents-mcp-test-${randomUUID()}`)
    mkdirSync(workDir, { recursive: true })
    store = new ConfigStore(workDir)
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it(`returns empty config when no file exists`, () => {
    const config = store.load()
    expect(config.servers).toEqual({})
  })

  it(`reads config from .electric-agents/mcp.json`, () => {
    const dir = join(workDir, `.electric-agents`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, `mcp.json`),
      JSON.stringify({
        servers: {
          github: { command: `npx`, args: [`-y`, `@mcp/server-github`] },
        },
      })
    )
    const config = store.load()
    expect(config.servers.github).toBeDefined()
    expect(config.servers.github!.command).toBe(`npx`)
  })

  it(`saves config and creates .gitignore`, () => {
    store.save({
      servers: { test: { command: `echo`, args: [`hi`] } },
    })
    const dir = join(workDir, `.electric-agents`)
    expect(existsSync(join(dir, `mcp.json`))).toBe(true)
    const gitignore = readFileSync(join(dir, `.gitignore`), `utf-8`)
    expect(gitignore).toContain(`mcp-auth.json`)
  })

  it(`adds a server to existing config`, () => {
    store.save({ servers: { a: { command: `a` } } })
    store.addServer(`b`, { command: `b` })
    const config = store.load()
    expect(Object.keys(config.servers)).toEqual([`a`, `b`])
  })

  it(`removes a server from config`, () => {
    store.save({ servers: { a: { command: `a` }, b: { command: `b` } } })
    store.removeServer(`a`)
    const config = store.load()
    expect(Object.keys(config.servers)).toEqual([`b`])
  })

  it(`expands env vars when loading`, () => {
    const dir = join(workDir, `.electric-agents`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, `mcp.json`),
      JSON.stringify({
        servers: { s: { command: `echo`, env: { TOKEN: `\${TEST_TOKEN}` } } },
      })
    )
    process.env.TEST_TOKEN = `secret123`
    const config = store.load({ expandEnv: true })
    expect(config.servers.s!.env!.TOKEN).toBe(`secret123`)
    delete process.env.TEST_TOKEN
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents-mcp && pnpm test -- test/config-store.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement config-store.ts**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expandConfigValues } from './env-expand'
import type { McpConfig, McpServerConfig } from '../types'

const CONFIG_DIR = `.electric-agents`
const CONFIG_FILE = `mcp.json`
const GITIGNORE_FILE = `.gitignore`
const GITIGNORE_CONTENT = `mcp-auth.json\n`

const EMPTY_CONFIG: McpConfig = { servers: {} }

export class ConfigStore {
  private readonly configDir: string
  private readonly configPath: string

  constructor(private readonly workingDirectory: string) {
    this.configDir = join(workingDirectory, CONFIG_DIR)
    this.configPath = join(this.configDir, CONFIG_FILE)
  }

  load(opts?: { expandEnv?: boolean }): McpConfig {
    if (!existsSync(this.configPath)) return { ...EMPTY_CONFIG }

    const raw = readFileSync(this.configPath, `utf-8`)
    const parsed = JSON.parse(raw) as McpConfig

    if (!parsed.servers) return { ...EMPTY_CONFIG }

    if (opts?.expandEnv) {
      return expandConfigValues(parsed, process.env as Record<string, string>)
    }
    return parsed
  }

  save(config: McpConfig): void {
    mkdirSync(this.configDir, { recursive: true })
    writeFileSync(this.configPath, JSON.stringify(config, null, 2) + `\n`)
    this.ensureGitignore()
  }

  addServer(name: string, serverConfig: McpServerConfig): void {
    const config = this.load()
    config.servers[name] = serverConfig
    this.save(config)
  }

  removeServer(name: string): boolean {
    const config = this.load()
    if (!(name in config.servers)) return false
    delete config.servers[name]
    this.save(config)
    return true
  }

  private ensureGitignore(): void {
    const gitignorePath = join(this.configDir, GITIGNORE_FILE)
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, `utf-8`)
      if (!content.includes(`mcp-auth.json`)) {
        writeFileSync(gitignorePath, content + GITIGNORE_CONTENT)
      }
      return
    }
    writeFileSync(gitignorePath, GITIGNORE_CONTENT)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents-mcp && pnpm test -- test/config-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/config/config-store.ts packages/agents-mcp/test/config-store.test.ts
git commit -m "feat(agents-mcp): add config store for .electric-agents/mcp.json"
```

---

## Task 5: Token Store

**Files:**
- Create: `packages/agents-mcp/src/auth/token-store.ts`
- Create: `packages/agents-mcp/test/token-store.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TokenStore } from '../src/auth/token-store'

describe(`TokenStore`, () => {
  let workDir: string
  let store: TokenStore

  beforeEach(() => {
    workDir = join(tmpdir(), `agents-mcp-token-${randomUUID()}`)
    mkdirSync(workDir, { recursive: true })
    store = new TokenStore(workDir)
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it(`returns undefined when no tokens exist`, () => {
    expect(store.getTokens(`honeycomb`)).toBeUndefined()
  })

  it(`saves and reads tokens`, () => {
    const tokens = {
      access_token: `abc`,
      refresh_token: `def`,
      expires_at: 9999999999,
      token_type: `Bearer` as const,
    }
    store.saveTokens(`honeycomb`, tokens)
    const loaded = store.getTokens(`honeycomb`)
    expect(loaded).toEqual(tokens)
  })

  it(`stores tokens for multiple servers independently`, () => {
    store.saveTokens(`a`, { access_token: `1`, token_type: `Bearer` as const })
    store.saveTokens(`b`, { access_token: `2`, token_type: `Bearer` as const })
    expect(store.getTokens(`a`)!.access_token).toBe(`1`)
    expect(store.getTokens(`b`)!.access_token).toBe(`2`)
  })

  it(`removes tokens for a server`, () => {
    store.saveTokens(`x`, { access_token: `t`, token_type: `Bearer` as const })
    store.removeTokens(`x`)
    expect(store.getTokens(`x`)).toBeUndefined()
  })

  it(`saves and reads code verifier`, () => {
    store.saveCodeVerifier(`honeycomb`, `verifier123`)
    expect(store.getCodeVerifier(`honeycomb`)).toBe(`verifier123`)
  })

  it(`saves and reads client info`, () => {
    const info = { client_id: `cid`, client_secret: `csec` }
    store.saveClientInfo(`honeycomb`, info)
    expect(store.getClientInfo(`honeycomb`)).toEqual(info)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents-mcp && pnpm test -- test/token-store.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement token-store.ts**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CONFIG_DIR = `.electric-agents`
const AUTH_FILE = `mcp-auth.json`

export interface StoredTokens {
  access_token: string
  refresh_token?: string
  expires_at?: number
  token_type: `Bearer`
}

interface AuthData {
  tokens?: Record<string, StoredTokens>
  verifiers?: Record<string, string>
  clients?: Record<string, Record<string, unknown>>
}

export class TokenStore {
  private readonly authPath: string
  private readonly configDir: string

  constructor(workingDirectory: string) {
    this.configDir = join(workingDirectory, CONFIG_DIR)
    this.authPath = join(this.configDir, AUTH_FILE)
  }

  getTokens(serverName: string): StoredTokens | undefined {
    return this.readAll().tokens?.[serverName]
  }

  saveTokens(serverName: string, tokens: StoredTokens): void {
    const data = this.readAll()
    data.tokens ??= {}
    data.tokens[serverName] = tokens
    this.writeAll(data)
  }

  removeTokens(serverName: string): void {
    const data = this.readAll()
    if (data.tokens) {
      delete data.tokens[serverName]
      this.writeAll(data)
    }
  }

  getCodeVerifier(serverName: string): string | undefined {
    return this.readAll().verifiers?.[serverName]
  }

  saveCodeVerifier(serverName: string, verifier: string): void {
    const data = this.readAll()
    data.verifiers ??= {}
    data.verifiers[serverName] = verifier
    this.writeAll(data)
  }

  getClientInfo(serverName: string): Record<string, unknown> | undefined {
    return this.readAll().clients?.[serverName]
  }

  saveClientInfo(serverName: string, info: Record<string, unknown>): void {
    const data = this.readAll()
    data.clients ??= {}
    data.clients[serverName] = info
    this.writeAll(data)
  }

  private readAll(): AuthData {
    if (!existsSync(this.authPath)) return {}
    return JSON.parse(readFileSync(this.authPath, `utf-8`)) as AuthData
  }

  private writeAll(data: AuthData): void {
    mkdirSync(this.configDir, { recursive: true })
    writeFileSync(this.authPath, JSON.stringify(data, null, 2) + `\n`)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents-mcp && pnpm test -- test/token-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/auth/token-store.ts packages/agents-mcp/test/token-store.test.ts
git commit -m "feat(agents-mcp): add token store for OAuth token persistence"
```

---

## Task 6: OAuth Provider

**Files:**
- Create: `packages/agents-mcp/src/auth/oauth-provider.ts`

- [ ] **Step 1: Implement OAuthClientProvider backed by TokenStore**

This implements the MCP SDK's `OAuthClientProvider` interface. It delegates token persistence to `TokenStore` and starts a temporary local HTTP server for the OAuth redirect.

```ts
import http from 'node:http'
import type { OAuthClientProvider, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/client/auth.js'
import type { TokenStore } from './token-store'
import type { McpServerConfig } from '../types'

export class ElectricOAuthProvider implements OAuthClientProvider {
  private verifier = ``
  private authResolve?: (code: string) => void

  constructor(
    private readonly serverName: string,
    private readonly serverConfig: McpServerConfig,
    private readonly tokenStore: TokenStore,
    private readonly onAuthUrl?: (url: string) => void
  ) {}

  get redirectUrl(): string {
    const port = this.serverConfig.oauth?.callbackPort ?? 0
    return `http://127.0.0.1:${port}/oauth/callback`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: `Electric Agents MCP Client`,
      redirect_uris: [this.redirectUrl],
      grant_types: [`authorization_code`, `refresh_token`],
      response_types: [`code`],
      scope: this.serverConfig.oauth?.scopes?.join(` `),
    }
  }

  clientInformation(): Record<string, unknown> | undefined {
    const stored = this.tokenStore.getClientInfo(this.serverName)
    if (stored) return stored
    if (this.serverConfig.oauth?.clientId) {
      return { client_id: this.serverConfig.oauth.clientId }
    }
    return undefined
  }

  saveClientInformation(info: Record<string, unknown>): void {
    this.tokenStore.saveClientInfo(this.serverName, info)
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const stored = this.tokenStore.getTokens(this.serverName)
    if (!stored) return undefined
    return {
      access_token: stored.access_token,
      refresh_token: stored.refresh_token,
      token_type: stored.token_type,
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    this.tokenStore.saveTokens(this.serverName, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: `Bearer`,
    })
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    this.verifier = verifier
    this.tokenStore.saveCodeVerifier(this.serverName, verifier)
  }

  async codeVerifier(): Promise<string> {
    return this.verifier || this.tokenStore.getCodeVerifier(this.serverName) || ``
  }

  async redirectToAuthorization(authUrl: URL): Promise<void> {
    const urlString = authUrl.toString()

    if (this.onAuthUrl) {
      this.onAuthUrl(urlString)
    } else {
      console.log(`\n[mcp] Authorize ${this.serverName}: ${urlString}\n`)
    }

    const port = this.serverConfig.oauth?.callbackPort ?? 0
    await this.startCallbackServer(port)
  }

  private startCallbackServer(port: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? `/`, `http://127.0.0.1`)
        const code = url.searchParams.get(`code`)
        if (code) {
          res.writeHead(200, { 'content-type': `text/html` })
          res.end(`<h1>Authorization successful</h1><p>You can close this tab.</p>`)
          server.close()
          resolve(code)
        } else {
          res.writeHead(400)
          res.end(`Missing code parameter`)
        }
      })

      server.listen(port, `127.0.0.1`, () => {
        const addr = server.address()
        if (addr && typeof addr === `object`) {
          // Update redirect URL if port was 0 (random)
        }
      })

      server.on(`error`, reject)
      setTimeout(() => {
        server.close()
        reject(new Error(`OAuth callback timed out after 5 minutes`))
      }, 300_000)
    })
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/agents-mcp && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/agents-mcp/src/auth/oauth-provider.ts
git commit -m "feat(agents-mcp): add OAuthClientProvider implementation"
```

---

## Task 7: MCP Client

**Files:**
- Create: `packages/agents-mcp/src/client.ts`

- [ ] **Step 1: Implement McpClient**

This wraps the MCP SDK `Client` with transport-aware construction, auth injection, and session state tracking.

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Tool, Resource } from '@modelcontextprotocol/sdk/types.js'
import { ElectricOAuthProvider } from './auth/oauth-provider'
import type { TokenStore } from './auth/token-store'
import type { McpServerConfig, McpDiscoveredTool, McpDiscoveredResource } from './types'
import { MCP_DEFAULTS } from './types'
import { expandEnvVars } from './config/env-expand'

export interface McpClientOptions {
  serverName: string
  config: McpServerConfig
  tokenStore: TokenStore
  workingDirectory: string
  onAuthUrl?: (url: string) => void
  onToolsChanged?: (tools: McpDiscoveredTool[]) => void
  onResourcesChanged?: (resources: McpDiscoveredResource[]) => void
}

export class McpClient {
  private client: Client
  private transport: Transport | null = null

  readonly serverName: string
  private readonly config: McpServerConfig
  private readonly tokenStore: TokenStore
  private readonly workingDirectory: string
  private readonly opts: McpClientOptions

  tools: McpDiscoveredTool[] = []
  resources: McpDiscoveredResource[] = []
  instructions?: string
  sessionId?: string
  protocolVersion?: string

  constructor(opts: McpClientOptions) {
    this.serverName = opts.serverName
    this.config = opts.config
    this.tokenStore = opts.tokenStore
    this.workingDirectory = opts.workingDirectory
    this.opts = opts

    this.client = new Client(
      { name: `electric-agents`, version: `0.1.0` },
      {
        capabilities: { roots: { listChanged: false } },
        listChanged: {
          tools: {
            onChanged: (_err, tools) => {
              if (tools) {
                this.tools = tools.map(mapTool)
                opts.onToolsChanged?.(this.tools)
              }
            },
          },
          resources: {
            onChanged: (_err, resources) => {
              if (resources) {
                this.resources = resources.map(mapResource)
                opts.onResourcesChanged?.(this.resources)
              }
            },
          },
        },
      }
    )
  }

  async connect(signal?: AbortSignal): Promise<void> {
    this.transport = this.createTransport()

    await this.client.connect(this.transport, {
      timeout: this.config.startupTimeoutMs ?? MCP_DEFAULTS.startupTimeoutMs,
      signal,
    })

    this.instructions = this.client.getInstructions() ?? undefined
    this.sessionId = this.transport.sessionId
    this.protocolVersion = this.client.getNegotiatedProtocolVersion() ?? undefined

    await this.discover()
  }

  async discover(): Promise<void> {
    const caps = this.client.getServerCapabilities()

    if (caps?.tools) {
      const result = await this.client.listTools()
      this.tools = result.tools.map(mapTool)
    }

    if (caps?.resources) {
      const result = await this.client.listResources()
      this.resources = result.resources.map(mapResource)
    }
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    opts?: { timeout?: number; signal?: AbortSignal }
  ): Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean }> {
    const result = await this.client.callTool(
      { name, arguments: args },
      undefined,
      {
        timeout: opts?.timeout ?? this.config.toolTimeoutMs ?? MCP_DEFAULTS.toolTimeoutMs,
        signal: opts?.signal,
      }
    )
    return {
      content: (result.content ?? []) as Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
      isError: result.isError as boolean | undefined,
    }
  }

  async listResources(): Promise<McpDiscoveredResource[]> {
    const result = await this.client.listResources()
    return result.resources.map(mapResource)
  }

  async readResource(uri: string): Promise<Array<{ type: string; text?: string; blob?: string; mimeType?: string }>> {
    const result = await this.client.readResource({ uri })
    return (result.contents ?? []) as Array<{ type: string; text?: string; blob?: string; mimeType?: string }>
  }

  async close(): Promise<void> {
    await this.client.close()
    this.transport = null
  }

  private createTransport(): Transport {
    const config = this.config

    if (config.command) {
      const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        HOME: this.workingDirectory,
      }
      if (config.env) {
        for (const [k, v] of Object.entries(config.env)) {
          env[k] = v
        }
      }
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env,
        cwd: config.cwd ?? this.workingDirectory,
      })
    }

    if (config.url) {
      const url = new URL(config.url)
      const transportOpts: Record<string, unknown> = {}

      if (config.auth === `oauth`) {
        const provider = new ElectricOAuthProvider(
          this.serverName,
          config,
          this.tokenStore,
          this.opts.onAuthUrl
        )
        transportOpts.authProvider = provider
      } else if (config.auth && typeof config.auth === `object`) {
        let token: string
        if (`token` in config.auth) {
          token = config.auth.token
        } else {
          const envVar = config.auth.tokenEnvVar
          token = process.env[envVar] ?? ``
          if (!token) {
            throw new Error(
              `Environment variable ${envVar} is required for MCP server "${this.serverName}" but not set`
            )
          }
        }
        transportOpts.requestInit = {
          headers: {
            Authorization: `Bearer ${token}`,
            ...config.headers,
          },
        }
      } else if (config.headers) {
        transportOpts.requestInit = { headers: config.headers }
      }

      if (this.sessionId) {
        transportOpts.sessionId = this.sessionId
      }

      return new StreamableHTTPClientTransport(url, transportOpts as any)
    }

    throw new Error(
      `MCP server "${this.serverName}" must have either "command" (stdio) or "url" (Streamable HTTP)`
    )
  }
}

function mapTool(tool: Tool): McpDiscoveredTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as Record<string, unknown>,
  }
}

function mapResource(resource: Resource): McpDiscoveredResource {
  return {
    uri: resource.uri,
    name: resource.name,
    description: resource.description,
    mimeType: resource.mimeType,
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd packages/agents-mcp && pnpm typecheck`
Expected: PASS (may need to adjust SDK import paths based on actual package exports)

- [ ] **Step 3: Commit**

```bash
git add packages/agents-mcp/src/client.ts
git commit -m "feat(agents-mcp): add McpClient with transport + auth setup"
```

---

## Task 8: Connection Pool

**Files:**
- Create: `packages/agents-mcp/src/pool.ts`
- Create: `packages/agents-mcp/test/pool.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock(`../src/client`, () => ({
  McpClient: vi.fn().mockImplementation((opts: any) => ({
    serverName: opts.serverName,
    tools: [],
    resources: [],
    instructions: undefined,
    connect: vi.fn().mockResolvedValue(undefined),
    discover: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

import { McpClientPool } from '../src/pool'
import type { McpConfig } from '../src/types'

describe(`McpClientPool`, () => {
  const config: McpConfig = {
    servers: {
      test: { command: `echo`, args: [`hello`], enabled: true },
      disabled: { command: `echo`, enabled: false },
    },
  }

  let pool: McpClientPool

  beforeEach(() => {
    pool = new McpClientPool(config, { workingDirectory: `/tmp` })
  })

  it(`creates a client on first acquire`, async () => {
    const client = await pool.acquire(`test`)
    expect(client).toBeDefined()
    expect(client.serverName).toBe(`test`)
  })

  it(`returns the same client on second acquire`, async () => {
    const first = await pool.acquire(`test`)
    const second = await pool.acquire(`test`)
    expect(first).toBe(second)
  })

  it(`throws for unknown server`, async () => {
    await expect(pool.acquire(`unknown`)).rejects.toThrow(/unknown/)
  })

  it(`throws for disabled server`, async () => {
    await expect(pool.acquire(`disabled`)).rejects.toThrow(/disabled/)
  })

  it(`getServerStatus returns idle for unconnected, connected after acquire`, async () => {
    expect(pool.getServerStatus(`test`)).toBe(`idle`)
    await pool.acquire(`test`)
    expect(pool.getServerStatus(`test`)).toBe(`connected`)
  })

  it(`close disconnects all clients`, async () => {
    await pool.acquire(`test`)
    await pool.close()
    expect(pool.getServerStatus(`test`)).toBe(`idle`)
  })

  it(`getEnabledServers excludes disabled servers`, () => {
    const enabled = pool.getEnabledServers()
    expect(enabled.map((s) => s.name)).toEqual([`test`])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents-mcp && pnpm test -- test/pool.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement pool.ts**

```ts
import { McpClient } from './client'
import { TokenStore } from './auth/token-store'
import type {
  McpConfig,
  McpServerConfig,
  McpServerStatus,
  McpServerState,
  McpDiscoveredTool,
  McpDiscoveredResource,
  McpOverrides,
  MCP_DEFAULTS,
} from './types'
import { MCP_DEFAULTS as DEFAULTS } from './types'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { bridgeMcpTools } from './bridge/tool-bridge'
import { createResourceTools } from './bridge/resource-bridge'

interface PoolEntry {
  name: string
  config: McpServerConfig
  client: McpClient | null
  status: McpServerStatus
  idleTimer: ReturnType<typeof setTimeout> | null
  connectAttempts: number
  lastError?: string
}

export class McpClientPool {
  private entries = new Map<string, PoolEntry>()
  private readonly tokenStore: TokenStore
  private readonly workingDirectory: string
  private onAuthUrl?: (serverName: string, url: string) => void

  constructor(
    config: McpConfig,
    opts: {
      workingDirectory: string
      onAuthUrl?: (serverName: string, url: string) => void
    }
  ) {
    this.workingDirectory = opts.workingDirectory
    this.tokenStore = new TokenStore(opts.workingDirectory)
    this.onAuthUrl = opts.onAuthUrl

    for (const [name, serverConfig] of Object.entries(config.servers)) {
      this.entries.set(name, {
        name,
        config: serverConfig,
        client: null,
        status: `idle`,
        idleTimer: null,
        connectAttempts: 0,
      })
    }
  }

  async acquire(serverName: string): Promise<McpClient> {
    const entry = this.entries.get(serverName)
    if (!entry) {
      throw new Error(`MCP server "${serverName}" is not configured`)
    }
    if (entry.config.enabled === false) {
      throw new Error(`MCP server "${serverName}" is disabled`)
    }

    if (entry.client && entry.status === `connected`) {
      this.clearIdleTimer(entry)
      return entry.client
    }

    return this.connect(entry)
  }

  release(serverName: string): void {
    const entry = this.entries.get(serverName)
    if (!entry || !entry.client) return
    this.startIdleTimer(entry)
  }

  getServerStatus(serverName: string): McpServerStatus {
    return this.entries.get(serverName)?.status ?? `idle`
  }

  getEnabledServers(): Array<{ name: string; config: McpServerConfig }> {
    return Array.from(this.entries.values())
      .filter((e) => e.config.enabled !== false)
      .map((e) => ({ name: e.name, config: e.config }))
  }

  getServerStates(): McpServerState[] {
    return Array.from(this.entries.values()).map((e) => ({
      name: e.name,
      config: e.config,
      status: e.status,
      tools: e.client?.tools ?? [],
      resources: e.client?.resources ?? [],
      instructions: e.client?.instructions,
      error: e.lastError,
      sessionId: e.client?.sessionId,
      protocolVersion: e.client?.protocolVersion,
    }))
  }

  getInstructions(): Record<string, string> {
    const result: Record<string, string> = {}
    for (const entry of this.entries.values()) {
      if (entry.client?.instructions) {
        result[entry.name] = entry.client.instructions
      }
    }
    return result
  }

  async getTools(overrides?: McpOverrides): Promise<AgentTool[]> {
    const allTools: AgentTool[] = []

    // Connect enabled servers that have overrides or are globally enabled
    const serverNames = this.getEffectiveServers(overrides)

    for (const name of serverNames) {
      try {
        const client = await this.acquire(name)
        const config = this.entries.get(name)!.config
        allTools.push(...bridgeMcpTools(name, client.tools, this, config))
        this.release(name)
      } catch {
        // Server unavailable — skip its tools
      }
    }

    allTools.push(...createResourceTools(this))
    return allTools
  }

  async close(): Promise<void> {
    const closeOps = Array.from(this.entries.values()).map(async (entry) => {
      this.clearIdleTimer(entry)
      if (entry.client) {
        await entry.client.close().catch(() => {})
        entry.client = null
        entry.status = `idle`
      }
    })
    await Promise.all(closeOps)
  }

  addServer(name: string, config: McpServerConfig): void {
    this.entries.set(name, {
      name,
      config,
      client: null,
      status: `idle`,
      idleTimer: null,
      connectAttempts: 0,
    })
  }

  async removeServer(name: string): Promise<void> {
    const entry = this.entries.get(name)
    if (!entry) return
    this.clearIdleTimer(entry)
    if (entry.client) {
      await entry.client.close().catch(() => {})
    }
    this.entries.delete(name)
  }

  private getEffectiveServers(overrides?: McpOverrides): string[] {
    const result = new Set<string>()

    for (const [name, entry] of this.entries) {
      if (overrides && name in overrides) {
        if (overrides[name] === false) continue
      }
      if (entry.config.enabled !== false) {
        result.add(name)
      }
    }

    if (overrides) {
      for (const [name, override] of Object.entries(overrides)) {
        if (override === false) continue
        if (!this.entries.has(name)) {
          this.addServer(name, override)
        }
        result.add(name)
      }
    }

    return Array.from(result)
  }

  private async connect(entry: PoolEntry): Promise<McpClient> {
    entry.status = `connecting`
    entry.connectAttempts++

    const client = new McpClient({
      serverName: entry.name,
      config: entry.config,
      tokenStore: this.tokenStore,
      workingDirectory: this.workingDirectory,
      onAuthUrl: this.onAuthUrl
        ? (url) => this.onAuthUrl!(entry.name, url)
        : undefined,
      onToolsChanged: () => {},
      onResourcesChanged: () => {},
    })

    const timeoutMs = entry.config.startupTimeoutMs ?? DEFAULTS.startupTimeoutMs
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      await client.connect(controller.signal)
      entry.client = client
      entry.status = `connected`
      entry.connectAttempts = 0
      entry.lastError = undefined
      return client
    } catch (err) {
      entry.status = `failed`
      entry.lastError = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  private startIdleTimer(entry: PoolEntry): void {
    this.clearIdleTimer(entry)
    const timeout = entry.config.idleTimeoutMs ?? DEFAULTS.idleTimeoutMs
    entry.idleTimer = setTimeout(async () => {
      if (entry.client) {
        await entry.client.close().catch(() => {})
        entry.client = null
        entry.status = `idle`
      }
    }, timeout)
  }

  private clearIdleTimer(entry: PoolEntry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = null
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents-mcp && pnpm test -- test/pool.test.ts`
Expected: PASS (the test mocks McpClient, so no real connections)

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/pool.ts packages/agents-mcp/test/pool.test.ts
git commit -m "feat(agents-mcp): add McpClientPool with lazy connect + idle timeout"
```

---

## Task 9: Tool Bridge

**Files:**
- Create: `packages/agents-mcp/src/bridge/tool-bridge.ts`
- Create: `packages/agents-mcp/test/tool-bridge.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it, vi } from 'vitest'
import { bridgeMcpTools, truncateOutput } from '../src/bridge/tool-bridge'
import type { McpDiscoveredTool } from '../src/types'

describe(`bridgeMcpTools`, () => {
  const mockPool = {
    acquire: vi.fn().mockResolvedValue({
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: `text`, text: `result` }],
        isError: false,
      }),
    }),
    release: vi.fn(),
  }

  const tools: McpDiscoveredTool[] = [
    {
      name: `create_issue`,
      description: `Create a GitHub issue`,
      inputSchema: {
        type: `object`,
        properties: { title: { type: `string` } },
      },
    },
  ]

  it(`creates AgentTools with mcp__ prefix`, () => {
    const bridged = bridgeMcpTools(`github`, tools, mockPool as any, {})
    expect(bridged).toHaveLength(1)
    expect(bridged[0]!.name).toBe(`mcp__github__create_issue`)
    expect(bridged[0]!.label).toBe(`create_issue`)
    expect(bridged[0]!.description).toBe(`Create a GitHub issue`)
  })

  it(`calls the correct MCP tool name (without prefix)`, async () => {
    const bridged = bridgeMcpTools(`github`, tools, mockPool as any, {})
    await bridged[0]!.execute(`call-1`, { title: `Bug` })

    const client = await mockPool.acquire.mock.results[0]!.value
    expect(client.callTool).toHaveBeenCalledWith(
      `create_issue`,
      { title: `Bug` },
      expect.objectContaining({ timeout: 60_000 })
    )
    expect(mockPool.release).toHaveBeenCalledWith(`github`)
  })

  it(`releases pool even on error`, async () => {
    const failPool = {
      acquire: vi.fn().mockResolvedValue({
        callTool: vi.fn().mockRejectedValue(new Error(`fail`)),
      }),
      release: vi.fn(),
    }
    const bridged = bridgeMcpTools(`s`, tools, failPool as any, {})
    await expect(bridged[0]!.execute(`c`, {})).rejects.toThrow(`fail`)
    expect(failPool.release).toHaveBeenCalledWith(`s`)
  })
})

describe(`truncateOutput`, () => {
  it(`returns content unchanged when under limit`, () => {
    const result = truncateOutput(
      { content: [{ type: `text`, text: `short` }], details: {} },
      100
    )
    expect((result.content[0] as any).text).toBe(`short`)
  })

  it(`truncates text content exceeding limit`, () => {
    const longText = `x`.repeat(200)
    const result = truncateOutput(
      { content: [{ type: `text`, text: longText }], details: {} },
      100
    )
    const text = (result.content[0] as any).text as string
    expect(text.length).toBeLessThan(200)
    expect(text).toContain(`[Output truncated`)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents-mcp && pnpm test -- test/tool-bridge.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement tool-bridge.ts**

```ts
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { McpClientPool } from '../pool'
import type { McpDiscoveredTool, McpServerConfig } from '../types'
import { MCP_DEFAULTS } from '../types'

export function bridgeMcpTools(
  serverName: string,
  tools: McpDiscoveredTool[],
  pool: McpClientPool,
  config: McpServerConfig
): AgentTool[] {
  return tools.map((mcpTool) => bridgeSingleTool(serverName, mcpTool, pool, config))
}

function bridgeSingleTool(
  serverName: string,
  mcpTool: McpDiscoveredTool,
  pool: McpClientPool,
  config: McpServerConfig
): AgentTool {
  const maxOutput = config.maxOutputChars ?? MCP_DEFAULTS.maxOutputChars
  const toolTimeout = config.toolTimeoutMs ?? MCP_DEFAULTS.toolTimeoutMs

  return {
    name: `mcp__${serverName}__${mcpTool.name}`,
    label: mcpTool.name,
    description: mcpTool.description ?? ``,
    parameters: mcpTool.inputSchema as AgentTool[`parameters`],
    execute: async (_toolCallId, params) => {
      const client = await pool.acquire(serverName)
      try {
        const result = await client.callTool(
          mcpTool.name,
          params as Record<string, unknown>,
          { timeout: toolTimeout }
        )
        const output = formatMcpResult(result)
        return truncateOutput(output, maxOutput)
      } finally {
        pool.release(serverName)
      }
    },
  }
}

function formatMcpResult(result: {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
  isError?: boolean
}): { content: Array<{ type: string; text: string }>; details: Record<string, unknown> } {
  const content = result.content.map((block) => {
    if (block.type === `text` && block.text !== undefined) {
      return { type: `text` as const, text: block.text }
    }
    if (block.type === `image`) {
      return { type: `text` as const, text: `[Image: ${block.mimeType ?? `unknown`}]` }
    }
    return { type: `text` as const, text: JSON.stringify(block) }
  })

  return {
    content: content.length > 0 ? content : [{ type: `text`, text: `(no output)` }],
    details: { isError: result.isError ?? false },
  }
}

export function truncateOutput(
  output: { content: Array<{ type: string; text: string }>; details: Record<string, unknown> },
  maxChars: number
): { content: Array<{ type: string; text: string }>; details: Record<string, unknown> } {
  let totalChars = 0
  for (const block of output.content) {
    totalChars += block.text.length
  }

  if (totalChars <= maxChars) return output

  const truncated = output.content.map((block) => {
    if (block.text.length > maxChars) {
      return {
        type: block.type,
        text:
          block.text.slice(0, maxChars) +
          `\n\n[Output truncated at ${maxChars} chars. Original size: ${block.text.length} chars]`,
      }
    }
    return block
  })

  return { content: truncated, details: { ...output.details, truncated: true } }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents-mcp && pnpm test -- test/tool-bridge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/bridge/tool-bridge.ts packages/agents-mcp/test/tool-bridge.test.ts
git commit -m "feat(agents-mcp): add MCP Tool -> AgentTool bridge with namespacing"
```

---

## Task 10: Resource Bridge

**Files:**
- Create: `packages/agents-mcp/src/bridge/resource-bridge.ts`
- Create: `packages/agents-mcp/test/resource-bridge.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it, vi } from 'vitest'
import { createResourceTools } from '../src/bridge/resource-bridge'

describe(`createResourceTools`, () => {
  const mockPool = {
    getEnabledServers: vi.fn().mockReturnValue([
      { name: `github`, config: {} },
    ]),
    acquire: vi.fn().mockResolvedValue({
      listResources: vi.fn().mockResolvedValue([
        { uri: `repo://org/repo`, name: `repo`, description: `A repo` },
      ]),
      readResource: vi.fn().mockResolvedValue([
        { type: `text`, text: `file content here` },
      ]),
    }),
    release: vi.fn(),
  }

  it(`creates two tools: mcp__list_resources and mcp__read_resource`, () => {
    const tools = createResourceTools(mockPool as any)
    expect(tools).toHaveLength(2)
    expect(tools.map((t) => t.name)).toEqual([
      `mcp__list_resources`,
      `mcp__read_resource`,
    ])
  })

  it(`mcp__list_resources returns resources from connected servers`, async () => {
    const tools = createResourceTools(mockPool as any)
    const listTool = tools.find((t) => t.name === `mcp__list_resources`)!
    const result = await listTool.execute(`c1`, {})
    const text = (result.content[0] as any).text as string
    expect(text).toContain(`github`)
    expect(text).toContain(`repo://org/repo`)
  })

  it(`mcp__read_resource reads a resource by server + URI`, async () => {
    const tools = createResourceTools(mockPool as any)
    const readTool = tools.find((t) => t.name === `mcp__read_resource`)!
    const result = await readTool.execute(`c2`, {
      server: `github`,
      uri: `repo://org/repo`,
    })
    const text = (result.content[0] as any).text as string
    expect(text).toContain(`file content here`)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents-mcp && pnpm test -- test/resource-bridge.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement resource-bridge.ts**

```ts
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { McpClientPool } from '../pool'

export function createResourceTools(pool: McpClientPool): AgentTool[] {
  return [createListResourcesTool(pool), createReadResourceTool(pool)]
}

function createListResourcesTool(pool: McpClientPool): AgentTool {
  return {
    name: `mcp__list_resources`,
    label: `List MCP Resources`,
    description: `List all available resources from connected MCP servers. Returns resource URIs, names, and descriptions.`,
    parameters: {
      type: `object`,
      properties: {
        server: {
          type: `string`,
          description: `Filter by server name (optional)`,
        },
      },
    } as AgentTool[`parameters`],
    execute: async (_toolCallId, params) => {
      const filter = (params as { server?: string }).server
      const servers = pool.getEnabledServers()
      const lines: string[] = []

      for (const { name } of servers) {
        if (filter && name !== filter) continue
        try {
          const client = await pool.acquire(name)
          const resources = await client.listResources()
          pool.release(name)

          if (resources.length === 0) continue

          lines.push(`## ${name}`)
          for (const r of resources) {
            lines.push(`- **${r.name}** (\`${r.uri}\`)${r.description ? `: ${r.description}` : ``}`)
          }
          lines.push(``)
        } catch {
          // Server unavailable
        }
      }

      const text = lines.length > 0 ? lines.join(`\n`) : `No resources available.`
      return { content: [{ type: `text`, text }], details: {} }
    },
  }
}

function createReadResourceTool(pool: McpClientPool): AgentTool {
  return {
    name: `mcp__read_resource`,
    label: `Read MCP Resource`,
    description: `Read a specific resource from a connected MCP server by server name and resource URI.`,
    parameters: {
      type: `object`,
      properties: {
        server: { type: `string`, description: `MCP server name` },
        uri: { type: `string`, description: `Resource URI` },
      },
      required: [`server`, `uri`],
    } as AgentTool[`parameters`],
    execute: async (_toolCallId, params) => {
      const { server, uri } = params as { server: string; uri: string }
      const client = await pool.acquire(server)
      try {
        const contents = await client.readResource(uri)
        const text = contents
          .map((c) => c.text ?? `[binary: ${c.mimeType ?? `unknown`}]`)
          .join(`\n`)
        return {
          content: [{ type: `text`, text: text || `(empty resource)` }],
          details: {},
        }
      } finally {
        pool.release(server)
      }
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents-mcp && pnpm test -- test/resource-bridge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/bridge/resource-bridge.ts packages/agents-mcp/test/resource-bridge.test.ts
git commit -m "feat(agents-mcp): add resource bridge tools (list + read)"
```

---

## Task 11: Config Management Tools (for Horton)

**Files:**
- Create: `packages/agents-mcp/src/config/config-tools.ts`
- Create: `packages/agents-mcp/test/config-tools.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConfigTools } from '../src/config/config-tools'
import { ConfigStore } from '../src/config/config-store'

describe(`config management tools`, () => {
  let workDir: string
  let configStore: ConfigStore
  let mockPool: any
  let tools: ReturnType<typeof createConfigTools>

  beforeEach(() => {
    workDir = join(tmpdir(), `agents-mcp-cfgtools-${randomUUID()}`)
    mkdirSync(workDir, { recursive: true })
    configStore = new ConfigStore(workDir)
    mockPool = {
      addServer: vi.fn(),
      removeServer: vi.fn().mockResolvedValue(undefined),
      acquire: vi.fn().mockResolvedValue({ tools: [], resources: [] }),
      release: vi.fn(),
      getServerStates: vi.fn().mockReturnValue([]),
      getEnabledServers: vi.fn().mockReturnValue([]),
    }
    tools = createConfigTools(configStore, mockPool)
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it(`mcp__manage__add_server saves config and adds to pool`, async () => {
    const addTool = tools.find((t) => t.name === `mcp__manage__add_server`)!
    const result = await addTool.execute(`c1`, {
      name: `github`,
      command: `npx`,
      args: [`-y`, `@mcp/server-github`],
    })
    const text = (result.content[0] as any).text as string
    expect(text).toContain(`github`)
    expect(mockPool.addServer).toHaveBeenCalledWith(`github`, expect.objectContaining({ command: `npx` }))

    const config = configStore.load()
    expect(config.servers.github).toBeDefined()
  })

  it(`mcp__manage__remove_server removes from config and pool`, async () => {
    configStore.save({ servers: { github: { command: `npx` } } })
    const removeTool = tools.find((t) => t.name === `mcp__manage__remove_server`)!
    await removeTool.execute(`c2`, { name: `github` })
    expect(mockPool.removeServer).toHaveBeenCalledWith(`github`)
    const config = configStore.load()
    expect(config.servers.github).toBeUndefined()
  })

  it(`mcp__manage__list_servers returns server states`, async () => {
    mockPool.getServerStates.mockReturnValue([
      { name: `gh`, status: `connected`, tools: [{ name: `t1` }], resources: [] },
    ])
    const listTool = tools.find((t) => t.name === `mcp__manage__list_servers`)!
    const result = await listTool.execute(`c3`, {})
    const text = (result.content[0] as any).text as string
    expect(text).toContain(`gh`)
    expect(text).toContain(`connected`)
  })

  it(`mcp__manage__list_tools returns tools from all servers`, async () => {
    mockPool.getEnabledServers.mockReturnValue([{ name: `gh`, config: {} }])
    mockPool.acquire.mockResolvedValue({ tools: [{ name: `create_issue`, description: `Create issue` }] })
    const listToolsTool = tools.find((t) => t.name === `mcp__manage__list_tools`)!
    const result = await listToolsTool.execute(`c4`, {})
    const text = (result.content[0] as any).text as string
    expect(text).toContain(`create_issue`)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents-mcp && pnpm test -- test/config-tools.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement config-tools.ts**

```ts
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { ConfigStore } from './config-store'
import type { McpClientPool } from '../pool'
import type { McpServerConfig } from '../types'

export function createConfigTools(
  configStore: ConfigStore,
  pool: McpClientPool
): AgentTool[] {
  return [
    createAddServerTool(configStore, pool),
    createRemoveServerTool(configStore, pool),
    createListServersTool(pool),
    createListToolsTool(pool),
  ]
}

function createAddServerTool(configStore: ConfigStore, pool: McpClientPool): AgentTool {
  return {
    name: `mcp__manage__add_server`,
    label: `Add MCP Server`,
    description: `Add a new MCP server to the project config. Provide either command (for stdio) or url (for Streamable HTTP). The server will be saved to .electric-agents/mcp.json and connected.`,
    parameters: {
      type: `object`,
      properties: {
        name: { type: `string`, description: `Unique server name` },
        command: { type: `string`, description: `Command to run (stdio transport)` },
        args: { type: `array`, items: { type: `string` }, description: `Command arguments` },
        env: { type: `object`, description: `Environment variables` },
        url: { type: `string`, description: `Server URL (Streamable HTTP transport)` },
        auth: {
          description: `Auth type: "oauth" for OAuth flow, or omit for no auth`,
          oneOf: [
            { type: `string`, enum: [`oauth`] },
            { type: `object`, properties: { token: { type: `string` } } },
            { type: `object`, properties: { tokenEnvVar: { type: `string` } } },
          ],
        },
      },
      required: [`name`],
    } as AgentTool[`parameters`],
    execute: async (_toolCallId, params) => {
      const { name, ...rest } = params as { name: string } & McpServerConfig
      const serverConfig: McpServerConfig = {}

      if (rest.command) serverConfig.command = rest.command
      if (rest.args) serverConfig.args = rest.args
      if (rest.env) serverConfig.env = rest.env as Record<string, string>
      if (rest.url) serverConfig.url = rest.url
      if (rest.auth) serverConfig.auth = rest.auth as McpServerConfig[`auth`]

      configStore.addServer(name, serverConfig)
      pool.addServer(name, serverConfig)

      try {
        const client = await pool.acquire(name)
        pool.release(name)
        const toolCount = client.tools.length
        const resourceCount = client.resources.length
        return {
          content: [{
            type: `text`,
            text: `MCP server "${name}" added and connected. Discovered ${toolCount} tool(s) and ${resourceCount} resource(s).`,
          }],
          details: { toolCount, resourceCount },
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          content: [{
            type: `text`,
            text: `MCP server "${name}" saved to config but failed to connect: ${msg}`,
          }],
          details: { error: msg },
        }
      }
    },
  }
}

function createRemoveServerTool(configStore: ConfigStore, pool: McpClientPool): AgentTool {
  return {
    name: `mcp__manage__remove_server`,
    label: `Remove MCP Server`,
    description: `Remove an MCP server from the project config and disconnect it.`,
    parameters: {
      type: `object`,
      properties: {
        name: { type: `string`, description: `Server name to remove` },
      },
      required: [`name`],
    } as AgentTool[`parameters`],
    execute: async (_toolCallId, params) => {
      const { name } = params as { name: string }
      const removed = configStore.removeServer(name)
      await pool.removeServer(name)
      const text = removed
        ? `MCP server "${name}" removed and disconnected.`
        : `MCP server "${name}" was not found in config.`
      return { content: [{ type: `text`, text }], details: {} }
    },
  }
}

function createListServersTool(pool: McpClientPool): AgentTool {
  return {
    name: `mcp__manage__list_servers`,
    label: `List MCP Servers`,
    description: `List all configured MCP servers with their connection status, tools, and resources.`,
    parameters: { type: `object`, properties: {} } as AgentTool[`parameters`],
    execute: async () => {
      const states = pool.getServerStates()
      if (states.length === 0) {
        return { content: [{ type: `text`, text: `No MCP servers configured.` }], details: {} }
      }

      const lines = states.map((s) => {
        const transport = s.config.command ? `stdio` : s.config.url ? `http` : `unknown`
        const toolNames = s.tools.map((t) => t.name).join(`, `) || `none`
        return `- **${s.name}** [${s.status}] (${transport}) — ${s.tools.length} tools (${toolNames})${s.error ? ` — error: ${s.error}` : ``}`
      })

      return {
        content: [{ type: `text`, text: lines.join(`\n`) }],
        details: {},
      }
    },
  }
}

function createListToolsTool(pool: McpClientPool): AgentTool {
  return {
    name: `mcp__manage__list_tools`,
    label: `List MCP Tools`,
    description: `List all tools available from connected MCP servers.`,
    parameters: {
      type: `object`,
      properties: {
        server: { type: `string`, description: `Filter by server name (optional)` },
      },
    } as AgentTool[`parameters`],
    execute: async (_toolCallId, params) => {
      const filter = (params as { server?: string }).server
      const servers = pool.getEnabledServers()
      const lines: string[] = []

      for (const { name } of servers) {
        if (filter && name !== filter) continue
        try {
          const client = await pool.acquire(name)
          pool.release(name)
          if (client.tools.length === 0) continue
          lines.push(`## ${name}`)
          for (const t of client.tools) {
            lines.push(`- **${t.name}**: ${t.description ?? `(no description)`}`)
          }
          lines.push(``)
        } catch {
          // skip unavailable
        }
      }

      const text = lines.length > 0 ? lines.join(`\n`) : `No MCP tools available.`
      return { content: [{ type: `text`, text }], details: {} }
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents-mcp && pnpm test -- test/config-tools.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/src/config/config-tools.ts packages/agents-mcp/test/config-tools.test.ts
git commit -m "feat(agents-mcp): add config management tools for Horton"
```

---

## Task 12: Integration Factory

**Files:**
- Create: `packages/agents-mcp/src/integration.ts`
- Modify: `packages/agents-mcp/src/index.ts`

- [ ] **Step 1: Implement integration.ts**

```ts
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { ConfigStore } from './config/config-store'
import { McpClientPool } from './pool'
import { createConfigTools } from './config/config-tools'
import type { McpConfig, McpIntegration, McpOverrides } from './types'

export function createMcpIntegration(opts: {
  workingDirectory: string
  onAuthUrl?: (serverName: string, url: string) => void
}): McpIntegration {
  const configStore = new ConfigStore(opts.workingDirectory)
  const config = configStore.load({ expandEnv: true })

  const pool = new McpClientPool(config, {
    workingDirectory: opts.workingDirectory,
    onAuthUrl: opts.onAuthUrl,
  })

  const configTools = createConfigTools(configStore, pool)

  return {
    configTools,

    async getTools(overrides?: McpOverrides): Promise<AgentTool[]> {
      return pool.getTools(overrides)
    },

    getServerInstructions(): Record<string, string> {
      return pool.getInstructions()
    },

    async getServerSummary(): Promise<string> {
      const states = pool.getServerStates()
      const connected = states.filter((s) => s.status === `connected`)
      if (connected.length === 0) return ``

      const sections = connected.map((s) => {
        const toolNames = s.tools.map((t) => `mcp__${s.name}__${t.name}`).join(`, `)
        const header = `## ${s.name}`
        const instructions = s.instructions ? `Instructions: ${s.instructions}\n` : ``
        const tools = s.tools.length > 0 ? `Tools: ${toolNames}` : `No tools`
        return `${header}\n${instructions}${tools}`
      })

      return `# MCP Servers\nThe following external tool servers are connected:\n\n${sections.join(`\n\n`)}\n\nUse mcp__list_resources to discover available resources from these servers.`
    },

    async close(): Promise<void> {
      await pool.close()
    },
  }
}
```

- [ ] **Step 2: Update src/index.ts with all public exports**

```ts
// Types
export type {
  McpServerConfig,
  McpConfig,
  McpOverrides,
  McpIntegration,
  McpServerStatus,
  McpServerState,
  McpDiscoveredTool,
  McpDiscoveredResource,
} from './types'

export { MCP_DEFAULTS } from './types'

// Main entry point
export { createMcpIntegration } from './integration'

// Sub-modules (for advanced usage)
export { McpClientPool } from './pool'
export { McpClient } from './client'
export { ConfigStore } from './config/config-store'
export { TokenStore } from './auth/token-store'
export { bridgeMcpTools } from './bridge/tool-bridge'
export { createResourceTools } from './bridge/resource-bridge'
export { createConfigTools } from './config/config-tools'
export { expandEnvVars, expandConfigValues } from './config/env-expand'
```

- [ ] **Step 3: Run typecheck and build**

Run: `cd packages/agents-mcp && pnpm typecheck && pnpm build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/agents-mcp/src/integration.ts packages/agents-mcp/src/index.ts
git commit -m "feat(agents-mcp): add createMcpIntegration factory and public exports"
```

---

## Task 13: Wire MCP into Horton (agents package)

**Files:**
- Modify: `packages/agents/package.json`
- Modify: `packages/agents/src/bootstrap.ts`
- Modify: `packages/agents/src/agents/horton.ts`

- [ ] **Step 1: Add @electric-ax/agents-mcp dependency**

In `packages/agents/package.json`, add to `dependencies`:

```json
"@electric-ax/agents-mcp": "workspace:*"
```

Run: `pnpm install`

- [ ] **Step 2: Modify bootstrap.ts to create MCP integration**

In `packages/agents/src/bootstrap.ts`, add the MCP integration creation and pass it through to Horton registration.

Add import:
```ts
import { createMcpIntegration } from '@electric-ax/agents-mcp'
import type { McpIntegration } from '@electric-ax/agents-mcp'
```

Update `createBuiltinAgentHandler` to create the integration and pass it to `registerHorton`:

```ts
// After: const cwd = workingDirectory ?? process.cwd()
const mcp = createMcpIntegration({ workingDirectory: cwd })

// Change registerHorton call:
const typeNames = registerHorton(registry, {
  workingDirectory: cwd,
  streamFn,
  mcp,
})
```

Update `AgentHandlerResult` to include `mcp`:
```ts
export interface AgentHandlerResult {
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  runtime: RuntimeHandler
  registry: EntityRegistry
  typeNames: Array<string>
  mcp: McpIntegration
}
```

Return `mcp` in the result object.

- [ ] **Step 3: Modify horton.ts to accept and inject MCP tools**

In `packages/agents/src/agents/horton.ts`:

Add import:
```ts
import type { McpIntegration } from '@electric-ax/agents-mcp'
```

Update `registerHorton` signature:
```ts
export function registerHorton(
  registry: EntityRegistry,
  options: { workingDirectory: string; streamFn?: StreamFn; mcp?: McpIntegration }
): Array<string> {
```

Update `createAssistantHandler` to accept `mcp`:
```ts
function createAssistantHandler(options: {
  workingDirectory: string
  streamFn?: StreamFn
  docsSupport: HortonDocsSupport | null
  docsSearchTool?: AgentTool
  mcp?: McpIntegration
}) {
```

Inside `assistantHandler`, inject MCP tools:
```ts
const mcpTools = options.mcp ? await options.mcp.getTools() : []
const mcpSummary = options.mcp ? await options.mcp.getServerSummary() : ``

const tools = [
  ...ctx.electricTools,
  ...createHortonTools(workingDirectory, ctx, readSet, { docsSearchTool }),
  ...(options.mcp?.configTools ?? []),
  ...mcpTools,
]
```

Update `buildHortonSystemPrompt` to accept and include MCP summary:
```ts
export function buildHortonSystemPrompt(
  workingDirectory: string,
  opts: { hasDocsSupport?: boolean; mcpSummary?: string } = {}
): string {
```

Add near the end of the system prompt, before the working directory line:
```ts
const mcpSection = opts.mcpSummary ? `\n${opts.mcpSummary}\n` : ``
```

And include `${mcpSection}` in the prompt template.

Pass `mcpSummary` when calling `buildHortonSystemPrompt`:
```ts
ctx.useAgent({
  systemPrompt: buildHortonSystemPrompt(workingDirectory, {
    hasDocsSupport: Boolean(docsSupport),
    mcpSummary,
  }),
  model: HORTON_MODEL,
  tools,
  ...(streamFn && { streamFn }),
})
```

- [ ] **Step 4: Run typecheck across both packages**

Run: `cd packages/agents && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agents/package.json packages/agents/src/bootstrap.ts packages/agents/src/agents/horton.ts
git commit -m "feat(agents): wire MCP integration into Horton bootstrap"
```

---

## Task 14: Integration Test

**Files:**
- Create: `packages/agents-mcp/test/integration.test.ts`

- [ ] **Step 1: Write integration test with a mock MCP stdio server**

Create a simple test that verifies the full flow: config -> pool -> tool bridge -> tool execution.

```ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMcpIntegration } from '../src/integration'

// Mock the McpClient to avoid real subprocess/network calls
vi.mock(`../src/client`, () => ({
  McpClient: vi.fn().mockImplementation((opts: any) => ({
    serverName: opts.serverName,
    tools: [
      {
        name: `echo`,
        description: `Echoes input`,
        inputSchema: { type: `object`, properties: { text: { type: `string` } } },
      },
    ],
    resources: [],
    instructions: `Use echo to test`,
    sessionId: `session-1`,
    protocolVersion: `2025-06-18`,
    connect: vi.fn().mockResolvedValue(undefined),
    discover: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    callTool: vi.fn().mockImplementation(async (_name: string, args: any) => ({
      content: [{ type: `text`, text: `echo: ${args.text}` }],
      isError: false,
    })),
    listResources: vi.fn().mockResolvedValue([]),
    readResource: vi.fn().mockResolvedValue([]),
  })),
}))

describe(`createMcpIntegration (mocked)`, () => {
  let workDir: string

  beforeEach(() => {
    workDir = join(tmpdir(), `agents-mcp-int-${randomUUID()}`)
    mkdirSync(join(workDir, `.electric-agents`), { recursive: true })
    writeFileSync(
      join(workDir, `.electric-agents`, `mcp.json`),
      JSON.stringify({
        servers: {
          test: { command: `echo`, args: [`hello`] },
        },
      })
    )
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it(`loads config and bridges tools`, async () => {
    const mcp = createMcpIntegration({ workingDirectory: workDir })
    const tools = await mcp.getTools()

    const mcpTools = tools.filter((t) => t.name.startsWith(`mcp__test__`))
    expect(mcpTools).toHaveLength(1)
    expect(mcpTools[0]!.name).toBe(`mcp__test__echo`)

    // Execute the bridged tool
    const result = await mcpTools[0]!.execute(`c1`, { text: `hello` })
    expect((result.content[0] as any).text).toBe(`echo: hello`)

    await mcp.close()
  })

  it(`includes config management tools`, () => {
    const mcp = createMcpIntegration({ workingDirectory: workDir })
    const configToolNames = mcp.configTools.map((t) => t.name)
    expect(configToolNames).toContain(`mcp__manage__add_server`)
    expect(configToolNames).toContain(`mcp__manage__remove_server`)
    expect(configToolNames).toContain(`mcp__manage__list_servers`)
    expect(configToolNames).toContain(`mcp__manage__list_tools`)
  })

  it(`generates server summary with instructions`, async () => {
    const mcp = createMcpIntegration({ workingDirectory: workDir })
    await mcp.getTools() // triggers lazy connect
    const summary = await mcp.getServerSummary()
    expect(summary).toContain(`# MCP Servers`)
    expect(summary).toContain(`test`)
    expect(summary).toContain(`mcp__test__echo`)

    await mcp.close()
  })

  it(`applies overrides to exclude servers`, async () => {
    const mcp = createMcpIntegration({ workingDirectory: workDir })
    const tools = await mcp.getTools({ test: false })
    const mcpTools = tools.filter((t) => t.name.startsWith(`mcp__test__`))
    expect(mcpTools).toHaveLength(0)

    await mcp.close()
  })
})
```

- [ ] **Step 2: Run integration test**

Run: `cd packages/agents-mcp && pnpm test -- test/integration.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `cd packages/agents-mcp && pnpm test`
Expected: All tests pass

- [ ] **Step 4: Build**

Run: `cd packages/agents-mcp && pnpm build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mcp/test/integration.test.ts
git commit -m "test(agents-mcp): add integration test for full MCP flow"
```

---

## Task 15: Final Verification

- [ ] **Step 1: Run full monorepo typecheck for affected packages**

Run: `cd packages/agents-mcp && pnpm typecheck && cd ../agents && pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Run all tests in agents-mcp**

Run: `cd packages/agents-mcp && pnpm test`
Expected: All tests pass

- [ ] **Step 3: Build agents-mcp**

Run: `cd packages/agents-mcp && pnpm build`
Expected: Build produces `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts`

- [ ] **Step 4: Verify exports**

Run: `node -e "import('@electric-ax/agents-mcp').then(m => console.log(Object.keys(m)))"`
Expected: Lists all public exports

- [ ] **Step 5: Final commit with any remaining fixes**

```bash
git add -A
git commit -m "chore(agents-mcp): final verification and cleanup"
```
