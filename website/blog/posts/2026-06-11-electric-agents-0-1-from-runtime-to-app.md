---
title: "Electric Agents 0.1: from runtime to app"
description: >-
  ...
excerpt: >-
  ...
authors: [samwillis]
image: /img/blog/electric-agents-0-1-from-runtime-to-app/header.jpg
tags: [electric-agents, agents, durable-streams, sync, devtools]
outline: [2, 3]
post: true
published: true
---

<!--
Release post outline.

Prose this up in place, then delete the comments/meta footer before publishing.
Keep the post factual and brisk: runtime/SDK release first, apps as in-development
devtools/demo surfaces, managed Cloud Agents servers as coming soon.
-->

Electric Agents 0.1 is out today. It rounds out the [platform we launched in April](/blog/2026/04/29/introducing-electric-agents) — agents as durable, addressable streams — with a broader SDK and runtime surface for building agentic systems.

The release gives you the runtime and SDK primitives: [long-lived entities](/docs/agents/usage/defining-entities), StreamDB state, local and remote runners, [spawning and forking](/docs/agents/usage/spawning-and-coordinating), [wakes](/docs/agents/usage/waking-entities), [signals](/docs/agents/usage/signals), schedules, self-sends, [app APIs](/docs/agents/usage/programmatic-runtime-client), and multi-agent coordination patterns. The apps are in development as devtools and demo surfaces. You can download canary builds from [GitHub releases](https://github.com/electric-sql/electric/releases) or build them yourself from source. Managed Agents servers in Electric Cloud are coming soon.

> [!Info] Get started with Electric Agents
> Run the [Quickstart](/docs/agents/quickstart), read the [docs](/docs/agents/), watch the demos in this post, or revisit the [original Electric Agents launch post](/blog/2026/04/29/introducing-electric-agents).

<!-- ASSET: Header image. Runtime/SDK release visual: durable streams / StreamDB entities, runners, and app/devtools surface. Could still include desktop UI + code, but app should not read as the launch headline. Dark theme, Electric brand colours, 16:9 or 16:10, center-safe composition. -->

## What changed since April

<!--
Brief orientation only. Do not re-argue the April launch post. This should say
what has become more complete since the April launch.
-->

- In April we introduced [Electric Agents](/blog/2026/04/29/introducing-electric-agents) as the agent platform built on sync: agents are durable, addressable streams of state, not hidden processes trapped behind a chat UI.
- 0.1 expands the core primitives: define agents, run them on runners, wake them from events, spawn children, fork history, signal active work, schedule future work, and build apps on top.
- The apps are the in-development devtools surface. They show what it feels like to inspect, steer, and operate agent systems built on the SDK, but the release is the platform.
- For the deeper background, see our posts on [agents as data primitives](/blog/2026/04/08/data-primitive-agent-loop), [StreamDB](/blog/2026/03/26/stream-db), [forking durable streams](/blog/2026/04/15/fork-branching-for-durable-streams), and [durable sessions for collaborative AI](/blog/2026/01/12/durable-sessions-for-collaborative-ai).

## Every entity is a StreamDB

<!--
This is the architectural core. Explain the durable entity model clearly before
touring features. The reader should leave understanding that "agent = persistent
StreamDB-backed entity", not a transient process.
-->

- An [Electric Agents entity](/docs/agents/usage/defining-entities) is a long-lived, addressable thing: an assistant, worker, coding session, support ticket, lead researcher, orchestrator, monitor, or any agent type you define.
- Every entity has a durable stream and a typed StreamDB projection. The stream is the log; the StreamDB is the live state, timeline, inbox, runs, tool calls, context, errors, children, signals, and [custom collections](/docs/agents/usage/managing-state).
- The process that handles a wake can come and go. The entity persists. It can sleep, wake, replay, fork, spawn children, and be observed by apps or other agents.
- This is what makes the platform feel different from a local chat loop. The agent is not the process. The agent is the durable, observable state.

<!-- ASSET: Diagram or animation. One entity path -> durable stream -> StreamDB collections -> UI/agent subscribers. Show built-in collections and custom state as projections over the same stream. -->

## Runners: local compute, remote coordination

<!--
Explain local vs remote runners. This is important for Cloud coming soon and for
the phone-controlling-local-compute story.
-->

- Agents servers coordinate work. Runners do the compute.
- A runner can live on your laptop, in your infrastructure, in CI, or in any worker environment you control.
- The server stores entity streams, routes wakes, tracks runner health, manages schedules, enforces permissions, and lets apps observe live state.
- This separation is what enables remote control. Start a coding session on your machine, leave the compute there, then open the same session from your phone and send a follow-up, stop it, or ask it to fix something.
- Managed Agents servers in Electric Cloud are coming soon. The 0.1 runtime is built around the same local/remote runner model.

<!-- ASSET: Diagram or short video. Agents server/control plane in middle, local desktop runner on one side, remote/mobile/app clients on the other. Make clear compute stays with user-owned runners. -->

## Core primitives

<!--
This is the main feature tour. It should be skimmable and map directly to demos.
Include tags sparingly. These are the "nothing else has all of this" primitives.
-->

- **Define** entity types with [typed state, inbox schemas, handlers](/docs/agents/usage/defining-entities), permissions, and tools. `SDK`
- **Run** agent loops that append runs, steps, text, reasoning, tool calls, and errors to the entity stream. See [writing handlers](/docs/agents/usage/writing-handlers) and [configuring the agent loop](/docs/agents/usage/configuring-the-agent). `Runtime`
- **Spawn** a new entity without parent history. Use this for fresh children, workers, fan-out, and multi-layer agent trees. `SDK`
- **Fork** an entity with history. Use this to branch a session from a point in time, keep context, and try another path. See [spawning and coordinating](/docs/agents/usage/spawning-and-coordinating). `Runtime` `App`
- **Send** messages to any entity, including **send-to-self** for delayed continuation, steering, or internal work queues. `SDK`
- **Wake** entities from inbox messages, child completion, state changes, cron, future sends, webhook/event sources, and Postgres sync triggers. See [waking entities](/docs/agents/usage/waking-entities). `Runtime`
- **Observe** entities, shared state, entity lists, timelines, and child state in real time. Use this from handlers or from apps with the [runtime client](/docs/agents/usage/programmatic-runtime-client) and [React client APIs](/docs/agents/usage/clients-and-react). `SDK` `App APIs`
- **Schedule** work with cron and future sends. Agents can sleep until the next scheduled wake. `Runtime`
- **Signal** running agents: interrupt, pause, resume, kill, or deliver handler-level lifecycle signals. See the [signals guide](/docs/agents/usage/signals) and [CLI reference](/docs/agents/reference/cli). `Runtime` `CLI` `App`
- **Coordinate** with [shared state](/docs/agents/usage/shared-state) and multi-agent patterns: [orchestrator/worker](/docs/agents/entities/patterns/manager-worker), [blackboard](/docs/agents/entities/patterns/blackboard), reactive observers, map-reduce, pipelines, and nested swarms. `SDK`
- **Connect** external tools and systems with [MCP servers](/docs/agents/usage/mcp-servers), [event-source subscriptions](/docs/agents/usage/event-sources), webhooks, and PG sync-driven triggers. `Runtime`
- **Inspect** every entity as a StreamDB: timeline, inbox, runs, tool calls, child status, errors, signals, [attachments](/docs/agents/usage/attachments), and custom collections. `App APIs` `App`

<!-- ASSET: Compact feature grid. Each primitive with a tag and demo/video marker. -->

## Demos and videos

<!--
Use this section to place short demo videos. They do not all need to be polished.
The post should show the primitives in motion without turning into a giant essay.
-->

- **Forking and spawning.** Show the difference between spawning a fresh child and forking an entity with parent history.
- **Every agent is a StreamDB.** Show the inspector or timeline/state view: the same entity as messages, runs, tool calls, state, children, and stream rows.
- **Multiple layers of spawning.** Use James' demo or another nested agent tree to show parent -> child -> grandchild coordination.
- **Local vs remote runners.** Show a local runner doing the work while another client observes or controls the same session.
- **Signals quick tour.** Show `SIGINT`, pause/resume, kill, and handler-level signals from CLI or app.
- **PG sync triggers.** Show a Postgres change triggering an agent through sync/event plumbing.
- **Send to self and cron.** Show an agent scheduling its own future work or waking itself to continue.
- **Multi-agent patterns.** Briefly show blackboard/shared state, orchestrator/worker, reactive observers, or map-reduce.

<!-- ASSET: Video placeholder: forking vs spawning. -->
<!-- ASSET: Video placeholder: every agent as StreamDB / inspector. -->
<!-- ASSET: Video placeholder: James' multi-layer spawning demo. -->
<!-- ASSET: Video placeholder: local runner controlled remotely. -->
<!-- ASSET: Video placeholder: signals quick tour. -->
<!-- ASSET: Video placeholder: PG sync trigger / reactive agents. -->

## Apps in development

<!--
Apps are not the main launch now. Position them as in-development devtools/demo surfaces
that prove the platform and show the product direction.
-->

- The desktop app is in development and available as canary builds. It is devtools for the runtime and SDK: inspect entities, timelines, state, runs, tool calls, errors, runners, MCP servers, model providers, and server connections.
- It is also a general chat and coding agent surface: Horton as the built-in assistant, Worker for delegated subtasks, and your custom agents alongside them.
- The mobile apps are in development and show the remote-control workflow: connect to an Agents server, browse sessions, open live timelines, send messages, and signal running agents from your phone.
- You can download canaries from [GitHub releases](https://github.com/electric-sql/electric/releases) or build the apps yourself from the repo.
- We are using the apps to dogfood the SDK and runtime and build toward our own software factory: agents that shepherd PRs and issues, keep work moving, and let everyone connect to the same durable session.

<!-- ASSET: Desktop app screenshot/video. Label clearly as in development / devtools. -->
<!-- ASSET: Mobile app screenshot/video. Label clearly as in development. -->

## Coming soon: managed Agents servers in Electric Cloud

<!--
Cloud is coming soon, not launching today. Make the direction clear without
claiming availability unless this changes before publish.
-->

- Managed Agents servers in Electric Cloud are coming soon.
- They will provide the hosted control plane for durable entity streams, wakes, runners, schedules, permissions, and live observations.
- Your compute will still run where you choose: local, CI, your infrastructure, hosted workers, or future runner environments.
- The goal is the same cross-device workflow: start a coding session on your compute, then monitor, steer, or resume it from another device.

<!-- ASSET: Optional Cloud coming-soon diagram. Hosted control plane + user-owned runners + app clients. -->

## How to try it

<!--
Make this practical. The reader should be able to try something immediately.
Primary CTA: quickstart from the CLI. Apps are in development; link canary downloads if available.
-->

Run the quickstart from the CLI:

```sh
npx electric-ax agents quickstart
```

Open the UI, spawn Horton, send a message, and watch the timeline update as the agent thinks, calls tools, and responds.

Then define your own entity type and connect it to the same runtime and apps:

```ts
import {
  createEntityRegistry,
  createRuntimeHandler,
} from "@electric-ax/agents-runtime"

const registry = createEntityRegistry()

registry.define("assistant", {
  description: "A general-purpose AI assistant",
  async handler(ctx) {
    ctx.useAgent({
      systemPrompt: "You are a helpful assistant.",
      model: "claude-sonnet-4-6",
      tools: [...ctx.electricTools],
    })

    await ctx.agent.run()
  },
})

export const runtime = createRuntimeHandler({
  baseUrl: process.env.ELECTRIC_AGENTS_URL ?? "http://localhost:4437",
  serveEndpoint: "http://localhost:3000/webhook",
  registry,
})
```

Once registered, `assistant` appears as an entity type in the app. Spawn `/assistant/my-agent`, send it a message, and use the same timeline, state, and devtools surfaces that Horton uses.

<!-- ASSET: Optional terminal/app split screenshot. Left: quickstart command. Right: live Horton timeline in app. -->

## Coming next

<!--
Roadmap tease. Keep this grounded, not speculative.
-->

- Managed Agents servers in Electric Cloud.
- More examples and docs for app builders: PG sync triggers, [event sources](/docs/agents/usage/event-sources), [MCP](/docs/agents/usage/mcp-servers), [attachments](/docs/agents/usage/attachments), [sandbox profiles](/docs/agents/usage/sandboxing), and multi-agent patterns.
- More app development polish: desktop builds, smoother downloads and updates, and richer mobile distribution.

## Next steps

<!--
Final CTA, not a second conclusion. Keep it short.
-->

- Run `npx electric-ax agents quickstart`.
- Read the [Electric Agents docs](/docs/agents/).
- Watch the demos in this post.
- Download app canaries from [GitHub releases](https://github.com/electric-sql/electric/releases), or build them from source.
- Join the [Electric Discord](https://discord.electric-sql.com) and tell us what you build.

***

<!--
DELETE BEFORE PUBLISHING

## Intent

- What is this post about?
  - Electric Agents 0.1 launches the runtime and SDK for building durable, persistent agent systems: every entity is a StreamDB, compute runs on local or remote runners you control, the apps are in-development devtools surfaces, and managed Electric Cloud support for Agents servers is coming soon.
- What is interesting about it?
  - Electric Agents 0.1 is the primitives release: spawn, fork, wake, observe, signal, schedule, send-to-self, coordinate through StreamDB, and build apps on top.
- Reader takeaway:
  - Electric Agents is a platform for building agentic systems, with an SDK and runtime that now include a more complete set of primitives: durable entities, StreamDB state, runners, coordination APIs, signals, scheduling, app APIs, and in-development devtools for inspecting and controlling the agents you build.
- CTAs:
  - Run `npx electric-ax agents quickstart`.
  - Read the updated docs.
  - Watch the demos/videos in the post.
  - Download app canaries from GitHub releases or build them from source.
- Why us?
  - Electric built the underlying stream and sync primitives, the TanStack DB integrations, the Electric Agents runtime/SDK, and the in-development app/devtools surfaces. The apps are dogfood and the beginning of Electric’s own software-factory automation.

## Title brief

Direction: lead with the 0.1 platform release, especially the SDK and runtime, not the apps.
Working title options: “Electric Agents 0.1 released”, “Electric Agents 0.1: agents as StreamDBs”, “Electric Agents 0.1: the primitives release”.
Titles must use sentence case.

## Description brief

SEO description should say that Electric Agents 0.1 ships the runtime and SDK for building durable, persistent, StreamDB-backed agent systems, with local/remote runners, coordination APIs, app APIs, and in-development devtools. Mention managed Agents servers in Electric Cloud coming soon.

## Excerpt brief

Max three short sentences. Mention runtime/SDK first, then apps in development and Cloud coming soon. Example direction: “Electric Agents 0.1 is the runtime release for durable, persistent agents. Every entity is a StreamDB, every runner is yours to control, and the apps show how to inspect and steer the systems you build.”

## Image prompt

Durable agent platform visual. Dark theme. Show several persistent entity nodes as StreamDB-backed streams, with runners claiming wakes and an app/devtools surface observing them. Include a small code panel defining an entity/handler. Avoid making the desktop app look like the primary launch headline. Electric brand colours: purple #D0BCFF, green #00d2a0, cyan #75fbfd, yellow #F6F95C, orange #FF8C3B. 16:9 to 16:10, target ~1536x950px, key content center-safe for responsive cropping.

## Asset checklist

- [ ] Header image: entities as StreamDBs, runners, and app/devtools surface.
- [ ] Diagram: entity -> durable stream -> StreamDB collections -> observers/subscribers.
- [ ] Diagram/video: local vs remote runners.
- [ ] Video: forking vs spawning, parent history vs fresh child.
- [ ] Video: every agent as StreamDB / inspector.
- [ ] Video: James' multi-layer spawning demo.
- [ ] Video: signals quick tour.
- [ ] Video: PG sync trigger / reactive agents.
- [ ] Desktop app screenshot/video: workspace/session/timeline/settings.
- [ ] Mobile app screenshot/video: session/chat with remote-control signalling.
- [ ] Optional quickstart split screenshot: terminal command + live app timeline.

## Open questions

- Final title.
- Whether to rename file/slug away from “from-runtime-to-app”.
- Which demos/videos are ready today.
- Exact wording and timing for managed Agents servers in Electric Cloud coming soon.
- Whether app canary links should point directly to release assets or the GitHub releases page.

## Typesetting checklist

- Use non-breaking spaces (`&nbsp;` in HTML, `\u00A0` in frontmatter) and non-breaking hyphens where appropriate to avoid widows and orphans.
- Titles MUST use sentence case, not Title Case.
- Check title, image, and general post at different screen widths.
- Avoid LLM tells: “it’s worth noting”, “importantly”, “in conclusion”, “let’s dive in”, “at its core”, “in today’s landscape”.
-->
