---
title: '...'
description: >-
  ...
excerpt: >-
  ...
authors: [balegas]
image: /img/blog/one-shot-your-app-on-electric/header.jpg
tags: [electric, durable-streams, tanstack-db, agents, intent]
outline: [2, 3]
post: true
published: false
---

<!-- ASSET: Video of the full one-shot experience — command to running app. This is the hero asset. -->

Can you one-shot the app you want? One command — describe your app and a team of agents builds it live on Electric and TanStack&nbsp;DB.

```bash
npx @electric-sql/start --one-shot "a collaborative task board with real-time sync"
```

Database provisioned. Sync wired. App running. No sign-up required.

> [!Info] Links
> - [Electric quickstart](/docs/quickstart)
> - [create-electric-app](https://github.com/balegas/create-electric-app)
> - [Durable Streams](https://durablestreams.com)
> - [Agent skills now shipping](/blog/2026/03/06/agent-skills-now-shipping)
> - [TanStack Intent: From Docs to Agents](https://tanstack.com/blog/from-docs-to-agents)

## The pieces are in place

<!-- SECTION: Situation. Matter-of-fact, confident. The reader already knows agents
     are capable. Set up the pieces as things that exist and work. Open with the
     paradigm shift — we built this for developers and it turns out agents need
     the same things. -->

We spent years making Electric easy for developers — instant provisioning, composable primitives, clear APIs. Turns out, the same properties that make a platform easy for developers make it easy for agents.

Coding agents are really good at writing code. Given the right context, they produce working features.

[Intent](https://tanstack.com/blog/from-docs-to-agents) ships agent skills with npm packages — agents that install `@tanstack/db` or `@electric-sql/client` get versioned knowledge of how to use them correctly.

Electric provisions sync infrastructure instantly — database, sync service, no human in the loop.

## The missing piece

<!-- SECTION: Complication. Not doom and gloom — just the last piece that was
     missing, and the insight that fills it. The tone is recognition, not alarm. -->

The knowledge is there. The infrastructure is there. What's missing is a way for agents to work together — a coder and a reviewer collaborating on the same app in real-time. There's no standard primitive for multi-agent coordination.

Durable streams turn out to be that primitive. A shared, persistent, addressable stream that agents read from and write to — and that you can watch live.

<!-- SECTION: Implicit question — what does it look like when all these pieces
     (agent knowledge, instant infrastructure, multi-agent coordination)
     actually come together? The rest of the post answers this. -->

## One command, running app

<!-- SECTION: Answer (a). The hook made tangible. Walk the reader through what
     actually happens. Keep it concrete: commands, URLs, what they see. Make
     them want to try it. -->

You run `npx @electric-sql/start --one-shot "a collaborative task board with real-time sync"`.

The CLI provisions a Postgres database (via Neon) and an Electric sync service.

It launches a multi-agent session: a coder and a reviewer working in a loop — the coder plans and builds, the reviewer catches issues. You can bring in a UX expert agent when you want one.

You get a URL in your terminal. Open it and you're watching agents collaborate in real-time — designing the schema, writing components, reviewing each other's output.

<!-- ASSET: GIF or screenshot of terminal output showing the URL + the web UI
     with agents working -->

The agents use your local Claude installation — `--one-shot` orchestrates [create-electric-app](https://github.com/balegas/create-electric-app) under the hood, connecting your Claude to the multi-agent room.

When they're done, you have a working TanStack app with real-time sync, a live database, and migrations already run. `pnpm dev` and it's running.

<!-- ASSET: Screenshot of the finished app running locally -->

> [!Info] No sign-up required
> The database and Electric source are provisioned in a claimable state. Run your app, try it out, and when you're ready, claim the resources to your Electric account. Until then, everything just works.

## Multi-agent rooms on durable streams

<!-- SECTION: Answer (b). The technical meat. Explain why durable streams are the
     right primitive for multi-agent coordination. Show the architecture without
     turning it into a docs page. The reader should come away thinking
     "that's a clean design." -->

Each agent has its own durable stream — its individual log of everything it does: tool calls, file writes, reasoning. That's the agent's full history.

Agents share messages with the room by writing to a shared room stream. `@room` broadcasts to everyone, `@coder` or `@reviewer` routes to a specific agent. Messages without a prefix stay in the agent's own log — internal reasoning doesn't flood the room.

Agents talk to each other through the room, not directly. A room router watches the room stream and delivers messages to the right agent.

<!-- ASSET: Diagram showing individual agent streams + shared room stream, with
     the web UI subscribed to all of them -->

Durable streams make the whole thing observable, live, and persistent. The web UI subscribes to all the streams — you see each agent's work in real-time and the conversation flowing through the room. You can interact through gates — approve a plan, request changes, add an agent.

Disconnect and come back — the streams catch you up from where you left off. No state lost. Share the room link and someone else can follow along or jump in.

This is the same primitive we built for [real-time sync and AI token streaming](/blog/2025/12/09/announcing-durable-streams).

## An open platform that works with your stack

<!-- SECTION: Answer (c). Zoom out. The one-shot works because the pieces are
     decoupled and composable. Each one does its job, they compose cleanly,
     and the result is a standard app. Confident but not salesy. -->

The app you get is a standard TanStack app. TanStack Start for the framework, TanStack&nbsp;DB for reactive queries, Electric for sync. No custom runtime, no lock-in to the one-shot tooling.

Each piece that makes the one-shot work is independent and useful on its own:

- **Intent** teaches agents your libraries — versioned skills that ship with the npm packages and update when you `npm update`. ([Agent skills now shipping](/blog/2026/03/06/agent-skills-now-shipping))
- **Electric** provisions infrastructure and handles sync — database, sync service, ready in seconds.
- **Durable streams** coordinate the agents and enable collaboration — you watch, interact, and pick up where you left off. They power any use case where you need persistent, real-time streaming.

The one-shot is a showcase of these pieces working together. But you can use any of them independently — add intent skills to your existing project, use Electric for sync without the one-shot, use durable streams for your own multi-agent setup.

## Next steps

Think you can one-shot your app? Run the command and find out.

```bash
npx @electric-sql/start --one-shot
```

Claim your resources on [Electric](/docs/quickstart) when you're ready. Explore [durable streams](https://durablestreams.com), [intents](https://tanstack.com/blog/from-docs-to-agents), and [TanStack&nbsp;DB](/products/tanstack-db).

***

<!-- DELETE EVERYTHING BELOW THIS LINE BEFORE PUBLISHING -->

<!-- ## Meta

### Intent
- **What is this post about?** You can now one-shot a full Electric + TanStack
  app from a single command, powered by multi-agent collaboration over durable
  streams.
- **What's interesting about it?** One command gives you a live app with
  real-time sync, a provisioned database, and cloud infrastructure. You watch
  multiple agents collaborate to build it in real-time through a shared room.
- **Reader takeaway?** "I can go from an idea to a working, syncing app with a
  live database in minutes — no sign-up, no setup."
- **CTAs?** Challenge: think you can one-shot your app idea? Try it. Claim your
  cloud resources after.
- **Why us?** We built Electric to work with your stack. The one-shot showcases
  that — agents use intents to learn TanStack and Electric, durable streams to
  coordinate, and the result is a standard TanStack app with real-time sync.

### Title brief
Sentence case. Should convey challenge/invitation tone. Options:
- "One-shot your app on Electric"
- "Can you one-shot your app?"
- Something hinting at multi-agent + durable streams without being wordy

### Description brief (SEO)
What the --one-shot flag does, that it uses multi-agent collaboration on durable
streams, and that it provisions Electric infrastructure with no sign-up. Should
mention TanStack DB.

### Excerpt brief (blog listing card)
The challenge — one command, agents build your app live. 2-3 short sentences
matching length of other Electric blog excerpts.

### Image prompt
- Concept: Multiple agents collaborating in a shared space, building something
  together — streams connecting them
- Aspect ratio: 16:9 (~1536x950px)
- Dark theme background
- Brand colors: #D0BCFF (purple), #00d2a0 (green), #75fbfd (cyan),
  #F6F95C (yellow)
- Center-center composition
- Style: Abstract/architectural, not literal robots. Data flows and connected
  nodes.

### Asset checklist
- [ ] Video: full one-shot experience (hero asset)
- [ ] Diagram: agent streams + room stream architecture
- [ ] Screenshot: finished app running locally
- [ ] Header image

### Typesetting checklist
- [ ] Non-breaking spaces where appropriate (product names, etc.)
- [ ] Sentence case in title
- [ ] Check title, image, and post at different screen widths
- [ ] No LLM tells

### Open questions
- Final title
- Video: who's recording it, what app idea to showcase?
- Should the post include terminal output or let the video carry it?
- How much detail on the room protocol (@room, @coder) — inline or link to repo?

-->
