---
name: deploying-electric
description: Deployment options for Electric - Cloud, Docker, and self-hosted patterns
triggers:
  - deploy
  - docker
  - cloud
  - self-hosted
  - infrastructure
  - hosting
metadata:
  sources:
    - AGENTS.md
    - website/docs/quickstart.md
---

# Deploying Electric

Choose your deployment strategy based on operational needs.

## Option 1: Electric Cloud (Recommended)

Managed Electric service - zero ops, automatic scaling.

### Setup

```bash
# From starter template
npx @electric-sql/start my-app
cd my-app

# Claim cloud resources
pnpm claim

# Deploy frontend (e.g., Netlify, Vercel)
pnpm deploy
```

### Configuration

Electric Cloud provides:

- `SOURCE_ID` - Your Electric source identifier
- `SOURCE_SECRET` - Authentication secret (keep server-side!)
- `ELECTRIC_URL` - Cloud API endpoint

```env
# .env (server-side only)
SOURCE_ID=your-source-id
SOURCE_SECRET=your-secret
ELECTRIC_URL=https://api.electric-sql.cloud
```

### Connecting Your Database

Electric Cloud connects to your Postgres. Requirements:

- Postgres 14+ with logical replication
- Public network access (or use SSH tunnel)
- User with REPLICATION privileges

```sql
-- Create Electric user
CREATE USER electric WITH PASSWORD 'xxx' REPLICATION;
GRANT CONNECT ON DATABASE mydb TO electric;
GRANT USAGE ON SCHEMA public TO electric;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO electric;
```

## Option 2: Docker (Self-Hosted)

Run Electric alongside your existing infrastructure.

### docker-compose.yml

```yaml
name: 'electric-backend'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: electric
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    ports:
      - '54321:5432'
    volumes:
      - ./postgres.conf:/etc/postgresql/postgresql.conf:ro
    tmpfs:
      - /var/lib/postgresql/data
      - /tmp
    command:
      - postgres
      - -c
      - config_file=/etc/postgresql/postgresql.conf

  electric:
    image: electricsql/electric:latest
    environment:
      DATABASE_URL: postgresql://postgres:password@postgres:5432/electric?sslmode=disable
    ports:
      - '3000:3000'
    depends_on:
      - postgres
```

### postgres.conf

```conf
listen_addresses = '*'
wal_level = logical
max_replication_slots = 10
max_wal_senders = 10
```

### Commands

```bash
# Start services
docker compose up -d

# Check Electric health
curl http://localhost:3000/health

# View logs
docker compose logs -f electric

# Stop services
docker compose down
```

## Option 3: Kubernetes

For production Kubernetes deployments.

### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: electric
spec:
  replicas: 1 # Single instance for now
  selector:
    matchLabels:
      app: electric
  template:
    metadata:
      labels:
        app: electric
    spec:
      containers:
        - name: electric
          image: electricsql/electric:latest
          ports:
            - containerPort: 3000
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: electric-secrets
                  key: database-url
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 30
          resources:
            requests:
              memory: '256Mi'
              cpu: '250m'
            limits:
              memory: '1Gi'
              cpu: '1000m'
---
apiVersion: v1
kind: Service
metadata:
  name: electric
spec:
  selector:
    app: electric
  ports:
    - port: 3000
      targetPort: 3000
```

### Secrets

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: electric-secrets
type: Opaque
stringData:
  database-url: postgresql://user:pass@postgres:5432/db
```

## Postgres Requirements

All deployment options require:

| Requirement           | Value                         |
| --------------------- | ----------------------------- |
| Version               | 14+                           |
| wal_level             | logical                       |
| max_replication_slots | 10+ (1 per Electric instance) |
| max_wal_senders       | 10+                           |
| User role             | REPLICATION                   |

### Managed Postgres Providers

| Provider         | Logical Replication             |
| ---------------- | ------------------------------- |
| Neon             | ✅ Supported                    |
| Supabase         | ✅ Supported                    |
| Crunchy Data     | ✅ Supported                    |
| AWS RDS          | ✅ Enable in parameter group    |
| Google Cloud SQL | ✅ Enable logical_decoding flag |
| Azure Postgres   | ✅ Enable in server parameters  |

## CDN/Caching Layer

Production deployments should put a CDN in front of Electric.

### Cloudflare

```
Client → Cloudflare (CDN) → Proxy (auth) → Electric
```

Cloudflare automatically handles:

- Request collapsing for live mode
- Edge caching for initial sync
- DDoS protection

### Nginx Cache

```nginx
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=electric:10m;

server {
    location /v1/shape {
        proxy_pass http://electric:3000;
        proxy_cache electric;
        proxy_cache_key "$uri$is_args$args";
        proxy_cache_valid 200 1m;

        # For live mode
        proxy_read_timeout 60s;
        proxy_buffering off;
    }
}
```

### Caddy (Development)

```caddyfile
localhost:5173 {
    handle /api/* {
        reverse_proxy localhost:3000
    }
    handle {
        reverse_proxy localhost:5174
    }
}
```

## Environment Configuration

### Required Variables

| Variable      | Description                | Where                   |
| ------------- | -------------------------- | ----------------------- |
| DATABASE_URL  | Postgres connection string | Electric server         |
| ELECTRIC_URL  | Electric API endpoint      | App server              |
| SOURCE_ID     | Cloud source identifier    | App server (Cloud only) |
| SOURCE_SECRET | Cloud authentication       | App server (Cloud only) |

### Optional Variables

| Variable        | Description       | Default |
| --------------- | ----------------- | ------- |
| ELECTRIC_PORT   | HTTP port         | 3000    |
| ELECTRIC_SECRET | API token         | (none)  |
| LOG_LEVEL       | Logging verbosity | info    |

## Health Checks

```bash
# Basic health
curl http://electric:3000/health
# Returns: {"status":"ok"}

# Detailed status
curl http://electric:3000/api/status
```

## Scaling Considerations

### Horizontal Scaling

Currently Electric runs as a single instance per source database. For high availability:

- Use container orchestration with health checks
- Implement automatic restart on failure
- CDN provides edge redundancy

### Vertical Scaling

Electric is CPU and memory efficient:

- 256MB RAM handles most workloads
- Scale up for many concurrent shapes or high write throughput

### Database Scaling

- Monitor replication lag
- Ensure adequate WAL disk space
- Consider read replicas for other workloads

## Troubleshooting

### Electric Won't Start

```bash
# Check DATABASE_URL connectivity
docker compose exec electric curl -v $DATABASE_URL

# Verify Postgres settings
docker compose exec postgres psql -c "SHOW wal_level;"
```

### Replication Not Working

```sql
-- Check replication slots
SELECT * FROM pg_replication_slots;

-- Check replication status
SELECT * FROM pg_stat_replication;
```

### High Memory Usage

- Check number of active shapes
- Verify shape definitions aren't overly broad
- Monitor with `/api/status` endpoint

## Resources

- [Electric Configuration](https://electric-sql.com/docs/api/config)
- [Postgres Permissions Guide](https://electric-sql.com/docs/guides/postgres-permissions)
- [Troubleshooting](https://electric-sql.com/docs/guides/troubleshooting)
