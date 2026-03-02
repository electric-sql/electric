---
name: self-hosted-reference
parent: deploying-electric
---

# Self-Hosted Reference

Full control over Electric infrastructure.

## Quick Start

```bash
docker run -e DATABASE_URL=postgres://user:pass@host:5432/db \
  -e ELECTRIC_SECRET=your-secret \
  -p 3000:3000 electricsql/electric
```

## Key Environment Variables

| Variable                           | Required | Default         | Description                                         |
| ---------------------------------- | -------- | --------------- | --------------------------------------------------- |
| `DATABASE_URL`                     | Yes      | —               | Postgres connection string                          |
| `ELECTRIC_SECRET`                  | Yes\*    | —               | Auth secret (\*or `ELECTRIC_INSECURE=true` for dev) |
| `ELECTRIC_PORT`                    | No       | `3000`          | HTTP listen port                                    |
| `ELECTRIC_STORAGE_DIR`             | No       | `/tmp/electric` | Shape log storage path                              |
| `ELECTRIC_INSECURE`                | No       | `false`         | Skip auth (dev only)                                |
| `ELECTRIC_SHAPE_DB_EXCLUSIVE_MODE` | No       | `false`         | Required for network FS (EFS)                       |
| `ELECTRIC_DATABASE_USE_IPV6`       | No       | `false`         | Connect to Postgres over IPv6                       |
| `ELECTRIC_LISTEN_ON_IPV6`          | No       | `false`         | Bind to IPv6 addresses                              |
| `ELECTRIC_PROMETHEUS_PORT`         | No       | —               | Enable Prometheus metrics                           |

## Reverse Proxy Setup

### Caddy (recommended)

```caddyfile
electric.example.com {
  reverse_proxy electric:3000 {
    flush_interval -1
  }
  encode gzip
}
```

### Nginx

```nginx
upstream electric {
  server electric:3000;
}

server {
  listen 443 ssl http2;
  server_name electric.example.com;

  location /v1/shape {
    proxy_pass http://electric;
    proxy_buffering off;
    proxy_http_version 1.1;
    proxy_read_timeout 60s;
  }
}
```

## Health Check

```bash
curl http://localhost:3000/health
```

## Monitoring

Enable Prometheus metrics:

```bash
docker run -e DATABASE_URL=... \
  -e ELECTRIC_PROMETHEUS_PORT=9090 \
  -p 3000:3000 -p 9090:9090 electricsql/electric
```

Key metrics:

- `electric.postgres.replication.slot_retained_wal_size`
- `electric.postgres.replication.slot_confirmed_flush_lsn_lag`
