# Electric Agents Chat Starter

A minimal starter project that demonstrates Electric agents in a shared chatroom. Two agent types (Researcher and General Assistant) join a room and respond to user messages based on their expertise. Developers can add new entity types and they automatically appear as spawnable in the UI.

## Architecture

```
Frontend (React + Vite)          Backend (Node.js)           Infrastructure
┌──────────────────────┐    ┌─────────────────────┐    ┌──────────────────┐
│ TanStack DB          │    │ agents-runtime       │    │ agents-server    │
│ - shared state sub   │◄──►│ - researcher entity  │◄──►│ (Postgres +      │
│ - entity type list   │    │ - assistant entity   │    │  Electric +      │
│                      │    │ - HTTP endpoints     │    │  Durable Streams)│
│ Chat UI              │    └─────────────────────┘    └──────────────────┘
│ - message list       │         ▲                          ▲
│ - input box          │         │ webhook                  │
│ - agent spawn panel  │         └──────────────────────────┘
└──────────────────────┘
```

### Data flow

1. User clicks "Add Researcher" -> frontend `PUT` to agents-server -> spawns researcher entity -> entity observes shared chatroom DB
2. User types message -> frontend writes to shared state `messages` collection
3. Each agent entity wakes on new messages -> reads conversation -> decides if relevant -> writes response to shared state
4. Frontend subscribes to shared state via TanStack DB -> renders all messages in order

## Shared State Schema

One shared state DB per chatroom with a single `messages` collection:

```typescript
const messageSchema = z.object({
  key: z.string(), // unique message id (crypto.randomUUID())
  role: z.enum([`user`, `agent`]),
  sender: z.string(), // "user" or agent entity URL
  senderName: z.string(), // display name ("You", "Researcher-1", "Assistant-1")
  text: z.string(),
  timestamp: z.number(), // Date.now()
})

const chatroomSchema = {
  messages: {
    schema: messageSchema,
    type: `shared:message`,
    primaryKey: `key`,
  },
} as const
```

## Entity Types

### Researcher

- **Description**: Agent with web search capability. Responds to questions that need factual research, current information, or web lookups.
- **Tools**: `web_search` (Brave Search API), `send_message` (write to shared chat)
- **System prompt**: You are a Research Agent in a shared chatroom. When a user asks a question that requires factual information, current events, or web research, respond using your web search tool. If the question is general conversation or doesn't need research, stay silent (do not respond). Always use send_message to post your response to the chatroom.
- **Wake trigger**: `{ on: 'change', collections: ['messages'] }` — wakes when new messages appear
- **Creation args**: `{ chatroomId: string }` — identifies which chatroom to join

### Assistant

- **Description**: General-purpose helpful agent. Responds to conversational questions, brainstorming, explanations, and anything that doesn't need specialized tools.
- **Tools**: `send_message` (write to shared chat)
- **System prompt**: You are a General Assistant in a shared chatroom. When a user asks a conversational question, needs help brainstorming, wants an explanation, or asks something that doesn't require web research, respond helpfully. If another agent (like a Researcher) is better suited for the question, stay silent. Always use send_message to post your response to the chatroom.
- **Wake trigger**: `{ on: 'change', collections: ['messages'] }` — wakes when new messages appear
- **Creation args**: `{ chatroomId: string }` — identifies which chatroom to join

### Common pattern

Both entity types share this flow:

1. On first wake: observe the chatroom shared state DB
2. On subsequent wakes: read recent messages, determine if the latest user message is relevant, optionally respond via `send_message` tool
3. The agent reads the full message history as context so it can follow the conversation

### `send_message` tool (shared)

```typescript
{
  name: 'send_message',
  description: 'Post a message to the chatroom',
  parameters: { text: z.string() },
  execute: async (toolCallId, params) => {
    chatroom.messages.insert({
      key: crypto.randomUUID(),
      role: 'agent',
      sender: ctx.entityUrl,
      senderName: agentDisplayName,
      text: params.text,
      timestamp: Date.now(),
    })
    await awaitPersisted(...)
  }
}
```

