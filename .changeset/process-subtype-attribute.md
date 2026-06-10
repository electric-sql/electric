---
"@core/electric-telemetry": minor
---

Refine the `process_type` telemetry attribute for the coarse buckets that previously hid most of the signal during overload. `:erlang` and `:supervisor` are now replaced by a more specific, low-cardinality name (registered name, falling back to the first named `$ancestor`, then to the initial-call MFA), and logger handler/proxy processes are reported as `logger_olp:<handler_id>` instead of a bare `logger_olp`. This affects the `vm.monitor.long_gc`, `vm.monitor.long_schedule`, `vm.monitor.long_message_queue`, `process.memory`, and `process.bin_memory` events. No separate attribute is added.
