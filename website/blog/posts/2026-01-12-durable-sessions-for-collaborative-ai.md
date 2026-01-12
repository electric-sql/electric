---
title: Durable Sessions — the key pattern for collaborative AI
description: >
  This post introduces the Durable Session pattern for building collaborative AI apps with Durable Streams and TanStack DB.
excerpt: >
  As the world moves to getting things done through agents, the winners are going to be the products that combine AI with team-based collaboration. Building AI apps on a Durable Session architecture is the best way to do that.
authors: [thruflo]
image: /img/blog/durable-sessions-for-collaborative-ai/header.jpg
imageWidth: 1536
imageHeight: 947
tags: [agents, collaboration, durable-streams, tanstack-db]
outline: [2, 3]
post: true
---

<script setup>
import Tweet from 'vue-tweet'

import RequestResponse from '/static/img/blog/durable-sessions-for-collaborative-ai/request-response.jpg?url'
import RequestResponseSmall from '/static/img/blog/durable-sessions-for-collaborative-ai/request-response.sm.jpg?url'

import SyncBased from '/static/img/blog/durable-sessions-for-collaborative-ai/sync-based-architecture.jpg?url'
import SyncBasedSmall from '/static/img/blog/durable-sessions-for-collaborative-ai/sync-based-architecture.sm.jpg?url'
</script>

<style scoped>
  figure {
    margin: 24px 0 !important;
    border-radius: 14px !important;
    overflow: hidden;
  }
  .embed-container {
    margin: 24px 0;
    border-radius: 2px;
    overflow: hidden;
  }
  .embed-container.top {
    margin: 32px 0 -12px 0;
  }
</style>

As the world moves to getting things done through agents, the winners are going to be the products that integrate AI with team-based collaboration.

A Durable Session is a state management pattern that naturally makes AI and agentic apps collaborative.

