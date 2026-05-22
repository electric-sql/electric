---
"@core/sync-service": patch
---

Reject malformed shape offsets with negative parts as invalid requests instead of raising `FunctionClauseError`.
