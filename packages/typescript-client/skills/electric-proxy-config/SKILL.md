---
name: electric-proxy-config
description: >
  Configuring Caddy and nginx for HTTP/2 and SSE streaming — flush_interval,
  proxy_buffering off, reverse_proxy, 6-connection limit fix, slow shapes
  in dev and production, gzip encoding, keep-alive, fallback detection
type: sub-skill
library: '@electric-sql/client'
library_version: '1.5.8'
sources:
  - 'electric:website/docs/guides/troubleshooting.md'
---

# Electric HTTP/2 & SSE Proxy Setup

Fixes slow shapes caused by HTTP/1.1's 6-connection browser limit and SSE
proxy buffering issues.

## Setup

No code dependencies — this is infrastructure configuration.

## Core Patterns

### Why HTTP/2 Matters

HTTP/1.1 allows only 6 simultaneous connections per origin. Each Electric shape
holds a connection, so 6+ shapes cause visible delays. This also blocks HMR and
dev server assets sharing the same origin.

HTTP/2 multiplexes requests over a single TCP connection — unlimited shapes.

### Caddy (Recommended for Local Dev)

```bash
# 1. Install Caddy
brew install caddy  # macOS

# 2. Trust Caddy's certificate (required for HTTP/2)
caddy trust
```

```bash
# 3. Run Caddy proxy
caddy run --config - --adapter caddyfile <<EOF
localhost:3001 {
  reverse_proxy localhost:3000 {
    flush_interval -1
  }
  encode gzip
}
EOF
```

Then change shape URLs to use port 3001 instead of 3000.

**Important**: Run Caddy directly on your machine, not in Docker. Docker cannot
use HTTP/2 without additional TLS setup, defeating the purpose.

### Caddy with SSE Streaming

```caddyfile
localhost:3001 {
  reverse_proxy localhost:3000 {
    flush_interval -1
  }
  encode gzip
  header {
    Cache-Control "no-cache, no-transform"
    X-Accel-Buffering "no"
  }
}
```

`flush_interval -1` disables internal buffering so SSE events arrive immediately.

### Nginx

```nginx
location /v1/shape {
  proxy_pass http://localhost:3000;
  proxy_buffering off;
  proxy_http_version 1.1;
  proxy_cache_valid 200 1s;
}
```

`proxy_buffering off` is required for SSE. Preserve Electric's cache headers for
request collapsing efficiency.

### Vercel CDN Configuration

Vercel may cache Electric responses via its CDN. Disable caching for Electric routes:

```json
{
  "headers": [
    {
      "source": "/api/electric/(.*)",
      "headers": [
        { "key": "CDN-Cache-Control", "value": "no-store" },
        { "key": "Vercel-CDN-Cache-Control", "value": "no-store" }
      ]
    }
  ]
}
```

## Common Mistakes

### [HIGH] Not configuring HTTP/2 proxy in local dev

Wrong:

```typescript
// Direct to Electric on HTTP/1.1
const stream = new ShapeStream({ url: 'http://localhost:3000/v1/shape' })
```

Correct:

```bash
# Run Caddy, then use port 3001
caddy run --config - --adapter caddyfile <<EOF
localhost:3001 {
  reverse_proxy localhost:3000
  encode gzip
}
EOF
```

```typescript
const stream = new ShapeStream({ url: 'http://localhost:3001/v1/shape' })
```

HTTP/1.1's 6-connection limit causes delays with multiple shapes. Also blocks
dev server HMR. Caddy adds HTTP/2 with zero configuration.

Source: website/docs/guides/troubleshooting.md

### [MEDIUM] SSE without disabling proxy buffering

Wrong:

```nginx
# nginx default: proxy_buffering on
location /v1/shape {
  proxy_pass http://localhost:3000;
}
```

Correct:

```nginx
location /v1/shape {
  proxy_pass http://localhost:3000;
  proxy_buffering off;
}
```

Without disabling buffering, nginx holds SSE events until the buffer fills. The
Electric client detects this (3 consecutive short connections) and falls back to
long-polling — functional but less efficient.

Source: website/docs/guides/troubleshooting.md

### [HIGH] Running Caddy in Docker (loses HTTP/2)

Wrong:

```yaml
# docker-compose.yml
services:
  caddy:
    image: caddy:alpine
    ports: ['3001:3001']
```

Correct:

```bash
# Install and run directly on host machine
brew install caddy
caddy trust
caddy run --config - --adapter caddyfile <<EOF
localhost:3001 { reverse_proxy localhost:3000 }
EOF
```

Caddy in Docker can't install certificates into the host OS. Without trusted certs,
browsers won't use HTTP/2, defeating the purpose.

Source: website/docs/guides/troubleshooting.md

## Tension: SSE efficiency vs proxy compatibility

SSE provides lower-latency streaming, but most proxies buffer responses by default.
Without proper proxy configuration, SSE silently degrades to long-polling.

Cross-reference: `electric-http-api`

## References

- [Troubleshooting Guide](https://electric-sql.com/docs/guides/troubleshooting)
- [Caddy Server](https://caddyserver.com/docs)
