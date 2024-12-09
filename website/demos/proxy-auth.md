---
title: Proxy auth
description: >-
  Example showing how to authorize access to Electric using a proxy.
source_url: https://github.com/electric-sql/electric/tree/main/examples/proxy-auth
example: true
---

# {{ $frontmatter.title }}

{{ $frontmatter.description }}

<DemoCTAs :demo="$frontmatter" />

## Proxy auth with Electric

This example demonstrates authorizing access to the Electric HTTP API using a proxy. It implements the [proxy-auth](/docs/guides/auth#proxy-auth) pattern described in the [Auth](/docs/guides/auth) guide.

The main proxy code is in [`./app/shape-proxy/route.ts`](https://github.com/electric-sql/electric/blob/main/examples/proxy-auth/app/shape-proxy/route.ts):

<<< @../../examples/proxy-auth/app/shape-proxy/route.ts{typescript}

<DemoCTAs :demo="$frontmatter" />
