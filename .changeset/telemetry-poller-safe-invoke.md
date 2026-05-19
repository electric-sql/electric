---
'@core/electric-telemetry': patch
'@core/sync-service': patch
---

Wrap telemetry-poller MFAs in `ElectricTelemetry.Poller.safe_invoke/3` so that transient collector failures (`:noproc`, `:timeout`, `:shutdown`/`:normal` exits, `ArgumentError` from not-yet-created ETS tables) no longer cause `:telemetry_poller` to permanently remove the measurement from its polling list. Unexpected errors are now logged as warnings with the offending MFA and the collector keeps being polled on subsequent ticks. Strips now-redundant defensive `try/catch` / `with`-fallthrough code from individual collectors.

Note: user-supplied periodic measurement functions no longer have exceptions propagated up to `:telemetry_poller`'s own error logger — they are caught and logged via `ElectricTelemetry.Poller` instead.
