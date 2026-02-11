---
'@electric-sql/client': patch
---

Fix infinite loop when the client resumes with a persisted handle that matches an expired handle. The stale cache detection assumed that having a local handle meant it was different from the expired one, so it returned "ignored" instead of retrying with a cache buster. When `localHandle === expiredHandle`, the client would loop forever: fetch stale response, ignore it, retry without cache buster, get the same stale response. Now the client correctly enters stale-retry with a cache buster when its own handle is the expired one.
