# Quickstart Steps 5-8 Redesign

## Problem

The current quickstart (Horton's `/quickstart` skill) builds a perspectives analyzer in Steps 1-5, then abruptly switches to building an unrelated chatroom app in Steps 6-8. This context switch is confusing and doesn't reinforce what the user just built.

## Goal

Replace Steps 6-8 so the quickstart stays with the perspectives entity throughout. The user adds a React UI that lets them invoke the analyzer from the browser and see optimist/critic results side by side with a verdict — using the same entity they built in Steps 1-5.

## What stays the same

- **Steps 1-3:** Build the perspectives entity (minimal entity -> one worker -> two workers + state). No changes.
- **Step 4:** Test with CLI commands. No changes.
- **Step 5:** Wire up `server.ts` with the perspectives import. No changes.

## New Steps

### Step 6 — Server routes

**Concept:** Exposing entities via HTTP and using `createRuntimeServerClient()`.

Add a `POST /api/analyze` route to `server.ts` that:

1. Accepts `{ question: string }` in the request body
2. Generates a unique analysis ID (e.g., `analysis-<nanoid>`)
3. Uses `createRuntimeServerClient()` to spawn a `/perspectives/<id>` entity and send the question
4. Returns `{ entityUrl, optimistUrl, criticUrl }` — the child worker URLs are deterministic (`<id>-optimist`, `<id>-critic`)

The user tests with curl:

```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"question":"Is remote work better than office work?"}'
```

Then observes via CLI:

```bash
pnpm electric-agents observe /perspectives/analysis-abc123
```

**Key concepts taught:**

- `createRuntimeServerClient({ baseUrl })` — programmatic server-side client for the agent server
- HTTP routes as the bridge between a web app and agents
- Entity URLs are addressable — you can construct child URLs deterministically

**Files modified:** `server.ts` (add route + serve static files)

### Step 7 — React UI with live results

**Concept:** `createAgentsClient`, `client.observe(entity(url))`, `useLiveQuery` on `texts` collection.

Add a Vite + React frontend. The UI is a single page with:

**Layout:**

- Top: text input + "Analyze" button
- Middle: two columns side by side — "Optimist" and "Critic"
- Bottom: "Verdict" section

**Data flow:**

1. User types a question and clicks Analyze
2. Frontend POSTs to `/api/analyze` -> gets back `{ entityUrl, optimistUrl, criticUrl }`
3. Frontend calls `client.observe(entity(optimistUrl))` and `client.observe(entity(criticUrl))` to subscribe to each worker's stream
4. `useLiveQuery` on each entity's `texts` collection — columns show a loading indicator until text appears, then render the completed response
5. Frontend also calls `client.observe(entity(entityUrl))` — the verdict section shows the manager's synthesis once it appears

**Reactive, not polling:** The durable stream pushes updates to the browser via SSE. When a worker finishes and its `texts` collection updates, `useLiveQuery` triggers a re-render.

**Files created:**

- `ui/index.html` — HTML shell
- `ui/main.tsx` — React app with the analysis UI
- `vite.config.ts` — Vite config (root: `ui`, port 5175)

**Dependencies added:** `react`, `react-dom`, `@tanstack/db`, `@tanstack/react-db`, `@electric-ax/agents-runtime` (client side), plus dev deps `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`

**Key concepts taught:**

- `createAgentsClient({ baseUrl })` — connects frontend to agent server
- `client.observe(entity(url))` — subscribes to an entity's durable stream (SSE)
- `useLiveQuery` — reactive query that re-renders when collections change
- Entity streams have built-in collections (`texts`, `runs`, `toolCalls`, etc.) that the frontend can query

### Step 8 (optional) — Streaming responses

**Concept:** `textDeltas` collection for token-by-token streaming.

A small modification to Step 7. Instead of waiting for completed `texts`, subscribe to `textDeltas` to see responses stream in character-by-character.

**Changes from Step 7:**

- Subscribe to `textDeltas` collection instead of (or in addition to) `texts`
- Accumulate deltas by `text_id` to progressively build up the response text
- Each column shows text appearing incrementally as the worker generates tokens
- The verdict section streams the manager's synthesis the same way

This step is explicitly optional — the user can skip it if they just want the final results.

**Key concepts taught:**

- `textDeltas` collection — individual text chunks as they're generated
- Assembling deltas client-side for progressive rendering
- The difference between `texts` (completed blocks) and `textDeltas` (streaming chunks)

### Step 9 — Recap

Updated summary table:

| Step | Concept                 | API                                                                 |
| ---- | ----------------------- | ------------------------------------------------------------------- |
| 1    | Entity types & handlers | `registry.define()`, `ctx.useAgent()`, `ctx.agent.run()`            |
| 2    | Spawning children       | `ctx.spawn()`, `wake: 'runFinished'`                                |
| 3    | State collections       | `state: { children: { primaryKey: 'key' } }`                        |
| 6    | Server routes           | `createRuntimeServerClient()`, HTTP API                             |
| 7    | Live frontend           | `createAgentsClient`, `client.observe(entity(url))`, `useLiveQuery` |
| 8    | Streaming (optional)    | `textDeltas` collection, progressive rendering                      |

Pointer to the `agents-chat-starter` example for a complete multi-agent chat app with rooms, agent spawning, and a Slack-style UI.

## Scope boundaries

- No shared state (`ctx.mkdb`, `ctx.observe(db(...))`) — that's a separate concept better taught in its own tutorial or the chat starter
- No context assembly (`ctx.useContext`) — same reasoning
- No styling library (Radix, Tailwind) — inline styles only, keep deps minimal
- The perspectives entity code (Steps 1-3) is not modified — the UI works with whatever the user built earlier

## Relation to agents-playground example

The `examples/agents-playground/` app uses the same perspectives entity pattern. The quickstart teaches users to build it from scratch; the playground provides a ready-made version. They should stay aligned — same entity structure, same worker configuration (optimist + critic with `tools: ["bash", "read"]`).
