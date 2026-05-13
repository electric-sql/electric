# Discord Bot for Electric Agents — Design Spec

**Date:** 2026-05-13
**Owner:** balegas@electric-sql.com
**Status:** Approved (brainstorming phase complete, pending implementation plan)

## 1. Summary

Extend Electric Agents with a Discord-facing entity that lets users interact with the agents subsystem from Discord channels. The bot is a first-class conversational agent: it answers questions about Electric, GitHub issues, Cloud deployments and other things using its own tools, skills, and MCP servers. For coding tasks (`fix issue #N`) it delegates to a Horton entity running on its runtime host.

The deliverable is a new workspace package, `factory/discord-bot/` (npm name `@electric-ax/discord-bot`), comprising:

- a **Discord ingress adapter** (Discord Gateway WebSocket + HTTP Interactions endpoint), shipped as a Node process; and
- a **`discord-bot` entity** registered into any agents runtime via `registerDiscordBot(registry, opts)`.

The adapter is the only component with long-lived state (the Gateway WebSocket); the entity is webhook-driven and lives in the operator's existing `agents-server` alongside Horton.

v1 targets a Node deploy. The entity's tool surface is intentionally restricted to runtime-portable APIs (`fetch`, raw Discord REST + Ed25519 verify, HTTP-based MCP, HTTP-based runtime-server client) so a follow-up Cloudflare Durable Object deploy can reuse the entity code as-is. The adapter is *not* portable in v1 — see §10 for the planned DO follow-up.

## 2. Goals & non-goals

### Goals (v1)

1. `@bot <question>` in any channel where the bot is present opens a thread and answers the question, using Discord, GitHub MCP, web search, and the existing Electric Agents docs index.
2. `@bot fix issue #N` opens a thread, spawns a Horton entity in a separate runtime host scoped to a pre-configured repo, posts an ack into the thread, and relays Horton's final report (typically a PR link) back into the thread when it completes.
3. The bot asks clarifying questions in-thread when the task is under-specified, using the agent loop (no special clarification machinery).
4. The bot is primed on first wake with the last *N* messages from the parent channel. It can pull more channel context on demand around any referenced message.
5. The bot is extensible: operators can pass additional tools, MCP servers, and skills at register time.
6. The entity is implemented using runtime-portable APIs only (no `node:fs`, no `node:child_process`, no Node-only npm modules in its tools), so a Cloudflare Durable Object deploy can reuse it without rewrites.
7. Self-host: operators run their own Discord application, run the adapter as their own process, and register the entity into their own `agents-server`. README covers setup end-to-end.

### Non-goals (v1)

- Cloud deployment-status tools. Tool surface is left out entirely until the Cloud API to call is decided. (Future work; described in §10.)
- Multi-repo coding agents / GitHub App auth — single repo is configured at install time. Options object is shaped to accept a GitHub App config later without breaking changes.
- Per-user GitHub OAuth attribution (PRs come from the configured token).
- Voice channels, button/modal UIs beyond `/end`.
- Cloudflare deploy of any kind. No interactions-only CF Worker entrypoint, no full DO deploy with Gateway via the WebSocket Hibernation API. v1 is Node-only; CF DO is the planned next milestone (see §10) and informs the runtime-portability goal above.
- Bot-initiated DMs, cron / scheduled posts.

## 3. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Discord                                                       │
│   ├── Gateway events (@mention, thread message, thread close)  │
│   └── HTTP Interactions (slash commands, future buttons)       │
└──────────────┬─────────────────────────────────────────────────┘
               │  WebSocket (Gateway)   │  HTTPS POST (Interactions)
               ▼                        ▼
┌────────────────────────────────────────────────────────────────┐
│  factory/discord-bot — ADAPTER  (Node process; v1)             │
│  • discord.js gateway client (Node only in v1)                 │
│  • Interactions endpoint (Ed25519 verify, dispatch)            │
│  • Creates Discord thread when a bare @mention lands           │
│  • Translates Discord event → agents-server wake webhook       │
└──────────────┬─────────────────────────────────────────────────┘
               │  POST <agents-server>/webhook with
               │  { entityType:'discord-bot', entityId:<threadId>,
               │    message: DiscordWakeMessage }
               ▼
