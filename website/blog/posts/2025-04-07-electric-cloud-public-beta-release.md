---
title: "Electric Cloud in public BETA"
description: >-
  Electric Cloud is now in public BETA!
  This means it's open to everyone for immediate access.
excerpt: >-
  Electric Cloud is now in public BETA!
  This means it's open to everyone for immediate access.
authors: [kyle]
image: /img/blog/electric-cloud-public-beta-release/header.jpg
tags: [release]
outline: [2, 3]
post: true
---

<script setup>
  import ScalabilityChart from '../../src/components/ScalabilityChart.vue'
</script>

[Electric Cloud](https://dashboard.electric-sql.cloud) is in public BETA! It's open to everyone for immediate access.

You can [create your account here](https://dashboard.electric-sql.cloud) and start using it straight away to sync data and build apps with. Use the new dashboard to connect and manage multiple sources (i.e.: multiple Electric services backed by different Postgres databases), see system logs and service health and status.

<a href="https://dashboard.electric-sql.cloud" class="no-visual">
  <img src="/img/blog/electric-cloud-public-beta-release/dashboard.png" />
</a>

We'll be iterating on adding more features to the dashboard and cloud tooling. However, now cloud is in public BETA, you can use it together with our [llms.txt](https://electric-sql.com/llms.txt) to go from a Postgres database to a real-time app in seconds. Especially if you're building on hosts like [Supabase](/docs/integrations/supabase) and [Neon](/docs/integrations/neon), which have great support for LLM code generation.

<div style="max-width: 512px; margin: 24px 0">
  <div class="embed-container">
    <YoutubeEmbed video-id="ooWaPVvljlU" />
  </div>
</div>

As well as being easy to [use](/docs/intro), [integrate](/blog/2024/11/21/local-first-with-your-existing-api) and [get-started with](/docs/quickstart), Electric Cloud is also [highly performant and scalable](/docs/reference/benchmarks#cloud), with an integrated CDN and low-latency edge primitives. Unlike other systems that demo well and fall over, you can build real-time apps on Electric Cloud and not worry that they're going to explode or fall over when you hit hockey stick growth.

The chart below is from our [cloud benchmarks](/docs/reference/benchmarks#cloud), testing Electric's memory usage and latency with a single Electric service scaling real-time sync from 100k to 1 million concurrent clients under a sustained load of 960 writes/minute. Both memory usage and latency are essentially <em>flat</em>:

<figure>
  <ScalabilityChart />
</figure>

If you've been waiting for hosted Electric to stabilize, now's a great time to dive in. The [core sync service is in GA](/blog/2025/03/17/electricsql-1.0-released) and cloud is fully available. Support is available through [GitHub](https://github.com/electric-sql/electric/issues) and [Discord](https://discord.electric-sql.com) and premium support available for teams who need direct email support and/or technical assistance.

Can't wait to see what you build with it 🚀

<div class="actions cta-actions page-footer-actions left">
  <div class="action cloud-cta">
    <VPButton
        href="https://dashboard.electric-sql.cloud"
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
