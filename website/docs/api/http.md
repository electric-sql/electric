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

:::warning Production Best Practice
While this page documents the HTTP API directly, **production applications should proxy Electric requests through your backend API** rather than exposing Electric directly to clients. This provides security, authorization, and a clean API interface. See the [authentication guide](/docs/guides/auth) for implementation details.
:::

## Syncing shapes

The API allows you to sync [Shapes](/docs/guides/shapes) of data out of Postgres using the
<a href="/openapi.html#/paths/~1v1~1shape/get"
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
        alt="Shape log flow diagram"
    />
  </a>
  <figcaption class="figure-caption text-end">
    Shape log flow diagram.
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
{ "headers": { "control": "up-to-date" } }
```

This indicates that the client has all the data that the server was aware of when fulfilling the request. The client can then switch into live mode to receive real-time updates.

::: info Must-refetch
Note that the other control message is `must-refetch` which indicates that the client must throw away their local shape data and re-sync from scratch:

```json
{ "headers": { "control": "must-refetch" } }
```

:::

::: info Snapshot-end
A third control message is `snapshot-end`, which marks the end of a subset snapshot request. This message includes PostgreSQL snapshot metadata that allows clients to determine which changes have been incorporated into the snapshot:

```json
{
  "headers": {
    "control": "snapshot-end",
    "xmin": "1234",
    "xmax": "1240",
    "xip_list": ["1235", "1237"]
  }
}
```

:::

### Live mode

Once a client is up-to-date, it can switch to live mode to receive real-time updates, by making requests with `live=true`, an `offset` and a shape `handle`, e.g.:

```sh
curl -i 'http://localhost:3000/v1/shape?table=foo&live=true&handle=3833821-1721812114261&offset=0_0'
```

The `live` parameter puts the server into live mode, where it will hold open the connection, waiting for new data arrive. This allows you to implement a long-polling strategy to consume real-time updates.

The server holds open the request until either a timeout (returning `200` with only an up-to-date message) or when new data is available, which it sends back as the response. The client then reconnects and the server blocks again for new content. This way the client is always updated as soon as new data is available.

#### Server-Sent Events (SSE)

Electric also supports Server-Sent Events (SSE) as a more efficient alternative to long polling for live mode. SSE provides a persistent connection that allows the server to push updates to the client as they happen, reducing request overhead and latency.

To use SSE for live updates, add the `live_sse=true` parameter along with `live=true`:

```sh
curl -i 'http://localhost:3000/v1/shape?table=foo&live=true&live_sse=true&handle=3833821-1721812114261&offset=0_0'
```

**SSE Message Format**

When using SSE, messages are sent in the standard SSE format with `data:` prefixes:

```
data: {"headers":{"operation":"insert"},"key":"1","value":{"id":"1","title":"Hello"}}

data: {"headers":{"control":"up-to-date","global_last_seen_lsn":"0/1234567"}}

