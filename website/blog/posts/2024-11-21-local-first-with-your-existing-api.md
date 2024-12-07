---
title: Local-first with your existing API
description: >-
  How to develop local-first apps incrementally, using your existing API.
excerpt: >-
  Local-first is often seen as eliminating your API. But what if you like your API or need to keep it because of other code paths and integrations? This post shows how you can develop local-first apps incrementally, using your existing API.
authors: [thruflo]
image: /img/blog/local-first-with-your-existing-api/humble-toaster.jpg
tags: [local-first example]
outline: [2, 4]
post: true
---

<script setup>
import AuthorizingProxy from '/static/img/docs/guides/auth/authorizing-proxy.png?url'
import AuthorizingProxySmall from '/static/img/docs/guides/auth/authorizing-proxy.sm.png?url'
import AuthorizingProxyJPG from '/static/img/docs/guides/auth/authorizing-proxy.jpg?url'
import BrowserConsolePNG from '/static/img/blog/browser-console.png?url'
import NoStaleDataJGP from '/static/img/blog/no-stale-data.jpg?url'
</script>

<div class="warning custom-block github-alert">
  <p style="margin-bottom: 10px">
    With Electric, you can develop local-first apps incrementally,
    using your existing API.
  </p>
  <p>
    <span class="no-wrap">Jump ahead to see</span> <a href="#how-it-works">how it works</a> or read on for more context.
  </p>
</div>

One of the exciting things about [local-first software](/use-cases/local-first-software) is the potential to eliminate APIs and microservices. Instead of coding across the network, you code against a local store, data syncs in the background and your stack is suddenly much simpler.

The challenge is that, here in the real world, many of us quite like our APIs and actually want to keep them, thank you very much.

## The Toaster Project

There's a great book by Harvey Molotch called [Where stuff comes from](https://www.amazon.com/Where-Stuff-Comes-Toasters-Computers/dp/0415944007) which talks about how nothing exists in isolation. One of his examples is a toaster.

<figure style="max-width: 512px;">
  <div style="position:relative;height:0;padding-bottom:56.25%">
    <iframe src="https://embed.ted.com/talks/thomas_thwaites_how_i_built_a_toaster_from_scratch?subtitle=en" width="512px" height="288px" title="How I built a toaster -- from scratch" style="position:absolute;left:0;top:0;width:100%;height:100%" frameborder="0" scrolling="no" allowfullscreen>
    </iframe>
  </div>
</figure>

At first glance, a toaster seems like a pretty straightforward, standalone product. However, look a bit closer and it integrates with a huge number of other things. Like sliced bread and all the supply chain behind it. It runs on electricity. Through a standard plug. It sits on a worktop. The spring in the lever that you press down to put the toast on is calibrated to match the strength of your arm.

Your API is a toaster. It doesn't exist in isolation. It's tied into other systems, like your monitoring systems and the way you do migrations and deployment. It's hard to just rip it out, because then you break these integrations and ergonomics &mdash; and obviate your own tooling and operational experience.

For example, REST APIs are stateless. We know how to scale them. We know how to debug them. They show up in the browser console. Swapping them out is all very well in theory, but what happens with your new system when it goes down in production?

### Electric's approach

At Electric, our mission is to make [sync](/use-cases/state-transfer) and [local-first](/use-cases/local-first-software) adoptable for mainstream software. So, one of the main challenges we've focused on is how to use Electric with your existing software stack.

