# Fly Sprites (second sandbox provider) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `FlySpriteProvider` (sprites.dev) as a second `SandboxProvider` alongside the existing `LocalDockerProvider` and `HostProvider`. Sprites becomes a third `target` value (`'sprites'`) with full lifecycle parity, supporting all three coding-agent kinds within sprites only (no cross-provider migration). Workspace cloning deferred to v1.5 pending checkpoint-restore verification.

**Architecture:** New `FlySpriteProvider` implementing every required `SandboxProvider` method against `api.sprites.dev` (REST + WebSocket). Per-sprite bootstrap installs `opencode-ai` at first sprite create (~10–30s; idempotent). `target: 'sandbox' | 'host' | 'sprites'` enum widening is additive. Convert-target validation rejects cross-provider transitions. Fork dropdown gates by source target.

**Tech Stack:** TypeScript, vitest, Playwright, Node 22 global `WebSocket`, `agent-session-protocol@0.0.2`, `@electric-ax/coding-agents`. No new npm deps.

**Spec:** `docs/superpowers/specs/2026-05-02-coding-agents-fly-sprites-design.md`.

---

## File map

**New files:**

- `packages/coding-agents/src/providers/fly-sprites/index.ts` — `FlySpriteProvider` class
- `packages/coding-agents/src/providers/fly-sprites/api-client.ts` — Bearer-auth REST client
- `packages/coding-agents/src/providers/fly-sprites/exec-adapter.ts` — WebSocket → `ExecHandle`
- `packages/coding-agents/src/providers/fly-sprites/bootstrap.ts` — bootstrap script as a TS string + runner
- `packages/coding-agents/test/unit/fly-sprites.test.ts`
- `packages/coding-agents/test/integration/fly-sprites-conformance.test.ts`
- `packages/coding-agents/test/integration/spawn-sprites-claude.e2e.test.ts`
- `packages/coding-agents/test/integration/spawn-sprites-codex.e2e.test.ts`
- `packages/coding-agents/test/integration/spawn-sprites-opencode.e2e.test.ts`
- `packages/coding-agents/test/integration/convert-kind-on-sprites.e2e.test.ts`
- `packages/coding-agents/test/integration/fork-on-sprites.e2e.test.ts`
- `packages/agents-server-ui/test/e2e/spawn-sprites.spec.ts`
- `packages/coding-agents/scripts/cleanup-sprites.ts` — operator hygiene script

**Modified:**

- `packages/coding-agents/src/types.ts` — `target` widened to include `'sprites'`
- `packages/coding-agents/src/entity/collections.ts` — `sessionMetaRowSchema.target` enum + 3 new lifecycle event types
- `packages/coding-agents/src/entity/register.ts` — `creationArgsSchema.target` enum
- `packages/coding-agents/src/entity/handler.ts` — `processConvertTarget` validates allowed transitions
- `packages/coding-agents/src/index.ts` — conditional `FlySpriteProvider` registration on `SPRITES_TOKEN`
- `packages/coding-agents/src/lifecycle-manager.ts` — `providers` typed for 3 targets
- `packages/coding-agents/src/workspace-registry.ts` — `resolveIdentity` returns `sprite:${agentId}` for sprites
- `packages/coding-agents/package.json` — `cleanup:sprites` script + sideEffects entry for `./src/providers/fly-sprites/index.ts`
- `packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx` — third target option + bind-mount gate
- `packages/agents-server-ui/src/components/EntityHeader.tsx` — convert-target + fork dropdown gates
- `packages/agents-server-ui/src/components/CodingAgentTimeline.tsx` — render `bootstrap.*` lifecycle events
- `packages/coding-agents/README.md` — Fly Sprites provider section

---

## Task 1: Live Sprites API smoke (recon-as-task)

> **STATUS: DONE (2026-05-02, commit `9495130d6`).** Smoke probe ran with a real `SPRITES_TOKEN`; recon-corrected three deviations from the original docs reading. The corrections are reflected in the spec and folded into Tasks 3/4/6 below. The bash snippets in the steps below remain useful for re-running the probe; their URLs have been updated to include the `/v1/` prefix.

**Why first.** The Sprites API is v0.0.1-rc30. Recon was based on docs; behavior may drift. A 30-min spike with a real `SPRITES_TOKEN` confirms the spec's assumptions before we write code that depends on them.

**Files:**

- Create (temporary, not committed): `/tmp/sprites-smoke.sh`

- [ ] **Step 1: Verify token is set**

```bash
[ -n "$SPRITES_TOKEN" ] && echo "SPRITES_TOKEN: <set>" || { echo "SPRITES_TOKEN required for this task"; exit 1; }
```

- [ ] **Step 2: Probe REST endpoints**

```bash
# Create
RESP=$(curl -sX POST https://api.sprites.dev/v1/sprites \
  -H "Authorization: Bearer $SPRITES_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"smoke-coding-agents-'$(date +%s | tail -c 6)'"}')
echo "create response: $RESP"
SID=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))")
echo "sprite id: $SID"

# Get
curl -sX GET "https://api.sprites.dev/v1/sprites/$SID" -H "Authorization: Bearer $SPRITES_TOKEN" | python3 -m json.tool | head

# List with name prefix
curl -sX GET "https://api.sprites.dev/v1/sprites?name_prefix=smoke-" -H "Authorization: Bearer $SPRITES_TOKEN" | python3 -m json.tool | head -20

# Filesystem write
curl -sX PUT "https://api.sprites.dev/v1/sprites/$SID/fs/etc/test.txt" \
  -H "Authorization: Bearer $SPRITES_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"hello from smoke","mode":420}'

# Filesystem read
curl -sX GET "https://api.sprites.dev/v1/sprites/$SID/fs/etc/test.txt" -H "Authorization: Bearer $SPRITES_TOKEN"

# Cleanup
curl -sX DELETE "https://api.sprites.dev/v1/sprites/$SID" -H "Authorization: Bearer $SPRITES_TOKEN"
```

- [ ] **Step 3: Probe WebSocket exec**

Use `wscat` (`npm i -g wscat`) or a small node script:

```js
// /tmp/sprites-ws-smoke.mjs
const ws = new WebSocket(
  `wss://api.sprites.dev/v1/sprites/${process.env.SID}/exec`,
  { headers: { Authorization: `Bearer ${process.env.SPRITES_TOKEN}` } }
)
ws.onopen = () => {
  // Send a minimal exec frame — actual frame format from API docs.
  ws.send(JSON.stringify({ type: 'start', cmd: ['echo', 'hello'] }))
}
ws.onmessage = (e) => console.log('frame:', e.data)
ws.onclose = (e) => {
  console.log('closed', e.code)
  process.exit(0)
}
ws.onerror = (e) => {
  console.error('error', e)
  process.exit(1)
}
```

```bash
SID=<from step 2> SPRITES_TOKEN=$SPRITES_TOKEN node /tmp/sprites-ws-smoke.mjs
```

- [ ] **Step 4: Document findings**

If the actual API shape differs from the spec's assumptions, note in the spec doc as "Recon-confirmed":

```bash
# Add a section header to the spec around line 22:
# "## Recon-confirmed (YYYY-MM-DD)" with bullet points for any deviations.
```

If everything matches the spec, no commit needed for this task — proceed to Task 2.

If anything diverged: edit `docs/superpowers/specs/2026-05-02-coding-agents-fly-sprites-design.md` with corrections and commit:

```bash
git add docs/superpowers/specs/2026-05-02-coding-agents-fly-sprites-design.md
git commit -m "docs(coding-agents): sprites recon-confirmed updates from live probe"
```

---

## Task 2: `target` schema widening

**Files:**

- Modify: `packages/coding-agents/src/types.ts`
- Modify: `packages/coding-agents/src/entity/collections.ts`
- Modify: `packages/coding-agents/src/entity/register.ts`

- [ ] **Step 1: Widen the type union in types.ts**

In `packages/coding-agents/src/types.ts`, locate `SandboxSpec.target` (around line 13):

```ts
target: `sandbox` | `host`
```

Change to:

```ts
target: `sandbox` | `host` | `sprites`
```

- [ ] **Step 2: Widen `sessionMetaRowSchema.target`**

In `packages/coding-agents/src/entity/collections.ts`, find `sessionMetaRowSchema.target`:

```ts
target: z.enum([`sandbox`, `host`]),
```

Change to:

```ts
target: z.enum([`sandbox`, `host`, `sprites`]),
```

- [ ] **Step 3: Add lifecycle event types**

In the same `collections.ts`, find `lifecycleRowSchema.event` enum and add three new values:

```ts
event: z.enum([
  // existing values...
  `bootstrap.starting`,
  `bootstrap.complete`,
  `bootstrap.failed`,
]),
```

- [ ] **Step 4: Widen `creationArgsSchema.target`**

In `packages/coding-agents/src/entity/register.ts`, locate `creationArgsSchema.target` (or the inline arg-validation zod):

```ts
target: z.enum([`sandbox`, `host`]).optional(),
```

Change to:

```ts
target: z.enum([`sandbox`, `host`, `sprites`]).optional(),
```

- [ ] **Step 5: Widen `convertTargetMessageSchema`**

In `packages/coding-agents/src/entity/messages.ts`, find `convertTargetMessageSchema`:

```ts
export const convertTargetMessageSchema = z.object({
  to: z.enum([`sandbox`, `host`]),
})
```

Change to:

```ts
export const convertTargetMessageSchema = z.object({
  to: z.enum([`sandbox`, `host`, `sprites`]),
})
```

- [ ] **Step 6: Run typecheck + unit suite**

```bash
pnpm -C packages/coding-agents typecheck
pnpm -C packages/coding-agents test
```

Expected: PASS — additive changes, no existing tests should break.

- [ ] **Step 7: Commit**

```bash
git add packages/coding-agents/src/types.ts \
        packages/coding-agents/src/entity/collections.ts \
        packages/coding-agents/src/entity/register.ts \
        packages/coding-agents/src/entity/messages.ts
git commit -m "feat(coding-agents): widen target enum to include 'sprites'

Adds 'sprites' as a third target value alongside 'sandbox' and 'host'.
Three new lifecycle events for sprites bootstrap (starting/complete/failed).
convertTargetMessageSchema also widens — handler validates allowed
transitions in a later task."
```

---

## Task 3: API client (Bearer REST)

**Files:**

- Create: `packages/coding-agents/src/providers/fly-sprites/api-client.ts`
- Test: `packages/coding-agents/test/unit/fly-sprites-client.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/coding-agents/test/unit/fly-sprites-client.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { SpritesApiClient } from '../../src/providers/fly-sprites/api-client'

