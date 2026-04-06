---
title: Upgrading - Guide
description: >-
  How to upgrade the Electric sync service with minimal disruption.
outline: [2, 3]
---

<img src="/img/icons/deploy.png" class="product-icon"
    style="width: 72px"
/>

# Upgrading

How to upgrade the [Electric sync engine](/primitives/postgres-sync) with minimal disruption using rolling deployments. This guide covers two deployment scenarios: [shared storage](#shared-storage-recommended) (recommended) and [separate storage](#separate-storage-ephemeral) for ephemeral environments.

Before reading this guide, make sure you're familiar with the [Deployment guide](/docs/guides/deployment) for general setup.

## How the advisory lock works

Electric uses a [PostgreSQL advisory lock](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS) to ensure only one instance actively replicates from Postgres at a time. The lock is tied to the replication slot name:

```sql
SELECT pg_advisory_lock(hashtext('electric_slot_{stream_id}'))
```

Key properties:

- Only one instance can hold the lock per [`ELECTRIC_REPLICATION_STREAM_ID`](/docs/api/config#electric-replication-stream-id)
- The lock is held on the replication database connection &mdash; if the connection drops (e.g., instance shutdown), the lock is automatically released
- A new instance waiting for the lock enters **read-only mode**, where it can serve existing shapes but cannot create new ones
- Electric includes a lock breaker mechanism that can terminate stale database connections holding the lock, preventing indefinite lock contention if the previous instance failed to cleanly release it

## Health check behavior during deploys

The [`/v1/health`](/docs/guides/deployment#health-checks) endpoint reflects the instance's current state:

| HTTP Status | Response | Meaning |
|-------------|----------|---------|
| `200` | `{"status": "active"}` | Fully operational, holding the advisory lock |
| `202` | `{"status": "waiting"}` | Waiting for the lock, serving existing shapes in read-only mode |
| `202` | `{"status": "starting"}` | Starting up, not yet ready to serve any requests |

During the `waiting` state:

- Requests for **existing shapes** are served normally (read-only mode)
- Requests that require **creating new shapes** return `503` with a `Retry-After: 5` header
- **Shape deletion** also requires active mode and returns `503` while waiting

> [!Tip] Probe configuration
> For **liveness probes**, any response (200 or 202) indicates the service is alive.
>
> For **readiness probes** during rolling deploys, you should accept both `200` and `202` (i.e., any 2xx response). If you only accept `200`, the new instance can never become ready while the old instance holds the lock &mdash; creating a deadlock where the orchestrator waits for the new instance to be ready before terminating the old one.
>
> See the [Deployment guide](/docs/guides/deployment#health-checks) for more on health check configuration.

## Shared storage (recommended)

When instances share the same filesystem (e.g., a network volume), they share shape data and metadata. This is the recommended approach because shape handles remain stable across deploys &mdash; clients don't need sticky sessions and experience minimal disruption.

### How it works

```
Time ──────────────────────────────────────────────────────────►

Instance A    [===== active (200) =====]---shutdown---X
                                         lock released ─┐
Instance B         [starting (202)][waiting (202)]──────┴─[=== active (200) ===]
                        │                │                        │
                        │          serves existing          fully operational
                   loading metadata   shapes (read-only)
```

1. **Instance A** is active, holding the advisory lock, serving all shapes
2. **Instance B** starts, loads shape metadata from the shared SQLite database, and enters read-only mode (health returns `202` "waiting")
3. **Instance B** can serve requests for existing shapes while waiting
4. The orchestrator sends SIGTERM to **Instance A**
5. **Instance A** shuts down, its database connection drops, and the advisory lock is released
6. **Instance B** acquires the lock and becomes fully active (health returns `200`)

### When to use

- Kubernetes with [ReadWriteMany](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#access-modes) PersistentVolumeClaims
- AWS ECS with [EFS](https://aws.amazon.com/efs/) volumes
- Any platform with a shared or network filesystem

### Configuration

Both instances use identical configuration. The key requirement is that `ELECTRIC_STORAGE_DIR` points to a shared filesystem:

```shell
DATABASE_URL=postgresql://user:password@host:5432/mydb
ELECTRIC_STORAGE_DIR=/shared/electric/data
ELECTRIC_SECRET=your-secret
```

> [!Warning] SQLite on network filesystems
> Electric uses SQLite for shape metadata. SQLite can have issues with locking on network filesystems like NFS or EFS. To avoid corruption, either:
>
> - Set [`ELECTRIC_SHAPE_DB_EXCLUSIVE_MODE=true`](/docs/api/config#electric-shape-db-exclusive-mode) to use a single read-write connection
> - Or set [`ELECTRIC_SHAPE_DB_STORAGE_DIR`](/docs/api/config#electric-shape-db-storage-dir) to a local (non-shared) path to keep the SQLite database on local storage while sharing shape logs on the network filesystem

### Docker Compose example

This example demonstrates the shared-storage setup with two Electric instances behind a load balancer. In practice, your orchestrator handles starting and stopping instances during a rolling deploy.

```yaml
services:
  electric:
    image: electricsql/electric:latest
    environment:
      DATABASE_URL: postgresql://postgres:password@postgres:5432/myapp
      ELECTRIC_STORAGE_DIR: /var/lib/electric/data
      ELECTRIC_SHAPE_DB_EXCLUSIVE_MODE: "true"
      ELECTRIC_SECRET: ${ELECTRIC_SECRET}
    ports:
      - "3000:3000"
    volumes:
      - electric_data:/var/lib/electric/data
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:3000/v1/health"]
      interval: 10s
      timeout: 2s
      retries: 3

volumes:
  electric_data:
```

To simulate a rolling deploy locally, you can scale up a second instance before stopping the first:

```shell
docker compose up -d --scale electric=2
# Wait for the new instance to be healthy, then scale back down
docker compose up -d --scale electric=1
```

### Kubernetes example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: electric
spec:
  replicas: 1
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
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
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: electric-secrets
                  key: database-url
            - name: ELECTRIC_STORAGE_DIR
              value: "/var/lib/electric/data"
            - name: ELECTRIC_SHAPE_DB_EXCLUSIVE_MODE
              value: "true"
            - name: ELECTRIC_SECRET
              valueFrom:
                secretKeyRef:
                  name: electric-secrets
                  key: electric-secret
          volumeMounts:
            - name: electric-storage
              mountPath: /var/lib/electric/data
          livenessProbe:
            httpGet:
              path: /v1/health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 2
          readinessProbe:
            httpGet:
              path: /v1/health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
      volumes:
        - name: electric-storage
          persistentVolumeClaim:
            claimName: electric-shared-pvc
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: electric-shared-pvc
spec:
  accessModes:
    - ReadWriteMany
  resources:
    requests:
      storage: 10Gi
```

With `maxSurge: 1` and `maxUnavailable: 0`, Kubernetes will:

1. Start a new pod alongside the existing one
2. The new pod enters read-only mode (`202` "waiting") and passes the readiness probe (any 2xx)
3. Kubernetes terminates the old pod
4. The old pod shuts down, releasing the advisory lock
5. The new pod acquires the lock and becomes fully active (`200`)

> [!Warning] Don't check for exactly HTTP 200 in your readiness probe
> The readiness probe must accept `202` responses. If you only accept `200`, the new pod can never become ready while the old pod holds the lock, creating a deadlock. Standard Kubernetes `httpGet` probes treat any 2xx as success, which is the correct behavior here.

### AWS ECS example

```json
{
  "family": "electric",
  "networkMode": "awsvpc",
  "containerDefinitions": [
    {
      "name": "electric",
      "image": "electricsql/electric:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "ELECTRIC_STORAGE_DIR",
          "value": "/var/lib/electric/data"
        },
        {
          "name": "ELECTRIC_SHAPE_DB_EXCLUSIVE_MODE",
          "value": "true"
        }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:electric/database-url"
        },
        {
          "name": "ELECTRIC_SECRET",
          "valueFrom": "arn:aws:secretsmanager:region:account:secret:electric/secret"
        }
      ],
      "mountPoints": [
        {
          "sourceVolume": "electric-efs",
          "containerPath": "/var/lib/electric/data"
        }
      ],
      "healthCheck": {
        "command": [
          "CMD-SHELL",
          "curl -sf http://localhost:3000/v1/health || exit 1"
        ],
        "interval": 10,
        "timeout": 2,
        "retries": 3,
        "startPeriod": 15
      }
    }
  ],
  "volumes": [
    {
      "name": "electric-efs",
      "efsVolumeConfiguration": {
        "fileSystemId": "fs-0123456789abcdef0",
        "rootDirectory": "/electric"
      }
    }
  ]
}
```

Configure your ECS service for rolling deploys:

```json
{
  "deploymentConfiguration": {
    "minimumHealthyPercent": 100,
    "maximumPercent": 200
  }
}
```

This ensures ECS starts the new task before stopping the old one, allowing the advisory lock handover to occur.

> [!Tip] ECS health check grace period
> Set the health check grace period on your ECS service to allow time for the new task to acquire the advisory lock. A value of 60&ndash;90 seconds is typically sufficient.

## Separate storage (ephemeral)

When shared storage is not available (e.g., ECS with ephemeral block storage, containers with local-only disks), each instance maintains its own shape data independently. This requires a different approach.

### When to use

- AWS ECS without EFS
- Container platforms with ephemeral storage only
- Development or staging environments where simplicity is preferred over durability

### Option A: Separate replication stream IDs

Give each concurrent instance its own [`ELECTRIC_REPLICATION_STREAM_ID`](/docs/api/config#electric-replication-stream-id). This creates separate replication slots and advisory locks, allowing both instances to be fully active simultaneously.

```shell
# Instance A (e.g., blue deployment)
ELECTRIC_REPLICATION_STREAM_ID=deploy-blue
ELECTRIC_STORAGE_DIR=/local/electric/data

# Instance B (e.g., green deployment)
ELECTRIC_REPLICATION_STREAM_ID=deploy-green
ELECTRIC_STORAGE_DIR=/local/electric/data
```

Each instance maintains its own set of shape handles. The same shape definition will have **different handles** on each instance.

> [!Warning] Sticky sessions required
> You **must** use sticky sessions (session affinity) on your load balancer. A client following shape handle `A` on Instance X cannot switch to Instance Y &mdash; that handle doesn't exist there. Without sticky sessions, clients will receive `409` responses when their requests land on the wrong instance.

> [!Warning] Postgres resource overhead
> Each replication stream ID creates its own replication slot and publication. Multiple replication slots increase WAL retention on Postgres since each slot independently prevents WAL from being cleaned up.
>
> Monitor your replication slots as described in the [Troubleshooting guide](/docs/guides/troubleshooting#wal-growth-mdash-why-is-my-postgres-database-storage-filling-up). Clean up unused slots promptly when old instances are fully decommissioned.

When the old deployment is fully stopped, you should clean up its replication slot and publication in Postgres:

```sql
SELECT pg_drop_replication_slot('electric_slot_deploy_blue');
DROP PUBLICATION IF EXISTS electric_publication_deploy_blue;
```

### Option B: Temporary replication slots

Use temporary replication slots that are automatically cleaned up when the connection closes. This avoids accumulating orphaned slots but comes with tradeoffs around crash recovery.

```shell
CLEANUP_REPLICATION_SLOTS_ON_SHUTDOWN=true
ELECTRIC_TEMPORARY_REPLICATION_SLOT_USE_RANDOM_NAME=true
ELECTRIC_STORAGE_DIR=/local/electric/data
```

With this configuration:

- Electric creates a `TEMPORARY` replication slot on the database connection
- On **clean shutdown**, the slot is dropped and Postgres frees the retained WAL
- The new instance creates a fresh temporary slot and starts replicating

> [!Warning] Network partitions cause shape rotations
> If Electric crashes or loses its database connection unexpectedly, the temporary slot is lost. When the new instance starts with a fresh slot, clients connected to old shapes will receive `409` (must-refetch) responses and must perform a full resync.
>
> If your application cannot tolerate occasional `409`s during failure scenarios, prefer [shared storage](#shared-storage-recommended) instead.

See the config reference for [`CLEANUP_REPLICATION_SLOTS_ON_SHUTDOWN`](/docs/api/config#cleanup-replication-slots-on-shutdown) and [`ELECTRIC_TEMPORARY_REPLICATION_SLOT_USE_RANDOM_NAME`](/docs/api/config#electric-temporary-replication-slot-use-random-name).

## Choosing a strategy

| | Shared storage | Separate stream IDs | Temporary slots |
|---|---|---|---|
| Client disruption during deploy | Minimal (new shapes delayed) | None (both active) | Minimal on clean shutdown; 409s on crash |
| Sticky sessions required | No | Yes | No |
| Postgres resource overhead | Single slot | Multiple slots (WAL growth) | Single slot (temporary) |
| Complexity | Low | Medium | Medium |
| Best for | Most deployments | When shared storage is unavailable | Ephemeral / dev environments |

## Client behavior during deploys

The official [TypeScript client](/docs/api/clients/typescript) handles deploy transitions automatically:

- **`503` with `Retry-After` header**: The client backs off and retries. This happens when requesting new shapes during the read-only window.
- **`409` (must-refetch)**: The client refetches the shape from scratch. This happens with separate-storage strategies or when shapes are rotated.
- **Long-poll connections**: Existing long-poll connections on active shapes continue working normally during the read-only window.

If you're using a custom client, ensure it handles these response codes. See the [HTTP API docs](/docs/api/http) for details on the protocol.

## Troubleshooting

**"My second instance is stuck in 'waiting' state"**

This is expected behavior. The second instance has loaded shape metadata and is serving existing shapes in read-only mode while waiting for the first instance to release the advisory lock. Check `/v1/health` to confirm &mdash; a `202` response with `{"status": "waiting"}` indicates the instance is healthy and serving reads.

**"There's a gap where no instance returns 200"**

During the advisory lock handover, there is a brief window (typically under a minute) where the new instance is waiting for the lock. During this window, existing shapes continue to be served (read-only mode). New shape creation returns `503` with a `Retry-After` header. This is expected and handled gracefully by clients.

**"Should I use separate `ELECTRIC_REPLICATION_STREAM_ID` values?"**

Only if you cannot share storage between instances. Shared storage with a single stream ID is simpler, avoids the need for sticky sessions, and keeps a single replication slot on Postgres. Separate stream IDs are appropriate when shared storage is truly unavailable.

**"Clients are getting 409 errors during deploys"**

With shared storage, 409s should not occur during normal rolling deploys. If you're seeing 409s, check:

- That both instances are pointing to the same `ELECTRIC_STORAGE_DIR` on a shared filesystem
- That the shape wasn't invalidated by a schema change happening concurrently with the deploy

With separate storage (temporary slots or separate stream IDs), 409s during deploys are expected. Ensure your client handles `409` responses by refetching the shape.

## Next steps

- [Deployment guide](/docs/guides/deployment) for general deployment setup
- [Sharding guide](/docs/guides/sharding) for multi-database deployment patterns
- [Config reference](/docs/api/config) for all configuration options
- [Troubleshooting guide](/docs/guides/troubleshooting) for common operational issues
