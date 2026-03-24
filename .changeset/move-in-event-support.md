---
'@electric-sql/client': patch
---

Add move-in event support to the TypeScript client. Rename `MoveOutPattern` to `MovePattern` (with a deprecated alias for backwards compatibility), extend `EventMessage` to accept both `move-out` and `move-in` events, and add `active_conditions` field to `ChangeMessage` headers.
