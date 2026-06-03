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
Keep the post factual and brisk: apps first, then the runtime layers that make
the apps more than a UI shell.
-->

Electric Agents 0.1 ships the first product-shaped version of the Electric Agents stack: Agents servers in Electric Cloud preview, the runtime and SDK, the desktop app, and mobile app previews.

The app is the surface that makes the stack visible. It is a general chat and coding agent, devtools for the Electric Agents runtime and SDK, and a route to using one product to code your agents, run them, inspect them, and interact with the systems they make up.

> [!Info] Get started with Electric Agents
> Download the [Electric Agents app](/app), create or connect to an Agents server in [Electric Cloud](/cloud/), run the [Quickstart](/docs/agents/quickstart), read the [docs](/docs/agents/), or revisit the [original Electric Agents launch post](/blog/2026/04/29/introducing-electric-agents).

<!-- ASSET: Header image. Desktop app UI paired with code, showing Electric Agents as both application/devtools layer and SDK/runtime layer. Dark theme, Electric brand colours, 16:9 or 16:10, center-safe composition. -->

## Context

<!--
Brief orientation only. Do not re-argue the April launch post. This should help
readers understand why an app release belongs in the Electric Agents story.
-->

- In April we introduced Electric Agents as the agent platform built on sync: agents are durable, addressable streams of state, not hidden processes trapped behind a chat UI.
- Since then we have filled in the layers around that idea: Electric Cloud as the hosted control plane, the SDK/orchestration layer, the runtime, and now the app/devtools layer.
- The result is a system where you can define agents in code, host them locally or in Cloud, then inspect, steer, fork, and use them from the same product surface.

## Agents servers in Electric Cloud preview

<!--
This is the Cloud launch section. Make clear that Cloud is what lets Electric
Agents become online infrastructure rather than a local-only dev tool. Keep
pricing language factual and confirm the final Cloud terms before publish.
-->

- Electric Agents servers are now available in Electric Cloud preview.
- Sign in, create or connect to an Agents server, and use it as the online coordinator for your agents.
- The server stores and routes the durable entity streams: wakes, runners, permissions, schedules, event sources, and live observations.
- Your agent compute can still run wherever you want: on your laptop, in your infrastructure, in CI, or in hosted workers. Cloud coordinates the system; it does not lock your models, tools, or execution environment into one place.
- This is what enables the cross-device workflow: start a coding session on your machine, then open the same session from your phone, watch it run, stop it, send a follow-up, or ask it to fix something.
- In preview, Agents servers have no additional charge beyond the underlying Durable Streams usage, including the $5/month usage waiver.

<!-- ASSET: Cloud preview screenshot or diagram. Show Electric Cloud Agents server connected to desktop runner and mobile app. -->

## The app is three things

<!--
Main announcement section. Lead with what people can now touch, but define the
app more precisely than "UI". Keep mobile framed as preview unless distribution
status changes before publish.
-->

- **Devtools for the runtime and SDK.** Inspect entities, timelines, state, runs, tool calls, errors, runners, MCP servers, model providers, and server connections.
- **A general chat and coding agent.** Use Horton as the built-in assistant, with Worker for delegated subtasks: coding, research, file edits, shell commands, web search, MCP tools, and more.
- **A software factory workbench.** Use one app to code your agents, then run, inspect, fork, steer, and operate the agent system you just built.

- The desktop app is the full workspace: start sessions, choose working directories, chat with Horton, inspect timelines and state, manage servers, configure model providers, connect MCP servers, and run a local agent runtime.
- Your own entity types appear there too. Define them with the SDK, register them with the runtime, then spawn them, send messages, inspect their timelines, and interact with them like any built-in agent.
- The mobile app previews are for remote control: connect to Cloud or self-hosted agent servers, browse sessions, open live timelines, send messages, and signal running agents from your phone.
- Together, the apps are clients for Cloud-hosted agent systems and locally running runners.

<!-- ASSET: Desktop app screenshot or short video. Show workspace, session list, chat timeline, and a devtools/settings surface such as MCP or model providers. -->

<!-- ASSET: Mobile preview screenshot. Show server picker or session list plus chat timeline/stop controls. Label as preview if the image includes app-store-style framing. -->

