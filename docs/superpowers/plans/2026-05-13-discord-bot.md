# Discord Bot for Electric Agents — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@electric-ax/discord-bot` — a Node-deployed Discord adapter + a per-Discord-thread `discord-bot` entity registered into the existing agents runtime, capable of answering questions over Discord/GitHub MCP/docs and delegating coding tasks to Horton in a separate runtime host.

**Architecture:** Two-layer package in `factory/discord-bot/`. The **adapter** is a Node process holding the Discord Gateway WebSocket (`discord.js`) plus an HTTP Interactions endpoint (`node:http`); it translates Discord events into agents-server wake webhooks. The **entity** is registered via `registerDiscordBot(registry, opts)` and lives in the operator's `agents-server`; its tool surface (Discord REST via raw `fetch`, GitHub MCP, `spawn_horton`) is intentionally Node-free so a follow-up Cloudflare DO host can reuse it. See spec: `docs/superpowers/specs/2026-05-13-discord-bot-design.md`.

**Tech Stack:** TypeScript, tsdown (build), vitest (test), zod (config + payload schemas), `discord.js` v14 (adapter Gateway only), `node:crypto` Ed25519 verify (Interactions), raw `fetch` for Discord REST in entity tools, `@electric-ax/agents-runtime` for entity registration + `runtime-server-client` spawn API.

**Spec deliverables → tasks:**
- §3 architecture + §4 lifecycle → Tasks 9 (entity), 11–14 (adapter)
- §5.1 public surface → Task 9
- §5.2 wake payload contract → Task 6
- §5.3 tools → Tasks 4 (discord.*), 5 (delegate)
- §5.4 context priming → Tasks 7, 4 (read_channel_around_message)
- §5.5 system prompt → Task 8
- §6 data flows → Task 16 (integration test)
- §7 configuration → Task 2
- §8 packaging → Tasks 1, 15, 17
- §9 testing → present across every task; integration test in Task 16
- §10 future work → docs only (README + spec), no tasks

---

## Phase 0 — Scaffold

### Task 1: Workspace package skeleton

**Files:**
- Create: `factory/discord-bot/package.json`
- Create: `factory/discord-bot/tsconfig.json`
- Create: `factory/discord-bot/tsdown.config.ts`
- Create: `factory/discord-bot/vitest.config.ts`
- Create: `factory/discord-bot/src/index.ts`
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Add `factory/*` to workspace**

Edit `pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
  - 'examples/*'
  - 'website'
  - 'examples/.shared'
  - 'factory/*'
```

- [ ] **Step 2: Create the package manifest**

Create `factory/discord-bot/package.json`:

```json
{
  "name": "@electric-ax/discord-bot",
  "version": "0.0.1",
  "description": "Discord adapter + entity for Electric Agents",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/electric-sql/electric.git",
    "directory": "factory/discord-bot"
  },
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "discord-bot": "./dist/host-node.js",
    "discord-bot-register": "./dist/register-commands.js"
  },
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
    },
    "./package.json": "./package.json"
  },
  "dependencies": {
    "@electric-ax/agents-runtime": "workspace:*",
    "@sinclair/typebox": "^0.34.48",
    "discord.js": "^14.16.3",
    "pino": "^10.3.1",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/node": "^22.19.15",
    "@vitest/coverage-v8": "^4.1.0",
    "tsdown": "^0.9.0",
    "tsx": "^4.19.0",
    "typescript": "^5.0.0",
    "vitest": "^4.1.0"
  },
  "files": ["dist", "README.md"],
  "sideEffects": false,
  "license": "Apache-2.0"
}
```

- [ ] **Step 3: tsconfig**

Create `factory/discord-bot/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 4: tsdown config (three entries: index, host, register)**

Create `factory/discord-bot/tsdown.config.ts`:

```ts
import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: [`src/index.ts`],
    format: [`esm`, `cjs`],
    platform: `node`,
    dts: true,
    clean: true,
  },
  {
    entry: [`src/adapter/host-node.ts`, `src/adapter/register-commands.ts`],
    format: [`esm`],
    platform: `node`,
    dts: false,
    clean: false,
  },
])
```

- [ ] **Step 5: vitest config**

Create `factory/discord-bot/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [`test/**/*.test.ts`],
  },
})
```

- [ ] **Step 6: empty public exports file**

Create `factory/discord-bot/src/index.ts`:

```ts
export {} // populated in later tasks
```

- [ ] **Step 7: install and verify the workspace picks it up**

Run: `pnpm install`
Expected: succeeds; `factory/discord-bot` appears under workspace packages. Then `pnpm --filter @electric-ax/discord-bot typecheck` exits 0.

- [ ] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml factory/discord-bot
git commit -m "chore(discord-bot): scaffold @electric-ax/discord-bot package"
```

---

## Phase 1 — Entity (portable / Node-free)

### Task 2: Config schema + env loader

**Files:**
- Create: `factory/discord-bot/src/config.ts`
- Create: `factory/discord-bot/test/config.test.ts`

- [ ] **Step 1: Failing test**

Create `factory/discord-bot/test/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config'

describe(`loadConfig`, () => {
  const minimal = {
    DISCORD_BOT_TOKEN: `t`,
    DISCORD_PUBLIC_KEY: `pk`,
    DISCORD_APP_ID: `app`,
    AGENTS_SERVER_URL: `http://a`,
    AGENTS_SERVER_TOKEN: `s`,
    GITHUB_TOKEN: `gh`,
    GITHUB_REPO: `o/r`,
  }

  it(`parses required env vars`, () => {
    const cfg = loadConfig(minimal)
    expect(cfg.discord.botToken).toBe(`t`)
    expect(cfg.github.repo).toBe(`o/r`)
    expect(cfg.adapter.port).toBe(4449)
    expect(cfg.primeContext.messageLimit).toBe(20)
  })

  it(`throws when DISCORD_BOT_TOKEN is missing`, () => {
    const { DISCORD_BOT_TOKEN: _omit, ...rest } = minimal
    expect(() => loadConfig(rest)).toThrow(/DISCORD_BOT_TOKEN/)
  })

  it(`defaults HORTON_AGENTS_SERVER_URL to AGENTS_SERVER_URL`, () => {
    const cfg = loadConfig(minimal)
    expect(cfg.horton.agentsServerUrl).toBe(`http://a`)
    expect(cfg.horton.entityType).toBe(`horton`)
  })
})
```

- [ ] **Step 2: Run failing**

Run: `pnpm --filter @electric-ax/discord-bot test config.test`
Expected: FAIL (`Cannot find module '../src/config'`).

- [ ] **Step 3: Implement**

Create `factory/discord-bot/src/config.ts`:

```ts
import { z } from 'zod'

const envSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_PUBLIC_KEY: z.string().min(1),
  DISCORD_APP_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().optional(),
  AGENTS_SERVER_URL: z.string().url(),
  AGENTS_SERVER_TOKEN: z.string().min(1),
  HORTON_AGENTS_SERVER_URL: z.string().url().optional(),
  HORTON_ENTITY_TYPE: z.string().default(`horton`),
  GITHUB_TOKEN: z.string().min(1),
  GITHUB_REPO: z.string().regex(/^[^/]+\/[^/]+$/),
  DISCORD_ADAPTER_PORT: z.coerce.number().int().min(1).max(65535).default(4449),
  DISCORD_PRIME_MESSAGE_LIMIT: z.coerce.number().int().min(1).max(100).default(20),
})

export type DiscordBotConfig = ReturnType<typeof loadConfig>

export function loadConfig(env: Record<string, string | undefined> = process.env): {
  discord: { botToken: string; publicKey: string; appId: string; guildId?: string }
  agentsServer: { url: string; token: string }
  horton: { agentsServerUrl: string; entityType: string }
  github: { repo: string; token: string }
  adapter: { port: number }
  primeContext: { messageLimit: number }
} {
  const parsed = envSchema.parse(env)
  return {
    discord: {
      botToken: parsed.DISCORD_BOT_TOKEN,
      publicKey: parsed.DISCORD_PUBLIC_KEY,
      appId: parsed.DISCORD_APP_ID,
      guildId: parsed.DISCORD_GUILD_ID,
    },
    agentsServer: { url: parsed.AGENTS_SERVER_URL, token: parsed.AGENTS_SERVER_TOKEN },
    horton: {
      agentsServerUrl: parsed.HORTON_AGENTS_SERVER_URL ?? parsed.AGENTS_SERVER_URL,
      entityType: parsed.HORTON_ENTITY_TYPE,
    },
    github: { repo: parsed.GITHUB_REPO, token: parsed.GITHUB_TOKEN },
    adapter: { port: parsed.DISCORD_ADAPTER_PORT },
    primeContext: { messageLimit: parsed.DISCORD_PRIME_MESSAGE_LIMIT },
  }
}
```

- [ ] **Step 4: Verify passing**

Run: `pnpm --filter @electric-ax/discord-bot test config.test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add factory/discord-bot/src/config.ts factory/discord-bot/test/config.test.ts
git commit -m "feat(discord-bot): config schema + env loader"
```

---

### Task 3: Discord REST client (raw fetch, portable)

**Files:**
- Create: `factory/discord-bot/src/discord-rest.ts`
- Create: `factory/discord-bot/test/discord-rest.test.ts`

- [ ] **Step 1: Failing test**

Create `factory/discord-bot/test/discord-rest.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createDiscordRest } from '../src/discord-rest'