This is why we work with [any data model](/docs/guides/deployment#data-model-compatibility) in [any standard Postgres](/docs/guides/deployment#_1-running-postgres). It's why we allow you to sync data into anything from a [JavaScript object](/docs/api/clients/typescript#shape) to a [local database](/product/pglite). And it's why we focus on providing [composable primitives](/blog/2024/07/17/electric-next) rather than a one-size-fits-all solution.

As a result, with Electric, you can develop local-first apps incrementally, using your existing API. So you can get the benefits of local-first, without having to re-engineer your stack or re-invent sliced bread, just to make toast in the morning.

## How it works

First use Electric to [sync data into your app](#electric-sync). This allows your app to work with local data without it getting stale.

Then [use your API](#using-your-api) to handle:

- [auth](#auth)
- [writes](#writes)

As well as, optionally, other concerns like:

- [encryption](#encryption)
- [filtering](#filtering)

Because Electric syncs data [over HTTP](#http-and-json), you can use existing middleware, integrations and instrumentation. Like [authorization services](#external-auth-services) and [the browser console](#debugging-example).

### Electric sync

To build local-first you have to have the data locally. If you're doing that with data fetching then you have a stale data problem. Because if you're working with local data without keeping it in sync, then how do you know that it's not stale?

<figure style="max-width: 512px">
  <a :href="NoStaleDataJGP">
    <img :src="NoStaleDataJGP" />
  </a>
</figure>

This is why you need [data sync](/use-cases/state-transfer). To keep the local data fresh when it changes. Happily, this is exactly what Electric does. It [syncs data into local apps and services](/product/electric) and keeps it fresh for you.

Practically what does this look like? Well, instead of fetching data using web service calls, i.e.: something like this:

```jsx
import React, { useState, useEffect } from 'react'

const MyComponent = () => {
  const [items, setItems] = useState([])

  useEffect(() => {
    const fetchItems = async () => {
      const response = await fetch('https://example.com/v1/api/items')
      const data = await response.json()

      setItems(data)
    }

    fetchItems()
  }, [])

  return (
    <List items="items" />
  )
}
```

Sync data using Electric, like this:

```jsx
import { useShape } from '@electric-sql/react'

const MyComponent = () => {
  const { data } = useShape({
    url: `https://electric.example.com/v1/shape`,
    params: {
      table: 'items'
    }
  })

  return (
    <List items="data" />
  )
}
```

You can go much further with Electric, all the way to [syncing into a local database](/product/pglite). But you can do this *incrementally* as and when you need to. For example:

- [Trigger.dev](https://trigger.dev/) started with Electric by using it to sync job status data into their [Realtime product](https://trigger.dev/launchweek/0/realtime)
- [Otto](https://ottogrid.ai) started by swapping out the way they loaded data into their AI spreadsheet

#### Read-path

Electric [only does the read-path sync](/docs/guides/writes#local-writes-with-electric). It syncs data out-of Postgres, into local apps.

Electric does not do write-path sync. It does not provide (or prescribe) a solution for getting data back into Postgres from local apps and services. In fact, it's explicitly designed for you to handle writes yourself.

#### HTTP

The other key thing about Electric sync is that [it's just JSON over HTTP](/docs/api/http).

Because it's JSON you can parse it and [work with it](/docs/guides/client-development) in any language and environment. Because it's HTTP you can proxy it. Which means you can use existing HTTP services and middleware to authorize access to it.

In fact, whatever you want to do to the replication stream &mdash; [encrypt](#encryption), [filter](#filtering), transform, split, remix, buffer, you name it &mdash; you can do through a proxy. Extensibility is built in at the protocol layer.

## Using your existing API

So far, above, we've seen that Electric handles read-path sync and leaves [writes](#writes) up to you. We've seen how it syncs over HTTP and how this allows you to implement [auth](#auth) and other concerns like [encryption](#encryption) and [filtering](#filtering) using proxies.

Now, let's now dive in to these aspects and see exactly how to implement them using your existing API. With code samples and links to example apps.

### Auth

if you're [upgrading from data fetch to data sync](#), you typically authorise access to data in a controller or middleware layer

for many sync engines, you cut out this layer and need to migrate this auth logic to database rules;
e.g.: couch, firebase, Postgres RLS

because Electric syncs over HTTP and the shape is an http resource
don't need to do this
you can just route the request to Electric through an HTTP proxy that you control

<a :href="AuthorizingProxyJPG">
  <img :src="AuthorizingProxy" class="hidden-sm"
      alt="Illustration of an authorzing proxy"
  />
  <img :src="AuthorizingProxySmall" class="block-sm"
      alt="Illustration of an authorzing proxy"
  />
</a>

this can be your existing backend API
or, if you're running Electric behind a CDN, this can be an edge function in front of the CDN
e.g. using Cloudflare or Supabase

you can see this pattern implemented in the
=> proxy auth

can also use external auth services in the proxy
=> authzed using zanzibar for consistent distributed auth

also use a token based approach
using your api to generate the tokens
=> gatekeeper auth

this actually has three examples for authorising the tokens:

XXX explain the Elixir approach

<<< @../../examples/gatekeeper-auth/api/lib/api_web/router.ex{elixir}

XXX explain the Caddy approach

<<< @../../examples/gatekeeper-auth/caddy/Caddyfile{hcl}

XXX explain the edge worker approach

<<< @../../examples/gatekeeper-auth/edge/index.ts{ts}

then in the client, you're using standard fetch
=> typescript client supports headers, error handling and a custom fetch client
=> e.g.: gatekeeper client.ts

<<< @../../examples/gatekeeper-auth/client/index.ts{ts}

### Writes

you can write to Postgres any way you like
those dotted arrows on the outside
that's you

<figure>
  <a href="/img/api/shape-log.jpg">
    <img srcset="/img/api/shape-log.sm.png 1064w, /img/api/shape-log.png 1396w"
        sizes="(max-width: 767px) 600px, 1396px"
        src="/img/api/shape-log.png"
        alt="Shape log flow diagramme"
    />
  </a>
  <figcaption class="figure-caption text-end">
    Shape log flow diagramme.
  </figcaption>
</figure>

there's a comprehensive Writes guide and write-patterns example that walks through a range of options for this.
You can see a number of the examples that use an API writes, including:

- Linearlite
- Phoenix LiveView
- TanStack

And there are other frameworks you can use, including

- LiveStore
- TinyBase

To highlight a couple of the key patterns, let's look at the shared API server for the write-patterns example:

<<< @../../examples/write-patterns/shared/backend/api.js{js}

It exposes the write methods of a REST API for a table of todos. Specifically:

- `POST {todo} /todos` to create a todo
- `PUT {partial-todo} /todos/:id` to update
- `DELETE /todos/:id` to delete

If you then look at the optimistic state example, you can see this being used, in tandem with Electric sync for the read path:

<<< @../../examples/write-patterns/patterns/2-optimistic-state/index.tsx{tsx}

Data syncs into the component using `useShape`. Writes are made using an API client to `POST` / `PUT` / `DELETE` data to the API. The app is still setup to support local, offline writes using optimistic state. There are various ways of handling local state and concurrency. The Writes guide goes into these in detail for different patterns, including:

- online writes
- optimistic state
- shared persistent optimistic state
- through the DB sync

Just to give a sense of it here, the last pattern, through the DB sync, uses Electric with an embedded PGlite database. It defines a local database schema with an immutable `todos_synced` table for synced data and a mutable `todos_local` table for local optimistic state. It wraps these up into a `todos` view that provides a single table interface to the application code.

All the application code needs to do is read and write to and from the `todos` "table". The database schema takes care of everything else, including keeping a log of local changes to send to the server, in a `changes` table. This is then processed in the example by a minimal implementation of a sync utility:

<<< @../../examples/write-patterns/patterns/4-through-the-db/sync.ts{ts}

You can choose with these patterns how far you go into the complexities of concurrency, merge logic, rollbacks, etc. However you handle those, the point here is that the writes are all still being made via the API. The sync utility just shown ultimately sends data to a `POST {transactions} /changes` endpoint defined in the shared API server further above.

Whether this is your existing API or a new service you implement is up to you. Either wau, it's just a web service. You can use your existing stack and you can authorise writes just as we illustrated authorizing reads above.

### Encryption

electric syncs ciphertext as well as it syncs plaintext
you can encrypt data on and off the local client
  when it comes off the replication stream
  and when you send it off the device when sending or syncing a local write

<<< @../../examples/encryption/src/Example.tsx{tsx}

in a way, it becomes a key management challenge
and, of course, you can use electric to sync keys
the same way you can use electric to sync any dist config
  for example, we're using Electric to build Electric cloud
  specifically to sync routing data into edge workers

### Filtering



## Using your existing tools

the browser console.

<p style="max-width: 512px">
  <a :href="BrowserConsolePNG">
    <img :src="BrowserConsolePNG" />
  </a>
</p>

- compose it anyway you like
- writes, auth and encryption are all just examples of filtering and transforming a JSON HTTP stream
- this is exactly what web frameworks were designed to do
