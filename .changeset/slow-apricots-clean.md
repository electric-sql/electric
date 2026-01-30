---
'@electric-sql/client': patch
---

Properly bundle `fetch-event-source`, so consumer use patched version.

When liveSse mode got introduced, it included `fetch-event-source` which is used instead of built-in `EventSource` because of richer capabilities. However, it had a few assumptions (document/window existence) + bugs, when it comes to aborting. This was patched, however, when building `typescript-client` patched version isn't included and when user uses it - they have unpatched version. 