describe(`createDiscordRest`, () => {
  it(`posts JSON with Authorization Bot header`, async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ id: `m1` }), { status: 200 })
    )
    const rest = createDiscordRest({ token: `abc`, fetch: fetchFn as any })

    const result = await rest.post(`/channels/123/messages`, { content: `hi` })

    expect(result).toEqual({ id: `m1` })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(`https://discord.com/api/v10/channels/123/messages`)
    expect((init as RequestInit).method).toBe(`POST`)
    expect((init as any).headers.Authorization).toBe(`Bot abc`)
    expect((init as any).headers[`Content-Type`]).toBe(`application/json`)
    expect((init as any).body).toBe(JSON.stringify({ content: `hi` }))
  })

  it(`throws DiscordRestError on non-2xx`, async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ message: `boom` }), { status: 403 })
    )
    const rest = createDiscordRest({ token: `t`, fetch: fetchFn as any })
    await expect(rest.get(`/x`)).rejects.toMatchObject({ status: 403, body: { message: `boom` } })
  })

  it(`retries once on 429 honoring retry_after`, async () => {
    const calls: number[] = []
    const fetchFn = vi.fn(async () => {
      calls.push(Date.now())
      if (calls.length === 1) {
        return new Response(JSON.stringify({ retry_after: 0.01 }), { status: 429 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    const rest = createDiscordRest({ token: `t`, fetch: fetchFn as any })
    const out = await rest.get(`/x`)
    expect(out).toEqual({ ok: true })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run failing**

Run: `pnpm --filter @electric-ax/discord-bot test discord-rest.test`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `factory/discord-bot/src/discord-rest.ts`:

```ts
const API_BASE = `https://discord.com/api/v10`

export interface DiscordRestOptions {
  token: string
  fetch?: typeof globalThis.fetch
  baseUrl?: string
}

export class DiscordRestError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`Discord API ${status}: ${JSON.stringify(body)}`)
  }
}

export interface DiscordRest {
  get<T = unknown>(path: string): Promise<T>
  post<T = unknown>(path: string, body: unknown): Promise<T>
  patch<T = unknown>(path: string, body: unknown): Promise<T>
  put<T = unknown>(path: string, body: unknown): Promise<T>
  delete<T = unknown>(path: string): Promise<T>
}

export function createDiscordRest(opts: DiscordRestOptions): DiscordRest {
  const fetchFn = opts.fetch ?? globalThis.fetch
  const base = opts.baseUrl ?? API_BASE

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetchFn(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bot ${opts.token}`,
          'Content-Type': `application/json`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      if (res.status === 429 && attempt === 0) {
        const payload = (await res.json().catch(() => ({}))) as { retry_after?: number }
        await new Promise((r) => setTimeout(r, Math.ceil((payload.retry_after ?? 1) * 1000)))
        continue
      }
      const text = await res.text()
      const parsed = text ? JSON.parse(text) : null
      if (!res.ok) throw new DiscordRestError(res.status, parsed)
      return parsed as T
    }
    throw new DiscordRestError(429, { message: `rate limit retries exhausted` })
  }

  return {
    get: (path) => request(`GET`, path),
    post: (path, body) => request(`POST`, path, body),
    patch: (path, body) => request(`PATCH`, path, body),
    put: (path, body) => request(`PUT`, path, body),
    delete: (path) => request(`DELETE`, path),
  }
}
```

- [ ] **Step 4: Verify passing**

Run: `pnpm --filter @electric-ax/discord-bot test discord-rest.test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add factory/discord-bot/src/discord-rest.ts factory/discord-bot/test/discord-rest.test.ts
git commit -m "feat(discord-bot): portable Discord REST client over fetch"
```

---

### Task 4: Discord tools

**Files:**
- Create: `factory/discord-bot/src/tools/discord.ts`
- Create: `factory/discord-bot/test/tools/discord.test.ts`

**Tools delivered:** `discord.post_message`, `discord.edit_message`, `discord.create_thread`, `discord.read_thread_history`, `discord.add_reaction`, `discord.read_channel_around_message`.

- [ ] **Step 1: Failing test**

Create `factory/discord-bot/test/tools/discord.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createDiscordTools } from '../../src/tools/discord'

function fakeRest() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  }
}

describe(`discord tools`, () => {
  it(`post_message calls POST /channels/:id/messages`, async () => {
    const rest = fakeRest()
    rest.post.mockResolvedValue({ id: `m1` })
    const [post] = createDiscordTools({ rest: rest as any })
      .filter((t) => t.name === `post_message`)
    const result = await post.execute(`call-1`, { channelId: `c1`, content: `hi` })
    expect(rest.post).toHaveBeenCalledWith(`/channels/c1/messages`, { content: `hi` })
    expect(result.content[0]).toMatchObject({ type: `text` })
    expect(result.details).toMatchObject({ messageId: `m1` })
  })

  it(`add_reaction calls PUT with URL-encoded emoji`, async () => {
    const rest = fakeRest()
    rest.put.mockResolvedValue(null)
    const tool = createDiscordTools({ rest: rest as any }).find(
      (t) => t.name === `add_reaction`
    )!
    await tool.execute(`c`, { channelId: `c`, messageId: `m`, emoji: `✅` })
    const [path] = rest.put.mock.calls[0]
    expect(path).toMatch(/\/channels\/c\/messages\/m\/reactions\/.+\/@me$/)
  })

  it(`read_channel_around_message GETs with ?around=&limit=`, async () => {
    const rest = fakeRest()
    rest.get.mockResolvedValue([])
    const tool = createDiscordTools({ rest: rest as any }).find(
      (t) => t.name === `read_channel_around_message`
    )!
    await tool.execute(`c`, { channelId: `c1`, messageId: `m1`, before: 20, after: 5 })
    expect(rest.get).toHaveBeenCalledTimes(2)
    const calls = rest.get.mock.calls.map((c) => c[0])
    expect(calls.some((p: string) => p.includes(`before=m1`) && p.includes(`limit=20`))).toBe(true)
    expect(calls.some((p: string) => p.includes(`after=m1`) && p.includes(`limit=5`))).toBe(true)
  })

  it(`create_thread POSTs to /channels/:id/messages/:m/threads`, async () => {
    const rest = fakeRest()
    rest.post.mockResolvedValue({ id: `t1` })
    const tool = createDiscordTools({ rest: rest as any }).find(
      (t) => t.name === `create_thread`
    )!
    const out = await tool.execute(`c`, {
      channelId: `c1`,
      messageId: `m1`,
      name: `topic`,
      autoArchiveMinutes: 1440,
    })
    expect(rest.post).toHaveBeenCalledWith(
      `/channels/c1/messages/m1/threads`,
      { name: `topic`, auto_archive_duration: 1440 }
    )
    expect(out.details).toMatchObject({ threadId: `t1` })
  })
})
```

- [ ] **Step 2: Run failing**

Run: `pnpm --filter @electric-ax/discord-bot test tools/discord.test`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `factory/discord-bot/src/tools/discord.ts`:

```ts
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { DiscordRest } from '../discord-rest'

export interface DiscordToolsOptions {
  rest: DiscordRest
}

const text = (s: string) => ({ content: [{ type: `text` as const, text: s }], details: {} as Record<string, unknown> })

export function createDiscordTools({ rest }: DiscordToolsOptions): Array<AgentTool> {
  const postMessage: AgentTool = {
    name: `post_message`,
    label: `Post Discord message`,
    description: `Post a message to a Discord channel or thread.`,
    parameters: Type.Object({
      channelId: Type.String(),
      content: Type.String({ maxLength: 2000 }),
    }),
    async execute(_id, params) {
      const { channelId, content } = params as { channelId: string; content: string }
      const msg = (await rest.post(`/channels/${channelId}/messages`, { content })) as {
        id: string
      }
      const out = text(`Posted message ${msg.id}`)
      out.details = { messageId: msg.id, channelId }
      return out
    },
  }

  const editMessage: AgentTool = {
    name: `edit_message`,
    label: `Edit Discord message`,
    description: `Edit a previously-posted message by id.`,
    parameters: Type.Object({
      channelId: Type.String(),
      messageId: Type.String(),
      content: Type.String({ maxLength: 2000 }),
    }),
    async execute(_id, params) {
      const { channelId, messageId, content } = params as {
        channelId: string; messageId: string; content: string
      }
      await rest.patch(`/channels/${channelId}/messages/${messageId}`, { content })
      return text(`Edited message ${messageId}`)
    },
  }

  const createThread: AgentTool = {
    name: `create_thread`,
    label: `Create Discord thread`,
    description: `Create a thread from an existing message.`,
    parameters: Type.Object({
      channelId: Type.String(),
      messageId: Type.String(),
      name: Type.String({ maxLength: 100 }),
      autoArchiveMinutes: Type.Optional(Type.Integer()),
    }),
    async execute(_id, params) {
      const { channelId, messageId, name, autoArchiveMinutes } = params as {
        channelId: string; messageId: string; name: string; autoArchiveMinutes?: number
      }
      const t = (await rest.post(`/channels/${channelId}/messages/${messageId}/threads`, {
        name,
        auto_archive_duration: autoArchiveMinutes ?? 1440,
      })) as { id: string }
      const out = text(`Created thread ${t.id}`)
      out.details = { threadId: t.id }
      return out
    },
  }

  const readThreadHistory: AgentTool = {
    name: `read_thread_history`,
    label: `Read thread history`,
    description: `Read recent messages from a thread.`,
    parameters: Type.Object({
      threadId: Type.String(),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    }),
    async execute(_id, params) {
      const { threadId, limit = 20 } = params as { threadId: string; limit?: number }
      const msgs = (await rest.get(
        `/channels/${threadId}/messages?limit=${limit}`
      )) as Array<{ id: string; author: { username: string }; content: string }>
      const formatted = msgs
        .reverse()
        .map((m) => `${m.author.username}: ${m.content}`)
        .join(`\n`)
      return text(formatted || `(no messages)`)
    },
  }

  const addReaction: AgentTool = {
    name: `add_reaction`,
    label: `Add reaction`,
    description: `Add an emoji reaction to a message.`,
    parameters: Type.Object({
      channelId: Type.String(),
      messageId: Type.String(),
      emoji: Type.String(),
    }),
    async execute(_id, params) {
      const { channelId, messageId, emoji } = params as {
        channelId: string; messageId: string; emoji: string
      }
      const enc = encodeURIComponent(emoji)
      await rest.put(`/channels/${channelId}/messages/${messageId}/reactions/${enc}/@me`)
      return text(`Reacted ${emoji}`)
    },
  }

  const readAround: AgentTool = {
    name: `read_channel_around_message`,
    label: `Read messages around a reference`,
    description: `Fetch a window of messages around a reference message id.`,
    parameters: Type.Object({
      channelId: Type.String(),
      messageId: Type.String(),
      before: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
      after: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
    }),
    async execute(_id, params) {
      const { channelId, messageId, before = 20, after = 5 } = params as {
        channelId: string; messageId: string; before?: number; after?: number
      }
      const [beforeMsgs, afterMsgs] = await Promise.all([
        before > 0
          ? rest.get<Array<{ id: string; author: { username: string }; content: string }>>(
              `/channels/${channelId}/messages?before=${messageId}&limit=${before}`
            )
          : Promise.resolve([]),
        after > 0
          ? rest.get<Array<{ id: string; author: { username: string }; content: string }>>(
              `/channels/${channelId}/messages?after=${messageId}&limit=${after}`
            )
          : Promise.resolve([]),
      ])
      const all = [...beforeMsgs.reverse(), ...afterMsgs]
      return text(all.map((m) => `${m.author.username}: ${m.content}`).join(`\n`))
    },
  }

  return [postMessage, editMessage, createThread, readThreadHistory, addReaction, readAround]
}
```

- [ ] **Step 4: Verify passing**

Run: `pnpm --filter @electric-ax/discord-bot test tools/discord.test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add factory/discord-bot/src/tools/discord.ts factory/discord-bot/test/tools/discord.test.ts
git commit -m "feat(discord-bot): discord.* tools over portable REST client"
```

---

### Task 5: `delegate.spawn_horton` tool

**Files:**
- Create: `factory/discord-bot/src/tools/delegate.ts`
- Create: `factory/discord-bot/test/tools/delegate.test.ts`

- [ ] **Step 1: Failing test**

Create `factory/discord-bot/test/tools/delegate.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createSpawnHortonTool } from '../../src/tools/delegate'

describe(`spawn_horton`, () => {
  it(`spawns a Horton child via runtime-server-client`, async () => {
    const spawnEntity = vi.fn().mockResolvedValue({
      entityUrl: `http://a/horton-xyz`,
      streamPath: `/x`,
    })
    const tool = createSpawnHortonTool({
      runtime: { spawnEntity } as any,
      hortonEntityType: `horton`,
      threadId: `t1`,
      defaultRepo: `o/r`,
      parentUrl: `http://a/discord-bot-t1`,
    })

    const result = await tool.execute(`c`, {
      task: `fix issue 4312`,
      initialMessage: `start`,
      branch: `electric-bot/thread-t1`,
    })

    expect(spawnEntity).toHaveBeenCalledTimes(1)
    const call = spawnEntity.mock.calls[0][0]
    expect(call.type).toBe(`horton`)
    expect(call.parentUrl).toBe(`http://a/discord-bot-t1`)
    expect(call.initialMessage).toBe(`start`)
    expect(call.args.task).toBe(`fix issue 4312`)
    expect(call.args.repo).toBe(`o/r`)
    expect(call.args.branch).toBe(`electric-bot/thread-t1`)
    expect(call.wake?.condition).toBe(`runFinished`)
    expect(result.details).toMatchObject({
      childEntityUrl: `http://a/horton-xyz`,
    })
  })
})
```

- [ ] **Step 2: Run failing**

Run: `pnpm --filter @electric-ax/discord-bot test tools/delegate.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `factory/discord-bot/src/tools/delegate.ts`:

