---
title: Building real-time collaborative CAD with Electric and Durable Streams
description: How ElectricSQL and Durable Streams enabled building a parametric CAD editor with real-time collaboration and AI integration—without fighting infrastructure.
excerpt: Most sync solutions force you to pick one state model and contort everything else to fit. That breaks down fast when building complex apps. Here's how using different substrates for different kinds of state, ElectricSQL and Durable Streams, let me focus on CAD problems instead of infrastructure fights.
authors: [samwillis]
image: /img/blog/building-real-time-collaborative-cad-with-electric-and-durable-streams/header.jpg
imageWidth: 1536
imageHeight: 1024
tags: [agents, collaboration, durable-streams, tanstack-db, CAD, AI, LLMs]
outline: [2, 3]
post: true
date: 2026-01-21
---

In my [previous post](./2026-01-19-from-science-finction-to-reality-you-can-build-difficult-things-now.md), I described building a parametric CAD editor with LLMs in about a week. This post is about the infrastructure choices that made that possible — and why they matter if you're building complex, collaborative, AI-integrated applications.

The short version is that I wanted the "hard parts" to be CAD-specific (geometry, constraints, rebuild stability), not infrastructure fights. The stack needed to handle multi-user state, real-time sync, durable AI sessions, and concurrent edits—while getting out of the way so I could focus on the actual application.

The solution was using different sync primitives for different kinds of state. ElectricSQL for relational data, Durable Streams for collaborative documents and sessions. Let each substrate do what it's good at instead of forcing everything through one model.

It worked. Here's how.

## The problem: CAD has genuinely different kinds of state

CAD exposes a stress test for sync infrastructure because it has multiple kinds of state with fundamentally different requirements:

**Structured app data** (workspaces, projects, permissions):

- Relational shape — references, joins, constraints
- Query-driven: "show me all projects in this workspace"
- Needs transactions and referential integrity
- Changes are discrete events

**The CAD model itself**:

- Hierarchical and deeply nested (feature tree, sketches, constraints)
- High edit frequency with fine-grained changes
- Needs offline-first, conflict-free merging
- Multiple users editing simultaneously
- Undo/redo across the full model

**Collaborative state** (presence, cursors, AI sessions):

- Needs durability but you don't care about full history
- Per-user, per-session
- High frequency, transient updates
- Must survive reconnections

Most sync solutions force you to pick one model and contort everything else to fit. That's fine for simple apps. It breaks down when you have genuinely different state shapes with different consistency requirements.

## How it actually works: the full loop

Before diving into architecture, here's what happens when you draw a line in SolidType:

1. **User draws a line** in the browser → updates local Yjs document
1. **Yjs produces an update** (CRDT change) → DurableStreamsProvider appends it to document stream
1. **Stream appends the event** → returns monotonic offset to client
1. **Other connected clients tail the stream** → receive the same Yjs update
1. **Each client merges the update** → Yjs CRDT handles conflict-free merge
1. **Local rebuild triggers** → OpenCascade kernel regenerates geometry
1. **Presence updates** → cursor position flows through awareness stream
1. **AI tool call?** → writes the same kind of Yjs edits, same merge semantics

The critical insight: **the stream is the coordination layer**. Everyone (humans, AI, multiple tabs) tails the same append-only log with Yjs handling merging the changes and the kernel handling geometry. No custom sync protocol, and no special-casing AI.

```
  User A ───┐
            ├──► Yjs Update ──► Stream ──┬──► User B (tails)
AI Agent ───┘                            ├──► User A Tab 2 (tails)
                                         └──► AI Worker (tails)
                                                  ↓
                                          All clients merge
                                          All clients rebuild
```

This architecture unlocks the ability to add additional clients, tabs, or AI agents without changing the coordination mechanism.

## The two-substrate pattern

This isn't a novel idea, it's the same pattern that Figma proved at scale years ago.

