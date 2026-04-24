---
'@core/sync-service': patch
---

Emit `number_to_expire` and `max_shapes` as Logger metadata (instead of interpolating them into the message body) for the "Expiring shapes as the number of shapes has exceeded the limit" notice. This keeps the message text static so log aggregators can group these events and so Honeycomb can filter by `shape.expiry.*` attributes.
