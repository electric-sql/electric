---
"@electric-sql/client": patch
"@electric-sql/docs": patch
---

Add optional `shardSubdomain` shape option to auto-shard the url subdomain in development. This solves the slow shapes in development problem without needing HTTP/2 or system level deps like Caddy or mkcert.
