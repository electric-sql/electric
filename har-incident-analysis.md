# HAR Incident Analysis — Autarc Staging (2026-02-23)

## Incident Summary

**Reported by:** Tomas Gonzalez
**Environment:** Autarc staging (`api3.staging.autarc.energy`)
**Proxy stack:** Fly.io → Cloudflare → Electric Cloud
**Protocol:** HTTP/2 between browser and proxy

**Symptom:** When a user applied a template to an offer (creating positions in `offer_items`), optimistic state was not applied. Data only appeared after page refresh. Eventually burst of 502 errors. Restarting the Electric source fixed it.

**HAR captured by:** Juan (attempting to reproduce — saw very slow behavior and eventual 502 burst)

---

## Key Findings

### 1. Redundant Initial Requests per Subset Filter

The client fires **10 separate initial GET requests** for the `offer_items` shape at page load — one per offer row visible on screen, each with a different `subset__params` filter:

```
#  Time         Status  Offset  Subset (offer_id)            Rows returned
0  15:15:32.687  200    now     791cb76c...                  3
1  15:15:32.688  200    now     da504255...                  7
2  15:15:32.688  200    now     0923907e...                  6
...
9  15:15:32.690  200    now     0cd62dec...                  3
```

**All 10 hit the same underlying Electric shape** (same handle `105664863-...`). The `subset__where` / `subset__params` are custom proxy URL params — **NOT** converted to Electric `where` clauses. Every request returns the **full unfiltered `offer_items` table** and the subset filtering happens client-side.

After the initial sync (10 initial + 10 follow-up = 20 GET requests), subscriptions consolidate into a **single `subset=none` live long-poll** stream. The same pattern applies to `offers` (multiple per-ID subset requests converging).

Total Electric GET requests: **227** (plus 197 CORS `OPTIONS` preflights, which are normal).

### 2. 502 Errors from Proxy Connection Resets

Six 502 errors occurred between 15:16:06 and 15:17:02 UTC, all with the same error:

```
Electric proxy error: read tcp [Fly.io IP]:50790->[Cloudflare IP]:443: read: connection reset by peer
```

Affected tables: `offer_footer_columns`, `housing_units`, `projects`, `valves`, `offers`, `tags`

These are TCP connection resets between the Fly.io proxy and Cloudflare. The requests that failed were all **live long-poll requests** that had been open for 40-60 seconds. This suggests either:
- Cloudflare idle connection timeout killing the long-held connection
- Proxy connection pool exhaustion under load
- Electric upstream instability

### 3. 26 Aborted Requests (Status 0)

26 GET requests were aborted by the browser (status 0). These include:
- Live long-poll requests cancelled when the subscription was replaced/torn down
- Requests cancelled during navigation or subscription lifecycle changes
- Some mid-flight requests that overlapped with newer requests for the same shape

### 4. Shape Invalidation (`must-refetch`) on offer_items

At **15:15:51 UTC**, the `offer_items` shape returned HTTP 409 with `must-refetch`. This was triggered by new subset subscriptions for just-created offers:

```
Request #21: subset={"1":"4b6d1d6b..."} (newly created offer) → 409 must-refetch
Request #22: subset={"1":"754f4f28..."} (another new offer)   → 409 must-refetch
```

```
Old handle: 105664863-1771655373716730
New handle: 105664863-1771859752105857
```

The client re-synced with the new handle. Recovery timeline:
1. 15:15:51 — 409 must-refetch received
2. 15:15:52 — Client starts refetching with new handle
3. 15:15:57 — Data starts arriving (3 offer_items rows from the template)
4. 15:16:12 — Shape reaches `up-to-date` at offset `4728994743440_4`

The must-refetch added **~15 seconds** of delay. After recovery, **no further data arrived** for offer_items for the rest of the HAR capture (6+ minutes of empty long-polls).

### 5. Steady-State Connection Count

During steady state, there are **13 concurrent live long-poll connections** — one per table. Each long-poll times out after ~40 seconds and reconnects.

