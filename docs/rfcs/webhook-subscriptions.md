# RFC: Webhook Subscriptions for Electric

## Summary

Add support for webhook subscriptions that POST new operations to user-provided URLs. This enables push-based integrations where external systems receive real-time notifications of database changes without maintaining persistent connections.

## Problem Statement

Currently, Electric provides excellent real-time sync capabilities via:
- **SSE (Server-Sent Events)**: Persistent connections streaming changes
- **Long-polling**: HTTP requests that wait for new changes

Both approaches require clients to maintain active connections to Electric. This works well for frontend applications but presents challenges for:

1. **Serverless backends**: Functions that spin up on-demand can't maintain persistent connections
2. **Third-party integrations**: External services (Zapier, n8n, webhooks) expect push-based notifications
3. **Event-driven architectures**: Systems designed around webhooks for loose coupling
4. **Mobile backends**: Services that need to react to changes without holding connections open
5. **Multi-region deployments**: Webhook targets can be load-balanced across regions

### Use Cases

- **Invalidate CDN cache** when data changes
- **Trigger serverless functions** (AWS Lambda, Cloudflare Workers, Vercel Edge)
- **Send notifications** when specific records change
- **Sync to external systems** (analytics, search indices, CRMs)
- **Audit logging** to external services
- **Real-time dashboards** via services like Pusher or Ably

## Proposed Solution

Add a CRUD API for managing webhook subscriptions. Each subscription:
- Subscribes to a specific **shape** (table + optional where clause + columns)
- POSTs batched operations to a configured **URL**
- Includes authentication via **headers** or **signing secrets**
- Tracks delivery with **at-least-once** semantics

### API Design

#### Create Subscription

```http
POST /v1/webhooks
Content-Type: application/json

{
  "shape": {
    "table": "orders",
    "where": "status = 'pending'",
    "columns": ["id", "customer_id", "total", "status"]
  },
  "url": "https://api.example.com/hooks/orders",
  "headers": {
    "Authorization": "Bearer xxx"
  },
  "signing_secret": "whsec_...",
  "batch": {
    "max_size": 100,
    "max_wait_ms": 1000
  },
  "retry": {
    "max_attempts": 5,
    "backoff": "exponential"
  }
}
```

**Response:**
```json
{
  "id": "wh_abc123",
  "shape_handle": "orders-3-1733400000000",
  "status": "active",
  "created_at": "2025-12-05T12:00:00Z",
  "url": "https://api.example.com/hooks/orders"
}
```

#### List Subscriptions

```http
GET /v1/webhooks
```

**Response:**
```json
{
  "webhooks": [
    {
      "id": "wh_abc123",
      "shape_handle": "orders-3-1733400000000",
      "status": "active",
      "url": "https://api.example.com/hooks/orders",
      "created_at": "2025-12-05T12:00:00Z",
      "stats": {
        "delivered": 1523,
        "failed": 2,
        "pending": 0,
        "last_delivery_at": "2025-12-05T14:30:00Z"
      }
    }
  ]
}
```

#### Get Subscription

```http
GET /v1/webhooks/:id
```

#### Update Subscription

```http
PATCH /v1/webhooks/:id
Content-Type: application/json

{
  "url": "https://new-api.example.com/hooks/orders",
  "status": "paused"
}
```

#### Delete Subscription

```http
DELETE /v1/webhooks/:id
```

### Webhook Payload Format

Each webhook delivery POSTs a batch of operations:

```http
POST https://api.example.com/hooks/orders
Content-Type: application/json
X-Electric-Signature: sha256=...
X-Electric-Webhook-ID: wh_abc123
X-Electric-Delivery-ID: del_xyz789
X-Electric-Offset: 26800584_3

{
  "webhook_id": "wh_abc123",
  "shape_handle": "orders-3-1733400000000",
  "offset": "26800584_3",
  "operations": [
    {
      "action": "insert",
      "key": "\"orders\"/\"ord_123\"",
      "value": {
        "id": "ord_123",
        "customer_id": "cust_456",
        "total": 99.99,
        "status": "pending"
      },
      "offset": "26800584_1"
    },
    {
      "action": "update",
      "key": "\"orders\"/\"ord_100\"",
      "value": {
        "id": "ord_100",
        "customer_id": "cust_789",
        "total": 150.00,
        "status": "pending"
      },
      "offset": "26800584_2"
    },
    {
      "action": "delete",
      "key": "\"orders\"/\"ord_050\"",
      "offset": "26800584_3"
    }
  ],
  "headers": {
    "control": "up-to-date"
  }
}
```

### Response Expectations

Webhooks must respond with:
- **2xx**: Delivery successful, advance offset
- **4xx**: Permanent failure, log and skip (after max retries)
- **5xx**: Temporary failure, retry with backoff

