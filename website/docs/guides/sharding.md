---
title: Sharding - Guide
description: >-
  How to use Electric with sharded PostgreSQL databases.
outline: [2, 3]
---

<img src="/img/icons/sharding.svg" class="product-icon"
    style="width: 72px"
/>

# Sharding

How to use Electric with sharded PostgreSQL databases. Including patterns for [multi-instance deployments](#multi-instance-deployment) and [routing strategies](#routing-strategies).

## Overview

Electric connects to a single PostgreSQL database per instance. If your data is spread across multiple PostgreSQL shards, you deploy multiple Electric instances&mdash;one per shard&mdash;and route requests to the correct instance based on where the data lives.

This pattern provides:

- **Independent scaling** per shard
- **Fault isolation** between shards
- **Flexibility** to use your existing sharding scheme

### Architecture

```
                    ┌─────────────────┐
                    │  Your App /     │
                    │  Routing Proxy  │
                    └────────┬────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
           ▼                 ▼                 ▼
    ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
    │  Electric   │   │  Electric   │   │  Electric   │
    │  (shard 0)  │   │  (shard 1)  │   │  (shard 2)  │
    └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
           │                 │                 │
           ▼                 ▼                 ▼
    ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
    │  Postgres   │   │  Postgres   │   │  Postgres   │
    │  (shard 0)  │   │  (shard 1)  │   │  (shard 2)  │
    └─────────────┘   └─────────────┘   └─────────────┘
```

Your application (or a routing proxy) determines which shard contains the requested data and routes to the corresponding Electric instance.

## Multi-instance deployment

Deploy one Electric instance per PostgreSQL shard. Each instance needs unique configuration to avoid conflicts.

### Configuration per instance

Each Electric instance requires:

| Config | Purpose | Example |
|--------|---------|---------|
| [`DATABASE_URL`](/docs/api/config#database-url) | Connection to this shard's Postgres | `postgresql://...@shard-0/db` |
| [`ELECTRIC_INSTANCE_ID`](/docs/api/config#electric-instance-id) | Unique identifier for telemetry | `electric-shard-0` |
| [`ELECTRIC_REPLICATION_STREAM_ID`](/docs/api/config#replication-stream-id) | Unique suffix for replication slot/publication | `shard-0` |
| [`ELECTRIC_STORAGE_DIR`](/docs/api/config#electric-storage-dir) | Persistent storage path | `/data/shard-0` |

### Docker Compose example

```yaml
services:
  # Electric for Shard 0
  electric-shard-0:
    image: electricsql/electric:latest
    environment:
      DATABASE_URL: postgresql://postgres:password@postgres-shard-0:5432/myapp
      ELECTRIC_INSTANCE_ID: electric-shard-0
      ELECTRIC_REPLICATION_STREAM_ID: shard-0
      ELECTRIC_STORAGE_DIR: /var/lib/electric/data
      ELECTRIC_SECRET: ${ELECTRIC_SECRET}
    ports:
      - "3001:3000"
    volumes:
      - electric_data_0:/var/lib/electric/data

  # Electric for Shard 1
  electric-shard-1:
    image: electricsql/electric:latest
    environment:
      DATABASE_URL: postgresql://postgres:password@postgres-shard-1:5432/myapp
      ELECTRIC_INSTANCE_ID: electric-shard-1
      ELECTRIC_REPLICATION_STREAM_ID: shard-1
      ELECTRIC_STORAGE_DIR: /var/lib/electric/data
      ELECTRIC_SECRET: ${ELECTRIC_SECRET}
    ports:
      - "3002:3000"
    volumes:
      - electric_data_1:/var/lib/electric/data

  # Add more shards as needed...

volumes:
  electric_data_0:
  electric_data_1:
```

### Kubernetes example

For Kubernetes deployments, you can use a StatefulSet or separate Deployments per shard:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: electric-shard-0
spec:
  replicas: 1
  selector:
    matchLabels:
      app: electric
      shard: "0"
  template:
    metadata:
      labels:
        app: electric
        shard: "0"
    spec:
      containers:
        - name: electric
          image: electricsql/electric:latest
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: electric-shard-0-secrets
                  key: database-url
            - name: ELECTRIC_INSTANCE_ID
              value: "electric-shard-0"
            - name: ELECTRIC_REPLICATION_STREAM_ID
              value: "shard-0"
            - name: ELECTRIC_STORAGE_DIR
              value: "/var/lib/electric/data"
          volumeMounts:
            - name: electric-storage
              mountPath: /var/lib/electric/data
      volumes:
        - name: electric-storage
          persistentVolumeClaim:
            claimName: electric-shard-0-pvc
```

## Routing strategies

The key to sharding with Electric is routing requests to the correct instance. Your application knows which shard contains each user's data&mdash;use this knowledge to route shape requests.

### Client-side routing

The simplest approach: clients determine the shard and connect directly to the correct Electric instance.

```typescript
import { ShapeStream } from '@electric-sql/client'

// Your sharding logic - determines which shard has the user's data
function getShardUrl(userId: string): string {
  // Option 1: Lookup from a shard directory
  const shardId = shardDirectory.get(userId)

  // Option 2: Consistent hashing
  // const shardId = hash(userId) % NUM_SHARDS

  return `https://electric-shard-${shardId}.example.com`
}

// Create a shape stream to the correct shard
function createUserStream(userId: string) {
  const shardUrl = getShardUrl(userId)

  return new ShapeStream({
    url: `${shardUrl}/v1/shape`,
    params: {
      table: 'user_data',
      where: `user_id = '${userId}'`,
    },
  })
}
```

This works well when:

- Shard mapping is available client-side
- You can expose multiple Electric endpoints to clients
- You want minimal server infrastructure

### Proxy-based routing

For more control, route requests through a proxy that determines the shard server-side. This hides sharding complexity from clients.

```typescript
// proxy/server.ts
import express from 'express'

const app = express()

// Shard URL mapping
const SHARD_URLS: Record<number, string> = {
  0: 'http://electric-shard-0:3000',
  1: 'http://electric-shard-1:3000',
  2: 'http://electric-shard-2:3000',
  // ... add all shards
}

// Your sharding logic
function getShardId(userId: string): number {
  // Lookup from database, cache, or compute via hashing
  return userShardMap.get(userId) ?? hashToShard(userId)
}

app.get('/v1/shape', async (req, res) => {
  // Extract user identifier from request
  // Could come from: query params, JWT claims, headers, etc.
  const userId = req.query.user_id as string
    || extractUserIdFromToken(req.headers.authorization)

  if (!userId) {
    return res.status(400).json({
      error: 'user_id required for shard routing'
    })
  }

  // Determine target shard
  const shardId = getShardId(userId)
  const targetUrl = SHARD_URLS[shardId]

  if (!targetUrl) {
    return res.status(500).json({
      error: `Unknown shard: ${shardId}`
    })
  }

  // Build upstream URL with all query parameters
  const upstreamUrl = new URL('/v1/shape', targetUrl)
  Object.entries(req.query).forEach(([key, value]) => {
    if (key !== 'user_id') { // Don't forward routing param
      upstreamUrl.searchParams.set(key, value as string)
    }
  })

  // Forward request to correct Electric instance
  const response = await fetch(upstreamUrl, {
    headers: {
      'Authorization': `Bearer ${process.env.ELECTRIC_SECRET}`,
    },
  })

  // Stream response back to client
  res.status(response.status)
  response.headers.forEach((value, key) => {
    // Skip headers that shouldn't be forwarded
    if (!['content-encoding', 'content-length'].includes(key.toLowerCase())) {
      res.setHeader(key, value)
    }
  })

  response.body?.pipe(res)
})

app.listen(3000)
```

Client usage with proxy:

```typescript
import { ShapeStream } from '@electric-sql/client'

// Client doesn't need to know about shards
const stream = new ShapeStream({
  url: 'https://api.example.com/v1/shape',
  params: {
    table: 'user_data',
    user_id: currentUserId, // Proxy uses this for routing
  },
})
```

### Edge routing

For optimal performance with a CDN, implement routing at the edge. This minimizes latency while keeping sharding logic server-side.

```typescript
// Cloudflare Worker or similar edge function
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Extract user ID from request
    const userId = url.searchParams.get('user_id')
      || getUserIdFromJWT(request.headers.get('Authorization'))

    if (!userId) {
      return new Response('user_id required', { status: 400 })
    }

    // Determine shard (edge KV lookup or compute)
    const shardId = await getShardForUser(userId)

    // Route to correct Electric instance
    const targetOrigin = `https://electric-shard-${shardId}.internal`
    const targetUrl = new URL(url.pathname + url.search, targetOrigin)

    return fetch(targetUrl, {
      headers: request.headers,
    })
  },
}
```

## Shard mapping strategies

How you map users to shards depends on your existing sharding scheme:

### Directory-based mapping

Store user-to-shard mappings in a fast lookup service:

```typescript
// Using Redis
async function getShardId(userId: string): Promise<number> {
  const shardId = await redis.get(`shard:${userId}`)
  return parseInt(shardId ?? '0', 10)
}

// Using a database table
async function getShardId(userId: string): Promise<number> {
  const result = await db.query(
    'SELECT shard_id FROM user_shards WHERE user_id = $1',
    [userId]
  )
  return result.rows[0]?.shard_id ?? 0
}
```

### Hash-based mapping

Compute shard from user ID without a lookup:

```typescript
function getShardId(userId: string, numShards: number): number {
  // Simple hash
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i)
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash) % numShards
}

// Or use a proper consistent hashing library
import { ConsistentHash } from 'consistent-hash'

const ring = new ConsistentHash()
ring.add('shard-0')
ring.add('shard-1')
ring.add('shard-2')

function getShardId(userId: string): string {
  return ring.get(userId) // Returns 'shard-0', 'shard-1', etc.
}
```

### Range-based mapping

Map ranges of IDs to shards:

```typescript
function getShardId(userId: string): number {
  const numericId = parseInt(userId.replace(/\D/g, ''), 10)

  if (numericId < 1000000) return 0
  if (numericId < 2000000) return 1
  if (numericId < 3000000) return 2
  // ...
  return 9 // Default shard
}
```

## Combining with auth

Sharding works naturally with Electric's [auth patterns](/docs/guides/auth). Your proxy can handle both shard routing and authorization:

```typescript
app.get('/v1/shape', async (req, res) => {
  // 1. Authenticate
  const user = await validateToken(req.headers.authorization)
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // 2. Determine shard from authenticated user
  const shardId = getShardId(user.id)
  const targetUrl = SHARD_URLS[shardId]

  // 3. Build request with authorization constraints
  const upstreamUrl = new URL('/v1/shape', targetUrl)
  upstreamUrl.searchParams.set('table', req.query.table as string)

  // Enforce user can only access their own data
  upstreamUrl.searchParams.set('where', `user_id = '${user.id}'`)

  // 4. Forward to Electric
  const response = await fetch(upstreamUrl, {
    headers: {
      'Authorization': `Bearer ${process.env.ELECTRIC_SECRET}`,
    },
  })

  // Stream response...
})
```

## Health checks and monitoring

Monitor all Electric instances for a complete view of your sharded deployment:

```typescript
// Health check aggregator
async function checkAllShards(): Promise<ShardHealth[]> {
  const checks = Object.entries(SHARD_URLS).map(async ([shardId, url]) => {
    try {
      const response = await fetch(`${url}/v1/health`, {
        timeout: 5000,
      })
      const data = await response.json()
      return {
        shardId,
        status: data.status,
        healthy: response.ok,
      }
    } catch (error) {
      return {
        shardId,
        status: 'unreachable',
        healthy: false,
      }
    }
  })

  return Promise.all(checks)
}
```

Each Electric instance exposes metrics via [OpenTelemetry](/docs/reference/telemetry). Configure each instance with a unique `ELECTRIC_INSTANCE_ID` to distinguish metrics per shard in your observability platform.

## Considerations

### Data locality

Electric syncs data from a single shard. If a query needs data from multiple shards, clients must:

1. Make separate shape requests to each relevant shard
2. Merge results client-side

For most use cases where data is partitioned by user or tenant, this isn't an issue&mdash;all of a user's data lives on one shard.

### Failover

Each Electric instance is independent. If one shard's Electric instance goes down:

- Other shards continue operating normally
- Only users on the affected shard are impacted
- Restarting the instance resumes sync from where it left off (thanks to persistent storage)

### Resharding

If you need to move users between shards:

1. Update your shard mapping (directory, config, etc.)
2. New requests route to the new shard
3. Clients automatically sync fresh data from the new shard

Electric is stateless from the client's perspective&mdash;changing which instance serves a user's data is transparent.

## Next steps

- Review the [deployment guide](/docs/guides/deployment) for production configuration
- See [auth patterns](/docs/guides/auth) for securing your sharded deployment
- Check [benchmarks](/docs/reference/benchmarks) for performance expectations per shard
