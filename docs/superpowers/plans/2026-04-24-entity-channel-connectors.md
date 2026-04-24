# Entity Channel Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect entities to external messaging platforms (Telegram, Discord) with bidirectional communication, configured at the entity type definition level via `defineEntity()`.

**Architecture:** New `channels` property on entity definitions declares platform bindings. A server-side `ChannelManager` orchestrates composable `PlatformAdapter` instances (one per platform). Inbound platform messages auto-spawn entity instances and wake them with normalized `channel_message` events. Agent output is implicitly forwarded back via `DraftStreamLoop` (streaming edit-in-place) or send-on-complete. A `HealthMonitor` auto-restarts failed adapters with exponential backoff.

**Tech Stack:** TypeScript, Vitest, grammy (Telegram Bot API), discord.js (Discord Gateway + REST), Drizzle ORM (Postgres schema), pino (logging)

**Spec:** `docs/superpowers/specs/2026-04-24-entity-channel-connectors-design.md`

---

## File Structure

### `packages/agents-runtime`

| File | Responsibility |
|------|---------------|
| `src/channels/types.ts` | `ChannelConfig`, `TelegramChannelConfig`, `DiscordChannelConfig`, `ChannelMessageWakeEvent`, `PlatformAdapter` sub-interfaces, `OutboundOpts`, `MessageRef`, `DraftStreamLoop` |
| `src/channels/index.ts` | Re-exports types + config factories |
| `src/channels/telegram.ts` | `telegram()` config factory |
| `src/channels/discord.ts` | `discord()` config factory |
| `src/types.ts` | Add `channelSend` to `HandlerContext`, add `PendingChannelSend` type |
| `src/define-entity.ts` | Accept `channels` field in `EntityDefinition` |
| `src/context-factory.ts` | Wire `ctx.channelSend()` into handler context |
| `test/channels/channel-config.test.ts` | Unit tests for config factories |

### `packages/agents-server`

| File | Responsibility |
|------|---------------|
| `src/channels/channel-manager.ts` | `ChannelManager` — adapter lifecycle, inbound routing, outbound watching |
| `src/channels/draft-stream-loop.ts` | `DraftStreamLoop` — throttled edit-in-place streaming |
| `src/channels/health-monitor.ts` | `HealthMonitor` — stale detection, exponential backoff restart |
| `src/channels/telegram/telegram-adapter.ts` | `TelegramAdapter` — webhook gateway + outbound via grammy |
| `src/channels/discord/discord-adapter.ts` | `DiscordAdapter` — WebSocket gateway + REST outbound via discord.js |
| `src/db/schema.ts` | Add `channels` column to `entity_types` table |
| `src/db/migrations/add-channels-column.ts` | SQL migration for `channels` JSONB column |
| `src/electric-agents-types.ts` | Add `channels` to `ElectricAgentsEntityType` |
| `src/electric-agents-manager.ts` | Notify `ChannelManager` on entity type registration |
| `src/electric-agents-routes.ts` | Add webhook route for Telegram |
| `src/server.ts` | Wire `ChannelManager` into server startup/shutdown |
| `test/channels/channel-manager.test.ts` | Integration tests for channel routing |
| `test/channels/draft-stream-loop.test.ts` | Unit tests for streaming loop |
| `test/channels/health-monitor.test.ts` | Unit tests for health monitoring |
| `test/channels/telegram-adapter.test.ts` | Unit tests for Telegram adapter |
| `test/channels/discord-adapter.test.ts` | Unit tests for Discord adapter |

---

## Task 1: Channel Types & Config Factories (`agents-runtime`)

**Files:**
- Create: `packages/agents-runtime/src/channels/types.ts`
- Create: `packages/agents-runtime/src/channels/telegram.ts`
- Create: `packages/agents-runtime/src/channels/discord.ts`
- Create: `packages/agents-runtime/src/channels/index.ts`
- Create: `packages/agents-runtime/test/channels/channel-config.test.ts`

### Steps

- [ ] **Step 1: Write failing tests for channel config types and factories**

```typescript
// packages/agents-runtime/test/channels/channel-config.test.ts
import { describe, it, expect } from 'vitest'
import { telegram, discord } from '../src/channels/index.js'
import type {
  ChannelConfig,
  TelegramChannelConfig,
  DiscordChannelConfig,
} from '../src/channels/types.js'

describe('telegram config factory', () => {
  it('creates config with defaults', () => {
    const config = telegram({ mode: 'direct' })
    expect(config).toEqual({
      platform: 'telegram',
      mode: 'direct',
      allowedChatIds: [],
      forwardAgentOutput: true,
    })
  })

  it('accepts all options', () => {
    const config = telegram({
      mode: 'group',
      allowedChatIds: ['123', '456'],
      forwardAgentOutput: false,
    })
    expect(config).toEqual({
      platform: 'telegram',
      mode: 'group',
      allowedChatIds: ['123', '456'],
      forwardAgentOutput: false,
    })
  })

  it('rejects invalid mode', () => {
    // @ts-expect-error - invalid mode
    expect(() => telegram({ mode: 'invalid' })).toThrow('Invalid telegram mode')
  })
})

describe('discord config factory', () => {
  it('creates config with defaults', () => {
    const config = discord({ mode: 'channel' })
    expect(config).toEqual({
      platform: 'discord',
      mode: 'channel',
      allowedChatIds: [],
      forwardAgentOutput: true,
    })
  })

  it('accepts thread mode', () => {
    const config = discord({ mode: 'thread' })
    expect(config.mode).toBe('thread')
  })

  it('accepts direct mode', () => {
    const config = discord({ mode: 'direct' })
    expect(config.mode).toBe('direct')
  })

  it('rejects invalid mode', () => {
    // @ts-expect-error - invalid mode
    expect(() => discord({ mode: 'invalid' })).toThrow('Invalid discord mode')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents-runtime && npx vitest run test/channels/channel-config.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement channel types**

```typescript
// packages/agents-runtime/src/channels/types.ts

// --- Channel Config ---

export interface ChannelConfig {
  platform: string
  mode: string
  allowedChatIds: string[]
  forwardAgentOutput: boolean
}

export interface TelegramChannelConfig extends ChannelConfig {
  platform: 'telegram'
  mode: 'direct' | 'group'
}

export interface DiscordChannelConfig extends ChannelConfig {
  platform: 'discord'
  mode: 'direct' | 'channel' | 'thread'
}

// --- Wake Event ---

export interface ChannelMessageSource {
  platform: string
  chatId: string
  messageId: string
  threadId?: string
}

export interface ChannelMessageSender {
  id: string
  username?: string
}

export interface ChannelMessageWakeEvent {
  type: 'channel_message'
  source: ChannelMessageSource
  sender: ChannelMessageSender
  payload: {
    text: string
    replyTo?: string
    channelData?: Record<string, unknown>
  }
}

// --- Pending Channel Send ---

export interface PendingChannelSend {
  platform: string
  chatId: string
  text: string
  threadId?: string
  replyToId?: string
  channelData?: Record<string, unknown>
}

// --- Platform Adapter Interfaces ---

export interface GatewayContext {
  configs: Map<string, ChannelConfig[]>
  abortSignal: AbortSignal
  log: Logger
  onMessage: (
    entityType: string,
    event: ChannelMessageWakeEvent
  ) => Promise<void>
}

export interface GatewayAdapter {
  start(ctx: GatewayContext): Promise<void>
  stop(): Promise<void>
}

export interface MessageRef {
  messageId: string
  chatId: string
}

export interface OutboundOpts {
  threadId?: string
  replyToId?: string
  channelData?: Record<string, unknown>
}

export interface OutboundAdapter {
  sendText(
    chatId: string,
    text: string,
    opts?: OutboundOpts
  ): Promise<MessageRef>
  editText?(ref: MessageRef, text: string): Promise<void>
}

export interface StreamingAdapter {
  mode: 'partial' | 'off'
}

export interface ThreadingAdapter {
  supportsThreads: boolean
}

export interface GroupAdapter {
  supportsGroups: boolean
}

export interface PlatformAdapter {
  platform: string
  gateway: GatewayAdapter
  outbound: OutboundAdapter
  streaming?: StreamingAdapter
  threading?: ThreadingAdapter
  groups?: GroupAdapter
}

// Logger type to avoid hard dependency on pino
export interface Logger {
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
  debug(msg: string, ...args: unknown[]): void
}
```

- [ ] **Step 4: Implement telegram config factory**

```typescript
// packages/agents-runtime/src/channels/telegram.ts
import type { TelegramChannelConfig } from './types.js'