```ts
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { RuntimeServerClient } from '@electric-ax/agents-runtime'

export interface SpawnHortonOptions {
  runtime: RuntimeServerClient
  hortonEntityType: string
  threadId: string
  defaultRepo: string
  parentUrl: string
}

export function createSpawnHortonTool(opts: SpawnHortonOptions): AgentTool {
  return {
    name: `spawn_horton`,
    label: `Delegate coding task to Horton`,
    description:
      `Spawn a Horton coding agent in a separate runtime host. ` +
      `Returns immediately with the child entity URL; Horton's final report ` +
      `arrives later as a child_completed wake.`,
    parameters: Type.Object({
      task: Type.String({
        description: `Detailed system prompt / brief for Horton. Include issue details, acceptance criteria, repo context.`,
      }),
      initialMessage: Type.String({
        description: `First user message Horton wakes on — the concrete instruction.`,
      }),
      branch: Type.String({
        description: `Working branch name, e.g. electric-bot/thread-<id>`,
      }),
    }),
    async execute(_id, params) {
      const { task, initialMessage, branch } = params as {
        task: string; initialMessage: string; branch: string
      }
      const childId = `horton-${opts.threadId}-${Date.now()}`
      const info = await opts.runtime.spawnEntity({
        type: opts.hortonEntityType,
        id: childId,
        parentUrl: opts.parentUrl,
        initialMessage,
        args: {
          task,
          repo: opts.defaultRepo,
          branch,
        },
        wake: {
          subscriberUrl: opts.parentUrl,
          condition: `runFinished`,
          includeResponse: true,
        },
      })
      return {
        content: [
          {
            type: `text` as const,
            text: `Spawned horton at ${info.entityUrl}`,
          },
        ],
        details: { childEntityUrl: info.entityUrl, childEntityId: childId },
      }
    },
  }
}
```

- [ ] **Step 4: Verify passing**

Run: `pnpm --filter @electric-ax/discord-bot test tools/delegate.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add factory/discord-bot/src/tools/delegate.ts factory/discord-bot/test/tools/delegate.test.ts
git commit -m "feat(discord-bot): delegate.spawn_horton tool"
```

---

### Task 6: Wake-payload schemas

**Files:**
- Create: `factory/discord-bot/src/wake-message.ts`
- Create: `factory/discord-bot/test/wake-message.test.ts`

- [ ] **Step 1: Failing test**

Create `factory/discord-bot/test/wake-message.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { discordWakeMessageSchema } from '../src/wake-message'

describe(`discordWakeMessageSchema`, () => {
  it(`accepts a mention payload`, () => {
    const parsed = discordWakeMessageSchema.parse({
      kind: `mention`,
      threadId: `t1`,
      channelId: `c1`,
      userId: `u1`,
      content: `hello`,
      primeMessages: [{ id: `m0`, author: `alice`, content: `prior`, timestamp: 1 }],
    })
    expect(parsed.kind).toBe(`mention`)
  })

  it(`accepts thread_close with only threadId`, () => {
    const parsed = discordWakeMessageSchema.parse({ kind: `thread_close`, threadId: `t1` })
    expect(parsed.kind).toBe(`thread_close`)
  })

  it(`rejects payload without kind`, () => {
    expect(() => discordWakeMessageSchema.parse({ threadId: `t1` })).toThrow()
  })
})
```

- [ ] **Step 2: Run failing**

Run: `pnpm --filter @electric-ax/discord-bot test wake-message.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `factory/discord-bot/src/wake-message.ts`:

```ts
import { z } from 'zod'

const attachmentSchema = z.object({
  id: z.string(),
  url: z.string(),
  contentType: z.string().optional(),
  filename: z.string().optional(),
})

const channelMessageSchema = z.object({
  id: z.string(),
  author: z.string(),
  content: z.string(),
  timestamp: z.number(),
})

export const discordWakeMessageSchema = z.discriminatedUnion(`kind`, [
  z.object({
    kind: z.literal(`mention`),
    threadId: z.string(),
    channelId: z.string(),
    userId: z.string(),
    content: z.string(),
    referencedMessageId: z.string().optional(),
    attachments: z.array(attachmentSchema).optional(),
    primeMessages: z.array(channelMessageSchema).optional(),
    idempotencyKey: z.string().optional(),
  }),
  z.object({
    kind: z.literal(`thread_msg`),
    threadId: z.string(),
    userId: z.string(),
    content: z.string(),
    referencedMessageId: z.string().optional(),
    attachments: z.array(attachmentSchema).optional(),
    idempotencyKey: z.string().optional(),
  }),
  z.object({
    kind: z.literal(`interaction`),
    threadId: z.string(),
    userId: z.string(),
    command: z.string(),
    options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    idempotencyKey: z.string().optional(),
  }),
  z.object({
    kind: z.literal(`thread_close`),
    threadId: z.string(),
    idempotencyKey: z.string().optional(),
  }),
])

export type DiscordWakeMessage = z.infer<typeof discordWakeMessageSchema>
export type ChannelMessage = z.infer<typeof channelMessageSchema>
```

- [ ] **Step 4: Verify passing**

Run: `pnpm --filter @electric-ax/discord-bot test wake-message.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add factory/discord-bot/src/wake-message.ts factory/discord-bot/test/wake-message.test.ts
git commit -m "feat(discord-bot): wake-message zod schemas"
```

---

### Task 7: Prime-context formatter

**Files:**
- Create: `factory/discord-bot/src/prime-context.ts`
- Create: `factory/discord-bot/test/prime-context.test.ts`

- [ ] **Step 1: Failing test**

Create `factory/discord-bot/test/prime-context.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildPrimeContextEntries } from '../src/prime-context'

describe(`buildPrimeContextEntries`, () => {
  it(`groups messages into a single context entry with channel header`, () => {
    const entries = buildPrimeContextEntries({
      channelId: `c1`,
      threadId: `t1`,
      messages: [
        { id: `m1`, author: `alice`, content: `hello`, timestamp: 1 },
        { id: `m2`, author: `bob`, content: `world`, timestamp: 2 },
      ],
    })
    expect(entries).toHaveLength(1)
    const e = entries[0]
    expect(e.key).toBe(`discord-prime-c1-t1`)
    expect(e.attrs.role).toBe(`background`)
    expect(typeof e.text).toBe(`string`)
    expect(e.text).toContain(`alice: hello`)
    expect(e.text).toContain(`bob: world`)
  })

  it(`returns empty when no messages`, () => {
    expect(buildPrimeContextEntries({ channelId: `c`, threadId: `t`, messages: [] })).toEqual([])
  })
})
```

- [ ] **Step 2: Run failing**

Run: `pnpm --filter @electric-ax/discord-bot test prime-context.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `factory/discord-bot/src/prime-context.ts`:

```ts
import type { ChannelMessage } from './wake-message'

export interface PrimeContextEntry {
  key: string
  text: string
  attrs: { role: `background`; source: `discord-channel` }
}

export function buildPrimeContextEntries(input: {
  channelId: string
  threadId: string
  messages: ReadonlyArray<ChannelMessage>
}): Array<PrimeContextEntry> {
  if (input.messages.length === 0) return []
  const sorted = [...input.messages].sort((a, b) => a.timestamp - b.timestamp)
  const body = sorted.map((m) => `${m.author}: ${m.content}`).join(`\n`)
  return [
    {
      key: `discord-prime-${input.channelId}-${input.threadId}`,
      text:
        `# Recent messages in the parent channel (#${input.channelId})\n` +
        `These were the last messages before this thread started; treat as background.\n\n` +
        body,
      attrs: { role: `background`, source: `discord-channel` },
    },
  ]
}
```

- [ ] **Step 4: Verify passing**

Run: `pnpm --filter @electric-ax/discord-bot test prime-context.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add factory/discord-bot/src/prime-context.ts factory/discord-bot/test/prime-context.test.ts
git commit -m "feat(discord-bot): prime-context entry builder"
```

---

### Task 8: System prompt builder

**Files:**
- Create: `factory/discord-bot/src/system-prompt.ts`
- Create: `factory/discord-bot/test/system-prompt.test.ts`

- [ ] **Step 1: Failing test**

Create `factory/discord-bot/test/system-prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildDiscordBotSystemPrompt } from '../src/system-prompt'

