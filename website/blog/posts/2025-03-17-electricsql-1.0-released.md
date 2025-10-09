---
title: 'Electric 1.0 released'
description: >-
  With version 1.0 Electric is now in GA. The APIs are stable and the
  sync engine is ready for mission critical, production apps.
excerpt: >-
  With version 1.0 Electric is now in GA. The APIs are stable and the
  sync engine is ready for mission critical, production apps.
authors: [thruflo]
image: /img/blog/electric-1.0-released/header2.jpg
tags: [release]
outline: [2, 3]
post: true
---

<script setup>
  import LogoStrip from '/static/img/blog/electric-beta-release/logo-strip.svg'
  import LogoStripSm from '/static/img/blog/electric-beta-release/logo-strip.sm.svg'
  import LogoStripXs from '/static/img/blog/electric-beta-release/logo-strip.xs.svg'
  import LogoStripXxs from '/static/img/blog/electric-beta-release/logo-strip.xxs.svg'
  import LinearLiteScreenshot from '/static/img/blog/electric-beta-release/linearlite-screenshot.png'
  import ScalabilityChart from '../../src/components/ScalabilityChart.vue'
</script>

With [version 1.0.0](https://github.com/electric-sql/electric/releases/tag/%40core%2Fsync-service%401.0.0), Electric is now in GA. The APIs are stable and the sync engine is ready for mission critical, production apps.

It's been a huge effort by the [whole team](/about/team). We've put our heart and soul into it. We know there's a lot of teams waiting for this milestone. We're really excited to see what you build with Electric now it's hit 1.0!

## What is Electric?

Sync makes apps awesome. Electric solves sync.

[Electric](/) is a Postgres sync engine. It handles the core concerns of [partial&nbsp;replication](/docs/guides/shapes), [fan&nbsp;out](/docs/api/http#caching), and [data&nbsp;delivery](/docs/reference/benchmarks#cloud).

So you can build awesome software without rolling your own sync.

## The path to 1.0

In 2024 we [re-built Electric from scratch](/blog/2024/07/17/electric-next) to be simpler, faster, more reliable and more scalable. In December 2024, [we hit BETA](/blog/2024/12/10/electric-beta-release#the-path-to-beta) with production users, [proof of scalability](/docs/reference/benchmarks) and a raft of updated [docs](/docs/intro) and [demos](/demos).

Since then, we've launched a [managed cloud platform](/product/cloud), run / supported a wide range of production workloads from both open-source and cloud users, tested with [Antithesis](https://www.antithesis.com) and merged 200 bug-fix and reliability PRs.

## Stable APIs

With the 1.0 release, the core [Electric sync service APIs](/docs/intro) are now stable.

Our policy is now no backwards-incompatible changes in patch or minor releases. You can now build on Electric without tracking the latest changes.

## Production ready

<figure>
  <img :src="LogoStrip" class="hidden-sm" />
  <img :src="LogoStripSm" class="hidden-xs block-sm" />
  <img :src="LogoStripXs" class="hidden-xxs block-xs" />
  <img :src="LogoStripXxs" class="block-xxs" />
</figure>

Electric is stable, reliable and scales. It's been stress-tested in production for some time now by companies like [Trigger](https://trigger.dev), [Otto](https://ottogrid.ai) and [IP.world](https://ip.world).

> We use ElectricSQL to power [Trigger.dev Realtime](https://trigger.dev/launchweek/0/realtime), a core feature of our product. When we execute our users background tasks they get instant updates in their web apps. It's simple to operate since we already use Postgres, and it scales to millions of updates per day.<br /> > _&mdash; [Matt Aitken](https://www.linkedin.com/in/mattaitken1985), Founder &amp; CEO, [Trigger.dev](https://trigger.dev)_

> At [Otto](https://ottogrid.ai), we built a spreadsheet product where every cell operates as its own AI agent. ElectricSQL enables us to reliably stream agent updates to our spreadsheet in real-time and efficiently manage large spreadsheets at scale. It has dramatically simplified our architecture while delivering the performance we need for cell-level reactive updates.<br /> > _&mdash; [Sully Omar](https://x.com/SullyOmarr), Co-founder &amp; CEO, [Otto](https://ottogrid.ai)_

We process millions of requests and transactions each day. With hundreds of thousands of active [shapes](/docs/guides/shapes) and application users.

The chart below is from our [cloud benchmarks](/docs/reference/benchmarks#cloud), showing flat, low latency and memory use scaling sync to 1 million concurrent clients on a single community Postgres:

<figure>
  <ScalabilityChart />
</figure>

## Increasingly powerful

We've been focused on making Electric small and stable. So it scales and just works.

Running real workloads has been key to this, as it's given us a tight feedback loop and flushed out real world bugs and edge cases. At the same time, it's also given us a lot of insight into demand for what to build next. And we have some seriously cool stuff coming. From more expressive partial replication primitives to advanced stream processing, database sync and client-side state management.

More on these soon but to give a sneak preview of some of the work in progress:

- [electric-sql/d2ts](https://github.com/electric-sql/d2ts) differential dataflow in Typescript to allow for flexible, extensible stream processing in front of Electric (in the client or at the cloud edge)
- [TanStack/optimistic](https://github.com/TanStack/optimistic) collaboration with [TanStack](https://tanstack.com/) to create a new library to simplify managing optimistic state in the client. This is early but the DX looks really promising
- [electric-sql/phoenix_sync](https://github.com/electric-sql/phoenix_sync) Phoenix.Sync library to add sync to the [Phoenix](https://www.phoenixframework.org) web framework
- [LiveStore](https://livestore.dev/getting-started/react-web) highly performant reactive state management solution for web and mobile apps with first-class support for syncing with Electric

As we build towards 2.0 and 3.0, Electric is only going to become more expressive, more powerful and easier to use. We're super excited for what's ahead and we hope you'll join us on the journey.

## Next steps

[Sign up for Cloud](/product/cloud), dive into the [Quickstart](/docs/quickstart), join the [Discord](https://discord.electric-sql.com) and star us on [GitHub](https://github.com/electric-sql/electric).

<div class="actions cta-actions page-footer-actions left">
  <div class="action cloud-cta">
    <VPButton
        href="/product/cloud/sign-up"
        text="Sign up"
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
  </div>
</div>
