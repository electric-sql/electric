---
title: Local-first with your existing API
description: >-
  How to develop local-first apps incrementally, using your existing API.
excerpt: >-
  Local-first is often seen as eliminating your API. But what if you like
  your API or need to keep it because of other code paths and integrations?
  This post shows how you can develop local-first apps incrementally,
  using your existing API.
authors: [thruflo]
image: /img/blog/local-first-with-your-existing-api/humble-toaster.jpg
tags: [local-first example]
outline: [2, 4]
post: true
---

<script setup>
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

### The Toaster Project

There's a great book by Harvey Molotch called [Where stuff comes from](https://www.amazon.com/Where-Stuff-Comes-Toasters-Computers/dp/0415944007) which talks about how nothing exists in isolation. One of his examples is a toaster.

<figure style="max-width: 512px;">
  <div style="position:relative;height:0;padding-bottom:56.25%">
    <iframe src="https://embed.ted.com/talks/thomas_thwaites_how_i_built_a_toaster_from_scratch?subtitle=en" width="512px" height="288px" title="How I built a toaster -- from scratch" style="position:absolute;left:0;top:0;width:100%;height:100%" frameborder="0" scrolling="no" allowfullscreen>
    </iframe>
  </div>
</figure>

At first glance, a toaster seems like a pretty straightforward, standalone product. However, look a bit closer and it integrates with a huge number of other things. Like sliced bread and all the supply chain behind it.

It runs on electricity. Through a standard plug. It sits on a worktop. It has ergonomic controls. The spring in the lever that you press down to put the toast on is calibrated to match the resistance of your arm.

Your API is a toaster. It doesn't exist in isolation. It's tied into other systems, like your monitoring systems and the way you do migrations and deployment. It's hard to just rip it out, because then you break these integrations and ergonomics &mdash; and obviate your own tooling and operational experience.

For example, REST APIs are stateless. We know how to scale them. They show up in the browser console. We know how to debug them. Swapping them out is all very well in theory, but what happens with your new fangled sync system when it goes down in production? Is that a black box you know how to poke at?

### Electric's approach

At Electric, our mission is to make sync and local-first adoptable for mainstream software. So, one of the main challenges we've focused on is how to use Electric with your existing software stack.

This is why we work with [any data model](/docs/guides/deployment#data-model-compatibility) in [any standard Postgres](/docs/guides/deployment#_1-running-postgres), allow you to sync data into anything from a [JavaScript object](/docs/api/clients/typescript#shape) to a [local database](/product/pglite) and focus on providing [composable primitives](/blog/2024/07/17/electric-next) that work with your existing stack.

As a result, with Electric, you can develop local-first apps incrementally, using your existing API. So you get the benefits of super snappy apps that feel instant to use, collaborative, multi-user sync, local, offline data access for reads and writes and locally encrypted data for security and privacy.

All *without* having to re-engineer your existing stack or re-invent sliced bread.

## How it works

Make one change to the way you fetch data, which is to [swap out web service calls for data sync](#local-first-sync). Then, because we sync data [over HTTP](#over-http) you can [use your API](#using-your-api) to handle [writes](#writes), [auth](#auth), [encryption](#encryption), [etc](#etc).

And you can plug your sync layer into your existing web service integrations and instrumentation, such as [external authorization services](#external-auth-services) and [debugging through the browser console](#debugging-example).

### Local-first sync

To build local-first you have to have the data locally. If you're doing that with data fetching then you have a stale data problem.

<figure style="max-width: 512px">
  <a :href="NoStaleDataJGP">
    <img :src="NoStaleDataJGP" />
  </a>
</figure>

How can your app code trust that it has up-to-date data? This is where you need read-path data sync. To keep the local data fresh when it changes.

If, like most people, you're currently fetching data using web service APIs then this is the one change you need to make. Happily it's exactly what Electric does: [sync data into local apps and services](/use-cases/state-transfer) and [keep it fresh](/use-cases/cache-invalidation) for you.

Practically what does this look like? Well, instead of loading data like this:

```jsx
import React, { useState, useEffect } from 'react'

const MyComponent = () => {
  const [items, setItems] = useState([])

  useEffect(() => {
    const fetchItems = async () => {
      const response = await fetch('https://example.com/api/items')
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

Load data like this:

```jsx
import { useShape } from '@electric-sql/react'

const MyComponent = () => {
  const { data } = useShape({
    url: `https://example.com/api`,
    table: 'items'
  })

  return (
    <List items="data" />
  )
}
```

You can go much further with Electric, all the way to [syncing into a local database](/product/pglite). But you can do this *incrementally* as and when you need to. All you need to start migrating an existing cloud-first, web-service based app to local-first is to start swapping out your data fetching calls for read-path data sync.

#### Over HTTP

Electric syncs data [in JSON over HTTP](/docs/api/http).

Because it's JSON you can parse it, in any language. Because it's HTTP you can cache it and proxy it, to authorize, filter, transform, as you like.



### Using your API

This means that you can use your existing API and web service middleware to handle:

 - [writes](#writes)
 - [auth](#auth)
 - [encryption](#encryption)
 - [etc.](#etc)

#### Writes

  - in tandem with existing client-side primitives for optimistic state

#### Auth


#### Encryption


#### Etc.

For example, with Electric, even if you just sync data into memory, your browser or HTTP client can still cache the responses locally. So re-fetching the data when you re-render a route gives you the data instantly, out of the local file cache. (Offline support for free without having to implement local persistence

<p style="max-width: 512px">
  <a :href="BrowserConsolePNG">
    <img :src="BrowserConsolePNG" />
  </a>
</p>

- compose it anyway you like
- writes, auth and encryption are all just examples of filtering and transforming a JSON HTTP stream
- this is exactly what web frameworks were designed to do
