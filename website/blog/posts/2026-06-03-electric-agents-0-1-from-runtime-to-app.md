---
title: "..."
description: >-
  ...
excerpt: >-
  ...
authors: [samwillis]
image: /img/blog/electric-agents-0-1-from-runtime-to-app/header.jpg
tags: [electric-agents, agents, durable-streams, sync, devtools]
outline: [2, 3]
post: true
published: false
---

<!--
Release post outline.

Prose this up in place, then delete the comments/meta footer before publishing.
Keep the post factual and brisk: runtime/SDK release first, apps as preview
devtools/demo surfaces, managed Cloud Agents servers as coming soon.
-->

Electric Agents 0.1 is out today. It rounds out the framework we launched in April — agents as durable, addressable streams — with a broader set of primitives for building agentic systems.

The release gives you the runtime and SDK primitives: long-lived entities, StreamDB state, local and remote runners, spawning, forking, wakes, signals, schedules, self-sends, app APIs, and multi-agent coordination patterns. The apps are in preview as devtools and demo surfaces. Managed Agents servers in Electric Cloud are coming soon.

> [!Info] Get started with Electric Agents
> Run the [Quickstart](/docs/agents/quickstart), read the [docs](/docs/agents/), watch the demos in this post, or revisit the [original Electric Agents launch post](/blog/2026/04/29/introducing-electric-agents).

<!-- ASSET: Header image. Runtime/SDK release visual: durable streams / StreamDB entities, runners, and app/devtools preview. Could still include desktop UI + code, but app should not read as the launch headline. Dark theme, Electric brand colours, 16:9 or 16:10, center-safe composition. -->

## Context

<!--
Brief orientation only. Do not re-argue the April launch post. This should say
what has become more complete since the April launch.
-->

- In April we introduced Electric Agents as the agent platform built on sync: agents are durable, addressable streams of state, not hidden processes trapped behind a chat UI.
- 0.1 expands the core verbs and primitives: define agents, run them on runners, wake them from events, spawn children, fork history, signal active work, schedule future work, and build apps on top.
- The apps are the preview and devtools surface. They show what it feels like to inspect, steer, and operate agent systems built on the SDK, but the release is the framework.

## Every entity is a StreamDB

<!--
This is the architectural core. Explain the durable entity model clearly before
touring features. The reader should leave understanding that "agent = persistent
StreamDB-backed entity", not a transient process.
-->

- An Electric Agents entity is a long-lived, addressable thing: an assistant, worker, coding session, support ticket, lead researcher, orchestrator, monitor, or any agent type you define.
- Every entity has a durable stream and a typed StreamDB projection. The stream is the log; the StreamDB is the live state, timeline, inbox, runs, tool calls, context, errors, children, signals, and custom collections.
- The process that handles a wake can come and go. The entity persists. It can sleep, wake, replay, fork, spawn children, and be observed by apps or other agents.
- This is what makes the framework feel different from a local chat loop. The agent is not the process. The agent is the durable, observable state.

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

## The verbs

<!--
This is the main feature tour. It should be skimmable and map directly to demos.
Include tags sparingly. These are the "nothing else has all of this" primitives.
-->

- **Define** entity types with typed state, inbox schemas, handlers, permissions, and tools. `SDK`
- **Run** agent loops that append runs, steps, text, reasoning, tool calls, and errors to the entity stream. `Runtime`
- **Spawn** a new entity without parent history. Use this for fresh children, workers, fan-out, and multi-layer agent trees. `SDK`
- **Fork** an entity with history. Use this to branch a session from a point in time, keep context, and try another path. `Runtime` `App preview`
- **Send** messages to any entity, including **send-to-self** for delayed continuation, steering, or internal work queues. `SDK`
- **Wake** entities from inbox messages, child completion, state changes, cron, future sends, webhook/event sources, and Postgres sync triggers. `Runtime`
- **Observe** entities, shared state, entity lists, timelines, and child state in real time. Use this from handlers or from apps. `SDK` `App APIs`
- **Schedule** work with cron and future sends. Agents can sleep until the next scheduled wake. `Runtime`
- **Signal** running agents: interrupt, pause, resume, kill, or deliver handler-level lifecycle signals. `Runtime` `CLI` `App preview`
- **Coordinate** with shared state and multi-agent patterns: orchestrator/worker, blackboard, reactive observers, map-reduce, pipelines, and nested swarms. `SDK`
- **Connect** external tools and systems with MCP servers, event-source subscriptions, webhooks, and PG sync-driven triggers. `Runtime`
- **Inspect** every entity as a StreamDB: timeline, inbox, runs, tool calls, child status, errors, signals, attachments, and custom collections. `App APIs` `App preview`

<!-- ASSET: Compact feature grid or "verb map" graphic. Each verb with a tag and demo/video marker. -->

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

## Build apps on top

<!--
This is the "not just an app" section. Emphasize API surface and custom apps:
agent lists, timelines, entity views, spawn/send/signal controls, etc.
-->

- The same APIs powering the preview apps are available to application developers.
- Use the runtime server client to spawn entities, send messages, create schedules, upload attachments, signal agents, and subscribe to event sources.
- Use observation APIs to build live UIs over entity lists, timelines, shared state, and custom collections.
- Build the app shape you need: an internal ops dashboard, a support console, a research swarm UI, a coding workbench, or a workflow-specific agent monitor.
- Horton is the built-in assistant, but your own entity types appear in the app and can be spawned, messaged, inspected, and controlled in the same way.

<!-- ASSET: Code sample or screenshot. Minimal custom app showing an entity list, clickable timeline, and spawn/send controls. -->

