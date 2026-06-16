---
title: Walkthrough
titleTemplate: "... - Electric Agents"
description: >-
  Walkthrough the steps, one change at a time, to go from a vanilla web app to a dynamic, multi-agent system with Electric Agents.
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

> [!Warning] <span style="font-weight: 700; font-size: 110%;">✨</span>&nbsp; Example app
> This guide has an accompanying [example app](https://github.com/electric-sql/electric/tree/main/examples/agents-walkthrough) and [walkthrough video](https://youtu.be/beYF8FV019w).

<div class="embed-container">
  <YoutubeEmbed video-id="beYF8FV019w" title="Electric Agents walkthrough" />
</div>

## Getting started

The steps in this guide start with setting up a vanilla [Hono](https://hono.dev) app.

We've chosen Hono because it's small and simple. You can easily adapt the steps to work with any TypeScript-based framework, such as [Next.js](https://nextjs.org/), [TanStack](https://tanstack.com/start/latest) or [Expo](https://expo.dev).

#### Pre-requisites

You'll need the same dependencies as the [Quickstart](/docs/agents/quickstart#what-you-ll-need):

- [Node.js 18+](https://nodejs.org/en/download/current) (with [pnpm](https://pnpm.io/installation))
- [Docker](https://docs.docker.com/get-docker/)
- [Anthropic API key](https://platform.claude.com/settings/keys)

#### Create your app

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

#### Install Electric Agents

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

It should finish by outputting:

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
```

::: details Where are the default agents?!

Because we're running with `agents start` rather than `agents quickstart` we don't get the default entities, like `horton` and `worker`, pre-installed like we do with the [Quickstart](/docs/agents/quickstart).

Instead, we get a clean runtime where we can define *our own* agent entities from scratch. Which is what we want for this walkthrough guide.

:::

#### Setup Caddy

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

#### Configure API keys

Create a `.env` file with an `ANTHROPIC_API_KEY` in it:

```sh
ANTHROPIC_API_KEY="sk-ant-..."
```

You can generate API keys at [platform.claude.com/settings/keys](https://platform.claude.com/settings/keys). Make sure your key is valid and not overly rate limited.

Then finally update your `package.json` `dev` script to load the .env file by adding `--env-file=.env` to the `tsx watch` command.

So your dev script should look like this:

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
const PORT = 3000
const SERVE_URL = `http://localhost:${PORT}`
const ELECTRIC_AGENTS_URL = 'http://localhost:4437'
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

All of the actual messaging and communication to and between agents happens over Durable Streams. Specifically using the [built-in StreamDB collections](/docs/agents/reference/built-in-collections).

The notification system wakes the agents and tells them that there's new data on the streams to consume. This allows agents to sleep (and thus scale to zero) when not being used.

See the [Durable Streams](/blog/2026/04/08/data-primitive-agent-loop) and [Serverless Agents](/blog/2026/06/04/serverless-agents) blog posts for more information.

:::

### Register entity types

The last step is to [register the entity types](/docs/agents/usage/app-setup#registertypes) with the Electric Agents runtime server. This can be done at startup time, when reloading an app in development or via your build or migration scripts.

In this case, we can just add a `runtime.registerTypes()` call to the `serve` callback function that executes once the app is running:

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

### Dynamic assistant

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
      const message =
        typeof wake.payload === "string"
          ? wake.payload
          : (wake.payload as { text?: string })?.text ?? wake.payload
      await ctx.spawn(
        'assistant',
        genId(),
        { systemPrompt: `Reverse the user message.` },
        { initialMessage: message, wake: { on: 'runFinished', includeResponse: true } }
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
  const message =
    typeof wake.payload === "string"
      ? wake.payload
      : (wake.payload as { text?: string })?.text ?? wake.payload
  await ctx.spawn(
    'assistant',
    genId(),
    { systemPrompt: `Reverse the user message.` },
    { initialMessage: message, wake: { on: 'runFinished', includeResponse: true } }
  )
}
```

What this does is say "if the notification you're responding to comes from the inbox stream", which means it's a user message, then spawn a sub-agent, specifically an `assistant` with a "Reverse the user message" systemPrompt, passing through the user message from `wake.payload`.

Now if you go back to the web UI on [https://localhost:4438](https://localhost:4438) you can now also create `manager` agents:

<figure style="border: 0.5px solid #aaa">
  <a href="https://localhost:4438" target="_blank" class="no-visual">
    <img src="/img/walkthrough/manager-entity.jpg" />
  </a>
</figure>

Create one and send it a message. You'll see the child entity in the UI. In the menu on the left-hand side you'll see it says "manager + 1"; expand that to see the sub-agents in the menu bar.

Click through to the sub-agent, you'll see it's reversed the message. Back in the manager agent thread it receives the notification of the sub-agent response, but it doesn't *understand* it:

<figure>
  <a href="https://localhost:4438" target="_blank" class="no-visual">
    <img src="/img/walkthrough/manager-interaction.png" />
  </a>
</figure>

It knows it's a manager agent (from its systemPrompt) but it doesn't realise that it spawned the sub-agent or that the sub-agent is responding to its instructions. That's because the sub-agent was spawned in *our imperative code*, not in the session context using a tool call.

## Step 3 - Tool call spawning

What we need is to spawn the sub-agent using a tool call that the manager agent can see in its context, because it's tracked in the session log.

For this, we're going to define a tool that the manager agent can use.

Let's first add a dependency to help with the typing:

```sh
pnpm add @sinclair/typebox
```

Import it at the top of the file (we're still working in the same file &mdash; `src/index.ts`):

```ts
import { Type, type Static } from '@sinclair/typebox'
```

### Spawn assistant tool

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
        { initialMessage: task, wake: { on: 'runFinished', includeResponse: true } },
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

The [`ctx.spawn`](/docs/agents/usage/spawning-and-coordinating#spawn) call that spawns the sub-agent moves into the tool call `execute` function. The tool call response also returns a response and some structured data, including the `entityUrl` in the `details`.

### Simplify the manager

We can now update our manager entity to remove the previous imperative `ctx.spawn` logic and instead pass the spawn assistant tool into the `tools` array:

```ts
registry.define("manager", {
  description: "A manager agent that delegates work to an assistant",
  async handler(ctx) {
    ctx.useAgent({
      systemPrompt: `
        When given a user message that is a single word, spawn an
        assistant to reverse the user message.

        When asked direct questions, answer them yourself.
      `,
      model: MODEL,
      tools: [createSpawnAssistantTool(ctx)],
    })

    await ctx.agent.run()
  },
})
```

Now when we spawn a manager and message it, we see the assistant spawn and report back, and the manager agent is aware of the sub-agent. Ask the manager:

> who reversed this message? how did that happen/work?

It's smart enough to explain what happened.

## Step 4 - Multi-agent

Now let's do something a bit more ambitious and useful. Let's define another entity type, a `judge` that itself spawns sub-agents to argue two sides of a debate.

### Judge entity

First define the `judge` entity:

```ts
registry.define("judge", {
  description: "A judge that coordinates a two-sided debate",
  async handler(ctx) {
    ctx.useAgent({
      systemPrompt: `You are a fair, concise judge coordinating a multi-agent debate.

Your job is to:
1. Spawn exactly two assistant sub-agents:
   - "A" side debater: argues one case (e.g.: beneficial / pro / one side of the argument)
   - "B" side debater: argues the other case (e.g.: harmful  / against / the other side)
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

### Spawn judge tool

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
        { initialMessage: `Set up a debate on this topic: ${topic}`, wake: { on: 'runFinished', includeResponse: true } },
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
        When asked to debate a topic, spawn a Judge with the debate topic.

        When given a user message that is a single word, spawn an
        assistant to reverse the user message.

        When asked direct questions, answer them yourself.
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

However, exactly what happens is up to the LLM's interpretation of its system prompt. What happens varies run by run and the judge and manager often hallucinate the debate results without waiting for the arguments to actually come in.

### "Make no mistakes"

In an agentic system, we want the LLM to be able to express itself by choosing and configuring the right tool calls in the right way. However, it's often tricky to get the LLM to always do the right thing.

In the judge prompt above, we added a series of notes to the instructions to prevent the judge from making the results up and responding too early:

```
Notes:
- You are an impartial judge.
- Use the assistants to gather the two sides.
- Wait for **all** of the assistants to return **full** responses. Don't respond to partial / in-progress responses.
- Do not generate/hallucinate the argument yourself. You must wait for the assistants to fully respond and then synthesize their responses. Don't anticipate or make them up.
- Wait until the debate is fully finished before reporting back to the parent agent.
```

These kind of instructions may be familiar to you if you're used to instructing LLMs! They often work, especially with better models. However, LLMs are non-deterministic and there's always a small chance they won't follow instructions perfectly.

Say we step things up a level and make the debate control flow more complex. Let's add a phase to the debate by instructing the judge to pass each of the assistants' arguments to the opposing side so they can critique and rebut them before the judge summarizes the debate.

```
  Manager       Judge           Assistant A        Assistant B
     │            │                  │                  │
     ├── topic ──▶│                  │                  │
     │            │                  │                  │
── phase 1: arguing ───────────────────────────────────────
     │            ├─ spawn + brief ─▶│                  │
     │            ├──────────────────┼─ spawn + brief ─▶│
     │            │                  │                  │
     │            │◀──── argument ───┤                  │
     │            │◀─────────────────┼──── argument ────┤
     │            │                  │                  │
── phase 2: critiquing ─────────────────────────────────────
     │            ├── B's argument ─▶│                  │
     │            ├──────────────────┼─ A's argument ──▶│
     │            │                  │                  │
     │            │◀──── rebuttal ───┤                  │
     │            │◀─────────────────┼──── rebuttal ────┤
     │            │                  │                  │
── phase 3: verdict ───────────────────────────────────────
     │◀─ verdict ─┤                  │                  │
```

We could imagine updating the steps in the system prompt like this:

```
When (and only when) you receive a user message:
1. Spawn exactly two assistant sub-agents:
   - "A" side debater: argues one case (e.g.: beneficial / pro / one side of the argument)
   - "B" side debater: argues the other case (e.g.: harmful  / against / the other side)
2. Give each assistant a clear brief with the debate topic and the side they must argue.
3. Ask each assistant to respond to you with a concise argument and their strongest three points.
4. End your turn after spawning them. When each assistant finishes, wait until you have both responses.
5. Message the existing assistants (using the entityUrl from step 1) to send each response to the other side to critique. So the A-side debater can critique the B-side debater and vice versa. End your turn and wait for both critique responses.
6. Once both assistants return their critiques, review and compare their arguments.
7. Summarize the key arguments of the debate and provide your judge's verdict to the parent agent.
```

These instructions are fairly clear but it would be very easy for the LLM to go off-piste. Rather than using this longer system prompt, let's instead evolve our system to use a hybrid approach that combines the LLM instructions with imperative control flow based on durable state.

## Step 5 - Hybrid control flow

In this step, we're going to:

1. define a `start_debate` tool call to spawn the two debating assistants
2. add a `debate` collection to the durable state kept by the judge entity
3. significantly update the judge entity to use imperative control flow
4. update the manager agent to observe the judge's durable state

This will make the system much more reliable.

### Start debate tool

Rather than prompting the judge to create two assistants to argue each side of the debate, we're going to define a tool call that does this instead.

This spawns the two assistants and allows the progress and status of the debate to be tracked in the state layer.

First define the parameters for the tool call. Note that the LLM still writes the briefs:

```ts
const startDebateParameters = Type.Object({
  topic: Type.String({
    description: `Short topic line, e.g. "996 vs 4-day work week".`,
  }),
  aBrief: Type.String({
    description: `Brief for the A debater: topic, side, ask for their concise argument and points.`,
  }),
  bBrief: Type.String({ description: `Brief for the B debater: same shape.` }),
})
type StartDebateParams = Static<typeof startDebateParameters>
```

Define the tool, which uses [`ctx.spawn`](/docs/agents/usage/spawning-and-coordinating#spawn) to spawn the two sub-agents and [`ctx.state.debate.insert`](/docs/agents/usage/managing-state#writing-and-reading-state) to setup the debate state:

```ts
function createStartDebateTool(ctx: HandlerContext<any, any, any, any>) {
  return {
    name: `start_debate`,
    label: `Start Debate`,
    description: `Spawn the two debaters with their opening briefs. Call exactly once.`,
    parameters: startDebateParameters,
    execute: async (_id: string, params: unknown) => {
      // Spawn the two sub-agents
      const { topic, aBrief, bBrief } = params as StartDebateParams
      const [a, b] = await Promise.all([
        ctx.spawn(
          `assistant`,
          genId(),
          {},
          { initialMessage: aBrief, wake: { on: `runFinished`, includeResponse: true } }
        ),
        ctx.spawn(
          `assistant`,
          genId(),
          {},
          { initialMessage: bBrief, wake: { on: `runFinished`, includeResponse: true } }
        ),
      ])

      // Setup the debate state
      ctx.state.debate.insert({
        key: `current`,
        topic,
        aUrl: a.entityUrl,
        bUrl: b.entityUrl,
        phase: `arguing`,
        arguments: {},
        rebuttals: {},
      })

      return {
        content: [
          {
            type: `text` as const,
            text: `Debate started.`,
          },
        ],
        details: {},
        terminate: true,
      }
    },
  }
}
```

Lastly, also define this helper function that we'll use below in the judge entity handler logic:

```ts
const rebut = (arg: string) =>
  `Your opponent argued:\n\n${arg}\n\nRebut their argument(s).`
```

### Debate collection

Now let's add the `debate` [collection](https://tanstack.com/db/latest/docs/overview#defining-collections) to the entity definition's [`state`](/docs/agents/usage/managing-state). This allows us to track the progress and status of a debate in the [durable state layer](/streams/).

Pull in two more imports from `@electric-ax/agents-runtime`:

```ts
import {
  // ...,
  entity,
  passthrough,
} from '@electric-ax/agents-runtime'
```

Define a schema for the collection data:

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

> [!Tip] ℹ&nbsp; What is a collection?
> Electric Agents uses [TanStack DB](/sync/tanstack-db) under the hood. [Collections](https://tanstack.com/db/latest/docs/overview#defining-collections) are the core reactive data abstraction for TanStack DB.

Configure the collection on the judge entity's `state`:

```ts
registry.define('judge', {
  description: `Coordinates a three-phase debate: arguments, mutual rebuttals, verdict.`,
  state: {
    debate: { schema: passthrough<Debate>(), primaryKey: 'key' },
  },
  async handler(ctx, wake) {
    // ...
  }
})
```

### Judge handler logic

We can now update the handler logic for the judge entity (the code examples below go inside the `async handler(ctx, wake) { ... }` function shown above).

First, let's add a guard that handles inbox messages (the normal user messages from the parent, the manager agent) that ensures we only create one debate at a time and passes in the start debate tool:

```ts
// Handle inbox messages
if (wake.type === 'inbox') {

  // Only allow one debate at a time.
  if (ctx.state.debate.get('current')) {
    return ctx.sleep()
  }

  // Pass in the start debate tool
  ctx.useAgent({
    systemPrompt: SETUP_PROMPT,
    model: MODEL,
    tools: [createStartDebateTool(ctx)],
  })

  return ctx.agent.run()
}
```

> [!Tip] ℹ&nbsp; Understanding wake notifications
> The agent receives a [wake notification](/docs/agents/usage/waking-entities#what-produces-a-wake) when there's a new message or a child sub-agent finishes a run. So in this example, the judge will receive wake notifications from the assistants:
>
> 1. when they finish generating their initial argument
> 2. when they critique their opponent's argument
>
> These notifications call the entity handler function with a `wake.type` of `'wake'`. As opposed to user messages which have a `wake.type` of `'inbox'`.

Because the logic above matches all inbox messages, any other events will be wake notifications from the assistant sub-agents. When handling these, we can use and update the durable state to control and track the progress of the debate.

#### Using durable state

When receiving a wake notification, check the status of the debate:

```ts
// Read the durable state
let debate = ctx.state.debate.get(`current`)
```

If the debate is in the initial `'arguing'` phase, then the wake notification will be from an assistant responding with their initial argument. In this case, we want to record the argument and then check whether both arguments have been received.

If they have, we can [`ctx.send`](/docs/agents/usage/spawning-and-coordinating#send) the arguments to the other assistant to rebut and then update the state of the debate to be in the "critiquing" phase:

```ts
// If the assistants are still making their first arguments
if (debate.phase === 'arguing') {

  // Record the argument
  ctx.state.debate.update('current', d => { d.arguments[side] = finished.response ?? '' })
  debate = ctx.state.debate.get('current')

  // If we've received both arguments, send them to the other assistant
  // and update the debate state to move into the critiquing phase.
  if (debate.arguments.a !== undefined && debate.arguments.b !== undefined) {
    ctx.send(debate.aUrl, rebut(debate.arguments.b))
    ctx.send(debate.bUrl, rebut(debate.arguments.a))

    ctx.state.debate.update('current', d => { d.phase = 'critiquing' })
  }

  return ctx.sleep()
}
```

Then when we get notifications and the debate is in the `'critiquing'` phase, record that we've received the rebuttal and check whether both rebuttals have been received. If so, set the debate status to `'done'` and have the LLM write the verdict as its reply:

```ts
ctx.state.debate.update('current', d => { d.rebuttals[side] = true })
debate = ctx.state.debate.get('current')

if (!debate.rebuttals.a || !debate.rebuttals.b) {
  return ctx.sleep()
}

ctx.state.debate.update('current', d => { d.phase = 'done' })

ctx.useAgent({
  systemPrompt: VERDICT_PROMPT,
  model: MODEL,
  tools: [],
})

return ctx.agent.run()
```

::: details See the whole judge entity definition

The whole entity definition with prompts looks like this:

```ts
const SETUP_PROMPT = `You are a fair, concise debate judge opening a debate.
Call start_debate exactly once: pick the topic line, and write a clear brief for each side:
- "A" argues one case (e.g.: beneficial / pro / one side of the argument)
- "B" argues the other case (e.g.: harmful  / against / the other side)
Each brief assigns only the topic and that side's position, then asks the debater to make a
concise argument with their own three strongest points. Do NOT supply, list, or hint at any
arguments yourself — the debater must devise their own.
Then end your turn. Do not narrate.`

const VERDICT_PROMPT = `You are a fair, concise debate judge closing a debate.
Both sides have argued and critiqued each other. The full exchange is in your context.
Weigh it and write your final verdict as your reply: summarise each side's strongest points,
note how each critique landed, and give your impartial decision. Never argue a side.
Do not narrate or preface — your reply IS the verdict, and it gets relayed to the user.`

registry.define(`judge`, {
  description: `Coordinates a three-phase debate: arguments, mutual rebuttals, verdict.`,
  state: {
    debate: { schema: passthrough<Debate>(), primaryKey: `key` },
  },
  async handler(ctx, wake) {
    // Handle inbox messages by spawning one debate at a time.
    // Using the LLM to formulate the briefs for each side.

    if (wake.type === `inbox`) {
      if (ctx.state.debate.get(`current`)) {
        return ctx.sleep()
      }

      ctx.useAgent({
        systemPrompt: SETUP_PROMPT,
        model: MODEL,
        tools: [createStartDebateTool(ctx)],
      })

      await ctx.agent.run()
      return
    }

    // Ignore wake notifications unless they're from finished children
    // participating in the current debate.

    let debate = ctx.state.debate.get(`current`)
    if (!debate || debate.phase === `done`) {
      return ctx.sleep()
    }

    const finished_child = wake.payload?.finished_child as
      | FinishedChild
      | undefined
    if (!finished_child) {
      return ctx.sleep()
    }

    const side =
      finished_child.url === debate.aUrl
        ? `a`
        : finished_child.url === debate.bUrl
          ? `b`
          : null
    if (!side) {
      return ctx.sleep()
    }

    // Record this debater's contribution for the current round.

    if (debate.phase === `arguing`) {
      ctx.state.debate.update(`current`, (d) => {
        d.arguments[side] = finished_child.response ?? ``
      })
      debate = ctx.state.debate.get(`current`)!

      // Proceed once both debaters have reported for this round.

      if (
        debate.arguments.a !== undefined &&
        debate.arguments.b !== undefined
      ) {
        ctx.send(debate.aUrl, rebut(debate.arguments.b))
        ctx.send(debate.bUrl, rebut(debate.arguments.a))

        ctx.state.debate.update(`current`, (d) => {
          d.phase = `critiquing`
        })
      }

      return ctx.sleep()
    }

    // We're in `phase === 'critiquing'`, wait until both are in.

    ctx.state.debate.update(`current`, (d) => {
      d.rebuttals[side] = true
    })
    debate = ctx.state.debate.get(`current`)!

    if (!debate.rebuttals.a || !debate.rebuttals.b) {
      return ctx.sleep()
    }

    // Flip the phase to 'done' and have the LLM write the verdict as its reply.

    ctx.state.debate.update(`current`, (d) => {
      d.phase = `done`
    })

    ctx.useAgent({
      systemPrompt: VERDICT_PROMPT,
      model: MODEL,
      tools: [],
    })

    await ctx.agent.run()
  },
})
```

:::

### Manager handler logic

We can then update the manager entity to ignore notifications from judge sub-agents until their debate is done:

```ts
registry.define(`manager`, {
  // ...,
  async handler(ctx, wake) {
    // When receiving wake notifications ...
    if (wake.type === `wake`) {
      const finishedChild = wake.payload?.finished_child

      // ... from a judge sub-agent ...
      if (finishedChild?.type === `judge` && finishedChild.run_status === `completed`) {
        const judge = await ctx.observe(entity(finishedChild.url))

        // ... ignore them if the debate is still in progress ...
        const debate = judge.db.collections.debate.get(`current`)
        if (debate?.phase !== `done`) {
          return ctx.sleep()
        }
      }
    }

    // ...
```

#### Observing child state

This uses the [`ctx.observe`](/docs/agents/usage/spawning-and-coordinating#observe) api to monitor the state of the judge agent:

```ts
const judge = await ctx.observe(entity(finishedChild.url))
```

This is a very powerful and expressive mechanism, because it means that agents [don't need to pre-define](/blog/2026/06/04/serverless-agents#turning-the-agent-inside-out) their APIs or communication interfaces.

They can just spawn agents with built in streams and durable state and observe / subscribe to their streams in real-time. For example, here are the wakes that the judge sees over a full debate, and what it actually does:

| # | Judge wake | Gate decision | Judge LLM run? | Manager woken? | Manager LLM run? |
| --- | --- | --- | --- | --- | --- |
| 1 | inbox | no debate yet → setup | **yes** (`start_debate`) | yes | no (debate not `done`) |
| 2 | A argument | `arguments.b` missing → sleep | no | no | no |
| 3 | B argument | both arguments in → forward rebuttals | no (imperative forward) | no | no |
| 4 | A rebuttal | `rebuttals.b` missing → sleep | no | no | no |
| 5 | B rebuttal | both rebuttals in → verdict | **yes** (write the verdict) | yes | yes (debate is `done`, relays verdict) |

The debate can't finish early. The judge only summarizes when the arguments and rebuttals are in. The manager only summarizes the verdict when it's properly returned. There's no path for the model to hallucinate answers or get the process wrong.

#### Hybrid control flow

That's the whole point of hybrid control flow: let the LLM interpret the prompt, make decisions and be creative when it needs to but otherwise use the durable state to make the control flow deterministic when you can.

So the LLM can't go off piste and your systems can be both expressive and reliable.

## Next steps

Hopefully this has given you a sense of how to start building with Electric Agents.

You can see the source code for the steps in this guide in the [agents-walkthrough example app](https://github.com/electric-sql/electric/tree/main/examples/agents-walkthrough) and see an interactive walkthrough in the [screencast video](https://youtu.be/beYF8FV019w) below:

<div class="embed-container">
  <YoutubeEmbed video-id="beYF8FV019w" title="Electric Agents walkthrough" />
</div>

See the [Usage overview](./usage/overview) for the full developer surface and see the [Playground example](/docs/agents/examples/playground) for more communication topologies and patterns.

If you have any questions, let us know on the [Electric Discord](https://discord.electric-sql.com).