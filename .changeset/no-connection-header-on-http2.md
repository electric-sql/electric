---
"@core/sync-service": patch
---

Send `connection: keep-alive` on live SSE and OPTIONS responses only over HTTP/1.x. HTTP/2 forbids connection-specific headers, so HTTP/2 clients (curl, Node's `http2`) reset the SSE stream before its first event when Electric is served over HTTP/2, for example behind an h2c reverse proxy.