┌────────────────────────────────────────────────────────────────┐
│  agents-server (existing) — runs `discord-bot` entity          │
│   one entity instance per Discord thread (entityId = threadId) │
│   tools:                                                       │
│     discord.*       create_thread, post_message,               │
│                     edit_message, read_thread_history,         │
│                     add_reaction,                              │
│                     read_channel_around_message                │
│     delegate.*      spawn_horton({ task, branch, ... })        │
│     (via MCP)       GitHub MCP server: search_issues,          │
│                     get_issue, create_issue_comment,           │
│                     create_pull_request, search_repos, …       │
│     (reused)        web_search, fetch_url,                     │
│                     search_durable_agents_docs                 │
│   plus operator-supplied extraTools / extraMcpServers / skills │
└──────────────┬─────────────────────────────────────────────────┘
               │  spawn_horton via runtime-server-client
               ▼
┌────────────────────────────────────────────────────────────────┐
│  Horton runtime host (existing, separate process)              │
│   clones target repo into workingDirectory, runs coding agent, │
│   creates PR via GitHub MCP, reports back via child-status     │
│   event → wakes discord-bot entity to post result into thread  │
└────────────────────────────────────────────────────────────────┘
```

**Identity rule:** `entityId = <discord-thread-id>`. A bare `@mention` outside a thread is converted to a threaded conversation by the adapter — it calls Discord's `Start Thread from Message` API before sending the wake — so the entity never sees a "no thread yet" state.

**Why per-thread:** thread id is the natural session boundary, replies in-thread route trivially, and a thread-archive event maps cleanly to entity stop.

**Adapter and agents-server are always separate processes**, even in the simplest Node deployment (typically co-located on one box). The Gateway WS is genuinely long-lived state; the agents-server is HTTP webhook-driven.

## 4. Entity lifecycle

| Trigger | Wake kind | Behaviour |
|---|---|---|
| `@bot …` in a parent channel | `mention` | First wake: adapter has already created the thread; entity inserts `primeMessages` as `ContextEntry` rows, runs agent loop. |
| `@bot …` or plain message inside an existing thread | `thread_msg` | Wake existing entity (by threadId); agent loop continues with prior turn state. |
| `/end` slash command, or thread archive event | `thread_close` | Entity posts a closing message and stops. |
| Slash command (future: `/fix`, `/ask`) | `interaction` | Same routing as `mention`; adapter passes structured `command + options`. |
| Horton child completes / errors | `child_completed` (runtime-native event) | Entity wakes, agent loop reads child status, posts result into the thread. |

Entity ends on `thread_close` or after a configurable inactivity timeout (default 7 days).

The entity does **not** await Horton runs synchronously. `spawn_horton` returns immediately with a child entity URL; Horton's completion arrives as a separate wake via the runtime's existing child-status mechanism. This keeps the entity loop free for in-thread chat while Horton works.

## 5. Components

```
factory/discord-bot/
├── package.json            "@electric-ax/discord-bot"
├── README.md
├── src/
│   ├── index.ts                public exports
│   ├── entity.ts               registerDiscordBot(registry, opts)
│   ├── config.ts               zod schema for options + env loading
│   ├── prime-context.ts        fetch + format last-N channel msgs
│   ├── tools/
│   │   ├── discord.ts          all discord.* tools
│   │   └── delegate.ts         spawn_horton
│   ├── adapter/
│   │   ├── gateway.ts          discord.js client, event → wake mapper
│   │   ├── interactions.ts     Ed25519 verify + dispatch
│   │   ├── webhook.ts          POST to agents-server webhook
│   │   ├── thread.ts           "create thread for bare mention" helper
│   │   └── host-node.ts        Node entrypoint (Gateway + Interactions)
│   ├── skills/                 (optional) discord-flavored skills
│   └── system-prompt.ts        composed prompt + onboarding guidance
├── bin/
│   ├── discord-bot             → host-node
│   └── discord-bot-register    one-shot slash-command registration
├── test/
│   ├── tools/                  unit tests (mock fetch / Discord REST)
│   ├── adapter/                gateway-mapping + interactions tests
│   └── integration/            end-to-end with stubbed Horton + fake Discord
└── tsdown.config.ts
```

### 5.1 Public surface

```ts
import { registerDiscordBot } from '@electric-ax/discord-bot'