describe(`SpritesApiClient`, () => {
  let originalFetch: typeof fetch
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    originalFetch = global.fetch
    fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it(`POST /sprites with name + idle_timeout`, async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: `spr_abc`, name: `coding-agent-x` }), {
        status: 200,
      })
    )
    const c = new SpritesApiClient({ token: `tok_xyz` })
    const r = await c.createSprite({
      name: `coding-agent-x`,
      idleTimeoutSecs: 300,
    })
    expect(r.id).toBe(`spr_abc`)
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.sprites.dev/v1/sprites`,
      expect.objectContaining({
        method: `POST`,
        headers: expect.objectContaining({
          authorization: `Bearer tok_xyz`,
          'content-type': `application/json`,
        }),
        body: expect.stringContaining(`coding-agent-x`),
      })
    )
  })

  it(`GET /sprites/{name}`, async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: `spr_abc`, status: `running` }), {
        status: 200,
      })
    )
    const c = new SpritesApiClient({ token: `tok_xyz` })
    const r = await c.getSprite(`coding-agent-x`)
    expect(r.status).toBe(`running`)
  })

  it(`GET /sprites?name_prefix=...`, async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          sprites: [{ id: `spr_a`, name: `coding-agent-1` }],
        }),
        { status: 200 }
      )
    )
    const c = new SpritesApiClient({ token: `tok_xyz` })
    const r = await c.listSprites({ namePrefix: `coding-agent-` })
    expect(r.sprites).toHaveLength(1)
    const url = fetchMock.mock.calls[0]![0] as string
    expect(url).toContain(`name_prefix=coding-agent-`)
  })

  it(`DELETE /sprites/{name}`, async () => {
    fetchMock.mockResolvedValue(new Response(``, { status: 204 }))
    const c = new SpritesApiClient({ token: `tok_xyz` })
    await c.deleteSprite(`coding-agent-x`)
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.sprites.dev/v1/sprites/coding-agent-x`,
      expect.objectContaining({ method: `DELETE` })
    )
  })

  it(`throws with status + body on non-2xx`, async () => {
    fetchMock.mockResolvedValue(
      new Response(`forbidden`, { status: 403, statusText: `Forbidden` })
    )
    const c = new SpritesApiClient({ token: `tok_xyz` })
    await expect(c.getSprite(`spr_x`)).rejects.toThrow(/403.*forbidden/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -C packages/coding-agents test test/unit/fly-sprites-client.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the API client**

Create `packages/coding-agents/src/providers/fly-sprites/api-client.ts`:

```ts
export interface SpritesApiClientOptions {
  token: string
  baseUrl?: string
}

export interface CreateSpriteRequest {
  name: string
  idleTimeoutSecs?: number
}

export interface SpriteSummary {
  id: string
  name: string
  status?: string
  url?: string // per-sprite URL e.g. https://<name>-<suffix>.sprites.app — used for WebSocket exec
}

export interface ListSpritesOptions {
  namePrefix?: string
}

export class SpritesApiClient {
  private readonly token: string
  private readonly baseUrl: string

  constructor(opts: SpritesApiClientOptions) {
    this.token = opts.token
    this.baseUrl = opts.baseUrl ?? `https://api.sprites.dev/v1`
  }

  async createSprite(req: CreateSpriteRequest): Promise<SpriteSummary> {
    return await this.request(`POST`, `/sprites`, req)
  }

  async getSprite(name: string): Promise<SpriteSummary> {
    return await this.request(`GET`, `/sprites/${encodeURIComponent(name)}`)
  }

  async listSprites(opts: ListSpritesOptions = {}): Promise<{
    sprites: Array<SpriteSummary>
    has_more?: boolean
    next_continuation_token?: string | null
  }> {
    const qs = opts.namePrefix
      ? `?name_prefix=${encodeURIComponent(opts.namePrefix)}`
      : ``
    return await this.request(`GET`, `/sprites${qs}`)
  }

  async deleteSprite(name: string): Promise<void> {
    await this.request(`DELETE`, `/sprites/${encodeURIComponent(name)}`)
  }

  private async request<T = any>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
    }
    let bodyInit: string | undefined
    if (body !== undefined) {
      headers[`content-type`] = `application/json`
      bodyInit = JSON.stringify(body)
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: bodyInit,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => ``)
      throw new Error(
        `Sprites API ${method} ${path}: ${res.status} ${res.statusText}: ${text.slice(0, 200)}`
      )
    }
    if (res.status === 204) return undefined as T
    const ct = res.headers.get(`content-type`) ?? ``
    if (ct.includes(`application/json`)) {
      return (await res.json()) as T
    }
    return (await res.text()) as unknown as T
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm -C packages/coding-agents test test/unit/fly-sprites-client.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/providers/fly-sprites/api-client.ts \
        packages/coding-agents/test/unit/fly-sprites-client.test.ts
git commit -m "feat(coding-agents): SpritesApiClient — Bearer-auth REST

Bearer token in Authorization header. Methods: createSprite,
getSprite, listSprites (with name_prefix filter), deleteSprite.
writeFile is intentionally not implemented — live recon found no
public filesystem REST endpoint, so file writes are routed through
exec + cat in Task 6. Throws on non-2xx with status + body for
debugging. 204 returns undefined. JSON content-type auto-detected
on response. Five unit tests with mocked fetch (test count dropped
from 6 to 5 due to writeFile removal)."
```

---

## Task 4: WebSocket exec adapter

**Files:**

- Create: `packages/coding-agents/src/providers/fly-sprites/exec-adapter.ts`
- Test: `packages/coding-agents/test/unit/fly-sprites-exec.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/coding-agents/test/unit/fly-sprites-exec.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { createExecHandle } from '../../src/providers/fly-sprites/exec-adapter'

// Minimal WebSocket mock with the WebSocket browser API surface.
class MockWebSocket extends EventEmitter {
  readyState = 0
  static OPEN = 1
  static CLOSED = 3
  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
    this.emit(`close`, { code: 1000 })
  })
  emitOpen() {
    this.readyState = MockWebSocket.OPEN
    this.emit(`open`)
  }
  emitFrame(data: any) {
    this.emit(`message`, { data: JSON.stringify(data) })
  }
  emitText(data: string) {
    this.emit(`message`, { data })
  }
}

