---
'@core/sync-service': patch
---

`Electric.Telemetry.Sentry.add_logger_handler/1` now accepts a keyword list of options. Any option other than `:id` is merged into the `Sentry.LoggerHandler` config map, letting downstream apps tune handler settings like `:discard_threshold` and `:sync_threshold` without reaching into `:logger` directly.
