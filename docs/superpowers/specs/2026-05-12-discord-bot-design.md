# Discord Bot for Electric Agents — Design Spec

**Date:** 2026-05-12
**Status:** Draft for review
**Scope:** v1 of a Discord bot that lets users tag a bot in a Discord conversation to spawn an electric agent, prime it with conversation context, and continue working in a thread.

## 1. Goals and non-goals

### Goals

- Users in Discord can `@mention` the bot in any channel the bot is invited to, and the bot starts engaging with whatever the conversation was about.
- The bot is itself an LLM-driven agent. It triages each user message, asks clarifications when needed, and decides which of its skills/tools to invoke. v1 ships one built-in skill — **coding** — which dispatches a `horton` subagent for repository work. The skills/tools surface is the extension point for future capabilities (observability, docs Q&A, ticket triage, etc.).
- For coding tasks, horton retains its full capability — clone repos, run shell/edit/write, spawn workers, open PRs, search docs. The bot composes a brief and hands off; the bot stays the user-facing interlocutor and relays horton's per-turn output back to the thread.
- The bot gathers initial context from the messages preceding the @mention (ambient + reply blocks, see §3) so triage can reason about prior discussion. Follow-up messages in the thread feed the bot without needing another mention.
- Reach is scoped by the GitHub token configured on the agent host; no separate repo allowlist to maintain.
- The system is extensible: adding a new skill (e.g. honeycomb observability, Linear ticket triage) is a matter of dropping in a skill module and a few tools under `factory/discord/src/entity/skills/`. The bot's core does not change per skill.
- The Discord bot ships as a **reusable, self-contained package** that anyone with their own electric-agents deployment can install, configure (Discord + GitHub tokens, agents-server URL), and run. The package owns its own README with setup and deployment instructions.

### Non-goals (v1)