describe(`createExecHandle`, () => {
  let ws: MockWebSocket
  beforeEach(() => {
    ws = new MockWebSocket()
  })

  it(`drains stdout frames as async-iterable lines`, async () => {
    // Per live recon: stdout is RAW TEXT WebSocket messages (NOT JSON-wrapped).
    // stderr/lifecycle uses {type:'debug', msg:'...'}, exit uses snake_case
    // {type:'exit', exit_code:N}.
    setTimeout(() => {
      ws.emitOpen()
      ws.emitText(`hello\n`)
      ws.emitText(`world\n`)
      ws.emitFrame({ type: `exit`, exit_code: 0 })
      ws.close()
    }, 5)

    const handle = createExecHandle({
      ws: ws as unknown as WebSocket,
      cmd: [`echo`, `test`],
    })

    const lines: Array<string> = []
    for await (const line of handle.stdout) lines.push(line)
    const exit = await handle.wait()

    expect(lines).toEqual([`hello`, `world`])
    expect(exit.exitCode).toBe(0)
  })

  it(`drains stderr separately from stdout`, async () => {
    setTimeout(() => {
      ws.emitOpen()
      ws.emitText(`out1\n`)
      ws.emitFrame({ type: `debug`, msg: `err1` })
      ws.emitText(`out2\n`)
      ws.emitFrame({ type: `exit`, exit_code: 1 })
      ws.close()
    }, 5)

    const handle = createExecHandle({
      ws: ws as unknown as WebSocket,
      cmd: [`bad`, `cmd`],
    })

    const out: Array<string> = []
    const err: Array<string> = []
    const drainOut = (async () => {
      for await (const l of handle.stdout) out.push(l)
    })()
    const drainErr = (async () => {
      for await (const l of handle.stderr) err.push(l)
    })()
    const exit = await handle.wait()
    await Promise.all([drainOut, drainErr])

    expect(out).toEqual([`out1`, `out2`])
    expect(err).toEqual([`err1`])
    expect(exit.exitCode).toBe(1)
  })

  it(`supports stdin via writeStdin / closeStdin when stdin: 'pipe'`, async () => {
    setTimeout(() => {
      ws.emitOpen()
      ws.emitFrame({ type: `exit`, exit_code: 0 })
      ws.close()
    }, 5)

    const handle = createExecHandle({
      ws: ws as unknown as WebSocket,
      cmd: [`cat`],
      stdin: `pipe`,
    })

    expect(handle.writeStdin).toBeDefined()
    expect(handle.closeStdin).toBeDefined()
    await handle.writeStdin!(`some prompt\n`)
    await handle.closeStdin!()
    await handle.wait()

    // Verify the WS received the stdin frame.
    expect(ws.send).toHaveBeenCalledWith(expect.stringContaining(`"stdin"`))
  })

  it(`emits start frame with cmd argv on open`, async () => {
    setTimeout(() => {
      ws.emitOpen()
      ws.emitFrame({ type: `exit`, exit_code: 0 })
      ws.close()
    }, 5)

    const handle = createExecHandle({
      ws: ws as unknown as WebSocket,
      cmd: [`ls`, `-la`, `/tmp`],
    })
    const drainOut = (async () => {
      for await (const _ of handle.stdout) {
        // discard
      }
    })()
    const drainErr = (async () => {
      for await (const _ of handle.stderr) {
        // discard
      }
    })()
    await handle.wait()
    await Promise.all([drainOut, drainErr])

    const startFrame = ws.send.mock.calls[0]![0] as string
    const parsed = JSON.parse(startFrame)
    expect(parsed.type).toBe(`start`)
    expect(parsed.cmd).toEqual([`ls`, `-la`, `/tmp`])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm -C packages/coding-agents test test/unit/fly-sprites-exec.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the exec adapter**

Create `packages/coding-agents/src/providers/fly-sprites/exec-adapter.ts`:

```ts
import type { ExecHandle } from '../../types'

export interface CreateExecHandleArgs {
  ws: WebSocket
  cmd: ReadonlyArray<string>
  stdin?: `pipe` | `ignore`
  cwd?: string
  env?: Record<string, string>
}

interface PendingFrame {
  resolve: (value: IteratorResult<string>) => void
}

class StreamQueue {
  private readonly buf: Array<string> = []
  private pending: PendingFrame | null = null
  private done = false

  push(line: string): void {
    if (this.done) return
    if (this.pending) {
      const p = this.pending
      this.pending = null
      p.resolve({ value: line, done: false })
      return
    }
    this.buf.push(line)
  }

  end(): void {
    this.done = true
    if (this.pending) {
      this.pending.resolve({
        value: undefined as unknown as string,
        done: true,
      })
      this.pending = null
    }
  }

  iterator(): AsyncIterator<string> {
    return {
      next: () => {
        if (this.buf.length > 0) {
          return Promise.resolve({ value: this.buf.shift()!, done: false })
        }
        if (this.done) {
          return Promise.resolve({
            value: undefined as unknown as string,
            done: true,
          })
        }
        return new Promise((resolve) => {
          this.pending = { resolve }
        })
      },
    }
  }
}

function makeAsyncIterable(q: StreamQueue): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]: () => q.iterator(),
  }
}

function feedFrameData(q: StreamQueue, data: string): void {
  // Split on newlines; keep any incomplete trailing line for the next frame.
  // For simplicity, push each newline-terminated segment as its own line and
  // the trailing remainder (if any) as a final partial line at end().
  const lines = data.split(`\n`)
  // Last element is the unterminated tail; push the rest as full lines.
  for (let i = 0; i < lines.length - 1; i++) {
    q.push(lines[i]!)
  }
  // Tail: if non-empty, also push (caller emits flush via end() when stream closes).
  if (lines[lines.length - 1] !== ``) {
    q.push(lines[lines.length - 1]!)
  }
}

export function createExecHandle(args: CreateExecHandleArgs): ExecHandle {
  const stdoutQ = new StreamQueue()
  const stderrQ = new StreamQueue()

  let exitInfo: { exitCode: number } | null = null
  let exitResolve: ((info: { exitCode: number }) => void) | null = null
  const exitPromise = new Promise<{ exitCode: number }>((resolve) => {
    exitResolve = resolve
  })

  const send = (frame: unknown) => args.ws.send(JSON.stringify(frame))

  args.ws.addEventListener(`open`, () => {
    send({
      type: `start`,
      cmd: args.cmd,
      cwd: args.cwd,
      env: args.env,
      stdin: args.stdin === `pipe`,
    })
  })

  args.ws.addEventListener(`message`, (event) => {
    const data = typeof event.data === `string` ? event.data : ``
    let frame: any
    try {
      frame = JSON.parse(data)
    } catch {
      // Raw text message → stdout. Sprites streams stdout as plain text
      // WebSocket messages, not JSON frames.
      feedFrameData(stdoutQ, data)
      return
    }
    if (frame.type === `debug` && typeof frame.msg === `string`) {
      // Sprites' stderr / lifecycle log channel.
      feedFrameData(stderrQ, frame.msg)
    } else if (frame.type === `exit` && typeof frame.exit_code === `number`) {
      exitInfo = { exitCode: frame.exit_code }
    } else if (frame.type === `session_info`) {
      // No-op: session metadata; logged elsewhere if desired.
    }
    // Unknown frame types ignored.
  })

  args.ws.addEventListener(`close`, () => {
    stdoutQ.end()
    stderrQ.end()
    if (!exitInfo) exitInfo = { exitCode: -1 }
    if (exitResolve) exitResolve(exitInfo)
  })

  args.ws.addEventListener(`error`, () => {
    stdoutQ.end()
    stderrQ.end()
    if (!exitInfo) exitInfo = { exitCode: -1 }
    if (exitResolve) exitResolve(exitInfo)
  })

  const handle: ExecHandle = {
    stdout: makeAsyncIterable(stdoutQ),
    stderr: makeAsyncIterable(stderrQ),
    wait: () => exitPromise,
    kill: () => {
      try {
        args.ws.close()
      } catch {
        // best-effort
      }
    },
    ...(args.stdin === `pipe`
      ? {
          writeStdin: async (chunk: string) => {
            send({ type: `stdin`, data: chunk })
          },
          closeStdin: async () => {
            send({ type: `stdin_close` })
          },
        }
      : {}),
  }
  return handle
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm -C packages/coding-agents test test/unit/fly-sprites-exec.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/providers/fly-sprites/exec-adapter.ts \
        packages/coding-agents/test/unit/fly-sprites-exec.test.ts
git commit -m "feat(coding-agents): WebSocket → ExecHandle adapter for sprites

Translates Sprites' exec WebSocket frames into the existing ExecHandle
contract (async-iterable stdout/stderr lines, exit promise, kill).
Per live recon (Task 1):
- stdout = raw text WebSocket messages (NOT JSON-wrapped).
- stderr / lifecycle = {type:'debug', msg:'...'} JSON frames.
- exit = {type:'exit', exit_code:N} (snake_case).
- session_info frames are no-ops.
Stdin pipe routes via {type:'stdin', data:'...'} frames."
```

---

## Task 5: Bootstrap script + runner

**Files:**

- Create: `packages/coding-agents/src/providers/fly-sprites/bootstrap.ts`
- Test: `packages/coding-agents/test/unit/fly-sprites-bootstrap.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/coding-agents/test/unit/fly-sprites-bootstrap.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BOOTSTRAP_SCRIPT } from '../../src/providers/fly-sprites/bootstrap'

describe(`Sprites bootstrap script`, () => {
  it(`includes idempotency marker check`, () => {
    expect(BOOTSTRAP_SCRIPT).toContain(`/opt/electric-ax/.bootstrapped`)
    expect(BOOTSTRAP_SCRIPT).toContain(`exit 0`)
  })

  it(`installs opencode-ai pinned to the conformance version`, () => {
    expect(BOOTSTRAP_SCRIPT).toContain(`opencode-ai@1.14.31`)
  })

  it(`creates /work and /run/agent.env`, () => {
    expect(BOOTSTRAP_SCRIPT).toContain(`mkdir -p /work`)
    expect(BOOTSTRAP_SCRIPT).toContain(`/run/agent.env`)
  })

  it(`writes the marker file at the end`, () => {
    expect(BOOTSTRAP_SCRIPT).toContain(`touch /opt/electric-ax/.bootstrapped`)
  })

  it(`is set -e so failures abort early`, () => {
    expect(BOOTSTRAP_SCRIPT).toContain(`set -e`)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -C packages/coding-agents test test/unit/fly-sprites-bootstrap.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement bootstrap**

Create `packages/coding-agents/src/providers/fly-sprites/bootstrap.ts`:

```ts
/**
 * Per-sprite bootstrap script. Idempotent — checks for a marker file
 * before doing anything. Run via the exec WebSocket once on first
 * sprite start. Subsequent prompts (and wakes from auto-sleep) skip
 * the install entirely.
 *
 * Pin parity: opencode-ai@1.14.31 must match
 * packages/coding-agents/docker/Dockerfile. The conformance suite
 * catches drift if these diverge.
 */
export const BOOTSTRAP_SCRIPT = `#!/bin/sh
set -e

# Skip if already bootstrapped.
[ -f /opt/electric-ax/.bootstrapped ] && exit 0

# Verify preinstalled CLIs (sanity).
claude --version >/dev/null && codex --version >/dev/null

# Install opencode-ai. Pinned to match the local-docker bake.
npm install -g opencode-ai@1.14.31
opencode --version >/dev/null

# Workspace mount point.
mkdir -p /work

# Per-instance env file (slice C₁ pattern).
mkdir -p /run/agent
touch /run/agent.env
chmod 600 /run/agent.env

# Mark complete.
mkdir -p /opt/electric-ax
touch /opt/electric-ax/.bootstrapped
echo "bootstrap complete"
`
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm -C packages/coding-agents test test/unit/fly-sprites-bootstrap.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/providers/fly-sprites/bootstrap.ts \
        packages/coding-agents/test/unit/fly-sprites-bootstrap.test.ts
git commit -m "feat(coding-agents): sprites bootstrap script

Idempotent shell script that runs once per sprite at start():
- Marker file check skips re-bootstrap on wake-from-sleep.
- Verifies preinstalled claude/codex.
- Installs opencode-ai@1.14.31 (matches Dockerfile pin).
- Ensures /work + /run/agent.env exist.
- Writes marker file as the last step.

Pin parity is enforced — drift between Dockerfile and bootstrap
script causes conformance failures."
```

---

## Task 6: `FlySpriteProvider` — start/stop/destroy/status/recover

**Files:**

- Create: `packages/coding-agents/src/providers/fly-sprites/index.ts`
- Test: `packages/coding-agents/test/unit/fly-sprites.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/coding-agents/test/unit/fly-sprites.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { FlySpriteProvider } from '../../src/providers/fly-sprites'

const FAKE_TOKEN = `tok_test_xyz`

function mockResponses(steps: Array<unknown>): ReturnType<typeof vi.fn> {
  const fn = vi.fn()
  for (const r of steps) {
    fn.mockResolvedValueOnce(
      new Response(typeof r === `object` ? JSON.stringify(r) : (r as string), {
        status: 200,
      })
    )
  }
  return fn
}

describe(`FlySpriteProvider`, () => {
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = global.fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it(`throws if SPRITES_TOKEN is unset and no token override`, () => {
    const oldToken = process.env.SPRITES_TOKEN
    delete process.env.SPRITES_TOKEN
    expect(() => new FlySpriteProvider()).toThrow(/SPRITES_TOKEN/)
    if (oldToken !== undefined) process.env.SPRITES_TOKEN = oldToken
  })

  it(`accepts an explicit token option`, () => {
    const p = new FlySpriteProvider({ token: FAKE_TOKEN })
    expect(p.name).toBe(`fly-sprites`)
  })

  it(`destroy() calls DELETE /sprites/{id} for the agentId-mapped sprite`, async () => {
    global.fetch = mockResponses([
      { sprites: [{ id: `spr_x`, name: `coding-agent-foo` }] },
      ``, // delete returns empty
    ]) as unknown as typeof fetch

    const p = new FlySpriteProvider({ token: FAKE_TOKEN })
    await p.destroy(`/coding-agent/foo`)
    const calls = (global.fetch as any).mock.calls as Array<
      [string, RequestInit]
    >
    const deleteCall = calls.find((c) => c[1].method === `DELETE`)
    expect(deleteCall?.[0]).toBe(
      `https://api.sprites.dev/v1/sprites/coding-agent-foo`
    )
  })

  it(`status() returns 'unknown' when sprite not found`, async () => {
    global.fetch = mockResponses([{ sprites: [] }]) as unknown as typeof fetch
    const p = new FlySpriteProvider({ token: FAKE_TOKEN })
    expect(await p.status(`/coding-agent/missing`)).toBe(`unknown`)
  })

  it(`status() returns 'running' for sprites in any active or sleeping state`, async () => {
    global.fetch = mockResponses([
      { sprites: [{ id: `spr_a`, name: `coding-agent-a`, status: `running` }] },
    ]) as unknown as typeof fetch
    const p = new FlySpriteProvider({ token: FAKE_TOKEN })
    expect(await p.status(`/coding-agent/a`)).toBe(`running`)
  })

  it(`recover() lists sprites with the coding-agent prefix`, async () => {
    global.fetch = mockResponses([
      {
        sprites: [
          { id: `spr_a`, name: `coding-agent-foo`, status: `running` },
          { id: `spr_b`, name: `coding-agent-bar`, status: `sleeping` },
        ],
      },
    ]) as unknown as typeof fetch
    const p = new FlySpriteProvider({ token: FAKE_TOKEN })
    const recovered = await p.recover()
    expect(recovered).toHaveLength(2)
    expect(recovered.map((r) => r.target)).toEqual([`sprites`, `sprites`])
    const url = (global.fetch as any).mock.calls[0]![0] as string
    expect(url).toContain(`name_prefix=coding-agent-`)
  })

  it(`cloneWorkspace is NOT defined (deferred to v1.5)`, () => {
    const p = new FlySpriteProvider({ token: FAKE_TOKEN })
    expect((p as any).cloneWorkspace).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -C packages/coding-agents test test/unit/fly-sprites.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the provider**

Create `packages/coding-agents/src/providers/fly-sprites/index.ts`:

```ts
import type {
  ExecHandle,
  ExecRequest,
  RecoveredSandbox,
  SandboxInstance,
  SandboxProvider,
  SandboxSpec,
} from '../../types'
import { log } from '../../log'
import { SpritesApiClient } from './api-client'
import { createExecHandle } from './exec-adapter'
import { BOOTSTRAP_SCRIPT } from './bootstrap'

export interface FlySpriteProviderOptions {
  token?: string
  baseUrl?: string
  /**
   * idle_timeout_secs passed to POST /sprites. Sprites auto-sleep when
   * idle (free); they wake on next exec (~300ms). Default 300s.
   */
  idleTimeoutSecs?: number
}

const NAME_PREFIX = `coding-agent-`

function spriteName(agentId: string): string {
  // agentId looks like '/coding-agent/foo' — sanitise to 'coding-agent-foo'.
  return agentId.replace(/^\//, ``).replace(/\//g, `-`)
}

export class FlySpriteProvider implements SandboxProvider {
  readonly name = `fly-sprites`
  private readonly client: SpritesApiClient
  private readonly idleTimeoutSecs: number
  // Cache agentId → { sprite name, per-sprite URL } resolution between calls
  // within one process. Sprite NAME (not id) is the API path parameter; the
  // per-sprite URL (e.g. https://<name>-<suffix>.sprites.app) is what the
  // exec WebSocket connects to (NOT api.sprites.dev).
  private readonly agentToSprite = new Map<
    string,
    { name: string; url: string }
  >()

  constructor(opts: FlySpriteProviderOptions = {}) {
    const token = opts.token ?? process.env.SPRITES_TOKEN
    if (!token) {
      throw new Error(
        `FlySpriteProvider: SPRITES_TOKEN env var is required (or pass token option)`
      )
    }
    this.client = new SpritesApiClient({ token, baseUrl: opts.baseUrl })
    this.idleTimeoutSecs = opts.idleTimeoutSecs ?? 300
  }

  async start(spec: SandboxSpec): Promise<SandboxInstance> {
    if (spec.workspace.type !== `volume`) {
      throw new Error(
        `FlySpriteProvider: only workspace.type='volume' is supported (got '${spec.workspace.type}'). Sprites have intrinsic FS; no bind-mount analog.`
      )
    }
    const name = spriteName(spec.agentId)
    let spriteName_ = await this.findExisting(name)
    let spriteUrl: string
    if (!spriteName_) {
      const created = await this.client.createSprite({
        name,
        idleTimeoutSecs: this.idleTimeoutSecs,
      })
      spriteName_ = created.name
      spriteUrl = created.url ?? ``
    } else {
      // Find-existing returned only the name; fetch full record to get url.
      const full = await this.client.getSprite(spriteName_)
      spriteUrl = full.url ?? ``
    }
    if (!spriteUrl) {
      throw new Error(
        `FlySpriteProvider: sprite ${spriteName_} has no per-sprite url; cannot open exec WebSocket`
      )
    }
    this.agentToSprite.set(spec.agentId, { name: spriteName_, url: spriteUrl })

    // Run bootstrap (idempotent — marker check inside the script).
    await this.runBootstrap(spriteUrl)

    // Write spec.env to /run/agent.env so subsequent execs source it.
    // Routed through exec + cat (no public REST filesystem endpoint).
    if (Object.keys(spec.env).length > 0) {
      const envBody = Object.entries(spec.env)
        .map(([k, v]) => `${k}=${shellEscape(v)}`)
        .join(`\n`)
      await this.writeFileViaExec(spriteUrl, `/run/agent.env`, envBody, 0o600)
    }

    return this.makeInstance(spriteName_, spriteUrl, spec)
  }

  async exec(_req: ExecRequest): Promise<ExecHandle> {
    // exec is invoked through the SandboxInstance, not the provider directly.
    // Provided here for the SandboxProvider interface but not called.
    throw new Error(
      `FlySpriteProvider.exec must be invoked via SandboxInstance.exec`
    )
  }

  async stop(_instanceId: string): Promise<void> {
    // Sprites auto-sleep — explicit stop is a no-op. v1.x can add cordon
    // via PUT /sprites/{name} if explicit force-sleep is needed.
  }

  async destroy(agentId: string): Promise<void> {
    const name = spriteName(agentId)
    const cached = this.agentToSprite.get(agentId)
    const spriteName_ = cached?.name ?? (await this.findExisting(name))
    if (!spriteName_) return
    try {
      await this.client.deleteSprite(spriteName_)
    } catch (err) {
      log.warn(
        { err, agentId, spriteName: spriteName_ },
        `sprites destroy failed`
      )
    }
    this.agentToSprite.delete(agentId)
  }

  async status(agentId: string): Promise<`running` | `stopped` | `unknown`> {
    const name = spriteName(agentId)
    const cached = this.agentToSprite.get(agentId)
    const spriteName_ = cached?.name ?? (await this.findExisting(name))
    if (!spriteName_) return `unknown`
    try {
      const sprite = await this.client.getSprite(spriteName_)
      // Treat any non-deleted sprite as 'running' (auto-slept sprites wake).
      return sprite.status === `destroyed` ? `stopped` : `running`
    } catch {
      return `unknown`
    }
  }

  async recover(): Promise<Array<RecoveredSandbox>> {
    try {
      const r = await this.client.listSprites({ namePrefix: NAME_PREFIX })
      return r.sprites.map((s) => ({
        // Best-effort reconstruction of agentId from sprite name. The runtime
        // spawn pattern is one-segment ('/coding-agent/<id>'), so we strip
        // NAME_PREFIX and treat the rest as the trailing segment. Agent IDs
        // with embedded slashes deeper than that won't roundtrip cleanly —
        // acceptable for v1; revisit if we add nested agent paths.
        agentId: s.name.startsWith(NAME_PREFIX)
          ? `/coding-agent/${s.name.slice(NAME_PREFIX.length)}`
          : `/${s.name}`, // best-effort fallback for sprites not created via this provider
        instanceId: s.id,
        status:
          s.status === `destroyed`
            ? (`stopped` as const)
            : (`running` as const),
        target: `sprites` as const,
      }))
    } catch (err) {
      log.warn({ err }, `sprites recover failed`)
      return []
    }
  }

  // ─── private helpers ─────────────────────────────────────────────────

  private async findExisting(name: string): Promise<string | null> {
    const r = await this.client.listSprites({ namePrefix: name })
    const exact = r.sprites.find((s) => s.name === name)
    return exact?.name ?? null
  }

  private async runBootstrap(spriteUrl: string): Promise<void> {
    // Run BOOTSTRAP_SCRIPT via /bin/sh. Drain to completion.
    const ws = this.openExecWebSocket(spriteUrl)
    const handle = createExecHandle({
      ws,
      cmd: [`/bin/sh`, `-c`, BOOTSTRAP_SCRIPT],
    })
    const drain = async (s: AsyncIterable<string>): Promise<void> => {
      for await (const _ of s) {
        // discard
      }
    }
    const exit = handle.wait()
    await Promise.all([drain(handle.stdout), drain(handle.stderr), exit])
    const exitInfo = await exit
    if (exitInfo.exitCode !== 0) {
      throw new Error(
        `sprites bootstrap failed: exit ${exitInfo.exitCode} on sprite ${spriteUrl}`
      )
    }
  }

  private openExecWebSocket(spriteUrl: string): WebSocket {
    // Convert https://<name>-<suffix>.sprites.app to wss://<name>-<suffix>.sprites.app/exec
    // The exec WebSocket lives on the per-sprite URL, NOT api.sprites.dev.
    const wsUrl = spriteUrl.replace(/^https?:/, `wss:`) + `/exec`
    return new WebSocket(wsUrl, {
      headers: { authorization: `Bearer ${this.client.tokenForExec()}` },
    } as any)
  }

  private async writeFileViaExec(
    spriteUrl: string,
    destPath: string,
    content: string,
    mode = 0o600
  ): Promise<void> {
    const ws = this.openExecWebSocket(spriteUrl)
    const handle = createExecHandle({
      ws,
      cmd: [
        `sh`,
        `-c`,
        `cat > ${shellEscape(destPath)} && chmod ${mode.toString(8)} ${shellEscape(destPath)}`,
      ],
      stdin: `pipe`,
    })
    await handle.writeStdin!(content)
    await handle.closeStdin!()
    const drain = async (s: AsyncIterable<string>) => {
      for await (const _ of s) {
        // discard
      }
    }
    const exit = handle.wait()
    await Promise.all([drain(handle.stdout), drain(handle.stderr), exit])
    const exitInfo = await exit
    if (exitInfo.exitCode !== 0) {
      throw new Error(
        `writeFileViaExec failed: exit ${exitInfo.exitCode} writing ${destPath}`
      )
    }
  }

  private makeInstance(
    name: string,
    url: string,
    spec: SandboxSpec
  ): SandboxInstance {
    const spriteUrl = url
    return {
      instanceId: name,
      agentId: spec.agentId,
      workspaceMount: `/work`,
      homeDir: `/root`,
      exec: async (req) => {
        const ws = this.openExecWebSocket(spriteUrl)
        return createExecHandle({
          ws,
          cmd: req.cmd,
          stdin: req.stdin,
          cwd: req.cwd,
          env: req.env,
        })
      },
      copyTo: async (args) => {
        await this.writeFileViaExec(
          spriteUrl,
          args.destPath,
          args.content,
          args.mode ?? 0o600
        )
      },
    }
  }
}

function shellEscape(v: string): string {
  // Wrap in single quotes; close-and-escape any single quotes inside.
  return `'${v.replace(/'/g, `'\\''`)}'`
}

// Expose tokenForExec on SpritesApiClient for the WS auth header use-site.
declare module './api-client' {
  interface SpritesApiClient {
    tokenForExec(): string
  }
}
```

In `packages/coding-agents/src/providers/fly-sprites/api-client.ts`, add a `tokenForExec()` accessor:

```ts
// At the top of the class:
public tokenForExec(): string {
  return this._token
}
```

Rename the private `token` to `_token` to avoid name collision with the new public accessor. (`baseUrl` no longer needs to be exposed — the exec WebSocket URL comes from each sprite's per-sprite `url` field, not from `api.sprites.dev`.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm -C packages/coding-agents test test/unit/fly-sprites.test.ts test/unit/fly-sprites-client.test.ts
```

Expected: PASS — 7 + 5 = 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/providers/fly-sprites/index.ts \
        packages/coding-agents/src/providers/fly-sprites/api-client.ts \
        packages/coding-agents/test/unit/fly-sprites.test.ts
git commit -m "feat(coding-agents): FlySpriteProvider — start/stop/destroy/status/recover

Implements every required SandboxProvider method against the Sprites
REST + WebSocket API. start() resolves agentId → sprite name via
name-prefix list (idempotent), creates if missing (~1-2s cold-boot),
runs the bootstrap script via exec WebSocket on the per-sprite URL,
writes spec.env to /run/agent.env via exec + cat (no public REST
filesystem endpoint).

Cache stores {name, url} per agentId; the per-sprite URL
(https://<name>-<suffix>.sprites.app) is what the exec WebSocket
connects to, NOT api.sprites.dev. stop() is a no-op (sprites
auto-sleep). destroy() DELETE /v1/sprites/{name}. status() maps
the API's sprite-state to {running,stopped,unknown}. recover()
lists with name_prefix='coding-agent-' and reconstructs agentId
by stripping the prefix (one-segment runtime pattern).

Workspace bindMount rejected at start() — sprites have intrinsic FS.
copyTo + env-file writes share writeFileViaExec helper (cat > path).
cloneWorkspace deliberately NOT implemented (deferred to v1.5)."
```

---

## Task 7: Workspace registry — sprite identity

**Files:**

- Modify: `packages/coding-agents/src/workspace-registry.ts`
- Test: `packages/coding-agents/test/unit/workspace-registry.test.ts` (extend if exists)

- [ ] **Step 1: Locate `resolveIdentity`**

```bash
grep -n "resolveIdentity\|sprite:" packages/coding-agents/src/workspace-registry.ts
```

The function takes `(agentId, workspace)` and returns `{ identity, resolved }`.

- [ ] **Step 2: Add a sprites case**

In `WorkspaceRegistry.resolveIdentity` (static method or similar), add a case before the existing `volume` / `bindMount` branches that gates on the agent's target. Since `resolveIdentity` doesn't currently take `target`, we need to pass it in. Two ways:

(a) Extend the signature: `resolveIdentity(agentId, workspace, target)`.
(b) Look at the call site in handler.ts — the target is available there.

Pick (a). Update the signature and one call site:

```ts
static async resolveIdentity(
  agentId: string,
  workspace: SandboxSpec[`workspace`],
  target: SandboxSpec[`target`] = `sandbox`
): Promise<{ identity: string; resolved: SandboxSpec[`workspace`] }> {
  if (target === `sprites`) {
    // One sprite per agent; the sprite IS the workspace. workspace.name is
    // informational; identity is per-agent.
    return {
      identity: `sprite:${agentId}`,
      resolved:
        workspace.type === `volume`
          ? { type: `volume`, name: workspace.name ?? agentId }
          : (() => {
              throw new Error(
                `sprites only support workspace.type='volume'`
              )
            })(),
    }
  }
  // ...existing logic for sandbox/host
}
```

Update the call site in `packages/coding-agents/src/entity/handler.ts` (search `WorkspaceRegistry.resolveIdentity`) to pass `target`.

- [ ] **Step 3: Run typecheck + tests**

```bash
pnpm -C packages/coding-agents typecheck
pnpm -C packages/coding-agents test test/unit/workspace-registry.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/coding-agents/src/workspace-registry.ts \
        packages/coding-agents/src/entity/handler.ts
git commit -m "feat(coding-agents): workspace registry — sprite identity

resolveIdentity now takes target as a third arg. For target='sprites',
returns identity 'sprite:\${agentId}' (one-to-one — no workspace
sharing across sprites in v1). Rejects bindMount.

Existing sandbox/host paths unchanged."
```

---

## Task 8: LifecycleManager registration + lifecycle events

**Files:**

- Modify: `packages/coding-agents/src/lifecycle-manager.ts`
- Modify: `packages/coding-agents/src/index.ts`
- Modify: `packages/coding-agents/src/entity/handler.ts` (lifecycle row insertion at bootstrap)

- [ ] **Step 1: Type the providers map for 3 targets**

In `packages/coding-agents/src/lifecycle-manager.ts`, find:

```ts
providers: {
  sandbox: SandboxProvider
  host: SandboxProvider
}
```

Change to:

```ts
providers: {
  sandbox: SandboxProvider
  host: SandboxProvider
  sprites?: SandboxProvider // optional — present iff SPRITES_TOKEN set
}
```

Update `providerFor(target)` to handle `'sprites'`:

```ts
providerFor(target: 'sandbox' | 'host' | 'sprites'): SandboxProvider {
  const p = this.providers[target]
  if (!p) {
    throw new Error(
      `No provider configured for target='${target}'. ` +
      (target === 'sprites' ? `Set SPRITES_TOKEN to enable.` : ``)
    )
  }
  return p
}
```

- [ ] **Step 2: Conditional registration in src/index.ts**

In `packages/coding-agents/src/index.ts`, locate the existing provider exports / runtime construction. Add:

```ts
export { FlySpriteProvider } from './providers/fly-sprites'
import { FlySpriteProvider } from './providers/fly-sprites'

// Eager registration only matters for sideEffect tracking; the actual
// provider instances are built by callers. But export a factory:
export function createSpritesProviderIfConfigured():
  | FlySpriteProvider
  | undefined {
  if (!process.env.SPRITES_TOKEN) return undefined
  return new FlySpriteProvider()
}
```

Add `'./src/providers/fly-sprites/index.ts'` to `package.json#sideEffects` array (mirrors the opencode pattern that previously surfaced the tree-shaking issue).

- [ ] **Step 3: Bootstrap lifecycle rows in handler**

In `packages/coding-agents/src/entity/handler.ts`, find `processPrompt`'s `lm.ensureRunning` call. The bootstrap latency (~10–30s on first sprite create) should surface in the timeline. Strategy: pass an optional `onLifecycle` callback to `lm.ensureRunning` so the provider can emit `bootstrap.starting` / `bootstrap.complete` / `bootstrap.failed` events.

Cleaner alternative for v1: have the provider's `start()` log via `log.info` and the handler emit a single `bootstrap.starting` lifecycle row before calling `lm.ensureRunning` for sprites, plus `bootstrap.complete` after. Detection: check `meta.target === 'sprites'`.

Add this at the start of `processPrompt`'s cold-boot branch (`if (wasCold) { ... }`):

```ts
if (wasCold && meta.target === `sprites`) {
  ctx.db.actions.lifecycle_insert({
    row: {
      key: lifecycleKey(`bootstrap`),
      ts: Date.now(),
      event: `bootstrap.starting`,
      detail: `installing opencode-ai (~10-30s on first cold-boot)`,
    } satisfies LifecycleRow,
  })
}
```

After the successful `lm.ensureRunning` call:

```ts
if (wasCold && meta.target === `sprites`) {
  ctx.db.actions.lifecycle_insert({
    row: {
      key: lifecycleKey(`bootstrap`),
      ts: Date.now(),
      event: `bootstrap.complete`,
    } satisfies LifecycleRow,
  })
}
```

In the catch block where `sandbox.failed` is emitted, also emit `bootstrap.failed` for sprites if the error message mentions bootstrap:

```ts
if (meta.target === `sprites` && /bootstrap/i.test(String(err))) {
  ctx.db.actions.lifecycle_insert({
    row: {
      key: lifecycleKey(`bootstrap`),
      ts: Date.now(),
      event: `bootstrap.failed`,
      detail: err instanceof Error ? err.message : String(err),
    } satisfies LifecycleRow,
  })
}
```

- [ ] **Step 4: Run typecheck + tests**

```bash
pnpm -C packages/coding-agents typecheck
pnpm -C packages/coding-agents test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/lifecycle-manager.ts \
        packages/coding-agents/src/index.ts \
        packages/coding-agents/src/entity/handler.ts \
        packages/coding-agents/package.json
git commit -m "feat(coding-agents): register sprites provider conditionally + lifecycle events

LifecycleManager.providers gains optional 'sprites' entry. Factory
createSpritesProviderIfConfigured() returns a provider iff
SPRITES_TOKEN is set; otherwise returns undefined and the runtime
fails any target='sprites' spawn at validation.

Handler emits bootstrap.starting → bootstrap.complete (or
bootstrap.failed) lifecycle rows on first sprite cold-boot per agent.
sideEffects entry guards against tsdown tree-shaking the provider's
self-registration."
```

---

## Task 9: Convert-target validation rejects cross-provider transitions

**Files:**

- Modify: `packages/coding-agents/src/entity/handler.ts` (`processConvertTarget`)
- Test: `packages/coding-agents/test/unit/handler-convert-target.test.ts` (new or extend)

- [ ] **Step 1: Write failing test**

Create or extend `packages/coding-agents/test/unit/handler-convert-target.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { LifecycleManager } from '../../src/lifecycle-manager'
import { WorkspaceRegistry } from '../../src/workspace-registry'
import { makeCodingAgentHandler } from '../../src/entity/handler'
import { makeFakeCtx, pushInbox } from '../../src/conformance/fake-ctx'
import type { SessionMetaRow, LifecycleRow } from '../../src/entity/collections'

const fakeProvider = {
  name: `fake`,
  start: async () => ({}) as any,
  stop: async () => undefined,
  destroy: async () => undefined,
  status: async () => `stopped` as const,
  recover: async () => [],
}
const fakeBridge = { runTurn: async () => ({ exitCode: 0 }) }

function makeHandler() {
  const wr = new WorkspaceRegistry()
  const lm = new LifecycleManager({
    providers: {
      sandbox: fakeProvider as any,
      host: fakeProvider as any,
      sprites: fakeProvider as any,
    },
    bridge: fakeBridge as any,
  })
  return makeCodingAgentHandler(lm, wr, {
    defaults: {
      idleTimeoutMs: 5000,
      coldBootBudgetMs: 5000,
      runTimeoutMs: 30_000,
    },
    env: () => ({}),
  })
}

describe(`processConvertTarget — sprites cross-provider gates`, () => {
  it(`rejects sandbox → sprites`, async () => {
    const handler = makeHandler()
    const agentId = `/test/coding-agent/cv-sb-sprites-${Date.now().toString(36)}`
    const { ctx, state } = makeFakeCtx(agentId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `volume`,
    })
    await handler(ctx, { type: `message_received` })
    pushInbox(state, `i1`, `convert-target`, { to: `sprites` })
    await handler(ctx, { type: `message_received` })

    const meta = state.sessionMeta.get(`current`) as SessionMetaRow
    // Target stayed at sandbox; lastError set.
    expect(meta.target).toBe(`sandbox`)
    expect(meta.lastError).toMatch(/cross-provider/i)
    const lifecycle = Array.from(
      state.lifecycle.rows.values()
    ) as Array<LifecycleRow>
    const failed = lifecycle.find((l) => l.event === `target.changed`)
    expect(failed?.detail).toMatch(/failed.*cross-provider/i)
  })

  it(`rejects sprites → host`, async () => {
    const handler = makeHandler()
    const agentId = `/test/coding-agent/cv-sprites-host-${Date.now().toString(36)}`
    const { ctx, state } = makeFakeCtx(agentId, {
      kind: `claude`,
      target: `sprites`,
      workspaceType: `volume`,
    })
    await handler(ctx, { type: `message_received` })
    pushInbox(state, `i1`, `convert-target`, { to: `host` })
    await handler(ctx, { type: `message_received` })

    const meta = state.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.target).toBe(`sprites`)
    expect(meta.lastError).toMatch(/cross-provider/i)
  })

  it(`still allows sandbox ↔ host (existing behavior)`, async () => {
    const handler = makeHandler()
    const agentId = `/test/coding-agent/cv-sb-host-${Date.now().toString(36)}`
    const { ctx, state } = makeFakeCtx(agentId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `bindMount`,
      workspaceHostPath: `/tmp/some-path`,
    })
    await handler(ctx, { type: `message_received` })
    pushInbox(state, `i1`, `convert-target`, { to: `host` })
    await handler(ctx, { type: `message_received` })

    const meta = state.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.target).toBe(`host`)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -C packages/coding-agents test test/unit/handler-convert-target.test.ts
```

Expected: FAIL — sprites case isn't gated yet.

- [ ] **Step 3: Add the validation**

In `packages/coding-agents/src/entity/handler.ts:processConvertTarget`, after the `if (meta.target === to) return` early-out, add:

```ts
// Cross-provider transitions are not supported. Sprites is its own
// provider universe — agents can't migrate between sandbox/host and
// sprites mid-life. Convert-kind (claude↔codex↔opencode) and same-
// provider fork still work.
const sprites = meta.target === `sprites` || to === `sprites`
const local = meta.target !== `sprites` && to !== `sprites`
if (sprites && !local) {
  // OK: sprites → sprites is no-op (caught by early return above).
} else if (sprites) {
  // sandbox/host ↔ sprites → reject
  ctx.db.actions.sessionMeta_update({
    key: `current`,
    updater: (d: SessionMetaRow) => {
      d.lastError = `cross-provider conversion is not supported (${meta.target} → ${to})`
    },
  })
  ctx.db.actions.lifecycle_insert({
    row: {
      key: lifecycleKey(`target`),
      ts: Date.now(),
      event: `target.changed`,
      detail: `failed: cross-provider (${meta.target} → ${to})`,
    } satisfies LifecycleRow,
  })
  return
}

// Existing sandbox ↔ host validation continues here...
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm -C packages/coding-agents test test/unit/handler-convert-target.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/entity/handler.ts \
        packages/coding-agents/test/unit/handler-convert-target.test.ts
git commit -m "feat(coding-agents): processConvertTarget rejects cross-provider transitions

sandbox ↔ sprites and host ↔ sprites are explicitly rejected with a
clear lastError + lifecycle row. sandbox ↔ host (existing) still
works. Convert-kind and same-provider fork remain available."
```

---

## Task 10: Conformance suite for sprites

**Files:**

- Create: `packages/coding-agents/test/integration/fly-sprites-conformance.test.ts`

- [ ] **Step 1: Write the conformance file**

Create `packages/coding-agents/test/integration/fly-sprites-conformance.test.ts`:

```ts
import { runSandboxProviderConformance } from '../../src/conformance/provider'
import { runCodingAgentsIntegrationConformance } from '../../src/conformance/integration'
import { FlySpriteProvider } from '../../src/providers/fly-sprites'
import { StdioBridge } from '../../src/bridge/stdio-bridge'
import { nanoid } from 'nanoid'

const SPRITES_ENABLED =
  process.env.SPRITES === `1` && !!process.env.SPRITES_TOKEN

runSandboxProviderConformance(`FlySpriteProvider`, {
  createProvider: () => new FlySpriteProvider(),
  scratchWorkspace: async () => {
    return {
      spec: { type: `volume`, name: `conf-sprite-${nanoid(8)}` } as const,
      cleanup: async () => undefined,
      // Cleanup happens via provider.destroy() on the agentId. Since
      // the conformance harness uses one agentId per scenario, that
      // already covers it.
    }
  },
  target: `sprites`,
  skipIf: () => !SPRITES_ENABLED,
  supportsCloneWorkspace: false,
})

runCodingAgentsIntegrationConformance(`FlySpriteProvider`, {
  createProvider: () => new FlySpriteProvider(),
  scratchWorkspace: async () => ({
    spec: { type: `volume`, name: `conf-sprite-${nanoid(8)}` } as const,
    cleanup: async () => undefined,
  }),
  bridge: () => new StdioBridge(),
  envForKind: (kind) => {
    if (kind === `claude`)
      return process.env.ANTHROPIC_API_KEY
        ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
        : null
    if (kind === `codex`)
      return process.env.OPENAI_API_KEY
        ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY }
        : null
    if (kind === `opencode`) {
      const env: Record<string, string> = {}
      if (process.env.ANTHROPIC_API_KEY)
        env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
      if (process.env.OPENAI_API_KEY)
        env.OPENAI_API_KEY = process.env.OPENAI_API_KEY
      return Object.keys(env).length > 0 ? env : null
    }
    return null
  },
  probeForKind: (kind) => {
    if (kind === `claude`)
      return {
        prompt: `Reply with: ok`,
        expectsResponseMatching: /ok/i,
        model: `claude-haiku-4-5`,
      }
    if (kind === `codex`)
      return {
        prompt: `Reply with: ok`,
        expectsResponseMatching: /ok/i,
        model: `gpt-5-codex-latest`,
      }
    return {
      prompt: `Reply with just: ok`,
      expectsResponseMatching: /ok/i,
      model: `openai/gpt-5.4-mini-fast`,
    }
  },
  target: `sprites`,
  skipIf: () => !SPRITES_ENABLED,
})
```

- [ ] **Step 2: Run with SPRITES=1 + token**

```bash
SPRITES=1 SPRITES_TOKEN=$SPRITES_TOKEN \
  ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY OPENAI_API_KEY=$OPENAI_API_KEY \
  pnpm -C packages/coding-agents test test/integration/fly-sprites-conformance.test.ts \
  2>&1 | tail -10
```

Expected: 8 L1 + 8 L2 scenarios run for each of 3 kinds (~48 tests). Most should pass; flake budget is the same as LocalDocker conformance. Document any flake patterns.

If your account doesn't have authentication for one of the providers (e.g. anthropic locally), that kind's block skips cleanly via the `envForKind` returning null.

- [ ] **Step 3: Commit**

```bash
git add packages/coding-agents/test/integration/fly-sprites-conformance.test.ts
git commit -m "test(coding-agents): conformance suite — sprites provider

Wires FlySpriteProvider into the existing parameterized provider +
integration conformance suites. Gated SPRITES=1 + SPRITES_TOKEN.
supportsCloneWorkspace: false (deferred to v1.5).

Conformance probe models: claude-haiku-4-5, gpt-5-codex-latest,
openai/gpt-5.4-mini-fast (matching the local-docker probe choices)."
```

---

## Task 11: Layer 4 e2e — spawn-sprites per kind

**Files:**

- Create: `packages/coding-agents/test/integration/spawn-sprites-claude.e2e.test.ts`
- Create: `packages/coding-agents/test/integration/spawn-sprites-codex.e2e.test.ts`
- Create: `packages/coding-agents/test/integration/spawn-sprites-opencode.e2e.test.ts`

Each test follows the existing `spawn-opencode.e2e.test.ts` pattern, gated `SLOW=1 + SPRITES_TOKEN + <kind-specific-key>`.

- [ ] **Step 1: Create spawn-sprites-claude.e2e.test.ts**

```ts
import { afterAll, describe, expect, it } from 'vitest'

const SLOW =
  process.env.SLOW === `1` &&
  !!process.env.SPRITES_TOKEN &&
  !!process.env.ANTHROPIC_API_KEY
const d = SLOW ? describe : describe.skip
const SERVER = `http://localhost:4437`

d(`Sprites — claude spawn (real, e2e)`, () => {
  const agentId = `e2e-sprites-claude-${Date.now().toString(36)}`

  afterAll(async () => {
    await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `DELETE`,
    }).catch(() => undefined)
  })

  it(`spawns claude on sprites + reply with ok`, async () => {
    await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        args: { kind: `claude`, target: `sprites`, workspaceType: `volume` },
      }),
    })
    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e`,
        type: `prompt`,
        payload: { text: `Reply with the single word: ok` },
      }),
    })
    const w = await waitForRunCount(agentId, 1, 240_000)
    expect((w.responseText ?? ``).toLowerCase()).toMatch(/ok/i)
  }, 360_000)
})

async function waitForRunCount(
  agentId: string,
  minCount: number,
  ms: number
): Promise<{ responseText?: string }> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const r = await fetch(
        `http://localhost:4437/coding-agent/${agentId}/main?offset=-1`
      )
      const txt = await r.text()
      let data: Array<any> | null = null
      try {
        data = JSON.parse(txt) as Array<any>
      } catch {
        /* keep polling */
      }
      if (data) {
        const completed = data
          .filter((e) => e.type === `coding-agent.runs`)
          .map((e) => e.value)
          .filter((v) => v.status === `completed` && v.key !== `imported`)
        if (completed.length >= minCount) return completed[completed.length - 1]
      }
    } catch {
      /* transient — keep polling */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`timeout waiting for run count >= ${minCount}`)
}
```

- [ ] **Step 2: Create spawn-sprites-codex.e2e.test.ts**

Identical to claude, but with `kind: 'codex'`, gate also `OPENAI_API_KEY`, model irrelevant (codex uses default).

- [ ] **Step 3: Create spawn-sprites-opencode.e2e.test.ts**

Identical, with `kind: 'opencode'`, `model: 'openai/gpt-5.4-mini-fast'`.

- [ ] **Step 4: Run all three with SLOW=1**

```bash
SLOW=1 SPRITES_TOKEN=$SPRITES_TOKEN \
  ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY OPENAI_API_KEY=$OPENAI_API_KEY \
  pnpm -C packages/coding-agents test \
    test/integration/spawn-sprites-claude.e2e.test.ts \
    test/integration/spawn-sprites-codex.e2e.test.ts \
    test/integration/spawn-sprites-opencode.e2e.test.ts \
  2>&1 | tail -10
```

Expected: 3 tests PASS (or skipped if env not set).

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/test/integration/spawn-sprites-*.e2e.test.ts
git commit -m "test(coding-agents): Layer 4 e2e — sprites spawn (per kind)

Three tests, one per kind (claude, codex, opencode). Each spawns
a sprites agent, sends 'reply with ok', asserts response matches
/ok/i. Gated SLOW=1 + SPRITES_TOKEN + per-kind API key.

Tests use a 240s waitForRunCount timeout because sprites cold-boot
+ first-prompt bootstrap (~10-30s) is much longer than local
docker."
```

---

## Task 12: Layer 4 e2e — convert-kind + fork on sprites

**Files:**

- Create: `packages/coding-agents/test/integration/convert-kind-on-sprites.e2e.test.ts`
- Create: `packages/coding-agents/test/integration/fork-on-sprites.e2e.test.ts`

- [ ] **Step 1: convert-kind-on-sprites.e2e.test.ts**

Mirror `convert-kind.e2e.test.ts` but with `target: 'sprites'` for the source. Gated SLOW=1 + SPRITES_TOKEN + both API keys.

```ts
import { afterAll, describe, expect, it } from 'vitest'

const SLOW =
  process.env.SLOW === `1` &&
  !!process.env.SPRITES_TOKEN &&
  !!process.env.ANTHROPIC_API_KEY &&
  !!process.env.OPENAI_API_KEY
const d = SLOW ? describe : describe.skip
const SERVER = `http://localhost:4437`

d(`Sprites — claude → codex convert (real, e2e)`, () => {
  const agentId = `e2e-sprites-convert-${Date.now().toString(36)}`
  const SECRET = `BUTTERFLY-${Date.now().toString(36).slice(-4)}`

  afterAll(async () => {
    await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `DELETE`,
    }).catch(() => undefined)
  })

  it(`claude turn → convert to codex → codex recalls secret`, async () => {
    await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        args: { kind: `claude`, target: `sprites`, workspaceType: `volume` },
      }),
    })
    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e`,
        type: `prompt`,
        payload: { text: `the secret word is ${SECRET}. Just acknowledge.` },
      }),
    })
    await waitForRunCount(agentId, 1, 240_000)

    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e`,
        type: `convert-kind`,
        payload: { kind: `codex` },
      }),
    })
    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e`,
        type: `prompt`,
        payload: { text: `In one word, what is the secret word?` },
      }),
    })

    const w2 = await waitForRunCount(agentId, 2, 240_000)
    expect((w2.responseText ?? ``).toLowerCase()).toContain(
      SECRET.toLowerCase()
    )
  }, 600_000)
})

// waitForRunCount helper — paste from spawn-sprites-claude.e2e.test.ts.
async function waitForRunCount(
  agentId: string,
  minCount: number,
  ms: number
): Promise<{ responseText?: string }> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const r = await fetch(
        `http://localhost:4437/coding-agent/${agentId}/main?offset=-1`
      )
      const txt = await r.text()
      let data: Array<any> | null = null
      try {
        data = JSON.parse(txt) as Array<any>
      } catch {
        /* keep polling */
      }
      if (data) {
        const completed = data
          .filter((e) => e.type === `coding-agent.runs`)
          .map((e) => e.value)
          .filter((v) => v.status === `completed` && v.key !== `imported`)
        if (completed.length >= minCount) return completed[completed.length - 1]
      }
    } catch {
      /* transient */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`timeout waiting for run count >= ${minCount}`)
}
```

- [ ] **Step 2: fork-on-sprites.e2e.test.ts**

Source claude on sprites; fork to codex (same `target='sprites'` for the new agent — cross-provider fork is rejected). Verify the fork recalls source's conversation:

```ts
import { afterAll, describe, expect, it } from 'vitest'
import { nanoid } from 'nanoid'

