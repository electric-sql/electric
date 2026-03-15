---
outline: deep
title: TanStack - Integrations
description: >-
  How to use Electric with TanStack. Including using Electric for read-path sync and TanStack Query for optimistic writes.
image: /img/integrations/electric-tanstack.jpg
---

<script setup>
import { data } from '../../data/posts.data.ts'
const posts = data.filter(post => {
  console.log(post.path)

  return post.path === '/blog/2025/07/29/super-fast-apps-on-sync-with-tanstack-db'
})

import BlogPostListing from '../../src/components/BlogPostListing.vue'
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

<img src="/img/integrations/tanstack.svg" class="product-icon" />

# TanStack

[TanStack](https://tanstack.com) is a collection of TypeScript libraries for building web and mobile apps.

Developed by an open collective, stewarded by [Tanner Linsley](https://github.com/tannerlinsley), it's one of the best and most popular ways to build modern apps.

## TanStack&nbsp;DB

Electric have [partnered with TanStack](https://tanstack.com/blog/tanstack-db-0.1-the-embedded-client-database-for-tanstack-query) to build [TanStack&nbsp;DB](/products/tanstack-db), a reactive client store for building super fast apps on sync.

Type-safe, declarative, incrementally adoptable and insanely fast, it's the [future of app development with Electric](/blog/2025/07/29/super-fast-apps-on-sync-with-tanstack-db) and the best way of [building AI apps<span class="hidden-xs"> and agentic systems</span>](/blog/2025/04/09/building-ai-apps-on-sync).

See the blog post for more details:

<div class="listing">
  <BlogPostListing v-for="post in posts"
      :key="post.slug"
      :post="post"
  />
</div>

[Maxi Ferreira](https://x.com/charca) also wrote an [awesome interactive guide](https://frontendatscale.com/blog/tanstack-db) to what TanStack&nbsp;DB is, how it works, and why it might change the way you build apps:

<figure class="listing">
  <a href="https://frontendatscale.com/blog/tanstack-db" class="no-visual">
    <img alt="An Interactive Guide to TanStack&nbsp;DB"
        src="/img/blog/local-first-sync-with-tanstack-db/interactive-guide-to-tanstack-db.jpg"
        style="border-radius: 16px"
    />
  </a>
</figure>

### Project links

There's a [TanStack&nbsp;Start&nbsp;starter](https://github.com/electric-sql/electric/tree/main/examples/tanstack-db-web-starter) for web and [Expo&nbsp;starter](https://github.com/electric-sql/electric/tree/main/examples/tanstack-db-expo-starter) for&nbsp;mobile.

See the project website at [tanstack.com/db](https://tanstack.com/db), the [official docs](https://tanstack.com/db/latest/docs/overview) and the [example&nbsp;app](https://github.com/TanStack/db/tree/main/examples/react/todo) in the [tanstack/db](https://github.com/tanstack/db) GitHub&nbsp;repo.

<div class="actions cta-actions page-footer-actions left">
  <div class="action cloud-cta">
    <VPButton
      href="https://github.com/electric-sql/electric/tree/main/examples/tanstack-db-web-starter"
      text="Starter"
      theme="brand"
    />
    &nbsp;
    <VPButton
        href="https://tanstack.com/blog/tanstack-db-0.1-the-embedded-client-database-for-tanstack-query"
        text="Blog"
        theme="alt"
    />
    &nbsp;
    <VPButton
        href="https://tanstack.com/db/latest/docs/overview"
        text="Docs"
        theme="alt"
    />
    &nbsp;
    <VPButton
        href="https://github.com/TanStack/db"
        text="Repo"
        theme="alt"
    />
  </div>
</div>
