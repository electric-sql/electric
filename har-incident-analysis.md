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

### 1. Massive Request Duplication at Page Load

The client fires **multiple parallel shape subscriptions** for the same Electric shape with different client-side `subset__*` filter params:

| Table | Initial `offset=now` requests | Distinct subset filters |
|-------|------|------|
| `offer_items` | 22 | 10 different `offer_id` values + 1 unfiltered |
| `offers` | 4 | list filter + per-offer-id + per-project + templates |
| Other tables | 4 each | 1-2 each |

**All subset variants hit the same underlying Electric shape** (same handle `105664863-...`). The `subset__where` / `subset__params` URL params are custom proxy params — they are **NOT** converted to Electric `where` clauses. Electric returns all rows for the table; filtering happens client-side.

Each subscription fires ~2-4 HTTP requests (initial + follow-up), producing **42 requests for offer_items alone** in the first 2 seconds. Peak concurrent Electric connections: **45**.

### 2. 50% of Responses Are Empty 200s (Proxy Issue)

Out of 392 HTTP 200 responses, **197 (50.3%)** had:
- Empty body (content-length: 0)
- No `electric-handle` header
- No `electric-offset` header
- Only CORS headers + `fly-request-id`

These empty 200s come from the Fly.io proxy failing to forward the request upstream. The client's shape subscription **silently fails** — it receives a 200 OK but no shape data. This is the most likely cause of the "optimistic state not applied" symptom in the original incident.

### 3. 502 Errors from Proxy Connection Resets

Six 502 errors occurred between 15:16:06 and 15:17:02 UTC, all with the same error:

```
Electric proxy error: read tcp [Fly.io IP]:50790->[Cloudflare IP]:443: read: connection reset by peer
```

Affected tables: `offer_footer_columns`, `housing_units`, `projects`, `valves`, `offers`, `tags`

These are TCP connection resets between the Fly.io proxy and Cloudflare. The requests that failed were all **live long-poll requests** that had been open for 40-60 seconds. This suggests either:
- Cloudflare idle connection timeout
- Proxy connection pool exhaustion under load
- Electric upstream instability

### 4. Shape Invalidation (`must-refetch`) on offer_items

At **15:15:51 UTC**, the `offer_items` shape returned HTTP 409 with `must-refetch`:

```
Old handle: 105664863-1771655373716730
New handle: 105664863-1771859752105857
```

This forced the client to re-sync the entire shape from scratch. The refetch took **~15 seconds** (entry completed at ~15:16:12). The `must-refetch` occurred immediately after the sync-write that created the new offer (txid 73600302 at 15:15:51).

Timeline of the must-refetch recovery:
1. 15:15:51 — 409 must-refetch received
2. 15:15:52 — Client starts refetching with new handle
3. 15:15:57 — Data starts arriving (3 offer_items rows from the template)
4. 15:16:12 — Shape reaches `up-to-date` at offset `4728994743440_4`

After recovery, **no further data arrived** for offer_items for the rest of the HAR capture (6+ minutes of empty long-polls).

### 5. Steady-State Connection Count

During steady state (after initial burst), there are **13 concurrent live long-poll connections** — one per table. Each long-poll times out after ~40 seconds and reconnects. This is within browser limits for HTTP/2 but creates sustained load on the proxy.

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

All sync-writes succeeded (200). In this HAR, the shape data **did eventually arrive** for all writes. However, the 15-second gap between the sync-write (15:16:00) and the shape delivering the data (~15:16:12) is significant for UX.

---

## Root Cause Analysis

### Original Incident (not captured in HAR)

The most likely chain of events:

1. **Shape invalidation** triggered by the template application (many writes in quick succession)
2. **Proxy returns empty 200s** for the refetch requests (as seen: 50% of requests get empty responses)
3. **Client shape subscription silently breaks** — it receives 200 OK but no shape data or handle
4. **Live polling never re-establishes** because the subscription thinks it connected but has no data
5. **502 errors** from proxy connection resets compound the problem
6. **Optimistic state never reconciles** because the shape stream that would deliver the synced data is broken
7. **Page refresh works** because it creates fresh subscriptions that succeed
8. **Restarting the source works** because it clears all shape state and forces clean reconnection

### Contributing Factors

1. **Proxy fragility**: The Fly.io proxy returns empty 200s (no error!) when it can't connect upstream. This is the worst failure mode — the client can't distinguish success from failure.

2. **Request amplification**: 10+ client-side subsets per table all hit the same Electric shape independently, creating unnecessary load spikes at page load and after navigation.

3. **No Electric-level WHERE clauses**: All 13 shapes are unfiltered full-table syncs. Using Electric's `where` clause would reduce data transfer and avoid the need for client-side subset subscriptions.

4. **must-refetch sensitivity**: The shape got invalidated at the worst possible moment (during a multi-step write flow). This could be from shape cache pressure or from the concurrent request burst causing shape recreation.

---

## Recommendations

### Immediate (proxy fix)

1. **Fix the empty 200 responses**: The proxy MUST NOT return 200 with empty body and no Electric headers. It should either forward the upstream response faithfully or return a proper error (502/503). This is the single most impactful fix.

2. **Add proxy-level request deduplication**: Since all subset variants hit the same Electric shape, the proxy should maintain a single upstream connection per shape and fan out to clients.

### Short-term (client architecture)

3. **Use Electric `where` clauses instead of client-side subset filtering**: Instead of syncing all `offer_items` and filtering in the browser, pass `where=offer_id=$1` to Electric. This reduces data transfer and enables proper per-shape subscriptions.

4. **Deduplicate shape subscriptions on the client**: Multiple components subscribing to `offer_items` for different offer IDs should share a single shape stream if using the same underlying shape (or use separate shapes with WHERE clauses).

5. **Add client-side error handling for empty 200 responses**: Detect when a shape response has no `electric-handle` header and retry/error instead of silently accepting it.

### Medium-term (infrastructure)

6. **Investigate Fly.io → Cloudflare connection stability**: The TCP connection resets suggest the long-poll connections are being terminated. Consider:
   - Increasing proxy keep-alive timeouts
   - Using a persistent connection pool with health checks
   - Bypassing Cloudflare for the Electric upstream (direct to Electric Cloud)

7. **Reduce shape count**: 13 shapes per page is high. Consider whether all tables need real-time sync or if some can use standard REST fetching.

---

## HAR Statistics

- **Total entries**: 1,268
- **Time span**: 15:06:53 - 15:22:14 UTC (15 minutes)
- **Electric shape requests**: 435 (34% of all traffic)
- **Unique shape tables**: 13
- **Status distribution**: 200 (1,061), 204 (113), 304 (34), 0/aborted (31), 201 (15), 502 (6), 101 (4), 409 (2), 302 (2)
