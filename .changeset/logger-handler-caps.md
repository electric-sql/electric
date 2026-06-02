---
'@core/sync-service': patch
---

Cap the overload-protection (OLP) mailboxes of the default console, OpenTelemetry, and Sentry logger handlers so error/log bursts shed messages instead of blocking Logger callers or growing unbounded.

This is **leading-edge protection only**: it shields against the early phase of a redeployment/error burst but is **not sufficient under deep scheduler starvation** — the real fix for that is upstream (request-proxy admission control and snapshot-pool sizing).

Note: `sync_mode_qlen` is intentionally not set on the OpenTelemetry log handler — its module forces `sync_mode_qlen == drop_mode_qlen`, so the option would be a no-op there.
