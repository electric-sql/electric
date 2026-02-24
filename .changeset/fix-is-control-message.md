---
'@electric-sql/client': patch
---

Fixed `isControlMessage` type guard crashing on messages without a `control` header (e.g. `EventMessage`s or malformed responses). The function previously used a negation check (`!isChangeMessage()`) which misclassified any non-change message as a `ControlMessage`, causing `TypeError: Cannot read property 'control' of undefined` in `Shape.process_fn`. Now uses a positive check for `'control' in message.headers`, consistent with how `isChangeMessage` checks for `'key' in message`.