## The runtime and SDK layer

<!--
Explain that the apps are backed by a developer platform, not a closed app.
This section should make the layer cake explicit: app/devtools on top of Cloud,
runtime/SDK, and Electric Streams.
-->

- Electric Agents models long-lived work as entities: typed, addressable units of state at paths like `/horton/onboarding` or `/worker/research-1`.
- Entities wake when something happens: a message arrives, a child finishes, state changes, a schedule fires, or an external event source triggers.
- Handlers run in your app process. They can use an LLM loop, call tools, spawn children, observe other entities, write shared state, and then sleep.
- Electric Cloud gives those entities a hosted place to live online, while self-hosting remains available for teams that want to run the stack themselves.
- The stream remains the source of truth. The process can stop; the entity state, timeline, audit trail, and fork history remain.

<!-- ASSET: Simple layered architecture diagram. Suggested layers: Electric Streams -> Electric Cloud/control plane -> runtime/SDK/entities/handlers -> desktop/mobile/devtools. -->

## What Electric Agents lets you do

<!--
Verb map for the platform. Use tags to show where the capability lives and what
is new. Keep this as a platform map, not a full changelog.
-->

- **Define** typed entities, state collections, inbox schemas, and handlers. `SDK`
- **Run** long-lived agent loops that append runs, steps, text, reasoning, tool calls, and errors to durable streams. `Runtime`
- **Wake** entities on messages, schedules, child completion, state changes, and webhook-backed event sources. `Runtime` `New in 0.1`
- **Spawn** agents and workers, then coordinate them with `send`, `observe`, shared state, and `runFinished` wakes. `SDK`
- **Observe** live timelines, entity state, tool calls, runs, errors, child status, and stream history. `App` `SDK`
- **Steer** running work with messages and signals: stop, pause, resume, kill, or deliver handler-level lifecycle events. `App` `New in 0.1`
- **Connect** external tools and systems with MCP servers and event-source subscriptions. `App` `Runtime` `New in 0.1`
- **Attach** files and images to messages, runs, tool calls, and context. `App` `Runtime` `New in 0.1`
- **Sandbox** tool execution with local, Docker, and remote E2B profiles. `Runtime` `New in 0.1`
- **Authorize** access with principals, permission grants, tenant-scoped URLs, and claim-scoped write tokens. `Cloud` `Runtime` `New in 0.1`
- **Fork** from history and re-roll a session from an earlier point in the timeline. `App` `Runtime` `New in 0.1`
- **Host** the agents control plane in Electric Cloud or run it yourself, while your agent compute stays on infrastructure you control. `Cloud` `Self-hosted`

## How to try it

<!--
Make this practical. The reader should be able to try something immediately.
Primary CTAs: download the app and run the quickstart.
-->

Download the [Electric Agents app](/app), then create or connect to an Agents server in [Electric Cloud](/cloud/).

Or run the quickstart from the CLI:

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

## What we’re using it for

<!--
Carry the dogfooding/software-factory point. Keep it concrete and honest:
the apps are part of product, test harness for the platform, and the start of
our own automation surface.
-->

- We are building the apps on the same primitives we are exposing publicly, because we want Electric Agents to become our own software factory.
- The goal is not just “an agent that writes code”. It is a set of durable agents that can shepherd PRs and issues, keep work moving, surface state, and let any of us connect to the same live session.
- A PR-review agent should be a session everyone can open: watch it inspect the diff, ask it questions, have it fix review comments, fork it to try another approach, or hand it back to a human with the full trace intact.
- Every missing capability becomes obvious when you try to use the system for real work: working directories, model providers, MCP, attachments, permissions, mobile controls, runner health, and fork-from-message all came from building on the runtime ourselves.
- The long-term direction is a software factory: agents that help build, inspect, run, and improve the applications they are part of.

## Coming next

<!--
Roadmap tease. Keep this grounded, not speculative.
-->

- More app polish: signed desktop builds, smoother downloads and updates, and richer mobile distribution.
- Agents servers moving from Cloud preview toward general availability.
- More examples and docs for app builders: permissions, event sources, MCP, attachments, sandbox profiles, and multi-agent patterns.

## Next steps

<!--
Final CTA, not a second conclusion. Keep it short.
-->

