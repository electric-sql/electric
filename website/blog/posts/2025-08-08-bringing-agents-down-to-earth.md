---
title: Bringing agents back to earth
description: >-
  Agentic AI, beneath all the hype, is actually just normal software. You can build agentic systems with a database, standard web tooling and real-time sync.
excerpt: >-
  Agentic AI, beneath all the hype, is actually just normal software. You can build agentic systems with a database, standard web tooling and real-time sync.
authors: [thruflo]
image: /img/blog/bringing-agents-back-to-earth/header2.jpg
tags: [db]
outline: [2, 3]
post: true
---

There's a lot of hype around agentic system development. Concepts like agentic memory, instruction routing, retrieval and context engineering.

When you dig into it, these all collapse down to processes and database state. You can build agentic systems with a database, standard web tooling and real-time sync.

> [!Warning] Agentic demo app
> See the [🔥 Burn demo app](/demos/agentic-sync-stack) and [source code](https://github.com/electric-sql/electric/tree/main/examples/agentic-sync-stack). It's an agentic system built on Postgres and real-time sync, designed to illustrate the concepts in this post.

> <br />
> ... embed video walkthrough ...
> <br />
> <br />

## Simplifying the agentic stack

We've had decades to evolve the [patterns of traditional software](https://12factor.net). We're scrambling, as an industry, to figure out the [patterns of agentic software](https://github.com/humanlayer/12-factor-agents).

LangChain, vector databases, instruction routing, specialized memory stores. You'd be forgiven for thinking you need a whole new stack to build agentic systems.

However, that isn't actually the case.

### What is agentic software?

Agents are essentially processes that instruct LLMs to make tool calls.

... diagramme ...

Instructing LLMs means sending an instruction to an LLM. Agentic memory is where you store data that those instructions are based on. Retrieval is the ability to query that data. Context engineering retrieves and formats the right information to send in the instruction.

Processes are a standard software primitive. As are routing, control flow, supervision hierarchies and functional loops.

### Rubbing a database on it

There's obviously a lot of work involved in putting those aspects together to create a working agentic product. However, from an *infra* point of view, there's nothing there that doesn't [pattern match to a database](https://www.hytradboi.com/2025).

<figure>
  <img src="/img/blog/bringing-agents-back-to-earth/agents-are-database-state.jpg"
      alt="Astronaut meme template. Wait, agents are just state in the database? Always have been"
  />
</figure>

Agentic AI, beneath all the hype, is actually just normal software. You can build agentic systems with a database, standard web tooling and real-time sync.

## Building an agentic system

[🔥 Burn](/demos/agentic-sync-stack) is an agentic demo app, built on Postgres, [Phoenix](https://www.phoenixframework.org) and [TanStack](https://tanstack.com).

It's a multi-user, multi-agent, burn or "roast-me" app.

Users sign-up, create and join threads. Each thread has a producer agent, called Sarah, who finds out facts about the users and two comedian agents ([Jerry Seinfeld](https://en.wikipedia.org/wiki/Jerry_Seinfeld) and [Frankie Boyle](https://en.wikipedia.org/wiki/Frankie_Boyle)) who use the facts to roast them.

> ... embed short video of app in process, lots of zoom in ...

The UI (for humans) and the control flow for agents are both driven by real-time sync. In the back-end, agents subscribe to data changes and react to them. In the front-end, the UI is reactively wired up to data model and automatically updates whenever anything happens. This [keeps the users and agents in sync](/blog/2025/04/09/building-ai-apps-on-sync).

The app UI has a main chat UI and a "computer" sidebar that's like a debug view, showing you what's happening in the database under the hood in real-time.

> ... embed short video of the computer, lots of zoom in ...

### Standard Postgres

The data model is based on `Users` joining `Threads`, which are driven by `Events` and accumulate `Facts`.

```txt
... ascii ...
```

These are all stored in a standard Postgres database. No extensions or vectors &mdash; it's standard rows in standard tables.

> ... psql ...

### Phoenix.Sync

On the backend, Burn uses the [Phoenix framework](https://www.phoenixframework.org). Phoenix is built in [Elixir](https://elixir-lang.org), which runs on the [BEAM](https://blog.stenmans.org/theBeamBook/), the Erlang virtual machine, which gives you extremely [robust primitives for process supervision and messaging](https://hexdocs.pm/elixir/processes.html) that are a [perfect match for agentic systems](https://goto-code.com/blog/elixir-otp-for-llms/).

Phoenix has a sync library, [Phoenix.Sync](https://hexdocs.pm/phoenix_sync), that uses Electric to consume changes out of Postgres and stream them into back-end and front-end clients as required. Burn uses this to sync data both into the back-end for the agents and into the front-end for the users.

In the back-end, we sync into an [agent process supervisor](https://github.com/electric-sql/electric/burn/blob/main/examples/agentic-sync-stack/lib/burn/agents/supervisor.ex). This essentially monitors the state of the database and spins up / tears down agent processes at runtime as thread are created and agents are added to and removed from threads.

> ... supervisor ...



So we don't need to write very much to get this resilient, scalable, distributable, dynamic supervision tree of agent processes that just scales up and down in sync with the contents of the database.

Then each agent

> ... agent ...

Subscribes to the events in their thread and has their
- prompt
- a set of tools they can use and
- controls their own context window and control flow

So that's what's running in the background. Then to sync data into the front-end, we expose sync endpoints in the Router.

> ... router ...

And in the front-end, we wire these into TanStack DB.

TanStack is a popular library for building web and mobile apps. TanStack DB is a new reactive client store built into TanStack for building super fast apps on sync.

Collections, Live queries, transactional mutations.

We define TanStack DB collections which map to those sync endpoints exposed in the Router:

> ... db/collections ...

That keeps the data in the collection up-to-date and in-sync with the contents of the Postgres database.

***

In our components we read data from the collections into state variables using live queries

> ... live query example ...

These are also reactive and built on a super fast, query engine. Based on differential dataflow for very fast incremental updates when data changes. So you can have loads of components doing loads of complex live queries and it's all sub-millisecond reactivity. Like reading data out of an index in memory.

So, as we've seen, on the backend the agents are kept in sync with the Postgres data. The same is true for components in the client. Data syncs through into the collections, incrementally updates the live queries and everything just reacts. Instantly. Across all users all devices.

If I come to the app, I'm logged in here as thruflo. If I login to the other window as my colleague Valter

> login as balegas

And I invite him to join me in a thread. I can just spam the thread and you see everything just syncs and renders instantly, updating in realtime.

I want to stress, there's no data fetching in the code. There's no networking code in the components. You're not handling any fetch errors. It just works.

***

Now let's focus more on what the app is demonstrating.

It's a multi-user, multi-agent demo. Users and agents join threads. There's a producer agent called Sarah who asks the users questions and extracts facts about them. These are stored in the database.

There are then comedian agents who monitor the facts and, when they have enough to go on, try and roast or burn the users with some sharp humour.

The comedians we have installed are Jerry Seinfeld and Frankie Boyle. I imagine everyone knows Jerry, he's wry observational humour. Frankie is dark scottish humour with zero filter. His burns tend to be a bit funnier!

So that's what goes on in this main chat area. On the right hand side we have this "computer" sidebar. That's basically just showing you the raw data in the database that the thread is running on.

So the memory ...

> ... memory ...

Is literally collecting facts. Sarah makes a extract_facts tool call. That's an LLM response with structured data. The backend tool definitions know how to take that and write the data into a facts table in the database.

Then this context section

> ... context ...

Is showing you the events that are happening under the hood. In a sense the chat UI is one representation of this state, presenting it to the user. The context list here is another. More of a debug view.

But then the instruction, the context, sent to the LLM is another.

> ... terminal logging ...

What's happening is when there's a new event, the data in the database is rendered as a string and that's sent to the LLM.

So the context engineering, like the UI, is just a functional representation of the state in the database.

That is how all the fancy layers of agentic software just collapse to rows in the database and real-time sync. Both to drive the agentic control flow and to keep the agents and the users in sync.

It's just Postgres and standard web frameworks. Phoenix and TanStack.

***

Let's see what the comedians have to say about it.

> ... add some more facts ...

Jerry

> ... add some more facts ...

Frankie

###

4. Answer
[The thesis and preview of supporting reasons]
Yes - agentic systems are just structured software with LLM tool calls, and when you see this clearly:
The "agentic memory" and "context engineering" buzzwords collapse to standard database operations and state management
You don't need specialized AI infrastructure - you need the real-time sync patterns from Figma/Linear
Software developers aren't just capable of building agents - they're uniquely positioned to do it better than AI specialists
The economic opportunity of the AI disruption isn't in some distant AI future - it's right at your fingertips with the skills you already have

Yes - agentic systems are just structured software with LLM tool calls, and when you see this clearly: agents are just LLMs plus databases and workflows; you build them with real-time sync, not AI infrastructure; developers already own these patterns; and the opportunity is right now, not some distant future.
Agents are LLMs plus databases

All the "agentic memory" and "context engineering" buzzwords collapse to standard database operations and state management

Agents are just LLMs making tool calls within structured workflows - nothing more mystical

Build with sync, not AI infrastructure

You don't need specialized vector databases or memory stores (which are just database wrappers anyway)

You need the same real-time sync patterns that power Figma/Linear - local-first state with multiplayer coordination

Developers already own these patterns

Software developers aren't just capable of building agents - they're uniquely positioned to do it better than AI specialists

While you worried about being replaced, you were already mastering the exact patterns that make agentic systems work

The opportunity is right now
The economic disruption isn't in some distant AI future - it's accessible today with your existing skills
The complexity barrier was artificial - now that it's gone, developers can directly capture the value
The parallel tracks revelation: "While you were worried about being replaced by AI, you were already building the exact patterns that make agentic systems work - real-time sync, local-first state, multiplayer collaboration"
The 12-factor agents connection: "Frameworks abstract away control right when you need it most" - ties to needing to own your prompts, context, and execution
The "memory stores are just wrappers" point: Most "agentic memory stores" are just wrappers around databases anyway
The economic framing: "The economic opportunity of the AI disruption isn't in some distant AI future - it's right at your fingertips"

"Puts the electricity back in their fingers"
"Software developers, being sophisticated consumers of hype"
"Sync is the bridge that brings it back home"
"From hype to reality, from complex to simple, from specialized to universal, from experimental to production-ready"
Technical Points:
Vector databases and context engineering are "just fancy terms for what is fundamentally state management"
Context engineering = "just a functional representation of state"
The demo proves this works in practice (not just theory)


there's been this period where you needed to be a data scientist and suddently write lots of scientific python; but what agentic actually is is the way of integrating LLMs back into normal structured software; and then when you look on that with clear eyes, you see all the new hype-y buzzwords can collapse to standard software infra. With agents just basically reducing to workflows and database state.
And as a result, agentic is actually the thing that normal softeare developers can do better than anyone and puts the electricity back in their fingers. so if you've been turned off by the hype, you should re-assess and realise that all this economic opportunity with the disruption of software is right at your fingertips