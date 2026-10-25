---
'@electric-sql/client': patch
---

Apply the `liveRequestTimeoutMs` watchdog to live SSE requests, so a half-open
SSE connection (for example after a phone changes networks) restarts instead of
holding the stream until TCP gives up. The timer re-arms when the headers arrive
and on every body chunk, including the server's keep-alive comments.