: keep-alive
```

The SSE stream includes:
- **Data messages**: Shape log entries in JSON format, prefixed with `data:`
- **Control messages**: Same format as long polling (up-to-date, must-refetch, etc.)
- **Keep-alive comments**: Sent as `: keep-alive` every 21 seconds to prevent connection timeout

**When to use SSE vs Long Polling**

SSE advantages:
- Fewer HTTP requests - the client doesn't need to reconnect after each message
- Lower latency for small messages arriving frequently (<100ms apart, such as token streaming)
- Reduced bandwidth (no request overhead per update)
- Server can efficiently batch updates

Long polling advantages:
- Works with more restrictive proxy configurations
- Better for environments with aggressive caching
- No persistent connection overhead

**Important: Proxy Configuration**

SSE requires that reverse proxies and CDNs support streaming responses without buffering. If your proxy buffers the complete response before sending it to the client, SSE connections will fail.

Common proxy configurations:
- **Nginx**: Add `proxy_buffering off;` for SSE endpoints
- **Caddy**: Add `flush_interval -1` to the reverse_proxy directive
- **Apache**: Ensure mod_proxy_http has `flushpackets=on`

The Electric TypeScript client automatically detects when SSE connections are being buffered (by checking if connections close immediately) and falls back to long polling after 3 consecutive quick-close attempts.

### Log modes

Electric supports two log modes for syncing shapes, controlled by the `log` query parameter:

#### Full mode (default)

When using `log=full` (the default), the server creates an initial snapshot of all data matching the shape definition and streams it to the client before delivering real-time updates. This is the standard mode where you get the complete current state followed by live changes.

#### Changes-only mode

When using `log=changes_only`, the server skips creating an initial snapshot. The client will only receive changes that occur after the shape is established, without seeing the base data. This mode is useful for:

- Places where historical data isn't needed
- Applications that fetch their initial state through other means
- Reducing initial sync time when you don't need historical data

In `changes_only` mode, you can use subset snapshots (see below) to fetch specific portions of data on-demand while tracking which changes to skip.

### Starting from 'now'

You can use `offset=now` to skip all historical data and receive an immediate up-to-date response with the latest continuation offset. This allows applications to start "from scratch" without processing historical data.

```sh
curl -i 'http://localhost:3000/v1/shape?table=foo&offset=now'
```

This is particularly useful when combined with `log=changes_only` mode and `replica=full` for applications that don't keep state and need to start fresh upon reload without historical data.

### Subset snapshots

When using `changes_only` mode, you can request subset snapshots to fetch specific portions of data on-demand.

#### Using POST (recommended)

**We strongly recommend using POST requests for subset snapshots.** POST requests send subset parameters in the request body as JSON, avoiding URL length limits that can occur with complex WHERE clauses or many parameters.

:::warning URL Length Limits
GET requests with subset parameters in the URL can fail with `414 Request-URI Too Long` errors when queries involve many parameters (e.g., `WHERE id = ANY($1)` with hundreds of IDs). This is a common issue with join queries that generate large filter lists. **Use POST to avoid this limitation.**

In Electric 2.0, GET requests for subset snapshots will be deprecated. Only POST will be supported.
:::

```sh
curl -i -X POST 'http://localhost:3000/v1/shape?table=foo&offset=123_4&handle=abc-123' \
  -H 'Content-Type: application/json' \
  -d '{
    "where": "priority = $1",
    "params": {"1": "high"},
    "order_by": "created_at",
    "limit": 10
  }'
```

The POST body accepts these parameters:

- `where` - WHERE clause to filter the subset
- `params` - Parameters for the WHERE clause as an object (e.g., `{"1":"value1","2":"value2"}` for `$1` and `$2`)
- `limit` - Maximum number of rows to return
- `offset` - Number of rows to skip (for pagination)
- `order_by` - ORDER BY clause (required when using limit/offset)

#### Using GET (legacy)

GET requests are still supported for backwards compatibility, using `subset__*` query parameters:

```sh
curl -i 'http://localhost:3000/v1/shape?table=foo&offset=123_4&handle=abc-123&subset__where=priority=high&subset__order_by=created_at&subset__limit=10'
```

The query parameters include:

- `subset__where` - Additional WHERE clause to filter the subset
- `subset__params` - Parameters for the subset WHERE clause as a JSON-encoded object (e.g., `{"1":"value1","2":"value2"}` for `$1` and `$2`)
- `subset__limit` - Maximum number of rows to return
- `subset__offset` - Number of rows to skip (for pagination)
- `subset__order_by` - ORDER BY clause (required when using limit/offset)

#### Response format

The response includes the requested data along with PostgreSQL snapshot metadata in a `snapshot-end` control message. This metadata allows clients to determine which subsequent changes have already been incorporated into the snapshot and should be skipped.

Response here has a different format from normal responses - instead of just an array of operations, we return an object with `data` and `metadata` keys, where `data` are insert
operations (it's up to the client to treat them as upserts if needed) and `metadata` tells
the client which transactions are part of the snapshot and thus must be skipped on the main shape stream.

The minimal request to get an equivalent of initial snapshot would be `where=TRUE` (POST) or `subset__where=TRUE` (GET)

### Clients

The algorithm for consuming the HTTP API described above can be implemented from scratch for your application. However, it's typically implemented by clients that can be re-used and provide a simpler interface for application code.

There are a number of existing clients, such as the [TypeScript](/docs/api/clients/typescript) and [Elixir](/docs/api/clients/elixir) clients. If one doesn't exist for your language or environment, we hope that the pattern is simple enough that you should be able to [write your own client](/docs/guides/client-development) relatively easily.

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
