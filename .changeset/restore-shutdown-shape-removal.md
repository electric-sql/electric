---
'@core/sync-service': patch
---

Stop subquery shapes from being spuriously removed (and held requests from
crashing) during a server restart. When a dependency consumer's inline call to
its materializer raced the materializer's shutdown, the resulting `:noproc`
exit crashed the consumer and removed the shape from disk — leaving it
half-removed and returning a `409 must-refetch` after the restart. The consumer
now absorbs that exit and lets the monitored `:DOWN` drive a clean stop.
Additionally, `validate_shape_handle/3` and the API's disk-update check now
tolerate the brief window during a restart where the per-stack ETS tables are
absent, falling back instead of raising an `ArgumentError`.