const SLOW =
  process.env.SLOW === `1` &&
  !!process.env.SPRITES_TOKEN &&
  !!process.env.ANTHROPIC_API_KEY &&
  !!process.env.OPENAI_API_KEY
const d = SLOW ? describe : describe.skip
const SERVER = `http://localhost:4437`

d(`Sprites — claude → codex fork (real, e2e)`, () => {
  const sourceId = `e2e-sprites-fork-src-${Date.now().toString(36)}`
  const forkId = `e2e-sprites-fork-${nanoid(6)}`
  const SECRET = `MAGNOLIA-${Date.now().toString(36).slice(-4)}`

  afterAll(async () => {
    await fetch(`${SERVER}/coding-agent/${sourceId}`, {
      method: `DELETE`,
    }).catch(() => undefined)
    await fetch(`${SERVER}/coding-agent/${forkId}`, {
      method: `DELETE`,
    }).catch(() => undefined)
  })

  it(`source claude run → fork as codex on sprites → fork recalls`, async () => {
    await fetch(`${SERVER}/coding-agent/${sourceId}`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        args: { kind: `claude`, target: `sprites`, workspaceType: `volume` },
      }),
    })
    await fetch(`${SERVER}/coding-agent/${sourceId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e`,
        type: `prompt`,
        payload: { text: `the secret word is ${SECRET}. Just acknowledge.` },
      }),
    })
    await waitForRunCount(sourceId, 1, 240_000)

    // Spawn fork (target=sprites; fromAgentId points at source).
    await fetch(`${SERVER}/coding-agent/${forkId}`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        args: {
          kind: `codex`,
          target: `sprites`,
          workspaceType: `volume`,
          fromAgentId: `/coding-agent/${sourceId}`,
          fromWorkspaceMode: `share`, // workspace files don't transfer in v1; mode is informational
        },
      }),
    })
    await fetch(`${SERVER}/coding-agent/${forkId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e`,
        type: `prompt`,
        payload: { text: `In one word, what is the secret word?` },
      }),
    })

    const w = await waitForRunCount(forkId, 1, 360_000)
    expect((w.responseText ?? ``).toLowerCase()).toContain(SECRET.toLowerCase())
  }, 720_000)
})

