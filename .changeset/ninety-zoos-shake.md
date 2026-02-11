---
'@electric-sql/client': patch
---

Refactor ShapeStream's implicit sync state into an explicit state machine using the OOP state pattern. Each state (Initial, Syncing, Live, Replaying, StaleRetry, Paused, Error) is a separate class carrying only its relevant fields, with transitions producing new immutable state objects. This replaces the previous flat context bag where all fields existed simultaneously regardless of the current state.
