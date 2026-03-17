---
'@electric-sql/client': patch
---

Fix infinite loop when CDN serves stale cached responses. The `ignored` stale response path left state unchanged, causing the client to retry with the same URL hundreds of times per second. Stale responses now always enter `stale-retry` which adds a cache buster to produce a unique retry URL. Also add a duplicate-URL guard to catch future same-URL regressions, and stack traces to all state-machine warnings for easier debugging.
