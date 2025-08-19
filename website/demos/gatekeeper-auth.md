---
title: Gatekeeper auth
description: >-
  Example of the gatekeeper pattern for API-based auth with Electric.
source_url: https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth
example: true
---

<script setup>
import GatekeeperFlow from '/static/img/docs/guides/auth/gatekeeper-flow.dark.png?url'
import GatekeeperFlowJPG from '/static/img/docs/guides/auth/gatekeeper-flow.jpg?url'
import { ref } from 'vue'

// Modal state
const isGatekeeperFlowModalOpen = ref(false)
</script>

# {{ $frontmatter.title }}

{{ $frontmatter.description }}

<DemoCTAs :demo="$frontmatter" />

## Gatekeeper auth with Electric

This example demonstrates a number of ways of implementing the [gatekeeper auth](/docs/guides/auth#gatekeeper-auth) pattern for [securing access](/docs/guides/auth) to the [Electric sync service](/product/electric).

The Gatekeeper pattern works as follows:

1. post to a gatekeeper endpoint in your API to generate a shape-scoped auth token
2. make shape requests to Electric via an authorising proxy that validates the auth token against the request parameters

<figure>
  <div class="clickable-image" @click="isGatekeeperFlowModalOpen = true">
    <img :src="GatekeeperFlow"
        alt="Illustration of the gatekeeper request flow"
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
:is-open="isGatekeeperFlowModalOpen"
:image-src="GatekeeperFlowJPG"
image-alt="Illustration of the gatekeeper request flow"
@close="isGatekeeperFlowModalOpen = false"
/>

The auth token should include a claim containing the shape definition. This allows the proxy to authorize the shape request by comparing the shape claim signed into the token with the [shape defined in the request parameters](/docs/quickstart#http-api).

This keeps your main auth logic:

- in your API (in the gatekeeper endpoint) where it's natural to do things like query the database and call external services
- running _once_ when generating a token, rather than on the "hot path" of every shape request in your authorising proxy

<DemoCTAs :demo="$frontmatter" />