## App previews

<!--
Apps are not the main launch now. Position them as preview/devtools/demo surfaces
that prove the framework and show the product direction.
-->

- The desktop app preview is devtools for the runtime and SDK: inspect entities, timelines, state, runs, tool calls, errors, runners, MCP servers, model providers, and server connections.
- It is also a general chat and coding agent surface: Horton as the built-in assistant, Worker for delegated subtasks, and your custom agents alongside them.
- The mobile app previews show the remote-control workflow: connect to an Agents server, browse sessions, open live timelines, send messages, and signal running agents from your phone.
- We are using the apps to dogfood the framework and build toward our own software factory: agents that shepherd PRs and issues, keep work moving, and let everyone connect to the same durable session.

<!-- ASSET: Desktop app preview screenshot/video. Label clearly as app preview / devtools. -->
<!-- ASSET: Mobile app preview screenshot/video. Label clearly as preview. -->

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
Primary CTA: quickstart from the CLI. Apps are preview surfaces if links exist.
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
- More examples and docs for app builders: PG sync triggers, event sources, MCP, attachments, sandbox profiles, and multi-agent patterns.
- More app preview polish: desktop builds, smoother downloads and updates, and richer mobile distribution.

## Next steps

<!--
Final CTA, not a second conclusion. Keep it short.
-->

- Run `npx electric-ax agents quickstart`.
- Read the [Electric Agents docs](/docs/agents/).
- Watch the demos in this post.
- Try the app previews if linked.
- Join the [Electric Discord](https://discord.electric-sql.com) and tell us what you build.

***

<!--
DELETE BEFORE PUBLISHING

## Intent

- What is this post about?
  - Electric Agents 0.1 launches the runtime and SDK for building durable, persistent agent systems: every entity is a StreamDB, compute runs on local or remote runners you control, the apps are preview/devtools surfaces, and managed Electric Cloud support for Agents servers is coming soon.
- What is interesting about it?
  - Electric Agents 0.1 is the verbs and primitives release: spawn, fork, wake, observe, signal, schedule, send-to-self, coordinate through StreamDB, and build apps on top.
- Reader takeaway:
  - Electric Agents is a framework for building agentic systems, now with a more complete set of primitives: durable entities, StreamDB state, runners, coordination verbs, signals, scheduling, app APIs, and preview devtools for inspecting and controlling the agents you build.
- CTAs:
  - Run `npx electric-ax agents quickstart`.
  - Read the updated docs.
  - Watch the demos/videos in the post.
  - Try the app previews if linked.
- Why us?
  - Electric built the underlying stream and sync primitives, the TanStack DB integrations, the Electric Agents runtime/SDK, and the preview app/devtools surfaces. The apps are dogfood and the beginning of Electric’s own software-factory automation.

## Title brief

Direction: lead with the 0.1 framework/runtime release, not the app preview.
Working title options: “Electric Agents 0.1 released”, “Electric Agents 0.1: agents as StreamDBs”, “Electric Agents 0.1: the verbs release”.
Titles must use sentence case.

## Description brief

SEO description should say that Electric Agents 0.1 ships the runtime and SDK for building durable, persistent, StreamDB-backed agent systems, with local/remote runners, coordination verbs, app APIs, and preview devtools. Mention managed Agents servers in Electric Cloud coming soon.

## Excerpt brief

Max three short sentences. Mention runtime/SDK first, then app previews and Cloud coming soon. Example direction: “Electric Agents 0.1 is the runtime release for durable, persistent agents. Every entity is a StreamDB, every runner is yours to control, and the preview apps show how to inspect and steer the systems you build.”

## Image prompt

Durable agent framework visual. Dark theme. Show several persistent entity nodes as StreamDB-backed streams, with runners claiming wakes and a preview app/devtools surface observing them. Include a small code panel defining an entity/handler. Avoid making the desktop app look like the primary launch headline. Electric brand colours: purple #D0BCFF, green #00d2a0, cyan #75fbfd, yellow #F6F95C, orange #FF8C3B. 16:9 to 16:10, target ~1536x950px, key content center-safe for responsive cropping.

## Asset checklist

- [ ] Header image: entities as StreamDBs, runners, and app/devtools preview.
- [ ] Diagram: entity -> durable stream -> StreamDB collections -> observers/subscribers.
- [ ] Diagram/video: local vs remote runners.
- [ ] Video: forking vs spawning, parent history vs fresh child.
- [ ] Video: every agent as StreamDB / inspector.
- [ ] Video: James' multi-layer spawning demo.
- [ ] Video: signals quick tour.
- [ ] Video: PG sync trigger / reactive agents.
- [ ] Desktop app preview screenshot/video: workspace/session/timeline/settings.
- [ ] Mobile preview screenshot/video: session/chat with remote-control signalling.
- [ ] Optional quickstart split screenshot: terminal command + live app timeline.

## Open questions

- Final title.
- Whether to rename file/slug away from “from-runtime-to-app”.
- Which demos/videos are ready today.
- Exact wording and timing for managed Agents servers in Electric Cloud coming soon.
- Whether app preview links should be included or only shown in videos.

## Typesetting checklist

- Use non-breaking spaces (`&nbsp;` in HTML, `\u00A0` in frontmatter) and non-breaking hyphens where appropriate to avoid widows and orphans.
- Titles MUST use sentence case, not Title Case.
- Check title, image, and general post at different screen widths.
- Avoid LLM tells: “it’s worth noting”, “importantly”, “in conclusion”, “let’s dive in”, “at its core”, “in today’s landscape”.
-->
