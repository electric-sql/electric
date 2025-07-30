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

Your sync layer just has to work. It's a load-bearing black box that drives critical data flows and people rightfully have db-level expectations for.

We look to tools like S3 and Redis for inspiration.

S3 is a pretty simple idea. Read and write files in the cloud. Yet they made it extrodinary by delivering on the 11 9s promise and scaling it to essentially infinite capacity.

Redis is also pretty simple - a networked data structures server. But by scaling it huge numbers of reads and writes, it's essential glue in almost every backend.

Postgres-native sync is a pretty simple idea. Any write to Postgres gets synced instantly to any number of subscribers. We're working to make it extraordinary by scaling it to huge numbers of subscribers, tx/sec, and S3/PG levels of reliability.

We want sync to be a magical black box like S3 and Redis so for four months we went heads‑down on the unglamorous work of reliability engineering chasing down every error on Electric Cloud & bug report from our users.

---

## What we shipped (and why it matters)

| Theme                                          | Representative PRs        | What it fixes in the real world                                                                                                     |
| ---------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **1. Hardening the replication engine**        | [`#2880`](https://github.com/electric-sql/electric/pull/2880), [`#2878`](https://github.com/electric-sql/electric/pull/2878), [`#2866`](https://github.com/electric-sql/electric/pull/2866) | Failed TCP handshakes no longer cascade into full‑process restarts; lock connections auto‑resurrect.                                |
| **2. Graceful degradation & self‑healing**     | [`#2840`](https://github.com/electric-sql/electric/pull/2840), [`#2881`](https://github.com/electric-sql/electric/pull/2881)          | High replication traffic no longer stalls shape restoration; TCP send timeouts are now tunable per deployment.                      |
| **3. Observability** | [`#2854`](https://github.com/electric-sql/electric/pull/2854), [`#2839`](https://github.com/electric-sql/electric/pull/2839), [`#2856`](https://github.com/electric-sql/electric/pull/2856) | Deep introspection on replication loop. |
| **4. Chaos & property‑based testing**          | [`#2859`](https://github.com/electric-sql/electric/pull/2859), [`#2852`](https://github.com/electric-sql/electric/pull/2852)          | Eliminated intermittent CI reds; shaped traffic replay now part of every PR run.                                                    |
| **5. Developer experience & guard‑rails**      | [`#2833`](https://github.com/electric-sql/electric/pull/2833)                   | Observer comes pre‑wired, so you can watch processes crash _before_ they reach production.                                          |
| **6. Security = reliability**                  | [`#2857`](https://github.com/electric-sql/electric/pull/2857), [`#2832`](https://github.com/electric-sql/electric/pull/2832)          | Latest Erlang/OTP & TLS cert checks plugged; keeps the supply chain tight.                                                          |
| **7. Operational excellence**                  | [`#2863`](https://github.com/electric-sql/electric/pull/2863), [`#2828`](https://github.com/electric-sql/electric/pull/2828)          | Sensible defaults for acceptor pools; Ecto field‑type parity stops surprising migrations.                                           |

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
