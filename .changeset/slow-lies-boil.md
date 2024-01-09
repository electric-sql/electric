---
"@core/electric": patch
---

[VAX-1449] Add the notion of "clock drift" to Electric and use it when validating timestamps in auth tokens. Among other things, this fixes the issue where an auth token is used to authenticate with Electric before even a second passes after it was generated.