This post introduces the [Durable Session pattern](#durable-session-pattern) and shows how you can implement it using [Durable Streams](https://github.com/durable-streams/durable-streams) and [TanStack DB](https://tanstack.com/db).

> [!Warning] 🤝 ✨ Durable Sessions demo
> See the TanStack AI - Durable Sessions [demo video](https://youtu.be/81KXwxld7dw) and [source code](https://github.com/electric-sql/transport).

<div class="embed-container top" style="padding-bottom: 62.283737%">
  <YoutubeEmbed video-id="81KXwxld7dw" />
</div>

## Getting things done with agents

When I sit down to get something done, I increasingly reach for an agent. Not because they're magic or perfect but because, on balance, they boost my productivity.

For me, as a technical startup founder, adapting to this new reality is a challenge. I spent the last 20 years developing craft skills that are now being, somehow, both amplified and commoditized at the same time.

<figure>
  <Tweet tweet-id="2004646160200511615"
      align="center"
      conversation="none"
      theme="dark"
  />
</figure>

For people with less technical craft skills or who are less used to adaptation, the challenge to evolve is even harder. For companies, made up of normal people working in legacy management structures, the challenge is existential.

Teams, departments, whole industries &mdash; [why do they even exist](https://x.com/justjake/status/2009459155913044354) any more?

### Right place, right time

As a software engineer and a product builder, if you've ever wanted to be in the right place at the right time, you are right now.

You have the opportunity to disrupt and replace whole swathes of previous-generation software. Right as the market is expanding wildly, as software eats into the rump of white-collar payroll spend.

### Cracking the enterprise

It's a massive economic shift, with massive customers feeling massive pain.

If you can serve their transformation, as they scramble to up-skill and transform their workforce, there's no limit to what you can achieve.

However, if you build on a single user paradigm, it's not going to cut it. You're not going to win the procurement battle. You're not going to land and expand. You're not going to benefit from product-led growth.

> <em>&ldquo;Today, AI works impressively for individuals but disappointingly for organizations. Closing that gap requires not just more context, but treating agents as social participants in the multiplayer systems they aim to disrupt.&rdquo;</em><br />
> <small>&mdash; [Collaborative Intelligence](https://x.com/nayakkayak/status/2009660549554913574), Aatish Nayak - Product @ Scale AI, Harvey</small>

Instead, to crack the enterprise, you need to support the same kind of team-based collaboration that the software you're replacing was based on. That means people working together on agentic sessions.

### With collaborative AI

At the micro-level it's shared sessions, collaborative prompt editing and multi-user token streams. At the mid-level it's audit logs and history. Compliance departments reviewing context and artifacts.

At the macro-level it's weaving your software into the fabric of the enterprise. As the research, the planning, the prompts, the sessions and the outputs get threaded into the collaboration, management, reporting, access control and governance processes that the enterprise runs on.

But how do you build and adapt AI and agentic products to support this kind of collaboration? How do you unlock this level of adoption?

## Moving beyond single-user

You need to move beyond the default single‑user <> single‑agent interaction paradigm of today's AI SDKs. To a multi‑user <> multi‑agent paradigm that naturally supports both real-time and asynchronous collaboration.

### Evolving the interaction paradigm

The default paradigm of most AI SDKs, like the [Vercel AI SDK](https://ai-sdk.dev/docs/introduction) and [TanStack AI](https://tanstack.com/ai), is single‑user <> single‑agent.

You have a chat interface with a `sendMessage` action:

```tsx
const { messages, sendMessage } = useChat({...})
```

When the user types their prompt and hits enter, you call `sendMessage`, it adds the message to some local state and then blocks the UI whilst it makes an API request to a backend endpoint. That constructs an LLM instruction request and streams the response back to the client.

```tsx
async function POST(req: Request) {
  const { messages } = await req.json()

  const result = streamText({
    model: openai(`gpt-4o`),
    prompt: convertToModelMessages(messages),
    abortSignal: req.signal,
  })

  return result.toUIMessageStreamResponse()
}
```

The client then consumes the response stream, writes out the agent response one chunk at a time and unblocks the chat thread once the active generation is finished.

<figure>
  <img :src="RequestResponse" class="hidden-sm" />
  <img :src="RequestResponseSmall" class="block-sm" />
</figure>

The whole flow is designed around request <> response. The request is a single user message and the response is a single assistant message.

### Support for collaboration

This fails to support collaboration in so many ways. The local message state isn't shared, so it doesn't sync across users/tabs/devices. The request response model (and blocking the UI) assumes there’s only one user waiting on a response from a one agent.

What we need instead is an interaction paradigm that doesn't bake in this single user <> single agent assumption. That allows multiple users to work in multiple tabs and devices, collaborating with other users and agents on the same session in real-time. So users can join the session half way through and other users can go back to it later.

### Persistence and addressability

That means the session needs to be persistent and addressable.

This is generally left up to application developers. If you want multiple users to join the same session or multiple agents to register with it, you have to dig into application-specific routing, storage and authentication.

For example, the Vercel AI SDK [`useChat` hook](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat#messages) returns a `setMessages` function you can use to populate the chat thread:

```tsx
export default function Chat({ sessionId }) {
  const { messages, sendMessage, setMessages } = useChat({
    id: sessionId
  })

  useEffect(() => {
    somehow
      .fetchMessageHistory(sessionId)
      .then(setMessages)
  }, [sessionId, setMessages])

  // ...
}
```

How you use that `sessionId` to fetch the message history is up to you. How other processes or apps find, consume and subscribe to it is up to you.

Whereas what's needed is a ***standard protocol*** for persistence and addressability of streams and sessions. So initial message hydration is taken care of and external software can plug-in, audit, monitor and integrate (in the same way that today's enterprise systems monitor and audit web service APIs).

## Composable sync primitives

That's what we've been building at Electric. A suite of composable sync primitives that give you durable state that's persistent, addressable and subscribable, including:

- [Electric sync](#electric-sync)
- [Durable Streams](#durable-streams)
- [TanStack DB](#tanstack-db)

### Electric sync

Our core product is the [Electric sync engine](https://electric-sql.com).

Electric syncs data out of Postgres into client apps, handling partial replication and fan out. Using an [HTTP-based sync protocol](/docs/api/http) that scales out data delivery through existing CDN infrastructure.

### Durable Streams

We've now generalized the Electric sync protocol into [Durable Streams](https://github.com/durable-streams/durable-streams).

This is a lower-level binary streaming protocol that supports more use cases, like token streaming, real-time presence and multi-modal binary data frames.

### TanStack DB

[TanStack&nbsp;DB](https://tanstack.com/db) is a lightweight, reactive client store with:

1. [collections](https://tanstack.com/db/latest/docs/overview#defining-collections) a unified data layer to load data into
1. [live queries](https://tanstack.com/db/latest/docs/guides/live-queries) super-fast reactivity using differential dataflow
1. [optimistic mutations](https://tanstack.com/db/latest/docs/guides/mutations) that tie into the sync machinery

DB allows you to build real-time, reactive apps on any type of data, from any source. Be it your API response, Electric sync or a Durable Stream.

## Durable Session pattern

A Durable Session is a state management pattern that makes AI and agentic apps collaborative. It multiplexes AI token streams with structured state into a persistent, resilient, shared session that users and agents can subscribe to and join at any time.

### Layered protocols

The key insight behind the [generalization of Electric into Durable Streams](/blog/2025/12/09/announcing-durable-streams) was not ***just*** that apps needed persistent, addressable, binary streams for presence and token streaming. (Although, of course, [they do](https://github.com/durable-streams/durable-streams?tab=readme-ov-file#the-missing-primitive)).

It was ***also*** to decouple the payload format from the delivery protocol. So the resilient, scalable, HTTP-based delivery protocol could sync any data format. That way, the Electric sync protocol (originally modelled on the change events emitted by Postgres logical replication) becomes just one of many structured state synchronization protocols layered on top of the core binary streams.

So you have this layered framework of wrapper protocols, where durable streams are wrapped by durable state, which is wrapped by specific transport protocols:

1. [durable streams](/blog/2025/12/09/announcing-durable-streams) &mdash; persistent, addressable, payload agnostic, binary stream
1. [durable state](/blog/2025/12/23/durable-streams-0.1.0#introducing-the-state-protocol) &mdash; schema-aware structured state sync over durable stream
1. [specific protocols](/blog/2025/12/23/durable-streams-0.1.0#using-the-state-protocol) &mdash; like Postgres sync and AI SDK token streaming

### Durable transport

When it comes to building AI apps, the transport protocols are normally defined by the AI SDKs. For example, the Vercel AI SDK has a [Data Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol#data-stream-protocol).

This streams (mostly) JSON message parts over SSE:

```json
data: {"type":"start","messageId":"msg_1234"}
data: {"type":"text-start","id":"msg_1234"}
data: {"type":"text-delta","id":"msg_1234","delta":"Hello "}
data: {"type":"text-delta","id":"msg_1234","delta":" world!"}
data: {"type":"text-end","id":"msg_1234"}
data: {"type":"finish"}
data: [DONE]
```

> As you can see from the lack of message ID on the `data: {"type":"finish"}` part, it's a protocol that struggles to shake off its single user <> single agent roots. Because how do you multiplex multiple streaming messages at the same time if you don't know which message the finish applies to. And what's `[DONE]` exactly? The request or the session?

The durable state layer makes it simple to stream this kind of structured protocol, resiliently, with end-to-end type safety, over the Electric delivery protocol.

> [!Info] Example &mdash; Vercel AI SDK Transport
> The Vercel AI SDK has a [Transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport) adapter mechanism that allows you to plug in a durable transport adapter:
>
> ```tsx
> const { messages, sendMessage } = useChat({
>   transport: new DurableTransport({...})
> })
> ```
>
> See a Durable State based [Durable Transport for the Vercel AI SDK here](https://github.com/electric-sql/transport/?tab=readme-ov-file#durable-transport).

> [!Info] Example &mdash; TanStack AI Connection Adapter
> TanStack AI has a similar [Connection Adapter](https://tanstack.com/ai/latest/docs/guides/connection-adapters) pattern:
>
> ```tsx
> const { messages, sendMessage } = useChat({
>   connection: durableFetch(...)
> })
> ```
>
> See a Durable State based [Durable Connection Adapter for TanStack AI here](https://github.com/electric-sql/transport/?tab=readme-ov-file#durable-transport).

### Limitations of transport

These transport adapters give you resilience and, in some cases, resumability of active generations. However, they are still limited to request <> response. Which binds them to the single user <> single-agent interaction paradigm.

For real collaboration, we need to go beyond just patching the transport to make individual requests and their streaming responses durable and resilient. We need to patch the state management layer to <strong><em>make the <span class="no-wrap">entire session durable</span></em></strong>.

### Sync the entire session

Making the entire session durable allows us to persist multiple messages and active generations over time. You can sync any number of messages to any number of users and any number of agents. Or, for that matter, any other subscribers, workers, applications or interested parties.

In fact, using the Durable State layer, we can multiplex and transfer a variety of structured and multi-modal data both ***over time*** and ***at the same time***:

- whole messages
- token streams for active generations
- structured state for presence and agent registration
- CRDTs for typeahead indicators and cursor positions
- binary data frames for multi-modal data

Because the stream is persistent and addressable, clients can always join and catch up from their current offset at any time. Whether that's in real-time as the session is active or later on for asynchronous collaboration and historical access.

What we're describing is a sync-based interaction paradigm. That can combine structured state sync with efficient binary streaming. With principled management of optimistic state, tied into the sync machinery.

<figure>
  <img :src="SyncBased" class="hidden-sm" />
  <img :src="SyncBasedSmall" class="block-sm" />
</figure>

## Reference implementation

Which is exactly what [Durable Streams](#durable-streams) and [TanStack DB](#tanstack-db) were designed for. So, with them as composable sync primitives, the implementation becomes simple.

### Using a standard schema

You simply provide a [Standard Schema](https://standardschema.dev) for the multiplexed message types that you would like in your session ([here's an example](https://github.com/electric-sql/transport/blob/main/packages/durable-session/src/schema.ts)) and that gives you the data available in a reactive store in the client.

#### Example schema

Here's a cut down of the example schema linked above, that multiplexes whole messages, active token streams, user presence and agent registration data, with end-to-end type-safety, over a single Durable Stream.

It starts by defining the schemas for the different data types:

```ts
import { z } from 'zod'
import { createStateSchema } from '@durable-streams/state'

// N.b.: this wrapper schema supports any message or chunk
// payload format in `chunk`, which is then, as we'll see,
// parsed and hydrated into typed messages by the AI SDK.
export const chunkSchema = z.object({
  messageId: z.string(),
  actorId: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  chunk: z.string(),
  seq: z.number(),
  createdAt: z.string(),
})

export const presenceSchema = z.object({
  userId: z.string(),
  userName: z.string(),
  deviceId: z.string(),
  status: z.enum(['online', 'offline']),
})

export const agentSchema = z.object({
  agentId: z.string(),
  agentName: z.string(),
  triggers: z.enum(['all', 'user-messages']),
  endpoint: z.string(),
})
```

It then combines them into a unified session schema:

```ts
export const sessionSchema = createStateSchema({
  chunks: {
    schema: chunkSchema,
    type: 'chunk',
    primaryKey: 'id', // injected as `${messageId}:${seq}`
    allowSyncWhilePersisting: true,
  },
  presence: {
    schema: presenceSchema,
    type: 'presence',
    primaryKey: 'id', // injected as `${actorId}:${deviceId}`
  },
  agent: {
    schema: agentSchema,
    type: 'agent',
    primaryKey: 'agentId'
  },
})
```

This is then passed to the durable state layer [`StreamDB`](https://github.com/durable-streams/durable-streams/blob/main/packages/state/src/stream-db.ts), which streams the data over a Durable Stream and routes the message streams and session state into TanStack DB collections for you. The schema provides end-to-end type-safety and the transport and reactivity is delegated to the sync machinery.

#### Derived collections

You can then derive reactive views on the data, in the form of derived live query collections. For example, the code to derive a collection of messages out of the raw chunks looks like this ([see full example](https://github.com/electric-sql/transport/blob/main/packages/durable-session/src/collections/messages.ts) and [`materializeMessage`](https://github.com/electric-sql/transport/blob/main/packages/durable-session/src/materialize.ts) source):

```ts
import { createLiveQueryCollection, collect, count, minStr } from '@tanstack/db'

const messagesCollection = createLiveQueryCollection({
  query: (q) => {
    // The first query groups chunks into messages, see:
    // https://tanstack.com/db/latest/docs/guides/live-queries#aggregate-functions
    const collected = q
      .from({ chunk: chunksCollection })
      .groupBy(({ chunk }) => chunk.messageId)
      .select(({ chunk }) => ({
        messageId: chunk.messageId,
        rows: collect(chunk),
        startedAt: minStr(chunk.createdAt),
        rowCount: count(chunk),
      }))

    // The second query materializes the grouped chunks into
    // messages with `materializeMessage` using the built-in
    // TanStack AI `StreamProcessor`:
    // https://tanstack.com/ai/latest/docs/reference/classes/StreamProcessor
    return q
      .from({ collected })
      .orderBy(({ collected }) => collected.startedAt, 'asc')
      .fn.select(({ collected }) => materializeMessage(collected.rows))
  },
  getKey: (row) => row.id,
})
```

This is highly efficient. There are no for loops over the client data when a new chunk arrives. Instead, the messages are constructed using a live query pipeline based on differential data flow. So only the changed data needs to be re-calculated.

You can then derive *further* collections from the materialized messages, using additional live query pipelines to filter and coerce the data. For example, to get a collection of pending tool call approval messages:

```ts
const approvalsCollection = createLiveQueryCollection({
  query: (q) =>
    q
      .from({ message: messagesCollection })
      .fn.where(({ message }) =>
        message.parts.some(
          (p) =>
            p.type === 'tool-call' &&
            p.approval?.needsApproval === true &&
            p.approval.approved === undefined
        )
      )
  getKey: (row) => row.id,
})
```

The key here again is there's no imperative code looping over client state. It's all materialized and derived in the live query pipeline. With [automatic reactivity](https://tanstack.com/db/latest/docs/overview#uselivequery-hook) thanks to TanStack DB. So you can just bind the derived collections to your components and everything works, with end-to-end, surgical reactivity:

```tsx
import { useLiveQuery } from '@tanstack/react-db'

const LatestPendingApprovals = () => {
  const { data: approvals } = useLiveQuery(q =>
    q
      .from({ msg: approvalsCollection })
      .orderBy(({ msg }) => msg.createdAt, 'desc')
      .limit(3)
  )

  return <List items={ approvals } />
}
```

It's also pure TypeScript, so it works across any environment &mdash; web, mobile, desktop, Node.js, Bun &mdash; simplifying multi-user, multi-device and multi-worker collaboration.

#### Integrating sessions into your wider data model

Because the session data is synced into TanStack DB collections, it can be [joined up](https://tanstack.com/db/latest/docs/guides/live-queries#joins) into a wider client data model.

For example, we can load user profile data into a collection [from your API](https://tanstack.com/db/latest/docs/collections/query-collection):

```tsx
import { QueryClient } from "@tanstack/query-core"
import { createCollection } from "@tanstack/db"
import { queryCollectionOptions } from "@tanstack/query-db-collection"

const queryClient = new QueryClient()

const profileCollection = createCollection(
  queryCollectionOptions({
    queryKey: ["profile"],
    queryFn: async () => {
      const response = await fetch("/api/user-profiles")

      return response.json()
    },
    queryClient,
    getKey: (item) => item.id,
  })
)
```

And then join the profile data to the session presence data when displaying active session users:

```tsx
const ActiveSessionUsers = () => {
  const { data } = useLiveQuery(q =>
    q
      .from({ presence: presenceCollection }) // from the session
      .innerJoin({ profile: profileCollection }, // from your API
        ({ presence, profile }) => eq(presence.userId, profile.userId)
      )
      .select(({ presence, profile }) => ({
        id: presence.userId,
        avatar: profile.avatarUrl,
      }))
  )

  // ...
}
```

Thus allowing the data streaming in over the durable session to be joined up naturally into your wider data model.

#### Write-path actions

When it comes to handling user actions and adding messages to the sessions, you switch the `sendMessage` calls to use TanStack DB [optimistic mutations](https://tanstack.com/db/latest/docs/guides/mutations).

For example, the default TanStack AI [`ChatClient`](https://github.com/TanStack/ai/blob/main/packages/typescript/ai-client/src/chat-client.ts) and [`useChat` hook](https://github.com/TanStack/ai/blob/main/packages/typescript/ai-react/src/use-chat.ts) provide a sendMessage action:

```tsx
const ChatPage = () => {
  const { messages, sendMessage } = useChat({...})

  // ...
}
```

We can swap that out for an optimistic mutation using [`createOptimisticAction`](https://tanstack.com/db/latest/docs/guides/mutations#creating-custom-actions).

```ts
import { createOptimisticAction } from '@tanstack/db'

interface MessageActionInput {
  content: string
  messageId: string
  role: 'user' | 'assistant' | 'system'
}

const sendMessage = createOptimisticAction<MessageActionInput>({
  onMutate: ({ content, messageId, role }) => {
    const createdAt = new Date()

    // Insert optimistic state into messages collection directly
    // This propagates to all derived collections, so the local UI
    // updates instantly.
    messagesCollection.insert({
      id: messageId,
      role,
      parts: [{ type: 'text' as const, content }],
      isComplete: true,
      createdAt,
    })
  },
  mutationFn: async ({ content, messageId, role, agent }) => {
    const txid = crypto.randomUUID()

    await this.postToProxy(`/v1/sessions/${this.sessionId}/messages`, {
      messageId,
      content,
      role,
      actorId: this.actorId,
      actorType: this.actorType,
      txid,
      ...(agent && { agent }),
    })

    // Wait for this write to sync back on the durable stream
    // before discarding optimistic state.
    await streamDb.utils.awaitTxId(txid)
  },
})
```

In our demo code, we implement this in a customized [`DurableChatClient`](https://github.com/electric-sql/transport/blob/main/packages/durable-session/src/client.ts), which pairs with a [`useDurableChat` hook](https://github.com/electric-sql/transport/blob/main/packages/react-durable-session/src/use-durable-chat.ts):

```tsx
const ChatPage = () => {
  const { messages, sendMessage } = useDurableChat({...})

  // ...
}
```

As you can see, the usage from component code is exactly the same. So this works as a drop-in replacement. With the actual, underlying, state handling and transfer wired properly via the durable session.

This solves the [limitations of the transport level durability](#limitations-of-transport) we discussed above. By having principled management of local optimistic state and syncing user messages to the other subscribers to the session.

As you can see from the `mutationFn` in the code sample above, it still POSTs the write to your backend. So you're in control of authentication and any other custom business logic and you handle writes to the session in your backend code.

#### Session CRUD

This is standard CRUD stuff and you can implement it using whatever framework you prefer or already use.

For example, in the reference example, we have a [handler for message actions](https://github.com/electric-sql/transport/blob/main/packages/durable-session-proxy/src/handlers/send-message.ts) which (simpified and on the happy path) looks something like this:

```ts
async function handleSendMessage(c: Context, protocol: Protocol): Promise<Response> {
  // Validate and parse the request
  const sessionId = c.req.param('sessionId')
  const body = messageRequestSchema.parse(await c.req.json())

  // Write to the stream
  const stream = await protocol.getOrCreateSession(sessionId)
  await protocol.writeUserMessage(stream, sessionId, body)

  return c.json({}, 200)
}
```

Importantly, you'll notice that handler ***doesn't*** proxy the request through to an LLM provider. It just writes to the stream.

To instruct the LLM, you register agents that subscribe to the stream and the [session backend](https://github.com/electric-sql/transport/blob/main/packages/durable-session-proxy/src/protocol.ts) calls them when new messages are posted:

```ts
state.modelMessages.subscribeChanges(async () => {
  const history = await this.getMessageHistory(sessionId)

  notifyRegisteredAgents(stream, sessionId, 'user-messages', history)
})
```

The agents themselves are backend API endpoints, where you can manage your control flow and perform context engineering as normal. For example this is the main code from the [default agent in the demo](https://github.com/electric-sql/transport/blob/main/demos/tanstack-ai-durable-session/src/routes/api.chat.kermit.ts):

```ts
async ({ request }) => {
  if (request.signal.aborted) {
    return new Response(null, { status: 499 })
  }

  const { messages } = await request.json()
  const abortController = new AbortController()

  const stream = chat({
    adapter: openai(),
    model: 'gpt-4o',
    systemPrompts: [SYSTEM_PROMPT],
    agentLoopStrategy: maxIterations(10),
    messages,
    abortController,
  })

  return toStreamResponse(stream, { abortController })
}
```

It's your code and it can be exactly the same as if it was handling a user message and streaming the response back in a request <> response paradigm. Except now it's being invoked by the backend session, which consumes the response and writes it iteratively onto the durable stream.

### Optimum AX/DX/UX

As a result, you get an app that fully supports multi-tab, multi-device, multi-user and multi-agent. For both real-time and asynchronous collaboration.

With minimal changes to your component code and zero changes to your real AI engineering.

> [!Warning] Example &mdash; TanStack AI - Durable Sessions
> See the full code example and working demo app of a [TanStack AI - Durable Sessions reference implementation here](https://github.com/electric-sql/transport/?tab=readme-ov-file#durable-sessions).

<div class="embed-container" style="padding-bottom: 62.283737%">
  <YoutubeEmbed video-id="81KXwxld7dw" />
</div>

## The key pattern for collaborative AI

As the world moves to getting things done through agents, the winners are going to be the products that combine AI with team-based collaboration. Building AI apps on the Durable Session pattern is the best way to do that.

[Durable Streams](https://github.com/durable-streams/durable-streams) and [TanStack DB](https://tanstack.com/db) allow you to build Durable Sessions with your existing stack, schema and AI SDK.

### Next steps

Dive into the projects and docs for more information:

- [Electric](/docs/intro)
- [Durable Streams](https://github.com/durable-streams/durable-streams)
- [TanStack DB](https://tanstack.com/db)
- [TanStack AI](https://tanstack.com/ai)

Check out the reference implementations in the [electric-sql/transport](https://github.com/electric-sql/transport) repo:

- [Durable Transport](https://github.com/electric-sql/transport?tab=readme-ov-file#durable-transport)
- [Durable Sessions](https://github.com/electric-sql/transport?tab=readme-ov-file#durable-sessions)

[Reach out on our Discord channel](https://discord.electric-sql.com) if you have any questions, or if you need help implementing any of the technologies or patterns outlined in this post.