registerDiscordBot(registry, {
  appId: env.DISCORD_APP_ID,
  guildId?: env.DISCORD_GUILD_ID,

  github: {
    repo: 'electric-sql/electric',
    token: env.GITHUB_TOKEN,
  },

  hortonRuntime: {
    agentsServerUrl: env.AGENTS_SERVER_URL,
    entityType: 'horton',
  },

  primeContext?: { messageLimit: 20 },

  extraTools?: Array<AgentTool>,
  extraMcpServers?: Array<McpServerConfig>,
  skills?: SkillsRegistry,

  modelCatalog: builtinModelCatalog,
})
```

GitHub MCP (the official `github/github-mcp-server`) is configured either via the operator's `mcp.json` or by passing it in `extraMcpServers`. The bot does not bundle GH MCP itself.

### 5.2 Adapter ↔ entity contract

```ts
type DiscordWakeMessage =
  | { kind: 'mention'
      threadId: string
      channelId: string
      userId: string
      content: string
      referencedMessageId?: string
      attachments?: AttachmentSummary[]
      primeMessages?: ChannelMessageSummary[] }
  | { kind: 'thread_msg'
      threadId: string
      userId: string
      content: string
      referencedMessageId?: string
      attachments?: AttachmentSummary[] }
  | { kind: 'interaction'
      threadId: string
      userId: string
      command: '/end' /* future: /fix, /ask */
      options: Record<string, string | number | boolean> }
  | { kind: 'thread_close', threadId: string }
```

Wake payloads carry the Discord `message_id` / `interaction_id` as an idempotency key. The adapter dedupes Discord-side retries before forwarding; agents-server dedupes the wake by event id.

### 5.3 Tools

**`discord.*`** — `create_thread`, `post_message`, `edit_message`, `read_thread_history`, `add_reaction`, `read_channel_around_message(messageId, before=20, after=5)`. Implemented over raw `fetch` against the Discord REST API (not `@discordjs/rest`) so the entity stays portable to a Cloudflare DO host in the planned follow-up. `@discordjs/rest` and `discord.js` are *adapter-only* dependencies.

**`delegate.spawn_horton`** — calls `runtimeServerClient.spawnEntity` with the configured Horton entity type and target server URL. Returns `{ childEntityUrl, childEntityId }`. Does not await completion.

**Reused** — `web_search`, `fetch_url`, and `search_durable_agents_docs` (when the docs knowledge base is available in the runtime).

**Via MCP** — GitHub MCP is the v1 GitHub surface: `search_issues`, `get_issue`, `create_pull_request`, `create_issue_comment`, `search_repos`, etc. No custom `github.*` tools are written in v1.

### 5.4 Context priming

Two paths:

1. **At spawn (one-shot).** On a `mention` wake whose target thread has no existing entity, the adapter fetches the last `messageLimit` parent-channel messages (default 20) and includes them as `primeMessages`. The entity inserts them as `ContextEntry` rows on first wake. After that, the prime fetch is never repeated for the thread.
2. **Mid-thread, on-demand.** The `read_channel_around_message(messageId, before, after)` tool lets the agent pull a window of messages around any message it has seen. Triggered either by:
   - the wake payload's `referencedMessageId` (set when the Discord user replies-to or quotes a message in their `@mention`), with system-prompt guidance to expand context when relevant; or
   - the agent's own judgment during a turn.

### 5.5 System prompt outline

Composed by `src/system-prompt.ts`. Key sections (full text drafted during implementation):

- Persona: friendly Electric assistant; concise in Discord; uses code blocks; cites issue/PR numbers as links.
- Tooling overview (Discord, GitHub MCP, delegate, docs/research) and *when* to use each.
- Discord-specific guidance: open replies as `post_message` to the thread, never DM, never @everyone, prefer one consolidated message to many short ones.
- Clarifying-question rule: if the task is ambiguous (missing issue number, repo conflict, unclear acceptance criteria for a code change), ask in-thread before spawning Horton.
- Coding-task delegation rule: any task involving editing files or opening PRs goes through `spawn_horton`. The bot itself does not run shell commands or modify files.
- Risky actions: never delete Discord channels/threads, never mass-mention.
- Onboarding (analogous to Horton's): if user opens with a vague greeting, introduce capabilities and ask what they need.

## 6. Data flow — canonical journeys

### 6.1 Q&A: `@bot what's the status of issue #4307?`

