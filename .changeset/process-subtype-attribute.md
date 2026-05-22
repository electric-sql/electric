---
"@core/electric-telemetry": minor
---

Emit a new `process_subtype` attribute alongside the existing `process_type` on `vm.monitor.long_gc`, `vm.monitor.long_schedule`, `vm.monitor.long_message_queue`, `process.memory`, and `process.bin_memory` telemetry events. For the three coarse `process_type` buckets that previously hid most of the signal during overload — `supervisor`, `erlang`, and `logger_olp` — `process_subtype` carries a stable, low-cardinality string identifying the specific process (registered name, falling back to `$ancestors` for unnamed supervisors or to the initial-call MFA for anonymous `:erlang` spawns). Existing `process_type` values are unchanged.
