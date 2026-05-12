---
'@core/sync-service': patch
---

Fix a 2-cycle infinite refetch loop on `live=true&live_sse=true` shape requests caused by a non-monotonic `electric-cursor` header.

`Electric.Plug.Utils.get_next_interval_timestamp/2` could return a cursor smaller than the `prev_interval` the client sent: when the client polled with a previously-jittered value (`bucket + delta`, `delta ∈ 1..3_600`) and the wall clock had not yet crossed that value, the function fell through to the plain bucket value and returned a cursor below the client's. Combined with `Cache-Control: public, max-age=<sse_timeout - 1>` on live SSE responses (added intentionally to enable CDN request collapsing), two cached entries could end up pointing at each other: `?cursor=A` → `electric-cursor: B`, and `?cursor=B` → `electric-cursor: A`. Once both entries were warm, the client would bounce between them at line rate (>600 req/s) until the cache window expired, all within the original `max-age` window.

`get_next_interval_timestamp/2` now guarantees that the returned cursor is strictly greater than `prev_interval` — when bucket math would return a value `<= prev`, the function jitters strictly forward from `prev` instead.

This is a server-side-only fix; clients on any current version recover automatically once existing CDN-cached cycle entries age out (≤ `sse_timeout`).
