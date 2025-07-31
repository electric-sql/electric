---
title: 120 days of hardening – the post‑1.0 reliability sprint
description: >-
  When AWS launched S3 in 2006 they didn’t lead with features — they led with eleven nines.
  Our last quarter was our own “eleven‑nine sprint.” We set one goal: make ElectricSQL so boring‑reliable that you stop thinking about it and just build.
excerpt: >-
  When AWS launched S3 in 2006 they didn’t lead with features — they led with eleven nines.
  Our last quarter was our own “eleven‑nine sprint.” We set one goal: make ElectricSQL so boring‑reliable that you stop thinking about it and just build.
authors: [kyle]
image: /img/blog/reliability-sprint/header.png
tags: [product, engineering]
outline: deep
post: true
---

When AWS launched S3 in 2006 they didn’t lead with features — they led with eleven nines.

Our last quarter was our own “eleven‑nine sprint.” We set one goal: make ElectricSQL so boring‑reliable that you stop thinking about it and just build.

Everyone says "use boring software". How do you become said boring software? As it turns out, lots of unglamorous work.

## Infrastructure software can't have bugs

Electric is a Postgres-native, CDN-powered sync engine. We power the sync layer for companies all around the world.

Your sync layer just has to work. It's load-bearing infrastructure that drives critical data flows and people rightfully have db-level expectations for.

We look to tools like S3 and Redis for inspiration.

S3 is a pretty simple idea. Read and write files in the cloud. Yet they made it extrodinary by delivering on the 11 9s promise and scaling it to essentially infinite capacity.

Redis is also pretty simple - a networked data structures server. But by scaling it huge numbers of reads and writes, it's essential glue in almost every backend.

Postgres-native sync is a pretty simple idea. Any write to Postgres gets synced instantly to any number of subscribers. We're working to make it extraordinary by scaling it to huge numbers of subscribers, tx/sec, and S3/PG levels of reliability.

We want sync to be magical infrastructure like S3 and Redis so for four months we went heads‑down on the unglamorous work of reliability engineering chasing down every error on Electric Cloud & bug report from our users.

## How Electric achieves reliability

Electric's architecture is designed around proven patterns for building reliable real-time systems. Companies like [Trigger.dev have achieved](https://trigger.dev/blog/how-we-built-realtime) 20,000 updates per second and sub-100ms latency using Electric.

### The foundation: Postgres + HTTP
Electric captures changes from Postgres via logical replication and streams them to clients over HTTP + JSON. This gives us:
- **Strong consistency** from Postgres's ACID guarantees
- **Universal compatibility** through standard HTTP/JSON
- **Observable traffic** you can debug with curl and browser dev tools

### The reliability stack
1. **Replication resilience**: Connection pooling, automatic reconnection, and WAL position tracking ensure we never lose data
2. **Backpressure handling**: High-traffic shapes don't block other operations; the system degrades gracefully under load  
3. **Rate limiting**: Protects against resource exhaustion
4. **Caching layers**: Multi-tier caching (CDN, Nginx, disk) reduces database load
5. **Observability**: Deep instrumentation exposes exactly what's happening when things go wrong

The result is a system that handles 500GB+ of daily Postgres traffic while maintaining sub-100ms update latency. Our [Electric Cloud](https://electric-sql.com/product/cloud) syncs data to devices in 100+ countries every month—the kind of boring reliability that lets you focus on building features, not debugging sync issues.

---

## What we shipped (and why it matters)

### 1. Hardening the replication engine
**PRs:** [`#2880`](https://github.com/electric-sql/electric/pull/2880), [`#2878`](https://github.com/electric-sql/electric/pull/2878), [`#2866`](https://github.com/electric-sql/electric/pull/2866)  
**Impact:** Failed TCP handshakes no longer cascade into full‑process restarts; lock connections auto‑resurrect.

### 2. Graceful degradation & self‑healing
**PRs:** [`#2840`](https://github.com/electric-sql/electric/pull/2840), [`#2881`](https://github.com/electric-sql/electric/pull/2881)  
**Impact:** High replication traffic no longer stalls shape restoration; TCP send timeouts are now tunable per deployment.

### 3. Observability
**PRs:** [`#2854`](https://github.com/electric-sql/electric/pull/2854), [`#2839`](https://github.com/electric-sql/electric/pull/2839), [`#2856`](https://github.com/electric-sql/electric/pull/2856)  
**Impact:** Deep introspection on replication loop.

### 4. Chaos & property‑based testing
**PRs:** [`#2859`](https://github.com/electric-sql/electric/pull/2859), [`#2852`](https://github.com/electric-sql/electric/pull/2852)  
**Impact:** Eliminated intermittent CI reds; shaped traffic replay now part of every PR run.

### 5. Developer experience & guard‑rails
**PRs:** [`#2833`](https://github.com/electric-sql/electric/pull/2833)  
**Impact:** Observer comes pre‑wired, so you can watch processes crash _before_ they reach production.

### 6. Security = reliability
**PRs:** [`#2857`](https://github.com/electric-sql/electric/pull/2857), [`#2832`](https://github.com/electric-sql/electric/pull/2832)  
**Impact:** Latest Erlang/OTP & TLS cert checks plugged; keeps the supply chain tight.

### 7. Operational excellence
**PRs:** [`#2863`](https://github.com/electric-sql/electric/pull/2863), [`#2828`](https://github.com/electric-sql/electric/pull/2828)  
**Impact:** Sensible defaults for acceptor pools; Ecto field‑type parity stops surprising migrations.

---

## Deep‑dive: three bugs we never want to see again

### The zombie lock connection

Under heavy failover tests the lock process would die quietly, leaving child processes hanging. [`#2866`](https://github.com/electric-sql/electric/pull/2866) forces a brutal kill‑and‑respawn, shrinking median recovery from **18 s → 1.2 s**.

### The missing `NULL`

A single `NULL` byte in a string clobbered TypeScript clients ([`#2882`](https://github.com/electric-sql/electric/pull/2882)). Now parsed correctly, saving hours of “ghost” debugging on the front‑end.

### The race that ate your updates

Sync loop could load a shape while still wiring change‑listeners ([`#2848`](https://github.com/electric-sql/electric/pull/2848)). Rare in dev, catastrophic in prod. We now buffer and replay SSE messages until the listener is live, guaranteeing no data loss.

---

## Reliability is never done

Electric has a zero-bug policy. Our first priority is reliability, then features.

So see something odd or unexpected? Please [file an issue](https://github.com/electric-sql/electric/) or [chat with us over on Discord](https://discord.electric-sql.com/).
