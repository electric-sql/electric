---
title: "Local-first software"
description: >-
  Take the network off the interaction path and build
  software that works offline and is
  resilient by design.
image: /img/use-cases/local-first.png
outline: deep
case: true
homepage: true
homepage_order: 30
solves: "availability"
benefits:
  - Simplifies your ops
  - No more broken apps
---

<script setup>
import { ref } from 'vue'

// Modal states
const isCloudFirstModalOpen = ref(false)
const isLocalFirstModalOpen = ref(false)
const isSyncEngineModalOpen = ref(false)
</script>

## Building resilient software that works offline

Cloud-first software needs to be online in order to work. If the network connection fails or the back end is down, the software breaks.

Local-first software defaults to working. It's resilient by design. If the network connection fails, it still works. If the back end is down, it still works.

Electric is a sync engine that supports building local-first software. Making your apps more reliable as well as faster, more modern and naturally collaborative.

## Cloud-first software

With cloud-first software, you're always coding across the network. This means you always need to be aware of potential network latency and failure modes like network errors.

<figure>
  <div style="width: 100%;">
    <div class="clickable-image" @click="isCloudFirstModalOpen = true">
      <img src="/img/use-cases/cloud-first-drawbacks.png"
          alt="Data fetching drawbacks diagramme"
          style="margin: 10px auto; width: 100%; max-width: 550px;"
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
  </div>
</figure>

<ImageModal
:is-open="isCloudFirstModalOpen"
image-src="/img/use-cases/cloud-first-drawbacks.png"
image-alt="Data fetching drawbacks diagramme"
@close="isCloudFirstModalOpen = false"
/>

## Local-first software

Local-first is a new architecture, where your app code talks to a local data store and data syncs in the background. With local-first, you don't need to think about the network, it's abstracted away and your app code can just work against local data.

<figure>
  <div style="width: 100%;">
    <div class="clickable-image" @click="isLocalFirstModalOpen = true">
      <img src="/img/use-cases/local-first-benefits.png"
          alt="Data sync benefits diagramme"
          style="margin: 10px auto; width: 100%; max-width: 550px;"
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
  </div>
</figure>

<ImageModal
:is-open="isLocalFirstModalOpen"
image-src="/img/use-cases/local-first-benefits.png"
image-alt="Data sync benefits diagramme"
@close="isLocalFirstModalOpen = false"
/>

## Benefits of local-first

Local-first apps are:

- faster, with zero network latency making them feel super snappy and instant to use
- collaborative, with realtime sync and multi-user collaboration built in
- resilient, working offline and tolerating downtime

### Product-led growth

As examples like Figma, Linear and Superhuman have shown, apps build on a local-first architecture provide a significantly better UX. This is a key ingredient of product-led growth, in categories where users can vote with their feet and choose their own software.

## Sync engine architecture

With local-first software, instead of talking to web-service APIs, you app code talks to a local data store that is available offline. Data is then synced in the background, when you have connectivity. To sync data in the background, you need a sync engine.

Local-first apps are built on sync engine architecture.

### How does Electric help?

Electric is a sync engine. It syncs little subsets of your Postgres data into local apps and services.

<div style="width: 100%;">
  <div class="clickable-image" @click="isSyncEngineModalOpen = true">
    <img src="/img/use-cases/local-first-sync-engine.png"
        alt="Sync engine illustration"
        style="margin: 10px auto; width: 100%; max-width: 550px;"
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
</div>

<ImageModal
:is-open="isSyncEngineModalOpen"
image-src="/img/use-cases/local-first-sync-engine.png"
image-alt="Sync engine illustration"
@close="isSyncEngineModalOpen = false"
/>

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
