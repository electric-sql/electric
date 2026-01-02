---
title: Durable Sessions — the key pattern for collaborative AI
description: >
  This post introduces the Durable Session pattern for building collaborative AI apps with Durable Streams and TanStack DB.
excerpt: >
  As the world moves to getting things done through agents, the winners are going to be the products that combine AI with team-based collaboration. Building AI apps on a Durable Sessions architecture is the best way to do that.
authors: [thruflo]
image: /img/blog/durable-sessions-for-collaborative-ai/header.jpg
tags: [agents, collaboration, durable-streams, tanstack-db]
outline: [2, 3]
post: true
---

<script setup>
import Tweet from 'vue-tweet'

import RequestResponse from '/static/img/blog/durable-sessions-for-collaborative-ai/request-response.jpg?url'
import RequestResponseSmall from '/static/img/blog/durable-sessions-for-collaborative-ai/request-response.sm.jpg?url'
</script>

<style scoped>
  figure {
    margin: 24px 0 !important;
    border-radius: 14px !important;
    overflow: hidden;
  }
</style>

As the world moves to getting things done through agents, the winners are going to be the products that integrate AI with team-based collaboration.

This post introduces the [Durable Sessions pattern](#durable-sessions-pattern) for building collaborative AI apps.

It shows how you can use Durable Sessions today, with your existing stack and AI SDK, to support exactly the kind of real-time and asynchronous collaboration that will unlock adoption across the enterprise.

> [!Warning] 🤝 ✨ TanStack AI <> DB example
> See the example app [screencast video](#) below and [source code here](#).

<div class="embed-container">
  <YoutubeEmbed video-id="..." />
</div>

## Getting things done with agents

When I sit down to get something done, I increasingly reach for an agent. Not because they're magic or perfect but because, on balance, they boost my productivity.

For me, personally, as a technical startup founder, adapting to this new reality is a challenge. I spent the last however many years developing craft skills that are now somehow being both amplified and commoditized at the same time. I'm having to re-learn, on ever shorter timeframes, what it is I even do for a living.

<figure>
  <Tweet tweet-id="2004646160200511615"
      align="center"
      conversation="none"
      theme="dark"
  />
</figure>

For people with less technical craft skills or who are less used to adaptation, the challenge to evolve how they work is even sharper. For large companies, that are basically normal people working in ossified structures, the challenge is existential. Teams, departments, whole industries &mdash; why do they even exist any more?

### Right place, right time

As a software engineer and a product builder, if you've ever wanted to be in the right place at the right time, you are right now.

You have the opportunity to disrupt and replace whole swathes of previous-generation software. Right as the market is expanding wildly, as software eats into the rump of white-collar payroll spend.

### Cracking the enterprise

It's a massive economic shift, with massive customers feeling massive pain. If you can serve their transformation, as they scramble to up-skill and transform their workforce, there's no limit to what you can achieve.

However, if you build on a single user paradigm, it's not going to cut it. You're not going to win the procurement battle. You're not going to land and expand and you're not going to benefit from product-led growth.

Instead, to crack the enterprise, you need to support the same kind of team-based collaboration that the software you're replacing was built around. That means people working together on and around agentic sessions.

### With collaborative AI

At the micro-level it's shared sessions, collaborative prompt editing and multi-user token streams. At the mid-level it's audit logs and history. Compliance departments reviewing context and artifacts.

At the macro-level it's weaving your software into the fabric of the enterprise. As the research, the planning, the prompts, the sessions and the outputs get threaded into the collaboration, management, reporting, access control and governance processes that the enterprise runs on.

But how do you build and adapt AI and agentic products to support this kind of collaboration? How do you unlock this level of adoption?

## Moving beyond single-user

You need to move beyond the default single-user <> single-agent interaction paradigm of today's AI SDKs. To a multi-user <> multi-agent paradigm that naturally supports both real-time and asynchronous collaboration.

### Evolving the interaction paradigm

The default paradigm of the most popular AI SDKs, like the [Vercel AI SDK](https://ai-sdk.dev/docs/introduction), remains single-user <> single-agent. You have a chat interface with a `sendMessage` action:

```tsx
const { messages, sendMessage } = useChat({...})
```

When the user types their prompt and hits enter, you call `sendMessage`, it adds the message to some local state and then blocks the UI whilst it makes an API request to a backend endpoint. Something like this:

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

This constructs an LLM instruction request and streams the response back to the client. The client then consumes the response stream, writing out the agent response in chunks one at a time, and then unblocks the chat thread once the active generation is finished.

<figure>
  <img :src="RequestResponse" class="hidden-sm" />
  <img :src="RequestResponseSmall" class="block-sm" />
</figure>

The whole flow is designed around request <> response. The request is a single user message and the response is a single assistant message.

This fails to support collaboration in so many ways. The local message state isn't shared, so doesn't sync across users/tabs/devices. The request response model (and blocking the UI) assumes there’s only one user waiting on a response from a one agent.

What we need instead is an interaction paradigm that doesn't bake in this single user <> single agent assumption. That allows multiple users to work in multiple tabs and devices, collaborating with other users and agents on the same session in real-time. So users can join the session half way through and other users can go back to it later.

That means the session needs to be persistent and addressable.

### Persistence and addressability

Persistence and addressability of AI sessions is generally left up to application developers. There's no standardization and as a result there's no interop. If you want multiple users to join the same session or multiple agents to register with it, you have to dig into application-specific routing, storage and authentication.

For example, the Vercel AI SDK [`useChat` hook](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat#messages) accepts an `messages` parameter.

```tsx
// Initial chat messages to populate the conversation with.
messages?: UIMessage[]
```

Which you can pass in when you initialise a chat session. Or (because it can be a bit tricky with SSR and async data loading) you can set client side, after the UI has initialized:

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

Where that `sessionId`  comes from is up to you. How you use it to fetch the message history is up to you. And you need to be careful to construct the right message IDs to match any resumable active generations. Which is no doubt handled differently by every app that's implemented this so far.

What's needed is a ***standard protocol*** for persistence and addressability of streams and sessions. So external software can plug-in, audit, monitor and integrate, in the same way that today's enterprise systems monitor and audit web service APIs.

### Durable state and subscribability

When you move from single user <> single agent you decouple and have more of an event bus architecture. Everyone's an actor and actors have agency. They need visibility on events and you need to be able to craft the control flow. Workflows can't be breaking when a ephemeral connection drops.

That's why there's a big focus in agentic on durable execution. But in reality, you don't need durable execution. You need durable state. If your state is persistent and addressable, your execution can be ephemoral. Because your clients or workers (or processes, or agents) can just connect and resume at any stage.

## Composable sync primitives

That's what we've been building at Electric. A suite of composable sync primitives that give you durable state that's persistent, addressable and subscribable:

- [Electric sync](#electric-sync)
- [Durable Streams](#durable-streams)
- [TanStack DB](#tanstack-db)
- [PGlite](https://pglite.dev)

They're used by millions of developers, built into tools like Firebase, Supabase, Prisma and TanStack and are used in production, at scale, by companies and products like [Trigger.dev](https://trigger.dev), [Turbo](https://www.turbo.ai) and [Humanlayer](https://www.humanlayer.dev).

### Electric sync

Our core product is the [Electric sync engine](https://electric-sql.com). This is a read-path sync engine for application development. It syncs data out of Postgres into client apps, handling partial replication, data delivery and fan out.

As a developer, you can declare the data you want in the local app. Electric then handles the transfer and synchronization for you. This allows you to [build fast, reactive apps that support real-time collaboration](/blog/2025/07/29/local-first-sync-with-tanstack-db).

Electric uses an HTTP sync protocol, that scales out data delivery through existing CDN infrastructure. This was originally designed by Kyle Mathews, based on his experience building Gatsby.

### Durable Streams

We've now generalized the Electric sync protocol into the [Durable Streams](https://github.com/durable-streams/durable-streams) protocol. This is a lower-level binary streaming protocol that follows the same semantics and core protocol as Electric.

As a lower-level binary protocol (that isn't coupled to Postgres) it can be used efficiently for a wider variety of use cases. These include token streaming, real-time presence and multi-modal binary data frames.

### TanStack DB

You can sync Electric and Durable Streams into anything. However, the main client store we develop and recommend for application development is [TanStack&nbsp;DB](https://tanstack.com/db).

TanStack DB is a lightweight, reactive client store. It has three key elements:

1. [collections](https://tanstack.com/db/latest/docs/overview#defining-collections) that allow you to sync/load data from any source
1. [live query engine](https://tanstack.com/db/latest/docs/guides/live-queries) based on a Typescript implementation of differential dataflow
1. [optimistic mutations](https://tanstack.com/db/latest/docs/guides/mutations) that tie into the sync machinery

Collections provide a unified data layer to load any type of data into, from any source. This allows you to build real-time, reactive apps that connect structured and unstructured data. No matter whether it comes from an API response, Electric sync or a Durable Stream.

## Durable Sessions pattern

The key insight behind Durable Streams was not just that apps needed binary streams for things like token streaming. It was also to decouple the payload format from the delivery protocol. So the durable stream protocol could sync any data format.

With this approach, the Electric sync protocol (originally modeled on the change events emitted by Postgres logical replication) could be just _one of many_ structured state synchronization protocols layered on top of the core binary streams.

So you get multiple layers:

1. [durable streams](/blog/2025/12/09/announcing-durable-streams) &mdash; persistent, addressable, payload agnostic, binary stream
1. [durable state](/blog/2025/12/23/durable-streams-0.1.0#introducing-the-state-protocol) &mdash; schema-aware structured state sync over durable stream
1. specific protocols &mdash; like Electric sync and AI SDK token streaming

### Durable transport

When it comes to building AI apps, the state transfer protocols tend to be defined by the AI SDKs. For example, the Vercel AI SDK has a [Data Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol#data-stream-protocol) that streams (mostly) JSON message parts over SSE:

```json
data: {"type":"start","messageId":"msg_1234"}
data: {"type":"text-start","id":"msg_1234"}
data: {"type":"text-delta","id":"msg_1234","delta":"Hello "}
data: {"type":"text-delta","id":"msg_1234","delta":" world!"}
data: {"type":"text-end","id":"msg_1234"}
data: {"type":"finish"}
data: [DONE]
```

As you can see from the lack of message ID on the `data: {"type":"finish"}` part, it's a protocol that struggles to shake off its single user <> single agent roots. Because how do you multiplex multiple streaming messages at the same time if you don't know which message the finish applies to. And what's `[DONE]` exactly?

The principle of layered sync on top of durable streams is that it's simple to stream this kind of structured protocol, with type safety, over a durable stream. The Vercel AI SDK has a [Transport](https://ai-sdk.dev/docs/ai-sdk-ui/transport) adapter that allows you to plugin a durable transport adapter that uses a durable stream for the state transfer.

```tsx
const { messages, sendMessage } = useChat({
  transport: new DurableTransport({...})
})
```

TanStack AI has a similar [Connection Adapter](https://tanstack.com/ai/latest/docs/guides/connection-adapters) pattern:

```tsx
const { messages, sendMessage } = useChat({
  connection: durableFetch(...)
})
```

You can see Durable Transport examples and demo apps for the two SDKs here:

- [TanStack AI Durable Connection Adapter example](https://github.com/electric-sql/transport/blob/main/demos/tanstack-ai-durable-transport/src/routes/index.tsx)
- [Vercel AI SDK Durable Transport example](https://github.com/electric-sql/transport/blob/main/demos/vercel-ai-sdk-durable-transport/app/page.tsx)

However, the existing Transport / Connection Adapter plugin interfaces are just a first step. They make the app more resilient, particularly when streaming long active generations. However, they don't make it ***collaborative***.

### Durable sessions

What's needed for real collaboration is for the client to subscribe to a ***durable session*** that's persistent and addressable. With this pattern, the interaction paradigm isn't limited to request <> response. It can sync any number of messages and active generations to any number of actors or subscribers.

> ... diagramme ...

Using the [Durable State](https://github.com/durable-streams/durable-streams/tree/main/packages/state) protocol, layered over a [Durable Stream](https://github.com/durable-streams/durable-streams), the Durable Session can multiplex multiple active generations at the same time and transfer a variety of structured and multi-modal data:

- whole messages
- token streams for active generations
- structured state for presence and agent registration
- CRDTs for typeahead indicators and cursor positions
- binary data frames for multi-modal data

When a user types and enters a message, resulting in a call to `sendMessage`, this can be treated as an optimistic write. For proper visibility and management of the local state. Because the stream is persistent and addressable, clients can always join and catch up from their current offset at any time. Whether that's in real-time as the session is active or later on for asynchronous collaboration and historical access.

### Reference implementation

What we're describing is a sync-based interaction paradigm. With a combination of structured state sync and binary streaming. With principled management of optimistic state, tied into the sync machinery. As a developer, you should be able to provide a standard schema for the multiplexed message types and just have those messages available in a reactive store.

Which is exactly what TanStack DB and the Durable State layer on-top of Durable Streams were designed for. So, with these existing, composable sync primitives already available, the implementation becomes simple.

#### Read-path sync

1. multiplex the state protocol over a durable stream and route the message streams and session state into TanStack DB collections

```typescript
// … StreamDB code sample …
```

... type safety, reactivity, efficient ...
... pure TS so web, mobile, desktop for multi-tab, multi-device ...
... real-time multi-user ...
... durable for resumability, persistence and history -> async collaboration ...
... unified on an open protocol ...
... potential to join up into a wider client model with TanStack DB

#### Write-path actions

1. switch the `sendMessage` style actions to use TanStack DB optimistic mutations

```typescript
// … sendMessage createOptimisticAction example / usage …
```

... properly syncs user messages to multiple users and agents ...
... principled handling of optimistic state ...
... still goes via your API and your control logic ...
... nothing imposed ...

#### Session CRUD

1. implement some functions/handlers in your backend API to support creating, joining, subscribing and writing to sessions

```typescript
// … backend code sample …
```

... decouple agent instruction from request response ...
... support presence, typeahead, cursor positions ...
... register to the session or just consume the stream ...
... tie in the session registration to structured data model, e.g.: to Postgres ...
... then use alongside Electric sync and join up in the client with TanStack DB ...

### Reactive architecture

... higher level overall application archiecture diagramme ...

### Optimum AX/DX/UX

... as a result, you get an app that fully supports multi-tab, multi-device, multi-user and multi-agent. For both real-time and asynchronous collaboration. With minimal changes to your component code and zero changes to your backend AI engineering.

<figure>
  <div class="embed-container" style="padding-bottom: 75.842697%">
    <YoutubeEmbed video-id="..." />
  </div>
</figure>

You can see a full code example and working demo app here:

- [TanStack AI <> Durable Streams <> TanStack DB durable session example](#)

## Unlocking adoption with collaborative AI

As the world moves to getting things done through agents, the winners are going to be the products that integrate AI with team-based collaboration. Building AI apps on a Durable Sessions architecture is the best way to do that.

Implementing Durable Sessions on top of Durable Streams and TanStack DB is simple, gives you interop via an open protocol and a solution that works with your existing stack, AI SDK and schemas.

For maximum adoption, minimum code changes and end-to-end type safety. Especially when used in combination with TanStack AI.

---

Dive into the projects and docs for more information:

- [Durable Streams](#)
- [TanStack AI](#)
- [TanStack DB](#)

[Reach out on our Discord channel](#) if you have any questions. [Get in touch](#) if we can help speed up your integration.
