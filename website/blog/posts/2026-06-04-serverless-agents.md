---
title: "Serverless agents — managed agents in functions, not sandboxes"
description: >-
  The world needs managed agents. The architecture for them is serverless. Agents in functions, not sandboxes.
excerpt: >-
  Every major AI platform just shipped managed agents on the same kind of sandbox-based architecture. That's wrong. Managed agents belong in functions, not sandboxes.
authors: [thruflo]
image: /img/blog/serverless-agents/header.jpg
tags: [serverless, agents, electric-agents, architecture]
outline: [2, 3]
post: true
published: true
---

<script setup>
  import Tweet from 'vue-tweet'
  import Card from '../../src/components/home/Card.vue'
  import YoutubeEmbed from '../../src/components/YoutubeEmbed.vue'
  import AgentLoopFillDemo from '../../src/components/streams-home/AgentLoopFillDemo.vue'
  import HomeCompositionHero from "../../src/components/home/HomeCompositionHero.vue"
</script>

<style scoped>
  figure,
  .embed-container {
    margin: 32px 0;
    border-radius: 2px;
    overflow: hidden;
  }
  figure.section-image {
    position: relative;
    display: block;
    margin: 48px 0 -49px 0;
    z-index: 2;
    padding-top: 32px;
    border-top: 1px solid var(--vp-c-divider);
  }
  .layers-illustration-wrapper {
    background: rgb(17, 19, 23);
    position: relative;
    width: 100%;
    aspect-ratio: 5.6 / 4;
  }
  @media (max-width: 860px) {
    .layers-illustration-wrapper {
      aspect-ratio: 7 / 4;
    }
  }
</style>

