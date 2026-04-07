---
title: Upgrading - Guide
description: >-
  How to upgrade the Electric sync service with minimal disruption.
outline: [2, 3]
---

# Upgrading

How to upgrade the [Electric sync engine](/primitives/postgres-sync) with minimal disruption using rolling deployments. This guide covers two deployment scenarios: [shared storage](#shared-storage-recommended) (recommended) and [separate storage](#separate-storage-ephemeral) for ephemeral environments.

Before reading this guide, make sure you're familiar with the [Deployment guide](/docs/guides/deployment) for general setup.

## Overview

Electric is designed to run as a **single active instance** per replication stream. It uses a PostgreSQL advisory lock &mdash; a cooperative lock used for application-level coordination that does not lock any tables or rows &mdash; to ensure only one instance actively replicates from Postgres at a time.

When you deploy a new version:

1. The **new instance** starts and loads shape metadata from storage
2. While the old instance holds the lock, the new instance enters **read-only mode** &mdash; it can serve requests for existing shapes but cannot create new ones
3. Once the old instance shuts down, its database connection drops and the lock is released
4. The **new instance** acquires the lock and becomes fully active

```
Time ────────────────────────────────────────────►

Old    [==== active (200) ====]--shutdown--X
                                lock released─┐
New       [starting][waiting (202)]───────────┴─[== active ==]
              │           │                         │
          loading    serves existing          fully operational
          metadata   shapes (read-only)
```

The read-only window is typically brief &mdash; a few seconds to under a minute, depending on how quickly your orchestrator terminates the old instance. During this window, existing shapes continue to be served. Requests for new shapes return `503` with a `Retry-After` header until the new instance becomes active. The official [TypeScript client](/docs/api/clients/typescript) handles both of these automatically.

### Choosing a strategy

| | Shared storage | Separate storage |
|---|---|---|
| Client disruption | Minimal (new shapes briefly delayed) | 409s (clients must refetch shapes) |
| Sticky sessions required | No | Yes |
| Postgres overhead | Single slot | One slot per instance |
| Best for | [Most deployments](#shared-storage-recommended) | [Ephemeral environments](#separate-storage-ephemeral) |

## How the advisory lock works

The advisory lock is tied to the replication slot name:

```sql
SELECT pg_advisory_lock(hashtext('electric_slot_{stream_id}'))
```

This lock is scoped to Electric's replication slot name and does not conflict with any other advisory locks or table-level locks in your database.

- Only one instance can hold the lock per [`ELECTRIC_REPLICATION_STREAM_ID`](/docs/api/config#electric-replication-stream-id)
- The lock is held on the replication database connection &mdash; if the connection drops (e.g., instance shutdown), the lock is automatically released

> [!Tip] Lock breaker
> Electric includes a lock breaker mechanism that can detect and terminate stale database connections holding the lock. This prevents indefinite lock contention if the previous instance failed to cleanly release it &mdash; for example, after a crash or network partition where the Postgres connection was not properly closed.

## Health check behavior during upgrades

The [`/v1/health`](/docs/guides/deployment#health-checks) endpoint reflects the instance's current state:

| HTTP Status | Response | Meaning |
|-------------|----------|---------|
| `200` | `{"status": "active"}` | The instance is active &mdash; it holds the advisory lock and is fully operational |
| `202` | `{"status": "waiting"}` | The instance is ready &mdash; it can serve existing shapes in read-only mode but is not yet active |
| `202` | `{"status": "starting"}` | The instance is starting up and not yet ready to serve any requests |

During the `waiting` state:

- Requests for **existing shapes** are served normally (read-only mode)
- Requests that require **creating new shapes** return `503` with a `Retry-After: 5` header
- **Shape deletion** also requires active mode and returns `503` while waiting

For orchestrator probe configuration, see the [health check section](#health-checks-must-accept-http-202) below.

## Shared storage (recommended)

When instances share the same filesystem (e.g., a persistent volume), they share shape data and metadata. This is the recommended approach because shape handles remain stable across deploys &mdash; clients don't need sticky sessions and experience minimal disruption.

### When to use

- Kubernetes with [ReadWriteMany](https://kubernetes.io/docs/concepts/storage/persistent-volumes/#access-modes) PersistentVolumeClaims
- AWS ECS on EC2 with shared host volumes (use [placement constraints](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-placement-constraints.html) to keep tasks on the same host)
- Any platform where both instances can access the same filesystem

> [!Warning] Network filesystems and performance
> Electric is IO-intensive &mdash; it reads and writes shape logs and metadata frequently. Network filesystems like [EFS](https://aws.amazon.com/efs/) or NFS add significant latency compared to local storage and may not perform well for large deployments. Prefer local volumes (e.g., NVMe SSDs on EC2 with host bind mounts) where possible. If you must use a network filesystem, see the [troubleshooting guide](/docs/guides/troubleshooting#sqlite-corruption-mdash-why-is-my-shape-metadata-database-corrupt-on-nfs-efs) for important SQLite configuration.

### Configuration

Both instances use identical configuration. The key requirement is that `ELECTRIC_STORAGE_DIR` points to a shared filesystem:

```shell
DATABASE_URL=postgresql://user:password@host:5432/mydb
ELECTRIC_STORAGE_DIR=/shared/electric/data
ELECTRIC_SECRET=your-secret
```

### Docker Compose example

This example demonstrates the shared-storage setup. In practice, your orchestrator handles starting and stopping instances during an upgrade.

```yaml
services:
  electric:
    image: electricsql/electric:latest
    environment:
      DATABASE_URL: postgresql://postgres:password@postgres:5432/myapp
      ELECTRIC_STORAGE_DIR: /var/lib/electric/data
      # Required for shared network filesystems — see troubleshooting guide
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
            # Required for shared network filesystems
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

### AWS ECS example

This example uses EC2 launch type with a host bind mount for shared storage. Both old and new tasks share the same directory on the EC2 host.

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
          "sourceVolume": "electric-data",
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
      "name": "electric-data",
      "host": {
        "sourcePath": "/var/lib/electric/data"
      }
    }
  ],
  "placementConstraints": [
    {
      "type": "memberOf",
      "expression": "attribute:ecs.instance-type matches i3en.*"
    }
  ]
}
```

Configure your ECS service for rolling upgrades:

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

### Health checks must accept HTTP 202

Your orchestrator's health or readiness check must accept `202` responses during upgrades. If it only considers `200` as healthy, the new instance can never become ready while the old instance holds the lock &mdash; creating a deadlock where the orchestrator waits for the new instance before terminating the old one.

Both Kubernetes `httpGet` probes and ECS health checks using `curl -sf` accept any 2xx by default, which is the correct behavior for rolling upgrades.

> [!Warning] Single-instance readiness probes
> The [Deployment guide](/docs/guides/deployment#kubernetes-probes) recommends an `exec` readiness probe that checks for exactly HTTP `200`. That approach is correct for single-instance deployments where you don't want a starting instance to receive traffic, but it will deadlock during rolling upgrades. If you are performing rolling upgrades, use `httpGet` readiness probes as shown in the examples above.

## Separate storage (ephemeral)

When shared storage is not available (e.g., ECS with ephemeral block storage, containers with local-only disks), each instance must have its own replication slot and maintains its own shape data independently. This means each instance has **different shape handles** for the same shape definitions, so clients **must** use sticky sessions and will receive `409` (must-refetch) responses when they switch between instances during a deploy.

The platform examples from the [shared storage](#shared-storage-recommended) section above apply &mdash; just remove the shared volume mount and use the configuration shown here.

There are two ways to manage the per-instance replication slots:

### Temporary replication slots

Use temporary replication slots that are automatically cleaned up when the connection closes. This is the simplest approach for ephemeral storage and avoids accumulating orphaned slots.

```shell
CLEANUP_REPLICATION_SLOTS_ON_SHUTDOWN=true
ELECTRIC_TEMPORARY_REPLICATION_SLOT_USE_RANDOM_NAME=true
ELECTRIC_STORAGE_DIR=/local/electric/data
```

The random name option avoids replication slot name conflicts when old and new instances briefly overlap during a rolling upgrade.

With this configuration:

- Electric creates a `TEMPORARY` replication slot on the database connection
- On **clean shutdown**, the slot is dropped and Postgres frees the retained WAL
- The new instance creates a fresh temporary slot and starts replicating

> [!Warning] Network partitions cause shape rotations
> If Electric crashes or loses its database connection unexpectedly, the temporary slot is lost. When the new instance starts with a fresh slot, all existing shapes are invalidated and clients receive `409` (must-refetch) responses requiring a full resync. See [Replication slot recreation](/docs/guides/troubleshooting#replication-slot-recreation-mdash-why-are-all-clients-resyncing-after-a-crash) in the troubleshooting guide for more details.

See the config reference for [`CLEANUP_REPLICATION_SLOTS_ON_SHUTDOWN`](/docs/api/config#cleanup-replication-slots-on-shutdown) and [`ELECTRIC_TEMPORARY_REPLICATION_SLOT_USE_RANDOM_NAME`](/docs/api/config#electric-temporary-replication-slot-use-random-name).

### Separate replication stream IDs

Alternatively, give each concurrent instance its own [`ELECTRIC_REPLICATION_STREAM_ID`](/docs/api/config#electric-replication-stream-id). This creates named replication slots that persist, giving you more explicit control. This is different from [sharding](/docs/guides/sharding), where separate stream IDs are used for instances connecting to different databases &mdash; here, both instances connect to the same database.

```shell
# Instance A (e.g., blue deployment)
ELECTRIC_REPLICATION_STREAM_ID=deploy-blue
ELECTRIC_STORAGE_DIR=/local/electric/data

# Instance B (e.g., green deployment)
ELECTRIC_REPLICATION_STREAM_ID=deploy-green
ELECTRIC_STORAGE_DIR=/local/electric/data
```

> [!Warning] Postgres resource overhead
> Each replication stream ID creates its own replication slot and publication. Multiple replication slots increase WAL retention on Postgres since each slot independently prevents WAL from being cleaned up.
>
> Monitor your replication slots as described in the [Troubleshooting guide](/docs/guides/troubleshooting#wal-growth-mdash-why-is-my-postgres-database-storage-filling-up). Clean up unused slots promptly when old instances are fully decommissioned.

When the old deployment is fully stopped, clean up its replication slot and publication in Postgres. The names follow the pattern `electric_slot_{stream_id}` and `electric_publication_{stream_id}`:

```sql
SELECT pg_drop_replication_slot('electric_slot_deploy_blue');
DROP PUBLICATION IF EXISTS electric_publication_deploy_blue;
```

## Client behavior during deploys

The official [TypeScript client](/docs/api/clients/typescript) handles deploy transitions automatically:

- **`503` with `Retry-After` header**: The client backs off and retries. This happens when requesting new shapes during the read-only window.
- **`409` (must-refetch)**: The client refetches the shape from scratch. This happens with separate-storage strategies or when shapes are rotated.
- **Long-poll connections**: Existing long-poll connections on active shapes continue working normally during the read-only window.

If you're using a custom client, ensure it handles these response codes. See the [HTTP API docs](/docs/api/http) for details on the protocol.

## Next steps

- [Deployment guide](/docs/guides/deployment) for general deployment setup
- [Sharding guide](/docs/guides/sharding) for multi-database deployment patterns
- [Config reference](/docs/api/config) for all configuration options
- [Troubleshooting guide](/docs/guides/troubleshooting#rolling-upgrades-mdash-why-is-my-second-instance-stuck-in-waiting-state) for common upgrade issues
