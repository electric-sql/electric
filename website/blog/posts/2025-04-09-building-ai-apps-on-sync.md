---
title: Building AI apps? You need sync
description: >-
  AI apps are collaborative. Building them requires solving resumability,
  interruptibility, multi‑tab, multi‑device and multi‑user.
excerpt: >-
  AI apps are collaborative. Building them requires solving resumability,
  interruptibility, multi‑tab, multi‑device and multi‑user.
authors: [samwillis]
image: /img/blog/building-ai-apps-on-sync/header.jpg
tags: [ai, sync, postgres-sync, durable-streams]
outline: [2, 3]
post: true
---

<script setup>
  import Card from '../../src/components/home/Card.vue'
  import PartialReplicationDiagramme from '../../src/components/home/PartialReplicationDiagramme.vue'
</script>

<style scoped>
  figure {
    margin: 32px 0;
  }
  .partial-replication-diagramme {
    margin: 32px 0;
  }
  .partial-replication-diagramme :deep(.container) {
    margin: 0px 0px 10px;
  }
  video {
    width: 100%;
    aspect-ratio: 4/3;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid rgba(44, 44, 50, 0.5);
  }
  video.wide {
    aspect-ratio: 16/9;
  }
</style>

AI apps are inherently collaborative. Building them requires solving [resumability](#resumability), [interruptibility](#interruptibility), [multi&#8209;device](#multi-device) and [multi&#8209;user](#multi-user).

These are not edge-cases. They're core to [user <-> agent collaboration](#collaboration) and the new world of [multi&#8209;step, task&#8209;and&#8209;review workflows](#multi-step-workflows). They're also [key growth hacks](#unlocking-adoption) for products looking to replace current-generation SaaS and enterprise software.

As AI apps become more collaborative, with [multiple users interacting with the same AI session](#collaboration) and those sessions spawning [more and more agents](#swarms), these challenges are only going to get more important. Luckily, they're all [solved by&nbsp;sync](#sync-is-the-solution).

<div style="margin-top: 2rem">

> [!Warning] ✨ Electric AI chat app
> See the [electric-sql/electric-ai-chat](https://github.com/electric-sql/electric-ai-chat) repo for the example app accompanying this post.

</div>

## Resumability

Most AI apps stream tokens into the front-end. That's how Claude and ChatGPT write out their response to you, one word at a time.

<figure>
  <img class="hidden-sm"
      src="/img/blog/building-ai-apps-on-sync/token-streaming.png"
  />
  <img class="block-sm" style="width: 100%; max-width: 275px"
      src="/img/blog/building-ai-apps-on-sync/token-streaming.sm.png"
  />
</figure>

If you stream directly from the agent to the UI, you have a fragile system. Your app breaks when the connection drops and when the user refreshes the page.

For example, here's a video showing how ChatGPT behaves:

<figure>
  <HTML5Video
      poster="/img/blog/building-ai-apps-on-sync/video-1-chatgpt-breaking.jpg"
      src="https://electric-sql-blog-assets.s3.us-east-1.amazonaws.com/building-collaborative-ai-apps-on-sync/video-1-chatgpt-breaking.mp4"
  />
</figure>

If, instead, you stream tokens into a store and then subscribe to that store, you can build non-fragile, resilient apps where the data isn't lost when a connection drops.

<figure>
  <img class="hidden-sm"
      src="/img/blog/building-ai-apps-on-sync/streaming-via-store.png"
  />
  <img class="block-sm" style="width: 100%; max-width: 396px"
      src="/img/blog/building-ai-apps-on-sync/streaming-via-store.sm.png"
  />
</figure>

For example, here's our [Electric AI chat app](https://github.com/electric-sql/electric-ai-chat), streaming tokens via a store (in this case [a Postgres database](https://electric-sql.com/docs/guides/deployment#_1-running-postgres)). It handles offline, patchy connectivity and page refreshes without a problem:

<figure>
  <HTML5Video
      poster="/img/blog/building-ai-apps-on-sync/video-2-electric-chat-resilient.jpg"
      src="https://electric-sql-blog-assets.s3.us-east-1.amazonaws.com/building-collaborative-ai-apps-on-sync/video-2-electric-chat-resilient.mp4"
  />
</figure>

The key to this behaviour is _resumability_: the ability to resume streaming from a known position in the stream. To do this, the app keeps track of the last position its seen. Then when re-connecting, it requests the stream from that position.

This pattern is fiddly to wire up yourself (message delivery is a [distributed systems rabbit hole](https://jepsen.io/consistency/models)) but is _built in_ to sync engines for you. For example, Electric's [sync protocol](/docs/api/http) is based on the client sending an `offset` parameter.

This is usually abstracted away at a [higher-level](/docs/api/clients/typescript), e.g.:

```tsx
import { ShapeStream } from '@electric-sql/client'

const tokenStream = new ShapeStream({
  params: {
    table: 'tokens',
  },
})

// tokenStream.subscribe(tokens => ...)
```

But under the hood, the sync protocol provides automatic resumability. So apps just work and users don't swear at your software when their vibes disappear.

<!-- James' talk video here when published -->

## Multi-device

You know another thing users do? They open multiple browser tabs and they flit in and out of your app. Talk to Claude, check your emails, talk to Claude, check Instagram, ...

So what do you do when they open your app in two tabs at the same time? They can't remember which tab they used last. They're just confused when their session isn't there. Where did my vibes go?!

<img src="/img/blog/building-ai-apps-on-sync/multi-tab-broken.png" />

Or worse, they kick off the same prompt twice because they think it's not running. Now they have two threads competing to do the same thing.

Who are they going to blame? Your software. So even just the possibility of multiple browser tabs means you need to split that stream and keep both tabs in sync.

But, of course, the world is not just about browser tabs. Agents do stuff in the background. What are the chances your user is going to grab their mobile, nip across to [Linea Coffee](https://lineacaffe.com) on Mariposa and check progress while waiting in the queue?

<figure style="border-radius: 16px; overflow: hidden">
  <img src="/img/blog/building-ai-apps-on-sync/nipping-out-for-coffee.jpg" />
</figure>

When they do so, how do you keep the mobile app up-to-date with the session that was started in the browser? This is exactly what sync does. It handles _fan out_, so you can (resiliently) stream changes to multiple places at the same time.

<figure>
  <img class="hidden-sm"
      src="/img/blog/building-ai-apps-on-sync/streaming-two-clients.png"
  />
  <img class="block-sm" style="width: 100%; max-width: 396px"
      src="/img/blog/building-ai-apps-on-sync/streaming-two-clients.sm.png"
  />
</figure>

For example, with Electric, you can just write changes to Postgres and then Electric takes care of fanning-out data delivery to as many clients as you like (you can literally scale to [millions of clients](/docs/reference/benchmarks#cloud) straight out of the box).

So whichever device your user grabs or tab they return to, it can be up-to-date and exactly in the state they're expecting:

<figure>
  <HTML5Video class="wide"
      poster="/img/blog/building-ai-apps-on-sync/video-3-multi-device.jpg"
      src="https://electric-sql-blog-assets.s3.us-east-1.amazonaws.com/building-collaborative-ai-apps-on-sync/video-3-multi-device.mp4"
  />
</figure>

## Multi-user

In an [Onion-style newsflash](https://theonion.com/area-man-accepts-burden-of-being-only-person-on-earth-w-1819579668/), it turns out that our brave user is not the only person in the world. They have work colleagues, friends and family members.

SaaS was designed around this. Work colleagues can collaborate on Figma designs. Friends and family members can plan holidays using Airbnb wishlists.

<figure style="border-radius: 16px; opacity: 0.82; overflow: hidden">
  <a href="https://www.figma.com/blog/introducing-figma-community/" class="no-visual"
      target="_blank">
    <img src="/img/blog/building-ai-apps-on-sync/figma.png" style="margin: -30px 0" />
  </a>
</figure>

Now we have AI, collaboration-by-clicking-buttons is going to be replaced by by interacting with agents. That direct stream from the agent to the UI, it's single-user. It doesn't work for collaboration. For multi-user, you need the same pattern as with resumability and multi-device. Stream through a store with fan-out. As long as you stream the right sessions to the right users.

That's what sync engines like Electric and [Figma's LiveGraph](https://www.figma.com/blog/livegraph-real-time-data-fetching-at-figma/) do. They handle resilient streaming and fan-out, with partial replication. So the right data syncs to the right users.

For example, with Electric, you can define partial replication using [Shapes](/docs/guides/shapes):

<div class="partial-replication-diagramme">
  <a href="/docs/guides/shapes" class="no-visual">
    <Card background="var(--vp-code-block-bg)">
      <PartialReplicationDiagramme />
    </Card>
  </a>
</div>

Filtering just the content you need using where clauses:

```tsx
const tokenStream = new ShapeStream({
  params: {
    table: 'tokens',
    // Just sync the tokens for a given session.
    where: 'session_id = 1234',
  },
})
```

Which really changes the game for AI UX. Because it allows multiple users to collaborate on the same AI session.

### Collaboration

For example, here we show two users collaborating on the same task. The first user prompts the AI. The second user is watching in real-time. They see that the AI needs more context and upload a document to provide it. The AI sees this generates a better response.

<figure>
  <HTML5Video class="wide"
      poster="/img/blog/building-ai-apps-on-sync/video-4-multi-user.jpg"
      src="https://electric-sql-blog-assets.s3.us-east-1.amazonaws.com/building-collaborative-ai-apps-on-sync/video-4-multi-user.mp4"
  />
</figure>

This is a simple example (just the tip of the iceberg of [things to come](#agents-are-users)). However, it already clearly illustrates how AI apps need to be built on real-time sync, in order to facilitate multi-user collaboration.

### Interruptibility

Streaming tokens via a store also makes it simple to interrupt the stream for all users.

Rather than each user streaming from an agent, the agent streams into the store. Any user can then issue an instruction to interrupt, with aborts the token stream from the agent and stops it being written to the store. This naturally interrupts the session for all concurrent users.

For example:

```ts
// Stream tokens from the OpenAI API.
const stream = await openai.chat.completions.create({
  model,
  messages,
  stream: true,
})

// Into Postgres
for await (const event of stream) {
  pg.insert('INSERT INTO tokens value ($1)', [event.message])
}

// Until interrupted
function interrupt() {
  stream.controller.abort()
}
```

This fixes the problem where the user is frantically clicking or saying "stop" but Claude just ignores it and carries on generating artifacts.

## Agents are users

Human users are not the only thing that can interrupt flows and update data. An agent is not just an interface. An agent is an actor. They can [send notifications](https://modelcontextprotocol.io/docs/concepts/transports#notifications) and [update application state](https://modelcontextprotocol.io/docs/concepts/tools).

So, as soon as you have a user interacting with an agent, you have a multi-user app. Every conversation with an AI agent is inherently multi-user. It's at least you and the AI.

### Swarms

You're also not going to just have one agent. Soon, we're all going to have [swarms of agents](https://github.com/openai/openai-agents-python) running around in the background for us. These are going to need to share context and have situational awareness.

<figure style="border-radius: 16px; overflow: hidden">
  <a href="https://github.com/openai/openai-agents-python" class="no-visual" target="_blank">
    <img src="/img/blog/building-ai-apps-on-sync/swarm.png" /></a>
</figure>

Tools like [LangGraph](https://www.langchain.com/langgraph) and [Mastra](https://mastra.ai/blog/mastra-storage) provide a shared data layer for agents. However, they don't solve the last mile problem of syncing into user-facing apps to also keep the human in the loop. State can't just be in the cloud. Users have agency too!

For example, imagine you're managing a project and you have an AI assistant. You tell it to "monitor the todo list and perform the tasks". You then fire up a new session with another agent to plan out the project and generate tasks.

<figure>
  <HTML5Video class="wide"
      poster="/img/blog/building-ai-apps-on-sync/video-6-multi-agent.jpg"
      src="https://electric-sql-blog-assets.s3.us-east-1.amazonaws.com/building-collaborative-ai-apps-on-sync/video-6-multi-agent.mp4"
  />
</figure>

These agents need to collaborate via shared state. In this example, the todo-list. They need to known when it's changed and react to the changes. And so do the users! They want to see the state too.

For example, this is the Electric code for the agents to monitor and react to the todolist (full example in [`tools/todo/process.ts`](https://github.com/electric-sql/electric-ai-chat/blob/main/packages/api/src/ai/tools/todo/process.ts)):

```ts
const listItemsStream = new ShapeStream({
  url: `${ELECTRIC_API_URL}/v1/shape`,
  params: {
    table: 'todo_items',
    where: `list_id = '${listId}'`,
  },
})
const listItemsShape = new Shape(listItemsStream)

async function processNextItem() {
  const item = listItemsShape.currentRows.find((item) => !item.done)
  if (item) {
    // Perform the task using the agent
  }
}

let processing = false
async function processItems() {
  if (processing) return
  processing = true
  while (listItemsShape.currentRows.some((item) => !item.done)) {
    await processNextItem()
  }
  processing = false
}

listItemsShape.subscribe(async () => {
  await processItems()
})
```

This is code to show the same state to the user (full example in [`components/Todo.tsx`](https://github.com/electric-sql/electric-ai-chat/blob/main/packages/app/src/components/Todo.tsx)):

```tsx
function TodoListItems() {
  const { data: todoListItems } = useShape({
    url: `${ELECTRIC_API_URL}/v1/shape`,
    params: {
      table: 'todo_lists_items',
    },
  })

  return (
    <ul>
      {todoListItems.map((todoListItem) => (
        <li key={todoListItem.id}>
          {todoListItem.task}
          {todoListItem.done && <span> Done</span>}
        </li>
      ))}
    </ul>
  )
}
```

### Structure

So far, when discussing streaming, we've focused on tokens. But models are just as adept at returning structured data. This is another major advantage of streaming through a store. That store can be a structured database.

This allows agents to collaborate on different parts of a shared state, by working on different parts of a structured data model. For example, one agent can be outlining the high level structure of a Figma project whilst another agent fills in the details on each of the canvases.

### Chaos

When you call an API or function you typically know the "blast radius" of what data it can change. So you can know what to refetch. When you interact with an AI agent (that has any kind of agency) you don't know what it's going to change.

So you either need to constantly track and re-fetch everything. Or you need to monitor what data changes, so that you're automatically informed about it. What you really need is a way of declaring the subset of the data that the app, agent or UI needs, in order to monitor it, stay up-to-date and respond to changes.

That's why Sunil Pai says that [AI agents are local-first clients](https://sunilpai.dev/posts/local-first-ai-agents/) and that's why Theo Brown is [searching for the ideal sync engine](https://youtu.be/3gVBjTMS8FE).

## Sync is the solution

Sync solves a range of practical challenges with AI UX. From resumability and interruptibility to multi-tab, multi-device and multi-user.

As AI agents become more collaborative and autonomous (and lots more of them are spawned), then sharing state, reviewing progress, reacting to changes and maintaining local data sets are all going to get more important.

### Unlocking adoption

One of the main opportunities for AI startups and teams building AI apps is to replace current-generation software with smarter, AI-powered systems. Particularly in b2b and enterprise software, which tends to built around team-based collaboration, with support for multiple users with different roles.

This is where the ability to build multi-user, collaborative AI apps is key to adoption. Single-user AI sessions are not going to cut it. To replace incumbent systems and get wide adoption across the enterprise, AI apps need to support team-based collaboration. As we've seen, that means keeping multiple users and agents in sync.

Sync is a hard problem to solve yourself &mdash; and the last thing you want to be spending time on when you could be building your core product. That's why AI apps with ambition should be built on a sync engine, like [Electric](/), that solves sync for you.

### Let's jump in

This post is accompanied by a resilient, multi-user, multi-agent AI chat demo.

The source code is on GitHub at [electric-sql/electric-ai-chat](https://github.com/electric-sql/electric-ai-chat) and the demo is deployed online at [electric-ai-chat.examples.electric-sql.com](https://electric-ai-chat.examples.electric-sql.com).

Start by cloning the repo:

```sh
git clone https://github.com/electric-sql/electric-ai-chat.git
cd electric-ai-chat
```

Make sure you have [Node](https://nodejs.org/en/download), [pnpm](https://pnpm.io/installation), [Docker](https://docs.docker.com/compose/install/) and an [OpenAI API key](https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key).

Install the dependencies:

```sh
pnpm install
```

Start Postgres and Electric using Docker:

```sh
docker compose up -d
```

Start the backend API:

```sh
export OPENAI_API_KEY=<your-openai-api-key>
pnpm dev:api
```

You can then run the demo app with:

```sh
pnpm dev:app
```

Open your browser at [localhost:5173](http://localhost:5173)

### More info

See the [Docs](/docs/intro) and [Demos](/demos), including the [Typescript Client](/docs/api/clients/typescript) and [React bindings](/docs/integrations/react).

If you have any questions, [Join the Discord](https://discord.electric-sql.com), where you can connect with the Electric team and other developers building on sync.

When you're ready to deploy, the easiest way to get up-and-running with sync in 30 seconds is to use the [Electric Cloud](https://dashboard.electric-sql.cloud).

<div class="actions cta-actions page-footer-actions left">
  <div class="action cloud-cta">
    <VPButton
        href="https://dashboard.electric-sql.cloud"
        text="Sign-up to Cloud"
        theme="brand"
    />
    &nbsp;
    <VPButton
        href="https://discord.electric-sql.com"
        text="Join Discord"
        theme="alt"
    />
  </div>
</div>