Optional response body for acknowledgment:
```json
{
  "processed": true,
  "offset": "26800584_3"
}
```

## Architecture

### Integration Point

The webhook dispatcher integrates at the **ShapeLogCollector** level, after changes are routed to shapes but parallel to the HTTP streaming path:

```
PostgreSQL WAL
     ↓
ReplicationClient
     ↓
ShapeLogCollector
     ↓
EventRouter.event_by_shape_handle()
     ↓
     ├─→ ConsumerRegistry.publish() → Storage → HTTP API (existing)
     │
     └─→ WebhookDispatcher.dispatch() → HTTP POST (new)
```

### Components

```
StackSupervisor
├── ... (existing)
└── WebhookSupervisor
    ├── WebhookRegistry          # Stores subscription configs
    ├── WebhookDeliveryQueue     # Batches and queues deliveries
    ├── WebhookWorkerPool        # HTTP delivery workers
    └── WebhookStateStore        # Persists delivery offsets
```

#### WebhookRegistry

- Stores webhook subscription configurations
- Maps shape handles to webhook subscriptions (1:N)
- Indexes by webhook ID for CRUD operations

#### WebhookDeliveryQueue

- Receives operations from ShapeLogCollector
- Groups operations by webhook subscription
- Batches based on `max_size` and `max_wait_ms`
- Maintains per-webhook offset tracking
- Implements backpressure to avoid unbounded memory

#### WebhookWorkerPool

- Pool of HTTP workers (configurable size)
- Executes webhook deliveries with retries
- Handles timeouts and backoff
- Reports delivery status back to queue

#### WebhookStateStore

- Persists last-delivered offset per webhook
- Persists pending deliveries for crash recovery
- Options: File-based, PostgreSQL table, or pluggable

### Ordering Guarantees

- Operations delivered in **log offset order** per webhook
- Batches are sequential (next batch waits for previous ACK)
- Same guarantees as SSE streaming

### Failure Handling

```
Delivery attempt
     ↓
     ├─ 2xx → Mark delivered, advance offset
     │
     ├─ 5xx → Retry with exponential backoff
     │        (1s, 2s, 4s, 8s, 16s, 32s max)
     │
     ├─ 4xx → Retry up to max_attempts
     │        If exhausted: pause webhook, notify
     │
     └─ Timeout → Treat as 5xx (retry)

After max_attempts failures:
  - Webhook marked as "failed"
  - Admin notification (if configured)
  - Manual intervention required to resume
```

### Backpressure

To prevent unbounded memory growth when webhooks are slow:

1. **Per-webhook buffer limit**: Max pending operations (default: 10,000)
2. **Circuit breaker**: Pause after N consecutive failures
3. **Queue limits**: Reject new subscriptions if system overloaded

When a webhook is paused due to backpressure:
- Operations continue accumulating in shape storage
- On resume, replay from last successful offset
- Uses same mechanism as new client catching up

## Configuration

### Environment Variables

```bash
# Enable webhook subscriptions feature
ELECTRIC_WEBHOOKS_ENABLED=true

# Worker pool size
ELECTRIC_WEBHOOKS_POOL_SIZE=10

# Default batch settings
ELECTRIC_WEBHOOKS_DEFAULT_BATCH_SIZE=100
ELECTRIC_WEBHOOKS_DEFAULT_BATCH_WAIT_MS=1000

# Retry settings
ELECTRIC_WEBHOOKS_MAX_RETRY_ATTEMPTS=5
ELECTRIC_WEBHOOKS_MAX_RETRY_BACKOFF_MS=32000

# Delivery timeout
ELECTRIC_WEBHOOKS_DELIVERY_TIMEOUT_MS=30000

# State storage (file | postgres)
ELECTRIC_WEBHOOKS_STATE_STORAGE=file
ELECTRIC_WEBHOOKS_STATE_PATH=/var/lib/electric/webhooks

# Security
ELECTRIC_WEBHOOKS_REQUIRE_HTTPS=true
ELECTRIC_WEBHOOKS_ALLOWED_HOSTS=*.example.com,api.partner.com
```

### Per-Webhook Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | string | required | Webhook endpoint URL |
| `headers` | object | `{}` | Custom headers to include |
| `signing_secret` | string | null | HMAC-SHA256 signing key |
| `batch.max_size` | int | 100 | Max operations per delivery |
| `batch.max_wait_ms` | int | 1000 | Max wait before sending batch |
| `retry.max_attempts` | int | 5 | Retry attempts before failing |
| `retry.backoff` | string | "exponential" | Backoff strategy |
| `timeout_ms` | int | 30000 | Delivery timeout |

## Security Considerations

### Webhook Signing

All deliveries include an HMAC-SHA256 signature:

```
X-Electric-Signature: sha256=<hex(hmac_sha256(signing_secret, body))>
```