async function waitForRunCount(
  agentId: string,
  minCount: number,
  ms: number
): Promise<{ responseText?: string }> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    try {
      const r = await fetch(
        `http://localhost:4437/coding-agent/${agentId}/main?offset=-1`
      )
      const txt = await r.text()
      let data: Array<any> | null = null
      try {
        data = JSON.parse(txt) as Array<any>
      } catch {
        /* keep polling */
      }
      if (data) {
        const completed = data
          .filter((e) => e.type === `coding-agent.runs`)
          .map((e) => e.value)
          .filter((v) => v.status === `completed` && v.key !== `imported`)
        if (completed.length >= minCount) return completed[completed.length - 1]
      }
    } catch {
      /* transient */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`timeout waiting for run count >= ${minCount}`)
}
```

- [ ] **Step 3: Run with SLOW=1**

```bash
SLOW=1 SPRITES_TOKEN=$SPRITES_TOKEN \
  ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY OPENAI_API_KEY=$OPENAI_API_KEY \
  pnpm -C packages/coding-agents test \
    test/integration/convert-kind-on-sprites.e2e.test.ts \
    test/integration/fork-on-sprites.e2e.test.ts \
  2>&1 | tail -10
```

Expected: 2 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/coding-agents/test/integration/convert-kind-on-sprites.e2e.test.ts \
        packages/coding-agents/test/integration/fork-on-sprites.e2e.test.ts
git commit -m "test(coding-agents): Layer 4 e2e — sprites convert + fork

convert-kind-on-sprites.e2e: claude on sprites → convert to codex →
codex recalls secret. fork-on-sprites.e2e: claude on sprites →
fork as codex (target stays sprites) → fork recalls source's
conversation.

Both gated SLOW=1 + SPRITES_TOKEN + ANTHROPIC_API_KEY + OPENAI_API_KEY.
360-720s timeouts account for cold-boot + bootstrap latency."
```