1. User posts in `#general`.
2. Gateway adapter receives `MESSAGE_CREATE`, sees no existing thread.
3. Adapter calls Discord `Start Thread from Message` API → new thread id.
4. Adapter POSTs wake to agents-server with `kind: 'mention'`, `primeMessages: [...last 20]`, `content: 'what is the status of #4307?'`.
5. agents-server wakes the `discord-bot` entity. First wake: it inserts `primeMessages` as `ContextEntry` rows, then runs the agent loop.
6. Agent recognises a GH-issue lookup → calls GitHub MCP `get_issue({ owner, repo, issue_number: 4307 })`.
7. Agent calls `discord.post_message(threadId, "<summary of #4307>")`.
8. Wake ends. Entity stays alive for thread follow-ups.
9. Follow-up `"is it merged?"` arrives as a `thread_msg` wake; agent loop resumes with prior turn state.

### 6.2 Coding task: `@bot fix issue #4312`

1–5. Same ingress: thread created, entity woken with mention payload.
6. Agent calls GitHub MCP `get_issue(4312)` to read the body and check repo context.
7. Agent calls `delegate.spawn_horton({ task: "<expanded brief>", initialMessage: "<first instruction>", branch: "electric-bot/thread-<id>" })`. Returns `{ childEntityUrl }`.
8. Agent calls `discord.post_message(threadId, "Spawned coding agent for #4312, I'll report back here when done. (Session: <url>)")`.
9. Wake ends.
10. Horton runs in its own runtime host: clones repo, edits, runs tests, pushes branch, calls GitHub MCP `create_pull_request`, produces final report.
11. agents-server delivers `child_completed` event to the `discord-bot` entity → entity wakes again with Horton's final report attached.
12. Agent calls `discord.post_message(threadId, "Done — opened PR #<n>: <title>. <summary>")`. Adds ✅ reaction to the original `@mention`.

### 6.3 Cross-cutting

- **Clarifying questions** are just an agent turn that calls `post_message` and ends the wake. No special state machine.
- **Failures** (Horton crashed, GH MCP 4xx, Discord 429) surface as tool errors to the agent. The agent decides between retry / escalate / fall back. No discrete retry/backoff layer in v1.
- **`/end`** sends `thread_close`; the entity posts a closing message and stops.

## 7. Configuration

Environment variables (mirrored in a zod-validated options object so embedders can bypass env entirely):

```
# Discord
DISCORD_BOT_TOKEN              gateway login + REST calls
DISCORD_PUBLIC_KEY             interaction signature verify
DISCORD_APP_ID
DISCORD_GUILD_ID               optional; scope bot to one guild

# Agents server (where the entity runs)
AGENTS_SERVER_URL              wake webhook target
AGENTS_SERVER_TOKEN            shared secret for webhook auth

# Horton runtime (where coding tasks land)
HORTON_AGENTS_SERVER_URL       defaults to AGENTS_SERVER_URL
HORTON_ENTITY_TYPE             default 'horton'

# GitHub (v1: single-repo)
GITHUB_TOKEN
GITHUB_REPO                    owner/name

# Adapter
DISCORD_ADAPTER_PORT           interactions HTTP listener; default 4449
DISCORD_PRIME_MESSAGE_LIMIT    default 20

# Models (reuses existing agents-runtime catalog selection)
ANTHROPIC_API_KEY | OPENAI_API_KEY
```