describe(`buildDiscordBotSystemPrompt`, () => {
  it(`mentions the configured repo and tool guidance`, () => {
    const prompt = buildDiscordBotSystemPrompt({ githubRepo: `electric-sql/electric` })
    expect(prompt).toContain(`electric-sql/electric`)
    expect(prompt).toContain(`spawn_horton`)
    expect(prompt).toContain(`post_message`)
    expect(prompt).toContain(`GitHub MCP`)
    expect(prompt).toMatch(/clarif/i)
  })

  it(`omits docs guidance when hasDocsSearch is false`, () => {
    const prompt = buildDiscordBotSystemPrompt({
      githubRepo: `o/r`,
      hasDocsSearch: false,
    })
    expect(prompt).not.toContain(`search_durable_agents_docs`)
  })
})
```

- [ ] **Step 2: Run failing**

Run: `pnpm --filter @electric-ax/discord-bot test system-prompt.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `factory/discord-bot/src/system-prompt.ts`:

```ts
export interface SystemPromptOptions {
  githubRepo: string
  hasDocsSearch?: boolean
}

export function buildDiscordBotSystemPrompt(opts: SystemPromptOptions): string {
  const docs = opts.hasDocsSearch
    ? `\n- search_durable_agents_docs: prefer this first for any Electric / Durable Agents question.`
    : ``
  return `You are the Electric Discord bot — a friendly, concise assistant on Discord.

You are the user-facing voice for every thread you live in. Be warm, brief, and concrete. Reply with code blocks for code, link issues and PRs by number, never @everyone, never DM users uninvited.

# Configured repo
Coding tasks operate on \`${opts.githubRepo}\`. If the user names a different repo, ask for confirmation before doing anything that would write to it (v1 only supports a single configured repo).

# Tools
- post_message / edit_message / add_reaction: reply in this thread.
- create_thread: create a new thread (rare — the adapter has usually done this for you).
- read_thread_history / read_channel_around_message: pull more conversational context when needed. Use \`read_channel_around_message\` when the user references a specific Discord message and you need surrounding context.
- spawn_horton: hand off any task that requires reading/editing code, running tests, or opening PRs. You do not run shell commands or modify files yourself.
- GitHub MCP tools (\`search_issues\`, \`get_issue\`, \`create_issue_comment\`, …): use these for GitHub Q&A. For "fix this issue" requests, fetch the issue first, then delegate to Horton with the issue body included in the brief.
- web_search, fetch_url${docs}

# When to spawn Horton
Any task involving file edits, running tests, or opening PRs. Compose the \`task\` arg as a detailed brief: paste the issue body, list acceptance criteria, name the repo and branch. Set \`initialMessage\` to the first concrete instruction. After spawning, post one short ack ("Spawned coding agent for #N, I'll report back here…") and end your turn — Horton's result will wake you again.

# Clarifying questions
If a task is under-specified — missing issue number, ambiguous acceptance criteria, unclear scope — ask in-thread before spawning Horton. One round of clarification is almost always cheaper than a wrong Horton run.

# Risky actions
Never delete Discord channels or threads. Never mass-mention. Never write to a repo other than the configured one without explicit user confirmation.

# Reporting
When Horton's report arrives, summarize it in one Discord message (PR link + 1-2 sentence summary). React ✅ on the original mention.`
}
```

- [ ] **Step 4: Verify passing**

Run: `pnpm --filter @electric-ax/discord-bot test system-prompt.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add factory/discord-bot/src/system-prompt.ts factory/discord-bot/test/system-prompt.test.ts
git commit -m "feat(discord-bot): system prompt builder"
```

---

### Task 9: `registerDiscordBot` entity

**Files:**
- Create: `factory/discord-bot/src/entity.ts`
- Create: `factory/discord-bot/test/entity.test.ts`
- Modify: `factory/discord-bot/src/index.ts`

- [ ] **Step 1: Failing test**

Create `factory/discord-bot/test/entity.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import { registerDiscordBot } from '../src/entity'

