---
'@core/sync-service': patch
---

Start the consumer of an existing subquery dependency shape if it isn't running when a new parent shape resolves to it. Previously such a parent request failed with a 500 on every retry: the dependency's materializer found no consumer, the parent was invalidated, and the still-registered dependency poisoned the next attempt.
