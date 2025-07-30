---
title: 120 days of hardening – the post‑1.0 reliability sprint
description: >-
  When AWS launched S3 in 2006 they didn’t lead with features — they led with eleven nines.
  Our last quarter was our own “eleven‑nine sprint.” We set one goal: make ElectricSQL so boring‑reliable that you stop thinking about it and just build.
excerpt: >-
  When AWS launched S3 in 2006 they didn’t lead with features — they led with eleven nines.
  Our last quarter was our own “eleven‑nine sprint.” We set one goal: make ElectricSQL so boring‑reliable that you stop thinking about it and just build.
authors: [kyle]
tags: [product, engineering]
outline: deep
post: true
---

When AWS launched S3 in 2006 they didn’t lead with features — they led with eleven nines.

Our last quarter was our own “eleven‑nine sprint.” We set one goal: make ElectricSQL so boring‑reliable that you stop thinking about it and just build.

## Infrastructure software can't have bugs

Electric is a Postgres-native, CDN-powered sync engine. We power the sync layer for companies all around the world.

Your sync layer just has to work. It's a load-bearing black box that drives critical data flows and people rightfully have db-level expectations for.

We look to tools like S3 and Redis for inspiration.

S3 is a pretty simple idea. Read and write files in the cloud. Yet they made it extrodinary by delivering on the 11 9s promise and scaling it to essentially infinite capacity.

Redis is also pretty simple - a networked data structures server. Yet they made it extraordinary by scaling it huge numbers of reads and writes.

Postgres-native sync is a pretty simple idea. Any write to Postgres gets synced instantly to any number of subscribers. We're working to make it extraordinary by scaling it to huge numbers of subscribers, tx/sec, and S3/PG levels of reliability.

So we hit pause post v1 on feature work to fully focus on reliability for a quarter. Our bet: sacrifice a quarter of roadmap velocity to buy years of trust.

We want sync to be a magical black box so for the next four months we went heads‑down on the unglamorous work of reliability engineering.

**TL;DR**

- **60‑plus pull requests** merged between **17 March → 14 July**
- Connection failures cut by an order of magnitude on our largest production tenant
- Replication engine now passes **100 % of Postgres expression tests** (including PG 14 edge‑cases)

---

## What we shipped (and why it matters)

| Theme                                          | Representative PRs        | What it fixes in the real world                                                                                                     |
| ---------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **1. Hardening the replication engine**        | `#2880`, `#2878`, `#2866` | Failed TCP handshakes no longer cascade into full‑process restarts; lock connections auto‑resurrect.                                |
| **2. Graceful degradation & self‑healing**     | `#2840`, `#2881`          | High replication traffic no longer stalls shape restoration; TCP send timeouts are now tunable per deployment.                      |
| **3. Observability that predicts, not reacts** | `#2854`, `#2839`, `#2856` | Millisecond‑level timing on replication loop + experimental live‑mode SSE streaming make “black‑box” debugging a thing of the past. |
| **4. Chaos & property‑based testing**          | `#2859`, `#2852`          | Eliminated intermittent CI reds; shaped traffic replay now part of every PR run.                                                    |
| **5. Developer experience & guard‑rails**      | `#2833`                   | Observer comes pre‑wired, so you can watch processes crash _before_ they reach production.                                          |
| **6. Security = reliability**                  | `#2857`, `#2832`          | Latest Erlang/OTP & TLS cert checks plugged; keeps the supply chain tight.                                                          |
| **7. Operational excellence**                  | `#2863`, `#2828`          | Sensible defaults for acceptor pools; Ecto field‑type parity stops surprising migrations.                                           |

---

## Deep‑dive: three bugs we never want to see again

### The zombie lock connection

Under heavy failover tests the lock process would die quietly, leaving child processes hanging. `#2866` forces a brutal kill‑and‑respawn, shrinking median recovery from **18 s → 1.2 s**.

### The missing `NULL`

A single `NULL` byte in a string clobbered TypeScript clients (`#2882`). Now parsed correctly, saving hours of “ghost” debugging on the front‑end.

### The race that ate your updates

Sync loop could load a shape while still wiring change‑listeners (`#2848`). Rare in dev, catastrophic in prod. We now buffer and replay SSE messages until the listener is live, guaranteeing no data loss.

---

## Reliability debt paid

- **Connection resilience** is no longer our top support ticket.
- **Postgres fidelity** (clause parsing, TRUNCATE decoding, publication diffs) means fewer “but it works in psql” surprises.