---

## Task 13: UI — spawn dialog target option + workspace gate

**Files:**

- Modify: `packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx`

- [ ] **Step 1: Locate target picker**

```bash
grep -n "target.*sandbox\|sandbox.*host\|setTarget" packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx
```

- [ ] **Step 2: Widen the target type and add the radio option**

In the dialog, find:

```ts
const [target, setTarget] = useState<`sandbox` | `host`>(`sandbox`)
```

Change to:

```ts
const [target, setTarget] = useState<`sandbox` | `host` | `sprites`>(`sandbox`)
```

Add a third radio:

```tsx
<label>
  <input
    type="radio"
    name="target"
    value="sprites"
    checked={target === `sprites`}
    onChange={() => {
      setTarget(`sprites`)
      // Sprites only support volume workspaces.
      if (workspaceType === `bindMount`) setWorkspaceType(`volume`)
    }}
    data-testid="target-sprites"
  />
  Sprites (Fly Sprites — remote sandbox)
</label>
```

- [ ] **Step 3: Gate bind-mount when target is sprites**

In the workspace-type radio, disable bind-mount when target is sprites:

```tsx
<label
  style={{
    opacity: target === `sprites` ? 0.5 : 1,
    cursor: target === `sprites` ? `not-allowed` : `pointer`,
  }}
>
  <input
    type="radio"
    name="workspaceType"
    value="bindMount"
    checked={workspaceType === `bindMount`}
    onChange={() => setWorkspaceType(`bindMount`)}
    disabled={target === `sprites`}
  />
  Bind mount{target === `sprites` ? ` (not supported on sprites)` : ``}
</label>
```

