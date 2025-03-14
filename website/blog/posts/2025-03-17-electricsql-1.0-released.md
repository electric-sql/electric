---
title: "Electric 1.0 released"
description: >-
  With version 1.0 Electric is now in GA. The APIs are stable and the
  sync engine is ready for mission critical, production apps.
excerpt: >-
  With version 1.0 Electric is now in GA. The APIs are stable and the
  sync engine is ready for mission critical, production apps.
authors: [kyle]
image: /img/blog/electric-1.0-released/header.jpg
tags: [release]
outline: [2, 3]
post: true
---

With [version `1.0`](https://github.com/electric-sql/electric/releases), Electric is now in GA. The APIs are stable and the sync engine is ready for mission critical, production apps.

## What is Electric?

Sync makes apps awesome. Electric solves sync.

[Electric](/) is a Postgres sync engine. It handles the core concerns of [partial replication](/docs/guides/shapes), [fan out](/docs/api/http#caching), and [data delivery](/docs/reference/benchmarks#cloud). So you can build awesome software without rolling your own sync.

## The path to 1.0

In 2024 we [re-built Electric from scratch](/blog/2024/07/17/electric-next) to be simpler, faster, more reliable and more scalable. In December 2024, [we hit BETA](/blog/2024/12/10/electric-beta-release#the-path-to-beta) with production users, [proof of scalability](/docs/reference/benchmarks) and a raft of updated [docs](/docs/intro) and [demos](/demos).

Since then, we've launched a [managed cloud platform](/product/cloud), run / supported a wide range of production workloads from both open-source and cloud users and merged 200 bug-fix and reliability PRs.

## Stable APIs

With the 1.0 release, the core [Electric sync service APIs](/docs/intro) are now stable.

Our policy is now no backwards-incompatible changes in patch or minor releases. You can now build on Electric without tracking the latest changes.

## Production ready

Electric is stable, reliable and scales. It's been stress-tested in production for some time now by companies like [Trigger](https://trigger.dev), [Otto](https://ottogrid.ai) and [IP.world](https://ip.world).

We process millions of requests and transactions each day. With hundreds of thousands of active [shapes](/docs/guides/shapes) and application users.

## Increasingly powerful

Our engineering has been focused on making Electric small and stable. So it scales and just works.

Running real workloads has been key to this, as it's given us a tight feedback loop and flushed our real world bugs and edge cases. At the same time, it's also given us a lot of insight into demand for what to build next. And we have some seriously cool stuff coming. From more expressive partial replication primitives to advanced stream processing, database sync and client-side state management.

More on these soon but to give a sneak preview of some of the work in progress:

- [electric-sql/d2ts](https://github.com/electric-sql/d2ts) differential dataflow in Typescript to allow for flexible, extensible stream processing in front of Electric (in the client or at the cloud edge)
- [KyleAMathews/optimistic](http://github.com/KyleAMathews/optimistic) TanStack-compatible library that simplifies working with synced data and optimistic state in the client
- [electric-sql/phoenix_sync](https://github.com/electric-sql/phoenix_sync) Phoenix.Sync library to officially add sync support into the Elixir Phoenix web framework
- [livestore.dev](https://livestore.dev/getting-started/react-web) highly performant reactive state management solution for web and mobile apps with built in Electric sync

Electric is going to become more expressive, more powerful and easier to use. Without compromising on our core values of stability, reliability and scalability.

## Next steps

[Sign up for Cloud](/product/cloud), dive into the [Quickstart](/docs/quickstart), join the [Discord](https://discord.electric-sql.com) and star us on [GitHub](https://github.com/electric-sql/electric).

<div class="actions cta-actions page-footer-actions left">
  <div class="action cloud-cta">
    <VPButton
        href="/product/cloud/sign-up"
        text="Sign up to Cloud"
        theme="brand"
    />
    &nbsp;
    <VPButton
        href="/docs/quickstart"
        text="Quickstart"
        theme="alt"
    />
    &nbsp;
    <VPButton
        href="https://discord.electric-sql.com"
        text="Discord"
        theme="alt"
    />
    &nbsp;
    <VPButton
        href="https://github.com/electric-sql/electric"
        text="GitHub"
        theme="alt"
    />
  </div>
</div>
