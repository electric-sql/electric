---
title: 'Electric is joining Databricks'
description: >-
  Databricks has acquired Electric. We're joining Neon to make Lakebase the best platform for building apps and agents. Everything we've open sourced stays open source.
excerpt: >-
  Databricks has acquired Electric. We're joining Neon to make Lakebase the best platform for building apps and agents. Everything we've open sourced stays open source.
authors: [thruflo, balegas]
image: /img/blog/electric-joining-databricks/header2.jpg
tags: [electric, neon, databricks, sync, announcement]
outline: [2, 3]
post: true
published: true
---

[Databricks has acquired Electric](https://www.databricks.com/blog/electric-makers-pglite-joins-databricks-bring-wasm-postgres-ai-agent-sandboxes) to add our data primitives and reactivity to [Lakebase](https://www.databricks.com/product/lakebase) and help make it the best platform for building
<span class="no-wrap">apps and agents</span>.

It's a big change for Electric. There are [implications for Cloud users](#what-this-means-for-electric-users) but everything we've previously [open sourced](https://github.com/electric-sql) stays open source. Ultimately, by joining [Neon](https://neon.com) at Databricks, we'll have the platform to [take sync to the next level](#electrifying-neon).

> [!Warning] ✨ Key links
> See the [Databricks announcement](https://www.databricks.com/blog/electric-makers-pglite-joins-databricks-bring-wasm-postgres-ai-agent-sandboxes) and [what this means for Electric users](#what-this-means-for-electric-users).

## Aligned from day one

The first time that we came to San Francisco to raise funding for Electric, we were introduced to [Nikita Shamgunov](https://www.linkedin.com/in/nikitashamgunov), Co-founder and CEO of Neon.

We were building Postgres to SQLite sync at the time. Nikita was fairly fresh from building his previous company, SingleStore, which was a distributed-SQL database that was wire-compatible with MySQL.

His advice was stark. Stop syncing from Postgres to SQLite. The type-impedance is going to be a massive pain. Why not sync Postgres to Postgres instead?

The next day, he shared an experimental repo that his co-founder, [Stas Kelvich](https://www.linkedin.com/in/kelvich/) has been working on, that cracked running Postgres locally in WASM.

There had been previous WASM postgres projects, but they had all been VM-based, with overhead and a large build. What Stas' project gave us was a pure WASM build that was radically smaller and faster.

Suddenly [the idea of running Postgres in the client](https://youtu.be/ZlHWSpIYixk) actually become viable:

<div class="embed-container">
  <YoutubeEmbed video-id="ZlHWSpIYixk" title="Little elephants everywhere" />
</div>

That repo became the basis of [PGlite](https://pglite.dev). Now Electric's most [widely-used project](/blog/2026/06/25/pglite-reaches-10-million-weekly-downloads) at 13M downloads a week.

Since then, Neon has been our most popular Postgres integration and powered the majority of Electric Cloud sync services. So, in a real sense, Neon seeded both the strategy and technology behind Electric.

## Electrifying Neon

So why join Neon at Databricks now? It's because [Lakebase Postgres](https://docs.databricks.com/aws/en/oltp/projects) is now a core primitive shared across Neon and Databricks and Neon is expanding to become a [complete backend platform](https://neon.com/blog/were-building-backends).

That takes more than raw database engineering. It takes world-class DX and AX (agent experience) wrapped up into the right data primitives.

Apps and agents run on live data. Users expect interfaces that update instantly. Agents need [realtime state](https://electric.ax/blog/2026/04/08/data-primitive-agent-loop) and [coordination through the data layer](https://electric.ax/blog/2026/04/29/introducing-electric-agents).

That's what we do at Electric. That's what Databricks is building around Lakebase.

## The stack of the future

[Lakebase](https://www.databricks.com/product/lakebase) is serverless Postgres for apps and agents. With [scale-to-zero](https://docs.databricks.com/aws/en/oltp/projects/scale-to-zero), native [branching](https://docs.databricks.com/aws/en/oltp/projects/branches) and support for both OLTP and OLAP.

By combining Electric’s sync and local execution with the scalability and capabilities of Lakebase, apps and agents get a supercharged Postgres stack for optimal fast, reactive development, local query execution at machine speed and deployment at scale, for workloads of any scale.

This is the stack of the future. We were always aligned with Neon but the opportunity to execute on this is now.

## What this means for you

Everything Electric has previously open sourced stays open source: Electric's [Postgres Sync](https://electric.ax/sync/postgres-sync), [PGlite](https://pglite.dev), [TanStack DB](https://tanstack.com/db), [Durable Streams](https://durablestreams.com).

[Electric Cloud](/cloud) is winding down. Cloud users will need to self-host or move to another provider. We've contacted every existing cloud user directly. If you're affected, we'll support you through the transition and there are a number of options available for seamless continuity of hosting with professional support.

Moving forward, Electric will be building with Neon inside Databricks. You can see [how a Neon backend fits together here](https://neon.com/docs/get-started/backend-overview) and you can see [how the platform is evolving here](https://neon.com/blog).

## What's next

To everyone who has adopted Electric and contributed to it: we want to say a huge thank you. We couldn't have done this without you.

Together, we proved that sync is the future. Now, as part of Databricks, we have the platform to take that to the next level.

For more on the acquisition, read the [Databricks announcement](https://www.databricks.com/blog/electric-makers-pglite-joins-databricks-bring-wasm-postgres-ai-agent-sandboxes). If you haven't already, now is a great time to [start something on Neon](https://neon.com) and follow along as we ship:

```sh
npx neon@latest init
```