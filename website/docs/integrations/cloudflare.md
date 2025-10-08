---
outline: deep
title: Cloudflare - Integrations
description: >-
  How to use Electric with Cloudflare.
image: /img/integrations/electric-cloudflare.jpg
---

<img src="/img/integrations/cloudflare.svg" class="product-icon" />

# Cloudflare

Cloudflare is a global network and edge-cloud platform.

## Electric and Cloudflare

You can use Cloudflare [as a CDN](#cdn) in front of Electric and as a sync target to sync data into Cloudflare primitives including [Workers](#workers) and [Durable Objects](#durable-objects).

> [!Tip] Need context?
> See the [Deployment guide](/docs/guides/deployment) for more details.

### CDN

Cloudflare provides a [global content delivery network](https://developers.cloudflare.com/cache/get-started/).

[This guide](https://loadforge.com/guides/steps-to-set-up-cloudflare-cdn-for-your-website) walks through the process of using it. Basically you need to create a DNS rule resolving to the Electric service and enable Cloudflare as a proxy for it.

Electric's [HTTP API caching](/docs/api/http#caching) will work out of the box.

### Workers

You can also use [Cloudflare Workers](https://workers.cloudflare.com) in front of the CDN to handle concerns like authorization and routing.

#### Auth example

For example, you could validate an auth token to protect access to a shape and then proxy the request through to Electric:

```ts
export default {
  async fetch(request): Promise<Response> {
    const ELECTRIC_URL = "https://my-electric.example.com"

    const headers = request.headers
    const authHeader = request.headers.get("Authorization")
    const isValid = (header) => {
      /* ... e.g.: verify JWT ... */
    }
    if (!isValid(authHeader)) {
      return new Response("Forbidden", { status: 403 })
    }

    if (request.method != `GET`) {
      return new Response("Method Not Allowed", { status: 405 })
    }

    const url = new URL(request.url)
    const shapeUrl = `${ELECTRIC_URL}${url.pathname}${url.search}`
    const clonedHeaders = new Headers(new Request(request).headers)

    return await fetch(shapeUrl, {
      headers: clonedHeaders,
      cf: { cacheEverything: true },
    })
  },
} satisfies ExportedHandler
```

#### Syncing data into the worker

Or you can use Electric to hydrate data quickly into an edge worker. For example, you could sync data into an edge worker to dynamically redirect the request:

```ts
import { ShapeStream, Shape } from "@electric-sql/client"

export default {
  async fetch(request): Promise<Response> {
    const ELECTRIC_URL = "https://my-electric.example.com"

    const stream = new ShapeStream({
      url: `${ELECTRIC_URL}/v1/shape`,
      params: {
        table: "routes",
      },
    })
    const shape = new Shape(stream)
    const routes = await shape.value

    const url = new URL(request.url)
    const match = routes.find((x) => x.path == url.pathname)

    if (!match) {
      return new Response("Not Found", { status: 404 })
    }

    return Response.redirect(match.redirect, 301)
  },
} satisfies ExportedHandler
```

### Durable Objects

You can implement a similar pattern to the [sync example above](#syncing-data-into-the-worker) to sync data into a Durable Object.

The key difference is that with a [Durable Object](https://developers.cloudflare.com/durable-objects/), the data can be persisted across requests. This allows you to sync a shape log into the Durable Object, materialise the shape into persistent storage and then re-sync the latest changes whenever the Durable Object is accessed.

You can see a demo of this pattern, using SQLite to persist the Shape data, at [KyleAMathews/electric-demo-cloudflare-sqlite](https://github.com/KyleAMathews/electric-demo-cloudflare-sqlite):

<Tweet tweet-id="1841180640970228197"
    align="center"
    conversation="none"
    theme="dark"
/>

> [!Tip] Combining CDN and Durable Objects
> Note that if you sync data into a Durable Object (or a Worker) [from Cloudflare's CDN](#cdn) it can be _extremely fast_ &mdash; with high bandwidth and low network latency.

<HelpWanted issue="1884">
  example apps using Cloudflare and/or wrap up the code samples above into a library.
</HelpWanted>
