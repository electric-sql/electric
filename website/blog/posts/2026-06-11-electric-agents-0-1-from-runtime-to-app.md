---
title: "Electric Agents 0.1"
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

<script setup>
import EntityStreamDemo from '../../src/components/agents-home/EntityStreamDemo.vue'
</script>

<!--
Release post outline.

Prose this up in place, then delete the comments/meta footer before publishing.
Keep the post factual and brisk: runtime/SDK release first, apps as in-development
devtools/demo surfaces, managed Cloud Agents servers as coming soon.
-->

Electric Agents 0.1 is out today. It rounds out the [platform we launched in April](/blog/2026/04/29/introducing-electric-agents), where agents are durable, addressable streams, with a broader SDK and runtime surface for building agentic systems.

The release gives you the runtime and SDK primitives: [long-lived entities](/docs/agents/usage/defining-entities), StreamDB state, local and remote runners, [spawning and forking](/docs/agents/usage/spawning-and-coordinating), [wakes](/docs/agents/usage/waking-entities), [signals](/docs/agents/usage/signals), schedules, self-sends, [app APIs](/docs/agents/usage/programmatic-runtime-client), and multi-agent coordination patterns. The apps are in development as devtools and demo surfaces. You can download canary builds from [GitHub releases](https://github.com/electric-sql/electric/releases) or build them yourself from source. Managed Agents servers in Electric Cloud are coming soon.

> [!Info] Get started with Electric Agents
> Run the [Quickstart](/docs/agents/quickstart), read the [docs](/docs/agents/), watch the demos in this post, or revisit the [original Electric Agents launch post](/blog/2026/04/29/introducing-electric-agents).

<!-- ASSET: Header image. Runtime/SDK release visual: durable streams / StreamDB entities, runners, and app/devtools surface. Could still include desktop UI + code, but app should not read as the launch headline. Dark theme, Electric brand colours, 16:9 or 16:10, center-safe composition. -->

## What changed since April

<!--
Brief orientation only. Do not re-argue the April launch post. This should say
what has become more complete since the April launch.
-->

The April launch introduced the model: agents as durable, addressable streams of state. This release fills out the surface area around that model:

- **Core APIs.** Define agents, run them on runners, wake them from events, spawn children, fork history, signal active work, schedule future work, and build apps on top.
- **Apps in development.** The desktop and mobile apps show how to inspect and operate agent systems built on the SDK.
- **Cloud next.** Managed Agents servers in Electric Cloud are coming soon, with hosted coordination and user-owned compute.
- **Background.** For the deeper context, read the [April launch post](/blog/2026/04/29/introducing-electric-agents), [agents as data primitives](/blog/2026/04/08/data-primitive-agent-loop), [StreamDB](/blog/2026/03/26/stream-db), [forking durable streams](/blog/2026/04/15/fork-branching-for-durable-streams), and [durable sessions for collaborative AI](/blog/2026/01/12/durable-sessions-for-collaborative-ai).

## The Electric Agents stack

<!--
Explain local vs remote runners. This is important for Cloud coming soon and for
the phone-controlling-local-compute story.
-->

The stack starts with durable data and builds up to agents, runners, and apps. 0.1 expands the runtime and SDK surface on top of that stack, and the in-development apps show how the same state model can be used for devtools and product workflows.

<figure>
  <a href="/img/blog/electric-agents-0-1-from-runtime-to-app/stack.jpg" class="no-visual">
    <img
      src="/img/blog/electric-agents-0-1-from-runtime-to-app/stack.jpg"
      alt="Electric Agents stack: Durable Streams, StreamDB, TanStack DB, Agents runtime, and Agents apps."
    />
  </a>
</figure>

At the base are **Durable Streams**: append-only logs that store what happened. **StreamDB** projects those events into typed, live state. **TanStack DB** gives those projections a query layer for filtering, joins, aggregation, and materialized client state.

The **Agents runtime** sits on top of that data layer. It provides the control plane for entities: messaging, scheduling, wakes, retry, permissions, signals, child coordination, and runner dispatch. Agents servers coordinate work; runners do the compute. A runner can live on your laptop, in your infrastructure, in CI, or in another worker environment you control.

The **Agents apps** are the top layer. They are in-development desktop and mobile surfaces for devtools, coding-agent workflows, remote control, and our own dogfooding. Because coordination and compute are separate, you can start a coding session on your machine, leave the runner there, then open the same session from your phone to send a follow-up, stop it, or ask it to fix something.

Managed Agents servers in Electric Cloud are coming soon. The 0.1 runtime is built around the same local/remote runner model: hosted coordination, user-owned compute.

<!-- ASSET: Diagram or short video. Agents server/control plane in middle, local desktop runner on one side, remote/mobile/app clients on the other. Make clear compute stays with user-owned runners. -->

## Every entity is a StreamDB

<!--
This is the architectural core. Explain the durable entity model clearly before
touring features. The reader should leave understanding that "agent = persistent
StreamDB-backed entity", not a transient process.
-->

In Electric Agents, the agent is the durable entity, not the process currently handling it.

- An [Electric Agents entity](/docs/agents/usage/defining-entities) is a long-lived, addressable thing: an assistant, worker, coding session, support ticket, lead researcher, orchestrator, monitor, or any agent type you define.
- Every entity has a durable stream, which is the log of what happened.
- Every entity also has a typed StreamDB projection. That projection gives you live state: timeline, inbox, runs, tool calls, context, errors, children, signals, and [custom collections](/docs/agents/usage/managing-state).
- The process that handles a wake can come and go. The entity persists. It can sleep, wake, replay, fork, spawn children, and be observed by apps or other agents.

<EntityStreamDemo class="md-exclude" />

<!-- ASSET: Diagram or animation. One entity path -> durable stream -> StreamDB collections -> UI/agent subscribers. Show built-in collections and custom state as projections over the same stream. -->

## Demos and videos

<!--
Use this section to place short demo videos. They do not all need to be polished.
The post should show the primitives in motion without turning into a giant essay.
-->

### Forking and spawning

Show the difference between spawning a fresh child and forking an entity with parent history.

<!-- VIDEO PLACEHOLDER: Forking vs spawning. Show spawn as fresh child; fork as branch with parent history. -->

### Every agent is a StreamDB

Show the inspector or timeline/state view: the same entity as messages, runs, tool calls, state, children, and stream rows.

<!-- VIDEO PLACEHOLDER: Every agent as StreamDB / inspector. Show timeline, collections, stream rows, and state projection. -->

### Multiple layers of spawning

Use James' demo or another nested agent tree to show parent -> child -> grandchild coordination.

<!-- VIDEO PLACEHOLDER: Multi-layer spawning. Show parent, child, grandchild, and wake/completion flow. -->

### Local vs remote runners

Show a local runner doing the work while another client observes or controls the same session.

<!-- VIDEO PLACEHOLDER: Local runner controlled remotely. Show compute on laptop and control from another client. -->

### Signals quick tour

Show `SIGINT`, pause/resume, kill, and handler-level signals from CLI or app.

<!-- VIDEO PLACEHOLDER: Signals quick tour. Show interrupt, pause, resume, kill, and handler signal response. -->

### PG sync triggers

Show a Postgres change triggering an agent through sync/event plumbing.

<!-- VIDEO PLACEHOLDER: PG sync trigger / reactive agents. Show database change -> observation source -> wake -> handler. -->

### Send to self and cron

Show an agent scheduling its own future work or waking itself to continue.

<!-- VIDEO PLACEHOLDER: Send-to-self and cron. Show delayed send, cron schedule, and follow-up wake. -->

### Multi-agent patterns

Show blackboard/shared state, orchestrator/worker, reactive observers, or map-reduce.

<!-- VIDEO PLACEHOLDER: Multi-agent patterns. Show one concrete pattern with shared state and observed child progress. -->

## Core APIs

<!--
This is the main feature tour. Keep samples compact and representative; link to
the docs for full signatures and end-to-end examples.
-->

### Define

Define [entity types](/docs/agents/usage/defining-entities) with schemas, handlers, [permissions](/docs/agents/usage/permissions-and-principals), and [tools](/docs/agents/usage/defining-tools). This is where you decide what kind of long-lived thing exists in the system, what state it owns, and what code runs when it wakes. `SDK`

```ts
const registry = createEntityRegistry()

registry.define("assistant", {
  description: "A project-aware assistant",
  state: {
    notes: {
      schema: z.object({ id: z.string(), text: z.string() }),
      primaryKey: "id",
    },
  },
  async handler(ctx) {
    // ...
  },
})
```

### Run

Run an agent loop that persists runs, text, reasoning, tool calls, and errors to the entity stream. The handler can do normal application work before or after the LLM loop; `ctx.useAgent()` and `ctx.agent.run()` record the agent trace. See [writing handlers](/docs/agents/usage/writing-handlers) and [configuring the agent loop](/docs/agents/usage/configuring-the-agent). `Runtime`

```ts
async handler(ctx) {
  ctx.useAgent({
    systemPrompt: "You are a helpful assistant.",
    model: "claude-sonnet-4-6",
    tools: [...ctx.electricTools, searchDocsTool],
  })

  await ctx.agent.run()
}
```

### Spawn

Spawn a fresh child entity without parent history. Use this for workers, fan-out, and multi-layer agent trees where the parent wants another entity to own a separate stream of work. See [spawning and coordinating](/docs/agents/usage/spawning-and-coordinating#spawn). `SDK`

```ts
const worker = await ctx.spawn(
  "worker",
  "audit-docs",
  { tools: ["read", "search"] },
  {
    initialMessage: "Audit the docs for missing release notes.",
    wake: { on: "runFinished", includeResponse: true },
  }
)
```

### Fork

Fork an entity with history. Use this when you want a second path through the same session. The fork keeps the useful context and branches the durable stream, so you can try another approach without overwriting the original. See [spawning and coordinating](/docs/agents/usage/spawning-and-coordinating). `Runtime` `App`

```ts
const fork = await ctx.forkSelf("variant-a", {
  initialMessage: { text: "Try the shorter implementation path." },
  tags: { branch: "variant-a" },
})
```

### Send

Send [messages](/docs/agents/usage/writing-handlers#sending-messages) to any entity. Because messages are durable inbox entries, the same API works for user input, parent-to-child steering, and send-to-self continuation after a delay. `SDK`

```ts
await ctx.send(
  "/worker/audit-docs",
  { files: ["website/docs/agents/index.md"] },
  { type: "review_request" }
)

await ctx.send(
  ctx.entityUrl,
  { step: "continue-after-indexing" },
  { type: "self", afterMs: 60_000 }
)
```

### Wake

Wake entities from inbox messages, child completion, state changes, cron, future sends, event sources, and Postgres sync triggers. Wakes are how agents scale to zero: no process has to stay alive just to notice that something changed. See [waking entities](/docs/agents/usage/waking-entities). `Runtime`

```ts
await ctx.observe(entity("/worker/audit-docs"), {
  wake: { on: "runFinished", includeResponse: true },
})

await client.registerWake({
  subscriberUrl: "/monitor/docs",
  sourceUrl: "/worker/audit-docs/main",
  condition: { on: "change", collections: ["runs", "texts"] },
})
```

### Observe

Observe entities, shared state, entity lists, timelines, and child state in real time from handlers or apps. Observing loads the target stream into a typed local DB. Those collections can drive UI, coordination logic, or debugging tools. Use the [runtime client](/docs/agents/usage/programmatic-runtime-client) and [React client APIs](/docs/agents/usage/clients-and-react). `SDK` `App APIs`

```ts
const client = createAgentsClient({ baseUrl: "http://localhost:4437" })
const db = await client.observe(entity("/assistant/release-post"))

console.log(db.collections.texts.toArray)
```

### Schedule

Schedule work with [cron and future sends](/docs/agents/usage/programmatic-runtime-client#schedules). Agents can sleep until the next scheduled wake. Recurring jobs and delayed follow-ups live in the entity's durable manifest, not in an external timer you have to reconcile. `Runtime`

```ts
await client.upsertCronSchedule({
  entityUrl: "/assistant/release-post",
  id: "daily-checkin",
  expression: "0 9 * * *",
  timezone: "Europe/London",
  payload: "Review open launch tasks.",
})

await client.upsertFutureSendSchedule({
  entityUrl: "/assistant/release-post",
  id: "follow-up",
  fireAt: new Date(Date.now() + 60_000).toISOString(),
  payload: "Continue after the preview build finishes.",
})
```

### Signal

Signal running agents: interrupt, pause, resume, kill, or deliver handler-level lifecycle signals. Signals give apps and operators a control plane for active work without treating the agent as an opaque process. See the [signals guide](/docs/agents/usage/signals) and [CLI reference](/docs/agents/reference/cli). `Runtime` `CLI` `App`

```ts
await client.signalEntity({
  entityUrl: "/horton/release-post",
  signal: "SIGINT",
  reason: "User wants to redirect the current run.",
})
```

### Coordinate

Coordinate with [shared state](/docs/agents/usage/shared-state) and multi-agent patterns such as [orchestrator/worker](/docs/agents/entities/patterns/manager-worker), [blackboard](/docs/agents/entities/patterns/blackboard), [reactive observers](/docs/agents/entities/patterns/reactive-observers), [map-reduce](/docs/agents/entities/patterns/map-reduce), and [pipelines](/docs/agents/entities/patterns/pipeline). Coordination is explicit state and explicit streams, so parent agents, child agents, and UI clients can inspect the work. `SDK`

```ts
const board = ctx.mkdb("release-board", {
  tasks: {
    schema: z.object({ id: z.string(), status: z.string() }),
    type: "shared:task",
    primaryKey: "id",
  },
})

board.tasks.insert({ id: "screenshots", status: "needed" })

const reviewer = await ctx.spawn("worker", "reviewer", {})
await ctx.observe(entity(reviewer.entityUrl), {
  wake: { on: "change", collections: ["texts"] },
})
```

### Connect

Connect external tools and systems with [MCP servers](/docs/agents/usage/mcp-servers), [event-source subscriptions](/docs/agents/usage/event-sources), [webhooks](/docs/agents/usage/clients-and-react#observation-sources), and [PG sync-driven triggers](/docs/agents/usage/programmatic-runtime-client#registerpgsyncsource). Agents can subscribe to operational systems and wake when those systems change. `Runtime`

```ts
await client.subscribeToEventSource({
  entityUrl: "/horton/release-post",
  id: "github-pr",
  sourceKey: "github",
  bucketKey: "repo",
  params: { repo: "electric-sql/electric" },
  lifetime: { kind: "until_entity_stopped" },
})

const todos = await client.observe(
  pgSync({ table: "todos", where: "project_id = $1", params: ["agents"] })
)
```

### Inspect

Inspect every entity as a StreamDB: timeline, inbox, runs, tool calls, child status, errors, signals, [attachments](/docs/agents/usage/attachments), and [custom collections](/docs/agents/usage/managing-state). The runtime exposes these as TanStack DB collections, so app code can query the agent's state instead of scraping logs. See the [built-in collections reference](/docs/agents/reference/built-in-collections) and the [TanStack DB query docs](https://tanstack.com/db/latest/docs/guides/live-queries). `App APIs` `App`

```ts
import { eq, queryOnce } from "@durable-streams/state/db"

const db = await client.observe(entity("/horton/release-post"))

const runs = await queryOnce((q) => q.from({ run: db.collections.runs }))

const toolCalls = await queryOnce((q) =>
  q.from({ toolCall: db.collections.toolCalls })
)

const attachments = await queryOnce((q) =>
  q
    .from({ manifest: db.collections.manifests })
    .where(({ manifest }) => eq(manifest.kind, "attachment"))
)
```

<!-- ASSET: Compact feature grid. Each primitive with a tag and demo/video marker. -->

## Apps in development

<!--
Apps are not the main launch now. Position them as in-development devtools/demo surfaces
that prove the platform and show the product direction.
-->

The desktop and mobile apps are in development. We are using them to dogfood the SDK and runtime, and to build toward our own software factory: agents that shepherd PRs and issues, keep work moving, and let everyone connect to the same durable session.

- **Custom agent types:** build entities with `@electric-ax/agents-runtime` and inspect them in the desktop app.
- **State explorer:** see each entity's runs, inbox, manifests, and custom state in one view.
- **Entity timeline:** replay a run event by event, then fork from a point in the timeline to try another path.
- **Cloud or self-hosted:** use Electric Cloud when available, or point the app at an agents-server you run yourself.
- **Remote sessions:** open sessions started by CI, webhooks, issues, cron, or another machine.
- **MCP servers:** add MCP servers with native OAuth. Workspace `mcp.json` files are respected.
- **Model providers:** use an API key from your keychain, or sign in to Codex. Anthropic, OpenAI, DeepSeek, and Moonshot are supported.
- **Skills and slash commands:** use `/quickstart` to get started, then save commands for your workflows.
- **Phone handoff:** open a run on iOS or Android to steer it, send a message, or check progress.
- **Desktop workflow extras:** pick a working directory, split the tile workspace, attach files and screenshots to chat, discover local dev servers, and install the `electric` CLI system-wide.

You can download app canaries from [GitHub releases](https://github.com/electric-sql/electric/releases), or build the apps yourself from the repo.

<!-- ASSET: Desktop app screenshot/video. Label clearly as in development / devtools. -->
<!-- ASSET: Mobile app screenshot/video. Label clearly as in development. -->

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
  - Electric Agents 0.1 expands the core APIs: spawn, fork, wake, observe, signal, schedule, send-to-self, coordinate through StreamDB, and build apps on top.
- Reader takeaway:
  - Electric Agents is a platform for building agentic systems, with an SDK and runtime that now include a broader API surface: durable entities, StreamDB state, runners, coordination APIs, signals, scheduling, app APIs, and in-development devtools for inspecting and controlling the agents you build.
- CTAs:
  - Run `npx electric-ax agents quickstart`.
  - Read the updated docs.
  - Watch the demos/videos in the post.
  - Download app canaries from GitHub releases or build them from source.
- Why us?
  - Electric built the underlying stream and sync primitives, the TanStack DB integrations, the Electric Agents runtime/SDK, and the in-development app/devtools surfaces. The apps are dogfood and the beginning of Electric’s own software-factory automation.

## Title brief

Direction: lead with the 0.1 platform release, especially the SDK and runtime, not the apps.
Working title options: “Electric Agents 0.1 released”, “Electric Agents 0.1: agents as StreamDBs”.
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