describe(`registerDiscordBot`, () => {
  it(`registers a discord-bot entity type`, () => {
    const registry = createEntityRegistry()
    registerDiscordBot(registry, {
      appId: `a`,
      botToken: `t`,
      github: { repo: `o/r`, token: `gh` },
      hortonRuntime: { agentsServerUrl: `http://a`, entityType: `horton` },
      modelCatalog: { primary: { provider: `anthropic`, model: `m`, apiKey: `k` } } as any,
    })
    const def = registry.get(`discord-bot`)
    expect(def).toBeDefined()
    expect(def?.definition.description).toMatch(/discord/i)
  })

  it(`exposes discord and delegate tools on the agent`, async () => {
    const registry = createEntityRegistry()
    const useAgent = vi.fn()
    const run = vi.fn().mockResolvedValue(undefined)
    registerDiscordBot(registry, {
      appId: `a`,
      botToken: `t`,
      github: { repo: `o/r`, token: `gh` },
      hortonRuntime: { agentsServerUrl: `http://a`, entityType: `horton` },
      modelCatalog: { primary: { provider: `anthropic`, model: `m`, apiKey: `k` } } as any,
    })
    const def = registry.get(`discord-bot`)!.definition
    const ctx: any = {
      entityUrl: `http://a/discord-bot-thread1`,
      args: { threadId: `thread1` },
      events: [],
      entries: { insert: vi.fn() },
      runtimeServerClient: { spawnEntity: vi.fn() },
      useAgent,
      agent: { run },
    }
    await def.handler(ctx)
    expect(useAgent).toHaveBeenCalledTimes(1)
    const cfg = useAgent.mock.calls[0][0]
    const names = cfg.tools.map((t: any) => t.name).sort()
    expect(names).toContain(`post_message`)
    expect(names).toContain(`spawn_horton`)
    expect(names).toContain(`read_channel_around_message`)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run failing**

Run: `pnpm --filter @electric-ax/discord-bot test entity.test`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `factory/discord-bot/src/entity.ts`:

```ts
import type {
  AgentTool,
  EntityRegistry,
  HandlerContext,
  RuntimeServerClient,
} from '@electric-ax/agents-runtime'
import type { McpServerConfig } from '@electric-ax/agents-mcp'
import { createDiscordRest } from './discord-rest'
import { createDiscordTools } from './tools/discord'
import { createSpawnHortonTool } from './tools/delegate'
import { buildDiscordBotSystemPrompt } from './system-prompt'
import { buildPrimeContextEntries } from './prime-context'
import { discordWakeMessageSchema } from './wake-message'

export interface DiscordBotOptions {
  appId: string
  botToken: string
  guildId?: string
  github: { repo: string; token: string }
  hortonRuntime: { agentsServerUrl: string; entityType: string }
  primeContext?: { messageLimit: number }
  extraTools?: ReadonlyArray<AgentTool>
  extraMcpServers?: ReadonlyArray<McpServerConfig>
  modelCatalog: unknown
  hasDocsSearch?: boolean
}

export function registerDiscordBot(
  registry: EntityRegistry,
  opts: DiscordBotOptions
): void {
  const rest = createDiscordRest({ token: opts.botToken })
  const systemPrompt = buildDiscordBotSystemPrompt({
    githubRepo: opts.github.repo,
    hasDocsSearch: opts.hasDocsSearch,
  })

  registry.define(`discord-bot`, {
    description: `Discord-facing conversational agent. One instance per Discord thread.`,
    async handler(ctx: HandlerContext) {
      const threadId = String((ctx.args as { threadId?: string }).threadId ?? ``)

      // Apply any priming present on the first wake event (kind: 'mention' with primeMessages).
      for (const event of ctx.events) {
        const msg = (event as { payload?: unknown }).payload
        const parsed = discordWakeMessageSchema.safeParse(msg)
        if (!parsed.success) continue
        if (parsed.data.kind === `mention` && parsed.data.primeMessages?.length) {
          const entries = buildPrimeContextEntries({
            channelId: parsed.data.channelId,
            threadId: parsed.data.threadId,
            messages: parsed.data.primeMessages,
          })
          for (const e of entries) {
            await ctx.entries.insert({
              key: e.key,
              text: e.text,
              attrs: e.attrs,
            })
          }
        }
        if (parsed.data.kind === `thread_close`) {
          await ctx.entries.insert({
            key: `discord-close-${parsed.data.threadId}`,
            text: `Thread closed. End the session politely.`,
            attrs: { role: `system`, source: `discord-lifecycle` },
          })
        }
      }

      const tools: Array<AgentTool> = [
        ...createDiscordTools({ rest }),
        createSpawnHortonTool({
          runtime: ctx.runtimeServerClient as RuntimeServerClient,
          hortonEntityType: opts.hortonRuntime.entityType,
          threadId,
          defaultRepo: opts.github.repo,
          parentUrl: ctx.entityUrl,
        }),
        ...(opts.extraTools ?? []),
      ]

      ctx.useAgent({
        systemPrompt,
        tools,
        // model config flows from the operator's catalog; pattern matches Horton.
        modelCatalog: opts.modelCatalog as never,
      })
      await ctx.agent.run()
    },
  })
}
```

> **Note for implementers:** The exact shape of `ctx.useAgent({ modelCatalog })` should match how `registerWorker` / `registerHorton` pass their model config — see `packages/agents/src/agents/horton.ts` and `worker.ts` for the canonical pattern (`resolveBuiltinModelConfig` + `streamFn`). Update this task's `useAgent` call to mirror that pattern verbatim before merge; the test above only asserts tool names and that `agent.run()` was called.

- [ ] **Step 4: Re-export from index**

Edit `factory/discord-bot/src/index.ts`:

```ts
export { registerDiscordBot } from './entity'
export type { DiscordBotOptions } from './entity'
export { discordWakeMessageSchema } from './wake-message'
export type { DiscordWakeMessage, ChannelMessage } from './wake-message'
```

- [ ] **Step 5: Verify passing**

Run: `pnpm --filter @electric-ax/discord-bot test entity.test`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @electric-ax/discord-bot typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add factory/discord-bot/src/entity.ts factory/discord-bot/src/index.ts factory/discord-bot/test/entity.test.ts
git commit -m "feat(discord-bot): registerDiscordBot entity"
```

---

## Phase 2 — Adapter (Node)

### Task 10: Webhook poster

**Files:**
- Create: `factory/discord-bot/src/adapter/webhook.ts`
- Create: `factory/discord-bot/test/adapter/webhook.test.ts`

- [ ] **Step 1: Failing test**

Create `factory/discord-bot/test/adapter/webhook.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createWakeWebhookPoster } from '../../src/adapter/webhook'

describe(`createWakeWebhookPoster`, () => {
  it(`POSTs the wake payload with auth header`, async () => {
    const fetchFn = vi.fn(async () => new Response(`ok`, { status: 200 }))
    const post = createWakeWebhookPoster({
      agentsServerUrl: `http://a`,
      agentsServerToken: `s`,
      fetch: fetchFn as any,
    })

    await post({
      entityType: `discord-bot`,
      entityId: `t1`,
      message: { kind: `thread_close`, threadId: `t1` },
    })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(`http://a/webhook/discord-bot`)
    expect((init as any).headers.Authorization).toBe(`Bearer s`)
    expect((init as any).method).toBe(`POST`)
  })

  it(`throws on non-2xx`, async () => {
    const fetchFn = vi.fn(async () => new Response(`bad`, { status: 500 }))
    const post = createWakeWebhookPoster({
      agentsServerUrl: `http://a`,
      agentsServerToken: `s`,
      fetch: fetchFn as any,
    })
    await expect(
      post({ entityType: `discord-bot`, entityId: `t`, message: { kind: `thread_close`, threadId: `t` } })
    ).rejects.toThrow(/500/)
  })
})
```

- [ ] **Step 2: Run failing**

Run: `pnpm --filter @electric-ax/discord-bot test adapter/webhook.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `factory/discord-bot/src/adapter/webhook.ts`:

```ts
import type { DiscordWakeMessage } from '../wake-message'

export interface WakeWebhookConfig {
  agentsServerUrl: string
  agentsServerToken: string
  fetch?: typeof globalThis.fetch
}

export interface WakeWebhookPayload {
  entityType: string
  entityId: string
  message: DiscordWakeMessage
}

export type WakeWebhookPoster = (payload: WakeWebhookPayload) => Promise<void>

export function createWakeWebhookPoster(cfg: WakeWebhookConfig): WakeWebhookPoster {
  const fetchFn = cfg.fetch ?? globalThis.fetch
  const url = `${cfg.agentsServerUrl.replace(/\/$/, ``)}/webhook/discord-bot`
  return async (payload) => {
    const res = await fetchFn(url, {
      method: `POST`,
      headers: {
        'Content-Type': `application/json`,
        Authorization: `Bearer ${cfg.agentsServerToken}`,
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => ``)
      throw new Error(`wake webhook ${url} returned ${res.status}: ${body}`)
    }
  }
}
```

- [ ] **Step 4: Verify passing**

Run: `pnpm --filter @electric-ax/discord-bot test adapter/webhook.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add factory/discord-bot/src/adapter/webhook.ts factory/discord-bot/test/adapter/webhook.test.ts
git commit -m "feat(discord-bot): adapter wake webhook poster"
```

---

### Task 11: Start-thread helper

**Files:**
- Create: `factory/discord-bot/src/adapter/thread.ts`
- Create: `factory/discord-bot/test/adapter/thread.test.ts`

- [ ] **Step 1: Failing test**

Create `factory/discord-bot/test/adapter/thread.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { ensureThreadForMention } from '../../src/adapter/thread'

describe(`ensureThreadForMention`, () => {
  it(`returns thread id when message is already inside a thread`, async () => {
    const rest = { post: vi.fn() }
    const id = await ensureThreadForMention({
      rest: rest as any,
      message: { id: `m`, channel_id: `c`, channel_is_thread: true },
    })
    expect(id).toBe(`c`)
    expect(rest.post).not.toHaveBeenCalled()
  })

  it(`creates a thread from the message when not yet in one`, async () => {
    const rest = { post: vi.fn().mockResolvedValue({ id: `new-thread` }) }
    const id = await ensureThreadForMention({
      rest: rest as any,
      message: {
        id: `m1`,
        channel_id: `c1`,
        channel_is_thread: false,
        threadName: `Topic`,
      },
    })
    expect(id).toBe(`new-thread`)
    expect(rest.post).toHaveBeenCalledWith(
      `/channels/c1/messages/m1/threads`,
      expect.objectContaining({ name: `Topic` })
    )
  })
})
```

- [ ] **Step 2: Run failing**

Run: `pnpm --filter @electric-ax/discord-bot test adapter/thread.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `factory/discord-bot/src/adapter/thread.ts`:

```ts
import type { DiscordRest } from '../discord-rest'

export interface EnsureThreadInput {
  rest: DiscordRest
  message: {
    id: string
    channel_id: string
    channel_is_thread: boolean
    threadName?: string
  }
}

export async function ensureThreadForMention(input: EnsureThreadInput): Promise<string> {
  if (input.message.channel_is_thread) return input.message.channel_id
  const name = (input.message.threadName ?? `Electric bot session`).slice(0, 100)
  const thread = (await input.rest.post(
    `/channels/${input.message.channel_id}/messages/${input.message.id}/threads`,
    { name, auto_archive_duration: 1440 }
  )) as { id: string }
  return thread.id
}
```

- [ ] **Step 4: Verify passing**

Run: `pnpm --filter @electric-ax/discord-bot test adapter/thread.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add factory/discord-bot/src/adapter/thread.ts factory/discord-bot/test/adapter/thread.test.ts
git commit -m "feat(discord-bot): adapter ensureThreadForMention helper"
```

---

### Task 12: Gateway event → wake mapper

**Files:**
- Create: `factory/discord-bot/src/adapter/gateway-mapper.ts`
- Create: `factory/discord-bot/test/adapter/gateway-mapper.test.ts`

The mapper is a pure function (Discord event JSON → `DiscordWakeMessage | null`) so we can test it cleanly without a live Gateway connection.

- [ ] **Step 1: Failing test**

Create `factory/discord-bot/test/adapter/gateway-mapper.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mapMessageCreate } from '../../src/adapter/gateway-mapper'

describe(`mapMessageCreate`, () => {
  const botUserId = `bot1`

  it(`maps an @bot mention in a regular channel to a mention wake (no threadId yet)`, () => {
    const out = mapMessageCreate({
      botUserId,
      message: {
        id: `m1`,
        channel_id: `c1`,
        author: { id: `u1`, username: `alice`, bot: false },
        content: `<@bot1> hello`,
        mentions: [{ id: botUserId }],
        referenced_message: null,
        thread: null,
        attachments: [],
      },
      channelIsThread: false,
    })
    expect(out).toMatchObject({
      kind: `pre_thread_mention`,
      channelId: `c1`,
      messageId: `m1`,
      userId: `u1`,
      content: `hello`,
    })
  })

  it(`maps a message inside a thread to thread_msg`, () => {
    const out = mapMessageCreate({
      botUserId,
      message: {
        id: `m2`,
        channel_id: `t1`,
        author: { id: `u1`, username: `alice`, bot: false },
        content: `follow-up`,
        mentions: [],
        referenced_message: null,
        thread: null,
        attachments: [],
      },
      channelIsThread: true,
    })
    expect(out).toMatchObject({ kind: `thread_msg`, threadId: `t1`, content: `follow-up` })
  })

  it(`ignores messages from the bot itself`, () => {
    const out = mapMessageCreate({
      botUserId,
      message: {
        id: `m`,
        channel_id: `t`,
        author: { id: botUserId, username: `bot`, bot: true },
        content: `hi`,
        mentions: [],
        referenced_message: null,
        thread: null,
        attachments: [],
      },
      channelIsThread: true,
    })
    expect(out).toBeNull()
  })

  it(`ignores non-mention messages in a regular channel`, () => {
    const out = mapMessageCreate({
      botUserId,
      message: {
        id: `m`,
        channel_id: `c`,
        author: { id: `u`, username: `a`, bot: false },
        content: `hello world`,
        mentions: [],
        referenced_message: null,
        thread: null,
        attachments: [],
      },
      channelIsThread: false,
    })
    expect(out).toBeNull()
  })
})
```

- [ ] **Step 2: Run failing**

Run: `pnpm --filter @electric-ax/discord-bot test adapter/gateway-mapper.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `factory/discord-bot/src/adapter/gateway-mapper.ts`:

```ts
import type { DiscordWakeMessage } from '../wake-message'

interface RawDiscordMessage {
  id: string
  channel_id: string
  author: { id: string; username: string; bot?: boolean }
  content: string
  mentions: Array<{ id: string }>
  referenced_message: { id: string } | null
  thread: { id: string } | null
  attachments: Array<{ id: string; url: string; content_type?: string; filename?: string }>
}

export type GatewayMapInput = {
  botUserId: string
  message: RawDiscordMessage
  channelIsThread: boolean
}

export type GatewayMapOutput =
  | (DiscordWakeMessage & { kind: `thread_msg` })
  | { kind: `pre_thread_mention`; channelId: string; messageId: string; userId: string; content: string; referencedMessageId?: string }
  | null

function stripMentions(content: string): string {
  return content.replace(/<@!?\d+>/g, ``).trim()
}

export function mapMessageCreate(input: GatewayMapInput): GatewayMapOutput {
  const { botUserId, message, channelIsThread } = input
  if (message.author.bot && message.author.id === botUserId) return null

  if (channelIsThread) {
    return {
      kind: `thread_msg`,
      threadId: message.channel_id,
      userId: message.author.id,
      content: stripMentions(message.content),
      referencedMessageId: message.referenced_message?.id,
      attachments: message.attachments.map((a) => ({
        id: a.id,
        url: a.url,
        contentType: a.content_type,
        filename: a.filename,
      })),
      idempotencyKey: message.id,
    }
  }

  // Non-thread channel: only react to direct mentions.
  if (!message.mentions.some((m) => m.id === botUserId)) return null
  return {
    kind: `pre_thread_mention`,
    channelId: message.channel_id,
    messageId: message.id,
    userId: message.author.id,
    content: stripMentions(message.content),
    referencedMessageId: message.referenced_message?.id ?? undefined,
  }
}
```

- [ ] **Step 4: Verify passing**

Run: `pnpm --filter @electric-ax/discord-bot test adapter/gateway-mapper.test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add factory/discord-bot/src/adapter/gateway-mapper.ts factory/discord-bot/test/adapter/gateway-mapper.test.ts
git commit -m "feat(discord-bot): pure gateway event → wake mapper"
```

---

### Task 13: Gateway runtime (discord.js wrapper)

**Files:**
- Create: `factory/discord-bot/src/adapter/gateway.ts`
- Create: `factory/discord-bot/test/adapter/gateway.test.ts`

This task wires the mapper to discord.js. Limited test scope: we verify the wrapper subscribes to the right event and that it forwards mapped events through the supplied callback. We do *not* spin up a live discord.js client; we inject a fake client that emits.

- [ ] **Step 1: Failing test**

Create `factory/discord-bot/test/adapter/gateway.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { startGatewayClient } from '../../src/adapter/gateway'

describe(`startGatewayClient`, () => {
  it(`forwards mention as pre_thread_mention via onEvent`, async () => {
    const client = new EventEmitter() as any
    client.login = vi.fn().mockResolvedValue(undefined)
    client.user = { id: `bot1` }
    client.channels = { fetch: vi.fn().mockResolvedValue({ isThread: () => false }) }

    const onEvent = vi.fn()
    await startGatewayClient({
      token: `t`,
      botUserId: `bot1`,
      onEvent,
      createClient: () => client,
    })

    client.emit(`messageCreate`, {
      id: `m1`,
      channel_id: `c1`,
      author: { id: `u1`, username: `a`, bot: false },
      content: `<@bot1> hello`,
      mentions: [{ id: `bot1` }],
      referenced_message: null,
      attachments: [],
    })

    await new Promise((r) => setImmediate(r))
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent.mock.calls[0][0]).toMatchObject({
      kind: `pre_thread_mention`,
      channelId: `c1`,
    })
  })
})
```

- [ ] **Step 2: Run failing**

Run: `pnpm --filter @electric-ax/discord-bot test adapter/gateway.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `factory/discord-bot/src/adapter/gateway.ts`:

```ts
import { Client, GatewayIntentBits } from 'discord.js'
import { mapMessageCreate, type GatewayMapOutput } from './gateway-mapper'

export interface GatewayConfig {
  token: string
  botUserId: string
  onEvent: (event: GatewayMapOutput & object) => void | Promise<void>
  createClient?: () => unknown
}

export async function startGatewayClient(cfg: GatewayConfig): Promise<{ stop: () => Promise<void> }> {
  const client =
    (cfg.createClient?.() as Client) ??
    new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
      ],
    })

  ;(client as unknown as { on: Function }).on(`messageCreate`, async (raw: any) => {
    let channelIsThread = false
    try {
      const channel = await (client as any).channels.fetch(raw.channel_id ?? raw.channelId)
      channelIsThread = typeof channel?.isThread === `function` ? channel.isThread() : false
    } catch {
      channelIsThread = false
    }
    const mapped = mapMessageCreate({
      botUserId: cfg.botUserId,
      message: {
        id: raw.id,
        channel_id: raw.channel_id ?? raw.channelId,
        author: { id: raw.author.id, username: raw.author.username, bot: raw.author.bot },
        content: raw.content,
        mentions: (raw.mentions ?? []).map((m: any) => ({ id: m.id ?? m })),
        referenced_message: raw.referenced_message ?? null,
        thread: null,
        attachments: raw.attachments ?? [],
      },
      channelIsThread,
    })
    if (mapped) await cfg.onEvent(mapped)
  })

  if (typeof (client as any).login === `function` && cfg.token) {
    await (client as any).login(cfg.token)
  }

  return {
    async stop() {
      if (typeof (client as any).destroy === `function`) await (client as any).destroy()
    },
  }
}
```

> **Note for implementers:** discord.js delivers structured `Message` objects, not raw payloads — the property names differ slightly (`channelId` vs `channel_id`, `message.mentions.users` etc.). The shim above accepts both; you may want to tighten typing against `Message` from discord.js once the smoke test is running. Don't over-engineer this in the unit test — the integration test in Task 16 covers the full path.

- [ ] **Step 4: Verify passing**

Run: `pnpm --filter @electric-ax/discord-bot test adapter/gateway.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add factory/discord-bot/src/adapter/gateway.ts factory/discord-bot/test/adapter/gateway.test.ts
git commit -m "feat(discord-bot): gateway client wrapper around discord.js"
```

---

### Task 14: Interactions endpoint (Ed25519 verify + dispatch)

**Files:**
- Create: `factory/discord-bot/src/adapter/interactions.ts`
- Create: `factory/discord-bot/test/adapter/interactions.test.ts`

- [ ] **Step 1: Failing test**

Create `factory/discord-bot/test/adapter/interactions.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import {
  generateKeyPairSync,
  sign,
} from 'node:crypto'
import { handleInteraction } from '../../src/adapter/interactions'

