---
"@electric-sql/client": patch
---

Fix cache buster not changing on retry attempts for stale CDN responses

When the client detects a stale cached response from a CDN with an expired shape handle, it retries with a cache buster parameter to bypass the cache. Previously, the cache buster was generated before throwing the error, which could result in the same value being used across retries. Now the cache buster is generated right before each retry request, ensuring a unique value for every attempt.

This fixes issue #3723 where the cache buster was not changing on subsequent retry attempts.
