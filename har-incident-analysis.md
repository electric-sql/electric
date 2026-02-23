# HAR Incident Analysis — Autarc Staging (2026-02-23)

## Incident Summary

**Reported by:** Tomas Gonzalez
**When:** ~4:20 PM (original incident, not captured in HAR)
**HAR captured by:** Juan (partial reproduction — slow behavior + eventual 502 burst)
**Environment:** Autarc staging (`api3.staging.autarc.energy`), proxy on Fly.io → Cloudflare → Electric Cloud, HTTP/2

**Symptom:** Applying a template to an offer (bulk insert into `offer_items`) — optimistic state never applied, data only appeared after page refresh. Restarting the source fixed it. No errors visible in devtools console or network tab.

---

## Timeline (from HAR)

Juan's reproduction attempt. The system was slow but functional — data did eventually sync unlike the original incident.

### Phase 1: Page Load — Request Burst (15:15:32)

```
15:15:32.011  GET offers (offset=now)        → 200  460ms   1 row (existing offer list)
15:15:32.011  GET projects (offset=now)       → 200  580ms   1 row
15:15:32.687  GET offer_items ×10 (offset=now)→ 200  600ms   3-7 rows each (10 different subset filters, same shape)
15:15:32.690  GET offers ×3 (per-offer-id)    → 200  460ms   same data re-fetched per offer
```

10 simultaneous `offer_items` requests, one per visible offer row, each with a different `subset__params={"1":"<offer_id>"}`. All hit the **same Electric shape** (handle `105664863-...`, no WHERE clause). Each returns the full table; filtering is client-side.

### Phase 2: Subscriptions Consolidate (15:15:33)

```
15:15:33.292  offer_items ×10 follow-ups      → 200  ~600ms  (same data, second round)
15:15:33.725  offer_items (subset=none)        → 200  157ms   consolidated subscription starts
15:15:33.883  offer_items live long-poll        → (held open...)
```

20 GET requests for `offer_items` in <2 seconds, then everything consolidates into a single live long-poll per table. 13 tables = 13 concurrent long-polls.

### Phase 3: Template Application — Sync Writes (15:15:45 – 15:16:01)

```
15:15:45.716  sync-write: UPDATE projects     → 200  87ms   txid=73600292
15:15:45.931  sync-write: UPDATE projects     → 200  45ms   txid=73600293
15:15:51.965  sync-write: INSERT offers       → 200  39ms   txid=73600302  ← new offer created
15:15:52.820  sync-write: UPDATE offers       → 200  38ms   txid=73600310  ← offer fields set
15:16:00.357  sync-write: INSERT offer_items ×3 → 200  59ms  txid=73600317  ← template positions
15:16:01.019  sync-write: INSERT offer_product_pages → 200  32ms  txid=73600322
```

All writes succeed. Server returns valid txids.

### Phase 4: Shape Rotation — 409 Must-Refetch (15:15:51)

```
15:15:51.965  GET offer_items (subset=4b6d1d6b, old handle) → 409  156ms  must-refetch
              Response: new handle 105664863-1771859752105857
15:15:52.052  GET offer_items (subset=754f4f28, old handle) → 409  156ms  must-refetch (same)
```

Two new requests for just-created offers arrive using the old handle. Electric responds: shape has been rotated, here's the new handle. The existing live long-poll is aborted (status 0).

### Phase 5: Shape Re-sync (15:15:52 – 15:16:12) — 15 seconds for 3.7 KB

```
15:15:52.124  GET offer_items (new handle, off=old)  → 200  587ms   0 rows, 134 bytes
15:15:52.210  GET offer_items (new handle, off=old)  → 200  600ms   0 rows, 132 bytes
15:15:52.713  GET offer_items (new handle, off=0_inf) → 200  581ms  0 rows, 133 bytes
15:15:57.192  GET offer_items (new handle, off=old)  → 200  601ms   3 rows, 3.8 KB
15:15:57.802  GET offer_items (new handle, off=old)  → 200  15,187ms  3 rows + up-to-date, 3.8 KB
              ↳ Timings: wait=15,176ms, receive=1ms (1,345 bytes compressed)
```

