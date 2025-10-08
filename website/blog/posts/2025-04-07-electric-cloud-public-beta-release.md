---
title: "Electric Cloud public BETA: Sync in 30 seconds"
description: >-
  Electric Cloud is now in public BETA!
  This means it's open to everyone for immediate access.
excerpt: >-
  Electric Cloud is now in public BETA!
  This means it's open to everyone for immediate access.
authors: [kyle, thruflo]
image: "/img/blog/electric-cloud-public-beta-release/header.jpg"
tags: [release]
outline: [2, 3]
post: true
---

<script setup>
  import ScalabilityChart from '../../src/components/ScalabilityChart.vue'
</script>

[Electric Cloud](https://dashboard.electric-sql.cloud) is in public BETA! It's open to everyone for immediate access.

You can [create your account here](https://dashboard.electric-sql.cloud) and start using it straight away to sync data and build apps.

Use the new dashboard to connect and manage backing Postgres databases, and see system logs and service health and status.

Electric Cloud is our managed service for our [open-source Postgres sync engine](https://electric-sql.com/). It solves the hard problems of sync for you, including [partial replication](https://electric-sql.com/docs/guides/shapes), [fan-out](https://electric-sql.com/docs/api/http#caching), and [data delivery](https://electric-sql.com/docs/api/http).

<a href="https://dashboard.electric-sql.cloud" class="no-visual">
  <img src="/img/blog/electric-cloud-public-beta-release/dashboard.png" />
</a>

As well as being easy to [use](/docs/intro), [integrate](/blog/2024/11/21/local-first-with-your-existing-api) and [get-started with](/docs/quickstart), Electric Cloud is also [highly performant and scalable](/docs/reference/benchmarks#cloud), with an integrated CDN. Unlike other systems that demo well and fall over, you can build real-time apps on Electric Cloud and not worry that they're going to explode or fall over when you hit hockey stick growth.

The chart below is from our [cloud benchmarks](/docs/reference/benchmarks#cloud), testing Electric's memory usage and latency with a single Electric service scaling real-time sync from 100k to 1 million concurrent clients under a sustained load of 960 writes/minute. Both memory usage and latency are essentially <em>flat</em>:

<figure>
  <ScalabilityChart />
</figure>

## Real-time features shouldn't be this hard

Every major web app we’ve worked on, including [Gatsby Cloud](https://www.gatsbyjs.com/docs/reference/cloud/what-is-gatsby-cloud/), [Posterhaste](https://www.posterhaste.com/), [OpenIDEO](https://www.openideo.com/), and [Pantheon](https://pantheon.io/) has had critical real-time features. And they were the most fragile, frustrating parts of the app.

The real-time systems plumbing was complex to build and operate (redis pub/sub & websocket servers) and we couldn’t ever get to 100% reliable event delivery as almost daily we’d get support requests from customers resulting from edge cases around race conditions or connectivity issues.

Our team has been building apps and doing research on sync problems for decades and have all felt this pain. Talking to other developers, we heard the same frustrations:

"Our app felt sluggish because every interaction required a network round trip."

"We spent weeks building and debugging our real-time infrastructure."

"Our state management code was 3x larger than our actual business logic."

Something is fundamentally broken with how we build modern apps.

### Especially when building AI apps

AI apps are inherantly real-time, whether that's [token streaming](/blog/2025/04/09/building-ai-apps-on-sync#resumability) or [user <> agent collaboration](/blog/2025/04/09/building-ai-apps-on-sync#collaboration). [Keeping agents and users in sync](/blog/2025/04/09/building-ai-apps-on-sync) yourself with a combination of ad-hoc data fetching and notifications is a massive pain.

<figure>
  <HTML5Video class="wide"
      poster="/img/blog/building-ai-apps-on-sync/video-4-multi-user.jpg"
      src="https://electric-sql-blog-assets.s3.us-east-1.amazonaws.com/building-collaborative-ai-apps-on-sync/video-4-multi-user.mp4"
  />
</figure>

## Sync: the missing abstraction for simple, fast apps

The ElectricSQL team came together to build a proper abstraction for data synchronization.

We asked ourselves: instead of manually orchestrating data fetching, caching, and real-time updates, what if developers could simply declare what data they need, and have it automatically stay in sync between the server and client?

That's why we built Electric — an open-source sync engine that works directly with Postgres.

We had three core requirements:

1. **Zero assumptions about your stack**: It should work with any Postgres database, any data model, and any frontend framework.

2. **Simple to integrate**: It should be a thin layer that fits into existing architectures without requiring a rewrite.

3. **Infinitely scalable**: It should handle millions of concurrent users without breaking a sweat.

With Electric, you don't need to write imperative state transfer code. You don't need complex state management frameworks. You don't need to engineer for high uptime when your app naturally tolerates network issues.

Instead, you get:

- **Dead-simple integration**: Sync data directly from your Postgres database
- **Instant responsiveness**: Data is locally available, making your app lightning fast
- **Offline support**: local data reads should keep working regardless of connectivity
- **Real-time by default**: Changes propagate automatically to all connected clients
- **Reduced cloud costs**: Move data and compute to the client, lowering your server load

We released the 1.0 of the open-source Electric sync engine a few weeks ago.

And today, we're launching **Electric Cloud** — a managed platform that gives you all the benefits of sync in just 30 seconds.

## **Try Electric Cloud Today**

Getting started is dead simple:

1. Connect your existing Postgres database via a standard connection string
2. Specify what data you want to sync using our simple Shape API
3. Use our client libraries to bind that data directly to your UI

<img src="/img/blog/electric-cloud-public-beta-release/dashboard.png" />

That's it. No complex infrastructure to set up or maintain. No opinionated frameworks to adopt. Just real-time sync, solved.

Companies like Trigger.dev are already using Electric in production, noting that it has "it’s simple to operate as we already use Postgres, and it scales to millions of updates per day."

**Ready to add sync to your app in 30 seconds?** [Sign up for the Electric Cloud Public Beta](https://dashboard.electric-sql.cloud) today.

We can't wait to see what you build with it 🚀

---

_Have questions? Join our[ Discord community](https://discord.gg/electric), check out our[ documentation](https://electric-sql.com/docs), or find us on[ GitHub](https://github.com/electric-sql/electric)._
