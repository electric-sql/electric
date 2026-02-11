---
'@electric-sql/client': patch
---

Fix crash when receiving a stale cached response on a resumed session with no schema yet. When the client resumes from a persisted handle/offset, the schema starts undefined. If the first response is stale (expired handle from a misconfigured CDN), the response is ignored and body parsing is skipped — but the code then accesses `schema!`, which is still undefined, causing a parse error. Now the client skips body parsing entirely for ignored stale responses.