Electric takes **15 seconds** to serve 3.7 KB (3 offer_items rows). The entire delay is server-side `wait` — likely Electric rebuilding the shape snapshot after rotation. The actual data transfer is 1ms.

### Phase 6: 502 Burst (15:16:06 – 15:17:02)

```
15:16:06  502 offer_footer_columns  (60s long-poll)  "connection reset by peer"
15:16:26  502 housing_units         (40s long-poll)  "connection reset by peer"
15:16:26  502 projects              (40s long-poll)  "connection reset by peer"
15:16:26  502 valves                (40s long-poll)  "connection reset by peer"
15:16:53  502 offers                (12s long-poll)  "connection reset by peer"
15:17:02  502 tags                  (4s long-poll)   "connection reset by peer"
```

All 502s: `Electric proxy error: read tcp [Fly.io]:50790->[Cloudflare]:443: read: connection reset by peer`. TCP connections between the Fly.io proxy and Cloudflare get killed during long-polls.

### Phase 7: Steady State — Empty Long-Polls (15:16:13 – 15:22:14)

```
15:16:13  offer_items live=true  → 200  40s  0 rows, up-to-date
15:16:53  offer_items live=true  → 200  40s  0 rows, up-to-date
15:17:33  offer_items live=true  → 200  40s  0 rows, up-to-date
... (repeats every ~40s for all 13 tables, no new data arrives)
```

Shape is caught up. No further changes for the remaining 6 minutes of the capture.

---

## What Likely Happened at 4:20 PM (Original Incident)

The HAR shows the system under stress but recovering. The original incident was worse — optimistic state never reconciled. Likely chain:

1. User applies template → sync-writes succeed (offer + offer_items + product pages)
2. Shape rotation happens (409 must-refetch) — same as in HAR
3. **During the ~15s re-sync window, proxy 502s prevent the shape from recovering**
4. Client's shape stream is broken — stuck with stale handle or unable to reconnect
5. Sync-write txids never get confirmed via the shape stream → optimistic state hangs
6. **No errors visible in devtools** because the shape client may silently retry/backoff without surfacing errors
7. Page refresh forces fresh subscriptions → data appears
8. Restarting the source clears shape state → clean reconnection

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Shape tables synced simultaneously | 13 |
| Concurrent long-poll connections (steady state) | 13 |
| Initial burst requests for `offer_items` | 20 GETs (10 subsets × 2 rounds) |
| Time to re-sync shape after 409 | **15 seconds** (for 3.7 KB / 3 rows) |
| 502 errors | 6 (all TCP resets on long-polls) |
| Aborted requests | 26 |
| Sync-writes | 7 (all succeeded) |

---

## Observations

1. **15s to serve 3.7 KB after shape rotation** — the delay is entirely server-side (`wait=15,176ms`). Electric is likely rebuilding the shape snapshot. This is the critical window where 502s from the proxy could prevent recovery entirely.

2. **13 shapes, no WHERE clauses** — all shapes are unfiltered full-table syncs. The `subset__*` URL params are custom proxy passthrough for client-side filtering, not Electric WHERE clauses. All offer_items requests share the same Electric shape handle.

3. **10 redundant initial requests** for `offer_items` — one per visible offer row, each getting back the same full dataset. These consolidate into a single long-poll, but the initial burst is unnecessary load.

4. **502s are proxy-level** — `read: connection reset by peer` between Fly.io and Cloudflare on connections held open 12-60 seconds. Not Electric errors — infrastructure-level TCP resets.

5. **Shape rotation trigger is unclear** — the 409 coincides with the first sync-write (offer INSERT at 15:15:51). Could be shape GC, concurrent recreation, or some server-side lifecycle event. Would need Electric server logs to confirm.