function signedRequest(privateKey: any, body: string): { timestamp: string; signature: string } {
  const timestamp = `${Date.now()}`
  const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString(`hex`)
  return { timestamp, signature }
}

describe(`handleInteraction`, () => {
  const { publicKey, privateKey } = generateKeyPairSync(`ed25519`)
  const publicKeyHex = (publicKey.export({ format: `der`, type: `spki` }) as Buffer)
    .subarray(-32)
    .toString(`hex`)

  it(`401s on bad signature`, async () => {
    const onEvent = vi.fn()
    const result = await handleInteraction({
      publicKeyHex,
      body: `{}`,
      timestamp: `1`,
      signature: `00`.repeat(64),
      onEvent,
    })
    expect(result.status).toBe(401)
    expect(onEvent).not.toHaveBeenCalled()
  })

  it(`responds to PING with PONG`, async () => {
    const body = JSON.stringify({ type: 1 })
    const { timestamp, signature } = signedRequest(privateKey, body)
    const onEvent = vi.fn()
    const result = await handleInteraction({
      publicKeyHex,
      body,
      timestamp,
      signature,
      onEvent,
    })
    expect(result.status).toBe(200)
    expect(JSON.parse(result.body!)).toEqual({ type: 1 })
    expect(onEvent).not.toHaveBeenCalled()
  })

  it(`dispatches a slash command to onEvent`, async () => {
    const body = JSON.stringify({
      type: 2,
      id: `i1`,
      channel_id: `t1`,
      member: { user: { id: `u1` } },
      data: { name: `end`, options: [] },
    })
    const { timestamp, signature } = signedRequest(privateKey, body)
    const onEvent = vi.fn()
    const result = await handleInteraction({
      publicKeyHex,
      body,
      timestamp,
      signature,
      onEvent,
    })
    expect(result.status).toBe(200)
    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent.mock.calls[0][0]).toMatchObject({
      kind: `interaction`,
      threadId: `t1`,
      userId: `u1`,
      command: `/end`,
    })
  })
})
```

- [ ] **Step 2: Run failing**

Run: `pnpm --filter @electric-ax/discord-bot test adapter/interactions.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `factory/discord-bot/src/adapter/interactions.ts`:

```ts
import { createPublicKey, verify } from 'node:crypto'
import type { DiscordWakeMessage } from '../wake-message'

export interface InteractionInput {
  publicKeyHex: string
  body: string
  timestamp: string
  signature: string
  onEvent: (event: DiscordWakeMessage) => void | Promise<void>
}

export interface InteractionResult {
  status: number
  body?: string
  headers?: Record<string, string>
}

function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex, `hex`)
}

function spkiFromRawPublicKey(raw: Buffer): Buffer {
  // Ed25519 SPKI prefix
  const prefix = Buffer.from([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
  ])
  return Buffer.concat([prefix, raw])
}

export async function handleInteraction(input: InteractionInput): Promise<InteractionResult> {
  try {
    const pubRaw = hexToBuffer(input.publicKeyHex)
    const key = createPublicKey({ key: spkiFromRawPublicKey(pubRaw), format: `der`, type: `spki` })
    const valid = verify(
      null,
      Buffer.from(input.timestamp + input.body),
      key,
      hexToBuffer(input.signature)
    )
    if (!valid) return { status: 401, body: `invalid signature` }
  } catch {
    return { status: 401, body: `invalid signature` }
  }

  const payload = JSON.parse(input.body) as {
    type: number
    id?: string
    channel_id?: string
    member?: { user?: { id: string } }
    user?: { id: string }
    data?: { name?: string; options?: Array<{ name: string; value: string | number | boolean }> }
  }

  // PING
  if (payload.type === 1) {
    return { status: 200, headers: { 'Content-Type': `application/json` }, body: JSON.stringify({ type: 1 }) }
  }

  // APPLICATION_COMMAND (slash command)
  if (payload.type === 2) {
    const command = `/${payload.data?.name ?? ``}`
    const userId = payload.member?.user?.id ?? payload.user?.id ?? `unknown`
    const threadId = payload.channel_id ?? ``
    const options: Record<string, string | number | boolean> = {}
    for (const opt of payload.data?.options ?? []) options[opt.name] = opt.value
    await input.onEvent({
      kind: `interaction`,
      threadId,
      userId,
      command,
      options,
      idempotencyKey: payload.id,
    })
    // Acknowledge with a deferred response so the entity can post via REST.
    return {
      status: 200,
      headers: { 'Content-Type': `application/json` },
      body: JSON.stringify({ type: 5 }),
    }
  }

  return { status: 200, body: `{}` }
}
```

- [ ] **Step 4: Verify passing**

Run: `pnpm --filter @electric-ax/discord-bot test adapter/interactions.test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add factory/discord-bot/src/adapter/interactions.ts factory/discord-bot/test/adapter/interactions.test.ts
git commit -m "feat(discord-bot): interactions Ed25519 verify + dispatch"
```

---

### Task 15: Node host composition

**Files:**
- Create: `factory/discord-bot/src/adapter/host-node.ts`
- Create: `factory/discord-bot/test/adapter/host-node.test.ts`

The host composes Gateway + Interactions + webhook poster. We test the dispatch loop (pre-thread mention → start thread → wake) in isolation by injecting fakes; the live HTTP server is exercised in the integration test (Task 16).

- [ ] **Step 1: Failing test**