- A generic chat-bridge abstraction. The code can name Discord concepts directly; we are not designing for other chat platforms.
- Slash commands (`/agent`). Deferred.
- Skills beyond coding. Honeycomb, Sentry, Linear, docs-Q&A and similar are explicitly out of scope for v1 — the framework supports them, but only the `coding` skill is built.
- Parallel/concurrent skills. The bot serializes work: at most one active subagent (horton instance) at a time per thread; the bot can queue or politely decline a second task until the first finishes.
- Closing / archiving threads. Entities created for a thread stay alive indefinitely; the thread becoming inactive in Discord is signal enough.
- Multi-workspace / multi-guild distribution. The bridge can be configured for a fixed allowlist of guild IDs; OAuth/per-workspace install is deferred.
- Per-user GitHub identity (commits as the invoking user's GitHub identity). Deferred. All work commits as the configured bot identity.
- Token-level streaming into Discord. Granularity is "one bot-or-horton turn = one Discord message."

### Explicitly documented drawback

The design requires a **persistent process** holding the Discord gateway WebSocket. Plain-message `MESSAGE_CREATE` events — including @mentions in conversations and follow-up messages in threads — are delivered by Discord only over the gateway WebSocket. Discord's HTTP webhooks (Interactions, Webhook Events) do not carry these events; they only carry user-initiated actions like slash commands, buttons, and modals.

Supported hosts for the persistent process: any long-running Node host (Fly, Railway, ECS, K8s, VM, `pnpm start` next to agents-server in dev), or a Cloudflare Durable Object using the WebSocket Hibernation API. Pure worker / pure serverless deployment is **not supported** for the bridge. If the @mention UX is later judged not worth this constraint, the design can be re-cast as slash-command-only, which would be HTTP-webhook deployable.

## 2. System shape

Three components with a clean responsibility split.

```
   Discord Gateway (WS)
          │
          ▼
   ┌────────────────────────┐
   │ discord-gateway-bridge │   long-lived process or Durable Object
   │                        │   - holds the gateway WS
   │                        │   - inbound: HTTP to agents-server
   │                        │     (existing spawn/send endpoints)
   │                        │   - outbound: reads discord-outbox
   │                        │     durable stream → Discord REST
   └────────────────────────┘
           │                      ▲
           │ existing HTTP API    │ durable stream subscription
           ▼                      │
   ┌────────────────────────────────────────────────┐
   │  agents-server (UNMODIFIED)                    │
   │  + `discord` entity type registered into the   │
   │    runtime by factory/discord (consumer wires  │
   │    registerDiscordEntity(registry) in their    │
   │    own agents-runtime bootstrap)               │
   │                                                │
   │   `discord` entity instances (one per thread)  │
   │     - LLM-driven triage agent (useAgent loop)  │
   │     - has skills + tools; v1 ships the         │
   │       coding skill                             │
   │     - on coding tasks, spawns horton with      │
   │         wake: { on: 'runFinished',             │
   │                 includeResponse: true }        │
   │       and relays horton's per-turn output to   │
   │       discord-outbox                           │
   │                                                │
   │   `horton` instances (when coding skill runs)  │
   │     - unchanged                                │
   │     - clones repos, spawns workers, opens PRs  │
   │     - has no knowledge it's behind Discord     │
   └────────────────────────────────────────────────┘
```

### Key invariants

- **`agents-server` is not modified.** All net-new code lives under a new top-level monorepo folder `factory/`, in a single self-contained package `factory/discord/`. Nothing under `packages/` is touched (other than `pnpm-workspace.yaml` to include `factory/*`).
- **`horton` is not modified.** It is treated as a black-box chat agent. It does not learn Discord exists.
- **The package is reusable.** Anyone running their own electric-agents deployment can `pnpm add` (or vendor) the package, configure it with their tokens, and run the bridge. The package has no hard dependency on this monorepo other than the public APIs of `@electric-ax/agents-runtime` and the agents-server HTTP surface.
- **The bridge knows nothing about agents internals.** Its only contract with the agents side is a couple of agents-server HTTP endpoints (for inbound spawn/send) and one durable stream (`discord-outbox` for output).

### Package layout

A new top-level monorepo folder `factory/` is introduced. It is added to `pnpm-workspace.yaml` (`factory/*`). The Discord bot lives as a single package inside it.

```
factory/
  discord/
    package.json          # name: "@electric-ax/factory-discord"
    README.md             # setup & deployment instructions (contents in §2)
    tsconfig.json
    tsdown.config.ts
    vitest.config.ts
    src/
      index.ts            # public exports: registerDiscordEntity, runBridge
      entity/
        discord.ts        # defineEntity('discord', …) — LLM-driven agent
        system-prompt.ts  # triage prompt that describes available skills/tools
        types.ts          # entity args, state, outbox event shapes
        tools/
          post_to_thread.ts       # send text reply in the thread
          read_thread_history.ts  # re-fetch prior messages on demand
          start_coding_task.ts    # spawn horton, capture handle, set state
          forward_to_horton.ts    # send user message to active horton
          interrupt_horton.ts     # stop current horton run (best-effort)
        skills/
          index.ts        # skill registry assembly
          coding.ts       # the only v1 skill: dispatches horton
      bridge/
        gateway.ts        # WS holder, identify/heartbeat/resume
        router.ts         # gateway event → agents-server HTTP calls
        drainer.ts        # discord-outbox stream → Discord REST
        rest.ts           # thin Discord REST client wrapper
        priming.ts        # ambient + reply block pre-fetch
        config.ts         # env-driven config parsing
        log.ts
      cli.ts              # runnable entrypoint for the bridge process
    test/
      router.test.ts
      drainer.test.ts
      priming.test.ts
      entity-triage.test.ts
      entity-coding-skill.test.ts
    bin/
      factory-discord     # → dist/cli.js (set in package.json `bin`)
    deploy/
      Dockerfile
      fly.toml.example
      docker-compose.example.yml
```

### Public exports

The package has two consumers, in two different processes. Each gets one export.

| Export | Called from | Description |
|---|---|---|
| `registerDiscordEntity(registry)` | The consumer's **agents-runtime bootstrap** (alongside `registerHorton` / `registerWorker`, same pattern). | Registers the `discord` entity type into a runtime `EntityRegistry` so agents-server can spawn it when the bridge asks. Pure function; no side effects beyond the registration. |
| `runBridge(config)` | The consumer's **bridge process** (a separate long-running process from agents-server). | Connects the Discord gateway WS, runs the routing/outbox loops. Returns a handle with `stop()`. |

The bridge process does **not** call `registerDiscordEntity` — it never runs entities locally. It's purely a client of agents-server's HTTP API and a consumer of the `discord-outbox` durable stream.

The package also exposes a `bin` entry (`factory-discord`) that wraps `runBridge` and reads config from env. This is what gets invoked in Docker / Fly / Railway / a `pnpm start` script.

### Reuse model

A consumer is **not required to fork this repo**. They depend on `@electric-ax/factory-discord` like any other npm package and wire two pieces:

1. **In their agents-runtime bootstrap:** call `registerDiscordEntity(registry)` alongside their existing `registerHorton(...)` call so the `discord` entity type is known to their agents-server.
2. **As a separate long-running process:** run `factory-discord` (the `bin` entry) — or call `runBridge(config)` from their own wrapper. This process holds the Discord WebSocket and only needs network access to agents-server + the durable-streams service.

Both pieces share a deployment but **must run as separate processes** because the bridge is a long-lived gateway holder with different failure characteristics than agents-server. Docker/compose examples under `deploy/` show the recommended layout (two services, one network).

### README contents

`factory/discord/README.md` is a deliverable of v1. It is the canonical reuse documentation; anyone landing on the repo via npm or GitHub should be able to get the bot running from this file alone. Required sections:

1. **What it does.** One short paragraph + a diagram lifted from §2 of this spec. The user UX in three sentences: "@mention the bot, it asks clarifications in a thread, then it works on the task."
2. **Prerequisites.** A running electric-agents stack (agents-server + Postgres + durable streams). Node 20+. A Discord application + bot token. A GitHub token (PAT or App installation) with access to the repos you want the bot to touch.
3. **Discord setup.** Step-by-step: create application in the Discord developer portal, add a bot, enable the `MESSAGE_CONTENT` privileged intent, copy the bot token, generate an OAuth install URL with `bot` + `applications.commands` scopes and the minimum permission set (Send Messages, Create Public Threads, Send Messages in Threads, Read Message History), invite the bot to your guild, record the guild ID.
4. **Configuration.** Annotated table of every env variable the bridge reads (the table already drafted in §5 of this spec), with examples and notes on which are required.
5. **Install in your runtime.** Code snippet showing `registerDiscordEntity(registry)` in the consumer's agents-runtime bootstrap.
6. **Run the bridge.** Three deployment recipes, each fully copy-pasteable:
   - **Local dev:** `pnpm dlx @electric-ax/factory-discord` (or `pnpm start` from a clone), with `.env` example.
   - **Docker / docker-compose:** the example compose file under `deploy/`, pointed at an existing agents-server.
   - **Fly.io:** the example `fly.toml`, with `flyctl secrets set …` for the tokens.
   - **Cloudflare Durable Object:** documented as a supported but more involved path; the README links to a separate `deploy/cloudflare.md` rather than inlining it.
7. **Verifying it works.** A test checklist: bot appears online in the guild; @mention in a test channel produces a thread; follow-up messages stay in-thread; horton's responses appear; agents-server-ui at :4437 shows the `discord` and `horton` entities.
8. **Troubleshooting.** The top failures and what to check: missing privileged intent, wrong guild ID in allowlist, agents-server not reachable, outbox stream not configured, rate-limit error patterns.
9. **What the bot can and can't do.** Clear about repo reach (= GitHub token's scope), no auto-archive, no slash commands yet, single-tenant.
10. **License + contributing pointer** back to the monorepo.

