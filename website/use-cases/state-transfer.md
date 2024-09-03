---
title: "State transfer"
description: >-
  Replace APIs, data fetching and network error handling with
  data synchronisation.
image: /img/use-cases/state-transfer.png
outline: deep
case: true
homepage: true
homepage_order: 10
solves: "state transfer"
benefits:
  - Simplifies your code
  - No loading spinners
---

<script setup>
import MasonryTweets from '../src/components/MasonryTweets.vue'

const tweets = [
  {name: 'johannes', id: '1826338840153571362'},
  {name: 'kyle', id: '1825531359949173019'}
]
</script>

## Replace data fetching with data sync

Most apps today are developed using data fetching. They tend to be designed around the network boundary and a lot of code goes into the practical concerns of data loading, marshalling, serialising/deserialising, etc.

A sync engine like ElectricSQL allows you to switch away from data fetching to build apps using data synchronisation. This simplifies your code, makes your app work better and allows the system to take care of things for you.

## What is the difference?

Data fetching and data sync are different ways of getting data into a local application.

### Data fetching

With data fetching, you write code to fetch data across the network from web service APIs, such as a REST API or GraphQL endpoint.

<figure>
  <a href="/img/use-cases/data-fetching.jpg"
      class="hidden-sm"
      target="_blank">
    <img src="/img/use-cases/data-fetching.png"
        alt="Data fetching flow chart diagramme"
    />
  </a>
  <a href="/img/use-cases/data-fetching.jpg"
      class="block-sm"
      target="_blank">
    <img src="/img/use-cases/data-fetching.sm.png"
        alt="Data fetching flow chart diagramme"
    />
  </a>
</figure>

### Data sync

With data sync, you declare what data you need and that's it &mdash; the data is loaded and kept in sync for you.

<figure>
  <a href="/img/use-cases/data-sync.jpg"
      class="hidden-sm"
      target="_blank">
    <img src="/img/use-cases/data-sync.png"
        alt="Data sync flow chart diagramme"
    />
  </a>
  <a href="/img/use-cases/data-sync.jpg"
      class="block-sm"
      target="_blank">
    <img src="/img/use-cases/data-sync.sm.png"
        alt="Data sync flow chart diagramme"
    />
  </a>
</figure>

## Why is it better?

Data sync simplifies your code, makes your app work better and allows the system to take care of things for you.

### Less code

With data fetching you write code to fetch, serialise/deserialise, validate and hydrate data. With data sync, you don't need to write this code, the system takes care of it for you.

```tsx
import { useShape } from '@electric-sql/react'

const Component = () => {
  const { data } = useShape({
    url: `${BASE_URL}/v1/shape/items`
  })

  return (
    <pre>{ JSON.stringify(data) }<pre>
  )
}
```

### No network boundary

With data fetching, you're always coding across the network, which means you always need to be aware of potential network latency and failure modes like network errors.

<figure>
  <div style="width: 100%;">
    <img src="/img/use-cases/cloud-first-drawbacks.png"
        alt="Data fetching drawbacks diagramme"
        style="margin: 10px auto; width: 100%; max-width: 550px;"
    />
  </div>
</figure>

With data sync, you don't need to think about the network, it's abstracted away and your app code can just work against local data.

<figure>
  <div style="width: 100%;">
    <img src="/img/use-cases/local-first-benefits.png"
        alt="Data sync benefits diagramme"
        style="margin: 10px auto; width: 100%; max-width: 550px;"
    />
  </div>
</figure>

### Stays live

With data fetching, your local data can get stale and you need to re-fetch to keep it live. With data sync, the data is kept live and up-to-date for you.

### Works better

With data fetching, apps are always one network request away from breaking; everything is a distributed system with latency and failure modes.

With data sync, once you've synced the initial data, everything's instant, everything defaults to working and there are no network failure modes.

### System takes care of it

With data fetching, you typically write imperative code to go and fetch data. For example when a page loads, you initiate a request to fetch the data it needs.

With data sync, the system takes care of this for you. Which means that the system (which in future means the AI) can optimise it for you.

<div style="margin-top: -24px">
  <MasonryTweets :tweets="tweets" columns="2 300px" />
</div>

## Next steps

Switch from data fetching to data sync one route at a time with Electric:

<div class="actions cta-actions left">
  <div class="action">
    <VPButton
        href="/docs/quickstart"
        text="Quickstart"
        theme="brand"
    />
  </div>
  <div class="action">
    <VPButton href="/docs/api/http"
        text="API docs"
        theme="alt"
    />
  </div>
  <div class="action hidden-sm">
    <VPButton href="https://github.com/electric-sql/electric/tree/main/examples"
        target="_blank"
        text="Examples"
        theme="alt"
    />
  </div>
</div>
