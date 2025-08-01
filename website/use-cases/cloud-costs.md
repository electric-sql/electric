---
title: "Cloud cost reduction"
description: >-
  Take the query workload off your database and the
  compute workload off your cloud.
image: /img/use-cases/scalability.png
outline: deep
case: true
homepage: true
homepage_order: 30
solves: "scaling"
benefits:
  - Simplifies your infra
  - Reduces your cloud bill
---

<script setup>
import { ref } from 'vue'

// Modal states
const isThreeTierModalOpen = ref(false)
const isSyncEngineModalOpen = ref(false)
</script>

## Radically reduce your cloud bill

Most software today is built on a 3-tier web-service architecture. Front-end apps talk to backend services to fetch data and run business logic.

<figure>
  <div class="clickable-image" @click="isThreeTierModalOpen = true">
    <img src="/img/use-cases/three-tier-architecture.png"
        alt="Diagramme illustrating 3-tier software architecture"
        style="margin: 0; width: 100%; max-width: 450px"
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
:is-open="isThreeTierModalOpen"
image-src="/img/use-cases/three-tier-architecture.png"
image-alt="Diagramme illustrating 3-tier software architecture"
@close="isThreeTierModalOpen = false"
/>

This means business logic executes on the cloud, which leads to high volumes of requests and database queries. This costs money to serve, in the form of compute and database query costs. Plus querying data in the cloud leads to large egress costs.

## Sync-engine architecture

Sync-engine architecture replaces data fetching, querying and egress from the cloud with sync into a local data store, local queries and minimal egress.

<figure>
  <div class="clickable-image" @click="isSyncEngineModalOpen = true">
    <img src="/img/use-cases/sync-engine-architecture.png"
        alt="Diagramme illustrating sync engine architecture"
        style="margin: 0; width: 100%; max-width: 450px"
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
:is-open="isSyncEngineModalOpen"
image-src="/img/use-cases/sync-engine-architecture.png"
image-alt="Diagramme illustrating sync engine architecture"
@close="isSyncEngineModalOpen = false"
/>

This architecture changes the operational cost characteristics of your software:

- moving business logic onto the client device
- eliminating the request workload hitting the cloud
- minimising database query and egress costs
- avoiding SRE costs from high uptime

## How does Electric help?

Electric is a sync engine. You can use Electric to move to a sync engine architecture.

## Example

[Linear](https://linear.app), which is the world's most popular project management software, built their product on a sync-engine archicture. As a result, they've been able to run the whole of their European hosting on just two standard web servers. This has massively reduced their cloud bill.

<div class="embed-container">
  <YoutubeEmbed video-id="VLgmjzERT08" />
</div>

## Next steps

Get in touch if you're interested in switching to a sync engine architecture to reduce your cloud costs.

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="/about/contact"
        text="Contact us"
        theme="brand"
    />
  </div>
</div>
