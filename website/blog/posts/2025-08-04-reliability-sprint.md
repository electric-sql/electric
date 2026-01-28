---
title: 120 days of hardening – the post‑1.0 reliability sprint
description: >-
  Our last quarter was a reliability sprint. We set one goal: make ElectricSQL so boring‑reliable that you stop thinking about it and just build.
excerpt: >-
  Our last quarter was a reliability sprint. We set one goal: make ElectricSQL so boring‑reliable that you stop thinking about it and just build.
authors: [kyle]
image: /img/blog/reliability-sprint/header.png
tags: [product, engineering, postgres-sync]
outline: deep
post: true
---

When AWS launched S3 in 2006 they didn’t lead with features — they led with eleven nines.

Our last quarter was our own “eleven‑nine sprint.” We set one goal: make ElectricSQL so boring‑reliable that you stop thinking about it and just build.

Everyone says "use boring software". How do you become _the_ "boring software"? As it turns out, through lots of unglamorous work.

## Infrastructure software can't have bugs

Electric is a Postgres-native, CDN-powered sync engine. We power the sync layer for companies all around the world.

Your sync layer just has to work. It's load-bearing infrastructure that drives critical data flows and people rightfully have database-level expectations for it.

We look to tools like S3 and Redis for inspiration.

S3 is a pretty simple idea. Read and write files in the cloud. Yet they made it extraordinary by delivering on the 11 9s promise and scaling it to essentially infinite capacity.

Redis is just a networked data structures server. But by scaling it hundreds of thousands of read/writes per second, it's essential glue in almost every backend.

Postgres-native sync only becomes extraordinary when scaled to huge numbers of subscribers, transactions/sec, and S3/PG levels of reliability.

We want sync to be magical infrastructure like S3 and Redis so for four months we went heads‑down on the unglamorous work of reliability engineering chasing every incident on Electric Cloud & every user-reported bug.

## How Electric achieves reliability