Receivers should verify:
```python
import hmac
import hashlib

def verify_signature(body, signature, secret):
    expected = 'sha256=' + hmac.new(
        secret.encode(),
        body.encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected)
```

### URL Restrictions

- HTTPS required by default (configurable)
- Allowlist/blocklist for destination hosts
- No localhost/private IP delivery (prevent SSRF)
- Rate limiting per destination host

### Secrets Management

- Signing secrets stored encrypted at rest
- Headers with secrets redacted in logs
- API responses mask secret values

## Observability

### Metrics

```
electric_webhooks_subscriptions_total{status="active|paused|failed"}
electric_webhooks_deliveries_total{webhook_id, status="success|retry|failed"}
electric_webhooks_delivery_latency_seconds{webhook_id}
electric_webhooks_queue_depth{webhook_id}
electric_webhooks_batch_size{webhook_id}
```

### Logging

```elixir
Logger.info("Webhook delivery succeeded",
  webhook_id: "wh_abc123",
  delivery_id: "del_xyz789",
  offset: "26800584_3",
  operations: 15,
  latency_ms: 234
)

Logger.warning("Webhook delivery failed, retrying",
  webhook_id: "wh_abc123",
  attempt: 3,
  error: "timeout",
  next_retry_ms: 8000
)
```

### Admin Events

Notify administrators via configured channel:
- Webhook failed after max retries
- Webhook paused due to backpressure
- Webhook resumed
- Unusual delivery latency

## Alternatives Considered

### 1. Client-Side Webhooks

Have clients (TypeScript SDK) forward changes to webhooks.

**Rejected because:**
- Requires always-on client process
- Doesn't solve serverless use case
- Duplicates reliable delivery logic

### 2. PostgreSQL NOTIFY/LISTEN

Use Postgres NOTIFY for change events.

**Rejected because:**
- Still requires persistent connection
- NOTIFY has payload size limits (8KB)
- Lost if no listener connected
- Electric already has reliable streaming

### 3. External Message Queue

Publish to Kafka/Redis Streams/SQS.

**Partially viable as future enhancement:**
- Could add as alternative delivery target
- Webhooks more universal for MVP
- Queue integration could use same architecture

## Implementation Plan

### Phase 1: Core Infrastructure

1. Add `WebhookRegistry` GenServer for subscription storage
2. Add `WebhookStateStore` for offset persistence
3. Add HTTP endpoints for CRUD operations
4. Add configuration parsing and validation

### Phase 2: Delivery Pipeline

1. Integrate with `ShapeLogCollector` for change events
2. Implement `WebhookDeliveryQueue` with batching
3. Implement `WebhookWorkerPool` with HTTP client
4. Add retry logic and backoff

### Phase 3: Reliability

1. Add delivery offset tracking and persistence
2. Implement crash recovery (replay from offset)
3. Add circuit breaker and backpressure
4. Add webhook signing

### Phase 4: Observability

1. Add Prometheus metrics
2. Add structured logging
3. Add admin notifications
4. Add delivery history API

### Phase 5: Polish

1. Add TypeScript SDK methods for webhook management
2. Add documentation and examples
3. Add integration tests
4. Performance testing and tuning

## Open Questions

1. **Should webhooks include initial snapshot?**
   - Option A: Yes, POST all existing data on subscription creation
   - Option B: No, only stream new changes (require separate initial sync)
   - Option C: Configurable per-webhook

2. **How to handle shape rotation?**
   - When shape is invalidated, webhook needs to re-sync
   - Should this be automatic or require webhook to handle?

3. **Multi-tenancy considerations?**
   - Should webhooks be scoped to authentication tokens?
   - How does this interact with gatekeeper auth patterns?

4. **Webhook management persistence?**
   - Store in PostgreSQL table vs. file vs. separate config?
   - API-only or also declarative configuration file?

5. **Rate limiting strategy?**
   - Per-destination-host limits?
   - Per-webhook limits?
   - Global limits?

## Related Work

- [Supabase Webhooks](https://supabase.com/docs/guides/database/webhooks)
- [Hasura Event Triggers](https://hasura.io/docs/latest/event-triggers/overview/)
- [Stripe Webhooks](https://stripe.com/docs/webhooks) (payload signing pattern)
- [GitHub Webhooks](https://docs.github.com/en/webhooks) (delivery retry pattern)

## References

- Electric Architecture: `packages/sync-service/lib/electric/`
- Shape Log Collector: `packages/sync-service/lib/electric/replication/shape_log_collector.ex`
- Consumer Registry: `packages/sync-service/lib/electric/shapes/consumer_registry.ex`
- Request Batcher (batching pattern): `packages/sync-service/lib/electric/replication/shape_log_collector/request_batcher.ex`
