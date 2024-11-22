---
title: Writes - Guide
description: >-
  How to do local writes and write-path sync with Electric.
outline: [2, 3]
---

<script setup>
import AuthorizingProxy from '/static/img/docs/guides/auth/authorizing-proxy.png?url'
import AuthorizingProxySmall from '/static/img/docs/guides/auth/authorizing-proxy.sm.png?url'
import AuthorizingProxyJPG from '/static/img/docs/guides/auth/authorizing-proxy.jpg?url'

import GatekeeperFlow from '/static/img/docs/guides/auth/gatekeeper-flow.dark.png?url'
import GatekeeperFlowJPG from '/static/img/docs/guides/auth/gatekeeper-flow.jpg?url'
</script>

<img src="/img/icons/writes.svg" class="product-icon"
    style="width: 72px"
/>

# Writes

How to do local writes and write-path sync with Electric.

Includes patterns for [online writes](#), [local optimistic state](#), [combining immutable synced state with local optimistic state](#) and [through the database sync](#).

## Local writes with Electric

Electric provides [read-path sync](/product/sync). I.e.: it syncs [little subsets](/docs/guides/shapes) of your data out of Postgres into local apps and services.

Electric **does not** provide built-in write-path sync. I.e.: it does not sync data back into Postgres from your local apps and services.

### So how do you handle local writes with Electric?

The [design philosophy](/blog/2024/07/17/electric-next) behind Electric is to be agnostic to the client. So you can sync into [any client you like](/docs/guides/writing-your-own-client) and implement any pattern you like for handling writes.

This guide outlines those patterns, in order of simplicity. So the most simple, functional, patterns first and the more powerful but more complex patterns further down. Where you may prefer to reach for a framework rather than implement yourself.

Where you draw the line on that is entirely up to you and your app but we provide pointers to external frameworks like [TanStack](/docs/integrations/tanstack) and [LiveStore](/docs/integrations/livestore) where relevant.

## Patterns

The patterns we outline are broken down as follows:

1. [online writes](#)
1. [optimistic state](#)
1. [combining immutable synced state with local optimistic state](#) with examples for both:
    1. [TanStack when managing state in objects in-memory](#)
    2. [PGlite when managing state in an embedded local database](#)
1. [through the database sync](#) with
    1. a [comprehensive PGlite example](#); and
    1. an [example using the external LiveStore framework](#)

### Online writes

no local state

weaknesses:

- takes a while
- need to be online

### Optimistic state

local optimistic state without persistence

1. (2) optimistic state without persistence
- useOptimistic react hook

weaknesses:

- persistence
- patterns for state management

### Combining immutable synced state with local optimistic state

1. (3) sync into immutable / read-only, locally mutable state, combine when you query / display
    1. tan stack
    1. database tables

Really beneficial because ring fencing the synced state simplifies a lot:

- you can wipe the server state and re-sync it
- you can wipe the local state and everything is fine

## Advanced

here be dragons; you probably want a framework but we'll set it out anyway

### Through the database sync

General pattern:

- state from the server; local changes
- when you have local changes, you can keep them seperate from the synced data
- or you can mutate the state immediately and keep the old data around (can be in many ways) so you can revert the local changes if you need to
- simplifies reads vs making writes and merging synced data more complex
- if you simplify reads, you also want to simplify writes
- so just write to a single, unified local store
- keep the history using triggers
- detect the changes using triggers or changestream
- then easy to send the changes to the server
- but you need to handle
    - server says no: roll back the local changes
    - new data from server: merge into local store

Reality:

- there are complexities here
    - shape handles
    - migrations
- you're at the level of building your own framework
- actually may be better to use a simpler pattern
- or use a library that handles this

=> link out to big linearlite

=> link out to LiveStore
