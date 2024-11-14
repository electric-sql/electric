---
outline: deep
title: TanStack - Integrations
description: >-
  How to use Electric with TanStack. Including using Electric for read-path sync and TanStack Query for optimistic writes.
image: /img/integrations/electric-tanstack.jpg
---

<script setup>
import HelpWanted from '/src/components/HelpWanted.vue'

import DataFlowPNG from '/static/img/docs/integrations/tanstack/data-flow.png?url'
import DataFlowSmPNG from '/static/img/docs/integrations/tanstack/data-flow.sm.png?url'
import DataFlowJPG from '/static/img/docs/integrations/tanstack/data-flow.jpg?url'
</script>

<img src="/img/integrations/tanstack.svg" class="product-icon" />

# TanStack

[TanStack](https://tanstack.com/) is a set of utilities for building web applications.

[TanStack Query](https://tanstack.com/query/latest) is a data-fetching and state management library.

## Electric and TanStack

Electric works very well together with TanStack Query, where Electric provides the read-path sync and TanStack provides a [local write-path with optimistic state](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates#via-the-cache).

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

<<< @../../examples/tanstack-example/src/Example.tsx

See the [`tanstack-example`](https://github.com/electric-sql/electric/tree/main/examples/tanstack-example) for the full source code.

<HelpWanted issue="1882">
  a library based on the
  <code>tanstack-example</code>
  that integrates Electric and TanStack into a higher level interface.
</HelpWanted>
