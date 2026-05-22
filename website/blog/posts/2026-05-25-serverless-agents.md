---
title: "Serverless agents — managed agents in functions, not sandboxes"
description: >-
  The world needs managed agents. The architecture for them is serverless. Agents in functions, not sandboxes.
excerpt: >-
  Every major AI platform just shipped managed agents on the same kind of sandbox-based architecture. That's wrong. Managed agents belong in functions, not sandboxes.
authors: [thruflo]
image: /img/blog/serverless-agents/header.jpg
tags: [serverless, agents, architecture]
outline: [2, 3]
post: true
published: true
---

<script setup>
  import Tweet from 'vue-tweet'
  import Card from '../../src/components/home/Card.vue'
  import YoutubeEmbed from '../../src/components/YoutubeEmbed.vue'
  import AgentLoopAnimation from '../../src/components/blog/data-primitive-agent-loop/AgentLoopAnimation.vue'
</script>

<style scoped>
  figure,
  .embed-container {
    margin: 24px 0;
    border-radius: 2px;
    overflow: hidden;
  }
</style>

In the last few weeks, every major AI platform has shipped [managed&nbsp;agents](#managed-agents).

They're responding to the same demand, for infrastructure to bring agents online, with the same kind of [sandbox-based architecture](#the-rise-of-the-sandbox). That architecture is&nbsp;wrong.

Managed agents don't belong in sandboxes. They belong in functions, with stateless agent logic, durability in the data layer and tool execution in backend&nbsp;systems.

That's the architecture &mdash; [serverless agents](#principles-of-serverless-agents) &mdash; to wire agents into the workforce.

> [!Warning] <span style="font-weight: 700; font-size: 110%; color: var(--vp-c-warning-1)">λ</span>&nbsp; Serverless agents with Electric
> Build and run serverless agents with [Electric&nbsp;Agents](/agents/). See the <span class="no-wrap-sm">[blog&nbsp;post](/blog/2026/04/29/introducing-electric-agents) and [quickstart](/docs/agents/quickstart)<span class="-hidden-xxl">&nbsp;guide</span></span>.

<div class="embed-container">
  <YoutubeEmbed video-id="..." title="Serverless agents -- agents in functions, not sandboxes" />
</div>

<!--

Tweets:

Tweet 1

```
In the last few weeks, every major AI platform has shipped managed agents. On the same kind of sandbox-based architecture.

That architecture is wrong. Managed agents don't belong in sandboxes. They belong in functions.

Serverless agents with stateless logic, durability in the data layer and tool execution in backend systems. That's the architecture to actually wire agents into the workforce.
```

Tweet 2

```
The world needs managed agents. The architecture for them is serverless:
<blog link>
```

Tweet 3:

```
You can build and run serverless agents today on the Electric Agents platform:
<launch tweet>
```

-->

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

They need to be part of the team. Which means being wired into the tools that teams use to collaborate and get stuff done. They need to be tracked and managed, which means wiring them into governance processes and systems of record.

So how do you do that? Well, let's go from first principles.

### The rise of the sandbox

What is an agent? It's an LLM in a loop.

What everyone from [Chris McCord onwards](https://youtu.be/ojL_VHc4gLk?t=3397) figured out is that the LLM is really good at using tools like `bash` and `grep`. So the harnesses running the agent loop were designed around these tool calls. Which means they need to run in an environment that supports them, aka a computer.

Then, initially, when the LLM wanted to run a command, we reviewed it and manually approved (or rejected) the execution. However, as the agents got better, approving every command became boring and we designed ourselves out of the loop.

Hence the rise of the sandbox: an isolated computer in the cloud where a harness can [loop away like crazy](https://twitter.com/thruflo/status/2012644770703704333), getting stuff done without bothering you.

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

... memory overhead table ...

Most agent operations, be they tool calls or LLM instruction, are I/O based. You send a request to the Anthropic API and wait for the response to be streamed back. There's really no need to hold a whole computer in memory just to make an API request.

This tends not to matter when you're running at smaller scale. The value of the agent system and the cost of LLM inference outweigh the cost of standard compute. However, it does matter when you have lots of agents.

If your business is running on agents and those agents are spawning sub-agents every time there's a customer interaction, efficiency does matter and sandboxes are a blunt instrument with a lot of wasted compute.

### 2. Fragmentation

More fundamentally, sandboxes lead to fragmentation of artefacts and decision traces.

A harness looping away inside a computer creates artefacts using operating system primitives like files and processes. If the whole point and power of the agent is that it can do what it likes inside that computer then it's going to create a whole load of arbitrary activity and artefacts.

For example, if I run Claude Code on my local computer and ask it to spawn sub-agents to do some parallel research, it's going to:

- spawn those sub-agents in operating system processes
- store their session logs in `.jsonl` files inside a hidden folder in my user directory
- create and edit files in arbitrary locations
- make all sorts of arbitrary HTTP requests

That's exactly what you *don't* want from agents you're running your business on. Because what happens when you want to manage, monitor, collaborate on or review the agent activity? What are you going to do, `ssh` into the sandbox?

No, what you want is to be able to track and trace all the activity and artefacts and wire them into the [context graph](https://foundationcapital.com/ideas/context-graphs-ais-trillion-dollar-opportunity).

### 3. Coordination

In traditional software you were deploying deterministic systems with known topologies. Agents are not like that. Agents can spawn other agents, in increasingly dynamic and sophisticated topologies. Agents are also much more likely to be working in parallel than traditional users.

Coordination between managed agents has all the challenges of traditional distributed systems (durability, addressability, reactivity, spawning, signaling, scheduling, communication, coordination, concurrency, contention) but amplified by the scale and dynamic nature of agents.

Sandboxes compound the problem by forcing you to pre-define the APIs and communication topologies between managed agents. When what agents want and need is to be able to dynamically create their own topologies.


## Breaking out of the sandbox

The more sophisticated platforms are seeing these limitations and evolving their architecture. Breaking out of the harness-in-a-sandbox model to separate agent logic from tool call execution and rethink the fundamentals of isolation, integration and communication.

### Pulling apart the harness

In their [Scaling Managed Agents](https://www.anthropic.com/engineering/managed-agents) post, Anthropic explains their approach:

> The solution we arrived at was to decouple what we thought of as the “brain” (Claude and its harness) from both the “hands” (sandboxes and tools that perform actions) and the “session” (the log of session events).

Google's [Agent Executor (AX)](https://github.com/google/ax) platform explicitly separates the agent logic from the tool execution environment:

... readme mermaid diagram ...

### Rethinking isolation

This separation of concerns and spectrum of execution environments allows us to rethink isolation.

When an agent is a harness, designed to run on a local computer, everything needs to run in a full sandbox. However, when you've pulled apart the harness, you can see that agent logic and tool execution require different levels of isolation.

For example, Cloudflare have a spectrum of compute environments, the [execution ladder](https://blog.cloudflare.com/project-think/#the-execution-ladder), ranging from dynamic workers to full sandboxes. Agent logic can run in a lightweight V8 isolate, like a function, whilst heavier tool calls can be executed either in sandboxes, or in external backend systems.

This changes the game for managed agents, allowing:

- the **agent logic** to run in serverless functions
- the **tool calls** to be executed in backend systems

This transforms the resource efficiency of managed agents, allowing them to scale to zero like edge functions. And it solves fragmentation because the tool calls are executed in managed systems that you control and can monitor.

### Turning the agent inside out

One of the most influential talks in data systems is Martin Kleppmann's from Strange Loop in 2014 about [Turning the database inside-out](https://martin.kleppmann.com/2015/03/04/turning-the-database-inside-out.html):

<div class="embed-container">
  <YoutubeEmbed video-id="fU9hR3kiOK0" title="Turning the database inside-out" />
</div>

His concept was that databases are built on logs. What if you turn them inside-out and put the log on the outside? Well, agents are logs. What happens if you turn the agent inside-out and put the session log on the outside?

<figure>
  <Card>
    <ClientOnly>
      <AgentLoopAnimation />
    </ClientOnly>
  </Card>
</figure>

The answer is that it solves the dynamic coordination challenge. Allowing agents (and users and systems) to connect and monitor other agents directly by directly subscribing to and interacting with the log, rather than going through a pre-defined interface.

You don't need to pre-define the APIs for agent communication. Instead, agents can just connect, monitor, subscribe, fork and interact with each other.

## Principles of serverless agents

Pulling apart the harness, rethinking isolation and turning the agent inside-out leads to a new architecture for managed agents:

1. Treat agents as logical entities
2. Model agents as data, not compute
3. Separate agent logic from tool execution
4. Run the agent loop as a stateless function
5. Execute tool calls through backend systems

### 1. Agents are logical entities

### 2. Model agents as data, not compute

### 3. Separate agent logic from tool execution


- The agent loop's decisions and the actual tool execution are two different things
- They don't need to live in the same process, runtime, or trust boundary
- Decouple them. The agent loop decides; tool execution runs as online services, inside your business systems, against your data platform.
- This is the architectural answer to *"but agents need isolation"*:
  - The agent loop has nothing to isolate &mdash; it decides and dispatches, no arbitrary code execution
  - Isolation lives at the tool execution layer, where the side effects actually happen
  - Tool calls run with whatever isolation each tool requires &mdash; sandboxed MCP servers, managed services, your own APIs
- It is also the architectural answer to *"but agents need to integrate"*:
  - Decisions, traces, artefacts and side effects all land in the systems where the rest of your business runs
  - Decision traces are captured natively because tool calls execute on systems you control
  - Fragmentation goes away. Integration is native.
- Two pictures of the same agent, side by side:
  - **Fragmentation** &mdash; harness in a sandbox sprawls tool calls into bash, grep, curl, then artefacts disappear into hidden `~/.claude/` files. Tool calls and session state share the same opaque box.
  - **Integration** &mdash; function with decoupled tools cleanly flows through MCP, DB and API layers into systems of record (SAP, Salesforce, Snowflake). Tool calls execute where the business already operates.
- Foundation Capital's *Context Graphs* thesis lands precisely here: governance can't be bolted on; the agent has to be in the execution path at commit time
- This is the gift that makes online managed agents a real category, not a marketing badge for a hosted sandbox


### 4. Run the agent loop as a stateless function


- With state lifted into the data layer and tool execution decoupled, the agent loop is small enough to run as a stateless function
- Serverless economics for agents: scale to millions when work flows in. Scale to zero when it doesn't.
- The agent is long-lived as a logical entity (the state persists). The compute is fully elastic.
- No 24/7 process babysitter. No Docker fleet. No Lambda layer with a FUSE-mounted filesystem faking a desktop.
- The pricing signal is already in the market
  - Anthropic Managed Agents at $0.08 per session-hour
  - Azure Foundry scale-to-zero pricing on hypervisor sandboxes
  - The economics of managed agents only work if the compute is elastic
- The dominant sandbox-based offerings are bolting elastic pricing onto a non-elastic primitive. Same boxes, fancier billing.
-

### 5. Execute tool calls through backend systems




<!-- TONE: conceptual. The first gift. Reader leaves thinking
     "yes, agents as data - that makes sense" without yet
     needing to know what a durable stream actually is.
     Target: ~250-350 words. -->

- Don't model the agent as a process. Model it as data.
- The session log &mdash; messages, tool calls, results, observations, artefacts &mdash; lives in a durable, addressable stream in the data layer
- Durable *state*, not durable *execution*. The process can come and go. The state survives.
- The agent becomes a long-lived logical entity. It lives, even when nothing is running.
- Anthropic put it cleanly: *"The harness becomes cattle. The session log is the durable record of events."*
- This resolves the dark-session problem at its root
  - Every session is addressable by URL &mdash; nothing hidden, nothing dark
  - Every session is evaluable, shareable, forkable, replayable
  - The log *is* the observability surface &mdash; monitoring and evaluation are native, not bolted on
- It also resolves the multi-agent coordination problem
  - Anyone &mdash; users, agents, other systems, other teams &mdash; can subscribe to a session at any time
  - Dynamic, distributed topologies emerge naturally because the substrate is the data, not a pre-defined interface


## Benefits for the business

- scale
- integration
- collaboration
- transformation

### Scale

Workforce-scale agent deployment becomes economically and operationally feasible as a default, not as an aspiration

### Integration

Decisions, traces, artefacts and side effects all land in the systems where the rest of your business runs

### Collaboration

Every session is addressable by URL &mdash; nothing hidden, nothing dark
  - Every session is evaluable, shareable, forkable, replayable
  - The log *is* the observability surface &mdash; monitoring and evaluation are native, not bolted on
- It also resolves the multi-agent coordination problem
  - Anyone &mdash; users, agents, other systems, other teams &mdash; can subscribe to a session at any time
  - Dynamic, distributed topologies emerge naturally because the substrate is the data, not a pre-defined interface

### Transformation

workforce transformation
... overall benefit, incremental automation of knowledge work, efficiency, survival and competitiveness in the market ...


## Building with Electric

<!-- TONE: this is where the product introduction lands.
     Earned by the architectural argument, not pitched.
     Concrete handler signature + architecture diagram makes
     it real. Don't duplicate the launch post - point at it.
     Target: ~350-450 words. -->

- This is what we've built. [Electric Agents](/agents/) is the agent platform for the architecture described above.
- Agents are defined as entity handlers. Each entity gets its own durable stream &mdash; its memory, its inbox, a complete audit trail of everything it did.
- The handler is a stateless function. A lightweight V8-class runtime spins it up in milliseconds, scales to millions of concurrent agents, costs nothing when idle.
- The architecture has three layers:
  - **Data layer** &mdash; durable streams hold session state, addressable by URL, replayable, forkable
  - **Function runtime** &mdash; stateless agent handlers, your code, your stack, your deployment
  - **Tool execution** &mdash; online services, MCP servers, managed backends, your APIs &mdash; wherever isolation and integration make sense
- Agents are your code in your app, running on your compute. Managed agents, without the platform lock-in.
- For the full platform pitch, see the [launch post](/blog/2026/04/29/introducing-electric-agents). For the data primitive, see the [agent loop primitive](/blog/2026/04/08/data-primitive-agent-loop) piece. This post is about the architectural pattern; those are about the platform that ships it.
- Take it from concept to production via the [Quickstart](/docs/agents/quickstart) or the [Docs](/docs/agents/).

... re-use the video here ...

<!-- ASSET: code sample - Electric Agents handler signature.
     Use the defineEntity shape from the deck:

     ```ts
     import { defineEntity } from "@electric/agents"

     defineEntity("assistant", {
       async handler(ctx) {
         ctx.useAgent({
           systemPrompt: "You are a helpful assistant.",
           model: "claude-sonnet-4-5",
           tools: [calculatorTool, ...ctx.darixTools],
         })
         await ctx.agent.run()
       },
     })
     ```

     Minimal, real, illustrative. Keep it tight. -->

<!-- ASSET: architecture diagram - three layers:

     [Tool execution: online services / MCP / APIs / systems of record]
              ↑↓  (tool calls + results)
     [Function runtime: stateless agent handlers]
              ↑↓  (state reads + writes)
     [Data layer: durable streams - state, addressable, observable]

     Adapt the deck's stacked AGENTS / STREAMS / SYNC visual.
     This is the post's architectural reference image. -->

***

<!-- ============================================================
     NEXT STEPS
     CTAs are spread-and-cite oriented per the intent.
     Conversion is secondary. Anchor in the canon.
     Target: ~120-180 words.
     ============================================================ -->

### Next steps

Managed agents don't belong in sandboxes. They belong in functions, with stateless agent logic, durability in the data layer and tool execution in backend systems.

You can build serverless agents today, on [Electric Agents](/agents/). Re-using your existing prompts, tool calls, AI engineering. As part of your existing web infrastructure.

See the [introductory blog&nbsp;post](/blog/2026/04/29/introducing-electric-agents) and dive into the [Quickstart](/docs/agents/quickstart)&nbsp;guide now.

If there's anything you'd like to discuss, you're welcome to [join the Electric Discord](https://discord.electric-sql.com), say hello and ask any questions there.



<!--
============================================================
META FOOTER - DELETE BEFORE PUBLISHING
============================================================

## Intent

- POINT: Agents belong in stateless functions, with tool
  execution separated, addressable by durable state in the
  data layer. This is the architecture for workforce-scale
  managed online agents. The industry agrees on the demand
  but almost everyone got the architecture wrong.
- HOOK: "Agents in functions" - contrarian, sticky,
  retweetable. Pairs with the immediate objection ("but
  agents need isolation!") which becomes the post's
  structural pivot.
- TAKEAWAY: A new mental model. Model the agent as data;
  separate agent logic from tool execution; run the agent
  loop as a stateless function. Isolation lives at the tool
  execution layer, not the agent loop.
- AUTHORITY: Electric has built the infrastructure. The
  dissenting architectural voices in the April-May 2026
  wave (Anthropic "harness becomes cattle", Foundation
  Capital "decision traces in execution path", Google Cloud
  Agentic Data Cloud) all triangulate the same direction.
- CTA: Engage with the concept - cite, share, discuss.
  Read deeper into the canon. Soft CTA: try Electric Agents.

## Format

Hybrid best-sales-deck outer arc with an explicit Q+A bridge:

- Big Change = April-May 2026 managed-agents wave
- Convergence flipped (sub-section in Big Change):
  "almost everyone got the architecture wrong"
- Promised Land = workforce-scale integrated agents
- Bridge = "Agents in functions?! Are you having a giraffe?"
  - defuses isolation as the load-bearing pivot
- Gifts (three) = agents are data / logic separates from
  tool execution / functions not fleets
- Earned product intro = "Building with Electric"

The Bridge is moved EARLY (after Promised Land, before
Gifts) so the isolation objection is defused before the
gifts unpack. In the previous draft this defusal was
buried at the end.

## Title brief

Sentence case. Hook is the title. The handle hierarchy:

  agents in functions (hook)
    -> serverless agents (architecture term)
      -> Electric Agents (product)

Candidates:
- "Agents in functions" (PRIMARY - clean, retweetable,
  citation-friendly)
- "Agents in functions, not sandboxes"
- "Agents belong in functions"
- "Agents in functions - the architecture for the agentic
  workforce" (long-form subtitle option)

Recommend "Agents in functions" plain. The post body earns
the expansion.

## Description brief

SEO. No HTML. ~150-160 chars. Encode the bold claim and
the architectural cut.

Draft:
"Agents in functions - with tool execution separated and
durable state in the data layer. The architecture for
workforce-scale online agents."

## Excerpt brief

Listing card excerpt. Target ~25-35 words / 2-3 short
sentences, matching the rhythm of recent post excerpts on
the blog index.

Draft:
"Within two weeks in April 2026, every major AI platform
shipped managed agents - and almost all of them got the
architecture wrong. Agents belong in functions, not
sandboxes. Here's the architectural cut."

## Image prompt

Subject: a visual that captures "agents in functions" as a
contrast with the laptop-era sandbox.

Options:
- Side by side: heavy laptop sandbox on the left, a swarm
  of light ephemeral functions on the right wired into
  business systems
- The deck's "Fragmentation vs Integration" composition,
  abstracted into a header
- A three-layer architecture rendering - durable stream,
  function instances, tool execution - as planes in space

Spec:
- Aspect ratio 16:9 to 16:10 (~1536x950)
- Master as high-quality JPG
- Center-center composition; key content in inner frame
- Dark theme background
- Brand palette: #D0BCFF, #00d2a0, #75fbfd, #F6F95C, #FF8C3B
- Site font: OpenSauceOne

Run /blog-image-brief for a fuller brief with reference
image analysis and a DALL-E prompt.

## Asset checklist

- [ ] Header image - /img/blog/serverless-agents/header.jpg
      (or /img/blog/agents-in-functions/header.jpg if the
      file is renamed - see open question)
- [ ] (Optional) hero illustration / animation near TLDR
- [ ] April-May 2026 launch references - confirm exact
      URLs for Anthropic Managed Agents, Cloudflare Project
      Think, OpenAI Agents SDK update, Azure Foundry Hosted
      Agents, Google Cloud Agentic Data Cloud, LangChain
      Managed Deep Agents
- [ ] Anthropic quote: "harness becomes cattle / session
      log is the durable record of events" - confirm exact
      wording + source URL
- [ ] Cloudflare quotes: three-waves framing - confirm
      exact wording + source URL
- [ ] Foundation Capital quote: "decision traces require
      being in the execution path at commit time" -
      confirm exact wording + which Context Graphs piece
- [ ] Architectural-divide panel (Big Change subsection):
      sandbox vendors vs dissenting voices
- [ ] Loop-in-the-log visual (Gift 1)
- [ ] Fragmentation vs Integration visual (Gift 2) - the
      single most retweetable visual in the post; adapt
      from the deck
- [ ] Function-instances-on-stream visual (Gift 3,
      optional)
- [ ] Three-layer architecture diagram (Building with
      Electric)
- [ ] Code sample: defineEntity handler signature
- [ ] Cross-links to canon posts (data primitive,
      introducing Electric Agents, durable sessions,
      building AI apps on sync)
- [ ] Demo video embed (Building with Electric, optional)

## Typesetting checklist

- [ ] Title in sentence case (not Title Case)
- [ ] Non-breaking spaces on title/header widows ("Electric
      Agents", "Durable Streams", "workforce-scale")
- [ ] Avoid LLM tells ("it's worth noting", "importantly",
      "in conclusion", "let's dive in", "at its core",
      "in today's landscape")
- [ ] Avoid hype words ("revolutionary", "game-changing",
      "leverage", "ecosystem", "unlock", "seamlessly",
      "robust", "holistic", "synergy")
- [ ] Spell-check: "separate" / "separation" / "Separating"
      (previous draft had "separate" / "separation" /
      "Seperating" - fixed in this rewrite, double-check
      during prose-up)
- [ ] Check title + header image at multiple screen widths
- [ ] Set published: true when ready

## Open questions

- ETHOS: which specific moment, conversation, or customer
  interaction grounds (a) the "shift feels real" beat and
  (b) the "almost everyone got it wrong" beat? Two
  placeholders left inline - drop anecdotes there during
  prose-up. The contrarian claim is much stronger with
  lived evidence behind it.
- FILE RENAME: keep the URL slug as `serverless-agents`
  (matching the filename `2026-05-21-serverless-agents.md`)
  or rename to `agents-in-functions` to match the new
  hook? Renaming creates URL/title parity but loses any
  pre-shared links. Recommend keeping the slug - the URL
  is the architectural term, the title is the hook handle.
- HOMEPAGE: should this post show on the homepage
  (homepageSolution + homepageOrder)? Given the
  seminal-post ambition, likely yes. Suggest order 5,
  above introducing-electric-agents (10) and
  data-primitive (20).
- TITLE: confirm "Agents in functions" as the final
  handle. The brief is firm on this. Alternative shapes
  only if author wants a longer subtitle.
- GIFT CUT: chose three architectural moves (data /
  separation / functions) over the deck's product-
  architecture cut (data layer / sync substrate / functions
  runtime) and over the binary Fragmentation vs
  Integration. The data/separation/functions cut is MECE
  for the architectural argument; the deck cut is MECE for
  the product. Confirm this is the right cut for the post.
- CLOUDFLARE QUOTE: the three-waves framing supports the
  Big Change, but Cloudflare's own stack (Durable Objects
  + Workflows) is exactly the thing the post argues
  against in the "guard the log" beat. Worth a footnote
  acknowledgement of the tension, or leave it for the
  architecturally-aware reader to notice?
- FOUNDATION CAPITAL: which specific piece in the Context
  Graphs series to cite as the primary reference - the
  November 2025 launch, the December 2025 follow-up, the
  May 2026 piece, or the Aaron Levie / Box podcast?
  Author judgment.
- GOOGLE NEXT '26 DATE: confirm the exact Agentic Data
  Cloud announcement date so it can be placed precisely
  in the timeline (April? May?).

## Review

When you've prosed it up, run /blog-review to check the
draft against the outline, format, and execution
guidelines.

-->
