---
'@electric-ax/durable-streams-server-rust': patch
---

Serve caught-up long-poll waits from the epoll reactor too, sharing the machinery with SSE: a blocked poll hands its socket to the reactor (freeing the connection task's future) and is handed back for keep-alive after the response. Linux only; other platforms keep the inline wait.
