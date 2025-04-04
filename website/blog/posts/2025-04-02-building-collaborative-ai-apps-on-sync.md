---
title: Building collaborative AI apps? You need sync.
description: >-
  AI apps are collaborative. Building then requires solving resumeability,
  interruptability, multi‑tab, multi‑device and multi‑user.
excerpt: >-
  AI apps are collaborative. Building then requires solving resumeability,
  interruptability, multi‑tab, multi‑device and multi‑user.
authors: [thruflo]
image: /img/blog/building-collaborative-ai-apps-on-sync/header.jpg
tags: [ai, sync]
outline: [2, 3]
post: true
---

<script setup>
  import Card from '../../src/components/home/Card.vue'
  import PartialReplicationDiagramme from '../../src/components/home/PartialReplicationDiagramme.vue'
</script>

<style scoped>
  .partial-replication-diagramme :deep(.container) {
    margin: 0px 0px 10px;
  }
</style>

AI apps are collaborative. Building then requires solving [resumeability](#resumeability), [interruptability](#interruptability), [multi&#8209;tab](#multi-device), [multi&#8209;device](#multi-device) and [multi&#8209;user](#multi-user).

These are not edge-cases. They're core to [user-agent collaboration](#collaboration) and the new world of [multi&#8209;step, task&#8209;and&#8209;review workflows](#multi-step-workflows). They're also [key growth hacks](#to-replacing-saas) for products looking to replace current-generation SaaS and enteprise software.

As AI apps become more collaborative, with multiple users interacting with the same AI session and those sessions spawning more and more agents, these challenges are only going to get more important. Luckily, they're all [solved by&nbsp;sync](#sync-is-the-solution).

## Resumeability

Most AI apps stream tokens into the front-end. That's how Claude and ChatGPT write out their response to you, one word at a time.

>
> ... diagramme of model -> token stream -> UI ...
>

If you stream directly from the agent to the UI, you have a fragile system. Your app breaks when the connection drops and when the user refreshes the page.

For example, here's how ChatGPT behaves:

>
> ... video showing it break for refresh and patchy network ...
>

If, instead, you stream tokens into a store and then subscribe to that store then you get a resilient UI that doesn't break.

>
> ... diagramme of model -> token stream -> store -> stream -> UI ...
>

For example, here's how better systems like [Assistant-UI](https://www.assistant-ui.com) and [Lobe Chat](https://github.com/lobehub/lobe-chat) (both are building on Electric) behave:

>
> ... two videos side by side showing not breaking ...
>

The key to this behaviour is resumeability: the ability to resume streaming from a known position in the stream. The app keeps track of the last position its seen. Then when re-connecting, it requests the stream from that position.

This pattern is fiddly to wire up yourself (message delivery is a [distributed systems rabbit hole](https://jepsen.io/consistency/models)) but is *baked in* to sync engines. For example, Electric's [sync protocol](/docs/api/http) is based on the client sending `offset` and `cursor` parameters.

These are usually abstracted away at a [higher-level](/docs/api/clients/typescript), e.g.:

```tsx
import { ShapeStream } from '@electric-sql/client'

const tokenStream = new ShapeStream({
  params: {
    table: 'tokens'
  }
})

// tokenStream.subscribe(tokens => ...)
```

But under the hood, the sync protocol provides automatic resumeability. So apps just work and users don't swear at your software when their vibes disappear.

<!-- James' talk video here when published -->

## Multi-device

You know another thing users do? They open multiple browser tabs and they flit in and out of your app. Talk to Claude, check your emails, talk to Claude, check Instagram, ...

So what do you do when they open your app in two tabs at the same time? They can't remember which tab they used last. They're just confused when their session isn't there. Where did my vibes go?!

<img src="/img/blog/building-collaborative-ai-apps-on-sync/multi-tab-broken.png" style="width: 95%" />

Or worse, they kick off the same prompt twice because they think it's not running. Now they have two threads competing to do the same thing.

Who are they going to blame? Your software.

So even just the possibility of multiple browser tabs means you need to split that stream and keep both tabs in sync.

>
> ... diagramme of model -> token stream -> store -> two streams -> two UIs ...
>

But, of course, the world is not just about browser tabs. Agents do stuff in the background. What are the chances your user is going to grab their mobile, nip across to [Linea Coffee](https://lineacaffe.com) on Mariposa and check progress while waiting in the queue?

<figure style="border-radius: 16px; overflow: hidden">
  <img src="/img/blog/building-collaborative-ai-apps-on-sync/nipping-out-for-coffee.jpg" />
</figure>

In this example, how do you keep the mobile app up-to-date with the session that was started in the browser? This is exactly what sync does. It handles *fan out*, so you can (resiliently) stream changes to multiple places at the same time.

For example, with Electric, you can just write changes to Postgres and then Electric takes care of fanning-out data delivery to as many clients as you like (you can literally scale to [millions of clients](/docs/reference/benchmarks#cloud) straight out of the box).

So whichever device your user grabs or tab they return to, it can be up-to-date and exactly in the state they're expecting:

>
> ... demo videos desktop and mobile side by side ...
>

## Multi-user

In an [Onion-style newsflash](https://theonion.com/area-man-accepts-burden-of-being-only-person-on-earth-w-1819579668/), it turns out that our brave user is not the only person in the world. They have work colleagues, friends and family members.

Traditional software was designed around this. Work colleagues can collaborate on Figma designs. Friends and family members can plan holidays using Airbnb wishlists.

<figure style="border-radius: 16px; opacity: 0.82; overflow: hidden">
  <a href="https://www.figma.com/blog/introducing-figma-community/" class="no-visual"
      target="_blank">
    <img src="/img/blog/building-collaborative-ai-apps-on-sync/figma.png" style="margin: -30px 0" />
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
    where: 'session_id = 1234'
  }
})
```

Which really changes the game for AI UX. Because it allows users to collaborate on the same AI session.

### Collaboration

For example, here we show a chat app built on Electric where two users are talking to the same AI. A context resource provided by the second user interrupts the agent handling the first user's prompt and makes the response much more informed and accurate:

>
> => two users talking to the same AI
>  - => user 1 asks a question
>    - response is a bit iffy
>  - => user 2 adds a resource
>  - => user 1 asks the same question again
>    - response is awesome
>  - collab but updates the underlying data
>

This is a simple example but it's the tip of the iceberg of [things to come](#agents-are-users).

### Interruptibility

The interrupt in this example is another illustration of the power of syncing into a store before syncing into the UI. Because the stream to the UI is under our control, we can pause it instantly, even while the underlying agent (which is out of our direct control) continues to the end of it's stream.

>
> ... code sample ...
>

This fixes the problem where the user is frantically clicking or saying "stop" but Claude just ignores it and carries on generating artifacts.

## Agents are users

Human users are not the only thing that can interrupt flows and update data. An agent is not just an interface. An agent is an actor. They can [send notifications](https://modelcontextprotocol.io/docs/concepts/transports#notifications) and [update application state](https://modelcontextprotocol.io/docs/concepts/tools).

>
> ... chat demo pinning and renaming example video ...
>

So, as soon as you have a user interacting with an agent, you have a multi-user app. Every conversation with an AI agent is inherently multi-user. It's at least you and the AI.

### Swarms

You're also not going to just have one agent. Soon, we're all going to have [swarms of agents](https://github.com/openai/openai-agents-python) running around in the background for us. These are going to need to share context and have situational awareness.

<figure style="border-radius: 16px; overflow: hidden">
  <a href="https://github.com/openai/openai-agents-python" class="no-visual" target="_blank">
    <img src="/img/blog/building-collaborative-ai-apps-on-sync/swarm.png" /></a>
</figure>

Tools like [LangGraph](https://www.langchain.com/langgraph) provide a shared data layer for agents. However, they don't solve the last mile problem of syncing into user-facing apps to also keep the human in the loop. State can't just be in the cloud. Users are agents too!

For example, imagine you're managing a project and you have an AI assistant. You tell it to "monitor the todo list and perform the tasks". You then fire up a new session with another agent to plan out the project and generate tasks.

>
> 7. Electric collaborative agents updating state
>  1. kick off long running dev task
>    => "monitor the todo list and perform the tasks"
>  2. background it -> open new session
>  3. add new task
>  4. navigate to the first session and see that it's performed the task
>  5. fire up multi-user across 3 windows
>  6. user closes a todo and it interrupts the task
>

These agents need to collaborate via shared state. In this example, the todo-list. They need to known when it's changed and react to the changes. And so do the users! They want to see the state too.

For example, this is the Electric code for the agents to monitor and react to the todolist:

>
> ... code sample ...
>

This is the code to show the same state to the user:

>
> ... code sample ...
>

### Structure

So far, when discussing streaming, we've focused on tokens. But models are just as adept at returning structured data. This is another major advantage of streaming through a store. That store can be a structured database.

This allows agents to collaborate on different parts of a shared state, by working on different parts of a structured data model. For example, one agent can be outlining the high level structure of a Figma project whilst another agent fills in the details on each of the canvases.

### Chatter

The more agents there are out there, the higher your query costs. Querying a data warehouse can be very expensive. Human data analysts tend to limit their query throughput by taking time to understand the responses. AI agents can issue and analyse queries much faster, generating higher query workload. Swarms of agents are going to amplify this further.

The main way to mitigate this is with [caching](/use-cases/cache-invalidation). I.e.: don't hit the warehouse if you can avoid it. [One pattern](https://www.smalldatasf.com/#manifesto) for this is to maintain a local working set that can answer most queries.

### Chaos

When you call an API or function you typically know the "blast radius" of what data it can change. So you can know what to refetch. When you interact with an AI agent (that has any kind of agency) you don't know what it's going to change.

So you either need to constantly track and re-fetch everything. Or you need to monitor what data changes, so that you're automatically informed about it. What you really need is a way of declaring the subset of the data that the app, agent or UI depends on so you can automatically monitor it, stay up-to-date and be able to respond to changes.

That's why Sunil Pai says that [AI agents are local-first clients](https://sunilpai.dev/posts/local-first-ai-agents/). That's why Theo Brown is [searching for the ideal sync engine](https://youtu.be/3gVBjTMS8FE) and it's why Electric syncs [Shapes](/docs/guides/shapes).


## Sync is the solution

Sync solves a range of practical challenges with AI UX. From resumeability and interruptibility to multi-tab, multi-device and multi-user.

As AI agents become more collaborative and autonomous (and lots more of them are spawned), then sharing state, reviewing progress, reacting to changes and maintaining local data sets are all going to get more important.

### To replacing SaaS

For AI apps to deliver on their promise of replacing current-generation SaaS and enterprise software, they need to match and then exceed the capabilities of the current software. SaaS has had decades to build out multi-user support and team-based collaboration. Single-user AI sessions are not going to scale across the enterprise.

Teams building AI products that are serious about scaling and market adoption need to make sure they're collaborative. That means building on sync. Sync is a hard problem to solve yourself. That's why Electric [solves sync](/).

### Let's jump in

As you've seen, this post is accompanied by a resilient, multi-user, agentic chat demo. You can see the source code at [electric-sql/ai-sync-demo](https://github.com/electric-sql/ai-sync-demo).

The fastest way to run the demo is to [sign up for the Electric Cloud](/product/cloud/sign-up), clone the repo:

```sh
git clone https://github.com/electric-sql/ai-sync-demo.git
```

And update the `.env` file with the `SOURCE_ID` and `SECRET` provided by the cloud:

```sh
SOURCE_ID="..."
SECRET="..."
```

You can then run the demo using:

```sh
npm run dev
```

### More info

See the [Docs](/docs/intro) and [Demos](/demos), including the [Typescript Client](/docs/api/clients/typescript) and [React bindings](/docs/integrations/react).

If you have any questions, [Join the Discord](https://discord.electric-sql.com), where you can connect with the Electric team and other developers building on sync.

<div class="actions cta-actions page-footer-actions left">
  <div class="action cloud-cta">
    <VPButton
        href="/product/cloud/sign-up"
        text="Sign up"
        theme="brand"
    />
    &nbsp;
    <VPButton
        href="/docs/intro"
        text="Docs"
        theme="alt"
    />
    &nbsp;
    <VPButton
        href="https://discord.electric-sql.com"
        text="Discord"
        theme="alt"
    />
  </div>
</div>