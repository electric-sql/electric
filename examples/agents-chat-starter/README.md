# Electric Agents Chat Starter

A multi-agent chatroom built on [Electric Agents](https://electric-sql.com/docs/agents/) — the durable runtime for long-lived agents. Three philosopher agents (Socrates, Albert Camus, and Simone de Beauvoir) join every room and engage in debates, casual conversation, and philosophical inquiry.

## Quick Start

> **Prerequisites:** Node.js 18+, Docker, [Anthropic API key](https://console.anthropic.com/settings/keys)

```bash
npx electric-ax agents init my-chat-app
cd my-chat-app
```

```bash
# Terminal 1 — start infrastructure (Postgres, Electric, Durable Streams)
npx electric-ax agents quickstart
```

```bash
# Terminal 2 — configure and run
cp .env.example .env            # add your ANTHROPIC_API_KEY
pnpm install && pnpm dev        # open http://localhost:5175
```

## What is Electric Agents?

Electric Agents is a runtime for building AI agents that run on your infrastructure as durable, addressable entities. Key ideas:

- **Scale to zero, wake on demand** — entities sleep when idle and wake on messages, state changes, or schedules
- **Durable state, not durable execution** — every step is persisted to an append-only stream, so agents survive restarts
- **Coordination built in** — spawn children, observe state, send messages, share databases between entities
- **Your stack, not ours** — runs on Express, Hono, Fastify, or any Node.js HTTP server

See the [full documentation](https://electric-sql.com/docs/agents/) to learn more.

## How It Works

1. **User sends message** — backend writes to a shared state stream
2. **Agents wake** — `ctx.observe(db(...), { wake: { on: 'change' } })` triggers when new messages arrive
3. **Agents respond** — the LLM runs and uses the `send_message` tool to post back to shared state
4. **Frontend updates** — `useLiveQuery` reactively renders new messages

## Adding New Agents

Define a new agent in `src/server/index.ts`:

```typescript
registerChatAgent(
  registry,
  'mediator',
  'Mediator — finds common ground',
  'You are a Mediator. Find common ground between different perspectives. Keep it short and conversational.'
)
```

The agent automatically observes shared state, wakes on new messages, gets conversation history via `useContext`, and appears in the UI for spawning.

## Learn More

- [Electric Agents documentation](https://electric-sql.com/docs/agents/)
- [Entity concepts and lifecycle](https://electric-sql.com/docs/agents/concepts)
- [Coordination patterns](https://electric-sql.com/docs/agents/patterns)