GitHub MCP is configured via the operator's existing `mcp.json` or `extraMcpServers` at register time. The Discord bot itself does not own that wiring; it consumes whatever the agents runtime exposes.

## 8. Packaging & deployment

- New pnpm workspace package `factory/discord-bot/` (added to `pnpm-workspace.yaml`).
- Binaries:
  - `bin/discord-bot` → Node adapter host (Gateway + Interactions).
  - `bin/discord-bot-register` → one-shot, registers the `/end` slash command with Discord. Re-runnable.
- README covers:
  - Discord application setup (bot user, intents `Guilds`/`GuildMessages`/`MessageContent`/`GuildMessageReactions`, OAuth scopes `bot`/`applications.commands`, invite link generation).
  - Environment configuration.
  - Registering slash commands.
  - Running the Node adapter; running alongside `agents-server`; pointing the entity at Horton's runtime.
  - Extension points: `extraTools`, `extraMcpServers`, `skills`.
  - Troubleshooting (intent denial, signature failures, gateway disconnects).
  - A "Future: Cloudflare DO deploy" note pointing at §10 so operators know it's planned.

## 9. Testing

- **Unit (tools):** Discord tools tested against a mocked `fetch`. `spawn_horton` tested against a mocked runtime-server client.
- **Unit (entity):** entity handler tested with the existing agents-runtime harness (`mockStreamFn`, in-memory entity stream DB) — same pattern Horton uses.
- **Adapter:** Gateway event-mapping tested with a fake discord.js client emitting fixture events. Interactions handler tested with crafted Ed25519-signed payloads (including failure cases).
- **Integration:** one end-to-end test that boots an agents-server + adapter + a stubbed Horton entity registered in the same registry, drives a fixture `MESSAGE_CREATE` through the gateway mapper, and asserts the bot posts a Discord message (via mocked REST) and spawns the stub Horton.
- No live Discord/GitHub calls in CI; a smoke-test runbook lives in the README for live verification against a test guild.

## 10. Future work (post-v1, not in scope)

- **Cloud deployment-status tools.** Add a `cloud.*` tool family (`deployment_status`, `list_databases`, `recent_errors`) once the Cloud API surface is decided.
- **Multi-repo / GitHub App** (path B of the auth question). The options object already allows `github: { app: { ... } }` shape; implementation deferred.
- **More slash commands** (`/fix issue:#N`, `/ask`, `/cloud-status`) as keyboard shortcuts for the same intents the agent already handles via `@mention`.
- **Per-user GitHub OAuth attribution**, so PRs come from the actual user.
- **Cloudflare Durable Object deploy** holding the Discord Gateway via the WebSocket Hibernation API, the Interactions endpoint, and the `discord-bot` entity inside the DO (via `agents-runtime` as a library, not via webhook to `agents-server`). Horton remains on a Node host, reached via HTTP. This is the planned next milestone; the v1 entity is designed to drop into this host without changes (no Node-only APIs in entity code).
- **Scheduled posts** (cron observation sources): daily issue triage report, weekly Cloud status.
- **Voice / embeds-as-UI** for richer interactions.

## 11. Open questions deferred to implementation

- Exact rate-limit handling for `read_channel_around_message` when an agent calls it many times in a turn (likely a per-wake budget; tuned during implementation).
- Whether `primeMessages` should include thread starter messages of *other* threads in the same channel for richer context (defer; default off).
- Whether to surface a `verbose` toggle so the bot can post progress updates while Horton is still running (defer; would require Horton to push intermediate events into the parent entity, which the runtime supports but adds noise).
