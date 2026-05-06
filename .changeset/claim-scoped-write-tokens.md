---
'@electric-ax/agents-server': patch
'@electric-ax/agents-runtime': patch
---

Replace static entity write tokens with claim-scoped tokens. Write tokens are now issued when a consumer claims a wake and revoked on done, preventing leaked credentials from granting permanent write access. Removes `writeToken` from webhook notifications and spawn response headers.
