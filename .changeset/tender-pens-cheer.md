---
"@core/sync-service": minor
---

[BREAKING] All shape API endpoints now accept `table` as a query parameter rather than a path parameter, so `/v1/shape/foo?offset=-1` now becomes `/v1/shape?table=foo&offset=-1`.