Figma runs [two separate sync systems](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/): a custom CRDT-inspired protocol for live document editing, and [LiveGraph](https://www.figma.com/blog/livegraph-real-time-data-at-scale/) for structured relational data (teams, projects, permissions). As [Slava Kim notes](https://x.com/imslavko/status/1890482196697186309), these systems have completely different implementations because they solve different problems with different tradeoffs around performance, offline availability, and security.

The lesson: **different kinds of state want different sync primitives**. Don't force everything into one model.

SolidType uses the same approach: **ElectricSQL** with Postgres for relational app state, **Durable Streams** for document and session state. Two different substrate in the same application, but with clean boundaries of responsibility.

## Substrate 1: ElectricSQL + TanStack DB for relational data

**What lives here:**

- Workspaces, projects, metadata
- User accounts, permissions, teams
- File/folder tree structure
- Project settings and configuration

**Why this substrate:**

This is fundamentally relational data. You want to query it ("all projects where user has write access"), maintain referential integrity (deleting a workspace cascades to its projects), and have transactions (creating a project + initial permissions happens atomically).

Postgres gives you all of this. ElectricSQL syncs it into the browser where TanStack DB makes it queryable.

**How it works:**

[TanStack DB](https://tanstack.com/db/latest) is an embedded client database built on TanStack Query's data synchronization architecture. Instead of being a separate database engine like SQLite, it's a queryable collection system that stores data in browser memory.

[ElectricSQL](https://electric-sql.com) provides the sync layer—it streams Postgres changes into the browser and keeps TanStack DB collections up to date. When you define a "shape" (a query pattern like "all projects in this workspace"), Electric maintains a live subscription to matching rows and automatically updates your local collections.

**Securing shapes with subqueries:**

For authorisation or data access, SolidType uses Electric's support for subqueries in where clauses. This allows shape definitions to span multiple tables and validate permissions at the shape level - these define the visible boundary that a user can access.

The pattern: shapes are proxied through TanStack Start server routes where the user's authentication context is applied. The where clause can reference related tables to enforce access control—for example, "only sync projects where the user is a member of the workspace."

**The code:**

The server route handles authentication and applies the permission filter:

```typescript
export const Route = createFileRoute("/api/shapes/projects/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await requireAuth(request);
        return projectsProxy(request, session.user.id);
      },
    },
  },
});
```

The `projectsProxy` function (defined in `electric-proxy.ts`) builds the WHERE clause with a subquery:

```typescript
export const projectsProxy = createElectricProxy("projects", (userId) => {
  return {
    where: `
      workspace_id IN
        (SELECT workspace_id FROM workspace_members WHERE user_id = $1)
    `,
    params: [userId],
  };
});
```

On the client side, collections read from these secured server routes and define mutation handlers:

```typescript
export const projectsCollection = createCollection(
  electricCollectionOptions({
    id: "projects",
    schema: projectSchema,
    getKey: (row) => row.id,
    shapeOptions: {
      url: `${getApiBase()}/api/shapes/projects`,
    },
    onInsert: async ({ transaction }) => {
      // When creating a project locally, sync it to the server
      const newProject = transaction.mutations[0].modified;
      const { txid } = await createProjectServerFn({
        // TanStack Start server function handles validation & DB write
        data: {
          workspaceId: newProject.workspace_id,
          name: newProject.name,
          description: newProject.description ?? undefined,
        },
      });
      return { txid };
    },
  })
);
```

**The mutation path:**

While reads come through Electric's real-time sync, writes go through **TanStack Start server functions**. This enables:

- Server-side validation (don't trust client input)
- Complex business logic (workspace quotas, cascade creates)
- Transactional writes (create project + initial permissions atomically)
- Audit logging (easy to hook in on the server side)

After a server function completes the write to Postgres, Electric picks up the change and syncs it back to all connected clients—including the client that initiated the mutation. This ensures consistency: the client sees the authoritative server result, not just its optimistic local change.

Once the collection is defined, components can query it with live updates:

```typescript
// Query projects with dynamic sorting
const { data: allProjects, isLoading: projectsLoading } = useLiveQuery(() => {
  return createCollection(
    liveQueryCollectionOptions({
      query: (q) => {
        return q
          .from({ projects: projectsCollection })
          .orderBy(({ projects: p }) => p[sortByProp], "desc");
      },
    })
  );
}, [sortByProp]);
```

**Query-driven sync with on-demand collections:**

SolidType uses "on-demand" collections to implement query-driven sync—only syncing the data that's actually needed by the UI. When a component renders with a useLiveQuery that filters the collection, Electric can sync only the matching subset rather than the entire dataset.

With `syncMode: 'on-demand'`, the query itself drives the sync layer. When a component renders with a filtered `useLiveQuery`, TanStack DB pushes the WHERE clause filter to Electric, which then makes an API call with the filter parameters included in the shape definition—syncing only the matching subset:

```typescript
// Example: Only sync branches for a specific project
export const projectBranchesCollection = createCollection(
  electricCollectionOptions({
    id: "project-branches",
    schema: branchSchema,
    getKey: (row) => row.id,
    syncMode: 'on-demand', // Query filter is pushed to the sync layer
    shapeOptions: {
      url: `${getApiBase()}/api/shapes/branches`,
      parser: electricParser,
    },
  })
);

// In a component, the filtered query drives what gets synced:
const { data: branches } = useLiveQuery(() => {
  return createCollection(
    liveQueryCollectionOptions({
      query: (q) =>
        q
          .from({ branches: projectBranchesCollection })
          .where(({ branches: b }) => eq(b.project_id, projectId))
          .orderBy(({ branches: b }) => b.is_main, "desc"),
    })
  );
}, [projectId]);
```

When this component renders, TanStack DB's on-demand mode pushes the WHERE clause filter to Electric. Electric then makes an API call with `project_id` in the shape definition, syncing only branches for that specific project rather than all branches.

**What this gets you:**

- Standard SQL schema in Postgres (migrations, constraints, the full toolbox)
- Permission validation at the shape level using subqueries
- Electric streams only authorized data into the browser
- TanStack DB provides reactive, queryable collections
- Reads are instant (in-memory), writes go through validated server functions
- Query-driven sync—only sync what the UI actually needs
- No separate database engine

Performance: Reads are instant (in-memory collections), writes are one round-trip to Postgres. In local development with small workspaces (~50 projects), initial sync takes sub-second, incremental updates are in the tens of milliseconds, and optimistic updates easily within a single frame.

**Why this matters:** Traditional local-first approaches require running a full database engine (like SQLite) in the browser via WebAssembly. TanStack DB takes a different approach — it's an incremental query layer over synchronised in-memory collections. This means less overhead, better integration with React's data flow, and a more familiar development model.

The combination works because:

- **Postgres** is the authoritative source (transactions, constraints, business logic)
- **ElectricSQL** handles real-time sync (change streaming, conflict-free replication)
- **TanStack DB** makes synced data queryable (filtering, sorting, relations)
- **TanStack Start server routes** enforce permissions via subqueries in shape definitions
- **TanStack Start server functions** handle validated mutations with complex business logic

## Substrate 2: Durable Streams for documents and sessions

[Durable Streams](https://electric-sql.com/blog/2025/12/09/announcing-durable-streams) is an open protocol for reliable, resumable streaming over HTTP that we extracted from our Postgres sync engine and standardised as a standalone primitive.

The core idea is that **streams are first-class primitives with their own URL**. Each stream is an addressable, append-only log that clients can read from using opaque, monotonic offsets. When a connection drops, clients resume by requesting "everything after offset X" — there is no per-client session state on the server.

**What lives here:**

- The CAD model itself (as a Yjs document)
- User presence (cursors, viewports, selections)
- AI sessions (messages, tool calls, results)
- Follow-mode state (viewport updates)

**Why this substrate:**

These are all append-only event logs. They need to be resumable (reconnect and pick up where you left off), fan out to multiple clients, and support multiple concurrent writers.

Traditional document sync is usually:

1. WebSocket connection to server
1. Server holds document state in memory
1. Server broadcasts changes
1. If server restarts, everyone reconnects and resyncs

This breaks down when:

- The server restarts (everyone loses in-flight state)
- You want to inspect what happened (no durable history)
- You want multiple servers (where does doc state live?)
- You want AI agents as peers (they need the same resumable interface)

Durable Streams changes the model:

- The stream _is_ the source of truth
- Clients (human or AI) tail the stream
- Disconnect? Resume from where you left off
- Multiple tabs/processes can subscribe to the same stream
- You have a complete audit log

**Where complexity lives:**

| Approach | Server complexity | Client complexity | Recovery story | Observability |
| --- | --- | --- | --- | --- |
| WebSocket broadcast | Low | Medium | Reconnect = full resync | None (ephemeral) |
| Operational Transform | High (OT logic) | High (OT logic) | Complex | Possible |
| Traditional CRDT sync | Medium | Medium | Varies by provider | Varies |
| **Durable Streams + Yjs** | Low (append log) | Low (Yjs) | Resume from offset | Built-in (event log) |

The table isn't claiming Durable Streams is "simpler" than all alternatives—it's highlighting where complexity lives. With this approach, the server is simple (append events, serve from offset), the client handles CRDT merging (Yjs does the work), and recovery is straightforward (resume from last offset).

**Security boundary:** Stream authentication uses the same authentication as the rest of your app. The server validates append operations—a rogue client can't corrupt the stream because the server checks that Yjs updates are well-formed before appending. For AI events, tool execution happens in a controlled environment (main thread, SharedWorker or server-side) rather than trusting client-generated tool results.

## The CAD model: Yjs + Durable Streams

The CAD model is a Yjs document. Yjs gives you CRDT-based merging (concurrent edits just work), fine-grained change tracking, and undo/redo that works across distributed edits.

Durable Streams gives you a durable event log for Yjs updates, resumable subscriptions, multi-tab coordination, and observable history.

```typescript
const ydoc = new Y.Doc();
const awareness = new Awareness(ydoc);

const provider = new DurableStreamsProvider({
  doc: ydoc,
  documentStream: { url: `/api/docs/${documentId}/stream` },
  awarenessStream: { url: `/api/docs/${documentId}/awareness`, protocol: awareness },
});

provider.connect();

// Access the CAD model
const root = ydoc.getMap("root");
const features = root.get("featuresById");

// Observe changes
features.observe((event) => {
  // UI updates go here
});

// Make changes (automatically synced)
const sketch = new Y.Map();
sketch.set("id", "sk-123");
sketch.set("type", "sketch");
features.set("sk-123", sketch);
```

**The key decision:** Yjs document is the single source of truth. Everything else is a derived representation. This decision unlocked the rest of the project. One authoritative model means collaboration "just works" (Yjs merges), undo/redo is coherent (Yjs history), and AI edits the same model humans edit (same operations, same constraints).

## Collaboration features: same primitive, different uses

Once you have Durable Streams as infrastructure, collaboration features stop being special cases. They're all just different uses of the same append-only log primitive.

**Presence:**

Each user publishes cursor positions, viewport state, and current selection to the awareness stream. All connected clients tail the stream. Updates are transient but the stream is durable—survive reconnects, coordinate across tabs.

```typescript
awareness.setLocalState({
  user: { id: currentUser.id, name: currentUser.name, color: assignedColor },
  cursor: { x: 100, y: 200 },
  viewport: { center: [0, 0, 0], zoom: 1.0 },
  selection: { type: "face", featureId: "e-123" },
});

awareness.on("change", ({ added, updated, removed }) => {
  // Render/update/remove user cursors
});
```

**Follow mode:**

Follower subscribes to leader's viewport updates from the same presence stream. When the leader's viewport changes, camera state is applied locally with smooth animation.

```typescript
awareness.on("change", ({ updated }) => {
  if (!followingUserId) return;
  const state = findUserState(followingUserId);
  if (state?.viewport) animateCameraTo(state.viewport);
});
```

**Why this is trivial:** It's the same presence stream. You're just choosing to react to a specific user's viewport events.

## AI sessions as durable streams

This is where the architecture really pays off.

Traditional AI integration looks like:

- User types a message
- Frontend sends to backend API
- Backend calls LLM, streams response
- Frontend renders

This breaks when:

- User closes the tab (session lost)
- Connection drops mid-response (can't resume)
- You want to show AI activity to other users (where does state live?)
- AI uses tools that take time (long-running operations)

**In SolidType, an AI session is a Durable Stream.**

The session is stored using the [State Protocol](https://electric-sql.com/blog/2025/12/23/durable-streams-0.1.0#introducing-the-state-protocol)—a composable schema for structured state changes over streams. Similar to how a database schema defines tables and relationships, the State Protocol defines collections for event logs. In SolidType's AI sessions, we define collections for messages, chunks (streaming text deltas), and tool execution runs:

```typescript
// Define the state schema
const chatStateSchema = createStateSchema({
  messages: { schema: messageSchema, primaryKey: "id" },
  chunks: { schema: chunkSchema, primaryKey: "id" },
  runs: { schema: runSchema, primaryKey: "id" },
});

// Connect to the stream
const streamDb = createStreamDB({
  schema: chatStateSchema,
  streamUrl: `/api/ai/sessions/${sessionId}/stream`,
});

await streamDb.connect();

// Collections are now live-updating
const { messages, chunks, runs } = streamDb.collections;
```

What this gets you:

1. **Resumable sessions:** Close the tab, reopen, tail the stream from where you left off
1. **Multi-tab:** All tabs see the same session state
1. **Multi-user:** Other users can observe the AI session (collaborative AI)
1. **Debuggable:** Full event history, can replay exactly what happened
1. **Tool execution anywhere:** Because the session is a stream, tools can execute client-side, server-side, or hybrid—without changing the session model

The full pattern is documented in our [Durable Sessions for Collaborative AI](https://electric-sql.com/blog/2026/01/12/durable-sessions-for-collaborative-ai) post.

**AI orchestration in a SharedWorker:**

SolidType runs AI orchestration in a SharedWorker for a CAD-specific reason: loading OpenCascade WASM is expensive (1-2 seconds), so we load it once and keep it alive across tab closes. But this is an implementation choice—because the session is a Durable Stream, tools could just as easily execute server-side, and the session would work the same way.

```typescript
// Worker initializes kernel once (shared across tabs)
const kernel = await initOpenCascade();
const ydoc = new Y.Doc(); // CAD model

// Subscribe to the AI session stream
const streamDb = createStreamDB({
  streamUrl: `/api/ai/sessions/${sessionId}/stream`,
});

// When AI calls tools, execute against local Yjs document
```

**AI tools operate on the same model:**

AI tools directly manipulate the Yjs document. There's no separate "AI API"—the AI calls functions that edit the same model humans edit.

Example tools:

- Sketch: `addLine`, `addCircle`, `addConstraint`
- 3D: `createExtrude`, `createRevolve`, `createFillet`
- Query: `getCurrentSelection`, `getModelContext`, `measureDistance`

Here's how a tool implementation looks:

```typescript
function createExtrude(args) {
  // Create extrude feature in Yjs document
  const featureId = createFeature(ydoc, {
    type: "extrude",
    sketch: args.sketchId,
    distance: args.distance,
    op: args.op, // "add" or "cut"
  });
  
  return { featureId };
}
```

The key: AI tools use the same helper functions (`createFeature`, `addPointToSketch`) that the UI uses. Changes flow through Yjs, trigger rebuild, sync to all clients.

**Client UI subscribing to the stream:**

```typescript
function ChatUI({ sessionId }) {
  const streamDb = createStreamDB({
    streamUrl: `/api/ai/sessions/${sessionId}/stream`,
  });
  
  // Live queries auto-update when new events arrive
  const messages = useLiveQuery(() => streamDb.collections.messages);
  
  // Render updates automatically as AI streams
  return <MessageList messages={messages} />;
}
```

Close the tab, reopen—you resume from the last offset and see the full history. All tabs see identical state.

**Multi-user AI sessions:**

Because AI sessions are streams, they naturally support multiple users:

- User A starts an AI session
- User B joins the project
- User B sees the AI session in progress
- User B can send messages to the same session
- Both users see all events in real-time

This "just works" because the stream is the source of truth, both users tail the same stream, and the Yjs document handles concurrent edits.

**Concrete example:**

- **User A** (San Francisco): "Create a box 10x10x10mm"
- AI creates sketch, extrudes (edits go into Yjs document)
- **User B** (London) sees the box appear in real-time
- **User B** (same AI session): "Add a fillet to all edges, radius 2mm"
- AI reads current model state, applies fillet
- **User A** sees the fillet appear
- Both see full chat history (same Durable Stream)

No merge conflicts because:

- AI reads the current merged Yjs state
- AI writes to the same Yjs document (which handles merging)
- Chat history is append-only (no conflicts possible)

## The key architectural insight: the agent is another user

Once you have this architecture, a useful property emerges: **the AI agent looks like another user**.

It connects to the same streams, edits the same Yjs document, sees the same presence, and operates within the same constraints.

This matters because:

- You don't need separate "AI state" vs "user state"
- Collaboration primitives (undo, history, merge) work for AI edits
- Multi-user + AI "just composes"
- Your conflict resolution, rebuild logic, and validation run the same way

**Example feature tree (interleaved human + AI edits):**

```
Feature Tree:
├─ Sketch 1 (human: drew rectangle)
│   └─ Constraints (AI: added horizontal, vertical, equal length)
├─ Extrude 1 (human: extruded 10mm)
├─ Sketch 2 (AI: created circle on top face)
├─ Cut 1 (AI: cut through)
└─ Fillet 1 (human: added 2mm fillet)
```

The system doesn't care who initiated each feature. Undo/redo work across human and AI edits. The rebuild system doesn't care about edit provenance. History is a pure sequence of model changes.

This is the payoff of treating infrastructure as a shared coordination layer rather than building separate paths for humans and AI.

## Why this stack worked for agents

Agents are strongest when they're copying well-known patterns. I biased the stack toward boring primitives: SQL schemas, established libraries, and those that are new used well known patterns (Tanstack DB having a query builder modeled on Drizzle). The agents didn't need to "learn" exotic patterns—they recognized standard approaches and applied them correctly. Contrast this with custom binary protocols (would need extensive explanation), novel state sync algorithms (would get the details wrong), or bespoke APIs (would hallucinate methods).

## What having solid infrastructure actually enabled

Having reliable sync infrastructure meant I could focus 100% on CAD-specific problems without fighting glue code.

**Sketch constraint solver:** Implements geometric constraints using Levenberg-Marquardt algorithm—a hybrid of Gauss-Newton and gradient descent. The solver runs interactively as users drag geometry, typically converging in <50ms for sketches with dozens of constraints. This is a classic constraint satisfaction problem—the infrastructure didn't solve it, but having reliable state sync meant I could test it properly and not worry about whether solver output would corrupt on merge.

**Topological naming:** Maintaining stable references to geometric elements (faces, edges, vertices) across model rebuilds. When you fillet an edge, then modify the sketch that created that edge, the system needs to know which edge you meant. The current system uses construction history-based naming similar to FreeCAD's toponaming branch.

**Parametric rebuild orchestration:** The feature tree is a dependency graph. Change a parameter, invalidate dependents, rebuild in topological order, propagate errors, update visualization incrementally. Uses dirty flag propagation to avoid redundant kernel operations. Collaboration adds complexity—when multiple users edit simultaneously, you merge Yjs changes, then trigger a rebuild that respects the merged state.

These problems are orthogonal to sync infrastructure. But having that infrastructure work reliably meant I could focus on CAD correctness rather than debugging whether a constraint solver failure was a math error or a merge conflict.

## What this means for you

If you're building something similar—real-time collaborative apps, AI-integrated tools, or anything with genuinely complex state—the pattern holds.

**Don't fight your state model.** Relational data wants a database. Documents plays well with CRDTs. AI sessions need append-only logs. Split your state intentionally rather than forcing everything into one sync primitive.

**Append-only logs compose surprisingly well.** Once Durable Streams was in place for the CAD document, adding presence, AI sessions, and follow mode were all trivial—just different uses of the same coordination mechanism.

**Agents work best with boring technology.** LLMs are pattern-matching machines trained on public code. Standard SQL schemas, standard async patterns, established libraries—all heavily represented in training data. Exotic patterns create friction. Boring patterns compound capability.

**Client-side state is about more than offline.** Having data local to the browser means instant reads, agent execution close to the UI, and better scale. When AI tools need sub-50ms feedback loops to feel responsive, local execution isn't optional—it's the only way to hit the performance target.

CAD is a stress test. If the stack can handle parametric geometry, real-time collaboration, and AI tool execution without constant friction, it can probably handle your application too. This was also a deliberate dogfooding exercise—living in the shoes of an Electric and Durable Streams user. The infrastructure got out of the way rather than becoming the bottleneck, which validated the approach.

The code is open source: [github.com/samwillis/solidtype](https://github.com/samwillis/solidtype)

The full stack:

- [ElectricSQL](https://electric-sql.com) — Postgres sync to browser
- [TanStack DB](https://tanstack.com/db) — Queryable collections
- [Durable Streams](https://github.com/durable-streams/durable-streams) — Resumable event logs
- [Yjs](https://yjs.dev) — CRDT document merging
- [opencascade.js](https://ocjs.org) — Geometry kernel
- [Three.js](https://threejs.org) — 3D rendering of models
- [TanStack Start](https://tanstack.com/start/latest) — General framework and routing (server and client) 
- [TanStack AI](https://tanstack.com/ai/latest) — AI interatction, main loop and tool calling
- [Base UI](http://base-ui.com) — UI component library
- [Better Auth](https://www.better-auth.com) — Authentication tooling

If you're building complex, stateful, multi-user applications in 2026, these primitives are worth understanding. Not because they're novel—because they get out of the way.
