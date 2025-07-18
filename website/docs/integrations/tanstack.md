---
outline: deep
title: TanStack - Integrations
description: >-
  How to use Electric with TanStack. Including using Electric for read-path sync and TanStack Query for optimistic writes.
image: /img/integrations/electric-tanstack.jpg
---

<script setup>
import DataFlowPNG from '/static/img/docs/integrations/tanstack/data-flow.png?url'
import DataFlowSmPNG from '/static/img/docs/integrations/tanstack/data-flow.sm.png?url'
import DataFlowJPG from '/static/img/docs/integrations/tanstack/data-flow.jpg?url'
</script>

<img src="/img/integrations/tanstack.svg" class="product-icon" />

# TanStack

[TanStack](https://tanstack.com/) is a set of utilities for building web applications.

> [!Warning] Electric and TanStack DB
> Electric now has native support for TanStack through the TanStack DB library. [Tanstack DB](https://tanstack.com/db) is a reactive client
> store for building super fast apps on sync. Electric integrates natively with it.
>
> See the [TanStack DB documentation](https://tanstack.com/db/latest/docs/overview) for usage details and James'
> [Introducing TanStack DB](https://youtu.be/ia9FpY_Sw_4) Local-first Conf talk for more context.
>
> TanStack DB superceeds the integration docs below.

## Electric and TanStack

[TanStack Query](https://tanstack.com/query/latest) is a data-fetching and state management library. Electric works very well together with TanStack Query, where Electric provides the read-path sync and TanStack provides a [local write-path with optimistic state](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates#via-the-cache).

<figure>
  <a :href="DataFlowJPG">
    <img :src="DataFlowPNG" class="hidden-xs"
        alt="Illustration of an Electric - TanStack integration"
    />
    <img :src="DataFlowSmPNG" class="block-xs"
        alt="Illustration of an Electric - TanStack integration"
    />
  </a>
  <figcaption style="line-height: 1.4">
    <small>
      <em>
        Green shows read-path sync via Electric.
        <span class="no-wrap">Red shows write-path via TanStack.</span>
      </em>
    </small>
  </figcaption>
</figure>

In this configuration, Electric and TanStack can provide a fully offline-capable system with active-active replication of both reads and writes.

### Example

The example below shows a simple todo application that uses Electric for read-path sync and TanStack for local optimistic writes.

Electric is used to sync a shape. TanStack is used to apply mutations and maintain optimistic state. When a mutation is confirmed, it cleares the optimistic state. When the component renders, it merges the optimistic state into the shape data.

<<< @../../examples/tanstack/src/Example.tsx

See the [Tanstack example](/demos/tanstack) for the full source code.
