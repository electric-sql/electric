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

<style scoped>
  figure {
    margin: 32px 0;
    border-radius: 2px;
    overflow: hidden;
  }
</style>

# Walkthrough

This guide walks through the steps to go from a new, or existing, web or mobile application to a dynamic <span class="no-wrap">multi-agent</span> system with [Electric Agents](/agents/).

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

This command uses the nodejs template. Hono supports [various runtimes](https://hono.dev/docs/getting-started/basic), including edge functions to deploy your [agents as serverless functions](/blog/2026/05/26/serverless-agents).

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
```

Here we just hardcode the values. You'll want these to be configurable using env vars in production. How you do that depends on how you deploy your app.

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
      model: "claude-sonnet-4-6",
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

See the [Durable Streams](/blog/2026/04/08/data-primitive-agent-loop) and [Serverless Agents](/blog/2026/05/26/serverless-agents) blog posts for more information.

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
      model: "claude-sonnet-4-6",
      tools: []
    })

    await ctx.agent.run()
  },
})
```

This means the `systemPrompt` for the assistant can be defined when it's spawned.

### Manager agent

Then let's define a new `manager` entity type:

```ts
registry.define("manager", {
  description: "A manager agent that delegates work to assistants",
  async handler(ctx, wake) {
    if (wake.type === 'inbox') {
      await ctx.spawn(
        'assistant',
        Math.random().toString(),
        { systemPrompt: `Roast the user message. When done, report back to your manager.` },
        { initialMessage: wake.payload.text, wake: 'runFinished' }
      )
    }

    ctx.useAgent({
      systemPrompt: ctx.args.systemPrompt || "You are a manager agent.",
      model: "claude-sonnet-4-6",
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
    Math.random().toString(),
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
        Math.random().toString(),
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
      model: "claude-sonnet-4-6",
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
4. End your turn after spawning them. wait until you have both responses and both assistants have **fully** responded.
5. Summarize the key arguments of the debate and provide your judge's verdict to the parent agent.

Notes:
- You are an impartial judge.
- Use the assistants to gather the two sides.
- Wait for **all** of the assistants to return **full** responses. Don't respond to partial / in-progress responses.
- Do not generate/hallucinate the argument yourself. You must wait for the assistants to fully respond and then synthesize their responses. Don't anticipate or make them up.
- Wait until the debate is fully finished before reporting back to the parent agent.`,
      model: "claude-sonnet-4-6",
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
        Math.random().toString(),
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
      model: "claude-sonnet-4-6",
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




