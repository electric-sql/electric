---
title: Proxy costs - Guide
description: >-
  Understanding and reducing the cost of proxying Electric sync requests.
outline: [2, 3]
---

# Proxy costs

How to understand and reduce the cost of proxying requests between your clients and Electric.

## How Electric sync generates requests

Electric uses [long polling](/docs/api/http#live-mode) (or [SSE](/docs/api/http#server-sent-events-sse)) to keep clients in sync with your Postgres database. Understanding the request pattern is key to managing costs.

### The long-polling request cycle

When a client subscribes to a [Shape](/docs/guides/shapes), it:

1. makes an **initial sync** request to fetch the current data (which may be cached)
2. switches into **live mode**, making long-poll requests that the server holds open until new data arrives or a timeout expires
3. when the long-poll returns, the client **immediately reconnects** with a new request

This means that **every connected client generates a steady stream of HTTP requests**, even when no data is changing. The request rate per shape subscription is:

```
requests_per_second = 1 / long_poll_timeout_seconds
```

With the default 20-second long-poll timeout:

```
1 request / 20 seconds = 3 requests/minute per shape per client
```

### Scaling math

The total request rate is:

```
total_requests_per_second = concurrent_users × shapes_per_user / long_poll_timeout
```

For example, with 1,000 concurrent users, each subscribing to 15 shapes, with a 20-second timeout:

```
1,000 × 15 / 20 = 750 requests/second
```

Over a month (30 days):

```
750 × 86,400 × 30 = ~1.94 billion requests/month
```

On a **serverless platform** like Cloudflare Workers (at [$0.30 per million requests](https://developers.cloudflare.com/workers/platform/pricing/)), that's roughly **$580/month just in request costs** — before accounting for CPU time or origin subrequests.

> [!WARNING] Serverless is easy but not always cheap
> Serverless platforms like Cloudflare Workers, Vercel Functions and AWS Lambda are easy to set up but charge per-request. They were designed for short-lived request-response cycles, not for holding thousands of long-polling connections. The steady request volume from long polling can add up fast.
>
> A **dedicated server or VM** is often dramatically cheaper for this workload. See [Use a server instead of serverless](#use-a-server-instead-of-serverless) below.

## Strategies for reducing costs

### Increase the long-poll timeout

The single most impactful change you can make. Increasing the timeout directly reduces the request rate. For example, going from 20 seconds to 40 seconds cuts requests in half:

```
1,000 users × 15 shapes / 40s = 375 req/s  (vs 750 req/s at 20s)
```

The default long-poll timeout in the open source Electric sync service is 20 seconds. [Electric Cloud](https://electric-sql.com/product/cloud) uses 40 seconds. If you're self-hosting, you can change the `long_poll_timeout` in your Electric configuration.

### Pause syncing when the app is inactive

If a user isn't actively looking at your app, there's no reason to keep polling. Use the [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) to pause shape subscriptions when the browser tab is in the background:

```ts
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Pause or disconnect shape subscriptions
  } else {
    // Resume shape subscriptions
  }
})
```

For many apps, users are actively using the tab only a fraction of the day. Even for heavy-use apps like IDEs where users are active 8+ hours, pausing overnight and during breaks can cut request volume by 50% or more.

### Use a server instead of serverless

Serverless platforms charge per request. Long-polling workloads generate a high volume of requests that are mostly idle (waiting for data). A dedicated server handles this much more efficiently.

A **$5–10/month VM** running [Caddy](https://caddyserver.com), [Nginx](https://nginx.org), or a simple Node.js/Bun proxy can handle the same workload that costs hundreds of dollars on serverless:

| Approach | ~Cost for 1k users, 15 shapes |
| --- | --- |
| Cloudflare Workers | ~$600/month |
| Vercel Functions | Higher (shorter timeouts, more reconnects) |
| Caddy on a $5 VM | ~$5/month |
| Node.js on a $10 VM | ~$10/month |

Servers excel at holding many concurrent connections open with minimal resource usage. A single VM can comfortably hold tens of thousands of concurrent long-poll connections.

See the [Deployment guide](/docs/guides/deployment) for more on running Electric with a caching proxy.

### Reduce the number of shape subscriptions

Each shape subscription generates its own stream of long-poll requests. Fewer shapes means proportionally fewer requests.

Strategies:
- **Combine related data** into fewer, broader shapes where possible
- **Subscribe to shapes on demand** — only subscribe to shapes for data the user is currently viewing, and unsubscribe when they navigate away
- **Use `columns`** to select only the columns you need, which can make broader shapes practical without transferring excess data

### Use SSE instead of long polling

[Server-Sent Events (SSE)](/docs/api/http#server-sent-events-sse) maintains a persistent connection instead of reconnecting on every timeout. This eliminates the per-timeout request overhead entirely. The SSE connection stays open for its timeout duration (default 60 seconds), during which the server pushes updates as they arrive — no reconnect needed.

Enable SSE by using the `live_sse=true` parameter. Note that SSE requires your proxy to support streaming responses without buffering — see the [SSE proxy configuration](/docs/api/http#server-sent-events-sse) docs.

> [!TIP] SSE works best with servers
> SSE holds a persistent connection open, which is a natural fit for server-based proxies. On serverless platforms, SSE connections may be terminated by platform timeout limits, reducing the benefit.

### Take advantage of CDN caching

While live-mode long-poll requests aren't typically cache hits (since they're waiting for new data), **initial sync requests** can be cached very effectively.

If many clients subscribe to the same shape, a CDN can serve the initial data from cache, avoiding repeated requests to your Electric origin. This is especially valuable for shapes that represent shared, read-heavy data.

See the [Caching section](/docs/api/http#caching) of the HTTP API docs for details on how Electric's cache headers work with CDNs.

### Don't expect high cache-hit rates on live requests

A common misconception is that putting Electric behind a CDN should yield near-100% cache-hit rates. In practice, **live-mode requests are usually cache misses** because each request is waiting for *new* data. Cache-hit rates of 10–20% on overall traffic are normal when most requests are live-mode long polls.

High cache-hit rates happen when:
- Many clients request the **same shape's initial sync** data
- You have popular, slowly-changing shapes where [request collapsing](/docs/api/http#collapsing-live-requests) can help

The primary value of a CDN with Electric is **accelerating initial sync** and **request collapsing**, not caching live-mode responses.

## Cost comparison summary

Here's a rough comparison for 1,000 concurrent users subscribing to 15 shapes each:

| Strategy | Monthly request volume | Estimated proxy cost |
| --- | --- | --- |
| **Baseline** (serverless, 20s timeout) | ~1.94B requests | ~$600 |
| **Increase timeout to 40s** | ~972M requests | ~$290 |
| **+ Pause when inactive** (50% reduction) | ~486M requests | ~$145 |
| **+ Reduce shapes** (15 → 5) | ~162M requests | ~$50 |
| **Switch to a VM** (any of the above) | Same volume | **$5–10 flat** |

The cheapest path is almost always: **use a server, increase the timeout, and pause when inactive**.
