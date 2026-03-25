---
title: "Durable\u00A0Streams \u2014 the data primitive for the agent loop"
description: >-
  Agents accumulate state in the agent loop — messages, tool calls, results,
  observations. This is a new kind of data with demands that existing
  infrastructure wasn't designed for. Durable Streams is the purpose-built
  primitive that meets them.
excerpt: >-
  Agents are stateful. The agent loop accumulates a new kind of data that
  needs a new kind of primitive. Durable Streams is that primitive.
authors: [thruflo]
image: /img/blog/durable-streams-data-primitive-for-the-agent-loop/header.jpg
tags: [durable-streams, agents, sync]
outline: [2, 3]
post: true
published: true
---

<!-- STRUCTURAL: TLDR — state the point immediately. No setup. Technical
     audience wants the answer first. 1-2 short paragraphs then info box. -->

Durable&nbsp;Streams is the data primitive for the agent loop. Agents are
stateful — they accumulate messages, tool calls, results and observations
as they execute. This state is a new kind of data with demands that existing
infrastructure wasn't designed for.

A durable stream is a persistent, addressable, append-only log that's
reactive, subscribable, replayable, forkable and structured. It's the
primitive this data needs.

> [!Tip] <img src="/img/icons/durable-streams.square.svg" style="height: 18px; margin-right: 6px; display: inline; vertical-align: text-top" /> Durable&nbsp;Streams &mdash; docs and deployment
> See the [Durable&nbsp;Streams docs](https://durablestreams.com) and [deploy now on Electric&nbsp;Cloud](https://dashboard.electric-sql.cloud/?intent=create&serviceType=streams).

<!-- ============================================================
     SITUATION
     Establish shared reality. Every bullet obvious. Declarative,
     confident, no persuasion. The reader nods along.
     ============================================================ -->

## The agent loop

<!-- STRUCTURAL: This section IS the situation. It also serves as the
     accessible explainer of the agent loop for readers (including
     investors) who haven't built agents themselves. Keep it concrete
     and visual. -->

<!-- ASSET: animated illustration — the agent loop cycle
     (observe → think → act → observe) with state accumulating
     as entries in an append-only log. This is the core visual
     metaphor for the entire post. -->

- agents are being deployed at massive and accelerating scale — projections
  run to trillions of agent instances
- the core execution pattern behind them is the agent loop: a cycle of
  observe → think → act → observe
- the agent receives a task, reasons about what to do, selects and executes
  an action (API call, code execution, search, file edit), then feeds the
  result back into its own context as a new observation
- this loop repeats — each iteration is a full inference call where the model
  decides whether to continue acting or return a final answer
- with every iteration, state accumulates: messages, tool calls, tool call
  results, observations, artifacts
- this accumulated state is the value — the longer the loop runs, the more
  work gets done, the more automation, the more value for the organization
- this is a genuinely new kind of data — it didn't used to exist; as an
  industry we're still figuring out what it is and how to work with it

<!-- TONE: Write the last bullet with the quiet authority of someone
     who's been doing the figuring. Not hand-waving — matter of fact. -->

<!-- ============================================================
     COMPLICATION
     Tension. Fast. Three beats: we're at the front of this,
     we tried, existing infra wasn't enough. The Postgres math
     moment makes it concrete and earned.
     ============================================================ -->

<!-- STYLE: Ethos through honesty. "Our infra wasn't enough" earns
     more credibility than listing who uses it. Touch on the
     collaborations as context for the insight, not for status. -->

- we've seen this firsthand — we built reactive sync infrastructure and
  some of the best agentic teams and frameworks built on it
- we were prototyping AI SDK transport integrations on our Postgres sync
  service; we did the math: 50 tokens per second across a thousand
  concurrent sessions is 50,000 writes per second; Postgres maxes out
  around 20k; factor in centralized latency and it didn't add up
- through working with pioneers like `<list frameworks>` and agentic products like
  `<list products>`, we saw that previous-generation databases
  and object storage were not fit for purpose — even when we'd made them
  reactive and synced-up, they weren't what agents needed
- but we realized the delivery protocol was fine — it was going through the
  database that was the problem; we wanted to write directly into the back
  of a "shape" (our subscribable partial-replication primitive); a shape was
  already an addressable, subscribable log; strip out the database, let
  agents write directly into the log, and you have a durable stream
- that's why we generalized our sync protocol into
  [Durable&nbsp;Streams](/primitives/durable-streams) — this post shares
  what we learned about what agent state demands and what we built to meet it

<!-- STRUCTURAL: The implicit question is now in the reader's mind:
     "OK, so what does the data primitive for the agent loop need to be?"
     The answer: a durable stream. The three pillars that follow make
     the case. -->

## What agent state demands

<!-- ============================================================
     PILLAR 1
     The argument is won or lost here. Establish the DEMANDS on
     agent state, then derive the requirements. If the reader buys
     the demands, the requirements follow inevitably. One sharp
     sentence per demand.
     ============================================================ -->

<!-- TONE: Ground demands in present reality. Name the tools and
     frameworks people are actually using today. This isn't future
     vision — it's what's happening now and what's clearly coming. -->

### How humans need to use it

- real-time collaboration — multiple users and agents working on the same
  session at the same time; not the current pattern of one person driving a
  [Claude&nbsp;Code](https://claude.com/claude-code) or
  [Codex](https://openai.com/index/codex) session while others watch on a
  screen share
- async collaboration — your colleague picks up where you left off; your
  boss reviews what happened tomorrow; governance teams trace decisions back
  to their source
- observability — what happened in this session? why did the agent make that
  choice? where did it go wrong? how do I restart it from that good
  checkpoint before it went off the rails?

### How agents need to use it

- spawning hierarchies — parent agents spawn children, each running their
  own loop, reporting results back up; is that child stuck? do I need to
  talk to it directly?
- forking — branch a session to explore alternatives; go back to a known
  good point and try a different path
- time travel — replay from any position; restart from a checkpoint
- compaction and memory — compress and summarize what happened; capture
  observational memory across sessions; what did the children do?

<!-- TONE: These demands are grounded in what agentic frameworks like
     Mastra and products like HumanLayer and Superset are building
     today, and where tools like Claude Code and Codex are heading. -->

### How organizations need to use it

- if work is done through agents, agent sessions become how work gets
  done — so they inherit the governance requirements of the work itself
- this state must wire into collaboration, reporting, access control
  and compliance — the same systems the organization already runs on

### The requirements

<!-- STRUCTURAL: Synthesis. Each requirement is earned by what came
     before. The reader should feel these are inevitable, not asserted. -->

- **persistent** — survives disconnects, restarts, crashes
- **addressable** — sessions have their own URL; other systems can find and
  subscribe to them
- **reactive and subscribable** — real-time updates as state changes
- **replayable** — consume from any position in the log
- **forkable** — branch sessions for exploration
- **lightweight and low-latency** — co-located with agents, not a round-trip
  to a centralized store
- **directly writable** — agents write to the stream as they execute
- **structured** — schema support for typed, multiplexed data

## Why existing infrastructure doesn't serve it

<!-- ============================================================
     PILLAR 2
     Requirements are established. Show why existing infra falls
     short. Fair assessment, not a hit job. Start with ad-hoc and
     single-machine solutions, then evaluate "proper" infrastructure.
     Each covers SOME requirements. None covers ALL.
     ============================================================ -->

### Ad-hoc and single-machine solutions

- right now agent state is everything from ephemeral and lost, to markdown
  files in hidden folders, to over-provisioned database tables
- much of today's agent tooling is single-machine harnesses — powerful, but
  hard for other users to access in real-time
- the move into the cloud, into online systems wired into teams, is
  happening fast — the OS-level primitives that work on a single machine
  (files, signals, process watching) need web-scale equivalents

<!-- TONE: This is the contrast with previous-generation web services.
     Web services were designed to be stateless — that's how they scaled,
     the twelve-factor app architecture. The infrastructure we have was
     built for that world. Agents are different. -->

### Databases

- too heavy and centralized for this use case — you don't run an AI token
  stream through your main Postgres
- designed for structured queries and transactions, not append-only streaming
  with real-time subscriptions
- the latency and overhead of a centralized database doesn't match the
  co-located, low-latency demands of agent state

### Object storage

- provides underlying durability — good as a backing store for agent sessions
- but not reactive, not subscribable, not structured
- a storage layer, not a data primitive with the affordances agents need

### Redis

- closer — in-memory, low-latency, pub/sub capabilities
- but still centralized; a generalized data structure server, not
  agent-specific
- schema support has to be built on top; reactivity is not first-class —
  pub/sub is fire-and-forget with no replay or persistence guarantees

### The gap

<!-- ASSET: visual — existing infra (DB, object storage, Redis) shown
     with partial coverage of the requirements vs. durable streams with
     full coverage -->

- each covers some of the requirements; none covers the full set
- the agent loop needs a purpose-built primitive

## Why Durable&nbsp;Streams are the solution

<!-- ============================================================
     PILLAR 3
     The payoff. Requirements established, gap clear. Show what
     fills it. The reader has been waiting for this.
     ============================================================ -->

### What is a durable stream

- a persistent, addressable, append-only log with its own URL
- write directly, subscribe in real-time, replay from any position
- at the core, extremely simple: an append-only binary log
- built on standard HTTP — works everywhere, cacheable, scalable through
  existing CDN infrastructure
- a generalization of the battle-tested
  [Electric sync protocol](/docs/api/http) that delivers millions of state
  changes daily

<!-- ASSET: diagram — the durable stream as an append-only log with
     write (POST), subscribe (GET + long-poll/SSE), and replay
     (GET from offset). Should echo/evolve the hero animation. -->

### How it maps to the requirements

<!-- TONE: Point by point. Satisfying. The reader checks off each
     requirement against what was established in Pillar 1. -->

- **persistent** — streams have their own durable storage; the data
  survives anything
- **addressable** — every stream has a URL, every position has an opaque
  monotonic offset
- **reactive and subscribable** — long-polling or SSE for real-time tailing;
  clients subscribe and get updates as they're written
- **replayable** — read from any offset; catch up from any point in history;
  clients track their own position
- **forkable** — create new streams from positions in existing streams
- **lightweight and low-latency** — minimal protocol overhead; single-digit
  ms at CDN edge; co-locatable with agents
- **directly writable** — append with POST, get the next offset in the
  response header
- **structured** — wrapper protocols layer typed schemas on top of the binary
  stream using [Standard Schema](https://standardschema.dev) for end-to-end
  type safety

### Wrapper protocols and structured sessions

<!-- TONE: Show the ecosystem. Not just a raw log — supports structured,
     typed, multiplexed data. The StreamDB code sample makes this
     concrete. -->

- **durable state** — schema-aware structured state sync over a durable
  stream; multiplexes messages, presence, agent registration, tool calls
  over a single stream
- **AI SDK transports** — drop-in adapters for
  [Vercel&nbsp;AI&nbsp;SDK](/blog/2026/03/24/durable-transport-ai-sdks) and
  [TanStack&nbsp;AI](/blog/2026/01/12/durable-sessions-for-collaborative-ai)
  that make existing AI apps durable and collaborative
- **binary, JSON, proxy modes** — different encodings for different
  use cases

<!-- ASSET: StreamDB code sample — showing how you define a structured
     session schema (messages, presence, agents) over a durable stream.
     Pull from StreamDB docs/examples. -->

### What this unlocks

<!-- TONE: The vision. Let the reader feel what becomes possible.
     Link to concrete implementations as proof. -->

- resilient agent sessions — disconnect, reconnect, resume without
  re-running expensive work
- multi-user collaboration — multiple people working on the same agentic
  session in real-time
- multi-agent collaboration — agents subscribing to and building on each
  other's work
- spawning and forking — hierarchies of agents with durable state at
  every level
- async governance — full history of every agent action, available for
  audit and compliance
- massive fan-out — scale to millions of concurrent subscribers through
  CDN infrastructure

> [!Info] See it in action
> See the [Durable&nbsp;Sessions](/blog/2026/01/12/durable-sessions-for-collaborative-ai)
> post for a working reference implementation with
> [demo video](https://youtu.be/81KXwxld7dw) and
> [source code](https://github.com/electric-sql/transport), and the
> [Durable&nbsp;Transports](/blog/2026/03/24/durable-transport-ai-sdks)
> post for AI SDK integration.

<!-- STRUCTURAL: If more concrete proof is needed here, consider
     embedding the demo video or adding a short code walkthrough
     showing a multi-user agent session in action. -->

## Next steps

- explore [DurableStreams.com](https://durablestreams.com) — docs,
  quickstart, protocol spec
- deploy on [Electric&nbsp;Cloud](/cloud) — hosted durable streams
- join [Discord](https://discord.electric-sql.com) — to define and
  explore this space together

<!-- ============================================================
     DRAINPIPE
     Circle back. Echo the situation. Resolve with the answer.
     Loop closed.
     ============================================================ -->

Agents are stateful. The agent loop accumulates state with every iteration.
This state is the value — more state, more automation, more value. It needs
a new primitive. One that's native to and designed for the unique
requirements of the agent loop.

That's a [Durable&nbsp;Stream](https://durablestreams.com).

***

<!-- ============================================================
     META FOOTER — DELETE BEFORE PUBLISHING
     ============================================================ -->

<!-- INTENT

What is this post about?
Durable Streams — the data primitive for the agent loop.

What's interesting about it?
Agents are stateful in a way that previous software wasn't. They accumulate
a new kind of data — messages, tool calls, results — that needs a new kind
of primitive. Existing infrastructure (databases, object storage, Redis)
wasn't designed for the demands on this data: real-time collaboration,
async governance, agent hierarchies, enterprise integration.

What's the reader takeaway?
Agents produce a new kind of data that needs a new kind of primitive. That
primitive is a durable stream. The reader understands why and how to use it.

What are the CTAs?
1. DurableStreams.com (primary)
2. Deploy on Electric Cloud
3. Join Discord to define and explore this space

Why are we the right people to write this?
Built sync infrastructure (Electric), worked with front-of-market agentic
teams and frameworks. Saw the limitations of our own tech and rebuilt.
The insight came from the front lines.

-->

<!-- TITLE BRIEF

"Durable Streams — the data primitive for the agent loop"

Sentence case. Em dash. This IS the title — it's the hashtag, the thesis,
the phrase we want people to repeat. Use verbatim.

-->

<!-- DESCRIPTION BRIEF (SEO)

Should convey: agents accumulate state in the agent loop; this state is a
new kind of data with specific demands; existing infrastructure doesn't
meet them; a durable stream is the purpose-built primitive that does.
No HTML. Concrete, not marketing.

-->

<!-- EXCERPT BRIEF (blog listing card)

Max 3 short sentences. First sentence states the claim. Second names the
tension (new data, existing infra doesn't fit). Third points to the
solution. Match word length of existing post excerpts for consistent
listing card display.

-->

<!-- IMAGE PROMPT (quick version)

Hero: The agent loop (using the Durable Streams logo visual language —
which IS an agent loop) writing state into an append-only log. Animated.
Echoes the "what do we mean by durable state" slide from the raise
narrative. Must evolve and match visual language of the durable transports
and StreamDB posts. Reference images to be provided via /blog-image-brief.

In-post illustrations (all animated):
1. Agent loop accumulating state — the core visual metaphor
2. Requirements gap — existing infra partial coverage vs. durable streams
   full coverage
3. Durable stream architecture — write, subscribe, replay

Aspect ratio: 16:9 to 16:10 (target ~1536x950px for hero)
Dark theme background. Brand colors: #D0BCFF (purple), #00d2a0 (green),
#75fbfd (cyan), #F6F95C (yellow), #FF8C3B (orange).
OpenSauceOne font. Center-center composition.

Use /blog-image-brief for detailed briefs with reference images.

-->

<!-- ASSET CHECKLIST

- [ ] Hero image (animated: agent loop → durable stream log)
      — to create via /blog-image-brief
- [ ] In-post: agent loop → stream animation
      — to create via /blog-image-brief
- [ ] In-post: requirements gap visual (partial vs full coverage)
      — to create via /blog-image-brief
- [ ] In-post: durable stream architecture diagram
      — to create via /blog-image-brief
- [ ] StreamDB code sample (structured session schema)
      — pull from StreamDB docs/examples
- [ ] Verify all links resolve (durable transports post, durable sessions
      post, demo video, DurableStreams.com, Electric Cloud, Discord)

-->

<!-- TYPESETTING CHECKLIST

- [ ] Non-breaking spaces on "Durable Streams" (Durable&nbsp;Streams)
- [ ] Non-breaking spaces on other product names (TanStack AI, etc.)
- [ ] Title in sentence case
- [ ] Check title, image, and post at different screen widths
- [ ] No LLM tells: "it's worth noting", "importantly", "in conclusion",
      "let's dive in", "at its core", "in today's landscape"
- [ ] No banned words: "robust", "scalable", "flexible", "leverage",
      "ecosystem", "game-changing", "revolutionary"

-->

<!-- OPEN QUESTIONS

- StreamDB code sample: which example best shows structured session
  schema? Pull from docs or write custom for this post?
- Do we want to embed the durable sessions demo video directly in
  Pillar 3, or is the info box link sufficient?
- Any additional frameworks/products to name in Pillar 1?
- Animated illustrations: format? (Custom SVG/Lottie, motion graphics,
  animated GIF, video embed?)

-->
