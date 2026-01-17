---
title: Redis
description: >-
  Example showing how to sync into Redis from Electric.
source_url: https://github.com/electric-sql/electric/tree/main/examples/redis
example: true
order: 10
---

# {{ $frontmatter.title }}

{{ $frontmatter.description }}

<DemoCTAs :demo="$frontmatter" />

## Syncing into a Redis data structure

Redis is often used as a cache. Electric can sync into Redis and automatically manage [cache invalidation](/sync).

The main example code is in [`./src/index.ts`](https://github.com/electric-sql/electric/blob/main/examples/redis/src/index.ts):

<<< @../../examples/redis/src/index.ts{typescript}

<DemoCTAs :demo="$frontmatter" />
