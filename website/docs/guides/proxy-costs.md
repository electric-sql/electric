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

With the default 40-second long-poll timeout:

```
1 request / 40 seconds = 1.5 requests/minute per shape per client
```

### Scaling math

The total request rate is:

```
total_requests_per_second = concurrent_users × shapes_per_user / long_poll_timeout
```

For example, with 1,000 concurrent users, each subscribing to 15 shapes, with the default 40-second timeout:

```
1,000 × 15 / 40 = 375 requests/second
```

Over a month (30 days):

```
375 × 86,400 × 30 = ~972 million requests/month
```

On a **serverless platform** like Cloudflare Workers (at [$0.30 per million requests](https://developers.cloudflare.com/workers/platform/pricing/)), that's roughly **$290/month just in request costs** — before accounting for CPU time or origin subrequests.

> [!WARNING] Serverless is easy but not always cheap
> Serverless platforms like Cloudflare Workers, Vercel Functions and AWS Lambda are easy to set up but charge per-request. They were designed for short-lived request-response cycles, not for holding thousands of long-polling connections. The steady request volume from long polling can add up fast.
>
> A **dedicated server or VM** is often dramatically cheaper for this workload.

## Strategies for reducing costs

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

### Don't expect high cache-hit rates on live requests

A common misconception is that putting Electric behind a CDN should yield near-100% cache-hit rates. In practice, **live-mode requests are usually cache misses** because each request is waiting for *new* data. Cache-hit rates of 10–20% on overall traffic are normal when most requests are live-mode long polls.

High cache-hit rates happen when:
- Many clients request the **same shape's initial sync** data
- You have popular, slowly-changing shapes where [request collapsing](/docs/api/http#collapsing-live-requests) can help

The primary value of a CDN with Electric is **accelerating initial sync** and **request collapsing**, not caching live-mode responses.

## Cost comparison summary

Here's a rough comparison for 1,000 concurrent users subscribing to 15 shapes each (with the default 40-second timeout):

| Strategy | Monthly request volume | Estimated proxy cost |
| --- | --- | --- |
| **Baseline** (serverless, 40s timeout) | ~972M requests | ~$290 |
| **Switch to a VM** | Same volume | **$5–10 flat** |

The cheapest path is almost always: **use a server instead of serverless**.
