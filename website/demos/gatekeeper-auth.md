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
</script>

# {{ $frontmatter.title }}

{{ $frontmatter.description }}

<DemoCTAs :demo="$frontmatter" />

## Gatekeeper auth with Electric

This example demonstrates a number of ways of implementing the [gatekeeper auth](/docs/guides/auth#gatekeeper-auth) pattern for [securing access](/docs/guides/auth) to the [Electric sync service](/products/postgres-sync).

The Gatekeeper pattern works as follows:

1. post to a gatekeeper endpoint in your API to generate a shape-scoped auth token
2. make shape requests to Electric via an authorising proxy that validates the auth token against the request parameters

<figure>
  <a :href="GatekeeperFlowJPG" target="_blank">
    <img :src="GatekeeperFlow"
        alt="Illustration of the gatekeeper request flow"
    />
  </a>
</figure>

The auth token should include a claim containing the shape definition. This allows the proxy to authorize the shape request by comparing the shape claim signed into the token with the [shape defined in the request parameters](/docs/quickstart#http-api).

This keeps your main auth logic:

- in your API (in the gatekeeper endpoint) where it's natural to do things like query the database and call external services
- running _once_ when generating a token, rather than on the "hot path" of every shape request in your authorising proxy

<DemoCTAs :demo="$frontmatter" />
