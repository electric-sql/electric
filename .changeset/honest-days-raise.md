---
"@core/electric": patch
---

Correctly detect cases where the clients are ahead of WAL window, which may happen in case of a DB reset, like in development
