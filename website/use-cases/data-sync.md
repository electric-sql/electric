---
title: "Data sync"
description: >-
  Replace APIs, data fetching and network error handling with
  data sync.
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
import { ref } from 'vue'

const tweets = [
  {name: 'johannes', id: '1826338840153571362'},
  {name: 'kyle', id: '1825531359949173019'}
]

// Modal states
const isDataFetchingModalOpen = ref(false)
const isDataSyncModalOpen = ref(false)
</script>

## Replace data fetching with data sync

Most apps today are developed using data fetching. They tend to be designed around the network boundary and a lot of code goes into the practical concerns of data loading, marshalling, serialising/deserialising, etc.

A sync engine like ElectricSQL allows you to switch away from data fetching to build apps using data synchronisation. This simplifies your code, makes your app work better and allows the system to take care of things for you.

## What is the difference?

Data fetching and data sync are different ways of getting data into a local application.

### Data fetching

With data fetching, you write code to fetch data across the network from web service APIs, such as a REST API or GraphQL endpoint.

<figure>
  <div class="clickable-image" @click="isDataFetchingModalOpen = true">
    <img src="/img/use-cases/data-fetching.png"
        alt="Data fetching flow chart diagramme"
        class="hidden-sm"
    />
    <img src="/img/use-cases/data-fetching.sm.png"
        alt="Data fetching flow chart diagramme"
        class="block-sm"
    />
    <div class="image-overlay">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"></circle>
        <path d="m21 21-4.35-4.35"></path>
        <line x1="11" y1="8" x2="11" y2="14"></line>
        <line x1="8" y1="11" x2="14" y2="11"></line>
      </svg>
    </div>
  </div>
</figure>

<ImageModal
:is-open="isDataFetchingModalOpen"
image-src="/img/use-cases/data-fetching.png"
image-alt="Data fetching flow chart diagramme"
@close="isDataFetchingModalOpen = false"
/>

### Data sync

With data sync, you declare what data you need and that's it &mdash; the data is loaded and kept in sync for you.

<figure>
  <div class="clickable-image" @click="isDataSyncModalOpen = true">
    <img src="/img/use-cases/data-sync.png"
        alt="Data sync flow chart diagramme"
        class="hidden-sm"
    />
    <img src="/img/use-cases/data-sync.sm.png"
        alt="Data sync flow chart diagramme"
        class="block-sm"
    />
    <div class="image-overlay">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"></circle>
        <path d="m21 21-4.35-4.35"></path>
        <line x1="11" y1="8" x2="11" y2="14"></line>
        <line x1="8" y1="11" x2="14" y2="11"></line>
      </svg>
    </div>
  </div>
</figure>

<ImageModal
:is-open="isDataSyncModalOpen"
image-src="/img/use-cases/data-sync.png"
image-alt="Data sync flow chart diagramme"
@close="isDataSyncModalOpen = false"
/>

## Why is sync better?

Data sync simplifies your code, makes your app work better and allows the system to take care of things for you.

### Less code

With data fetching you write code to fetch, serialise/deserialise, validate and hydrate data. With data sync, you don't need to write this code, the system takes care of it for you.

```tsx
import { useShape } from '@electric-sql/react'

const Component = () => {
  const { data } = useShape({
    url: `${BASE_URL}/v1/shape`,
    params: {
      table: `items`
    }
  })

  return (
    <pre>{ JSON.stringify(data) }<pre>
  )
}
```

### No network boundary

With data fetching, you're always coding across the network, which means you always need to be aware of potential network latency and failure modes like network errors.

With data sync, you don't need to think about the network, it's abstracted away and your app code can just work against local data.

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

## How does Electric help?

Electric is a sync engine. Using Electric allows you to replace data fetching with data sync.

<div class="actions cta-actions page-footer-actions left">
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
    <VPButton href="/demos"
        target="_blank"
        text="Demos"
        theme="alt"
    />
  </div>
</div>
