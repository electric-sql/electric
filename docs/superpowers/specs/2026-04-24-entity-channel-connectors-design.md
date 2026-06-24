# Entity Channel Connectors

Connect entities to external messaging platforms (Telegram, Discord, Slack, etc.) with bidirectional communication configured at the entity type definition level.

## Overview

Entities gain a new `channels` property in `defineEntity()` that declares which messaging platforms they connect to and how. Inbound platform messages wake entities with normalized `channel_message` events. Agent output is automatically forwarded back to the originating chat. The system is designed for multi-platform support; v1 implements Telegram (webhook) and Discord (Gateway WebSocket) to validate the abstraction.

Design informed by [OpenClaw](https://github.com/openclaw/openclaw)'s channel adapter architecture — specifically the composable adapter pattern, normalized payload with escape hatch, streaming via draft loops, and health monitoring.

## Configuration API

### Entity Type Definition

```typescript
import { telegram, discord } from '@electric-sql/agents-runtime/channels'

defineEntity({
  description: 'Support bot',
  channels: [
    telegram({
      mode: 'direct',
      allowedChatIds: [],
      forwardAgentOutput: true,
    }),
    discord({
      mode: 'channel',
      allowedChatIds: ['#support'],
      forwardAgentOutput: true,
    }),
  ],
  handler: async (ctx, wake) => {
    await ctx.agent.run(wake.payload.text)
  },
})
```

### Channel Config Type

```typescript
interface ChannelConfig {
  platform: string              // 'telegram' | 'discord' | 'slack' | ...
  mode: string                  // platform-specific interaction mode
  allowedChatIds?: string[]     // optional whitelist (empty = all)
  forwardAgentOutput: boolean   // auto-relay agent text output to originating chat
}
```

Each platform has a typed config factory (`telegram()`, `discord()`) that produces a `ChannelConfig` with platform-specific defaults and validation.

### Server-Level Credentials

Global credentials configured via environment variables:

```bash
# Telegram
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_WEBHOOK_BASE_URL=https://your-server.com

# Discord
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_APP_ID=your-app-id
```

Credentials are global to the server. Entity definitions reference platforms by name; they never contain secrets.

## Inbound: Platform Messages to Entity Wakes

### Wake Event Structure

```typescript
interface ChannelMessageWakeEvent {
  type: 'channel_message'
  source: {
    platform: 'telegram' | 'discord'
    chatId: string
    messageId: string
    threadId?: string
  }
  sender: {
    id: string
    username?: string
  }
  payload: {
    text: string
    replyTo?: string
    attachments?: Attachment[]           // future
    channelData?: Record<string, unknown> // platform-specific raw data (escape hatch)
  }
}
```

The `channelData` escape hatch allows handlers to access platform-specific fields (Telegram stickers, Discord embeds, etc.) without polluting the common type.

### Handler Usage

```typescript
handler: async (ctx, wake) => {
  if (wake.type === 'channel_message') {
    // Platform message — wake.source.platform identifies origin
    await ctx.agent.run(wake.payload.text)
  } else if (wake.type === 'message_received') {
    // Inter-entity message
  } else if (wake.type === 'cron') {
    // Scheduled wake
  }
}
```

The handler does not need platform-specific knowledge. The wake event is normalized across all platforms.

### Entity Instance Routing

Inbound messages map to entity instances by chat ID:

- Instance URL: `/{type}/telegram-{chatId}` or `/{type}/discord-{chatId}`
- If no instance exists for a chat, one is **auto-spawned**
- `allowedChatIds` filtering happens before routing — messages from non-whitelisted chats are dropped

This means users can start chatting with a bot and an entity instance materializes automatically.

## Outbound: Entity Output to Platforms

### Implicit (Agent Output Forwarding)

When `forwardAgentOutput: true` and the wake was triggered by a `channel_message`:

1. Handler calls `ctx.agent.run(...)`
2. Agent produces `text` and `text_delta` events on the entity's main durable stream (existing behavior)
3. Server-side `ChannelManager` watches the stream during channel-triggered wakes
4. Text events are forwarded to the platform chat identified by `wake.source.chatId`
5. For streaming: a `DraftStreamLoop` batches `text_delta` events and live-edits a message on the platform (see Streaming section)

No new handler API needed for the common case.

### Explicit (`ctx.channelSend`)

For proactive messaging (e.g., from a cron wake):

```typescript
handler: async (ctx, wake) => {
  if (wake.type === 'cron') {
    ctx.channelSend('telegram', {
      chatId: '12345',
      text: 'Daily summary: ...',
      channelData: { parse_mode: 'MarkdownV2' }, // platform-specific options
    })
  }
}
```

`ctx.channelSend()` queues outbound messages, delivered at wake completion (same pattern as `ctx.send()` for inter-entity messages). The `channelData` escape hatch allows passing platform-specific options without polluting the common API.

### Streaming (DraftStreamLoop)

Both Telegram and Discord support editing sent messages, enabling live-streaming of agent output:

```typescript
interface DraftStreamLoop {
  onDelta(text: string): void    // feed text_delta events
  flush(): Promise<void>         // send final accumulated text
}
```

The loop:
1. Sends an initial message on the first delta
2. Accumulates subsequent deltas
3. Throttles `editMessage` calls (e.g., every 500ms) to avoid rate limits
4. On completion, sends the final full text

Each outbound adapter implements the `sendText` / `editText` primitives; the `DraftStreamLoop` handles batching and throttling. Platforms that don't support editing fall back to send-on-complete.

## Inbound-to-Outbound Integration Flow

The full flow showing how platform messages integrate with the existing entity system:

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Inbound Flow (platform → entity)                │
└──────────────────────────────────────────────────────────────────────┘

  Platform event (webhook POST or WebSocket message)
    │
    ▼
  PlatformAdapter normalizes to ChannelMessageWakeEvent
    │
    ▼
  ChannelManager resolves entity type (which types have this platform?)
    │
    ▼
  Derives instance URL: /{type}/{platform}-{chatId}
    │
    ├── Instance exists?
    │     YES → ElectricAgentsManager writes wake event to entity's durable stream
    │     NO  → ElectricAgentsManager.spawn() creates instance, then writes wake
    │
    ▼
  serve_endpoint webhook fires → processWebhookWake()
    │
    ▼
  Handler executes with wake.type === 'channel_message'

┌──────────────────────────────────────────────────────────────────────┐
│                    Outbound Flow (entity → platform)                │
└──────────────────────────────────────────────────────────────────────┘

  Handler calls ctx.agent.run(wake.payload.text)
    │
    ▼
  Agent produces text/text_delta events → written to entity's main durable stream
    │
    ▼
  ChannelManager watches stream (subscribed during channel-triggered wakes)
    │
    ├── Streaming enabled?
    │     YES → DraftStreamLoop batches deltas, calls adapter.outbound.editText()
    │     NO  → On completion, calls adapter.outbound.sendText()
    │
    ▼
  PlatformAdapter sends message via platform API
  (Telegram: sendMessage/editMessageText, Discord: POST /channels/{id}/messages)
```

The key insight: **no new execution model is needed**. Channel messages are just another way to wake an entity, reusing the existing `ElectricAgentsManager.spawn()` and durable stream infrastructure. The `ChannelManager` acts as a translator between platform events and entity wake events, and watches entity streams for outbound delivery.

## Server-Side Architecture

### Component Structure

```
agents-server
├── ChannelManager (new)
│   ├── PlatformAdapter (composable interface)
│   │   ├── TelegramAdapter
│   │   └── DiscordAdapter
│   ├── DraftStreamLoop (streaming helper)
│   ├── HealthMonitor (connection health + auto-restart)
│   ├── Inbound: platform message → entity wake
│   └── Outbound: entity stream events → platform message
├── ElectricAgentsManager (existing, used by ChannelManager)
└── ...
```

### ChannelManager

Responsibilities:
- Manages platform adapter lifecycle (start/stop)
- On entity type registration, inspects `channels` config and sets up listeners
- Routes inbound messages to the correct entity instance (auto-spawning if needed)
- Watches entity streams during channel-triggered wakes for outbound forwarding
- Monitors adapter health and auto-restarts on failure

### PlatformAdapter — Composable Interface

Inspired by OpenClaw's adapter bag pattern, the `PlatformAdapter` is split into focused sub-interfaces. Adapters implement only what their platform supports:

```typescript
interface PlatformAdapter {
  platform: string

  // Required
  gateway: GatewayAdapter           // start/stop connections
  outbound: OutboundAdapter         // send messages

  // Optional — implement what the platform supports
  streaming?: StreamingAdapter      // live-edit messages with text deltas
  threading?: ThreadingAdapter      // thread/topic management
  groups?: GroupAdapter             // group-specific behavior (mention gating)
}

interface GatewayAdapter {
  start(ctx: GatewayContext): Promise<void>
  stop(): Promise<void>
}

interface GatewayContext {
  configs: Map<string, ChannelConfig[]>  // entity type name → configs for this platform
  abortSignal: AbortSignal               // cancelled on stop/restart
  log: Logger
  onMessage: (entityType: string, event: ChannelMessageWakeEvent) => Promise<void>
}

interface OutboundAdapter {
  sendText(chatId: string, text: string, opts?: OutboundOpts): Promise<MessageRef>
  editText?(ref: MessageRef, text: string): Promise<void>
}

interface OutboundOpts {
  threadId?: string
  replyToId?: string
  channelData?: Record<string, unknown>  // platform-specific options
}

interface MessageRef {
  messageId: string
  chatId: string
}

interface StreamingAdapter {
  mode: 'partial' | 'off'          // 'partial' = edit-in-place
  createStreamLoop(chatId: string, opts?: OutboundOpts): DraftStreamLoop
}
```

This design means:
- A minimal new adapter only needs `gateway` + `outbound`
- The core system checks for optional adapters before using them: `if (adapter.streaming) { ... } else { sendOnComplete() }`
- Platform-specific capabilities are opt-in, not forced

### TelegramAdapter

- **Gateway:** Calls Telegram `setWebhook` API on startup; registers `/_electric/channels/telegram/webhook` route via `GatewayContext`
- **Outbound:** `sendMessage` / `editMessageText` via Telegram Bot API
- **Streaming:** Supported — `editMessageText` with throttled deltas
- **Modes:** `direct` (private chats), `group` (group chats)

### DiscordAdapter

- **Gateway:** Connects to Discord Gateway via WebSocket (`discord.js`); listens for `messageCreate` events
- **Outbound:** `POST /channels/{id}/messages` / `PATCH /channels/{id}/messages/{msg_id}` via Discord REST API
- **Streaming:** Supported — edit message with accumulated text
- **Threading:** Supported — thread creation and reply routing
- **Modes:** `direct` (DMs), `channel` (server channels), `thread` (thread-based)

### Health Monitoring

Borrowed from OpenClaw's production-grade health monitor:

- Track `lastEventAt` timestamp per adapter
- Periodic health checks (every 5 minutes)
- Auto-restart with exponential backoff: 5s initial → 5min max, factor 2, 10% jitter
- Max 10 restart attempts before giving up and logging an error
- 60-second startup grace period (no health checks during initial connection)

```typescript
interface HealthMonitorConfig {
  checkIntervalMs: number       // default: 300_000 (5 min)
  staleThresholdMs: number      // default: 120_000 (2 min)
  startupGraceMs: number        // default: 60_000 (1 min)
  backoff: {
    initialMs: number           // default: 5_000
    maxMs: number               // default: 300_000
    factor: number              // default: 2
    jitter: number              // default: 0.1
  }
  maxRestartAttempts: number    // default: 10
}
```

## Entity Type Registration & Storage

### Schema Changes

`channels` stored as JSONB on the `entity_types` table:

```typescript
interface ElectricAgentsEntityType {
  name: string
  description: string
  creation_schema?: Record<string, unknown>
  inbox_schemas?: Record<string, Record<string, unknown>>
  state_schemas?: Record<string, Record<string, unknown>>
  channels?: ChannelConfig[]          // new field
  serve_endpoint?: string
  revision: number
  created_at: string
  updated_at: string
}
```

### Registration Flow

1. `ElectricAgentsManager.registerEntityType()` validates channel configs
2. Notifies `ChannelManager` of new/updated channel bindings
3. `ChannelManager` starts or reconfigures the relevant platform adapter

### Credential Validation

On server startup, `ChannelManager` checks that required env vars exist for any platform referenced by registered entity types. Missing credentials produce a clear error log and skip that adapter rather than crashing the server.

### Entity Type Removal

1. `ChannelManager` tears down listeners for that type
2. Existing entity instances remain but stop receiving platform messages

## Package Structure

| Concern | Package | Location |
|---------|---------|----------|
| `telegram()`, `discord()` config factories | `agents-runtime` | `src/channels/` |
| `ChannelConfig` types, `ChannelMessageWakeEvent` | `agents-runtime` | `src/channels/types.ts` |
| `PlatformAdapter` sub-interfaces | `agents-runtime` | `src/channels/adapter-types.ts` |
| `ctx.channelSend()` | `agents-runtime` | added to handler context |
| `ChannelManager`, adapter registry | `agents-server` | `src/channels/` |
| `DraftStreamLoop` | `agents-server` | `src/channels/draft-stream-loop.ts` |
| `HealthMonitor` | `agents-server` | `src/channels/health-monitor.ts` |
| `TelegramAdapter` | `agents-server` | `src/channels/telegram/` |
| `DiscordAdapter` | `agents-server` | `src/channels/discord/` |
| `channels` column on `entity_types` | `agents-server` | `src/db/schema.ts` |

## V1 Scope

### In Scope

- `ChannelConfig` base type + `TelegramChannelConfig` + `DiscordChannelConfig`
- `telegram()` and `discord()` config factories
- `ChannelManager` with composable `PlatformAdapter` interface
- `TelegramAdapter` with webhook transport
- `DiscordAdapter` with Gateway WebSocket transport
- `channel_message` wake event type with `channelData` escape hatch
- Auto-spawn entity instances on first inbound message
- Agent output forwarding (implicit, `forwardAgentOutput: true`)
- Streaming via `DraftStreamLoop` (edit-in-place on both platforms)
- `ctx.channelSend()` for explicit outbound with `channelData` support
- Health monitoring with exponential backoff and auto-restart
- Telegram modes: `direct`, `group`
- Discord modes: `direct`, `channel`, `thread`

### Out of Scope

- Slack adapter
- Attachments / media messages
- Telegram `channel` and `thread` modes
- UI support in `agents-server-ui`
