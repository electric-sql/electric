---
"@core/sync-service": patch
---

Handle client-cancelled shape requests as disconnects instead of server errors.
A live long-poll now aborts as soon as the client resets the HTTP/2 stream,
releasing the handler process and its admission permit immediately instead of
holding them for the remainder of the long-poll timeout. Transport errors
raised when sending a response to a client that already went away are now
recorded as status 499 with a `shape_req.client_disconnected` span attribute
rather than surfacing as phantom 500s with recorded exceptions.