Create `factory/discord-bot/test/adapter/host-node.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { processGatewayEvent } from '../../src/adapter/host-node'

describe(`processGatewayEvent`, () => {
  it(`starts a thread on pre_thread_mention then posts a wake`, async () => {
    const rest = {
      get: vi.fn().mockResolvedValue([]),
      post: vi.fn().mockResolvedValue({ id: `new-thread` }),
      patch: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    }
    const postWake = vi.fn().mockResolvedValue(undefined)
    await processGatewayEvent(
      {
        kind: `pre_thread_mention`,
        channelId: `c1`,
        messageId: `m1`,
        userId: `u1`,
        content: `hello`,
      },
      {
        rest: rest as any,
        postWake,
        primeMessageLimit: 5,
      }
    )
    expect(rest.post).toHaveBeenCalledWith(
      `/channels/c1/messages/m1/threads`,
      expect.objectContaining({ name: expect.any(String) })
    )
    expect(rest.get).toHaveBeenCalledWith(
      expect.stringContaining(`/channels/c1/messages?limit=5`)
    )
    expect(postWake).toHaveBeenCalledTimes(1)
    expect(postWake.mock.calls[0][0]).toMatchObject({
      entityType: `discord-bot`,
      entityId: `new-thread`,
      message: { kind: `mention`, threadId: `new-thread`, channelId: `c1` },
    })
  })

  it(`forwards thread_msg straight through`, async () => {
    const rest = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() }
    const postWake = vi.fn().mockResolvedValue(undefined)
    await processGatewayEvent(
      { kind: `thread_msg`, threadId: `t1`, userId: `u`, content: `hi`, idempotencyKey: `m` },
      { rest: rest as any, postWake, primeMessageLimit: 20 }
    )
    expect(rest.post).not.toHaveBeenCalled()
    expect(postWake.mock.calls[0][0]).toMatchObject({
      entityId: `t1`,
      message: { kind: `thread_msg`, threadId: `t1` },
    })
  })
})
```

- [ ] **Step 2: Run failing**

Run: `pnpm --filter @electric-ax/discord-bot test adapter/host-node.test`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `factory/discord-bot/src/adapter/host-node.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createDiscordRest, type DiscordRest } from '../discord-rest'
import { loadConfig } from '../config'
import { startGatewayClient } from './gateway'
import { handleInteraction } from './interactions'
import { ensureThreadForMention } from './thread'
import { createWakeWebhookPoster, type WakeWebhookPoster, type WakeWebhookPayload } from './webhook'
import type { GatewayMapOutput } from './gateway-mapper'

export interface ProcessGatewayDeps {
  rest: DiscordRest
  postWake: WakeWebhookPoster
  primeMessageLimit: number
}

export async function processGatewayEvent(
  event: NonNullable<GatewayMapOutput>,
  deps: ProcessGatewayDeps
): Promise<void> {
  if (event.kind === `thread_msg`) {
    await deps.postWake({
      entityType: `discord-bot`,
      entityId: event.threadId,
      message: event,
    })
    return
  }

  // pre_thread_mention: create thread + fetch priming messages + post wake
  const threadId = await ensureThreadForMention({
    rest: deps.rest,
    message: {
      id: event.messageId,
      channel_id: event.channelId,
      channel_is_thread: false,
      threadName: event.content.slice(0, 50) || `Electric bot`,
    },
  })

  const primeRaw = (await deps.rest.get(
    `/channels/${event.channelId}/messages?limit=${deps.primeMessageLimit}`
  )) as Array<{
    id: string
    author: { username: string }
    content: string
    timestamp: string
  }>
  const primeMessages = primeRaw.map((m) => ({
    id: m.id,
    author: m.author.username,
    content: m.content,
    timestamp: new Date(m.timestamp).getTime(),
  }))

  const payload: WakeWebhookPayload = {
    entityType: `discord-bot`,
    entityId: threadId,
    message: {
      kind: `mention`,
      threadId,
      channelId: event.channelId,
      userId: event.userId,
      content: event.content,
      referencedMessageId: event.referencedMessageId,
      primeMessages,
      idempotencyKey: event.messageId,
    },
  }
  await deps.postWake(payload)
}

async function readBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Array<Buffer> = []
    req.on(`data`, (c) => chunks.push(c as Buffer))
    req.on(`end`, () => resolve(Buffer.concat(chunks).toString(`utf8`)))
    req.on(`error`, reject)
  })
}

export async function main(): Promise<void> {
  try { (process as any).loadEnvFile?.() } catch {}
  const cfg = loadConfig()
  const rest = createDiscordRest({ token: cfg.discord.botToken })
  const postWake = createWakeWebhookPoster({
    agentsServerUrl: cfg.agentsServer.url,
    agentsServerToken: cfg.agentsServer.token,
  })

  const { stop } = await startGatewayClient({
    token: cfg.discord.botToken,
    botUserId: cfg.discord.appId,
    onEvent: (event) =>
      processGatewayEvent(event as NonNullable<GatewayMapOutput>, {
        rest,
        postWake,
        primeMessageLimit: cfg.primeContext.messageLimit,
      }),
  })

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== `POST` || req.url !== `/interactions`) {
      res.writeHead(404).end()
      return
    }
    const body = await readBody(req)
    const result = await handleInteraction({
      publicKeyHex: cfg.discord.publicKey,
      body,
      timestamp: String(req.headers[`x-signature-timestamp`] ?? ``),
      signature: String(req.headers[`x-signature-ed25519`] ?? ``),
      onEvent: (event) =>
        postWake({ entityType: `discord-bot`, entityId: event.threadId, message: event }),
    })
    res.writeHead(result.status, result.headers ?? {})
    res.end(result.body ?? ``)
  })
  server.listen(cfg.adapter.port, () => {
    console.log(`discord-bot adapter listening on :${cfg.adapter.port}`)
  })

  const onSignal = async () => {
    await stop()
    server.close()
    process.exit(0)
  }
  process.on(`SIGINT`, onSignal)
  process.on(`SIGTERM`, onSignal)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main()
}
```

- [ ] **Step 4: Verify passing**

Run: `pnpm --filter @electric-ax/discord-bot test adapter/host-node.test`
Expected: PASS.

- [ ] **Step 5: Typecheck the package end-to-end**

Run: `pnpm --filter @electric-ax/discord-bot typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add factory/discord-bot/src/adapter/host-node.ts factory/discord-bot/test/adapter/host-node.test.ts
git commit -m "feat(discord-bot): node adapter host (gateway + interactions)"
```

---

### Task 16: End-to-end integration test

**Files:**
- Create: `factory/discord-bot/test/integration/end-to-end.test.ts`

This test boots the adapter logic + the entity registration with stubbed Discord REST, mocked agents-server webhook, and a stub Horton entity in the registry. It drives a `pre_thread_mention` through `processGatewayEvent`, verifies the wake fires, manually invokes the entity handler with the wake (simulating the agents-server), and asserts `spawn_horton` is invoked when the agent's mock streamFn produces a tool-use for it.

- [ ] **Step 1: Write the integration test**

Create `factory/discord-bot/test/integration/end-to-end.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import { processGatewayEvent } from '../../src/adapter/host-node'
import { registerDiscordBot } from '../../src/entity'
import type { GatewayMapOutput } from '../../src/adapter/gateway-mapper'

describe(`discord-bot end-to-end (adapter → wake → entity)`, () => {
  it(`creates a thread on mention, primes context, dispatches wake, and invokes the agent`, async () => {
    const restGet = vi.fn().mockImplementation(async (path: string) => {
      if (path.includes(`/channels/c1/messages?limit=`)) {
        return [
          { id: `p1`, author: { username: `alice` }, content: `prior`, timestamp: `2026-05-13T10:00:00Z` },
        ]
      }
      return []
    })
    const restPost = vi.fn().mockResolvedValue({ id: `new-thread` })
    const rest = { get: restGet, post: restPost, patch: vi.fn(), put: vi.fn(), delete: vi.fn() }
    const wakes: any[] = []
    const postWake = async (payload: any) => {
      wakes.push(payload)
    }

    const pre: NonNullable<GatewayMapOutput> = {
      kind: `pre_thread_mention`,
      channelId: `c1`,
      messageId: `m1`,
      userId: `u1`,
      content: `fix issue 4312`,
    }
    await processGatewayEvent(pre, { rest: rest as any, postWake, primeMessageLimit: 5 })

    expect(wakes).toHaveLength(1)
    const wake = wakes[0]
    expect(wake.entityId).toBe(`new-thread`)
    expect(wake.message.kind).toBe(`mention`)
    expect(wake.message.primeMessages).toHaveLength(1)

    // Now hand the wake to the entity (simulating what agents-server would do).
    const registry = createEntityRegistry()
    const useAgent = vi.fn()
    const agentRun = vi.fn().mockResolvedValue(undefined)
    registerDiscordBot(registry, {
      appId: `a`,
      botToken: `t`,
      github: { repo: `o/r`, token: `gh` },
      hortonRuntime: { agentsServerUrl: `http://a`, entityType: `horton` },
      modelCatalog: { primary: { provider: `anthropic`, model: `m`, apiKey: `k` } } as any,
    })
    const entriesInsert = vi.fn()
    const def = registry.get(`discord-bot`)!.definition
    await def.handler({
      entityUrl: `http://a/discord-bot-new-thread`,
      args: { threadId: `new-thread` },
      events: [{ payload: wake.message }],
      entries: { insert: entriesInsert },
      runtimeServerClient: { spawnEntity: vi.fn() },
      useAgent,
      agent: { run: agentRun },
    } as any)

    expect(entriesInsert).toHaveBeenCalledTimes(1)
    expect(entriesInsert.mock.calls[0][0].key).toContain(`discord-prime-c1-new-thread`)
    expect(useAgent).toHaveBeenCalledTimes(1)
    const toolNames = (useAgent.mock.calls[0][0] as any).tools.map((t: any) => t.name)
    expect(toolNames).toEqual(
      expect.arrayContaining([`post_message`, `spawn_horton`, `read_channel_around_message`])
    )
    expect(agentRun).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Verify passing**

Run: `pnpm --filter @electric-ax/discord-bot test integration/end-to-end.test`
Expected: PASS.

- [ ] **Step 3: Full test suite**

Run: `pnpm --filter @electric-ax/discord-bot test`
Expected: all tests across Tasks 2–16 pass.

- [ ] **Step 4: Commit**

```bash
git add factory/discord-bot/test/integration/end-to-end.test.ts
git commit -m "test(discord-bot): adapter → wake → entity integration test"
```

---

## Phase 3 — Binaries & docs

### Task 17: Slash command registration script

**Files:**
- Create: `factory/discord-bot/src/adapter/register-commands.ts`

No automated test — this is a one-shot operator script. Verified manually against the live Discord API in the README runbook.

- [ ] **Step 1: Implement**

Create `factory/discord-bot/src/adapter/register-commands.ts`:

```ts
import { createDiscordRest } from '../discord-rest'
import { loadConfig } from '../config'

async function main(): Promise<void> {
  try { (process as any).loadEnvFile?.() } catch {}
  const cfg = loadConfig()
  const rest = createDiscordRest({ token: cfg.discord.botToken })
  const commands = [
    {
      name: `end`,
      description: `End this Discord bot session.`,
    },
  ]
  const path = cfg.discord.guildId
    ? `/applications/${cfg.discord.appId}/guilds/${cfg.discord.guildId}/commands`
    : `/applications/${cfg.discord.appId}/commands`
  await rest.put(path, commands)
  console.log(`Registered ${commands.length} command(s) at ${path}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main()
}
```

- [ ] **Step 2: Build**

Run: `pnpm --filter @electric-ax/discord-bot build`
Expected: produces `dist/host-node.js` and `dist/register-commands.js` alongside `dist/index.{js,cjs,d.ts}`.

- [ ] **Step 3: Commit**

```bash
git add factory/discord-bot/src/adapter/register-commands.ts
git commit -m "feat(discord-bot): slash command registration CLI"
```

---

### Task 18: README

**Files:**
- Create: `factory/discord-bot/README.md`

- [ ] **Step 1: Write the README**

Create `factory/discord-bot/README.md`:

````markdown
# `@electric-ax/discord-bot`

Discord adapter + per-thread `discord-bot` entity for Electric Agents.

See the design spec: `docs/superpowers/specs/2026-05-13-discord-bot-design.md`.

## What it does

- `@bot <question>` in a Discord channel opens a thread and answers — using GitHub MCP, Electric Agents docs, and web search.
- `@bot fix issue #N` opens a thread and hands the task to a Horton coding agent running in a separate runtime host; the bot reports back with the PR when Horton finishes.
- Asks clarifying questions in-thread when a task is under-specified.
- Extensible via `extraTools`, `extraMcpServers`, and `skills` at register time.

## Architecture

Two layers in this package:

- **Adapter (Node process):** holds the Discord Gateway WebSocket + an HTTP Interactions endpoint, translates Discord events into webhook POSTs to your `agents-server`.
- **Entity:** registered into your existing `agents-server` registry via `registerDiscordBot(registry, opts)`. One instance per Discord thread. Tools use raw `fetch` (no Node-only APIs) so a future Cloudflare DO host can reuse the entity unchanged.

## Discord application setup

1. https://discord.com/developers/applications → New Application.
2. Bot tab → Add Bot → reveal Token (`DISCORD_BOT_TOKEN`).
3. Enable Privileged Gateway Intents → `MESSAGE CONTENT INTENT`.
4. OAuth2 → URL Generator → scopes `bot`, `applications.commands` → bot permissions: Send Messages, Create Public Threads, Send Messages in Threads, Read Message History, Add Reactions. Use the generated URL to invite to your guild.
5. General Information → copy `Public Key` (`DISCORD_PUBLIC_KEY`) and `Application ID` (`DISCORD_APP_ID`).
6. General Information → Interactions Endpoint URL → set to `https://<your-public-host>/interactions` (Discord verifies this at save time, so deploy first or use a tunnel).

## Configuration

Environment variables (alternatively pass an options object to `registerDiscordBot`):

```
DISCORD_BOT_TOKEN              gateway login + REST calls
DISCORD_PUBLIC_KEY             Ed25519 verification key
DISCORD_APP_ID
DISCORD_GUILD_ID               optional, scope bot to one guild

AGENTS_SERVER_URL              wake webhook target
AGENTS_SERVER_TOKEN            shared secret for webhook auth

HORTON_AGENTS_SERVER_URL       defaults to AGENTS_SERVER_URL
HORTON_ENTITY_TYPE             default 'horton'

GITHUB_TOKEN
GITHUB_REPO                    owner/name (v1: single repo)

DISCORD_ADAPTER_PORT           default 4449
DISCORD_PRIME_MESSAGE_LIMIT    default 20

ANTHROPIC_API_KEY | OPENAI_API_KEY
```

GitHub MCP is configured via your existing `agents-server` `mcp.json` or `extraMcpServers`; the bot consumes whatever MCP tools the runtime exposes.

## Register the entity in your agents-server

Add to your agents-server bootstrap, next to `registerHorton` / `registerWorker`:

```ts
import { registerDiscordBot } from '@electric-ax/discord-bot'

registerDiscordBot(registry, {
  appId: process.env.DISCORD_APP_ID!,
  botToken: process.env.DISCORD_BOT_TOKEN!,
  guildId: process.env.DISCORD_GUILD_ID,
  github: { repo: process.env.GITHUB_REPO!, token: process.env.GITHUB_TOKEN! },
  hortonRuntime: {
    agentsServerUrl: process.env.HORTON_AGENTS_SERVER_URL ?? process.env.AGENTS_SERVER_URL!,
    entityType: process.env.HORTON_ENTITY_TYPE ?? 'horton',
  },
  modelCatalog,                  // same catalog you use for Horton
  primeContext: { messageLimit: 20 },
  // extraTools: [...], extraMcpServers: [...], skills: ...,
})
```

## Run the adapter

```sh
# Register slash commands once (per guild or globally)
pnpm --filter @electric-ax/discord-bot exec discord-bot-register

# Start the adapter (Gateway + Interactions)
pnpm --filter @electric-ax/discord-bot exec discord-bot
```

The adapter and your `agents-server` are separate processes; you typically run them side-by-side on the same machine. Point your Discord application's Interactions Endpoint URL at `https://<public-host>/interactions` — terminate TLS in front of the adapter (nginx, Caddy, Cloudflare Tunnel, …).

## Extension points

- `extraTools`: any `AgentTool` shape from `@mariozechner/pi-agent-core`; the entity exposes them alongside `discord.*` and `spawn_horton`.
- `extraMcpServers`: passed to the agents-server's MCP registry; the bot automatically picks up the bridged tools.
- `skills`: a `SkillsRegistry` (same shape Horton uses); the bot gains `use_skill` / `remove_skill` and the skills catalog.

## Troubleshooting

- **Gateway connects then disconnects with code 4014.** Privileged Intents not enabled on the application — re-check step 3 above.
- **Interactions endpoint URL rejected at save time.** Your endpoint must be reachable over HTTPS *before* you click Save in the Developer Portal; deploy first, then save.
- **Signature checks fail.** `DISCORD_PUBLIC_KEY` must be the hex string from the Developer Portal (no `0x` prefix, no whitespace).
- **Bot replies in the wrong place.** The adapter assumes `entityId = threadId`. If your `agents-server` routes by something else, the wake will be dropped — confirm webhook handling.
- **GitHub MCP tools missing.** GH MCP is *not* bundled here; it must be configured in your `agents-server` (`mcp.json` or `extraMcpServers`). The bot looks up MCP tools from the runtime tool-provider registry.

## Future deploys

A full Cloudflare Durable Object deploy (Gateway via WebSocket Hibernation API + Interactions + in-DO entity host) is on the roadmap — see §10 of the spec. The v1 entity is already constrained to runtime-portable APIs so it can drop into a DO host without rewrites.
````

- [ ] **Step 2: Commit**

```bash
git add factory/discord-bot/README.md
git commit -m "docs(discord-bot): README — setup, configuration, run, troubleshooting"
```

---

## Final verification

- [ ] **Run the full package test suite**

Run: `pnpm --filter @electric-ax/discord-bot test`
Expected: every test from Tasks 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 passes.

- [ ] **Build**

Run: `pnpm --filter @electric-ax/discord-bot build`
Expected: `dist/index.{js,cjs,d.ts}`, `dist/host-node.js`, `dist/register-commands.js` all produced.

- [ ] **Typecheck**

Run: `pnpm --filter @electric-ax/discord-bot typecheck`
Expected: exit 0.

- [ ] **Lint**

Run: `pnpm --filter @electric-ax/discord-bot stylecheck`
Expected: exit 0 (fix any reported issues — typically eslint pickups from new files; the project's existing config governs).

---

## Self-review

**Spec coverage:**

| Spec section / req | Task |
|---|---|
| §1 deliverables (`factory/discord-bot/`, adapter + entity) | 1, 9, 15 |
| §2 goal 1 (Q&A) | 9 + 16 (system prompt + tools + integration) |
| §2 goal 2 (fix-issue → Horton) | 5, 9 |
| §2 goal 3 (clarifying questions) | 8 (system prompt) |
| §2 goal 4 (priming + read_channel_around_message) | 4, 7, 9, 15 |
| §2 goal 5 (extensibility — extraTools, extraMcpServers, skills) | 9 (options surface) |
| §2 goal 6 (entity uses runtime-portable APIs only) | 3 (raw fetch REST), 4, 5, 6, 7, 8, 9 |
| §2 goal 7 (self-host README) | 18 |
| §3 architecture | 9 + 15 |
| §4 lifecycle (mention / thread_msg / interaction / thread_close / child_completed) | 6, 9 (wake schema + entity dispatch), 12 (mapper), 14 (interactions) |
| §5.1 public surface (`registerDiscordBot`) | 9 |
| §5.2 wake payload contract | 6 |
| §5.3 tools (discord.*, delegate, MCP, reused) | 4, 5; MCP is operator-supplied (§7) |
| §5.4 context priming (both paths) | 4 (read_channel_around_message), 7 (one-shot), 15 (adapter fetch) |
| §5.5 system prompt | 8 |
| §6 data flows (Journey A + B + cross-cutting) | 16 |
| §7 configuration (env vars, options) | 2 |
| §8 packaging (workspace, binaries, README) | 1, 17, 18 |
| §9 testing | tasks 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 |
| §10 future work | docs-only — README §"Future deploys", spec §10 |

No spec gaps.

**Placeholder scan:** every step has concrete code or commands. No `TODO`, no "implement later", no "add appropriate error handling". The only narrative notes are explicit *implementer hints* in Tasks 9 and 13 pointing at Horton as the canonical pattern for model-config wiring and discord.js Message typing — those are intentional and not placeholders.

**Type consistency:**
- `DiscordWakeMessage` union (Task 6) is consumed verbatim by `entity.ts` (Task 9), `webhook.ts` (Task 10), `host-node.ts` (Task 15).
- `DiscordRest` interface (Task 3) is consumed by `tools/discord.ts` (Task 4), `adapter/thread.ts` (Task 11), `adapter/host-node.ts` (Task 15).
- `WakeWebhookPayload` (Task 10) consumed by `host-node.ts` (Task 15).
- `GatewayMapOutput` (Task 12) consumed by `adapter/gateway.ts` (Task 13) and `host-node.ts` (Task 15).
- `registerDiscordBot` options (`DiscordBotOptions`, Task 9) match config shape (Task 2) field-for-field.

All consistent.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-13-discord-bot.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