In the last few weeks, every major AI platform has shipped [managed&nbsp;agents](#managed-agents).

They're responding to the same demand, for infrastructure to bring agents online, with the same kind of [sandbox-based architecture](#the-rise-of-the-sandbox). That architecture is&nbsp;wrong.

Managed agents don't belong in sandboxes. They belong in functions, with stateless agent logic, durability in the data layer and tool execution in backend&nbsp;systems.

That's the architecture &mdash; [serverless agents](#principles-of-serverless-agents) &mdash; to wire agents into the workforce.

> [!Warning] <span style="font-weight: 700; font-size: 110%; color: var(--vp-c-warning-1)">λ</span>&nbsp; Serverless agents with Electric
> Build and run serverless agents with [Electric&nbsp;Agents](/blog/2026/04/29/introducing-electric-agents) now. See the [Walkthrough](/docs/agents/walkthrough)&nbsp;guide.

<div class="embed-container">
  <YoutubeEmbed video-id="beYF8FV019w" title="Electric Agents walkthrough" />
</div>


## Managed agents

In the last few weeks, what seems like every major AI platform has shipped their version of managed agents:

- [Anthropic Managed Agents](https://claude.com/blog/claude-managed-agents) (April 8th)
- [Cloudflare Project Think](https://blog.cloudflare.com/project-think) (April 15th)
- [OpenAI Workspace Agents](https://openai.com/index/introducing-workspace-agents-in-chatgpt/) (April 15th)
- [Azure Foundry Hosted Agents](https://devblogs.microsoft.com/foundry/introducing-the-new-hosted-agents-in-foundry-agent-service-secure-scalable-compute-built-for-agents/) (April 22nd)
- [Amazon Managed Agents](https://aws.amazon.com/bedrock/managed-agents-openai/) (April 28th)
- [LangChain Managed Deep Agents](https://www.langchain.com/blog/introducing-managed-deep-agents) (May 13th)
- [Google Agent Executor](https://github.com/google/ax) (May 20th)

These companies have the best visibility in the sector. They're seeing that the world needs managed agents.

As Sunil and Kate from the Cloudflare Agents team [put it](https://blog.cloudflare.com/project-think):

> "The first wave was chatbots. The second was coding agents. We are now entering the third wave: durable, distributed agents."

This third wave is the wave of workforce transformation. Agents joining the workforce, one automation and one assistive task at a time.

### Bringing agents online

For this to happen, agents need to be brought online, scaled out and integrated into the day-to-day systems and processes that companies run on.

<figure style="">
  <a href="/img/blog/serverless-agents/integration.jpg" class="no-visual">
    <img src="/img/blog/serverless-agents/integration.jpg">
  </a>
</figure>

They need to be part of the team. Which means being wired into the tools that teams use to collaborate and get stuff done. They need to be tracked and managed, wiring them into governance processes and systems of record.

### The rise of the sandbox

So how do you do that? Well, what is an agent? It's an LLM in a loop.

<figure>
  <a href="/img/blog/serverless-agents/llm-in-a-loop.jpg" class="no-visual">
    <img src="/img/blog/serverless-agents/llm-in-a-loop.png">
  </a>
</figure>

What everyone from [Chris McCord onwards](https://youtu.be/ojL_VHc4gLk?t=3397) figured out is that the LLM is really good at using tools like `bash` and `grep`. So the harnesses running the agent loop were designed around these tool calls. Which means they need to run in an environment that supports them, aka a computer.

Then, initially, when the LLM wanted to run a command, we reviewed it and manually approved (or rejected) the execution. However, as the agents got better, approving every command became boring and we designed ourselves out of the loop.

Hence the rise of the sandbox: an isolated computer in the cloud where a harness can [loop away like crazy](https://x.com/thruflo/status/2012644770703704333), getting stuff done without bothering you.

#### Sandboxes for managed agents

This led to an explosion in sandbox infrastructure. With some awesome companies like Daytona becoming the [fastest growing infra in history](https://www.daytona.io/dotfiles/fastest-growing-infra-company-in-history). So, it's no surprise that the new infrastructure for managed agents has been based around sandboxes.

For example, here's Satya Nadella, the Microsoft CEO, on the [Azure Foundry launch](https://x.com/satyanadella/status/2047033636923568440):

> Every agent will need its own computer. And with new Hosted agents in Foundry, every agent gets its own dedicated enterprise-grade sandbox

Which sounds very plausible. Until you consider the consequences of sandbox isolation for managed agents.


## Limitations of sandboxes

There are three main downsides of sandbox isolation and all of them have serious consequences for managed agents:

1. [resource efficiency](#_1-resource-efficiency) &mdash; which becomes more important the more agents you run
2. [fragmentation](#_2-fragmentation) &mdash; which is directly opposed to wiring into the business
3. [coordination](#_3-coordination) &mdash; which is critical for online agents

### 1. Resource efficiency

Running an agent inside its own VM or Docker container, or even a Firecracker, uses more compute resource than is needed to run the agent logic.

<figure style="margin: 0">

| Isolate             | Start time              | Memory overhead |
| ------------------- | ----------------------- | --------------- |
| Traditional VM      | seconds                 | 256MB+          |
| Docker Container    | ~500ms                  | 50MB            |
| Firecracker microVM | ~125ms                  | 128MB           |
| V8 isolate worker   | <5 ms cold; sub-ms warm | 2MB             |

</figure>

Most agent operations, be they tool calls or LLM instruction, are I/O based. You send a request to a data system or the Anthropic API and wait for the response to be streamed back. There's really no need to hold a whole computer in memory just to make an API request.

This tends not to matter when you're running at smaller scale. The value of the agent system and the cost of LLM inference outweigh the cost of standard compute. However, it does matter when you have lots of agents.

If your business is running on agents, and those agents are spawning sub-agents every time there's a customer interaction, then sandboxes are a blunt instrument with a lot of wasted compute.

### 2. Fragmentation

Perhaps most fundamentally, sandboxes lead to fragmentation of artefacts and decision traces.

A harness looping away inside a computer uses operating system primitives like files and processes. If the power of the agent is that it can do what it likes on that computer, then it's going to generate a whole load of arbitrary activity and artefacts.

For example, if I run Claude Code on my local computer and ask it to spawn sub-agents to do some parallel research, it's going to:

- spawn those sub-agents in operating system processes
- store their session logs in `.jsonl` files inside a hidden folder in my user directory
- create and edit files in arbitrary locations
- make all sorts of arbitrary HTTP requests

<figure style="margin: 32px 0 40px 0">
  <a href="/img/blog/serverless-agents/fragmentation-integration.jpg" class="no-visual">
    <img src="/img/blog/serverless-agents/fragmentation-integration.png">
  </a>
</figure>

That's exactly what you *don't* want from agents you're running your business on. Because what happens when you want to manage, monitor, collaborate on or review the agent activity? What are you going to do, `ssh` into the sandbox?

No, you need to be able to track and trace the activity and artefacts and [wire them into the business](https://foundationcapital.com/ideas/context-graphs-ais-trillion-dollar-opportunity).

### 3. Coordination

Traditional software is deterministic and deployed with pre-defined topologies. Agents are not like that. Agents can spawn other agents, in increasingly dynamic and sophisticated topologies.

Coordination between managed agents has all the challenges of traditional distributed systems (durability, addressability, reactivity, spawning, signaling, scheduling, communication, coordination, concurrency, contention) but amplified by the scale, parallelism and dynamic nature of agents.

Sandboxes compound the problem by forcing you to pre-define the APIs and communication topologies between managed agents. Managing this kind of combinatorical complexity with manual data wiring hits a wall at agent scale.

<figure class="section-image">
  <img src="/img/blog/serverless-agents/header5.jpg" />
</figure>

## Breaking out of the sandbox

The more sophisticated platforms are seeing these limitations and evolving to break out of the harness-in-a-sandbox model.

### Pulling apart the harness

In their [Scaling Managed Agents](https://www.anthropic.com/engineering/managed-agents) post, Anthropic explains their approach:

> The solution we arrived at was to decouple what we thought of as the “brain” (Claude and its harness) from both the “hands” (sandboxes and tools that perform actions) and the “session” (the log of session events).

Google's [Agent Executor (AX)](https://github.com/google/ax) platform explicitly separates the agent logic from the tool execution environment:

<Card style="margin: 32px 0">
  <img src="/img/blog/serverless-agents/ax-mermaid.png" />
</Card>

This separation of concerns and spectrum of execution environments allows us to rethink isolation.

### Rethinking isolation

When an agent is a harness, designed to run on a local computer, everything needs to run in a full sandbox. However, when you've pulled apart the harness, you can see that agent logic and tool execution require different levels of isolation.

For example, Cloudflare have a spectrum of compute environments, the [execution ladder](https://blog.cloudflare.com/project-think/#the-execution-ladder), ranging from dynamic workers to full sandboxes. Agent logic can run in a lightweight V8 isolate, like a function, whilst heavier tool calls can be executed either in sandboxes, or in external backend systems.

This genuinely changes the game for managed agents. Allowing the **agent logic** to run in serverless functions while the **tool calls** are executed in backend systems. This transforms the resource efficiency of managed agents, allowing them to scale to zero like edge functions. And it solves fragmentation because the tool calls are executed in managed systems that you control and can monitor.

### Turning the agent inside out

One of the most influential talks in data systems is Martin Kleppmann's from Strange Loop in 2014 about [Turning the database inside-out](https://martin.kleppmann.com/2015/03/04/turning-the-database-inside-out.html). His concept was that databases are built on logs. What if you turn them inside-out and put the log on the outside?

Well, as we know, [agents are logs](/streams/):

<figure style="margin: 40px 0">
  <AgentLoopFillDemo />
</figure>

What happens if you turn the *agent* inside-out and put the session log on the outside?

The answer is that it solves the dynamic coordination challenge. Allowing agents, users and systems to connect-to and monitor other agents by subscribing to and interacting directly with the log &mdash; rather than going through a pre-defined interface.

<figure class="section-image">
  <img src="/img/blog/serverless-agents/header9.jpg" />
</figure>

## Serverless agents

Pulling apart the harness, rethinking isolation and turning the agent inside-out leads to a new architecture of **serverless agents**.

One where you treat agents as logical entities, model agents as data, separate agent logic from tool execution, run the agent loop as a stateless function and execute tool calls through your backend systems.

### Principles

The key principles of serverless agent architecture are:

1. **Treat agents as logical entities** <br /> Agents are logical entities that exist, even when they're not running.
2. **Model agents as data, not compute** <br /> Agents live in the data layer. Durable state, not durable execution.
3. **Separate agent logic from tool execution** <br /> Pull apart the harness to seperate the brains from the execution.
4. **Run the agent loop as a stateless function** <br /> With durability in the data layer and the ability to scale to zero.
5. **execute tool calls through backend systems** <br /> for isolation and so artefacts and decision traces can be captured

### Benefits

The result is a better way to scale-out and integrate agents into the business:

1. **scale**: workforce-scale agent deployment becomes more efficient and elastic
2. **integration**: no fragmentation; thinking and artefacts can be wired into the business
3. **collaboration**: teams can collaborate across and around agent sessions
4. **transformation**: businesses can integrate agents into the workforce

<figure class="section-image">
  <div class="layers-illustration-wrapper">
    <HomeCompositionHero />
  </div>
</figure>

## Building with Electric

You can build and run serverless agents today using [Electric Agents](/agents/).

Electric is the first agent platform built on a sync engine. It models agents as long-lived logical entities. Durability is stored in the data layer. Turning the agent inside out with Durable Streams as a [first-class data primitive for the agent loop](/blog/2026/04/08/data-primitive-agent-loop).

<figure style="border:0.5px solid #75FBFD;">
  <a href="/img/blog/introducing-electric-agents/one-primitive.jpg" class="no-visual">
    <img src="/img/blog/introducing-electric-agents/one-primitive.jpg">
  </a>
</figure>

Agents are defined as serverless event handlers. The handler is a stateless function that can run as a request handler in your web application or edge workers. Tool execution is seperated from agent logic and designed to be handled by backend services.

For example, this is how you define an entity:

```ts
import { defineEntity } from "@electric-ax/agents-runtime"

defineEntity("assistant", {
  async handler(ctx) {
    ctx.useAgent({
      systemPrompt: "You are a helpful assistant.",
      model: "claude-sonnet-4-5",
      tools: [...ctx.electricTools],
    })
    await ctx.agent.run()
  },
})
```

Everything in the handler function is your agent logic and the [Electric Agents runtime](/agents/) takes care of the data wiring and scheduling for you. This allows you to run agents in functions, as long-lived logical entities that can scale to zero.

With Electric, agents are your code in your app, running on your compute with your AI engineering and models of choice. It's the infrastructure for managed agents, without the platform lock-in.

See the [Walkthrough guide](/docs/agents/walkthrough) and video below to go from your first entity definition to collaborative, serverless, multi-agent systems on Electric:

<div class="embed-container">
  <YoutubeEmbed video-id="beYF8FV019w" title="Electric Agents walkthrough" />
</div>

### Next steps

Managed agents don't belong in sandboxes. They belong in functions, with stateless agent logic, durability in the data layer and tool execution in backend systems.

You can [build serverless agents today](/docs/agents/quickstart), on [Electric Agents](/blog/2026/04/29/introducing-electric-agents). Re-using your existing prompts, tool calls, AI engineering. As part of your existing web infrastructure.

If you have ideas or questions, let us know on the [Electric Discord](https://discord.electric-sql.com).
