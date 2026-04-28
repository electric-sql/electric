# Electric Agents Chat Starter

A multi-agent chatroom where AI agents with different perspectives discuss topics together.

Two agents — an **Optimist** and a **Critic** — join every room. Ask a question and watch them debate from opposing viewpoints.

## Quick Start

```bash
# 1. Initialize the project
npx electric-ax agents init my-chat-app
cd my-chat-app

# 2. Start the agents infrastructure
npx electric-ax agent quickstart

# 3. Configure (in a new terminal)
cp .env.example .env
# Set ANTHROPIC_API_KEY in .env

# 4. Run
pnpm dev
# Open http://localhost:5175
```

## How It Works

### Architecture

```
Frontend (React + Vite)         Backend (Node.js)          Infrastructure
┌────────────────────┐    ┌──────────────────────┐    ┌────────────────┐
│ TanStack DB        │    │ agents-runtime        │    │ agents-server  │
│ - useLiveQuery     │◄──►│ - optimist entity     │◄──►│ (Postgres +    │
│ - shared state sub │    │ - critic entity       │    │  Electric +    │
│                    │    │ - HTTP endpoints      │    │  Durable       │
│ Radix UI           │    └──────────────────────┘    │  Streams)      │
│ - Slack-style chat │                                └────────────────┘
└────────────────────┘
```

### Data Flow

1. **User sends message** → backend writes to shared state stream
2. **Agents wake** via `ctx.observe(db(...), { wake: { on: 'change' } })`
3. **Agents read history** via `ctx.useContext()` with conversation context
4. **Agents respond** via `send_message` tool → writes to same shared state
5. **Frontend updates** reactively via `useLiveQuery` on the shared state collection

### Key Concepts

| Concept          | API                                                       | Purpose                                                |
| ---------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| Shared state     | `ctx.mkdb()`, `ctx.observe(db(...))`                      | Cross-entity coordination — agents share a message log |
| Wake-on-change   | `wake: { on: 'change', collections: ['shared:message'] }` | Agents wake when new messages appear                   |
| Context assembly | `ctx.useContext({ sourceBudget, sources })`               | Inject conversation history into agent context         |
| Live queries     | `useLiveQuery(q => q.from(...).orderBy(...).select(...))` | Reactive frontend — no polling                         |
| Entity spawning  | `PUT /{type}/{id}` with `initialMessage`                  | Create agent instances at runtime                      |

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
- **Infrastructure**: Postgres + Electric + Durable Streams (via `electric-ax agent quickstart`)