- Download the [Electric Agents app](/app).
- Create or connect to an Agents server in [Electric Cloud](/cloud/).
- Run `npx electric-ax agents quickstart`.
- Read the [Electric Agents docs](/docs/agents/).
- Join the [Electric Discord](https://discord.electric-sql.com) and tell us what you build.

***

<!--
DELETE BEFORE PUBLISHING

## Intent

- What is this post about?
  - Electric Agents 0.1 brings the agent stack online with Agents servers in Electric Cloud preview, the runtime/SDK, the desktop app, and mobile app previews.
- What is interesting about it?
  - Electric Agents is layered: Cloud/control plane, SDK/orchestration layer, runtime, and user-facing app/devtools layer. In the same app you can code your agent system and interact with the agents that make it up.
- Reader takeaway:
  - Electric Agents is becoming the interface for building agentic software: define agents as durable entities in code, run and coordinate them through the runtime or Cloud, then inspect, steer, fork, and use them from desktop/mobile/devtools.
- CTAs:
  - Download the app.
  - Create or connect to an Agents server in Electric Cloud.
  - Run `npx electric-ax agents quickstart`.
- Why us?
  - Electric built the full stack: Electric Streams, Electric Cloud, TanStack DB integrations, the Electric Agents runtime/SDK, and the desktop/mobile app layer. The apps are product, dogfood, and the beginning of Electric’s own software-factory automation.

## Title brief

Direction: lead with the app release while signalling this is the 0.1 Cloud/runtime release too.
Working title: “Electric Agents 0.1: from runtime to app”.
Titles must use sentence case.

## Description brief

SEO description should say that Electric Agents 0.1 ships the product-shaped stack: Agents servers in Electric Cloud preview, desktop app, mobile previews, and the runtime/SDK for building durable, observable, multi-agent systems on Electric Streams.

## Excerpt brief

Max three short sentences. Mention Cloud preview and apps first, then runtime/devtools. Example direction: “Electric Agents 0.1 ships Agents servers in Electric Cloud preview, the first desktop app, and mobile previews. The apps sit on the same Cloud, runtime, and SDK stack developers use to build durable, addressable agents on Electric Streams.”

## Image prompt

Desktop app UI paired with code. Dark theme. Show the product/devtools duality: a large Electric Agents desktop window with live agent timeline, tool calls, and session sidebar, alongside a code editor panel defining an entity/handler. Subtle layered visual motif behind it: streams -> Cloud/runtime -> app. Electric brand colours: purple #D0BCFF, green #00d2a0, cyan #75fbfd, yellow #F6F95C, orange #FF8C3B. 16:9 to 16:10, target ~1536x950px, key content center-safe for responsive cropping.

## Asset checklist

- [ ] Header image: desktop app UI + code.
- [ ] Cloud preview screenshot or diagram: Cloud Agents server coordinating desktop runner and mobile app.
- [ ] Desktop app screenshot or short video: workspace/session/timeline/settings.
- [ ] Mobile preview screenshot: server picker or session/chat with stop controls.
- [ ] Layered architecture diagram: Electric Streams -> Electric Cloud/control plane -> runtime/SDK -> apps/devtools.
- [ ] Optional quickstart split screenshot: terminal command + live app timeline.

## Open questions

- Final title.
- Exact app download URL and whether `/app` page is ready on the branch this post lands with.
- Whether desktop builds are signed by publish time; keep unsigned caveat out of post unless still visible on `/app`.
- Exact mobile wording by publish time: “mobile app previews” unless store distribution is ready.
- Exact Cloud launch link/copy if the Cloud post or landing page exists before this publishes.
- Confirm preview pricing wording: no additional charge beyond Durable Streams usage, including the $5/month usage waiver.

## Typesetting checklist

- Use non-breaking spaces (`&nbsp;` in HTML, `\u00A0` in frontmatter) and non-breaking hyphens where appropriate to avoid widows and orphans.
- Titles MUST use sentence case, not Title Case.
- Check title, image, and general post at different screen widths.
- Avoid LLM tells: “it’s worth noting”, “importantly”, “in conclusion”, “let’s dive in”, “at its core”, “in today’s landscape”.
-->
