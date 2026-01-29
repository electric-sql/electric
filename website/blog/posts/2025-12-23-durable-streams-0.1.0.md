---
title: 'Durable Streams 0.1.0 and State Protocol'
description: >
  The first official npm release of Durable Streams, introducing the State Protocol for database-style sync semantics and early community experiments
excerpt: >
  The first official npm release of Durable Streams, introducing the State Protocol for database-style sync semantics, improved conformance tests and community experiments.
authors: [kyle, samwillis]
image: /img/blog/durable-streams-0.1.0/hero.png
tags: [durable-streams, sync, protocol]
outline: [2, 3]
post: true
---

<script setup>
import Tweet from 'vue-tweet'
</script>

Two weeks ago we [announced Durable Streams](https://electric-sql.com/blog/2025/12/09/announcing-durable-streams)—an open protocol for reliable, resumable streaming to client applications. The response has been fantastic: we're approaching 1,000 GitHub stars, and people are already building with it.

Today we're shipping **0.1.0 releases to npm**—the first official packages you can install and use in production. This post covers what's in the release, introduces the State Protocol for database-style sync semantics, and highlights some early experiments from the community.

## What's in 0.1.0

**npm packages:**

```bash
npm install @durable-streams/client   # TypeScript client
npm install @durable-streams/server   # Reference Node.js server
npm install @durable-streams/state    # State Protocol primitives
npm install @durable-streams/server-conformance-tests  # Server implementation validation
npm install @durable-streams/client-conformance-tests  # Client implementation validation
npm install @durable-streams/cli      # Development & testing tools
```

**Server implementations:**

- **Caddy-based server** — A production-ready binary built on Caddy for local development and light production workloads. Download from [GitHub releases](https://github.com/durable-streams/durable-streams/releases).

**Client libraries:**

- **TypeScript/JavaScript** — `@durable-streams/client` on npm
- **Go** — `github.com/durable-streams/durable-streams-go`
- **Python** — `pip install durable-streams`

**Conformance test improvements:**

The conformance test suite has grown significantly since launch:

- **124 server conformance tests** validating protocol compliance
- **110 client conformance tests**—entirely new since the announcement post

The client tests are particularly important. We've ported a substantial portion of the test suite from `@electric-sql/client`, which has been battle-tested over 18 months of production use in Electric. These tests cover:

- **Offset semantics**: monotonic offsets, byte-exact resumption without skips or duplicates, offset persistence across sessions
- **Retry behavior**: automatic retry on transient errors (500, 503, 429), respecting Retry-After headers, not retrying permanent errors (4xx)
- **Live streaming**: SSE and long-poll modes, receiving both existing and new data, proper timeout handling, up-to-date signals
- **Streaming equivalence**: verifying SSE and long-poll produce identical results for the same stream and offset
- **Message ordering**: strict order preservation across all read modes (catchup, long-poll, SSE)
- **Producer operations**: stream creation, data appending, batching, sequence ordering

Early feedback from implementers has been invaluable in tightening up the spec and removing ambiguity. Thanks to everyone who's been testing their implementations and reporting edge cases—this kind of community input makes the protocol stronger for everyone.

If you're building your own implementation, both test suites are available as `@durable-streams/server-conformance-tests` and `@durable-streams/client-conformance-tests`. Run them against your server or client to validate compatibility before shipping.

The conformance test suite validates that all implementations behave identically—same protocol, same semantics, your choice of language.

## Try It Out Now

The fastest way to see Durable Streams in action is with the server binary and curl.

**1. Download and run the server:**

Download the latest server binary for your platform from the [releases page](https://github.com/durable-streams/durable-streams/releases/latest).

Available builds: macOS (Intel & ARM), Linux (AMD64 & ARM64), Windows (AMD64).

Extract the archive and run:

```bash
./durable-streams-server dev
```

The server starts on `http://localhost:4437`.

**2. Create a stream:**

```bash
curl -X PUT http://localhost:4437/v1/stream/my-first-stream \
  -H 'Content-Type: text/plain'
```

**3. Append some data:**

```bash
curl -X POST http://localhost:4437/v1/stream/my-first-stream \
  -H 'Content-Type: text/plain' \
  -d 'Hello, Durable Streams!'
```

The response includes an `X-Offset` header—that's your position in the stream.

**4. Read the stream:**

```bash
curl http://localhost:4437/v1/stream/my-first-stream
```

**5. Watch it live:**

Open a terminal and start tailing with SSE:

```bash
curl -N http://localhost:4437/v1/stream/my-first-stream?offset=-1&live=sse
```

In another terminal, append more data:

```bash
curl -X POST http://localhost:4437/v1/stream/my-first-stream \
  -H 'Content-Type: text/plain' \
  -d 'This appears in real-time!'
```

Watch it appear instantly in your first terminal. That's durable streaming—ordered, resumable, and live.

## Introducing the State Protocol

In the announcement post, we described a composable ecosystem with Durable Streams as the foundation and higher-level protocols built on top. The **State Protocol** is the first of those higher-level protocols.

Like Durable Streams itself, the State Protocol is extracted from Electric's Postgres sync protocol—refined over 18 months of production use and now standardized as a standalone protocol that works over any durable stream.

Durable Streams gives you ordered, resumable byte delivery. The State Protocol adds semantic meaning: **insert**, **update**, and **delete** operations on typed entities. It's the vocabulary you need for database-style sync—presence tracking, chat rooms, feature flags, collaborative state—without prescribing how you store or query that state.

### The Shape of a Change Event

```typescript
{
  type: "user",           // Entity type (routes to collection)
  key: "user:123",        // Unique identifier
  value: {                // The entity data
    name: "Alice",
    email: "alice@example.com"
  },
  headers: {
    operation: "insert",  // insert | update | delete
    txid: "abc-123",      // Optional transaction ID
    timestamp: "2025-12-23T10:30:00Z"
  }
}
```

### Why Separate Protocols?

Separation means you can adopt what you need:

- **AI token streaming?** Use Durable Streams directly—you don't need insert/update/delete semantics for tokens.
- **Real-time database sync?** Add the State Protocol for typed collections with proper CRUD operations.
- **Both in the same app?** Different streams can use different protocols.

### Using the State Protocol

For basic use cases, `MaterializedState` gives you an in-memory key-value store that applies change events:

```typescript
import { MaterializedState } from "@durable-streams/state"

const state = new MaterializedState()

state.apply({
  type: "user",
  key: "1",
  value: { name: "Kyle" },
  headers: { operation: "insert" }
})

const user = state.get("user", "1")  // { name: "Kyle" }
```

For applications that need reactive queries, filtering, joins, and optimistic updates, `@durable-streams/state` integrates with [TanStack DB](/products/tanstack-db):

```typescript
import { createStateSchema, createStreamDB } from "@durable-streams/state"
import { useLiveQuery } from "@tanstack/react-db"
import { eq } from "@tanstack/db"

const schema = createStateSchema({
  users: {
    schema: userSchema, // Define your schema
    type: "user",
    primaryKey: "id"
  }
})

const db = createStreamDB({
  streamOptions: { url: streamUrl, contentType: "application/json" },
  state: schema
})

// Reactive query that updates automatically
const activeUsers = useLiveQuery((q) =>
  q.from({ users: db.collections.users })
   .where(({ users }) => eq(users.active, true))
)
```

TanStack DB uses differential dataflow under the hood, so queries recompute incrementally when data changes, which is dramatically faster than filtering in JavaScript.

The full State Protocol specification is available at [STATE-PROTOCOL.md](https://github.com/durable-streams/durable-streams/blob/main/packages/state/STATE-PROTOCOL.md).

## Community Experiments

The best part of launching has been seeing what people build. Here's what the community has been exploring:

### AI Agents and Workflows

The agent use case has resonated strongly. Nathan Flurry built an experimental integration combining [Durable Streams with Rivet Actors](https://www.rivet.dev/templates/experimental-durable-streams-ai-agent/)—actors as "the brains & memory" and Durable Streams as "the pipes":

<figure style="background: none">
  <Tweet tweet-id="1999512065682423861" conversation="none" theme="dark" />
</figure>

Kames has been building agent workflows with [Mastra](https://mastra.ai/) on top of Durable Streams:

<figure style="background: none">
  <Tweet tweet-id="2002776849563431422" conversation="none" theme="dark" />
</figure>

And the conceptual simplicity is clicking for people:

<figure style="background: none">
  <Tweet tweet-id="2003530703171195287" conversation="none" theme="dark" />
</figure>

<figure style="background: none">
  <Tweet tweet-id="2002666842633220168" conversation="none" theme="dark" />
</figure>

<figure style="background: none">
  <Tweet tweet-id="2002187469786083754" conversation="none" theme="dark" />
</figure>

### Resilient Streaming Demos

Sam Willis demonstrated multimodal GenAI streaming (text + audio) with reconnection—lose the connection, reconnect, and keep listening from exactly where you left off while the model keeps generating:

<figure style="background: none">
  <Tweet tweet-id="2002037670067806303" conversation="none" theme="dark" />
</figure>

Kyle built demos showing Durable Streams handling the Wikipedia events firehose with TanStack DB and real-time state sync:

<figure style="background: none">
  <Tweet tweet-id="2001304555267502499" conversation="none" theme="dark" />
</figure>

<figure style="background: none">
  <Tweet tweet-id="2000961535360032845" conversation="none" theme="dark" />
</figure>

### Integration Proposals

The [LiveStore](https://github.com/livestorejs/livestore) team opened [an issue proposing a sync provider](https://github.com/livestorejs/livestore/issues/944) to integrate Durable Streams with their SQLite-powered local-first framework. The discussion explores how the two projects' shared philosophy—append-only event logs, offset-based resumption, local-first architecture—could combine to give users CDN-friendly sync with structured event schemas and reactive UI bindings.

### The Protocol Advantage

People are noting the value of standardization over vendor lock-in:

<figure style="background: none">
  <Tweet tweet-id="1999960464990847380" conversation="none" theme="dark" />
</figure>

<figure style="background: none">
  <Tweet tweet-id="2001761793740513685" conversation="none" theme="dark" />
</figure>

Even the TanStack team is excited about the HTTP-native approach:

<figure style="background: none">
  <Tweet tweet-id="2002063260137500976" conversation="none" theme="dark" />
</figure>

And Nathan Flurry's making bold predictions:

<figure style="background: none">
  <Tweet tweet-id="1999217103589769245" conversation="none" theme="dark" />
</figure>

### New Implementations

The protocol is already attracting new implementations. [Ahimsa Labs released a Go client](https://github.com/ahimsalabs/durable-streams-go), and Evil Martians announced they're gradually adopting Durable Streams in [AnyCable](https://anycable.io/)—starting with implementing the read part of the protocol for consuming durable streams. Their post ["AnyCable, Rails, and the pitfalls of LLM-streaming"](https://evilmartians.com/chronicles/anycable-rails-and-the-pitfalls-of-llm-streaming) explores the exact reliability challenges Durable Streams solves.

<figure style="background: none">
  <Tweet tweet-id="2001719297651998841" conversation="none" theme="dark" />
</figure>

Valter Balegas built a [Yjs provider for Durable Streams](https://github.com/durable-streams/durable-streams/pull/81)—bringing real-time collaborative editing with conflict-free sync semantics to the protocol. The provider includes awareness/presence support and a demo application showcasing collaborative text editing with colored cursors.

## What's Next

- **Hosted cloud version**: We're building our own cloud implementation of Durable Streams, launching in January 2026.
- **More language implementations**: The protocol is designed to have many implementations. We'd love to see servers and clients in Rust, Java, Swift, and more.
- **Database adapters**: Postgres, MySQL, and SQLite adapters using the State Protocol—streaming database changes to clients with proper sync semantics.
- **Electric 2.0**: This is all foundational work for the next version of Electric.

## Get Started

**Install the packages:**

```bash
npm install @durable-streams/client @durable-streams/state
```

**Or use your language of choice:**

```bash
go get github.com/durable-streams/durable-streams-go
pip install durable-streams
```

If you're building a server implementation, the conformance test suite will validate compatibility.

Join us in [Discord](https://discord.electric-sql.com) to share what you're building.