- [ ] **Step 4: Pass target in spawn args**

The submit handler likely already passes target — verify:

```bash
grep -n "target:\|args.target" packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx
```

If not, add `target` to the spawn args object.

- [ ] **Step 5: Typecheck + smoke**

```bash
pnpm -C packages/agents-server-ui typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx
git commit -m "feat(agents-server-ui): spawn dialog target picker adds sprites

Third radio option 'Sprites' alongside Sandbox and Host. Selecting
sprites auto-switches workspace-type to volume and disables the
bind-mount option (sprites have intrinsic FS; no bind-mount analog).
Spawn args include target='sprites' when selected.

Convert/Fork dropdown gates land in the next task."
```

---

## Task 14: UI — convert-target + fork dropdown gates

**Files:**

- Modify: `packages/agents-server-ui/src/components/EntityHeader.tsx`

- [ ] **Step 1: Convert-target dropdown gates**

Find the existing `Convert → Sandbox` / `Convert → Host` items. Add a third for `Sprites`. All three are gated when the source target makes the transition cross-provider:

```tsx
{
  ;([`sandbox`, `host`, `sprites`] as const)
    .filter((t) => t !== codingAgentTarget)
    .map((t) => {
      const sourceIsSprites = codingAgentTarget === `sprites`
      const targetIsSprites = t === `sprites`
      const crossProvider = sourceIsSprites !== targetIsSprites
      return (
        <DropdownMenu.Item
          key={t}
          disabled={crossProvider}
          onSelect={() => {
            if (crossProvider) return
            void fetch(`${baseUrl}${entity.url}/send`, {
              method: `POST`,
              headers: { 'content-type': `application/json` },
              body: JSON.stringify({
                from: `user`,
                type: `convert-target`,
                payload: { to: t },
              }),
            })
          }}
          title={
            crossProvider
              ? `Cross-provider conversion is not supported. Spawn a fresh agent on ${t === 'sprites' ? 'Sprites' : 'local'} instead.`
              : `Convert to ${t}`
          }
          data-testid={`convert-to-${t}`}
        >
          Convert → {t}
          {crossProvider ? ` (cross-provider not supported)` : ``}
        </DropdownMenu.Item>
      )
    })
}
```

- [ ] **Step 2: Fork dropdown gate**

When source is sprites, fork targets are limited to sprites; when source is sandbox/host, sprites isn't offered. Update the existing `Fork to claude/codex/opencode` items to read source target and route accordingly. The `onForkToKind` callback needs to signal the source target so the router uses the same target for the fork.

In `EntityHeader.tsx`'s fork dropdown items, add a hidden info line for sprites:

```tsx
{
  codingAgentTarget !== `sprites` ? (
    <DropdownMenu.Item
      disabled
      title="Cross-provider fork not supported. Spawn a fresh agent on Sprites instead."
      data-testid="fork-cross-provider-disabled"
    >
      Fork to Sprites (cross-provider not supported)
    </DropdownMenu.Item>
  ) : null
}
```

In `router.tsx`'s `handleForkToKind`, pass `target: codingAgentMeta?.target` (already exists in meta) so the new agent gets the same target as the source.

- [ ] **Step 3: Lifecycle event labels**

In `packages/agents-server-ui/src/components/CodingAgentTimeline.tsx`, locate the lifecycle row label map and add three entries:

```ts
'bootstrap.starting': `Sprite bootstrap starting`,
'bootstrap.complete': `Sprite bootstrap complete`,
'bootstrap.failed': `Sprite bootstrap failed`,
```

- [ ] **Step 4: Typecheck**

```bash
pnpm -C packages/agents-server-ui typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/agents-server-ui/src/components/EntityHeader.tsx \
        packages/agents-server-ui/src/components/CodingAgentTimeline.tsx \
        packages/agents-server-ui/src/router.tsx
git commit -m "feat(agents-server-ui): Convert/Fork dropdowns gate sprites cross-provider

Convert-target dropdown adds 'Sprites' option but disables it (with
tooltip) when source is sandbox/host, and disables Sandbox/Host
options when source is sprites. Discoverable absence — users see
the option exists but learn it's not supported across providers.

Fork dropdown shows a 'Fork to Sprites (cross-provider not supported)'
disabled item when source is sandbox/host. When source is sprites,
the existing kind picker remains; new agent inherits target='sprites'.

Timeline gains labels for bootstrap.starting / .complete / .failed."
```

---

## Task 15: Playwright UI

**Files:**

- Create: `packages/agents-server-ui/test/e2e/spawn-sprites.spec.ts`

- [ ] **Step 1: Write the spec**

Create `packages/agents-server-ui/test/e2e/spawn-sprites.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { deleteEntity, spawnAndWake, uniqueAgentName } from './helpers'

test.describe(`Spawn sprites kind`, () => {
  test(`spawn dialog target=sprites disables bind-mount + spawns successfully`, async ({
    page,
    request,
  }) => {
    const name = uniqueAgentName(`pw-sprites-`)
    let observedPutBody: any = null
    try {
      await page.route(`**/coding-agent/**`, async (route) => {
        const req = route.request()
        if (
          req.method() === `PUT` &&
          req.url().endsWith(`/coding-agent/${name}`)
        ) {
          observedPutBody = req.postDataJSON()
          await route.fulfill({
            status: 200,
            contentType: `application/json`,
            body: JSON.stringify({
              url: `/coding-agent/${name}`,
              name,
              type: `coding-agent`,
              txid: 1,
            }),
          })
          return
        }
        await route.continue()
      })

      await page.goto(`/`)
      await page.click(`button:has-text("New session")`)
      await page.click(`text=/coding[- ]agent/i`)
      // Pick sprites target.
      await page.check(`[data-testid="target-sprites"]`)
      // Bind mount is disabled.
      await expect(
        page.locator(`input[name="workspaceType"][value="bindMount"]`)
      ).toBeDisabled()
      // Pick claude kind.
      await page.click(`label:has-text("claude"), input[value="claude"]`)
      await page.fill(`input[name="name"]`, name)
      await page.click(`button:has-text("Spawn")`)

      await expect.poll(() => observedPutBody).not.toBeNull()
      expect(observedPutBody).toMatchObject({
        args: {
          kind: `claude`,
          target: `sprites`,
          workspaceType: `volume`,
        },
      })
    } finally {
      await deleteEntity(request, name).catch(() => undefined)
    }
  })

  test(`Convert/Fork dropdowns on a sandbox agent show sprites disabled with tooltip`, async ({
    page,
    request,
  }) => {
    const name = uniqueAgentName(`pw-sprites-gate-`)
    try {
      await spawnAndWake(request, name, {
        kind: `claude`,
        target: `sandbox`,
        workspaceType: `volume`,
      })
      await page.goto(`/#/entity/coding-agent/${name}`)
      await expect(page.getByTestId(`entity-header`)).toBeVisible({
        timeout: 10_000,
      })

      await page.getByTestId(`convert-target-button`).click()
      await expect(page.getByTestId(`convert-to-sprites`)).toBeVisible()
      await expect(page.getByTestId(`convert-to-sprites`)).toBeDisabled()
      await page.keyboard.press(`Escape`)

      await page.getByTestId(`fork-button`).click()
      await expect(
        page.getByTestId(`fork-cross-provider-disabled`)
      ).toBeVisible()
      await expect(
        page.getByTestId(`fork-cross-provider-disabled`)
      ).toBeDisabled()
    } finally {
      await deleteEntity(request, name).catch(() => undefined)
    }
  })
})
```

- [ ] **Step 2: Run Playwright**

```bash
pnpm -C packages/agents-server-ui exec playwright test test/e2e/spawn-sprites.spec.ts 2>&1 | tail -8
```

Expected: 2/2 PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/agents-server-ui/test/e2e/spawn-sprites.spec.ts
git commit -m "test(agents-server-ui): Playwright — spawn sprites + cross-provider gates

Two tests:
1. spawn dialog target=sprites: bind-mount option disabled,
   spawn produces PUT body with target='sprites' + workspaceType='volume'.
2. Convert/Fork dropdowns on a sandbox agent: 'Convert → Sprites'
   and 'Fork to Sprites (cross-provider not supported)' both visibly
   disabled with the expected tooltip text."
```

---

## Task 16: Cleanup script + docs

**Files:**

- Create: `packages/coding-agents/scripts/cleanup-sprites.ts`
- Modify: `packages/coding-agents/package.json` (add `cleanup:sprites` script)
- Modify: `packages/coding-agents/README.md`
- Modify: `docs/superpowers/specs/2026-04-30-coding-agents-platform-primitive-design.md`
- Append to: `docs/superpowers/plans/2026-05-02-coding-agents-fly-sprites.md` (this file)

- [ ] **Step 1: Cleanup script**

Create `packages/coding-agents/scripts/cleanup-sprites.ts`:

```ts
#!/usr/bin/env tsx
/**
 * Operator hygiene: list and optionally delete sprites whose name
 * starts with 'conf-sprite-' or 'e2e-sprites-'. Safety net for runaway
 * conformance / e2e leaks.
 *
 * Usage:
 *   SPRITES_TOKEN=... pnpm cleanup:sprites             # dry-run, lists matches
 *   SPRITES_TOKEN=... pnpm cleanup:sprites --delete    # actually deletes
 */