const VALID_MODES = ['direct', 'group'] as const

type TelegramMode = (typeof VALID_MODES)[number]

interface TelegramConfigInput {
  mode: TelegramMode
  allowedChatIds?: string[]
  forwardAgentOutput?: boolean
}

export function telegram(input: TelegramConfigInput): TelegramChannelConfig {
  if (!VALID_MODES.includes(input.mode)) {
    throw new Error(
      `Invalid telegram mode: "${input.mode}". Must be one of: ${VALID_MODES.join(', ')}`
    )
  }
  return {
    platform: 'telegram',
    mode: input.mode,
    allowedChatIds: input.allowedChatIds ?? [],
    forwardAgentOutput: input.forwardAgentOutput ?? true,
  }
}
```

- [ ] **Step 5: Implement discord config factory**

```typescript
// packages/agents-runtime/src/channels/discord.ts
import type { DiscordChannelConfig } from './types.js'

const VALID_MODES = ['direct', 'channel', 'thread'] as const

type DiscordMode = (typeof VALID_MODES)[number]

interface DiscordConfigInput {
  mode: DiscordMode
  allowedChatIds?: string[]
  forwardAgentOutput?: boolean
}

export function discord(input: DiscordConfigInput): DiscordChannelConfig {
  if (!VALID_MODES.includes(input.mode)) {
    throw new Error(
      `Invalid discord mode: "${input.mode}". Must be one of: ${VALID_MODES.join(', ')}`
    )
  }
  return {
    platform: 'discord',
    mode: input.mode,
    allowedChatIds: input.allowedChatIds ?? [],
    forwardAgentOutput: input.forwardAgentOutput ?? true,
  }
}
```

- [ ] **Step 6: Create index re-export**

```typescript
// packages/agents-runtime/src/channels/index.ts
export { telegram } from './telegram.js'
export { discord } from './discord.js'
export type {
  ChannelConfig,
  TelegramChannelConfig,
  DiscordChannelConfig,
  ChannelMessageWakeEvent,
  ChannelMessageSource,
  ChannelMessageSender,
  PendingChannelSend,
  PlatformAdapter,
  GatewayAdapter,
  GatewayContext,
  OutboundAdapter,
  OutboundOpts,
  MessageRef,
  StreamingAdapter,
  ThreadingAdapter,
  GroupAdapter,
  Logger,
} from './types.js'
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/agents-runtime && npx vitest run test/channels/channel-config.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 8: Commit**

```bash
git add packages/agents-runtime/src/channels/ packages/agents-runtime/test/channels/
git commit -m "feat(agents-runtime): add channel config types and factories for telegram/discord"
```

---

## Task 2: Extend `EntityDefinition` and `HandlerContext` (`agents-runtime`)

**Files:**
- Modify: `packages/agents-runtime/src/types.ts` (lines 238-244, 607-667, 669-680)
- Modify: `packages/agents-runtime/src/define-entity.ts` (lines 41-43)
- Modify: `packages/agents-runtime/src/context-factory.ts` (lines 182-537)

### Steps

- [ ] **Step 1: Add `channels` to `EntityDefinition` in `types.ts`**

In `packages/agents-runtime/src/types.ts`, add the import at the top:

```typescript
import type { ChannelConfig, PendingChannelSend } from './channels/types.js'
```

Then modify the `EntityDefinition` interface (around line 669) to add `channels`:

```typescript
export interface EntityDefinition {
  description?: string
  channels?: ChannelConfig[]
  state?: Record<string, CollectionDefinition>
  actions?: (
    collections: Record<string, unknown>
  ) => Record<string, (...args: Array<unknown>) => void>
  creationSchema?: StandardJSONSchemaV1
  inboxSchemas?: Record<string, StandardJSONSchemaV1>
  outputSchemas?: Record<string, StandardJSONSchemaV1>

  handler: (ctx: HandlerContext, wake: WakeEvent) => void | Promise<void>
}
```

- [ ] **Step 2: Add `channelSend` to `HandlerContext` in `types.ts`**

In `packages/agents-runtime/src/types.ts`, add `channelSend` to the `HandlerContext` interface (around line 660, before the closing brace):

```typescript
  channelSend: (
    platform: string,
    opts: {
      chatId: string
      text: string
      threadId?: string
      replyToId?: string
      channelData?: Record<string, unknown>
    }
  ) => void
```

- [ ] **Step 3: Re-export channel types from `types.ts`**

At the bottom of `packages/agents-runtime/src/types.ts`, add:

```typescript
export type {
  ChannelConfig,
  PendingChannelSend,
  ChannelMessageWakeEvent,
} from './channels/types.js'
```

- [ ] **Step 4: Wire `channelSend` into `context-factory.ts`**

In `packages/agents-runtime/src/context-factory.ts`, add `PendingChannelSend` to the imports from `./channels/types.js`:

```typescript
import type { PendingChannelSend } from './channels/types.js'
```

Add to `HandlerContextConfig` (around line 140):

```typescript
  enqueueChannelSend: (send: PendingChannelSend) => void
```

In the `createHandlerContext` function body (around line 490, near the `send` implementation), add:

```typescript
    channelSend: (platform, opts) => {
      config.enqueueChannelSend({
        platform,
        chatId: opts.chatId,
        text: opts.text,
        threadId: opts.threadId,
        replyToId: opts.replyToId,
        channelData: opts.channelData,
      })
    },
```

- [ ] **Step 5: Verify existing tests still pass**

Run: `cd packages/agents-runtime && npx vitest run`
Expected: All existing tests PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add packages/agents-runtime/src/types.ts packages/agents-runtime/src/define-entity.ts packages/agents-runtime/src/context-factory.ts
git commit -m "feat(agents-runtime): add channels to EntityDefinition and channelSend to HandlerContext"
```

---

## Task 3: Add `channels` export to `agents-runtime` package

**Files:**
- Modify: `packages/agents-runtime/package.json` (lines 18-40)
- Modify: `packages/agents-runtime/src/index.ts`

### Steps

- [ ] **Step 1: Add `./channels` subpath export to `package.json`**

In `packages/agents-runtime/package.json`, add a new export entry alongside the existing `"."` and `"./react"` entries:

```json
"./channels": {
  "import": {
    "types": "./dist/channels/index.d.ts",
    "default": "./dist/channels/index.js"
  },
  "require": {
    "types": "./dist/channels/index.d.cts",
    "default": "./dist/channels/index.cjs"
  }
}
```

- [ ] **Step 2: Re-export channel types from main index**

In `packages/agents-runtime/src/index.ts`, add:

```typescript
export type {
  ChannelConfig,
  ChannelMessageWakeEvent,
  PendingChannelSend,
} from './channels/types.js'
```

- [ ] **Step 3: Build to verify exports resolve**

Run: `cd packages/agents-runtime && npx tsup` (or the project's build command)
Expected: Build succeeds, `dist/channels/` directory created

- [ ] **Step 4: Commit**

```bash
git add packages/agents-runtime/package.json packages/agents-runtime/src/index.ts
git commit -m "feat(agents-runtime): export channels subpath"
```

---

## Task 4: Database Schema — Add `channels` Column (`agents-server`)

**Files:**
- Modify: `packages/agents-server/src/db/schema.ts` (lines 17-27)
- Modify: `packages/agents-server/src/electric-agents-types.ts` (lines 77-87)

### Steps

- [ ] **Step 1: Add `channels` to `entity_types` table in `schema.ts`**

In `packages/agents-server/src/db/schema.ts`, add the `channels` column to the `entity_types` table definition (around line 24, after `state_schemas`):

```sql
channels jsonb
```

The exact code depends on whether schema is defined via Drizzle or raw SQL. Match the pattern used by the existing `state_schemas` column.

- [ ] **Step 2: Add `channels` to `ElectricAgentsEntityType` in `electric-agents-types.ts`**

In `packages/agents-server/src/electric-agents-types.ts`, add the `channels` field to `ElectricAgentsEntityType` (around line 83, after `state_schemas`):

```typescript
export interface ElectricAgentsEntityType {
  name: string
  description: string
  creation_schema?: Record<string, unknown>
  inbox_schemas?: Record<string, Record<string, unknown>>
  state_schemas?: Record<string, Record<string, unknown>>
  channels?: Array<{
    platform: string
    mode: string
    allowedChatIds?: string[]
    forwardAgentOutput: boolean
  }>
  serve_endpoint?: string
  revision: number
  created_at: string
  updated_at: string
}
```

- [ ] **Step 3: Create migration for `channels` column**

Create a migration file at `packages/agents-server/src/db/migrations/` following the existing migration pattern. The migration should:

```sql
ALTER TABLE entity_types ADD COLUMN IF NOT EXISTS channels jsonb;
```

Check how existing migrations are structured in that directory and follow the same pattern.

- [ ] **Step 4: Verify migration runs without error**

Run the test suite or start the server to verify the migration applies cleanly:

Run: `cd packages/agents-server && npx vitest run test/entrypoint.test.ts`
Expected: Server starts and migrations apply without error

- [ ] **Step 5: Commit**

```bash
git add packages/agents-server/src/db/schema.ts packages/agents-server/src/electric-agents-types.ts packages/agents-server/src/db/migrations/
git commit -m "feat(agents-server): add channels column to entity_types schema"
```

---

## Task 5: DraftStreamLoop (`agents-server`)

**Files:**
- Create: `packages/agents-server/src/channels/draft-stream-loop.ts`
- Create: `packages/agents-server/test/channels/draft-stream-loop.test.ts`

### Steps

- [ ] **Step 1: Write failing tests for DraftStreamLoop**

```typescript
// packages/agents-server/test/channels/draft-stream-loop.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createDraftStreamLoop } from '../src/channels/draft-stream-loop.js'