Companies like [Trigger.dev have achieved](https://trigger.dev/blog/how-we-built-realtime) 20,000 updates per second and sub-100ms latency using Electric.

### The foundation: Postgres + HTTP

Electric captures changes from Postgres via logical replication and streams them to clients over HTTP + JSON. This gives us:

- **Strong consistency** from Postgres's ACID guarantees
- **Universal compatibility** through standard HTTP/JSON
- **Observable traffic** you can debug with curl and browser dev tools

### The reliability stack

1. **Replication resilience**: Connection pooling, automatic reconnection, and WAL position tracking ensure we never lose data
2. **Backpressure handling**: High-traffic [shapes](/docs/guides/shapes) requests don't block DB operations; the system degrades gracefully under load
3. **Caching layers**: Multi-tier caching (CDN, Nginx, disk) reduces database load
4. **Observability**: Deep instrumentation exposes exactly what's happening when things go wrong

The result is a system that handles 500GB+ of daily Postgres traffic while maintaining sub-100ms update latency. Our [Electric Cloud](/cloud) syncs data to devices in over 100 countries every month.

---

## What we shipped (and why it matters)

Here's how we made Electric (almost) boring.

### 1. Connection resilience & recovery

Electric now handles network failures gracefully:

- **IPv6 → IPv4 fallback** ([`#2753`](https://github.com/electric-sql/electric/pull/2753)): If IPv6 fails, we automatically retry on IPv4
- **Advisory lock isolation** ([`#2682`](https://github.com/electric-sql/electric/pull/2682)): Dedicated connection prevents pool exhaustion deadlocks
- **WAL slot recovery** ([`#2651`](https://github.com/electric-sql/electric/pull/2651)): If a slot falls too far behind, Electric recovers instead of halting
- **Clear error messages** ([`#2654`](https://github.com/electric-sql/electric/pull/2654)): "Unable to connect to Postgres" instead of stack traces
- Under heavy failover tests the lock process would die quietly, leaving child processes hanging. [`#2866`](https://github.com/electric-sql/electric/pull/2866) forces a brutal kill‑and‑respawn, shrinking median recovery from **18 s → 1.2 s**.

### 2. Live schema changes

Electric adapts to your evolving database:
**The silent schema drift:** New tables could appear without Electric noticing, breaking shapes. Now we auto-refresh metadata when unknown relations appear ([`#2510`](https://github.com/electric-sql/electric/pull/2510)).

- **Publication changes** ([`#2634`](https://github.com/electric-sql/electric/pull/2634)): Detects and adapts when publications are altered externally
- **Generated columns blocked** ([`#2507`](https://github.com/electric-sql/electric/pull/2507)): Prevents including computed columns that would break replication
- **Backward compatibility** ([`#2487`](https://github.com/electric-sql/electric/pull/2487)): Old shape queries continue working after upgrades

### 3. Zero-downtime operations

Your clients stay connected through restarts:

- **Seamless restart handling** ([`#2624`](https://github.com/electric-sql/electric/pull/2624)): Long-poll requests survive Electric restarts
- **Shape cache timeouts** ([`#2575`](https://github.com/electric-sql/electric/pull/2575)): Individual shapes timeout independently, preventing one slow shape from blocking others
- **HTTP 409 for refetch** ([`#2476`](https://github.com/electric-sql/electric/pull/2476)): Clear signal to clients when they need to refetch shapes
- **The startup race:** Replication could start processing before fully initialized, causing sporadic failures. Now initialization is properly synchronized ([`#2576`](https://github.com/electric-sql/electric/pull/2576), [`#2531`](https://github.com/electric-sql/electric/pull/2531)).

### 4. Improved Observability

Better visibility into what Electric is doing:

- **Process labels** ([`#2592`](https://github.com/electric-sql/electric/pull/2592)): See "ReplicationClient" instead of anonymous PIDs in Observer
- **Stack events** ([`#2637`](https://github.com/electric-sql/electric/pull/2637)): Connection blocks and backpressure now emit observable events
- **Telemetry fixes** ([`#2535`](https://github.com/electric-sql/electric/pull/2535), [`#2555`](https://github.com/electric-sql/electric/pull/2555)): Dead processes no longer crash metrics collection
- **Selective logging** ([`#2684`](https://github.com/electric-sql/electric/pull/2684)): Only log real problems, not routine retries

### 5. Memory & resource management

Preventing resource exhaustion at scale:

- **LRU shape eviction** ([`#2514`](https://github.com/electric-sql/electric/pull/2514)): Inactive shapes automatically expire from memory
- **Non-GET cache bypass** ([`#2501`](https://github.com/electric-sql/electric/pull/2501)): Error responses (4xx/5xx) no longer pollute caches
- **The file handle leak:** Shape cleanup wasn't deleting orphaned handles, slowly exhausting resources. Fixed by ensuring complete cleanup ([`#2616`](https://github.com/electric-sql/electric/pull/2616)).
- **File cleanup retries** ([`#2662`](https://github.com/electric-sql/electric/pull/2662)): Race-free deletion of shape files

### 6. Replication robustness

Handling edge cases in Postgres replication:

- **WAL processing races** ([`#2470`](https://github.com/electric-sql/electric/pull/2470)): Fixed LSN persistence race conditions
- **Skip no-op updates** ([`#2499`](https://github.com/electric-sql/electric/pull/2499)): Don't sync updates that change nothing
- **Composite key updates** ([`#2638`](https://github.com/electric-sql/electric/pull/2638)): Fixed visibility of composite primary key changes
- **WAL monitor safety** ([`#2604`](https://github.com/electric-sql/electric/pull/2604), [`#2617`](https://github.com/electric-sql/electric/pull/2617)): Periodic checks can't crash Electric

---

## Reliability is never done

We've killed a huge number of bugs. But we're not done if something doesn't work right for you.

So see something odd or unexpected? Please [file an issue](https://github.com/electric-sql/electric/) or [chat with us over on Discord](https://discord.electric-sql.com/).

Thanks to everyone who filed issues - we've learned a lot with all of you.

P.S. We've learned some surprising things about performance along the way. Check back soon for some news about huge performance improvements.
