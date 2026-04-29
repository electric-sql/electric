# Building with Electric Agents

This starter uses Electric Agents — a runtime for durable, collaborative AI agents backed by streams.

## Core Patterns Used

### Shared State (`ctx.mkdb` + `ctx.observe`)

Agents coordinate through a shared durable stream. One entity creates it, others observe:

```typescript
// First wake: create the shared state
if (ctx.firstWake) {
  ctx.mkdb(chatroomId, chatroomSchema)
}

// Observe with wake-on-change (must run before firstWake early return)
const chatroom = await ctx.observe(db(chatroomId, chatroomSchema), {
  wake: { on: 'change', collections: ['shared:message'] },
})
```

**Important**: The `observe()` call must happen on every wake (including first wake) so the wake registration persists. Place it BEFORE the `if (ctx.firstWake) return` guard.

### Context Assembly (`ctx.useContext`)

Inject external data into the agent's LLM context with token budgeting:

```typescript
ctx.useContext({
  sourceBudget: 50_000,
  sources: {
    conversation: {
      cache: 'volatile', // changes every wake
      content: async () => getConversationHistory(chatroom),
    },
  },
})
```

Cache tiers: `volatile` (changes every wake), `slow-changing`, `stable`, `pinned` (always included).

### Wake-on-Change

The `collections` filter in wake conditions matches the event `type` field, not the collection name:

```typescript
// Schema defines: type: 'shared:message'
wake: { on: 'change', collections: ['shared:message'] }  // ✓ correct
wake: { on: 'change', collections: ['messages'] }         // ✗ won't match
```

### Writing to Shared State from the Backend

When POSTing events to a shared state stream, include a top-level `key`:

```typescript
const msgKey = crypto.randomUUID()
const event = {
  type: 'shared:message',
  key: msgKey, // ← required for materialization
  headers: { operation: 'insert' },
  value: { key: msgKey, role: 'user', text: '...' },
}
await fetch(`${AGENTS_URL}/_electric/shared-state/${roomId}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(event),
})
```

Without the top-level `key`, the StreamDB won't materialize the event into the collection.

### Entity Bootstrap

Entities need an `initialMessage` when spawned — the runtime skips the handler if there's no fresh input on first wake:

```typescript
await fetch(`${AGENTS_URL}/${type}/${id}`, {
  method: 'PUT',
  body: JSON.stringify({
    args: { chatroomId: roomId },
    initialMessage: 'You have joined the chatroom.',
  }),
})
```

### Preventing Agent Loops

When agents write to shared state, their own writes trigger their own wake. To prevent infinite loops, check if this agent already responded after the latest user message:

```typescript
const sorted = [...allMessages].sort((a, b) => a.timestamp - b.timestamp)
const lastUserIdx = /* find last user message */
const alreadyReplied = sorted.slice(lastUserIdx + 1).some(m => m.sender === ctx.entityUrl)
if (alreadyReplied) return
```

## Documentation

- [Electric Agents Quickstart](https://electric-sql.com/docs/agents) — interactive tutorial
- [agents-runtime API](https://github.com/electric-sql/electric/tree/main/packages/agents-runtime) — entity definitions, shared state, context assembly
- [TanStack DB](https://tanstack.com/db/latest) — live queries, collections, optimistic mutations
- [Radix UI Themes](https://www.radix-ui.com/themes) — component library used in the frontend
- [Electric Agents Server UI](http://localhost:4437/__agent_ui/) — inspect entities, streams, and wakes (when running locally)

## Development

```bash
# Start infrastructure
npx electric-ax agents quickstart

# Run the app (server + UI)
pnpm dev

# Typecheck
pnpm typecheck
```

Environment variables (see `.env.example`):

- `ANTHROPIC_API_KEY` — required for LLM calls
- `BRAVE_SEARCH_API_KEY` — optional, enables web search tool
- `AGENTS_URL` — agents server URL (default: `http://localhost:4437`)
