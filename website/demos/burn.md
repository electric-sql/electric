---
title: Burn
description: >-
  Agentic system built on Postgres and a real-time sync stack.
deployed_url: https://burn.examples.electric-sql.com
source_url: https://github.com/electric-sql/electric/tree/main/examples/burn
blog_post_url: /blog/2025/08/12/bringing-agents-back-down-to-earth
image: /img/demos/burn.jpg
demo: true
homepage: true
order: 3
---

<script setup>
  import { data } from '../data/posts.data.ts'
  const posts = data.filter(post => {
    return post.path === '/blog/2025/08/12/bringing-agents-back-down-to-earth'
  })

  import BlogPostListing from '../src/components/BlogPostListing.vue'
  import YoutubeEmbed from '../src/components/YoutubeEmbed.vue'
</script>

<style scoped>
  .listing {
    display: grid;
    grid-template-columns: 1fr;
    gap: 32px;
    margin: 24px 0;
    overflow: hidden;
  }
  @media (max-width: 1049px) {
    .listing {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 949px) {
    .listing {
      gap: 32px;
      margin: 24px 0;
    }
  }
  @media (max-width: 749px) {
    .listing {
      grid-template-columns: 1fr;
      gap: 32px;
      margin: 20px 0;
    }
  }
  @media (max-width: 549px) {
    .listing {
      margin: 20px 0;
    }
  }
</style>

# 🔥 Burn

Agentic system demo using Postgres with a [real-time sync stack](/blog/2025/08/12/bringing-agents-back-down-to-earth).

<DemoCTAs :demo="$frontmatter" />

## Agentic sync

Burn is a multi-user, multi-agent demo app built on [TanStack&nbsp;DB](/products/tanstack-db) and [Phoenix.Sync](https://hexdocs.pm/phoenix_sync).

It shows how to build an agentic system on real-time sync, where:

- users and agents are automatically kept in sync
- memory means rows in a Postgres database
- context engineering is a representation of that database state

<figure>
  <div class="embed-container" style="padding-bottom: 75.842697%">
    <YoutubeEmbed video-id="4QpErQ9nVEc" />
  </div>
</figure>

### Stack

Agentic memory and shared state are both [just rows in the database](https://pg-memories.netlify.app).

[<img src="/img/integrations/tanstack.svg" alt="TanStack icon" width="48" /> TanStack&nbsp;DB](/products/tanstack-db)

- provides a super fast client store for instant reactivity and local writes
- with live queries syncing data into standard React components

[<img src="/img/integrations/phoenix.svg" alt="Phoenix Framework icon" width="48" /> Phoenix.Sync](https://hexdocs.pm/phoenix_sync)

- exposes sync endpoints
- handles auth and writes
- runs agents as OTP processes

### Context

There's a lot of hype around agentic system development. Concepts like agentic memory, instruction routing, retrieval and context engineering.

When you dig into it, these all collapse down to processes and database state. You can build agentic systems with a database, standard web tooling and real-time sync.

<div class="listing">
  <BlogPostListing v-for="post in posts"
      :key="post.slug"
      :post="post"
  />
</div>
