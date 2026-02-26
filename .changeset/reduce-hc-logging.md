---
"@electric-sql/sync-service": patch
---

Reclassify most Logger.info calls to Logger.notice to reduce Honeycomb OTEL log volume. High-volume shape lifecycle messages (create, remove, relation received) remain at info level for AWS CloudWatch debugging while being filtered from Honeycomb via the notice level threshold.