describe('DraftStreamLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends initial message on first delta', async () => {
    const sendText = vi.fn().mockResolvedValue({ messageId: 'msg1', chatId: 'chat1' })
    const editText = vi.fn().mockResolvedValue(undefined)

    const loop = createDraftStreamLoop({
      chatId: 'chat1',
      sendText,
      editText,
      throttleMs: 500,
    })

    loop.onDelta('Hello')
    await loop.flush()

    expect(sendText).toHaveBeenCalledWith('chat1', 'Hello', undefined)
  })

  it('accumulates deltas and edits on flush', async () => {
    const sendText = vi.fn().mockResolvedValue({ messageId: 'msg1', chatId: 'chat1' })
    const editText = vi.fn().mockResolvedValue(undefined)

    const loop = createDraftStreamLoop({
      chatId: 'chat1',
      sendText,
      editText,
      throttleMs: 500,
    })

    loop.onDelta('Hello ')
    // Flush the initial send
    await vi.advanceTimersByTimeAsync(500)

    loop.onDelta('world')
    await loop.flush()

    expect(sendText).toHaveBeenCalledTimes(1)
    expect(editText).toHaveBeenCalledWith(
      { messageId: 'msg1', chatId: 'chat1' },
      'Hello world'
    )
  })

  it('throttles edits to avoid rate limiting', async () => {
    const sendText = vi.fn().mockResolvedValue({ messageId: 'msg1', chatId: 'chat1' })
    const editText = vi.fn().mockResolvedValue(undefined)

    const loop = createDraftStreamLoop({
      chatId: 'chat1',
      sendText,
      editText,
      throttleMs: 500,
    })

    loop.onDelta('a')
    await vi.advanceTimersByTimeAsync(500)

    loop.onDelta('b')
    loop.onDelta('c')
    loop.onDelta('d')

    // Only one edit should fire per throttle window
    await vi.advanceTimersByTimeAsync(500)
    expect(editText).toHaveBeenCalledTimes(1)
    expect(editText).toHaveBeenCalledWith(
      { messageId: 'msg1', chatId: 'chat1' },
      'abcd'
    )
  })

  it('falls back to send-on-complete when editText is not provided', async () => {
    const sendText = vi.fn().mockResolvedValue({ messageId: 'msg1', chatId: 'chat1' })

    const loop = createDraftStreamLoop({
      chatId: 'chat1',
      sendText,
      throttleMs: 500,
    })

    loop.onDelta('Hello ')
    loop.onDelta('world')
    await loop.flush()

    expect(sendText).toHaveBeenCalledTimes(1)
    expect(sendText).toHaveBeenCalledWith('chat1', 'Hello world', undefined)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents-server && npx vitest run test/channels/draft-stream-loop.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement DraftStreamLoop**

```typescript
// packages/agents-server/src/channels/draft-stream-loop.ts
import type { MessageRef, OutboundOpts } from '@electric-ax/agents-runtime/channels'

export interface DraftStreamLoopConfig {
  chatId: string
  sendText: (
    chatId: string,
    text: string,
    opts?: OutboundOpts
  ) => Promise<MessageRef>
  editText?: (ref: MessageRef, text: string) => Promise<void>
  throttleMs: number
  opts?: OutboundOpts
}

export interface DraftStreamLoop {
  onDelta(text: string): void
  flush(): Promise<void>
}

export function createDraftStreamLoop(
  config: DraftStreamLoopConfig
): DraftStreamLoop {
  let accumulated = ''
  let messageRef: MessageRef | null = null
  let dirty = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingEdit: Promise<void> | null = null

  async function doEdit(): Promise<void> {
    if (!dirty) return
    dirty = false

    if (!messageRef) {
      messageRef = await config.sendText(
        config.chatId,
        accumulated,
        config.opts
      )
    } else if (config.editText) {
      await config.editText(messageRef, accumulated)
    }
  }

  function scheduleEdit(): void {
    if (timer !== null) return
    timer = setTimeout(async () => {
      timer = null
      pendingEdit = doEdit()
      await pendingEdit
      pendingEdit = null
    }, config.throttleMs)
  }

  return {
    onDelta(text: string): void {
      accumulated += text
      dirty = true
      if (config.editText) {
        scheduleEdit()
      }
    },

    async flush(): Promise<void> {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (pendingEdit) {
        await pendingEdit
      }
      dirty = true
      await doEdit()
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents-server && npx vitest run test/channels/draft-stream-loop.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agents-server/src/channels/draft-stream-loop.ts packages/agents-server/test/channels/draft-stream-loop.test.ts
git commit -m "feat(agents-server): add DraftStreamLoop for streaming agent output to platforms"
```

---

## Task 6: HealthMonitor (`agents-server`)

**Files:**
- Create: `packages/agents-server/src/channels/health-monitor.ts`
- Create: `packages/agents-server/test/channels/health-monitor.test.ts`

### Steps

- [ ] **Step 1: Write failing tests for HealthMonitor**

```typescript
// packages/agents-server/test/channels/health-monitor.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HealthMonitor } from '../src/channels/health-monitor.js'

describe('HealthMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not restart during startup grace period', async () => {
    const restart = vi.fn().mockResolvedValue(undefined)
    const monitor = new HealthMonitor({
      checkIntervalMs: 1000,
      staleThresholdMs: 500,
      startupGraceMs: 5000,
      backoff: { initialMs: 100, maxMs: 1000, factor: 2, jitter: 0 },
      maxRestartAttempts: 10,
    })

    monitor.register('telegram', restart)
    monitor.start()

    await vi.advanceTimersByTimeAsync(2000)
    expect(restart).not.toHaveBeenCalled()

    monitor.stop()
  })

  it('restarts after stale threshold exceeded', async () => {
    const restart = vi.fn().mockResolvedValue(undefined)
    const monitor = new HealthMonitor({
      checkIntervalMs: 1000,
      staleThresholdMs: 500,
      startupGraceMs: 0,
      backoff: { initialMs: 100, maxMs: 1000, factor: 2, jitter: 0 },
      maxRestartAttempts: 10,
    })

    monitor.register('telegram', restart)
    monitor.start()

    // No heartbeat for > staleThresholdMs
    await vi.advanceTimersByTimeAsync(1500)
    expect(restart).toHaveBeenCalledTimes(1)

    monitor.stop()
  })

  it('does not restart when heartbeats are fresh', async () => {
    const restart = vi.fn().mockResolvedValue(undefined)
    const monitor = new HealthMonitor({
      checkIntervalMs: 1000,
      staleThresholdMs: 2000,
      startupGraceMs: 0,
      backoff: { initialMs: 100, maxMs: 1000, factor: 2, jitter: 0 },
      maxRestartAttempts: 10,
    })

    monitor.register('telegram', restart)
    monitor.start()

    // Keep heartbeating
    await vi.advanceTimersByTimeAsync(500)
    monitor.heartbeat('telegram')
    await vi.advanceTimersByTimeAsync(500)
    monitor.heartbeat('telegram')
    await vi.advanceTimersByTimeAsync(500)

    expect(restart).not.toHaveBeenCalled()

    monitor.stop()
  })

  it('stops after max restart attempts', async () => {
    let callCount = 0
    const restart = vi.fn().mockImplementation(async () => {
      callCount++
    })
    const monitor = new HealthMonitor({
      checkIntervalMs: 100,
      staleThresholdMs: 50,
      startupGraceMs: 0,
      backoff: { initialMs: 10, maxMs: 100, factor: 1, jitter: 0 },
      maxRestartAttempts: 3,
    })

    monitor.register('telegram', restart)
    monitor.start()

    // Advance enough for all restart attempts
    await vi.advanceTimersByTimeAsync(10000)
    expect(callCount).toBeLessThanOrEqual(3)

    monitor.stop()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents-server && npx vitest run test/channels/health-monitor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement HealthMonitor**

```typescript
// packages/agents-server/src/channels/health-monitor.ts

export interface HealthMonitorConfig {
  checkIntervalMs: number
  staleThresholdMs: number
  startupGraceMs: number
  backoff: {
    initialMs: number
    maxMs: number
    factor: number
    jitter: number
  }
  maxRestartAttempts: number
}

interface AdapterEntry {
  restart: () => Promise<void>
  lastEventAt: number
  restartAttempts: number
  currentBackoffMs: number
  lastRestartAt: number
}

export const DEFAULT_HEALTH_CONFIG: HealthMonitorConfig = {
  checkIntervalMs: 300_000,
  staleThresholdMs: 120_000,
  startupGraceMs: 60_000,
  backoff: {
    initialMs: 5_000,
    maxMs: 300_000,
    factor: 2,
    jitter: 0.1,
  },
  maxRestartAttempts: 10,
}

export class HealthMonitor {
  private config: HealthMonitorConfig
  private adapters = new Map<string, AdapterEntry>()
  private timer: ReturnType<typeof setInterval> | null = null
  private startedAt = 0

  constructor(config: Partial<HealthMonitorConfig> = {}) {
    this.config = { ...DEFAULT_HEALTH_CONFIG, ...config }
  }

  register(platform: string, restart: () => Promise<void>): void {
    this.adapters.set(platform, {
      restart,
      lastEventAt: Date.now(),
      restartAttempts: 0,
      currentBackoffMs: this.config.backoff.initialMs,
      lastRestartAt: 0,
    })
  }

  unregister(platform: string): void {
    this.adapters.delete(platform)
  }

  heartbeat(platform: string): void {
    const entry = this.adapters.get(platform)
    if (entry) {
      entry.lastEventAt = Date.now()
      entry.restartAttempts = 0
      entry.currentBackoffMs = this.config.backoff.initialMs
    }
  }

  start(): void {
    this.startedAt = Date.now()
    this.timer = setInterval(() => this.check(), this.config.checkIntervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async check(): Promise<void> {
    const now = Date.now()
    if (now - this.startedAt < this.config.startupGraceMs) return

    for (const [platform, entry] of this.adapters) {
      const staleDuration = now - entry.lastEventAt
      if (staleDuration < this.config.staleThresholdMs) continue
      if (entry.restartAttempts >= this.config.maxRestartAttempts) continue

      const timeSinceLastRestart = now - entry.lastRestartAt
      if (timeSinceLastRestart < entry.currentBackoffMs) continue

      entry.restartAttempts++
      entry.lastRestartAt = now

      try {
        await entry.restart()
        entry.lastEventAt = now
      } catch {
        // Restart failed — backoff will handle retry
      }

      const jitter =
        1 + (Math.random() * 2 - 1) * this.config.backoff.jitter
      entry.currentBackoffMs = Math.min(
        entry.currentBackoffMs * this.config.backoff.factor * jitter,
        this.config.backoff.maxMs
      )
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents-server && npx vitest run test/channels/health-monitor.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agents-server/src/channels/health-monitor.ts packages/agents-server/test/channels/health-monitor.test.ts
git commit -m "feat(agents-server): add HealthMonitor with exponential backoff for platform adapters"
```

---

## Task 7: TelegramAdapter (`agents-server`)

**Files:**
- Create: `packages/agents-server/src/channels/telegram/telegram-adapter.ts`
- Create: `packages/agents-server/test/channels/telegram-adapter.test.ts`

### Steps

- [ ] **Step 1: Add grammy dependency**

Run: `cd packages/agents-server && pnpm add grammy`

- [ ] **Step 2: Write failing tests for TelegramAdapter**

```typescript
// packages/agents-server/test/channels/telegram-adapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TelegramAdapter } from '../src/channels/telegram/telegram-adapter.js'
import type {
  GatewayContext,
  ChannelMessageWakeEvent,
} from '@electric-ax/agents-runtime/channels'

// Mock grammy Bot
vi.mock('grammy', () => {
  const handlers: Record<string, Function> = {}
  return {
    Bot: vi.fn().mockImplementation(() => ({
      on: vi.fn((event: string, handler: Function) => {
        handlers[event] = handler
      }),
      api: {
        setWebhook: vi.fn().mockResolvedValue(true),
        deleteWebhook: vi.fn().mockResolvedValue(true),
        sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
        editMessageText: vi.fn().mockResolvedValue(true),
      },
      handleUpdate: vi.fn(async (update: any) => {
        if (update.message && handlers['message:text']) {
          await handlers['message:text']({
            message: update.message,
            chat: { id: update.message.chat.id },
            from: update.message.from,
          })
        }
      }),
      _handlers: handlers,
    })),
    webhookCallback: vi.fn().mockReturnValue(
      async (req: any, res: any) => {}
    ),
  }
})

describe('TelegramAdapter', () => {
  let adapter: TelegramAdapter

  beforeEach(() => {
    adapter = new TelegramAdapter('test-token', 'https://example.com')
  })

  it('has platform set to telegram', () => {
    expect(adapter.platform).toBe('telegram')
  })

  it('has streaming support', () => {
    expect(adapter.streaming).toBeDefined()
    expect(adapter.streaming!.mode).toBe('partial')
  })

  describe('outbound', () => {
    it('sends text messages', async () => {
      // Start the adapter to initialize the bot
      const onMessage = vi.fn()
      await adapter.gateway.start({
        configs: new Map([['test-type', [{ platform: 'telegram', mode: 'direct', allowedChatIds: [], forwardAgentOutput: true }]]]),
        abortSignal: new AbortController().signal,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        onMessage,
      })

      const ref = await adapter.outbound.sendText('12345', 'Hello!')
      expect(ref.chatId).toBe('12345')
      expect(ref.messageId).toBeDefined()
    })

    it('edits text messages', async () => {
      const onMessage = vi.fn()
      await adapter.gateway.start({
        configs: new Map([['test-type', [{ platform: 'telegram', mode: 'direct', allowedChatIds: [], forwardAgentOutput: true }]]]),
        abortSignal: new AbortController().signal,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        onMessage,
      })

      const ref = { messageId: '42', chatId: '12345' }
      await adapter.outbound.editText!(ref, 'Updated text')
      // Should not throw
    })
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/agents-server && npx vitest run test/channels/telegram-adapter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement TelegramAdapter**

```typescript
// packages/agents-server/src/channels/telegram/telegram-adapter.ts
import { Bot } from 'grammy'
import type {
  PlatformAdapter,
  GatewayAdapter,
  GatewayContext,
  OutboundAdapter,
  OutboundOpts,
  MessageRef,
  StreamingAdapter,
  ChannelMessageWakeEvent,
} from '@electric-ax/agents-runtime/channels'

export class TelegramAdapter implements PlatformAdapter {
  readonly platform = 'telegram'
  readonly gateway: GatewayAdapter
  readonly outbound: OutboundAdapter
  readonly streaming: StreamingAdapter = { mode: 'partial' }

  private bot: Bot
  private webhookBaseUrl: string
  private ctx: GatewayContext | null = null

  constructor(botToken: string, webhookBaseUrl: string) {
    this.bot = new Bot(botToken)
    this.webhookBaseUrl = webhookBaseUrl

    this.gateway = {
      start: async (ctx: GatewayContext) => {
        this.ctx = ctx

        this.bot.on('message:text', async (grammyCtx) => {
          const chatId = String(grammyCtx.chat.id)
          const messageId = String(grammyCtx.message!.message_id)

          // Find which entity type handles this chat
          const entityType = this.resolveEntityType(chatId, ctx)
          if (!entityType) {
            ctx.log.debug(
              `No entity type bound to telegram chat ${chatId}, ignoring`
            )
            return
          }

          const event: ChannelMessageWakeEvent = {
            type: 'channel_message',
            source: {
              platform: 'telegram',
              chatId,
              messageId,
            },
            sender: {
              id: String(grammyCtx.from?.id ?? ''),
              username: grammyCtx.from?.username,
            },
            payload: {
              text: grammyCtx.message!.text!,
              channelData: {
                chat_type: grammyCtx.chat.type,
              },
            },
          }

          await ctx.onMessage(entityType, event)
        })

        const webhookUrl = `${this.webhookBaseUrl}/_electric/channels/telegram/webhook`
        await this.bot.api.setWebhook(webhookUrl)
        ctx.log.info(`Telegram webhook registered at ${webhookUrl}`)
      },

      stop: async () => {
        await this.bot.api.deleteWebhook()
        this.ctx = null
      },
    }

    this.outbound = {
      sendText: async (
        chatId: string,
        text: string,
        opts?: OutboundOpts
      ): Promise<MessageRef> => {
        const result = await this.bot.api.sendMessage(Number(chatId), text, {
          reply_to_message_id: opts?.replyToId
            ? Number(opts.replyToId)
            : undefined,
          ...(opts?.channelData as Record<string, unknown>),
        })
        return {
          messageId: String(result.message_id),
          chatId,
        }
      },

      editText: async (ref: MessageRef, text: string): Promise<void> => {
        await this.bot.api.editMessageText(
          Number(ref.chatId),
          Number(ref.messageId),
          text
        )
      },
    }
  }

  /**
   * Handle raw Telegram webhook update.
   * Called by the HTTP route handler.
   */
  async handleWebhookUpdate(update: unknown): Promise<void> {
    await this.bot.handleUpdate(update as any)
  }

  private resolveEntityType(
    chatId: string,
    ctx: GatewayContext
  ): string | null {
    for (const [entityType, configs] of ctx.configs) {
      for (const config of configs) {
        if (config.platform !== 'telegram') continue
        if (
          config.allowedChatIds.length > 0 &&
          !config.allowedChatIds.includes(chatId)
        ) {
          continue
        }
        return entityType
      }
    }
    return null
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/agents-server && npx vitest run test/channels/telegram-adapter.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/agents-server/src/channels/telegram/ packages/agents-server/test/channels/telegram-adapter.test.ts packages/agents-server/package.json pnpm-lock.yaml
git commit -m "feat(agents-server): add TelegramAdapter with webhook gateway and outbound"
```

---

## Task 8: DiscordAdapter (`agents-server`)

**Files:**
- Create: `packages/agents-server/src/channels/discord/discord-adapter.ts`
- Create: `packages/agents-server/test/channels/discord-adapter.test.ts`

### Steps

- [ ] **Step 1: Add discord.js dependency**

Run: `cd packages/agents-server && pnpm add discord.js`

- [ ] **Step 2: Write failing tests for DiscordAdapter**

```typescript
// packages/agents-server/test/channels/discord-adapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DiscordAdapter } from '../src/channels/discord/discord-adapter.js'
import type { GatewayContext } from '@electric-ax/agents-runtime/channels'

// Mock discord.js
vi.mock('discord.js', () => {
  const handlers: Record<string, Function> = {}
  return {
    Client: vi.fn().mockImplementation(() => ({
      on: vi.fn((event: string, handler: Function) => {
        handlers[event] = handler
      }),
      login: vi.fn().mockResolvedValue('token'),
      destroy: vi.fn().mockResolvedValue(undefined),
      channels: {
        fetch: vi.fn().mockResolvedValue({
          send: vi.fn().mockResolvedValue({ id: 'msg123' }),
        }),
      },
      user: { id: 'bot-user-id' },
      _handlers: handlers,
    })),
    GatewayIntentBits: {
      Guilds: 1,
      GuildMessages: 2,
      MessageContent: 4,
      DirectMessages: 8,
    },
    Partials: {
      Channel: 0,
    },
  }
})

describe('DiscordAdapter', () => {
  let adapter: DiscordAdapter

  beforeEach(() => {
    adapter = new DiscordAdapter('test-token', 'test-app-id')
  })

  it('has platform set to discord', () => {
    expect(adapter.platform).toBe('discord')
  })

  it('has streaming support', () => {
    expect(adapter.streaming).toBeDefined()
    expect(adapter.streaming!.mode).toBe('partial')
  })

  it('has threading support', () => {
    expect(adapter.threading).toBeDefined()
    expect(adapter.threading!.supportsThreads).toBe(true)
  })

  describe('outbound', () => {
    it('sends text messages', async () => {
      const onMessage = vi.fn()
      await adapter.gateway.start({
        configs: new Map([['test-type', [{ platform: 'discord', mode: 'channel', allowedChatIds: [], forwardAgentOutput: true }]]]),
        abortSignal: new AbortController().signal,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        onMessage,
      })

      const ref = await adapter.outbound.sendText('channel123', 'Hello Discord!')
      expect(ref.chatId).toBe('channel123')
      expect(ref.messageId).toBe('msg123')
    })
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/agents-server && npx vitest run test/channels/discord-adapter.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement DiscordAdapter**

```typescript
// packages/agents-server/src/channels/discord/discord-adapter.ts
import { Client, GatewayIntentBits, Partials } from 'discord.js'
import type {
  PlatformAdapter,
  GatewayAdapter,
  GatewayContext,
  OutboundAdapter,
  OutboundOpts,
  MessageRef,
  StreamingAdapter,
  ThreadingAdapter,
  ChannelMessageWakeEvent,
} from '@electric-ax/agents-runtime/channels'

export class DiscordAdapter implements PlatformAdapter {
  readonly platform = 'discord'
  readonly gateway: GatewayAdapter
  readonly outbound: OutboundAdapter
  readonly streaming: StreamingAdapter = { mode: 'partial' }
  readonly threading: ThreadingAdapter = { supportsThreads: true }

  private client: Client
  private botToken: string
  private ctx: GatewayContext | null = null

  constructor(botToken: string, _appId: string) {
    this.botToken = botToken
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel],
    })

    this.gateway = {
      start: async (ctx: GatewayContext) => {
        this.ctx = ctx

        this.client.on('messageCreate', async (message) => {
          // Ignore bot's own messages
          if (message.author.id === this.client.user?.id) return
          if (message.author.bot) return

          const chatId = message.channelId
          const entityType = this.resolveEntityType(chatId, ctx)
          if (!entityType) {
            ctx.log.debug(
              `No entity type bound to discord channel ${chatId}, ignoring`
            )
            return
          }

          const event: ChannelMessageWakeEvent = {
            type: 'channel_message',
            source: {
              platform: 'discord',
              chatId,
              messageId: message.id,
              threadId: message.thread?.id,
            },
            sender: {
              id: message.author.id,
              username: message.author.username,
            },
            payload: {
              text: message.content,
              replyTo: message.reference?.messageId ?? undefined,
              channelData: {
                guildId: message.guildId,
                isDM: message.channel.isDMBased(),
              },
            },
          }

          await ctx.onMessage(entityType, event)
        })

        await this.client.login(this.botToken)
        ctx.log.info('Discord gateway connected')
      },

      stop: async () => {
        this.client.destroy()
        this.ctx = null
      },
    }

    this.outbound = {
      sendText: async (
        chatId: string,
        text: string,
        opts?: OutboundOpts
      ): Promise<MessageRef> => {
        const channel = await this.client.channels.fetch(chatId)
        if (!channel || !('send' in channel)) {
          throw new Error(`Cannot send to Discord channel ${chatId}`)
        }

        const message = await (channel as any).send({
          content: text,
          reply: opts?.replyToId
            ? { messageReference: opts.replyToId }
            : undefined,
        })

        return {
          messageId: message.id,
          chatId,
        }
      },

      editText: async (ref: MessageRef, text: string): Promise<void> => {
        const channel = await this.client.channels.fetch(ref.chatId)
        if (!channel || !('messages' in channel)) {
          throw new Error(`Cannot edit in Discord channel ${ref.chatId}`)
        }

        const message = await (channel as any).messages.fetch(ref.messageId)
        await message.edit(text)
      },
    }
  }

  private resolveEntityType(
    chatId: string,
    ctx: GatewayContext
  ): string | null {
    for (const [entityType, configs] of ctx.configs) {
      for (const config of configs) {
        if (config.platform !== 'discord') continue
        if (
          config.allowedChatIds.length > 0 &&
          !config.allowedChatIds.includes(chatId)
        ) {
          continue
        }
        return entityType
      }
    }
    return null
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/agents-server && npx vitest run test/channels/discord-adapter.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/agents-server/src/channels/discord/ packages/agents-server/test/channels/discord-adapter.test.ts packages/agents-server/package.json pnpm-lock.yaml
git commit -m "feat(agents-server): add DiscordAdapter with Gateway WebSocket and REST outbound"
```

---

## Task 9: ChannelManager (`agents-server`)

**Files:**
- Create: `packages/agents-server/src/channels/channel-manager.ts`
- Create: `packages/agents-server/test/channels/channel-manager.test.ts`

### Steps

- [ ] **Step 1: Write failing tests for ChannelManager**

```typescript
// packages/agents-server/test/channels/channel-manager.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChannelManager } from '../src/channels/channel-manager.js'
import type {
  PlatformAdapter,
  GatewayAdapter,
  GatewayContext,
  OutboundAdapter,
  MessageRef,
  ChannelMessageWakeEvent,
} from '@electric-ax/agents-runtime/channels'
import { telegram } from '@electric-ax/agents-runtime/channels'

function createMockAdapter(): PlatformAdapter & {
  _onMessage: ((entityType: string, event: ChannelMessageWakeEvent) => Promise<void>) | null
} {
  let onMessage: ((entityType: string, event: ChannelMessageWakeEvent) => Promise<void>) | null = null

  return {
    platform: 'telegram',
    _onMessage: null,
    gateway: {
      start: vi.fn(async (ctx: GatewayContext) => {
        onMessage = ctx.onMessage
      }),
      stop: vi.fn(async () => {}),
    } as GatewayAdapter,
    outbound: {
      sendText: vi.fn(async (chatId: string, text: string): Promise<MessageRef> => ({
        messageId: 'msg1',
        chatId,
      })),
      editText: vi.fn(async () => {}),
    } as OutboundAdapter,
    get _onMessageFn() {
      return onMessage
    },
  }
}

describe('ChannelManager', () => {
  let manager: ChannelManager
  let mockAdapter: ReturnType<typeof createMockAdapter>
  let mockSpawn: Ret.MockedFunction<any>
  let mockSend: vi.MockedFunction<any>

  beforeEach(() => {
    mockAdapter = createMockAdapter()
    mockSpawn = vi.fn().mockResolvedValue({ url: '/bot/telegram-123' })
    mockSend = vi.fn().mockResolvedValue(undefined)

    manager = new ChannelManager({
      adapters: [mockAdapter],
      spawnEntity: mockSpawn,
      sendToEntity: mockSend,
      entityExists: vi.fn().mockResolvedValue(false),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    })
  })

  it('starts adapters on start()', async () => {
    await manager.start()
    expect(mockAdapter.gateway.start).toHaveBeenCalled()
  })

  it('stops adapters on stop()', async () => {
    await manager.start()
    await manager.stop()
    expect(mockAdapter.gateway.stop).toHaveBeenCalled()
  })

  it('registers entity type channel bindings', async () => {
    manager.bindEntityType('support-bot', [
      telegram({ mode: 'direct' }),
    ])

    await manager.start()

    const startCall = (mockAdapter.gateway.start as vi.MockedFunction<any>).mock.calls[0][0] as GatewayContext
    expect(startCall.configs.get('support-bot')).toHaveLength(1)
    expect(startCall.configs.get('support-bot')![0].platform).toBe('telegram')
  })

  it('unbinds entity type channels', async () => {
    manager.bindEntityType('support-bot', [
      telegram({ mode: 'direct' }),
    ])
    manager.unbindEntityType('support-bot')

    await manager.start()

    const startCall = (mockAdapter.gateway.start as vi.MockedFunction<any>).mock.calls[0][0] as GatewayContext
    expect(startCall.configs.has('support-bot')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents-server && npx vitest run test/channels/channel-manager.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ChannelManager**

```typescript
// packages/agents-server/src/channels/channel-manager.ts
import type {
  ChannelConfig,
  ChannelMessageWakeEvent,
  PlatformAdapter,
  PendingChannelSend,
  Logger,
} from '@electric-ax/agents-runtime/channels'
import { HealthMonitor } from './health-monitor.js'
import { createDraftStreamLoop } from './draft-stream-loop.js'

export interface ChannelManagerConfig {
  adapters: PlatformAdapter[]
  spawnEntity: (
    type: string,
    instanceId: string,
    args?: Record<string, unknown>
  ) => Promise<{ url: string }>
  sendToEntity: (
    entityUrl: string,
    payload: unknown,
    opts?: { type?: string }
  ) => Promise<void>
  entityExists: (entityUrl: string) => Promise<boolean>
  log: Logger
}

export class ChannelManager {
  private config: ChannelManagerConfig
  private adapters: Map<string, PlatformAdapter>
  private bindings: Map<string, ChannelConfig[]> = new Map()
  private healthMonitor: HealthMonitor
  private abortController: AbortController | null = null

  constructor(config: ChannelManagerConfig) {
    this.config = config
    this.adapters = new Map(
      config.adapters.map((a) => [a.platform, a])
    )
    this.healthMonitor = new HealthMonitor()
  }

  bindEntityType(typeName: string, channels: ChannelConfig[]): void {
    this.bindings.set(typeName, channels)
  }

  unbindEntityType(typeName: string): void {
    this.bindings.delete(typeName)
  }

  async start(): Promise<void> {
    this.abortController = new AbortController()

    // Group configs by platform
    const platformConfigs = new Map<string, Map<string, ChannelConfig[]>>()
    for (const [entityType, channels] of this.bindings) {
      for (const channel of channels) {
        if (!platformConfigs.has(channel.platform)) {
          platformConfigs.set(channel.platform, new Map())
        }
        const typeConfigs = platformConfigs.get(channel.platform)!
        if (!typeConfigs.has(entityType)) {
          typeConfigs.set(entityType, [])
        }
        typeConfigs.get(entityType)!.push(channel)
      }
    }

    // Start each adapter with its configs
    for (const [platform, adapter] of this.adapters) {
      const configs = platformConfigs.get(platform) ?? new Map()

      // Skip adapters with no bindings
      if (configs.size === 0) continue

      await adapter.gateway.start({
        configs,
        abortSignal: this.abortController.signal,
        log: this.config.log,
        onMessage: (entityType, event) =>
          this.handleInboundMessage(entityType, event),
      })

      this.healthMonitor.register(platform, async () => {
        await adapter.gateway.stop()
        await adapter.gateway.start({
          configs,
          abortSignal: this.abortController!.signal,
          log: this.config.log,
          onMessage: (entityType, event) =>
            this.handleInboundMessage(entityType, event),
        })
      })
    }

    this.healthMonitor.start()
  }

  async stop(): Promise<void> {
    this.healthMonitor.stop()

    if (this.abortController) {
      this.abortController.abort()
    }

    for (const adapter of this.adapters.values()) {
      await adapter.gateway.stop()
    }
  }

  /**
   * Send a message to a platform channel.
   * Used for explicit ctx.channelSend() calls.
   */
  async sendToChannel(send: PendingChannelSend): Promise<void> {
    const adapter = this.adapters.get(send.platform)
    if (!adapter) {
      this.config.log.error(
        `No adapter for platform "${send.platform}"`
      )
      return
    }

    await adapter.outbound.sendText(send.chatId, send.text, {
      threadId: send.threadId,
      replyToId: send.replyToId,
      channelData: send.channelData,
    })
  }

  /**
   * Forward agent text output to the originating platform chat.
   * Called by the server after a channel-triggered wake produces output.
   */
  async forwardAgentOutput(
    platform: string,
    chatId: string,
    text: string,
    opts?: { threadId?: string }
  ): Promise<void> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return

    await adapter.outbound.sendText(chatId, text, {
      threadId: opts?.threadId,
    })
  }

  /**
   * Create a DraftStreamLoop for streaming agent output.
   */
  createStreamLoop(
    platform: string,
    chatId: string,
    opts?: { threadId?: string }
  ) {
    const adapter = this.adapters.get(platform)
    if (!adapter) return null

    if (!adapter.streaming || adapter.streaming.mode === 'off') {
      return null
    }

    return createDraftStreamLoop({
      chatId,
      sendText: (c, t, o) => adapter.outbound.sendText(c, t, o),
      editText: adapter.outbound.editText
        ? (ref, t) => adapter.outbound.editText!(ref, t)
        : undefined,
      throttleMs: 500,
      opts: { threadId: opts?.threadId },
    })
  }

  /**
   * Report a heartbeat for a platform adapter.
   */
  heartbeat(platform: string): void {
    this.healthMonitor.heartbeat(platform)
  }

  private async handleInboundMessage(
    entityType: string,
    event: ChannelMessageWakeEvent
  ): Promise<void> {
    const { platform, chatId } = event.source
    const instanceId = `${platform}-${chatId}`
    const entityUrl = `/${entityType}/${instanceId}`

    try {
      const exists = await this.config.entityExists(entityUrl)

      if (!exists) {
        this.config.log.info(
          `Auto-spawning entity ${entityUrl} for ${platform} chat ${chatId}`
        )
        await this.config.spawnEntity(entityType, instanceId, {
          channel: { platform, chatId },
        })
      }

      await this.config.sendToEntity(entityUrl, event, {
        type: 'channel_message',
      })

      this.healthMonitor.heartbeat(platform)
    } catch (err) {
      this.config.log.error(
        `Failed to route ${platform} message to ${entityUrl}: ${err}`
      )
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents-server && npx vitest run test/channels/channel-manager.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agents-server/src/channels/channel-manager.ts packages/agents-server/test/channels/channel-manager.test.ts
git commit -m "feat(agents-server): add ChannelManager for inbound routing and outbound forwarding"
```

---

## Task 10: Wire ChannelManager into Server (`agents-server`)

**Files:**
- Modify: `packages/agents-server/src/server.ts` (lines 196-416, 419-474)
- Modify: `packages/agents-server/src/electric-agents-manager.ts` (lines 122-174)
- Modify: `packages/agents-server/src/electric-agents-routes.ts`

### Steps

- [ ] **Step 1: Add Telegram webhook route to `electric-agents-routes.ts`**

In `packages/agents-server/src/electric-agents-routes.ts`, add a new route handler for the Telegram webhook. Add this alongside the existing route patterns (around line 26):

```typescript
// Add to the route matching in handleRequestInner or equivalent:
// Match: /_electric/channels/telegram/webhook
if (
  url.pathname === '/_electric/channels/telegram/webhook' &&
  method === 'POST'
) {
  return this.handleTelegramWebhook(req)
}
```

Add the handler method:

```typescript
private async handleTelegramWebhook(req: Request): Promise<Response> {
  if (!this.telegramAdapter) {
    return new Response('Telegram not configured', { status: 404 })
  }

  try {
    const update = await req.json()
    await this.telegramAdapter.handleWebhookUpdate(update)
    return new Response('ok', { status: 200 })
  } catch (err) {
    return new Response('Internal error', { status: 500 })
  }
}
```

The routes class will need a reference to the `TelegramAdapter` — pass it via constructor.

- [ ] **Step 2: Notify ChannelManager on entity type registration in `electric-agents-manager.ts`**

In `packages/agents-server/src/electric-agents-manager.ts`, add a `channelManager` field and setter:

```typescript
private channelManager: ChannelManager | null = null

setChannelManager(channelManager: ChannelManager): void {
  this.channelManager = channelManager
}
```

In `registerEntityType()` (around line 174, after storing the entity type), add:

```typescript
if (entityType.channels && entityType.channels.length > 0 && this.channelManager) {
  this.channelManager.bindEntityType(entityType.name, entityType.channels)
}
```

- [ ] **Step 3: Wire ChannelManager into server startup in `server.ts`**

In `packages/agents-server/src/server.ts`, in the `start()` method (around line 390, after creating routes):

```typescript
import { ChannelManager } from './channels/channel-manager.js'
import { TelegramAdapter } from './channels/telegram/telegram-adapter.js'
import { DiscordAdapter } from './channels/discord/discord-adapter.js'

// In start():
const adapters: PlatformAdapter[] = []

const telegramToken = process.env.TELEGRAM_BOT_TOKEN
const telegramWebhookUrl = process.env.TELEGRAM_WEBHOOK_BASE_URL
if (telegramToken && telegramWebhookUrl) {
  adapters.push(new TelegramAdapter(telegramToken, telegramWebhookUrl))
  this.log.info('Telegram adapter configured')
}

const discordToken = process.env.DISCORD_BOT_TOKEN
const discordAppId = process.env.DISCORD_APP_ID
if (discordToken && discordAppId) {
  adapters.push(new DiscordAdapter(discordToken, discordAppId))
  this.log.info('Discord adapter configured')
}

if (adapters.length > 0) {
  this.channelManager = new ChannelManager({
    adapters,
    spawnEntity: (type, id, args) => manager.spawn(type, id, { args }),
    sendToEntity: (url, payload, opts) => manager.send(url, payload, opts),
    entityExists: async (url) => {
      try {
        const entity = await manager.getEntity(url)
        return entity !== null && entity.status !== 'stopped'
      } catch {
        return false
      }
    },
    log: this.log,
  })

  manager.setChannelManager(this.channelManager)

  // Bind existing entity types with channels
  const entityTypes = await registry.listEntityTypes()
  for (const et of entityTypes) {
    if (et.channels && et.channels.length > 0) {
      this.channelManager.bindEntityType(et.name, et.channels)
    }
  }

  await this.channelManager.start()
}
```

- [ ] **Step 4: Wire ChannelManager into server shutdown**

In `packages/agents-server/src/server.ts`, in the `stop()` method (around line 420):

```typescript
if (this.channelManager) {
  await this.channelManager.stop()
}
```

Add the field to the class:

```typescript
private channelManager: ChannelManager | null = null
```

- [ ] **Step 5: Verify existing tests still pass**

Run: `cd packages/agents-server && npx vitest run`
Expected: All existing tests PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add packages/agents-server/src/server.ts packages/agents-server/src/electric-agents-manager.ts packages/agents-server/src/electric-agents-routes.ts
git commit -m "feat(agents-server): wire ChannelManager into server startup, routing, and shutdown"
```

---

## Task 11: Wire Agent Output Forwarding in Wake Processing

**Files:**
- Modify: `packages/agents-runtime/src/process-wake.ts` (lines 1207-1394)
- Modify: `packages/agents-server/src/server.ts`

### Steps

- [ ] **Step 1: Add channel output forwarding after handler execution**

The wake processing needs to detect when a wake was triggered by a `channel_message` and forward agent text output to the originating platform.

In the server code that orchestrates wake processing (in `server.ts` or wherever `processWebhookWake` results are consumed), add post-wake forwarding logic:

```typescript
// After processWebhookWake completes for a channel-triggered wake:
if (
  wakeEvent.type === 'channel_message' &&
  this.channelManager
) {
  const channelEvent = wakeEvent as ChannelMessageWakeEvent
  const { platform, chatId, threadId } = channelEvent.source

  // Find the entity type config to check forwardAgentOutput
  const entityType = await registry.getEntityType(entity.type)
  const channelConfig = entityType?.channels?.find(
    (c) => c.platform === platform
  )

  if (channelConfig?.forwardAgentOutput) {
    // Read agent text output from the entity's stream events
    // produced during this wake
    const agentText = collectAgentTextFromWakeResult(wakeResult)

    if (agentText) {
      await this.channelManager.forwardAgentOutput(
        platform,
        chatId,
        agentText,
        { threadId }
      )
    }
  }

  // Deliver any explicit ctx.channelSend() calls
  const pendingChannelSends = wakeResult.pendingChannelSends ?? []
  for (const send of pendingChannelSends) {
    await this.channelManager.sendToChannel(send)
  }
}
```

The `collectAgentTextFromWakeResult` function extracts concatenated text from `text` events produced during the wake. The exact implementation depends on how `WakeResult` exposes produced events — inspect the actual return type of `processWebhookWake()` and adapt accordingly.

- [ ] **Step 2: Thread pending channel sends through wake processing**

In `packages/agents-runtime/src/process-wake.ts`, the wake session needs to collect `PendingChannelSend` items queued by `ctx.channelSend()`:

Add to the wake session's state tracking (alongside `pendingSends`):

```typescript
const pendingChannelSends: PendingChannelSend[] = []

// Pass enqueueChannelSend into createHandlerContext config:
enqueueChannelSend: (send: PendingChannelSend) => {
  pendingChannelSends.push(send)
}
```

Include `pendingChannelSends` in the wake result returned to the server.

- [ ] **Step 3: Verify existing tests still pass**

Run: `cd packages/agents-server && npx vitest run`
Expected: All existing tests PASS

- [ ] **Step 4: Commit**

```bash
git add packages/agents-runtime/src/process-wake.ts packages/agents-server/src/server.ts
git commit -m "feat: wire agent output forwarding and channelSend delivery after wake completion"
```

---

## Task 12: Integration Test — End-to-End Channel Flow

**Files:**
- Create: `packages/agents-server/test/channels/channel-integration.test.ts`

### Steps

- [ ] **Step 1: Write integration test for full inbound → spawn → outbound flow**

```typescript
// packages/agents-server/test/channels/channel-integration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChannelManager } from '../src/channels/channel-manager.js'
import { createDraftStreamLoop } from '../src/channels/draft-stream-loop.js'
import { telegram, discord } from '@electric-ax/agents-runtime/channels'
import type {
  PlatformAdapter,
  GatewayAdapter,
  GatewayContext,
  OutboundAdapter,
  MessageRef,
  ChannelMessageWakeEvent,
} from '@electric-ax/agents-runtime/channels'

function createTestAdapter(platform: string): PlatformAdapter & {
  simulateMessage: (entityType: string, event: ChannelMessageWakeEvent) => Promise<void>
  sentMessages: Array<{ chatId: string; text: string }>
} {
  let onMessage: ((et: string, ev: ChannelMessageWakeEvent) => Promise<void>) | null = null
  const sentMessages: Array<{ chatId: string; text: string }> = []

  return {
    platform,
    sentMessages,
    gateway: {
      start: vi.fn(async (ctx: GatewayContext) => {
        onMessage = ctx.onMessage
      }),
      stop: vi.fn(async () => {}),
    },
    outbound: {
      sendText: vi.fn(async (chatId: string, text: string): Promise<MessageRef> => {
        sentMessages.push({ chatId, text })
        return { messageId: `msg-${sentMessages.length}`, chatId }
      }),
      editText: vi.fn(async () => {}),
    },
    streaming: { mode: 'partial' as const },
    async simulateMessage(entityType: string, event: ChannelMessageWakeEvent) {
      if (!onMessage) throw new Error('Adapter not started')
      await onMessage(entityType, event)
    },
  }
}

describe('Channel Integration', () => {
  it('routes telegram message to correct entity type and auto-spawns', async () => {
    const telegramAdapter = createTestAdapter('telegram')
    const spawnEntity = vi.fn().mockResolvedValue({ url: '/bot/telegram-12345' })
    const sendToEntity = vi.fn().mockResolvedValue(undefined)
    const entityExists = vi.fn().mockResolvedValue(false)

    const manager = new ChannelManager({
      adapters: [telegramAdapter],
      spawnEntity,
      sendToEntity,
      entityExists,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    })

    manager.bindEntityType('bot', [telegram({ mode: 'direct' })])
    await manager.start()

    await telegramAdapter.simulateMessage('bot', {
      type: 'channel_message',
      source: { platform: 'telegram', chatId: '12345', messageId: 'msg1' },
      sender: { id: 'user1', username: 'alice' },
      payload: { text: 'hello' },
    })

    expect(spawnEntity).toHaveBeenCalledWith('bot', 'telegram-12345', {
      channel: { platform: 'telegram', chatId: '12345' },
    })
    expect(sendToEntity).toHaveBeenCalledWith(
      '/bot/telegram-12345',
      expect.objectContaining({ type: 'channel_message' }),
      { type: 'channel_message' }
    )
  })

  it('does not re-spawn existing entity', async () => {
    const telegramAdapter = createTestAdapter('telegram')
    const spawnEntity = vi.fn()
    const sendToEntity = vi.fn().mockResolvedValue(undefined)
    const entityExists = vi.fn().mockResolvedValue(true)

    const manager = new ChannelManager({
      adapters: [telegramAdapter],
      spawnEntity,
      sendToEntity,
      entityExists,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    })

    manager.bindEntityType('bot', [telegram({ mode: 'direct' })])
    await manager.start()

    await telegramAdapter.simulateMessage('bot', {
      type: 'channel_message',
      source: { platform: 'telegram', chatId: '12345', messageId: 'msg1' },
      sender: { id: 'user1' },
      payload: { text: 'hello' },
    })

    expect(spawnEntity).not.toHaveBeenCalled()
    expect(sendToEntity).toHaveBeenCalled()
  })

  it('supports multi-platform entity type', async () => {
    const telegramAdapter = createTestAdapter('telegram')
    const discordAdapter = createTestAdapter('discord')
    const spawnEntity = vi.fn().mockResolvedValue({ url: '/bot/telegram-123' })
    const sendToEntity = vi.fn().mockResolvedValue(undefined)
    const entityExists = vi.fn().mockResolvedValue(false)

    const manager = new ChannelManager({
      adapters: [telegramAdapter, discordAdapter],
      spawnEntity,
      sendToEntity,
      entityExists,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    })

    manager.bindEntityType('bot', [
      telegram({ mode: 'direct' }),
      discord({ mode: 'channel' }),
    ])
    await manager.start()

    // Telegram message
    await telegramAdapter.simulateMessage('bot', {
      type: 'channel_message',
      source: { platform: 'telegram', chatId: '111', messageId: 'msg1' },
      sender: { id: 'user1' },
      payload: { text: 'from telegram' },
    })

    // Discord message
    await discordAdapter.simulateMessage('bot', {
      type: 'channel_message',
      source: { platform: 'discord', chatId: '222', messageId: 'msg2' },
      sender: { id: 'user2' },
      payload: { text: 'from discord' },
    })

    expect(spawnEntity).toHaveBeenCalledTimes(2)
    expect(spawnEntity).toHaveBeenCalledWith('bot', 'telegram-111', expect.any(Object))
    expect(spawnEntity).toHaveBeenCalledWith('bot', 'discord-222', expect.any(Object))
  })

  it('forwards agent output to originating platform', async () => {
    const telegramAdapter = createTestAdapter('telegram')
    const manager = new ChannelManager({
      adapters: [telegramAdapter],
      spawnEntity: vi.fn().mockResolvedValue({ url: '/bot/telegram-123' }),
      sendToEntity: vi.fn().mockResolvedValue(undefined),
      entityExists: vi.fn().mockResolvedValue(true),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    })

    manager.bindEntityType('bot', [telegram({ mode: 'direct' })])
    await manager.start()

    await manager.forwardAgentOutput('telegram', '12345', 'Agent response')

    expect(telegramAdapter.sentMessages).toEqual([
      { chatId: '12345', text: 'Agent response' },
    ])
  })

  it('explicit sendToChannel works', async () => {
    const telegramAdapter = createTestAdapter('telegram')
    const manager = new ChannelManager({
      adapters: [telegramAdapter],
      spawnEntity: vi.fn(),
      sendToEntity: vi.fn(),
      entityExists: vi.fn(),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    })

    await manager.start()

    await manager.sendToChannel({
      platform: 'telegram',
      chatId: '99999',
      text: 'Proactive message',
    })

    expect(telegramAdapter.sentMessages).toEqual([
      { chatId: '99999', text: 'Proactive message' },
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd packages/agents-server && npx vitest run test/channels/channel-integration.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/agents-server/test/channels/channel-integration.test.ts
git commit -m "test(agents-server): add integration tests for channel routing and forwarding"
```

---

## Task 13: Export Cleanup and Final Verification

**Files:**
- Modify: `packages/agents-server/src/channels/index.ts` (create)
- Verify: all packages build and tests pass

### Steps

- [ ] **Step 1: Create server channels index**

```typescript
// packages/agents-server/src/channels/index.ts
export { ChannelManager } from './channel-manager.js'
export type { ChannelManagerConfig } from './channel-manager.js'
export { createDraftStreamLoop } from './draft-stream-loop.js'
export type { DraftStreamLoop, DraftStreamLoopConfig } from './draft-stream-loop.js'
export { HealthMonitor, DEFAULT_HEALTH_CONFIG } from './health-monitor.js'
export type { HealthMonitorConfig } from './health-monitor.js'
export { TelegramAdapter } from './telegram/telegram-adapter.js'
export { DiscordAdapter } from './discord/discord-adapter.js'
```

- [ ] **Step 2: Run full test suite for agents-runtime**

Run: `cd packages/agents-runtime && npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Run full test suite for agents-server**

Run: `cd packages/agents-server && npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Build both packages**

Run: `cd packages/agents-runtime && pnpm build && cd ../agents-server && pnpm build`
Expected: Both packages build without errors

- [ ] **Step 5: Commit**

```bash
git add packages/agents-server/src/channels/index.ts
git commit -m "feat: finalize channel connector exports and verify builds"
```
