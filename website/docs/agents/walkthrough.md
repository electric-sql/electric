---
title: Walkthrough
titleTemplate: "... - Electric Agents"
description: >-
  Walkthrough the steps, one change at a time, to go from a vanilla/existing web app to a dyanamic, multi-agent system with Electric Agents.
outline: [2, 3]
prev:
  text: 'Quickstart'
  link: '/docs/agents/quickstart'
next:
  text: 'Usage - Overview'
  link: '/docs/agents/usage/overview'
---

<script setup>
  import YoutubeEmbed from '../../src/components/YoutubeEmbed.vue'
</script>

<style scoped>
  figure,
  .embed-container {
    margin: 32px 0;
    border-radius: 2px;
    overflow: hidden;
  }
</style>

# Walkthrough

This guide walks through the steps to go from a new, or existing, web or mobile application to a dynamic <span class="no-wrap">multi-agent</span> system with [Electric Agents](/agents/).

<div class="embed-container">
  <YoutubeEmbed video-id="..." title="Serverless agents -- agents in functions, not sandboxes" />
</div>

## Getting started

The steps in this guide start with setting up a vanilla [Hono](https://hono.dev) app.

We've chosen Hono because it's small and simple. You can easily adapt the steps to work with any TypeScript-based framework, such as [Next.js](https://nextjs.org/), [TanStack](https://tanstack.com/start/latest) or [Expo](https://expo.dev).

### Pre-requisites

You'll need the same dependencies as the [Quickstart](/docs/agents/quickstart#what-you-ll-need):

- [Node.js 18+](https://nodejs.org/en/download/current) (with [pnpm](https://pnpm.io/installation))
- [Docker](https://docs.docker.com/get-docker/)
- [Anthropic API key](https://platform.claude.com/settings/keys)

### Create your app

Generate a fresh Hono app:

```sh
pnpm create hono@latest walkthrough \
    --template nodejs \
    --pm pnpm \
    --install
```

This command uses the nodejs template. Hono supports [various runtimes](https://hono.dev/docs/getting-started/basic), including edge functions to deploy your [agents as serverless functions](/blog/2026/06/04/serverless-agents).

Change into the generated folder and run the dev server:

```sh
cd walkthrough
pnpm dev
```

It should show that the server is running on [localhost:3000](localhost:3000):

```
Server is running on http://localhost:3000
```

Leave the server running and, in another terminal tab, navigate back to the same `walkthrough` folder and run:

```sh
curl http://localhost:3000
```

It should output something like:

```
Hello Hono!%
```

The source code for the app is in `src/index.ts`:

```ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
```

As you can see, it's a very simple web app. Now let's start ⚡️ electrifying it!

### Install Electric Agents

We're going to use the local dev server that comes with Electric Agents. This runs in Docker, so [make sure you have Docker running](https://docs.docker.com/get-started/introduction/get-docker-desktop/).

Install the Electric Agents runtime:

```sh
pnpm add @electric-ax/agents-runtime@latest
```

Install and run the Electric Agents dev server:

```sh
pnpx electric-ax@latest agents start
```

This will pull down and run some containers (Postgres, Electric and the Electric Agents server, which includes a Durable Streams server and the Electric Agents UI).

It should finish by outputing:

```
Electric Agents dev environment is up.
Server + UI: http://localhost:4437
Docker project: electric-agents
```

You can check that it's working [using the CLI](/docs/agents/reference/cli):

```sh
pnpx electric-ax agents types
```

Should show something like this:

```
Built-in agents
NAME                     DESCRIPTION
───────────────────────  ────────────────────────────────────────
principal                built-in principal entity
```

::: details Where are the default agents?!

Because we're running with `agents start` rather than `agents quickstart` we don't get the default entities, like `horton` and `worker`, pre-installed like we do with the [Quickstart](/docs/agents/quickstart).

Instead, we get a clean runtime where we can define *our own* agent entities from scratch. Which is what we want for this walkthrough guide.

:::

### Setup Caddy

Before we do anything else, let's setup Caddy to proxy access to the local agents server, so that we [can access it over HTTP/2](/docs/sync/guides/troubleshooting#slow-shapes-slow-hmr-slow-dev-server-mdash-why-is-my-local-development-slow) in local development.

1. [install Caddy](https://caddyserver.com/docs/install) on your host machine
2. run `caddy trust` so Caddy can [install its certificate](https://caddyserver.com/docs/command-line#caddy-trust)

Create a `Caddyfile` with the following contents in it:

```caddyfile
{
  log default {
    level ERROR
  }
}

localhost:4438 {
  reverse_proxy localhost:4437 {
    flush_interval -1
  }
  encode gzip
  header {
    Cache-Control "no-cache, no-transform"
    X-Accel-Buffering "no"
  }
}
```

This proxies https://localhost:4438 to http://localhost:4437, which allows your browser to connect to Electric over HTTP/2.

In a new terminal tab, navigate back to this folder again and start Caddy:

```sh
caddy start
```

This should output some lines ending with something like:

```
Successfully started Caddy (pid=13701) - Caddy is running in the background
```

Great! Now one last step, let's configure our environment and API keys.

### Configure API keys

Create a `.env` file with an `ANTHROPIC_API_KEY` in it:

```sh
ANTHROPIC_API_KEY="sk-ant-..."
```

You can generate API keys at [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys). Make sure your key is valid and not overly rate limited.

Then finally update your `package.json` `dev` script to load the .env file by adding `--env-file=.env` to the `tsx watch` command.

So your dev script shold look like this:

```json
"scripts": {
  "dev": "tsx watch --env-file=.env src/index.ts",
  ...
},
```

OK! We're now ready to define some agents!


## Step 1 - Basic assistant

We're going to do all our work in the `src/index.ts` file. This currently contains just the minimal Hono app that we saw above:

```ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
```

Add these lines at the top to import the Electric Agents runtime shim:

```ts
import {
  createEntityRegistry,
  createRuntimeHandler
} from '@electric-ax/agents-runtime'
```

Define where the services are running:

```ts
const ELECTRIC_AGENTS_URL = 'http://localhost:4437'
const PORT = 3000
const SERVE_URL = `http://localhost:${PORT}`

const MODEL = 'claude-sonnet-4-6'
```

Here we just hardcode the values (including the `MODEL` our agents will use). You'll want these to be configurable using env vars in production. How you do that depends on how you deploy your app.

### Create entity registry

Create a top level [`EntityRegistry`](/docs/agents/usage/defining-entities):

```ts
const registry = createEntityRegistry()
```

This registry is where you define your agent entities. We're going to start by defining the simplest entity possible, a general assistant:

```ts
registry.define("assistant", {
  description: "A general-purpose AI assistant",
  async handler(ctx) {
    ctx.useAgent({
      systemPrompt: "You are a helpful assistant.",
      model: MODEL,
      tools: [],
    })
    await ctx.agent.run()
  }
})
```

As you can see, this has a very simple `systemPrompt` and no `tools`. You can chat to it and it can reply to you and that's about it.

### Create runtime handler

We then pass the registry to, and create, a [`RuntimeHandler`](/docs/agents/reference/runtime-handler):

```ts
const runtime = createRuntimeHandler({
  baseUrl: ELECTRIC_AGENTS_URL,
  serveEndpoint: `${SERVE_URL}/electric-agents`,
  registry,
})
```

And wire it into the web app as a request handler:

```ts
app.post('/electric-agents', (c) => {
  return runtime.handleWebhookRequest(c.req.raw)
})
```

This is all the boilerplate needed to wire up and expose all of your agents to the runtime server. So they can be [woken and notified](/docs/agents/usage/waking-entities) by the webhook notification system when there are events to consume and respond to.

::: details How does the communication work?

All of the actual messaging and communication to and between agents happens over Durable Streams. Specifically using the [built-in StreamDB collections](https://electric.ax/docs/agents/reference/built-in-collections).

The notification system wakes the agents and tells them that there's new data on the streams to consume. This allows agents to sleep (and thus scale to zero) when not being used.

See the [Durable Streams](/blog/2026/04/08/data-primitive-agent-loop) and [Serverless Agents](/blog/2026/06/04/serverless-agents) blog posts for more information.

:::

### Register entity types

The last step is to [register the entity types](/docs/agents/usage/app-setup#registertypes) with the Electric Agents runtime server. This should typically be done at startup time, or when reloading an app in development.

With this Node.js Hono app, we can add a `runtime.registerTypes()` call to the `serve` callback function that executes once the app is running:

```js
serve({
  fetch: app.fetch,
  port: 3000
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)

  runtime.registerTypes().catch(console.error)
})
```

Then when you run the app you should see:

```
INFO: [agent-runtime] Registered entity type: assistant
```

Check the registered entities types on the command line:

```sh
pnpx electric-ax@latest agents types
```

Which will now show:

```
http://host.docker.internal:3000/electric-agents
NAME                     DESCRIPTION
───────────────────────  ────────────────────────────────────────
assistant                A general-purpose AI assistant

Built-in agents
NAME                     DESCRIPTION
───────────────────────  ────────────────────────────────────────
principal                built-in principal entity```
```

Open the web UI on [https://localhost:4438](https://localhost:4438) (note that this uses HTTPS on port 4438 &mdash; we want the web UI to connect via the Caddy proxy).

Click "New session" you'll see your entity type in the list:

<figure style="border: 0.5px solid #aaa">
  <a href="https://localhost:4438" target="_blank" class="no-visual">
    <img src="/img/walkthrough/assistant-entity.jpg" />
  </a>
</figure>

Go ahead and spawn an assistant and chat to it!

## Step 2 - Imperative spawning

So far we've defined an `assistant` entity and seen how we can spawn and interact with it. In this step, we're going to build our first multi-agent system.

Let's start with a deliberately naive approach: defining a manager agent that spawns a worker every time it gets a message. (We'll extend this to more useful patterns later on but let's go one step at a time so the progression is nice and clear).

### Dyanmic assistant

First let's extend our `assistant` to accept a systemPrompt:

```ts
registry.define("assistant", {
  description: "A general-purpose AI assistant",
  async handler(ctx) {
    ctx.useAgent({
      systemPrompt: ctx.args.systemPrompt || "You are a helpful assistant.",
      model: MODEL,
      tools: []
    })

    await ctx.agent.run()
  },
})
```

This means the `systemPrompt` for the assistant can be defined when it's spawned.

We'll also add a small helper to generate entity IDs, which we'll reuse whenever we spawn a sub-agent:

```ts
const genId = () => Math.random().toString()
```

### Manager agent

Then let's define a new `manager` entity type:

```ts
registry.define("manager", {
  description: "A manager agent that delegates work to assistants",
  async handler(ctx, wake) {
    if (wake.type === 'inbox') {
      await ctx.spawn(
        'assistant',
        genId(),
        { systemPrompt: `Roast the user message. When done, report back to your manager.` },
        { initialMessage: wake.payload.text, wake: 'runFinished' }
      )
    }

    ctx.useAgent({
      systemPrompt: ctx.args.systemPrompt || "You are a manager agent.",
      model: MODEL,
      tools: []
    })

    await ctx.agent.run()
  },
})
```

This is very similar to our `assistant` type but, as you can see, adds this imperative logic to the beginning of the `handler` function:

```ts
if (wake.type === 'inbox') {
  await ctx.spawn(
    'assistant',
    genId(),
    { systemPrompt: `Roast the user message. When done, report back to your manager.` },
    { initialMessage: wake.payload.text, wake: 'runFinished' }
  )
}
```

What this does is say "if the notification you're responding to comes from the inbox stream", which means it's a user message, then spawn a sub-agent, specifically an `assistant` with a "Roast the user message" systemPrompt, passing through the user message from `wake.payload.text`.

Now if go back to the web UI on [https://localhost:4438](https://localhost:4438) you can now also create `manager` agents:

<figure style="border: 0.5px solid #aaa">
  <a href="https://localhost:4438" target="_blank" class="no-visual">
    <img src="/img/walkthrough/manager-entity.jpg" />
  </a>
</figure>

Create one and send it a message. You'll see the child entity in the UI (in the menu on the left hand side, you can see it says "manager + 1" you can expand that and then see the sub-agents in the menu bar.

Click through to the sub-agent, you'll see it's roasting the message. Back in the manager agent thread it recieves the notification of the sub-agent response but it doesn't *understand* it:

<figure>
  <a href="https://localhost:4438" target="_blank" class="no-visual">
    <img src="/img/walkthrough/manager-interaction.png" />
  </a>
</figure>

It knows its a manager agent (from its systemPrompt) but it doesn't realise that it spawned the sub-agent or that the sub-agent is responding to its instructions. That's because the sub-agent was spawned in *our imperative code*, not in the session context using a tool call.

## Step 3 - Tool call spawning

What we need is to spawn the sub-agent using a tool call that the manager agent understands and tracks in the session log.

For this, we're going to define a tool that the manager agent can use.

Let's first add a dependency to help with the typing:

```sh
pnpm add @sinclair/typebox
```

Import it at the top of the file (we're still working in the same file &mdash; `src/index.ts`):

```ts
import { Type, type Static } from '@sinclair/typebox'
```

Let's define a tool to spawn an assistant:

```ts
const taskParameters = Type.Object({
  task: Type.String({ description: "The task for the assistant." }),
})
type TaskParams = Static<typeof taskParameters>

function createSpawnAssistantTool(ctx) {
  return {
    name: "spawn_assistant",
    label: "Spawn Assistant",
    description: "Spawn an assistant sub-agent to perform a task.",
    parameters: taskParameters,
    execute: async (_toolCallId: string, { task }: TaskParams) => {
      const { entityUrl } = await ctx.spawn(
        'assistant',
        genId(),
        {},
        { initialMessage: task, wake: 'runFinished' },
      )

      return {
        content: [{
          type: 'text' as const,
          text: `Assistant dispatched at ${entityUrl}.`,
        }],
        details: { entityUrl },
        terminate: true
      }
    },
  }
}
```

To follow the code, the `parameters`, in this case the `taskParameters` schema define the input parameters for the tool. These are the values that the LLM generates when requesting the tool call ("spawn an assistant with this task").

The `ctx.spawn` call that spawns the sub agent moves into the tool call `execute` function. The tool call response also returns a response and some structured data, including the `entityUrl` in the `details`.

We can now update our manager entity to remove the previous imperative `ctx.spawn` logic and instead to pass the spawn assistant tool into the `tools` array, so that the LLM can choose to use it:

```ts
registry.define("manager", {
  description: "A manager agent that delegates work to an assistant",
  async handler(ctx) {
    ctx.useAgent({
      systemPrompt: 'Spawn a sub-agent to roast the user message and then end your turn until they report back.',
      model: MODEL,
      tools: [createSpawnAssistantTool(ctx)],
    })

    await ctx.agent.run()
  },
})
```

Now when we spawn a manager and message it, we see the assistant spawned and report back and the manager agent is aware of the sub-agent. Ask the manager:

> who roasted this message? how did that happen/work?

It's smart enough to explain what happened (without invoking another tool call).

## Step 4 - Multi-agent

Now let's do something a bit more ambitious and useful. Let's define another entity type, a `judge` that itself spawns sub-agents to argue two sides of a debate.

First define the `judge` entity:

```ts
registry.define("judge", {
  description: "A judge that coordinates a two-sided debate",
  async handler(ctx) {
    ctx.useAgent({
      systemPrompt: `You are a fair, concise judge coordinating a multi-agent debate.

Your job is to:
1. Spawn exactly two assistant sub-agents:
   - Good-side debater: argues the morally good/beneficial case.
   - Evil-side debater: argues the morally evil/harmful case.
2. Give each assistant a clear brief with the debate topic and the side they must argue.
3. Ask each assistant to respond to you with a concise argument and their strongest three points.
4. End your turn after spawning them. When each assistant finishes, wait until you have both responses.
5. Summarize the key arguments of the debate and provide your judge's verdict to the parent agent.

Notes:
- You are an impartial judge.
- Use the assistants to gather the two sides.
- Wait for **all** of the assistants to return **full** responses. Don't respond to partial / in-progress responses.
- Do not generate/hallucinate the argument yourself. You must wait for the assistants to fully respond and then synthesize their responses. Don't anticipate or make them up.
- Wait until the debate is fully finished before reporting back to the parent agent.`,
      model: MODEL,
      tools: [createSpawnAssistantTool(ctx)]
    })

    await ctx.agent.run()
  },
})
```

As you can see, most of the work is in the prompt. Note also that the judge is given the spawn assistant tool.

Add a tool to spawn a judge:

```ts
const topicParameters = Type.Object({
  topic: Type.String({ description: "The topic to debate." }),
})
type TopicParams = Static<typeof topicParameters>

function createSpawnJudgeTool(ctx) {
  return {
    name: "spawn_judge",
    label: "Spawn Judge",
    description: "Spawn a judge agent that coordinates a two-sided debate and reports the result back here. Use this when the user asks agents to debate a topic.",
    parameters: topicParameters,
    execute: async (_toolCallId: string, { topic }: TopicParams) => {
      const { entityUrl } = await ctx.spawn(
        'judge',
        genId(),
        {},
        { initialMessage: `Set up a debate on this topic: ${topic}`, wake: 'runFinished' },
      )

      return {
        content: [{
          type: 'text' as const,
          text: `Judge dispatched at ${entityUrl}.`,
        }],
        details: { entityUrl },
        terminate: true
      }
    },
  }
}
```

Give the tool to the manager and tweak the manager's systemPrompt:

```ts
registry.define("manager", {
  description: "A manager agent that delegates work to an assistant",
  async handler(ctx) {
    ctx.useAgent({
      systemPrompt: `
        If the user asks to debate a topic, spawn a Judge with the debate topic.
        Your default action is to spawn an Assistant to roast the user message.

        In either case, end your turn until they report back.
      `,
      model: MODEL,
      tools: [createSpawnAssistantTool(ctx), createSpawnJudgeTool(ctx)],
    })

    await ctx.agent.run()
  },
})
```

Now create a new manager session and instruct it to debate an issue, for example:

> Debate 996 vs 4-day-week

You'll see it spawn a judge *and* you'll see the judge spawn the two assistants.

## Step 5 - Hybrid control flow

In an agentic system, we want the LLM to be able to express itself by choosing and configuring the right tool calls in the right way. However, it's often tricky to get the LLM to always do the right thing.

In the judge prompt above, we added a series of notes to the instructions to prevent the judge from making the results up and responding too early:

```
Notes:
- You are an impartial judge.
- Use the assistants to gather the two sides.
- Wait for **all** of the assistants to return **full** responses. Don't respond to partial / in-progress responses.
- Do not generate/hallucinate the argument yourself. You must wait for the assistants to fully respond and then synthesize their responses. Don't anticipate or make them up.
- Wait until the debate is fully finished before reporting back to the parent agent.`,
```

These kind of instructions may be familiar to you if you're used to wrangling LLMs and agentic systems! They often work, especially with better models. However, LLMs are indeterministic and there's always a small chance they won't follow instructions perfectly.

Let's step things up a level and make the control flow more complex. Say we want the judge to pass each of the assistant arguments to the other side to be able to critique and respond to. We could imagine updating the steps in the system prompt like this:

```
When (and only when) you receive a user message:
1. Spawn exactly two assistant sub-agents:
   - Good-side debater: argues the morally good/beneficial case.
   - Evil-side debater: argues the morally evil/harmful case.
2. Give each assistant a clear brief with the debate topic and the side they must argue.
3. Ask each assistant to respond to you with a concise argument and their strongest three points.
4. End your turn after spawning them. When each assistant finishes, wait until you have both responses.
5. Message the existing assistants (using the entityUrl from step 1) to send each response to the other side to critique. So the good-side debater can critique the evil-side debater and vice versa. End your turn and wait for both critique responses.
6. Once both assistants return their critiques, review and compare their arguments.
7. Summarize the key arguments of the debate and provide your judge's verdict to the parent agent.
```

These instructions are fairly clear but it would be easy for the LLM to go off-piste. Let's evolve our system to use **hybrid control flow**. Where:

- some aspects of the control flow are determined by the LLM's tool choices
- some aspects are controlled by our agent logic, working with durable state










then run this ... it works ...

***

now let's imagine we want the judge to pass the arguments to the other side to have an opportunity to critique. we'll want to add a new tool to message an existing assistant:

```ts
const messageParameters = Type.Object({
  entityUrl: Type.String({ description: "The entityUrl of the assistant to message (returned by spawn_assistant)." }),
  message: Type.String({ description: "The message to send to the assistant." }),
})
type MessageParams = Static<typeof messageParameters>

function createMessageAssistantTool(ctx) {
  return {
    name: "message_assistant",
    label: "Message Assistant",
    description: "Send a message to an already-spawned assistant.",
    parameters: messageParameters,
    execute: async (_toolCallId: string, params: MessageParams) => {
      const { entityUrl, message } = params

      await ctx.send(entityUrl, message)

      return {
        content: [{
          type: 'text' as const,
          text: `Message sent to ${entityUrl}. End your turn — you'll wake when it responds.`,
        }],
        details: { entityUrl },
      }
    },
  }
}
```

Give this to the judge:

```ts
tools: [createSpawnAssistantTool(ctx), createMessageAssistantTool(ctx)]
```

And update the judge's system prompt:

```
5. Use the message_assistant tool (with the entityUrl from step 1) to send each response to the other side to critique. So the good-side debater can critique the evil-side debater and vice versa. End your turn and wait for both critique responses.
6. Once both assistants return their critiques, review and compare their arguments.
7. Summarize the key arguments of the debate and provide your judge's verdict to the parent agent.

````






---

## Step 5 — Hybrid control flow (revised)

In an agentic system we want the LLM to express itself by choosing and configuring the right tool calls. But the more steps we cram into a prompt, the more we're trusting an indeterministic model to follow a deterministic procedure. Let's see where that breaks — and then fix it properly.

### The temptation: put the whole procedure in the prompt

We already floated the idea of teaching the judge the whole debate as a numbered list. Once we add the critique round, the prompt grows to something like this:

```
When (and only when) you receive a user message:
1. Spawn exactly two assistant sub-agents (an A-side and a B-side debater).
2. Give each a clear brief with the topic and the side they must argue.
3. Ask each for a concise argument and their strongest three points.
4. End your turn. When each assistant finishes, wait until you have both responses.
5. Send each response to the other side to rebut. End your turn and wait for both rebuttals.
6. Once both rebuttals are back, review and compare the arguments.
7. Summarize the debate and provide your verdict to the parent agent.
```

It reads clearly. It even mostly works. But it has two failure modes baked in, and both come from the same source — **the judge wakes on every debater run-completion and runs the LLM each time**:

- **Chatter.** The A-side debater finishes first. The judge wakes, runs the LLM, and the model dutifully narrates a non-event ("A is done, B is still arguing — I'll wait."). That's a full LLM run, and tokens, spent on nothing. The same happens one level up: the manager wakes on every judge run and chatters about progress the user never asked for.
- **Going off-piste.** "Wait until you have both responses" is a *request*, not a guarantee. A model that gets it wrong acts on a half-finished round — critiquing against one argument, or delivering a verdict before the rebuttals are in. The whole debate finishes early and wrong.

These instructions are familiar if you've wrangled agents before. They work *most* of the time. But "most of the time" is exactly the property we don't want in our control flow.

### The mental model

The fix is to stop treating every wake as a prompt to think about. Instead:

- **The wake is a signal** — "something happened" — not an instruction to run the LLM.
- **Durable state is the truth** — what's actually happened lives in a collection you own, not in the model's reading of its transcript.
- **The handler decides whether the LLM runs at all** — a wake that isn't actionable goes straight back to sleep.

Two primitives carry this. `ctx.sleep()` ends the handler **without starting a run** — no LLM call, no text, and crucially no `runFinished` wake emitted to anyone observing. It's the canonical "this wake isn't for me." And `wake.payload?.finished_child` tells you *which* child just finished and with what.

::: details Verified semantics — the wake shape

The handler is `handler(ctx, wake)`. For a child completion `wake.type === 'wake'` and the data is on **`wake.payload`** (not `wake` directly): `{ changes, finished_child?, other_children?, timeout }`. `finished_child` is `{ url, type, run_status: 'completed' | 'failed', response?, error? }`.

`ctx.sleep()` ends the handler without starting a run. No run means no LLM call, no text, and no `runFinished` wake emitted to observers.

And a slept wake loses nothing: the server appends one idempotent `wakes` row per child finish, each carrying that run's `response`, and the default context builder projects the full timeline including those `wake` sections. So a debater's argument is durably in the judge's context whether or not the judge ran the LLM on that wake. The gate only decides *when* to run — never *whether* to capture.

:::

This is **hybrid control flow**: the LLM owns the creative decisions; your handler code owns the control flow, using durable state as the source of truth.

### Durable state: the debate collection and the phase machine

This step pulls two more exports from the runtime — `passthrough` (to type the custom collection below) and `entity` (used later, when the manager observes the judge). Extend the import:

```ts
import {
  createEntityRegistry,
  createRuntimeHandler,
  entity,
  passthrough,
} from '@electric-ax/agents-runtime'
```

Give the judge one custom collection, `debate`, with a single `'current'` row — a judge coordinates exactly one debate:

```ts
type Debate = {
  key: 'current'
  topic: string
  aUrl: string
  bUrl: string
  phase: 'arguing' | 'critiquing' | 'done'
  arguments: { a?: string; b?: string }
  rebuttals: { a?: boolean; b?: boolean }
}
```

Declared on the entity:

```ts
state: {
  debate: { schema: passthrough<Debate>(), primaryKey: 'key' },
},
```

The debate is a three-phase machine: `arguing` → `critiquing` → `done`. The `arguments` and `rebuttals` fields are **per-round receipts**. `arguments` stores the argument *text* — because forwarding it to the other side to rebut needs no LLM. `rebuttals` only needs booleans, because the verdict LLM reads the full exchange from its own timeline. Both are phase-specific and never reset, which is what makes the gate race-free.

### The gate

This is the centrepiece. Here's the complete judge entity — the `state` from above, plus a handler that records what happened and then acts **only when the round is complete**:

```ts
registry.define('judge', {
  description: 'Coordinates a three-phase debate: arguments, mutual rebuttals, verdict.',
  state: {
    debate: { schema: passthrough<Debate>(), primaryKey: 'key' },
  },
  async handler(ctx, wake) {

    // Handle inbox messages by spawning one debate at a time.
    // Using the LLM to formulate the briefs for each side.

    if (wake.type === 'inbox') {
      if (ctx.state.debate.get('current')) {
        return ctx.sleep()
      }

      ctx.useAgent({
        systemPrompt: SETUP_PROMPT,
        model: MODEL,
        tools: [createStartDebateTool(ctx)],
      })

      return ctx.agent.run()
    }

    // Ignore wake notifications unless they're from finished children
    // participating in the current debate.

    let debate = ctx.state.debate.get('current')
    if (!debate || debate.phase === 'done') {
      return ctx.sleep()
    }

    const finished = wake.payload?.finished_child
    if (!finished) {
      return ctx.sleep()
    }

    const side =
      finished.url === debate.aUrl ? 'a' :
        finished.url === debate.bUrl  ? 'b' : null
    if (!side) {
      return ctx.sleep()
    }

    // Record this debater's contribution for the current round.

    if (debate.phase === 'arguing') {
      ctx.state.debate.update('current', d => { d.arguments[side] = finished.response ?? '' })
      debate = ctx.state.debate.get('current')

      // Proceed once both debaters have reported for this round.

      if (debate.arguments.a !== undefined && debate.arguments.b !== undefined) {
        ctx.send(debate.aUrl, rebut(debate.arguments.b))
        ctx.send(debate.bUrl, rebut(debate.arguments.a))

        ctx.state.debate.update('current', d => { d.phase = 'critiquing' })
      }

      return ctx.sleep()
    }

    // We're in `phase === 'critiquing'`, wait until both are in.

    ctx.state.debate.update('current', d => { d.rebuttals[side] = true })
    debate = ctx.state.debate.get('current')

    if (!debate.rebuttals.a || !debate.rebuttals.b) {
      return ctx.sleep()
    }

    // Flip the phase to 'done' and have the LLM write the verdict as its reply.

    ctx.state.debate.update('current', d => { d.phase = 'done' })

    ctx.useAgent({
      systemPrompt: VERDICT_PROMPT,
      model: MODEL,
      tools: [],
    })

    return ctx.agent.run()
  },
})
```

Read it as: an inbox message with no debate yet kicks off **setup**. Otherwise a child finished, so figure out which side it was, write a **phase-tagged receipt** for it, then check whether *both* receipts for the current round are in. If not, sleep — the other debater is still working, and we run nothing. Only when both are in does the handler act inline: in the `arguing` round it forwards the rebuttals (plain code, no LLM); in the `critiquing` round it flips to `done` and runs the LLM to write the verdict.

The "wait for both / don't hallucinate / don't respond early" notes from the old prompt are simply gone. Code enforces them now, so the chatter and the off-piste verdict are both structurally impossible.

::: details Why this is race-free

If both debaters finish near-simultaneously, the runtime delivers two **separate, serialized** handler invocations — it runs one handler at a time per entity and delivers each finish as its own webhook. So the read-modify-write on the `debate` row is safe, and two finishes are never collapsed into one invocation that hides one of them.

Each invocation records its own side's phase-tagged receipt. Whichever invocation observes *both* receipts advances; the first one sees only its own receipt and sleeps. No double-advance, no missed advance.

A tempting alternative gate is "advance when no sibling is still `running`" — but that's racy: a debater that hasn't transitioned out of `idle` yet looks done, so a fast first critique could trigger a premature verdict. We gate on **per-side receipts written from `finished_child`**, never on liveness status, so that can't happen.

And because the receipts are phase-specific fields that are never reset — `phase` only advances *after* both receipts for a round are in — a late or duplicate finish can never be misattributed across rounds.

:::

### Imperative vs LLM

Now the "hybrid" part. Look back at the handler: when a round completes it does one of two very different things, and only one of them touches the LLM.

**The rebuttal round-trip is plain code.** Once both arguments are in, the handler forwards each side's argument to the other to rebut — two `ctx.send` calls and a phase flip, no LLM run. The forwarder is just a template:

```ts
const rebut = (arg: string) =>
  `Your opponent argued:\n\n${arg}\n\nRebut their argument(s).`
```

There's no reason to spend an LLM run shuffling text between debaters. The judge sends, flips to `critiquing`, and sleeps — waiting for the rebuttal receipts to come back through the same gate.

**The LLM is reserved for the two genuinely creative moments: opening the debate and delivering the verdict.** Each gets its own scoped prompt.

At setup, the LLM picks the topic and writes a brief for each side:

```ts
const SETUP_PROMPT = `You are a fair, concise debate judge opening a debate.
Call start_debate exactly once: pick the topic line, and write a clear brief for each side:
- "A" argues one case (e.g.: beneficial / pro / one side of the argument)
- "B" argues the other case (e.g.: harmful  / against / the other side)
Each brief assigns only the topic and that side's position, then asks the debater to make a
concise argument with their own three strongest points. Do NOT supply, list, or hint at any
arguments yourself — the debater must devise their own.
Then end your turn. Do not narrate.`
```

It spawns the debaters through a single tool, which records their URLs into the `debate` row — that's what later lets the gate map a `finished_child` back to side `a` or `b`:

```ts
const startDebateParameters = Type.Object({
  topic: Type.String({ description: 'Short topic line, e.g. "996 vs 4-day work week".' }),
  aBrief: Type.String({ description: 'Brief for the A debater: topic, side, ask for their concise argument and points.' }),
  bBrief: Type.String({ description: 'Brief for the B debater: same shape.' }),
})
type StartDebateParams = Static<typeof startDebateParameters>

function createStartDebateTool(ctx) {
  return {
    name: 'start_debate',
    label: 'Start Debate',
    description: 'Spawn the two debaters with their opening briefs. Call exactly once.',
    parameters: startDebateParameters,
    execute: async (_id: string, { topic, aBrief, bBrief }: StartDebateParams) => {
      const [a, b] = await Promise.all([
        ctx.spawn('assistant', genId(), {}, { initialMessage: aBrief, wake: 'runFinished' }),
        ctx.spawn('assistant', genId(), {}, { initialMessage: bBrief, wake: 'runFinished' }),
      ])

      ctx.state.debate.insert({
        key: 'current',
        topic,
        aUrl: a.entityUrl,
        bUrl: b.entityUrl,
        phase: 'arguing',
        arguments: {},
        rebuttals: {},
      })

      return ({
        content: [{
          type: 'text' as const,
          text: 'Debate started.'
        }],
        terminate: true
      })
    },
  }
}
```

At the close, there's no tool at all. The verdict is prose written for a human, so the judge runs with `tools: []` and a prompt whose whole job is to make the reply *be* the verdict:

```ts
const VERDICT_PROMPT = `You are a fair, concise debate judge closing a debate.
Both sides have argued and critiqued each other. The full exchange is in your context.
Weigh it and write your final verdict as your reply: summarise each side's strongest points,
note how each critique landed, and give your impartial decision. Never argue a side.
Do not narrate or preface — your reply IS the verdict, and it gets relayed to the user.`
```

The verdict run reads the full exchange (already in its timeline from the slept wakes) and writes its decision as its reply — that reply is what travels up to the manager.

::: details Verified semantics — the verdict is the run reply

The verdict is prose meant for a human, so there's no structured payload to capture — no verdict tool, no typed message. The judge just runs with `VERDICT_PROMPT` and `tools: []`, and its reply *is* the verdict. It reaches the manager as the `response` carried on the judge's `runFinished` wake (a bare `wake: 'runFinished'` includes the run's reply by default). When an LLM's output is plain text for the user, the run reply is the channel; reach for a tool argument only when you need to capture *structured* output the run reply wouldn't preserve.

:::

### The manager edge: observe the judge, relay when it's `done`

The manager spawned the judge with `wake: 'runFinished'` (back in Step 4's `spawn_judge` tool), so it's re-invoked on **every** judge run-completion. The judge runs the LLM twice — once to open, once to close — and only the second produces a verdict. The manager's prompt says to relay one when it arrives:

```ts
const MANAGER_PROMPT = `You delegate work and relay results to the user.
- If the user asks to debate a topic, spawn a Judge with the topic, then end your turn.
- Otherwise, spawn an Assistant to roast the user's message, then end your turn.
- When a Judge reports a verdict, present it to the user.`
```

But "when a Judge reports a verdict" can't be left to the model to spot in the text. The manager reads the judge's **durable state** instead: on a judge run-completion it observes the judge and checks the `debate` collection — if the phase isn't `done` (the setup run leaves it `arguing`), it sleeps; only `phase === 'done'` runs the LLM to relay.

```ts
registry.define("manager", {
  description: "Delegates to assistants and judges and relays their results to the user.",
  async handler(ctx, wake) {

    // Only act on judge completions when the debate is fully done. Note that a
    // *failed* judge run is not a 'completed' wake, so it skips this guard.

    const child = wake.payload?.finished_child
    if (child?.type === 'judge' && child.run_status === 'completed') {

      // Shows how a parent can observe the state of a child.

      const judge = await ctx.observe(entity(child.url))
      const debate = judge.db.collections.debate.get('current')

      if (debate?.phase !== 'done') {
        return ctx.sleep()
      }
    }

    ctx.useAgent({
      systemPrompt: MANAGER_PROMPT,
      model: MODEL,
      tools: [createSpawnAssistantTool(ctx), createSpawnJudgeTool(ctx)],
    })

    await ctx.agent.run()
  },
})
```

When the guard passes, the verdict text is already in the manager's context — it rode in as the `response` on the same `runFinished` wake — so the LLM just presents it. And the guard keys on `completed`: a *failed* judge run isn't `completed`, so it skips the observe-check entirely and falls through to a normal run, surfacing the failure to the user with no try/catch and no manual error plumbing.

::: details observe vs wake — two independent knobs

`observe` and `wake` are independent. `observe: true` (the default) syncs the child's stream into the parent, so the parent can read the child's state on demand — that's what `ctx.observe(entity(child.url))` does here, reading the judge's `debate` collection. `wake` is what re-invokes the parent's handler: with `wake: 'runFinished'`, every judge run-completion re-invokes the manager, and that wake carries the finished run's reply as its `response` (included by default).

So the two compose: `wake` tells the manager *when* the judge finished a run; `observe` tells it *whether the debate is actually `done`* (vs. the setup run that just opened it). The verdict the manager relays rode in on the wake; the decision of whether to relay comes from the observed state.

:::

### The payoff

Here are the wakes the **judge** sees over a full debate, and what it actually does:

| # | Judge wake | Gate decision | LLM run? | Manager woken? |
| --- | --- | --- | --- | --- |
| 1 | inbox "Set up a debate…" | no debate yet → setup | **yes** (`start_debate`) | yes (setup run → observes `arguing` → sleeps) |
| 2 | A argument finished | `arguments.b` missing → sleep | no | no |
| 3 | B argument finished | both arguments in → forward rebuttals | no (imperative forward) | no |
| 4 | A rebuttal finished | `rebuttals.b` missing → sleep | no | no |
| 5 | B rebuttal finished | both rebuttals in → verdict | **yes** (verdict, `tools: []`) | yes (verdict run → observes `done` → relays) |

The order of 2/3 and 4/5 may swap depending on which debater finishes first — the gate is symmetric either way. The numbers:

- **Judge LLM runs: 2** — open and close. Down from ~5 in the all-in-the-prompt version.
- **Manager LLM runs from the judge: 1** — the verdict relay. The setup-run completion wakes the manager too, but it observes the debate still `arguing` and sleeps. (A *failed* judge run isn't `completed`, so it skips the guard and surfaces.)
- **No chatter.** Steps 2–4, where the judge sleeps, emit no run, so the manager isn't woken by them at all.
- **The debate cannot finish early.** The verdict only runs once both rebuttal receipts are durably present — there's no path for the model to "decide" otherwise.

That's the whole lesson of hybrid control flow: let the LLM be creative where creativity is the point, and let your code — backed by durable state — own *when* anything runs.
