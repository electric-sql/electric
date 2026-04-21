---
'@core/sync-service': patch
---

`Electric.Telemetry.Sentry.add_logger_handler/1` now accepts an optional second argument — a keyword list whose entries are merged into the `Sentry.LoggerHandler` config map — so downstream apps can tune handler settings like `:discard_threshold` and `:sync_threshold` without reaching into `:logger` after the fact. The existing single-arg `add_logger_handler(id)` form is preserved.
