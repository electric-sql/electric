---
name: docker-reference
parent: deploying-electric
---

# Docker Compose Reference

## Minimal Development Setup

```yaml
name: 'electric-backend'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: electric
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    ports: ['54321:5432']
    volumes: ['./postgres.conf:/etc/postgresql/postgresql.conf:ro']
    tmpfs: ['/var/lib/postgresql/data', '/tmp']
    command: ['postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf']

  electric:
    image: electricsql/electric:canary
    environment:
      DATABASE_URL: postgresql://postgres:password@postgres:5432/electric?sslmode=disable
      ELECTRIC_INSECURE: true
    ports: ['3000:3000']
    depends_on: ['postgres']
```

## postgres.conf

```ini
listen_addresses = '*'
wal_level = logical
max_wal_senders = 10
max_replication_slots = 10
```

## Production Docker Compose

```yaml
services:
  electric:
    image: electricsql/electric:latest
    environment:
      DATABASE_URL: postgresql://electric:secret@postgres:5432/mydb
      ELECTRIC_SECRET: ${ELECTRIC_SECRET}
      ELECTRIC_STORAGE_DIR: /var/lib/electric
    ports: ['3000:3000']
    volumes:
      - electric-data:/var/lib/electric
    restart: unless-stopped

volumes:
  electric-data:
```

## Useful Commands

```bash
# Start services
docker compose up --wait postgres electric

# Clear all state and start fresh
docker compose down --volumes
docker compose up

# Build local Electric image (for feature branches)
docker build -t electric-local \
  -f packages/sync-service/Dockerfile \
  --build-context electric-telemetry=packages/electric-telemetry \
  packages/sync-service
```

## Common Issues

- **Connection refused**: Check `depends_on` ordering, Postgres may not be ready
- **Replication slot errors**: User needs `REPLICATION` role
- **WAL growth**: Set `max_slot_wal_keep_size` in postgres.conf