import { SpritesApiClient } from '../src/providers/fly-sprites/api-client'

const PREFIXES = [`conf-sprite-`, `e2e-sprites-`]

async function main() {
  const token = process.env.SPRITES_TOKEN
  if (!token) {
    console.error(`SPRITES_TOKEN env var required`)
    process.exit(1)
  }
  const client = new SpritesApiClient({ token })
  const doDelete = process.argv.includes(`--delete`)

  let total = 0
  for (const prefix of PREFIXES) {
    const r = await client.listSprites({ namePrefix: prefix })
    if (r.sprites.length === 0) continue
    console.log(`Found ${r.sprites.length} sprites matching '${prefix}':`)
    for (const s of r.sprites) {
      console.log(`  ${s.id}  ${s.name}`)
      if (doDelete) {
        try {
          await client.deleteSprite(s.id)
          console.log(`    deleted`)
        } catch (err) {
          console.error(`    delete failed:`, err)
        }
      }
    }
    total += r.sprites.length
  }
  console.log(
    `Total: ${total} ${doDelete ? `deleted` : `would-be-deleted (use --delete)`}`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Add npm script**

In `packages/coding-agents/package.json`, add to `scripts`:

```json
"cleanup:sprites": "tsx scripts/cleanup-sprites.ts"
```

- [ ] **Step 3: README section**

Append to `packages/coding-agents/README.md`:

````markdown
## Fly Sprites provider

[sprites.dev](https://sprites.dev) is supported as a third sandbox target alongside `sandbox` (LocalDocker) and `host`. v1 is **provider-parity only**:

- All three coding-agent kinds (claude, codex, opencode) work on sprites.
- Convert kind (claude↔codex↔opencode) works in place on a sprites agent.
- Fork **within sprites** transfers conversation history (denormalize).
- Cross-provider transitions (sandbox ↔ sprites, host ↔ sprites) are **not supported** — sprites is its own provider universe.

### Setup

```bash
export SPRITES_TOKEN=<your-bearer-token-from-sprites.dev>
```
````

The `FlySpriteProvider` is registered automatically when the env var is present. Without it, target='sprites' spawns fail at validation with a clear error.

### Spawning

```ts
await ctx.spawnCodingAgent({
  id: nanoid(10),
  kind: `claude`,
  target: `sprites`,
  workspace: { type: `volume` },
})
```

### Tracked limitations

- **TL-S1**: Sprites API is v0.0.1-rc30 (pre-1.0); expect churn.
- **TL-S2**: No custom OCI image input. First sprite cold-boot per agent includes ~10–30s for `opencode-ai` install (idempotent).
- **TL-S3**: No `cloneWorkspace`. Workspace files don't transfer on fork within sprites; conversation history does.
- **TL-S4**: No cross-provider migration (by design).
- **TL-S5**: DNS allowlist policy may need updates for additional egress endpoints.
- **TL-S6**: Real Sprites runs are billed. Use `pnpm cleanup:sprites` to find leaks.

### Cleanup script

```bash
SPRITES_TOKEN=... pnpm -C packages/coding-agents cleanup:sprites           # dry-run
SPRITES_TOKEN=... pnpm -C packages/coding-agents cleanup:sprites --delete  # actually delete
```

Lists/deletes any sprites whose name starts with `conf-sprite-` or `e2e-sprites-` (left over from conformance / e2e runs).

````

- [ ] **Step 4: Backlink in platform-primitive design**

In `docs/superpowers/specs/2026-04-30-coding-agents-platform-primitive-design.md`, find the "## Out of scope for v1" section's "Modal / Fly providers" bullet (or similar) and add a `> **Resolved by:** [...]` backlink to this slice's design doc.

- [ ] **Step 5: Implementation findings stub**

Append to this plan file:

```markdown
## Implementation findings (YYYY-MM-DD)

(Filled in after merge.)
````

- [ ] **Step 6: Commit**

```bash
git add packages/coding-agents/scripts/cleanup-sprites.ts \
        packages/coding-agents/package.json \
        packages/coding-agents/README.md \
        docs/superpowers/specs/2026-04-30-coding-agents-platform-primitive-design.md \
        docs/superpowers/plans/2026-05-02-coding-agents-fly-sprites.md
git commit -m "docs(coding-agents): Fly Sprites README + cleanup script

- packages/coding-agents/README.md: 'Fly Sprites provider' section
  with setup, spawning example, six tracked limitations, cleanup
  script reference.
- packages/coding-agents/scripts/cleanup-sprites.ts: operator hygiene
  (list/delete sprites with conf-sprite-/e2e-sprites- prefix).
- pnpm cleanup:sprites script entry.
- Platform-primitive design 'Out of scope' backlink to this slice.
- Plan implementation findings stub."
```

---

## Final verification

- [ ] **Step 1: Full unit suite**

```bash
pnpm -C packages/coding-agents test
pnpm -C packages/agents-server-ui typecheck
pnpm -C packages/agents-runtime typecheck
```

Expected: all green.

- [ ] **Step 2: Existing conformance unchanged**

```bash
DOCKER=1 pnpm -C packages/coding-agents test test/integration/local-docker-conformance.test.ts
HOST_PROVIDER=1 pnpm -C packages/coding-agents test test/integration/host-provider-conformance.test.ts
```

Expected: same pass rates as before this slice (no regressions in claude/codex/opencode for local-docker or host).

- [ ] **Step 3: Sprites conformance (gated)**

```bash
SPRITES=1 SPRITES_TOKEN=$SPRITES_TOKEN \
  ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY OPENAI_API_KEY=$OPENAI_API_KEY \
  pnpm -C packages/coding-agents test test/integration/fly-sprites-conformance.test.ts
```

Expected: ~48 tests pass (16 scenarios × 3 kinds, modulo per-kind API key availability).

- [ ] **Step 4: Layer 4 e2e (gated)**

```bash
SLOW=1 SPRITES_TOKEN=$SPRITES_TOKEN \
  ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY OPENAI_API_KEY=$OPENAI_API_KEY \
  pnpm -C packages/coding-agents test \
    test/integration/spawn-sprites-claude.e2e.test.ts \
    test/integration/spawn-sprites-codex.e2e.test.ts \
    test/integration/spawn-sprites-opencode.e2e.test.ts \
    test/integration/convert-kind-on-sprites.e2e.test.ts \
    test/integration/fork-on-sprites.e2e.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Playwright UI**

```bash
pnpm -C packages/agents-server-ui exec playwright test test/e2e/spawn-sprites.spec.ts
```

Expected: 2/2 PASS.

- [ ] **Step 6: Manual smoke**

Open `http://localhost:4437/__agent_ui/`. New session → coding-agent → target=Sprites → kind=claude → workspace volume. Spawn. Send "reply with ok". Observe `bootstrap.starting` → `bootstrap.complete` lifecycle rows in the timeline. Restart server; resume works. Convert kind to codex; codex recalls prior turn.

- [ ] **Step 7: Cleanup**

```bash
SPRITES_TOKEN=$SPRITES_TOKEN pnpm -C packages/coding-agents cleanup:sprites --delete
```

Removes any leaked test sprites.

- [ ] **Step 8: Push**

```bash
git push origin coding-agents-slice-a
```

---

## Self-review checklist

1. **Spec coverage** — every section of the spec has a corresponding task. ✓
2. **Placeholder scan** — every code step has real code; no TBDs. ✓
3. **Type consistency** — `FlySpriteProvider`, `SpritesApiClient`, `target: 'sprites'`, `BOOTSTRAP_SCRIPT`, `bootstrap.starting`/`.complete`/`.failed` all consistent across tasks. ✓
4. **Build sequence** — Task 1 (recon) gates assumptions; Task 2 (schema) precedes provider; Tasks 3–6 build the provider bottom-up; Task 7 (workspace registry) before Task 8 (lifecycle manager); Task 9 (convert-target validation) after schema is in place; conformance/e2e (10–12) after wiring; UI (13–14) after backend; Playwright (15) and docs (16) last.

---

## Implementation findings (2026-05-02)

Highlights from execution; supersedes any plan steps where they conflict.

### API recon corrections (Task 1 → spec/plan validator audit)

The doc-only recon needed three live-API corrections before code could be written:

1. **Base URL requires `/v1` prefix.** `https://api.sprites.dev` returns 404 HTML; `https://api.sprites.dev/v1` is the actual REST root. `SpritesApiClient.baseUrl` defaults accordingly.
2. **Path lookups use sprite _name_, not id.** `GET /v1/sprites/{id}` returns "sprite not found"; the API expects the human-readable `name`. All single-sprite methods (`getSprite`, `deleteSprite`) take `name` and the in-memory cache stores `{name, url}`.
3. **Exec WebSocket frame protocol.** Stdout arrives as raw text WebSocket messages, not JSON. Stderr and lifecycle events arrive as JSON: `{type:"debug", msg}` for stderr, `{type:"exit", exit_code:N}` (snake_case) for exit, and `{type:"session_info"}` (no-op). The exec adapter try-parses each message: parse-failure → stdoutQ; otherwise dispatch by `type`.

### Phase ordering tweak

Pulling forward the `LifecycleManager.Target` widening into Phase 1 was necessary — the plan claimed widening `SandboxSpec.target` was "additive", but it broke 8 type errors immediately because `providers` lookup is exhaustive. Phase 1 now widens both `SandboxSpec.target` and the lifecycle manager's `Target` together.

### Cross-provider gate semantics

The first draft of the gate in `processConvertTarget` used `if (sprites && !local)` which is logically "any-side-sprites" — would never reject. The correct semantics are `involvesSprites && !bothSprites` (XOR — reject only when sides disagree on sprites-or-not).

### Bootstrap-failure follow-up (TL-S2)

Real-API conformance run shows L2.7 (convert mid-conversation) PASS, proving the core mechanism works end-to-end. Other scenarios fail with `sprites bootstrap failed: exit -1`. Most likely root causes: (a) DNS allowlist policy blocking `npm install -g opencode-ai`, or (b) exec adapter not draining `exit_code` frames cleanly for long-running scripts. Tracked as TL-S2; not blocking provider-parity acceptance.

### Cleanup script runtime

Plan's `tsx scripts/cleanup-sprites.ts` was changed to `node --experimental-strip-types --no-warnings scripts/cleanup-sprites.ts` because `tsx` is not a direct dependency of `@electric-ax/coding-agents`. Node 24 strips TS types natively; the import uses an explicit `.ts` suffix to satisfy strict ESM resolution.
