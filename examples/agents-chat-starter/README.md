# Electric Agents Chat Starter

[Electric Agents](https://electric-sql.com/docs/agents/) is a framework for building durable, collaborative AI agents. Agents run as long-lived entities with persistent state on durable streams — they scale to zero, survive restarts, and coordinate through shared state and wake events. This starter builds a multi-agent chatroom on top of it.

Two agents — an **Optimist** and a **Critic** — join every room. Ask a question and watch them debate from opposing viewpoints.

## Quick Start

```bash
# 1. Initialize the project
npx electric-ax agents init my-chat-app
cd my-chat-app

# 2. Start the agents infrastructure (Postgres, Electric, Durable Streams)
npx electric-ax agents quickstart

# 3. In a new terminal, set your Anthropic API key
cp .env.example .env
# Edit .env and add your key: ANTHROPIC_API_KEY=sk-ant-...
# Get one at https://console.anthropic.com/settings/keys

# 4. Run
pnpm install
pnpm dev
# Open http://localhost:5175
```

## How It Works

Each agent is an **entity** — an addressable unit of state at `/{type}/{id}` backed by a durable event stream. The runtime wakes entities in response to events (new messages, state changes, timers) and provides a handler context (`ctx`) for configuring the agent's LLM, tools, and coordination.

In this starter:

1. **User sends message** — backend writes to a shared state stream
2. **Agents wake** — `ctx.observe(db(...), { wake: { on: 'change' } })` triggers the handler when new messages arrive
3. **Agents respond** — the LLM runs with conversation context and uses the `send_message` tool to post back to shared state
4. **Frontend updates** — `useLiveQuery` on the shared state collection updates the UI reactively

## Project Structure

```
src/
  server/
    index.ts          # HTTP server, room management, entity registration
    schema.ts         # Zod schema for chat messages + shared state
    shared-tools.ts   # registerChatAgent factory, send_message & web_search tools
  ui/
    main.tsx          # App entry, room lifecycle, 3-column layout
    main.css          # Minimal styles using Radix theme tokens
    hooks/
      useChatroom.ts  # Subscribe to shared state (messages + agents)
      useEntityTypes.ts  # Fetch entity types from registry
    components/
      RoomsSidebar.tsx   # Room list + create
      ChatArea.tsx       # Messages + input + typing indicator
      MembersSidebar.tsx # Agent list + spawn controls
      MessageBubble.tsx  # Single message
```

## Adding New Agents

Define a new agent in `index.ts` using `registerChatAgent`:

```typescript
registerChatAgent(
  registry,
  'mediator',
  'Mediator — finds common ground',
  'You are a Mediator. Find common ground between different perspectives. Keep it short and conversational.'
)
```

The agent automatically:

- Creates/observes shared state with wake-on-change
- Gets conversation history via `useContext`
- Has `send_message` and `web_search` tools
- Appears in the UI's entity type list for spawning

## Stack

- **Runtime**: `@electric-ax/agents-runtime` — entity lifecycle, shared state, context assembly
- **Frontend**: React 19 + Vite + Radix UI Themes + TanStack DB
- **Backend**: Node.js HTTP server
- **Infrastructure**: Postgres + Electric + Durable Streams (via `electric-ax agents quickstart`)
