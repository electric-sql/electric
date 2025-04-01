---
title: "Why AI needs sync"
description: >-
  Why should centralised, cloud-first AI systems be built on sync?
  What problems does sync actually solve for them?
excerpt: >-
  Most AI apps run in the cloud and work by calling out to web services
  like the OpenAI API and MCP Servers. Why should these centralised,
  cloud-first AI apps be built on sync?
authors: [thruflo]
image: /img/blog/why-ai-needs-sync/header.jpg
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

There's a consensus forming that AI apps should be built on sync.

Sunil Pai's framing is that [AI agents are local-first clients](https://sunilpai.dev/posts/local-first-ai-agents/). Theo Brown is [searching for the ideal sync engine](https://youtu.be/3gVBjTMS8FE) *(spoiler alert, if you're on Postgres it's [Electric](https://electric-sql.com))*.

However, most AI apps run in the cloud and work by calling out to web services like [OpenAI APIs](https://openai.com/api/) and [MCP servers](https://modelcontextprotocol.io/introduction). Why should these centralised, cloud-first AI apps be built on sync? What problems does sync actually solve for them?

The answer is a raft of practical concerns, including [resumeability](#resumeability), [interruptability](#interruptability), [multi&#8209;device](#multi-device), [multi&#8209;user](#multi-user) and [multi&#8209;step](#multi-step-workflows) workflows.

These are not edge-cases. They are concerns that cut to the core of AI UX and they're solved, elegantly, by sync.

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

For example, here's how better systems like [Assistant-UI](https://www.assistant-ui.com) and [Lobe Chat](https://github.com/lobehub/lobe-chat) (that are both built on Electric) behave:

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

<img src="/img/blog/why-ai-needs-sync/multi-tab-broken.png" style="width: 95%" />

Or worse, they kick off the same prompt twice because they think it's not running. Now they have two threads competing to do the same thing.

Who are they going to blame? Your software.

So even just the possibility of multiple browser tabs means you need to split that stream and keep both tabs in sync.

>
> ... diagramme of model -> token stream -> store -> two streams -> two UIs ...
>

But, of course, the world is not just about browser tabs. Agents do stuff in the background. What are the chances your user is going to grab their mobile, nip across to [Linea Coffee](https://lineacaffe.com) on Mariposa and check progress while waiting in the queue?

<figure style="border-radius: 16px; overflow: hidden">
  <img src="/img/blog/why-ai-needs-sync/nipping-out-for-coffee.jpg" />
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
    <img src="/img/blog/why-ai-needs-sync/figma.png" style="margin: -30px 0" />
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

This fixes the problem where the user is frantically clicking or saying "stop" but Claude just ignores it and carries on generating artefacts.

## Agents are users

But of course, human users are not the only thing that can interrupt flows and update data. An agent is not just an interface. An agent is an actor.

Agents can [send notifications](https://modelcontextprotocol.io/docs/concepts/transports#notifications) and update application state.

>
> ... chat demo pinning and renaming example video ...
>

So, as soon as you have a user interacting with an agent, you have a multi-user app. Every conversation with an AI agent is inherently multi-user. It's at least you and the AI.

But also ... you're not just going to have one agent. Soon, we're going to have [armies of agents](https://github.com/openai/openai-agents-python). With shared context and situational awareness.

<figure style="border-radius: 16px; overflow: hidden">
  <a href="https://github.com/openai/openai-agents-python" class="no-visual" target="_blank">
    <img src="/img/blog/why-ai-needs-sync/swarm.png" /></a>
</figure>

Core AI software like [LangGraph](https://www.langchain.com/langgraph) has known this for a while but doesn't solve the last mile problem of syncing into user-facing apps.

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

These agents need to collaborate via shared state. In this example, the todo-list. They need to known when it's changed and react to the changes. And so do the users! They want to see the state too. That's what sync allows you to do.

For example, this is the Electric code to monitor and react to the todolist:

>
> ... code sample ...
>

### With added chaos

When you call an API or function you typically know the "blast radius" of what data it can change. So you can know what to refetch. When you interact with an AI agent (that has any kind of agency) you don't know what it's going to change.

So you either need to constantly track and re-fetch everything. Or you need to monitor what data changes, so that you're automatically informed about it. What you really need is a way of declaring the subset of the data that the app, agent or UI depends on so you can automatically monitor it, stay up-to-date and be able to respond to changes.

That's why Sunil says that [AI agents are local-first clients](https://sunilpai.dev/posts/local-first-ai-agents/). That's why Theo is [searching for the ideal sync engine](https://youtu.be/3gVBjTMS8FE).


## AI needs sync

Sync solves a range of practical AI UX challenges in resumeability, interruptibility, multi-tab, multi-device and multi-user. And it provides the data layer for the next-generation of interactive AI apps and agents.

That's the future of software. It's powered by sync. Electric has [sync solved](/).

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