## Backend Server

Minimal Node.js HTTP server (following deep-survey pattern):

### Endpoints

| Method | Path                  | Purpose                                                                      |
| ------ | --------------------- | ---------------------------------------------------------------------------- |
| `GET`  | `/api/config`         | Returns `{ darixUrl }` for frontend                                          |
| `POST` | `/api/room`           | Create chatroom — spawns a shared state DB, returns `{ roomId }`             |
| `POST` | `/api/room/:id/agent` | Spawn an agent into the room — body: `{ type: "researcher" \| "assistant" }` |
| `POST` | `/webhook`            | agents-runtime webhook handler                                               |

### Startup

```typescript
const registry = createEntityRegistry()
registerResearcher(registry)
registerAssistant(registry)

const runtime = createRuntimeHandler({
  baseUrl: DARIX_URL,
  serveEndpoint: `${SERVE_URL}/webhook`,
  registry,
})

// HTTP server with CORS, JSON helpers, routes
server.listen(PORT, async () => {
  await runtime.registerTypes()
})
```

### Chatroom creation

The `/api/room` endpoint doesn't spawn an entity — it just returns a room ID. The shared state DB is created by the first agent that joins (using `ctx.mkdb()`). Subsequent agents observe the existing DB.

To handle the race of "who creates the shared DB first", the first agent to join calls `ctx.mkdb()`, and subsequent agents call `ctx.observe(db(...))`. Each entity checks if the DB exists before creating:

```typescript
// First agent to join creates the DB; others observe
if (ctx.firstWake) {
  try {
    ctx.mkdb(chatroomId, chatroomSchema)
  } catch {
    // Already exists — another agent created it first
  }
}
const chatroom = await ctx.observe(db(chatroomId, chatroomSchema))
```

### Dynamic entity type discovery

The frontend queries `GET /_electric/entity-types` on the agents-server to list available types. This means:

- Developer adds a new entity file + registers it in the server
- Restarts the server
- The new type appears in the UI's "Add Agent" dropdown automatically

## Frontend

### File structure

```
src/ui/
  main.tsx              # App entry, room creation, layout
  hooks/
    useChatroom.ts      # Subscribe to shared state messages
    useEntityTypes.ts   # Fetch available entity types from registry
  components/
    ChatRoom.tsx        # Message list + input
    AgentBar.tsx        # Active agents + "Add Agent" controls
    MessageBubble.tsx   # Single message rendering
```

### `useChatroom` hook

Subscribes to the chatroom shared state DB and returns messages in order:

```typescript
function useChatroom(darixUrl: string, roomId: string) {
  const [messages, setMessages] = useState<Message[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    // 1. createAgentsClient({ baseUrl: darixUrl })
    // 2. observe(entities({ tags: { room_id: roomId } })) -> track agents
    // 3. observe(db(roomId, chatroomSchema)) -> track messages
    // 4. createEffect on messages collection -> sort by timestamp -> setMessages
  }, [darixUrl, roomId])

  return { messages, agents, connected }
}
```

### `useEntityTypes` hook

Fetches available entity types from the agents-server:

```typescript
function useEntityTypes(darixUrl: string) {
  const [types, setTypes] = useState<EntityType[]>([])

  useEffect(() => {
    fetch(`${darixUrl}/_electric/entity-types`)
      .then((r) => r.json())
      .then(setTypes)
  }, [darixUrl])

  return types
}
```

### User message sending

