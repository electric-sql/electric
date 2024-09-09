---
title: A new approach to building Electric
description: >-
  Electric Next is a new approach to building the ElectricSQL sync engine.
excerpt: >-
  Electric Next is a new approach that we've adopted to building Electric.
  One that's informed by the lessons learned building the previous system
  and inspired by new insight from Kyle Mathews.
authors: [thruflo]
image: /img/blog/electric-next/header.jpg
tags: [release]
outline: [2, 3]
post: true
---

<script setup>
import Tweet from 'vue-tweet'
</script>

Electric Next is a new approach that we've adopted to building ElectricSQL. It's informed by the lessons learned building the [previous system](https://legacy.electric-sql.com) and inspired by new insight from [Kyle&nbsp;Mathews](https://electric-sql.com/about/team#kyle) joining the team.

What started as tinkering is now the way forward for Electric. So, what's changed and what does it mean for you?

## What is Electric Next?

Electric Next was a clean rebuild of the Electric sync engine that now forms the basis of ElectricSQL moving forwards.

We created a new repo and started by porting the absolute minimum code necessary from the [previous repo](https://github.com/electric-sql/electric-old). Once we were confident that Electric Next was the way forward, we froze the old system and moved the new code into our main repo at [https://github.com/electric-sql/electric](https://github.com/electric-sql/electric).

The new approach provides an [HTTP API](/docs/api/http) for syncing [Shapes](/docs/guides/shapes) of data from Postgres. This can be used directly or via [client libraries](/docs/api/clients/typescript) and [integrations](/docs/api/integrations/react). It's also simple to write your own client in any language.

## Why build a new system?

Electric has its [heritage](https://electric-sql.com/about/team#advisors) in [distributed database research](https://electric-sql.com/docs/reference/literature). When we started, our plan was to use this research to build a next-generation distributed database. Cockroach for the AP side of the CAP theorem. However, the adoption dynamics for creating a new database from scratch are tough. So we pivoted to building a replication layer for existing databases.

This allowed us to do active-active replication between multiple Postgres instances, in the cloud or at the edge. However, rather than stopping at the edge, we kept seeing that it was more optimal to take the database-grade replication guarantees all the way into the client.

So we built a system to sync data into embedded databases in the client. Where our core technology could solve the concurrency challenges with local-first software architecture. Thus, ElectricSQL was born, as an [open source platform for building local-first software](/blog/2023/09/20/introducing-electricsql-v0.6).

### Optimality and complexity

To go from core database replication technology to a viable solution for building local-first software, we had to build a lot of stuff. Tooling for [migrations](https://legacy.electric-sql.com/docs/usage/data-modelling/migrations), [permissions](https://legacy.electric-sql.com/docs/usage/data-modelling/permissions), [client generation](https://legacy.electric-sql.com/docs/api/cli#generate), [type-safe data access](https://legacy.electric-sql.com/docs/usage/data-access/client), [live queries](https://legacy.electric-sql.com/docs/integrations/frontend/react#uselivequery), [reactivity](https://legacy.electric-sql.com/docs/reference/architecture#reactivity), [drivers](https://legacy.electric-sql.com/docs/integrations/drivers), etc.

<figure>
  <div class="img-row">
    <div class="img-border">
      <a href="/img/about/schema-evolution.jpg">
        <img src="/img/about/schema-evolution.jpg"
            alt="Schema evolution diagramme"
        />
      </a>
    </div>
  </div>
  <figcaption class="figure-caption text-end">
    Schema evolution diagramme from the previous
    <a href="https://legacy.electric-sql.com/docs/reference/architecture" target="_blank">
      architecture&nbsp;page</a>.
  </figcaption>
</figure>

Coming from a research background, we wanted the system to be optimal. As a result, we often picked the more complex solution from the design space and, as a vertically integrated system, that solution became the only one available to use with Electric.

For example, we designed the [DDLX rule system](https://legacy.electric-sql.com/docs/api/ddlx) in a certain way, because we wanted authorization that supported finality of local writes. However, rules (and our rules) are only one way to do authorization in a local-first system. Many applications would be happy with a simpler solution, such as Postgres RLS or a server authoritative middleware.

These decisions not only made Electric more complex to use but also more complex to develop. Despite our best efforts, this has slowed us down and tested the patience of even the most forgiving of our early adopters.

<Tweet tweet-id="1762620966256210174"
    align="center"
    conversation="none"
    theme="dark"
/>

Many of those early adopters have also reported performance and reliability issues.

The complexity of the stack has provided a wide surface for bugs. So where we've wanted to be focusing on core features, performance and stability, we've ended up fixing issues with things like [docker networking](https://github.com/electric-sql/electric/issues/582), [migration tooling](https://github.com/electric-sql/electric/issues/668) and [client-side build tools](https://github.com/electric-sql/electric/issues/798).

The danger, articulated by [Teej](https://x.com/teej_m) in the tweet below, is building a system that demos well, with magic sync APIs but that never actually scales out reliably. Because the very features and choices that make the demo magic, prevent the system from being simple enough to be bulletproof in production.

<Tweet tweet-id="1804944389715952118"
    align="center"
    conversation="none"
    theme="dark"
/>

### Refocusing our product strategy

One of the many insights that Kyle has brought is that successful systems evolve from simple systems that work. This is [Gall's law](https://archive.org/details/systemanticshows00gall):

> “A complex system that works is invariably found to have evolved from a simple system that worked.”

This has been echoed in conversations we've had with [Paul Copplestone](https://linkedin.com/in/paulcopplestone) at [Supabase](https://supabase.com). His approach to successfully building our type of software is to make the system incremental and composable, as reflected in the [Supabase Architecture](https://supabase.com/docs/guides/getting-started/architecture) guide:

> Supabase is composable. Even though every product works in isolation, each product on the platform needs to 10x the other products.

To make a system that's incremental and composable, we need to decouple the Electric stack. So it's not a one-size-fits-all vertical stack but, instead, more of a loosely coupled set of primitives around a smaller core. Where we do the essential bits and then allow our users to choose how to integrate and compose these with other layers of the stack.

This aligns with the principle of [Worse is Better](https://en.wikipedia.org/wiki/Worse_is_better), defined by Richard P. Gabriel:

> Software quality does not necessarily increase with functionality: there is a point where less functionality ("worse") is a preferable option ("better") in terms of practicality and usability.

Gabriel contrasts "Worse is Better" with a make the "Right Thing" approach that aims to create the optimal solution. Which sounds painfully like our ambitions to make an optimal local-first platform. Whereas moving functionality out of scope, will actually allow us to make the core better and deliver on the opportunity.

#### The motivation for Electric Next

So, hopefully now our motivation is clear. We needed to find a way to simplify Electric and make it more loosely coupled. To pare it back to it's core and iterate on solid foundations.


## What's changed?

Electric Next is a [sync engine](/product/electric), not a local-first software platform.

It can be used for a wide range of [use cases](/use-cases/state-transfer), syncing data into apps, workers, services, agents and environments. These include but are not limited to local-first software development.

### Sync engine

When we look at our stack, the part that we see as most core is the [sync engine](/product/electric).

This is the component of Electric that syncs data between Postgres and local clients. Consuming Postgres logical replication, managing partial replication using Shapes and syncing data to and from clients over a replication protocol. It’s where there’s the most complexity. Where we can add the most value and is hardest to develop yourself.

#### Core responsibilities

We now see Electric as a sync engine that does partial replication on top of Postgres. We've pushed other, non-core, aspects of the system out of scope, as we pare down to our essential core and then iterate on this to re-build the capabilities of the previous system.

<figure>
  <div class="img-row">
    <div class="img-border">
      <a href="/img/about/in-and-out-of-scope.jpg">
        <img src="/img/about/in-and-out-of-scope.png"
            alt="System responsibilities diagramme"
        />
      </a>
    </div>
  </div>
  <figcaption class="figure-caption text-end">
    Diagramme illustrating core system responsibilities vs optional layers and integrations.
  </figcaption>
</figure>

The diagramme above and table below summarise what we see as core and what we've pushed out of scope.

| Aspect | Is it core? | Who should/can provide? |
| --- | --- | --- |
| Syncing data | yes | Electric |
| Partial replication ([Shapes](/docs/guides/shapes)) | yes | Electric |
| Schema management / propagation / matching | partial | Application specific. In some cases it may be useful or necessary to replicate and validate schema information. In others, it can be the responsibility of the client to connect with the correct schema. |
| Type safety in the client | partial | Important in many cases for DX and can be assisted by the sync service (e.g.: by providing an endpoint to query types for a shape). But use of types is optional and in many cases types can be provided by ORMs and other client-libraries. |
| Permissions / authorization | no | There are many valid patterns here. Auth middleware, proxies, rule systems. Authorize at connect, per shape, per row/operation. A sync engine may provide some hooks and options but should not prescribe a solution. |
| Client-side data access library | no | There are many ways of mapping a replication stream to objects, graphs or databases in the client. For example using existing ORMs like Drizzle and Prisma, or reactivity frameworks like LiveStore and TinyBase. |
| Client-side reactivity | no | Client specific. Can be provided by reactivity frameworks. |
| Connection management | no | Client specific. |
| Database adapters | no | Client specific. Can be provided by ORMs and reactivity frameworks. |
| Framework integrations | no | Client specific. Can be provided by reactivity frameworks. |
| Client-side debug tooling | no | Client specific. |

### HTTP Protocol

One of the key aspects that has changed in the core sync engine is a switch from the [Satellite web socket replication prototol](https://legacy.electric-sql.com/docs/api/satellite) to an HTTP replication protocol.

Switching to an HTTP protocol may at first seem like a regression or a strange fit. Web sockets are build on top of HTTP specifically to serve the kind of realtime data stream that Electric provides. However, they are also more stateful and harder to cache.

By switching to the [new HTTP API](/docs/api/http), the new system:

- minimises state, making the sync engine more reliable and easier to scale out
- integrates with standard HTTP tooling, including proxies and CDNs

This allows us to optimise initial data sync by making sync requests cacheable. And it facilitates moving concerns like authentication and authorization out of scope, as these can be handled by HTTP proxies.

### Write patterns

Electric has always been envisaged as an active-active replication system that supports bi-directional sync between clients and the server. This means it syncs data out to clients (the "read path") and syncs data back from clients (the "write path").

The previous Electric supported a single primary write-path pattern &mdash; [writing through the local database](https://legacy.electric-sql.com/docs/usage/data-access/writes):

<figure>
  <div class="img-row">
    <div class="img-border">
      <a href="/img/about/data-flow.jpg">
        <img src="/img/about/data-flow.jpg"
            alt="Data flow diagramme"
        />
      </a>
    </div>
  </div>
  <figcaption class="figure-caption text-end">
    Data flow diagramme from the previous
    <a href="https://legacy.electric-sql.com/docs/reference/architecture" target="_blank">
      architecture&nbsp;page</a>.
  </figcaption>
</figure>

This is very powerful (and [abstracts state transfer](/blog/2022/12/16/evolution-state-transfer) out of the application domain). However, it is only one of many valid write patterns.

Many applications don't write data at all; for example, syncing data into an application for visualisation or analysis. Some fire-and-forget writes to an ingest API. Other applications write data via API calls, or mutation queues. Some of these are online writes. Some use local optimistic state.

For example, when applying a mutation with [Relay](https://relay.dev) you can [define an `optimisticResponse`](https://relay.dev/docs/guided-tour/updating-data/imperatively-modifying-store-data/#optimistic-updaters-vs-updaters) to update the client store with temporary optimistic state whilst the write is sent to the server. Or to give another example, when [making secure transactions](/blog/2023/12/15/secure-transactions-with-local-first) a local-first app will explicitly want to send writes to the server, in order to validate and apply them in a secure and strongly consistent environment.

So, following the strategy of paring down to the core and then progressively layering on more complex functionality, Electric Next has taken the following approach:

1. start with read-path only
2. then add support for optimistic write patterns with tentativity
3. then add support for through-the-DB writes

This explicitly reduces the capability of the system in the short term, in order to build a better, more resilient system in the long term. The beauty is that, because we no longer prescribe a write-path strategy, you can choose and if necessary implement any write-path strategy you like.

We will only focus on the more complex strategies ourselves once the simpler ones are bulletproof. And we hope that others, like [LiveStore](https://www.schickling.dev/projects/livestore) and [Drizzle](https://orm.drizzle.team/), for example, will build better client-side libraries that we can.

#### A note on finality of local writes

One of the key differentiators of the previous ElectricSQL system was the ability to write to the local database without conflicts or rollbacks. The principle is [finality of local-writes](https://legacy.electric-sql.com/docs/reference/architecture#local-writes), which means that writes are final, not tentative. I.e.: once a write is accepted locally, it won't be rejected as invalid later on.

In contrast, Electric Next embraces tentativity. With the new system, you can choose your write pattern(s) and the guarantees you want them to provide.

We still believe that a local-first stack that provides finality of local writes can provide a better DX and UX than one that doesn't. Because of the absence of rollbacks. So we are committed in the longer term to building support for finality of local writes. However, it is no longer a key tenet of the system design.

### Use cases

The core use case for Electric is to sync subsets of data out of Postgres into local environments, wherever you need the data.

<figure>
  <div class="img-row">
    <div class="img-border">
      <a href="/img/about/use-cases.jpg">
        <img srcset="/img/about/use-cases.sm.png 1098w, /img/about/use-cases.png 1484w"
            sizes="(max-width: 767px) 600px, 1484px"
            src="/img/about/use-cases.png"
            alt="Use cases diagramme"
        />
      </a>
    </div>
  </div>
  <figcaption class="figure-caption text-end">
    Diagramme illustrating the use-cases and environments you can sync data into with Electric.
  </figcaption>
</figure>

You can sync data into:

- apps, replacing data fetching with data sync
- development environments, for example syncing data into [an embedded PGlite](/product/pglite)
- edge workers and services, for example maintaining a low-latency [edge data cache](/docs/api/integrations/redis)
- local AI systems running RAG, as per the example below

<figure>
  <video controls="true" poster="https://electric-sql.com/videos/blog/local-first-ai-with-tauri-postgres-pgvector-llama/intro.jpg">
      <source src="https://electric-sql.com/videos/blog/local-first-ai-with-tauri-postgres-pgvector-llama/intro.mp4" />
  </video>
  <figcaption class="figure-caption text-end">
    Video demonstrating
    <a href="/blog/2024/02/05/local-first-ai-with-tauri-postgres-pgvector-llama" target="_blank">
      hybrid vector-relational sync for local RAG applications</a>.
  </figcaption>
</figure>


## What's the status?

### Previous system

Electric Next has superceded the previous Electric.

- some parts of the old system were cherry-picked and ported over
- some parts may be cut out into optional libraries, for example the [DDLX implementation](https://github.com/electric-sql/electric/pull/1393)
- most parts were not and will not be needed

You're welcome to continue to use the old system and choose your moment to migrate. The code is preserved at [electric-sql/electric-old](https://github.com/electric-sql/electric-old) and the website and docs remain published at [legacy.electric-sql.com](https://legacy.electric-sql.com).

However caveat emptor &mdash; we are not supporting the old system.

### New system

At the time of writing this document, we are early in the development of Electric Next. The repo was created on the 1st July 2024. As a clean re-write, there are many things not-yet supported.

However, even just with the first release of Electric Next you can already sync partial subsets of data from a Postgres database into a wide variety of clients and environments, for example:

- syncing data into local apps using the [TypeScript](/docs/api/clients/typescript) and [Elixir](/docs/api/clients/elixir) clients
- replacing hot-path data fetching and database queries in apps using [React](/docs/api/integrations/react), [MobX](/docs/api/integrations/react) and [TanStack](/docs/api/integrations/tanstack)
- maintain live caches with automatic invalidation, as per [our Redis example](https://github.com/electric-sql/electric/blob/main/examples/redis-client/src/index.ts)

### Roadmap

You can track development on [Discord](https://discord.electric-sql.com) and via the [GitHub Issues milestones](https://github.com/electric-sql/archived-electric-next/milestones).

***

## Next steps

Electric Next is available to use today. We welcome community contributions.

### Using Electric Next

See the:

- [Quickstart](/docs/quickstart)
- [HTTP API](/docs/api/http)
- [Examples](https://github.com/electric-sql/electric/tree/main/examples)

If you have any questions or need support, ask on the `#help-and-support` channel in the [Electric Discord](https://discord.electric-sql.com).

### Get involved in development

Electric is open source (Apache 2.0) and developed on GitHub at [electric-sql/electric](https://github.com/electric-sql/electric). See the [open issues](https://github.com/electric-sql/electric/issues) on the repo and the [contributing guide](https://github.com/electric-sql/electric/blob/main/CONTRIBUTING.md).
