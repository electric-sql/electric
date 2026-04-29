# Deep Survey

A multi-agent deep research app powered by [Electric Agents](../../packages/agents-runtime/). An orchestrator coordinates a swarm of ~50 AI explorer agents that research a topic in parallel, each performing real web searches and writing wiki entries with cross-references — all synchronized in real time through shared state.

## How It Works

1. **You provide a target** — a topic, codebase, or any subject to explore
2. **The orchestrator agent** does initial web research to understand the landscape, then decomposes it into individual topics
3. **Explorer agents spawn in parallel** — one per topic — each with web search and URL fetching capabilities
4. **Each explorer researches its topic**, writes a wiki entry (100–200 words of synthesized findings), and creates cross-references to related entries in the shared knowledge base
5. **The live dashboard** shows everything happening in real time: agent status, the growing knowledge graph, wiki entries, and activity

Once the swarm completes, you can ask follow-up questions in the chat sidebar. The orchestrator queries the accumulated wiki to synthesize answers across all explored topics.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     React Frontend                      │
│  SwarmGraph · WikiColumn · ChatSidebar · ActivityHeatmap│
│                          │                              │
│              useSwarm hook (TanStack DB)                 │
│                    real-time sync                        │
└──────────────────────────┬──────────────────────────────┘
                           │
                Electric Agents Server
                   (entity runtime)
                           │
              ┌────────────┴────────────┐
              │                         │
        Orchestrator              Shared State DB
        (Claude LLM)             ┌──────┴──────┐
              │                  │ wiki entries │
     ┌────────┼────────┐        │ cross-refs   │
     │        │        │        └──────────────┘
  Explorer Explorer Explorer         ▲
  Agent 1  Agent 2  Agent N ─────────┘
     │        │        │        read/write
     └────────┴────────┘
       web_search
       fetch_url
       write_wiki / read_wiki / write_xrefs
```

**Backend** — Two entity types registered with the Electric Agents runtime:

- **Orchestrator**: Receives the user's target, performs initial web research via the Brave Search API, then calls `explore_corpus` to decompose the target into topics and spawn N explorer agents. Uses shared state to query the accumulated wiki and answer follow-up questions.
- **Explorer workers**: Each explorer is a `survey_worker` entity with `web_search`, `fetch_url`, `write_wiki`, `read_wiki`, and `write_xrefs` tools. After researching their topic and writing an entry, they scan other entries and record cross-references in the shared knowledge base.

**Frontend** — Real-time reactive UI built with React 19 and TanStack DB:

- **SwarmGraph** — Interactive D3 force-directed graph showing the spawn tree and knowledge cross-references
- **WikiColumn** — Browsable knowledge base with table of contents and cross-reference links
- **ChatSidebar** — Orchestrator message timeline and follow-up input
- **ActivityHeatmap** — Color-coded grid showing agent status (spawning, running, idle, stopped)
- **StreamLog** — Live tail of the most recent agent events

## Shared State

Agents coordinate through a shared state database with two collections defined as [Zod](https://zod.dev/) schemas:

| Collection | Fields                                       | Purpose                                    |
| ---------- | -------------------------------------------- | ------------------------------------------ |
| `wiki`     | `key`, `title`, `body`, `author`, `improved` | Research findings per topic                |
| `xrefs`    | `key`, `a`, `b`                              | Cross-reference edges between wiki entries |

The orchestrator creates the shared DB, and each explorer receives a handle to it when spawned. The frontend subscribes to these collections for live updates as agents write their findings.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v22+
- [Docker](https://www.docker.com/) (for the Electric Agents infrastructure)
- An [Anthropic API key](https://console.anthropic.com/)
- (Optional) A [Brave Search API key](https://brave.com/search/api/) for web research

### 1. Install dependencies

From the repository root:

```bash
pnpm install && pnpm --filter @electric-ax/agents-runtime build
```

### 2. Configure environment

Create a `.env` file in this directory:

```bash
ANTHROPIC_API_KEY=sk-ant-...
BRAVE_SEARCH_API_KEY=...           # optional
```

### 3. Start the Electric Agents server

```bash
npx electric-ax agents quickstart
```

This starts the agents server and its backing infrastructure (Postgres, Electric) via Docker. The agents server will be available at `http://localhost:4437`.

### 4. Run the example

Start the entity server and the UI dev server in separate terminals:

```bash
# Terminal 1 — entity server (registers the orchestrator with the agents server)
pnpm run dev:server

# Terminal 2 — Vite UI dev server
pnpm run dev:ui
```

The UI will be available at `http://localhost:5175`.

### Stopping

```bash
npx electric-ax agents stop
```

Add `--remove-volumes` to also delete persisted data.

### Local CLI

You can also use the dev CLI directly from the monorepo instead of `npx`:

```bash
node packages/electric-ax/bin/electric-dev.mjs agent quickstart
node packages/electric-ax/bin/electric-dev.mjs agent run
node packages/electric-ax/bin/electric-dev.mjs agent stop
```

## Tech Stack

| Layer             | Technology                                                    |
| ----------------- | ------------------------------------------------------------- |
| Agent runtime     | [@electric-ax/agents-runtime](../../packages/agents-runtime/) |
| LLM               | Claude (Anthropic API) and/or Kimi (Moonshot API)             |
| Web search        | Brave Search API                                              |
| Frontend          | React 19, Vite 7, TypeScript                                  |
| Real-time state   | TanStack DB, Durable Streams                                  |
| Visualization     | D3.js force simulation                                        |
| Schema validation | Zod 4                                                         |
| UI components     | Radix UI                                                      |

## Environment Variables

| Variable               | Default                  | Description                                                                                                  |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY`    | —                        | Anthropic API key. Uses Sonnet for coordinator and workers when Moonshot is absent                           |
| `MOONSHOT_API_KEY`     | —                        | Moonshot API key. Uses `kimi-k2.6`; when both keys are set, workers use Kimi and the coordinator uses Sonnet |
| `BRAVE_SEARCH_API_KEY` | —                        | Brave Search API key for web research                                                                        |
| `DARIX_URL`            | `http://localhost:4437`  | Electric Agents server URL                                                                                   |
| `PORT`                 | `4700`                   | Backend server port                                                                                          |
| `SERVE_URL`            | `http://localhost:$PORT` | Webhook callback URL for the agents server                                                                   |

## Project Structure

```
src/
├── server/
│   ├── index.ts          # HTTP server, API endpoints, entity registration
│   ├── orchestrator.ts   # Orchestrator entity: prompts, tools, spawn logic
│   ├── explorer.ts       # Explorer agent blueprint and spawn args
│   ├── survey-worker.ts  # Explorer worker entity and tool wiring
│   ├── shared-tools.ts   # Shared wiki/xref tools and web fetch/search tools
│   └── schema.ts         # Shared state Zod schemas (wiki + xrefs)
└── ui/
    ├── main.tsx           # App entry point, swarm lifecycle
    ├── swarm-theme.css    # Dark monospace theme
    ├── hooks/
    │   └── useSwarm.ts    # Real-time entity and shared state subscriptions
    └── components/
        ├── SwarmView.tsx       # Main 3-column layout
        ├── TopBar.tsx          # Status bar with counts
        ├── ChatSidebar.tsx     # Message history and input
        ├── SwarmGraph.tsx      # D3 force-directed graph
        ├── WikiColumn.tsx      # Knowledge base browser
        ├── StreamLog.tsx       # Live activity log
        ├── ActivityHeatmap.tsx  # Agent status grid
        └── AgentList.tsx       # Scrollable agent list
```
