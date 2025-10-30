---
'@electric-sql/client': patch
---

Fix multiple renders from cached up-to-date messages on page refresh. When a shape receives multiple updates within the HTTP cache window (60s), each update ends with an up-to-date control message that gets cached. On page refresh, these cached responses replay rapidly, causing multiple renders. This change implements cursor-based detection to suppress cached up-to-date notifications until a fresh response (with a new cursor) arrives from the server, ensuring only one render occurs.