User messages go directly into the shared state DB. The frontend writes to the shared state via an API endpoint on the backend server (since the frontend doesn't have a write token for the shared state stream). The backend provides a `POST /api/room/:id/message` endpoint:

```typescript
// Backend: POST /api/room/:id/message
// Writes the user message to the chatroom shared state
// The room's shared state stream write token is stored server-side
```

Alternatively, user messages can be sent to all agents via `POST /{type}/{id}/send` and the agents write both the user message and their response to shared state. This is simpler — the user message is the `initialMessage` or sent via the entity `/send` endpoint, and each agent writes it plus their response to the shared chat.

**Chosen approach**: Send user messages to all agents in the room via their `/send` endpoint. Each agent receives the message, reads the shared state for context, and writes their response to shared state. The first agent to process also writes the user message to the shared state (using an idempotent insert keyed by a message ID from the frontend).

## UI Design

Minimal, clean layout:

```
┌─────────────────────────────────────────────┐
│  Electric Agents Chat                       │
│  Room: abc123  |  Agents: R1, A1, R2        │
│  [+ Researcher]  [+ Assistant]              │
├─────────────────────────────────────────────┤
│                                             │
│  You: What's the latest on quantum          │
│  computing breakthroughs?                   │
│                                             │
│  Researcher-1: Based on my research...      │
│  [web_search: "quantum computing 2026"]     │
│  Here are the latest developments...        │
│                                             │
│  You: Can you explain quantum               │
│  entanglement in simple terms?              │
│                                             │
│  Assistant-1: Think of it like this...      │
│                                             │
├─────────────────────────────────────────────┤
│  Type a message...                    [Send]│
└─────────────────────────────────────────────┘
```

- Messages from agents show their name and type with a colored dot
- User messages are visually distinct (right-aligned or different background)
- "Add Agent" buttons are dynamically generated from entity type registry
- Agent spawning shows a brief "joining..." state
- Minimal CSS — a single CSS file, no UI framework, just clean defaults

## Project Structure

```
examples/agents-chat-starter/
  package.json
  tsconfig.json
  vite.config.ts
  .env.example            # BRAVE_SEARCH_API_KEY, DARIX_URL, PORT
  src/
    server/
      index.ts            # HTTP server, routes
      researcher.ts       # Researcher entity definition
      assistant.ts        # Assistant entity definition
      shared-tools.ts     # send_message tool, web_search tool
      schema.ts           # Zod schemas for chatroom shared state
    ui/
      main.tsx            # App entry point
      main.css            # Minimal styles
      hooks/
        useChatroom.ts    # Shared state subscription
        useEntityTypes.ts # Entity type registry query
      components/
        ChatRoom.tsx      # Message list + input
        AgentBar.tsx      # Agent list + spawn controls
        MessageBubble.tsx # Single message
```

## Dependencies

```json
{
  "dependencies": {
    "@electric-ax/agents-runtime": "workspace:*",
    "@durable-streams/state": "npm:@electric-ax/durable-streams-state-beta@^0.3.0",
    "@mariozechner/pi-agent-core": "^0.57.1",
    "@tanstack/db": "^0.6.0",
    "@tanstack/react-db": "^0.1.78",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.2.0",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^7.2.4"
  }
}
```

## Scripts

```json
{
  "dev": "pnpm run --parallel \"/^dev:/\"",
  "dev:server": "tsx watch src/server/index.ts",
  "dev:ui": "vite"
}
```

## Getting Started (User Experience)

```bash
# 1. Clone the starter
npx gitpick electric-sql/electric/tree/main/examples/agents-chat-starter my-chat-app
cd my-chat-app

# 2. Install dependencies
pnpm install

# 3. Start infrastructure (Postgres + Electric + agents-server)
npx electric-ax agent quickstart

# 4. Configure
cp .env.example .env
# Add ANTHROPIC_API_KEY (required)
# Add BRAVE_SEARCH_API_KEY (optional, for researcher web search)

# 5. Run
pnpm dev
# Opens http://localhost:5175
```

## What This Demonstrates

For developers learning Electric agents, this starter covers:

1. **Entity definition** — two entity types with different capabilities
2. **Shared state** — agents coordinate through a shared DB (the chatroom)
3. **Wake-on-change** — agents react to new messages automatically
4. **Tool use** — researcher uses web search; both use send_message
5. **Dynamic entity spawning** — spawn agents at runtime, discovered from registry
6. **Real-time UI** — TanStack DB subscriptions for live message updates
7. **Minimal patterns** — small files, clear separation, easy to copy and extend