| Table | Avg Response Time | Max Response Time |
|-------|------------------|-------------------|
| `offer_items` | 5,043ms | 41,900ms |
| `offers` | 4,946ms | 55,887ms |
| `offer_footer_columns` | 6,707ms | 60,194ms |
| `projects` | 12,971ms | 40,246ms |
| Other tables | 14,700-15,700ms | ~40,000ms |

### 6. Sync-Write Flow (Template Application)

The template application involved 4 sequential sync-writes:

| Time | Table | Operation | txid |
|------|-------|-----------|------|
| 15:15:51.965 | `offers` | INSERT | 73600302 |
| 15:15:52.820 | `offers` | UPDATE | 73600310 |
| 15:16:00.357 | `offer_items` | INSERT ×3 | 73600317 |
| 15:16:01.019 | `offer_product_pages` | INSERT | 73600322 |

All sync-writes succeeded (200). In this HAR, the shape data **did eventually arrive** for all writes — but with a 15-second delay due to the must-refetch recovery.

---

## Root Cause Analysis

### What Happened in This HAR (Juan's Reproduction)

In this capture, the system was **slow but functional**. The data did sync, but with significant delays:

1. Page load fired 10+ redundant shape requests per table (all getting the same data)
2. The `offer_items` shape got a `must-refetch` when new offers were created, adding ~15s delay
3. Six 502 errors hit various shapes during long-polling, disrupting those streams temporarily
4. 26 requests were aborted by the browser

### Likely Chain of Events for Original Incident (4:20 PM)

1. **Shape invalidation** triggered by the template application (many writes in quick succession to related shapes)
2. **502 connection resets** during the refetch window prevent the shape from re-establishing
3. The client's shape stream breaks — either the long-poll can't reconnect, or it gets stuck at a stale offset
4. **Optimistic state never reconciles** because the shape stream that would deliver the confirmed data is broken
5. **Page refresh works** because it creates fresh subscriptions
6. **Restarting the source works** because it clears all shape state server-side

### Contributing Factors

1. **Request amplification**: 10 separate initial requests to the same Electric shape per table, each redundantly transferring the full table. Creates unnecessary load spikes.

2. **No Electric-level WHERE clauses**: All 13 shapes are unfiltered full-table syncs. The `subset__*` params are proxy passthrough, not Electric filters. Using Electric's `where` clause would enable proper scoped shapes.

3. **must-refetch sensitivity**: The shape got invalidated at the worst possible moment (during a multi-step write flow). With fewer concurrent subscriptions hitting the same shape, this might not trigger.

4. **Proxy connection instability**: TCP resets between Fly.io and Cloudflare on long-poll connections suggest infrastructure-level issues with sustained connections.

---

## Recommendations

### Immediate

1. **Investigate proxy connection stability**: The 502s from `connection reset by peer` between Fly.io and Cloudflare need attention. Consider:
   - Increasing proxy keep-alive/idle timeouts
   - Adding retry logic in the proxy for upstream connection resets
   - Bypassing Cloudflare for the Electric upstream (direct to Electric Cloud)

### Short-term (client architecture)

2. **Use Electric `where` clauses instead of client-side subset filtering**: Instead of syncing all `offer_items` and filtering in the browser, pass `where="offer_id"=$1` to Electric. This reduces data transfer and avoids 10 redundant initial requests.

3. **Deduplicate shape subscriptions on the client**: If multiple components need the same shape (same table, no WHERE), they should share a single subscription rather than each opening their own.

### Medium-term

4. **Reduce shape count**: 13 shapes per page creates 13 sustained long-poll connections. Consider whether all tables need real-time sync or if some can use standard REST fetching.

---

## HAR Statistics

- **Total entries**: 1,268
- **Time span**: 15:06:53 - 15:22:14 UTC (15 minutes)
- **Electric shape requests**: 435 total
  - 227 GET (actual shape requests)
  - 197 OPTIONS (CORS preflights — normal)
  - 11 other/unknown
- **GET status distribution**: 200 (188), 0/aborted (26), 502 (6), 304 (5), 409 (2)
- **Unique shape tables**: 13
- **Distinct `offer_items` subset filters**: 13 different offer_id values
