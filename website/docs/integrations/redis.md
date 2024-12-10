---
outline: deep
title: Redis - Integrations
description: >-
  How to use Electric to sync data into Redis.
image: /img/integrations/electric-redis.jpg
---

<img src="/img/integrations/redis.svg" class="product-icon" />

# Redis

Redis is an in-memory "data structure server", often used as a cache.

## Electric and Redis

Many applications use [Redis](https://redis.io/docs/latest/develop/use/client-side-caching/) as a local cache. With Electric, you can define a [Shape](/docs/guides/shapes) and sync it into a [Redis data structure](https://redis.io/docs/latest/develop/data-types/hashes/).

### Example

The shape stream comes through as a [log](/docs/api/http#shape-log) of insert, update and delete messages. Apply these to the Redis hash and the cache automatically stays up-to-date:

<<< @../../examples/redis/src/index.ts

See the [Redis example](/demos/redis) for more details.

<HelpWanted issue="1881">
  a library that wraps up the
  <code>redis-sync</code>
  example into an
  <code>@electric-sql/redis</code>
  integration library.
</HelpWanted>
