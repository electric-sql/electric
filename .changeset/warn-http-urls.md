---
"@electric-sql/client": patch
---

Add console warning when using HTTP URLs in browser environments. HTTP limits browsers to 6 concurrent connections per host (HTTP/1.1), which can cause slow streams and app freezes. The warning can be disabled with `warnOnHttp: false`.