The README is part of "done" for the v1 work, not an afterthought.

## 3. Entity model and lifecycle

### Identity

```
entity URL = /discord/{discord_thread_id}
```

The Discord thread ID *is* the entity's instance ID. There is no mapping table.

The paired horton instance lives at `/horton/{discord_thread_id}` (same id for traceability; horton doesn't care what the id is).

### What counts as "the thread"

The bot's view of every interaction is "this thread, owned by this entity." Discord allows @mentions in two contexts:

1. **Inside an existing thread.** `thread_id = channel_id` of that thread. Use as-is.
2. **In a normal (non-thread) channel message.** The bridge's first REST action is to create a thread off that message (`POST /channels/{channel}/messages/{message}/threads`). The new thread's ID becomes the entity's identity.

By the time the entity is spawned, a thread exists and the entity's id matches it.

### Routing rules (applied by the bridge before calling agents-server)

| Gateway event | Action |
|---|---|
| `MESSAGE_CREATE` mentioning the bot in a non-thread channel | Create a thread via REST, then `spawn` `/discord/{new_thread_id}` |
| `MESSAGE_CREATE` mentioning the bot inside an existing thread | `send` to `/discord/{thread_id}` if it exists, else `spawn` |
| `MESSAGE_CREATE` in a thread we've previously spawned an entity for (no mention required) | `send` to the existing entity |
| `MESSAGE_CREATE` from any bot account (including ours) | Drop |
| Anything else (`MESSAGE_UPDATE`, reactions, presence, typing) | Drop |

Spawn-or-send is implemented in the bridge: try `send`, fall back to `spawn` on `ErrCodeNotFound`. A small in-memory cache of `thread_id → spawned` skips the 404 round-trip when warm. Cache is lossy across restarts; the 404-fallback ensures correctness independent of the cache.

### Pre-spawn priming context

Before calling `spawn`, the bridge assembles a priming-context window from two sources and concatenates them in a fixed order. A single global character cap (`DISCORD_PRIOR_MESSAGES_CHAR_CAP`, default 20000) bounds the total.

**Ambient block (always present):** the most recent messages preceding the @mention, from whichever conversational scope the mention happened in.

| Mention happened in | Ambient block is drawn from |
|---|---|
| A non-thread channel | The **channel**, ending strictly before the mention message. (The work thread the bridge creates off the mention is brand-new and empty.) |
| An existing thread | The **thread**, ending strictly before the mention. The parent channel's chatter is not fetched. |

Fetched as a single `GET /channels/{source_channel_id}/messages?before={mention_message_id}&limit=100` and accumulated oldest-first until the remaining char budget is exhausted. No pagination beyond one page.

**Reply block (only when the mention is a reply):** Discord delivers a `referenced_message` field on the `MESSAGE_CREATE` payload when the user @mentions while *replying* to an older message. When present:

- Fetch the 10 messages immediately preceding the referenced message via `GET /channels/{referenced.channel_id}/messages?before={referenced.id}&limit=10`.
- The reply block is those 10 messages (oldest-first) followed by the referenced message itself.

`DISCORD_REPLY_CONTEXT_LIMIT` (default 10) is configurable.

**Ordering:** `prior_messages = [...ambient_block, ...reply_block]`. The ambient block goes first; the reply block goes last so the message the user specifically pointed at sits closest to the prompt cursor.

**Cap allocation:** the reply block is reserved space first (it's the user's deliberate signal of relevance). The ambient block fills whatever remains of the char cap. If a reply block alone exceeds the cap, drop messages from its oldest end while always keeping the referenced message itself.

The implicit page-size limit (100 per Discord) is the ceiling on the ambient block when char budget is generous; the explicit message-count cap from earlier drafts is dropped — char count is the only knob.

### Lifecycle of a `discord` entity

```
   spawned (firstWake)
      │
      │   ctx.args carries everything needed for triage:
      │     - work_thread_id, source_channel_id, source_was_thread, guild_id
      │     - initial_message (the @mention)
      │     - prior_messages (pre-fetched: ambient block then reply block,
      │                       capped by DISCORD_PRIOR_MESSAGES_CHAR_CAP)
      │
      │   The entity boots its LLM loop with the triage system prompt and
      │   the prior conversation as context, then runs its first turn.
      │   The model either calls a tool (the platform's own tools, or any
      │   tool exposed by a registered skill) or emits plain text
      │   (relayed by the loop via post_to_thread).
      ▼
   active (long-lived; many wakes follow indefinitely)
      │
      │   Wake reasons:
      │   - user_message arrives from the bridge → appended to the bot's
      │     conversation; ctx.agent.run() executes the next turn
      │   - a subagent the bot dispatched produces a runFinished wake
      │     (includeResponse: true) → delivered as an event the bot's
      │     loop sees as "<subagent> said: <response>"; the bot's next
      │     turn decides whether to relay, summarise, ask the user a
      │     follow-up, or take a different action
      ▼
   (stays active; no archive state in v1)
```

Entities are cheap to leave alive. v1 has no close path — once spawned, a `discord` entity lives forever and continues to handle messages in its thread.

### Re-mention of an already-spawned thread

Just another inbound message. The entity is alive and handles it via its normal LLM loop — same as any follow-up message in the thread.

## 4. The `discord` entity, in detail

### Responsibility

The entity is an **LLM-driven triage agent**. It is the user-facing interlocutor for the entire life of the thread. On each user message it runs one model turn, which may:

- Call `post_to_thread` to reply directly to the user (most common for clarifications and short answers).
- Invoke a skill's tools — in v1 the only built-in skill is **coding**, whose primary tool is `start_coding_task` (spawn `horton` with a brief).
- Forward a user message to an already-running horton via `forward_to_horton`.
- Interrupt a running horton via `interrupt_horton` if the user changes direction.

When horton is dispatched, the bot **stays in control**: it relays horton's per-turn responses to the thread, fields user clarifications inline, and decides when to forward vs answer directly. The bot never gives up the user-facing role.

For v1 the bot serializes work — at most one active subagent at a time per thread. If the user asks for a second task while horton is running, the bot replies "I'm still working on X, ask again after it finishes" (or queues, depending on the skill — implementation choice deferred).

### Spawn args (carried on `ctx.args`)

```ts
{
  work_thread_id: string,             // also encoded in entityUrl
  source_channel_id: string,          // where the mention happened
  source_was_thread: boolean,         // true if the mention was inside an existing thread
  guild_id: string,
  initial_message: {                  // the @mention message itself
    id: string,
    author_id: string,
    content: string,
    timestamp: string,
  },
  prior_messages: Array<{             // pre-fetched by bridge, chronological order
    id: string,
    author_id: string,
    author_name: string,
    content: string,
    timestamp: string,
  }>,
}
```

### State (persisted via `ctx.state`)

```ts
{
  horton_url: string | null,                       // URL of active horton, if any
  horton_status: 'idle' | 'running' | null,        // null when never spawned
  active_skill: 'coding' | null,                   // expands as skills are added
}
```

Conversation history (model messages, tool calls, tool results) is persisted by the runtime's `useAgent` machinery on the entity's `runs` collection — the same way horton does it today. The bot does not maintain its own message log.

### System prompt (sketch — full text lives in `system-prompt.ts`)

The triage prompt establishes:

- The bot is engaged in a Discord thread. Prior conversation (ambient + reply context blocks) is provided as a system block. Author names and timestamps are preserved.
- The bot has skills available. Each skill's description is rendered into the prompt, along with when to use it and what tools it exposes.
- For v1 the only listed skill is `coding`, used when the user wants a code change, bug fix, refactor, analysis of a repo, or an opened PR. The skill's primary tool is `start_coding_task(repo, brief)` which dispatches a horton subagent.
- Behavioral rules: prefer to ask one focused clarification when essential information (repo, scope) is missing rather than guessing. Keep replies tight; Discord is a chat surface, not a doc. When horton produces a per-turn message, relay it but feel free to summarize, add context, or ask the user what to do next.
- Constraints: do not invoke more than one subagent at a time. If a coding task is already running, say so.

### Handler shape (sketch)

```ts
defineEntity('discord', {
  handler: async (ctx) => {
    const tools = [
      postToThreadTool(ctx),
      readThreadHistoryTool(ctx),       // calls bridge via outbox for more context
      startCodingTaskTool(ctx),         // spawn('horton', ...)
      forwardToHortonTool(ctx),
      interruptHortonTool(ctx),
    ]

    if (ctx.firstWake) {
      ctx.state.horton_status = null
      ctx.state.active_skill = null

      const agent = ctx.useAgent({
        systemPrompt: buildSystemPrompt(ctx),
        tools,
        model: process.env.DISCORD_BOT_MODEL ?? 'claude-sonnet-4-6',
      })

      // First turn primed with the prior conversation + the @mention message
      await agent.run(formatPriorMessages(ctx.args))
      return
    }

    const agent = ctx.useAgent({
      systemPrompt: buildSystemPrompt(ctx),
      tools,
      model: process.env.DISCORD_BOT_MODEL ?? 'claude-sonnet-4-6',
    })

    for (const event of ctx.events) {
      if (event.type === 'user_message') {
        await agent.run(`<discord-user author="${event.author_name}">${event.text}</discord-user>`)
      } else if (event.type === 'horton_run_finished') {
        ctx.state.horton_status = 'idle'
        await agent.run(`<horton-output>${event.response ?? '(empty)'}</horton-output>`)
      }
    }
  },
})
```

`ctx.useAgent` is the same primitive horton uses today (see `packages/agents/src/agents/horton.ts`). The model alternates between tool calls and text; text emitted at the top of a turn is captured by the loop and posted via `post_to_thread` automatically (or the model can be required to always call `post_to_thread` explicitly — implementation detail in the plan).

### Tools available to the entity

| Tool | Purpose | Implementation |
|---|---|---|
| `post_to_thread(text)` | Send a reply in the thread | Append `{kind: 'message', thread_id: state.work_thread_id, text}` to `discord-outbox` |
| `read_thread_history(limit)` | Fetch additional thread messages on demand | Append `{kind: 'fetch_history', ...}` to `discord-outbox`; bridge returns result through entity inbox |
| `start_coding_task(repo, brief)` | Dispatch a horton subagent for code work | `ctx.spawn('horton', work_thread_id, hortonArgs, { initialMessage: {brief, prior_messages}, wake: { on: 'runFinished', includeResponse: true } })`. Updates `state.horton_url`, `state.horton_status`, `state.active_skill`. Errors if a horton is already active. |
| `forward_to_horton(message)` | Forward a user message to an active horton | `ctx.send(state.horton_url, message)`. Errors if no horton is active. |
| `interrupt_horton(reason)` | Cancel the current horton run | Best-effort: post a message to the user and clear `state.horton_url`; runtime support for hard-cancel is an open question (§11). |

`read_thread_history` reintroduces a tool we deferred earlier, because the bot is now an LLM agent that may decide it needs more context after triage. Same outbox-and-reply pattern as in earlier drafts: `{kind: 'fetch_history', thread_id, limit, correlation_id, reply_to_entity_url}`, bridge fetches and posts the result back as a `history_fetched` message into the entity inbox.

### Skills

v1 ships a single built-in skill: **coding**.

A skill is a TypeScript module that exports:

```ts
interface Skill {
  name: string
  description: string             // rendered into the system prompt
  systemPromptSection: string     // detailed instructions for when/how to use the skill
  tools: (ctx: HandlerContext) => Array<AgentTool>
}
```

The bot's `system-prompt.ts` enumerates registered skills and renders their `description` + `systemPromptSection` into the prompt. The bot's tool list is the union of platform tools (`post_to_thread`, `read_thread_history`) and every skill's tools.

For v1, `factory/discord/src/entity/skills/coding.ts` exports:

```ts
export const codingSkill: Skill = {
  name: 'coding',
  description: 'Use when the user wants code work — bug fixes, refactors, repo analysis, opening a PR.',
  systemPromptSection: '...detailed brief about how to compose a clean horton brief, when to ask for repo, when to push back on scope...',
  tools: (ctx) => [
    startCodingTaskTool(ctx),
    forwardToHortonTool(ctx),
    interruptHortonTool(ctx),
  ],
}
```

The bot's core does not change when skills are added. Adding "honeycomb" or "linear" later means:
1. Create `factory/discord/src/entity/skills/<name>/skill.ts` and any helper modules/clients.
2. Register the new skill in `skills/index.ts`.
3. The system prompt now offers it; the bot decides when to invoke it.

## 5. The bridge (inside `factory/discord/`)

### Responsibilities

1. Hold the Discord gateway WebSocket. Identify, heartbeat, handle reconnect/resume.
2. Filter incoming gateway events (see routing rules in §3). For each kept event:
   - Determine target `work_thread_id`: if the mention was in a thread, it's that thread; if in a non-thread channel, create one via REST (`POST /channels/{channel}/messages/{mention_id}/threads`).
   - **First-time spawn only:** assemble priming context per the rules in §3 — fetch the reply block first (if `referenced_message` is present, fetch its 10 preceding messages), reserve its char usage, then fetch the ambient block from the source channel until the remaining char budget is consumed. Concatenate as `[ambient, reply]`.
   - Try `send` to `/discord/{work_thread_id}` via agents-server HTTP; on `ErrCodeNotFound`, `spawn` with the full args described in §4.
3. Subscribe to `discord-outbox` durable stream cursor. For each item:
   - `kind: 'message'` → `POST /channels/{thread_id}/messages` with content.
   - `kind: 'fetch_history'` → `GET /channels/{thread_id}/messages?before={before_id?}&limit={n}`, deliver the result back to `reply_to_entity_url` via agents-server `send` with payload `{type: 'history_fetched', correlation_id, messages: [...]}`.
4. Honor Discord's `Retry-After` headers and respect rate limits when draining the outbox.

### Configuration (env)

| Variable | Purpose |
|---|---|
| `DISCORD_BOT_TOKEN` | Bot token from Discord developer portal |
| `DISCORD_BOT_USER_ID` | The bot's own user id (for mention-detection and to drop self-messages) |
| `DISCORD_ALLOWED_GUILD_IDS` | Comma-separated list of guild IDs the bot will respond in. Events from other guilds are dropped before any agents-server call. |
| `DISCORD_ALLOWED_USER_IDS` | Optional. If set, restricts who can invoke the bot. |
| `AGENTS_SERVER_URL` | Where to POST spawn/send calls |
| `AGENTS_SERVER_TOKEN` | If agents-server requires auth |
| `DURABLE_STREAMS_URL`, `DURABLE_STREAMS_TOKEN` | For the outbox subscription |
| `DISCORD_OUTBOX_STREAM` | Name of the outbox stream (default: `discord-outbox`) |
| `DISCORD_PRIOR_MESSAGES_CHAR_CAP` | Max total characters across the pre-fetched priming window (ambient + reply blocks combined; default: `20000`) |
| `DISCORD_REPLY_CONTEXT_LIMIT` | When the @mention is a reply, fetch this many messages immediately preceding the referenced message (the referenced message itself is always included on top; default: `10`) |
| `DISCORD_BOT_MODEL` | Model used for the bot's own triage LLM loop. Default: `claude-sonnet-4-6`. Horton picks its own model independently. |

### Idempotency and duplicate handling

- **Gateway redelivery on resume.** Dedupe on Discord's `event.id` / message id via a small in-memory LRU.
- **Bridge restart after partial work.** Spawn calls are idempotent at agents-server (duplicate URL returns `ErrCodeDuplicateURL`, which the bridge treats as "already spawned, fall through to send"). Send calls may deliver a user message twice; v1 accepts the rare duplication and lets horton see it.
- **Outbox redelivery.** The bridge's cursor commits after each successful REST call. A crash between REST success and cursor commit will re-send one Discord message. Acceptable for v1; can add per-item idempotency keys later if duplicate posts become a real problem.

### In-memory state (not persisted)

- Discord gateway session ID + sequence number for resume.
- LRU of recently-processed gateway event IDs (dedup).
- LRU of `thread_id → known_spawned: boolean` (skip-404 cache).

All of these are lossy and self-healing. Bridge restart costs at most one extra HTTP call per warm thread on first message and one extra Discord history fetch on the first @mention after restart (idempotent retry on transient failures).

### Health and observability

- `/health` endpoint reports: WS connection state, last gateway event timestamp, outbox cursor lag, agents-server reachability.
- Structured JSON logs per processed event (gateway and outbox). Log IDs and metadata; never log message contents by default.
- Optional Prometheus-shaped counters for events processed, outbox drained, spawn-or-send 404s, REST errors.

## 6. Streams and contracts

### `discord-outbox` (durable stream)

Single, deployment-wide. The bridge subscribes once.

Event shape (discriminated union on `kind`):
```ts
type DiscordOutboxEvent =
  | { kind: 'message', thread_id: string, text: string }
  | {
      kind: 'fetch_history',
      thread_id: string,
      before_id?: string,
      limit: number,
      correlation_id: string,
      reply_to_entity_url: string,
    }
```

Single-variant in v1; the discriminated-union shape is kept so future kinds (e.g. `react`, `fetch_history`, `edit_message`) drop in without a contract migration.

The bridge fans out by `thread_id` when issuing REST calls; per-thread streams are not needed at v1 volumes.

### Inbound: agents-server HTTP API (existing, unchanged)

- `POST /entity/discord/{thread_id}/spawn` (or whatever the existing spawn endpoint shape is — the bridge uses the same one any client uses).
- `POST /entity/discord/{thread_id}/send` for follow-ups.

These endpoints already exist in agents-server and the bridge consumes them as a normal client.

## 7. Security

Four distinct credential boundaries, none overlapping:

1. **Discord bot token** — env on the bridge host only. Compromise of agents-server does not compromise Discord.
2. **GitHub token / GitHub App installation** — env on the host running horton's `bash` tool. Implicitly defines repo reach (the v1 decision: no separate allowlist).
3. **Durable-streams credentials** — bridge reads/writes specific streams. Standard electric-agents auth.
4. **agents-server HTTP token** — bridge presents this when calling spawn/send. Same shared-secret model as other clients today.

**Discord-side access control:**
- `DISCORD_ALLOWED_GUILD_IDS` — hard allowlist of guilds; everything else is dropped. Mandatory.
- `DISCORD_ALLOWED_USER_IDS` — optional allowlist of invokers, for early-access deployments.

The bridge replies (via REST) with a one-line "not authorized in this guild/by this user" when a message is dropped on these grounds, so the user gets feedback rather than silence.

**Out of scope for v1:** Discord OAuth flow, per-user GitHub identity mapping (commits as the user's GitHub account, not the bot's), per-channel rate limiting, audit log integration.

## 8. Testing

Three layers:

1. **Unit (bridge).** Table-driven tests of gateway-event → agents-server-call translation and outbox-event → Discord-REST mapping. Mock the WS client and the REST client. Covers routing rules, dedup, allowlist enforcement, rate-limit retry behavior.
2. **Entity (`discord`).** Use the same test patterns the existing `packages/agents` test suite uses (vitest + in-memory runtime + Postgres). Tests live in `factory/discord/test/`. The bot is LLM-driven, so model calls are mocked with a **scripted-response stub** that lets each test assert "given input X, the model produces tool call Y" — the same approach used in `packages/agents/test/spawn-worker-tool.test.ts`. Two main scenarios get coverage:
   - **Triage path:** user message arrives → stub model emits `start_coding_task` → assert `ctx.spawn('horton', ...)` is called with the expected brief and that state transitions to `horton_status: 'running'`.
   - **Relay path:** horton `runFinished` event arrives → stub model emits `post_to_thread` containing the relayed response → assert the right outbox row is written.
   Skill modules are tested in isolation (`coding.test.ts`) by passing a mock `HandlerContext` and asserting that `skill.tools(ctx)` produces the expected tool list with working implementations.
3. **End-to-end (opt-in).** One integration test against a real Discord test server with a real test bot token. Exercises @mention → thread creation → clarification round trip → completion. Gated by env var; not run in default CI.

LLM calls are mocked throughout. We're verifying glue, not horton's reasoning.

## 9. Rollout

Four phases, each independently mergeable:

**Phase 1 — Inbound only, outbox stubbed.** Bridge connects to gateway, parses @mentions, calls agents-server spawn endpoint, but the entity's outbox tools are no-ops. Verify in `agents-server-ui` that `discord` entities materialize correctly. Bot is "spawnable but mute."

**Phase 2 — Outbox + bridge drainer with stub entity.** Implement `post_to_thread` and the outbox drainer. Replace the entity body with a stub that replies "hi from the test entity" on every wake. Confirm the full inbound → entity → outbox → REST → Discord roundtrip.

**Phase 3 — Wire the LLM-driven entity with the coding skill.** Replace stub with the real `discord` entity: triage system prompt, `useAgent` loop, platform tools (`post_to_thread`, `read_thread_history`), the coding skill (`start_coding_task`, `forward_to_horton`, `interrupt_horton`), and the bridge's priming-context fetch + history-reply path. This is the v1 product.

**Phase 4 — Hardening + reuse polish.** Allowlist enforcement (guild + optional user). Health endpoint. Rate-limit handling. Structured logs. Complete the `factory/discord/README.md` (the skeleton lands in Phase 1 alongside the package scaffold; final-form copy and deployment recipes land here). Provide `deploy/Dockerfile`, `deploy/fly.toml.example`, and `deploy/docker-compose.example.yml`. Document the Durable Object deployment path in a separate `deploy/cloudflare.md`.

The bot is gated by `DISCORD_BOT_TOKEN` being set; deployments without it run agents-server normally with no Discord behavior.

## 10. Deferred work, with cheap-to-add paths

Each of these is purely additive — no architectural change to v1.

- **Slash commands (`/agent`).** Add the `INTERACTION_CREATE` event type to the gateway listener. Convert to the same inbound shape as @mentions. Useful as a discoverable initiator alongside @mentions, with structured fields like an optional `repo:` parameter.
- **Cloudflare Worker for HTTP interactions endpoint.** Pairs with slash commands and buttons. Separate deployment shape; calls the same agents-server API.
- **Multi-guild with per-guild config.** Today the allowlist is one bag; expand to a `guild_id → { github_token, horton_args }` map. The entity model doesn't change.
- **Additional skills.** Each follows the same shape (`factory/discord/src/entity/skills/<name>/`) and registers in `skills/index.ts`. Concrete candidates:
  - **Observability (honeycomb).** Skill module + tools to query Honeycomb (free-text-to-query, run-query, fetch traces). Use case: "are auth requests timing out in the last hour?"
  - **Sentry.** Resolve/inspect issues, summarize stack traces.
  - **Linear / GitHub Issues.** Look up tickets, create/triage issues from Discord context.
  - **Docs Q&A.** Search internal documentation, answer questions inline without dispatching horton.
- **Extra Discord-side tools.** `search_channels`, `read_other_thread`, `read_pinned_messages` — new outbox-event kinds, pure additions.
- **Parallel skills.** v1 serializes; future work can let the bot dispatch multiple subagents concurrently (e.g. start horton on a code fix AND query honeycomb), with the bot multiplexing their outputs into the thread.
- **GitHub Issues / Linear *inbound* bridge.** Same pattern as Discord, different source. The skill framework on the entity stays unchanged; only the bridge differs.

## 11. Open questions / things to confirm during implementation

- **Exact wake payload shape for `runFinished` with `includeResponse: true`.** The runtime types say "concatenated response text"; confirm what an empty / errored run delivers, and confirm assistant messages produced mid-run (if any) aren't truncated.
- **Where does the GitHub token actually live for horton's bash?** Today's deployment puts it in env on the agents-server host. Confirm this is the v1 story or whether a per-guild token mechanism is needed sooner.
- **Discord intents required.** v1 needs `GUILDS`, `GUILD_MESSAGES`, `MESSAGE_CONTENT`. `MESSAGE_CONTENT` is a privileged intent that must be enabled in the developer portal.
- **Hard-cancel semantics for a running horton.** `interrupt_horton` is best-effort in v1 (clear the parent's state pointer, post a message to the user). Whether the runtime supports a true kill — and what happens to in-flight workers horton spawned — needs verification. If not supported, document that "interrupt" really means "I'll stop relaying horton's output; it may keep running in the background until its current turn completes."
- **`useAgent` ergonomics for non-horton agents.** Confirm the existing `ctx.useAgent` flow (used by horton) is the right primitive to use directly from a separate entity type, or whether the bot needs to call into a lower-level pi-agent-core API. The handler sketch in §4 assumes the former.
- **How tool descriptions get rendered into the system prompt.** The skills framework in §4 assumes a straightforward "concatenate skill descriptions" approach. If the runtime/pi-agent-core has a different convention for tool/skill exposure, follow that.
