---
title: HTTP API
description: >-
  The HTTP API is the primary, low level API for syncing data with Electric.
outline: deep
---

<script setup>
import InitialRequest from '/static/img/docs/api/http/initial-request.png?url'
import InitialRequestSm from '/static/img/docs/api/http/initial-request.sm.png?url'
import SubsequentRequest from '/static/img/docs/api/http/subsequent-request.png?url'
import SubsequentRequestSm from '/static/img/docs/api/http/subsequent-request.sm.png?url'
</script>

# HTTP API

The HTTP API is the primary, low level API for syncing data with Electric.

## HTTP API specification

API documentation is published as an [OpenAPI](https://www.openapis.org/what-is-openapi) specification:

- [download the specification file](https://github.com/electric-sql/electric/blob/main/website/electric-api.yaml) to view or use with other OpenAPI [tooling](https://tools.openapis.org/)
- <a href="/openapi.html" target="_blank">view the HTML documentation</a> generated using [Redocly](https://redocly.com)

The rest of this page will describe the features of the API.

<div class="tip custom-block">
  <p class="custom-block-no-title">💡 If you haven't already, you may like to walkthrough the <a href="/docs/quickstart">Quickstart</a> to get a feel for using the HTTP API.</p>
</div>

## Syncing shapes

The API allows you to sync [Shapes](/docs/guides/shapes) of data out of Postgres using the
<a href="/openapi.html#/paths/~1v1~1shape~1{table}/get"
    target="_blank">
  <code>GET /v1/shape</code></a> endpoint. The pattern is as follows.

First you make an initial sync request to get the current data for the Shape, such as:

```sh
curl -i 'http://localhost:3000/v1/shape?table=foo&offset=-1'
```

Then you switch into a live mode to use long-polling to receive real-time updates. We'll go over these steps in more detail below. First a note on the data that the endpoint returns.

### Shape Log

When you sync a shape from Electric, you get the data in the form of a log of logical database operations. This is the **Shape Log**.

The `offset` that you see in the messages and provide as the `?offset=...` query parameter in your request identifies a position in the log. The messages you see in the response are shape log entries (the ones with `value`s and `action` headers) and control messages (the ones with `control` headers).

The Shape Log is similar conceptually to the logical replication stream from Postgres. Except that instead of getting all the database operations, you're getting the ones that affect the data in your Shape. It's then the responsibility of the client to consume the log and materialize out the current value of the shape.

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

The values included in the shape log are strings formatted according to Postgres' display settings. The <a href="/openapi.html" target="_blank">OpenAPI specification</a> defines the display settings the HTTP API adheres to.

### Initial sync request

When you make an initial sync request, with `offset=-1`, you're telling the server that you want the whole log, from the start for a given shape.

When a shape is first requested, Electric queries Postgres for the data and populates the log by turning the query results into insert operations. This allows you to sync shapes without having to pre-define them. Electric then streams out the log data in the response.

Sometimes a log can fit in a single response. Sometimes it's too big and requires multiple requests. In this case, the first request will return a batch of data and an `electric-offset` header. An HTTP client should then continue to make requests setting the `offset` parameter to this header value. This allows the client to paginate through the shape log until it has received all of the current data.

### Control messages

The client will then receive an `up-to-date` control message at the end of the response data:

```json
{"headers": {"control": "up-to-date"}}
```

This indicates that the client has all the data that the server was aware of when fulfilling the request. The client can then switch into live mode to receive real-time updates.

::: info Must-refetch
Note that the other control message is `must-refetch` which indicates that the client must throw away their local shape data and re-sync from scratch:

```json
{"headers": {"control": "must-refetch"}}
```
:::

### Live mode

Once a client is up-to-date, it can switch to live mode to receive real-time updates, by making requests with `live=true`, an `offset` and a shape `handle`, e.g.:

```sh
curl -i 'http://localhost:3000/v1/shape?table=foo&live=true&handle=3833821-1721812114261&offset=0_0'
```

The `live` parameter puts the server into live mode, where it will hold open the connection, waiting for new data arrive. This allows you to implement a long-polling strategy to consume real-time updates.

The server holds open the request until either a timeout (returning `204 No content`) or when new data is available, which it sends back as the response. The client then reconnects and the server blocks again for new content. This way the client is always updated as soon as new data is available.

### Clients

The algorithm for consuming the HTTP API described above can be implemented from scratch for your application. Howerver, it's typically implemented by clients that can be re-used and provide a simpler interface for application code.

There are a number of existing clients, such as the [TypeScript](/docs/api/clients/typescript) and [Elixir](/docs/api/clients/elixir) clients. If one doesn't exist for your language or environment, we hope that the pattern is simple enough that you should be able to [write your own client](/docs/guides/writing-your-own-client) relatively easily.

## Caching

HTTP API responses contain cache headers, including `cache-control` with `max-age` and `stale-age` and `etag`. These work out-of-the-box with caching proxies, such as [Nginx](https://nginx.org/en), [Caddy](https://caddyserver.com) or [Varnish](https://varnish-cache.org), or a CDN like [Cloudflare](https://www.cloudflare.com/en-gb/application-services/products/cdn) or [Fastly](https://www.fastly.com/products/cdn).

There are three aspects to caching:

1. [accelerating initial sync](#accelerating-initial-sync)
2. [caching in the browser](#caching-in-the-browser)
3. [collapsing live requests](#collapsing-live-requests)

### Accelerating initial sync

When a client makes a `GET` request to fetch shape data at a given `offset`, the response can be cached. Subsequent clients requesting the same data can be served from the proxy or CDN. This removes load from Electric (and from Postrgres) and allows data to be served extremely quickly, at the edge by an optimised CDN.

You can see an example Nginx config at [packages/sync-service/dev/nginx.conf](https://github.com/electric-sql/electric/blob/main/packages/sync-service/dev/nginx.conf):

<<< @../../packages/sync-service/dev/nginx.conf{nginx}

### Caching in the browser

Requests are also designed to be cached by the browser. This allows apps to cache and avoid re-fetching data.

For example, say a page loads data by syncing a shape.

<figure>
  <a :href="InitialRequest" class="hidden-sm">
    <img :src="InitialRequest"
        alt="Console showing initial request loading from the network"
    />
  </a>
  <a :href="InitialRequest" class="block-sm">
    <img :src="InitialRequestSm"
        alt="Console showing initial request loading from the network"
    />
  </a>
</figure>

The next time the user navigates to the same page, the data is in the browser file cache.

<figure>
  <a :href="SubsequentRequest" class="hidden-sm">
    <img :src="SubsequentRequest"
        alt="Console showing subsequent requests loading from the browser's file cache"
    />
  </a>
  <a :href="SubsequentRequest" class="block-sm">
    <img :src="SubsequentRequestSm"
        alt="Console showing subsequent requests loading from the browser's file cache"
    />
  </a>
</figure>

This can make data access instant and available offline, even without using a persistent local store.

### Collapsing live requests

Once a client has requested the initial data for a shape, it switches into [live mode](#live-mode), using long polling to wait for new data. When new data arrives, the client reconnects to wait for more data, and so on.

Most caching proxies and CDNs support a feature called [request collapsing](https://info.varnish-software.com/blog/two-minutes-tech-tuesdays-request-coalescing) (sometimes also called request coalescing). This identifies requests to the same resource, queues them on a waiting list, and only sends a single request to the origin.

<div style="width: 100%; max-width: 512px">
  <div class="embed-container">
    <YoutubeEmbed video-id="9G9ipVQCZ9w" />
  </div>
</div>

Electric takes advantage of this to optimise realtime delivery to large numbers of concurrent clients. Instead of Electric holding open a connection per client, this is handled at the CDN level and allows us to coalesce concurrent long-polling requests in live mode.

This is how Electric can support millions of concurrent clients with minimal load on the sync service and no load on the source Postgres.
