# RFC 001: Query Fallback Mode

**Status:** Implemented
**Author:** Claude (AI Assistant)
**Created:** 2025-11-06
**Updated:** 2025-11-06

## Summary

This RFC proposes a fallback mechanism for Electric that allows shape requests to be served via direct database queries when logical replication is unavailable. This provides graceful degradation when Electric cannot connect to PostgreSQL's replication stream, ensuring clients can continue receiving data (albeit without real-time updates) until replication is restored.

## Motivation

### Problem

Electric relies on PostgreSQL's logical replication to provide real-time sync. However, several scenarios can cause replication to become unavailable:

1. **Database restarts** - Replication slot doesn't exist yet
2. **Long-running transactions** - Block replication slot creation
3. **Configuration issues** - Wrong replication settings
4. **Network partitions** - Electric can't reach database
5. **Resource constraints** - Database rejects replication connections

When replication is unavailable, Electric currently:
- Returns 503 errors or times out on shape requests
- Provides no data to clients
- Offers no graceful degradation path

This creates a poor user experience during outages or initial setup.

### Goals

1. **Graceful degradation** - Serve data even when replication is unavailable
2. **Automatic recovery** - Switch back to live mode when replication restores
3. **Transparent to clients** - Minimal changes to client code
4. **Clear signaling** - Clients know when they're in fallback mode
5. **Low server overhead** - CDN-cacheable status checks

### Non-Goals

1. Real-time updates in fallback mode (polling-based is acceptable)
2. Full parity with live mode performance
3. Complex client-side configuration
4. Automatic detection of *why* replication failed

## Proposed Solution

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Client (Browser/App)                  │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │ ShapeStream                                     │    │
│  │  - Subscribes to shape                          │    │
│  │  - Detects fallback mode from header            │    │
│  │  - Polls /v1/status every 10s when in fallback  │    │
│  │  - Auto-reconnects when live mode detected      │    │
│  └────────────────────────────────────────────────┘    │
└──────────────────────┬───────────────────────────────────┘
                       │
                       │ HTTP Requests
                       ↓
┌─────────────────────────────────────────────────────────┐
│                         CDN/Proxy                        │
│  - Caches /v1/status responses (5s)                     │
│  - Reduces load on Electric server                      │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────┐
│                    Electric Server                       │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │ StatusMonitor                                   │    │
│  │  - Tracks replication_client_ready condition    │    │
│  │  - Returns replication_available: boolean       │    │
│  └────────────────────────────────────────────────┘    │
│                       │                                  │
│  ┌────────────────────┴──────────────────────────┐    │
│  │ API Request Handler                            │    │
│  │  - Checks StatusMonitor.status()               │    │
│  │  - Sets fallback_mode if !replication_available│    │
│  └────────────────────┬──────────────────────────┘    │
│                       │                                  │
│         ┌─────────────┴─────────────┐                  │
│         ↓                           ↓                   │
│  ┌─────────────┐            ┌──────────────┐          │
│  │ Live Mode   │            │ Fallback Mode│          │
│  │ - Stream    │            │ - Query DB   │          │
│  │   from WAL  │            │   directly   │          │
│  │ - Real-time │            │ - Snapshot   │          │
│  │   updates   │            │   format     │          │
│  └─────────────┘            └──────────────┘          │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────┐
│                    PostgreSQL Database                   │
│  - Logical replication (when available)                 │
│  - Direct queries (fallback mode)                       │
└─────────────────────────────────────────────────────────┘
```

### Components

#### 1. Server: Status Tracking

**File:** `packages/sync-service/lib/electric/status_monitor.ex`

Add `replication_available` to the status response:

```elixir
@type status() :: %{
  conn: :waiting_on_lock | :starting | :up | :sleeping,
  shape: :starting | :up,
  replication_available: boolean()  # NEW
}

defp replication_available_from_results(%{replication_client_ready: {true, _}}),
  do: true
defp replication_available_from_results(_),
  do: false
```

**Rationale:** The `replication_client_ready` condition already exists and accurately tracks when the replication client is operational. We simply expose this as a boolean flag.

#### 2. Server: Fallback Detection

**File:** `packages/sync-service/lib/electric/shapes/api.ex`

Check replication status during request validation:

```elixir
defp check_fallback_mode(%Request{api: api} = request) do
  status = Electric.StatusMonitor.status(api.stack_id)
  fallback_mode = not status.replication_available

  request
  |> Map.put(:fallback_mode, fallback_mode)
  |> Request.update_response(&%{&1 | fallback_mode: fallback_mode})
end
```

**Rationale:** Check on every request allows immediate detection of replication failures without complex state management.

#### 3. Server: Fallback Response

**File:** `packages/sync-service/lib/electric/shapes/api.ex`

Serve data from direct DB query:

```elixir
defp serve_fallback_response(%Request{} = request) do
  %{response: response, params: %{shape_definition: shape_definition}} = request

  # Query database for current snapshot data
  case Shapes.query_subset(shape_definition, nil, request.api) do
    {:ok, {_metadata, data_stream}} ->
      # Convert to shape log format
      log_stream = data_stream |> Stream.map(fn row ->
        %{
          "headers" => %{"operation" => "insert"},
          "offset" => "-1",
          "value" => row
        }
      end)

      %{response |
        chunked: true,
        body: encode_log(request, log_stream),
        status: 200,
        up_to_date: true
      }
      |> Response.final()

    {:error, reason} ->
      Response.error(request, "Database query failed", status: 503, retry_after: 5)
  end
end
```

**Rationale:**
- Reuses existing `query_subset` infrastructure (already tested)
- Returns data in same format as normal shape log
- Returns all rows as "insert" operations (snapshot-like)
- Sets `up_to_date: true` to prevent client from polling unnecessarily

#### 4. Server: Response Header

**File:** `packages/sync-service/lib/electric/shapes/api/response.ex`

Add header to signal fallback mode:

```elixir
@electric_fallback_mode_header "electric-fallback-mode"

defp put_fallback_mode_header(conn, %__MODULE__{fallback_mode: true}) do
  Plug.Conn.put_resp_header(conn, @electric_fallback_mode_header, "true")
end

defp put_fallback_mode_header(conn, %__MODULE__{fallback_mode: false}) do
  conn
end
```

**Rationale:** Explicit header allows clients to detect and react to fallback mode.

#### 5. Server: Status Endpoint

**File:** `packages/sync-service/lib/electric/plug/status_plug.ex`

New endpoint for status polling:

```elixir
GET /v1/status
→ Cache-Control: public, max-age=5
→ {
    "status": "live" | "fallback" | "starting",
    "replication_available": boolean,
    "connection": "up" | "starting" | "waiting_on_lock" | "sleeping",
    "shape": "up" | "starting"
  }
```

**Rationale:**
- 5-second cache allows frequent client polling with minimal server load
- CDN handles most requests
- Simple JSON response is easy to consume
- Status summary ("live"/"fallback"/"starting") is human-readable

#### 6. Client: Fallback Detection

**File:** `packages/typescript-client/src/client.ts`

Detect fallback mode from response headers:

```typescript
async #onInitialResponse(response: Response) {
  // ... existing header parsing ...

  // Check if server is in fallback mode
  const fallbackMode = headers.get(FALLBACK_MODE_HEADER) === `true`
  if (fallbackMode && !this.#inFallbackMode) {
    this.#inFallbackMode = true
    this.#startStatusPolling()
  } else if (!fallbackMode && this.#inFallbackMode) {
    this.#inFallbackMode = false
    this.#stopStatusPolling()
  }
}
```

**Rationale:** Header-based detection is simple and reliable.

#### 7. Client: Status Polling

**File:** `packages/typescript-client/src/client.ts`

Poll status endpoint when in fallback mode:

```typescript
#startStatusPolling() {
  const intervalMs = 10000 // 10 seconds

  const pollStatus = async () => {
    try {
      const response = await fetch(this.#statusPollUrl!)
      if (response.ok) {
        const status = await response.json()
        if (status.replication_available && status.status === `live`) {
          // Server restored - reconnect
          this.#stopStatusPolling()
          this.#inFallbackMode = false
          await this.forceDisconnectAndRefresh()
        }
      }
    } catch (error) {
      // Silently ignore - will retry
    }
  }

  pollStatus() // Immediate poll
  this.#statusPollInterval = setInterval(pollStatus, intervalMs)
}
```

**Rationale:**
- 10-second interval balances responsiveness with server load
- CDN caching (5s) means server sees much lower request rate
- Immediate poll provides faster initial detection
- Silent error handling prevents noise from transient failures
- Auto-reconnect via `forceDisconnectAndRefresh()` is seamless

### Data Flow

#### Initial Request (Replication Unavailable)

```
1. Client: GET /v1/shape?table=items&offset=-1

2. Electric:
   - Checks StatusMonitor.status()
   - replication_available = false
   - Sets fallback_mode = true
   - Calls Shapes.query_subset(shape_definition)
   - Queries: SELECT * FROM items

3. Electric Response:
   - Status: 200
   - Headers:
     - electric-fallback-mode: true
     - electric-handle: shape_abc123
     - electric-offset: -1
     - electric-up-to-date: true
   - Body: [{"headers": {"operation": "insert"}, "value": {...}}, ...]

4. Client:
   - Receives data
   - Detects fallback header
   - Starts polling /v1/status every 10s
   - Renders data to user
```

#### Status Polling (Fallback Mode)

```
1. Client: GET /v1/status (every 10s)

2. CDN:
   - First request: MISS → hits Electric server
   - Cache for 5 seconds
   - Next requests within 5s: HIT → served from CDN

3. Electric Response:
   {
     "status": "fallback",
     "replication_available": false,
     "connection": "up",
     "shape": "up"
   }

4. Client:
   - Checks status.replication_available
   - Still false → continue polling
```

#### Recovery (Replication Restored)

```
1. PostgreSQL: Replication slot becomes available

2. Electric:
   - ReplicationClient connects
   - StatusMonitor sets replication_client_ready = true
   - status.replication_available = true

3. Client: GET /v1/status (routine poll)

4. Electric Response:
   {
     "status": "live",
     "replication_available": true,
     "connection": "up",
     "shape": "up"
   }

5. Client:
   - Detects live mode
   - Stops status polling
   - Calls forceDisconnectAndRefresh()
   - Reconnects with offset=-1
   - Receives new shape handle
   - Switches to live replication mode
```

## Implementation Details

### Server Components

#### StatusMonitor Changes

**Before:**
```elixir
%{conn: :up, shape: :up}
```

**After:**
```elixir
%{conn: :up, shape: :up, replication_available: true}
```

Simple boolean derived from existing `replication_client_ready` condition.

#### API Request Flow

```
validate/2 (api.ex)
  ↓
check_fallback_mode/1  ← NEW
  ↓
load_shape_info/1
  ↓
serve_shape_response/1
  ↓
do_serve_shape_log/1
  ├─ fallback_mode: true → serve_fallback_response/1  ← NEW
  └─ fallback_mode: false → normal shape log
```

#### Response Headers

All responses include standard headers plus:
- `electric-fallback-mode: true` (when in fallback)

Existing headers still present:
- `electric-handle`
- `electric-offset`
- `electric-up-to-date`
- `electric-schema`

### Client Components

#### State Variables

```typescript
#inFallbackMode: boolean = false
#statusPollInterval?: NodeJS.Timeout | number
#statusPollUrl?: string
```

#### Lifecycle

1. **Construction**: Calculate status URL from shape URL
2. **Response**: Detect fallback header, start/stop polling
3. **Polling**: Check status every 10s
4. **Recovery**: Detect live mode, trigger reconnect
5. **Cleanup**: Stop polling on unsubscribe/reset

### Error Handling

#### Server Errors

| Scenario | Response | Client Behavior |
|----------|----------|-----------------|
| DB query fails in fallback | 503 + retry-after: 5 | Retry with backoff |
| Status check times out | 503 + retry-after: 5 | Wait and retry |
| Shape validation fails | 400 | Error reported to client |

#### Client Errors

| Scenario | Behavior |
|----------|----------|
| Status poll fails | Silent ignore, retry on next interval |
| Status URL invalid | Skip polling, continue with fallback data |
| Reconnect fails | Normal error handling via onError |

## Trade-offs

### Benefits

1. **Improved availability** - Data served even without replication
2. **Better UX** - Users see data instead of errors
3. **Automatic recovery** - No manual intervention needed
4. **Low overhead** - CDN handles most status checks
5. **Simple implementation** - Reuses existing query infrastructure

### Drawbacks

1. **Not real-time** - Fallback mode is snapshot-only
2. **Increased DB load** - Every request queries DB directly
3. **Polling overhead** - 10s polling adds client-side work
4. **No live updates** - Changes not reflected until recovery
5. **Memory usage** - Full table queries on every request

### Mitigation Strategies

1. **DB Load**:
   - Response includes `up_to_date: true` to prevent unnecessary re-requests
   - Clients typically won't re-poll if satisfied with data

2. **Polling Overhead**:
   - CDN caching reduces actual server requests
   - 10s is infrequent enough to be negligible

3. **Live Updates**:
   - Document clearly that fallback is degraded mode
   - Automatic recovery ensures temporary state

## Alternatives Considered

### Option 1: Client-Configurable Polling

**Approach**: Allow clients to configure fallback polling interval.

**Rejected because**:
- More complex API
- CDN caching makes it unnecessary
- 10s is reasonable default for all use cases

### Option 2: Server-Initiated Reconnect

**Approach**: Server pushes notification when replication restores.

**Rejected because**:
- Requires WebSocket or SSE connection
- Adds complexity for marginal benefit
- Polling with CDN is simpler and works

### Option 3: Virtual System Shape

**Approach**: Implement `_system/status` as queryable shape.

**Rejected because**:
- 40-60 hours of development effort
- Significant complexity (virtual tables, synthetic snapshots)
- Endpoint approach is simpler and works well
- Can revisit later if needed

### Option 4: No Fallback

**Approach**: Just return 503 errors when replication unavailable.

**Rejected because**:
- Poor user experience
- Common scenario (initial setup, restarts)
- Graceful degradation is better than hard failures

## Future Work

### Short Term

1. **Metrics**: Track fallback mode usage
   - How often entered
   - Duration in fallback
   - Recovery time

2. **Logging**: Better visibility into fallback events
   - When entered/exited
   - Reason for replication failure

3. **Testing**: Comprehensive test suite
   - Simulate replication failures
   - Test recovery scenarios
   - Load test status endpoint

### Medium Term

1. **Configurable Interval**: Allow server to suggest poll interval
   - Return `retry-after` header
   - Client respects server preference

2. **Smart Polling**: Exponential backoff for long outages
   - Start at 10s
   - Back off to 30s, 60s if failure persists
   - Reduce server load for extended outages

3. **Admin Notifications**: Alert when fallback mode entered
   - Email/Slack notifications
   - Dashboard indicators
   - Metrics/monitoring integration

### Long Term

1. **Virtual System Shapes**: Implement `_system/status` as first-class shape
   - Queryable like regular shapes
   - Automatic updates via normal sync
   - Foundation for other system shapes

2. **Partial Replication**: Serve some shapes live, others fallback
   - Per-shape replication status
   - Prioritize critical tables
   - Graceful degradation by priority

3. **Offline Mode**: Extend fallback to support offline scenarios
   - Local-first architecture
   - Sync queue when connection restored
   - Conflict resolution

## Security Considerations

1. **Status Endpoint**: No authentication required
   - Returns only operational state
   - No sensitive data exposed
   - Safe for public access

2. **Fallback Queries**: Use same authentication as normal requests
   - Existing shape permissions apply
   - No privilege escalation

3. **CDN Caching**: Status responses are safe to cache publicly
   - No user-specific data
   - Same for all clients

## Performance Impact

### Server

- **Fallback mode**: +1 DB query per shape request
- **Status endpoint**: ~1 request per 5s (with CDN)
- **Memory**: Minimal (status is lightweight)

### Client

- **Polling**: 1 request per 10s in fallback
- **Memory**: Minimal (timer + boolean state)
- **Network**: ~100 bytes per status request

### Database

- **Fallback mode**: +1 SELECT per shape request
- **Normal mode**: No change (uses replication)

### Expected Load (Example)

- 1000 concurrent users
- 10% in fallback mode (100 users)
- Status polling: 100 users × 1 request/10s = 10 req/s
- With CDN: ~2 req/s to server (5s cache)

**Conclusion**: Minimal impact with CDN caching.

## Migration Strategy

### Deployment

1. **Server deployment**: No migration needed
   - Feature is opt-in (automatic based on replication state)
   - Backwards compatible
   - No database changes

2. **Client deployment**: No breaking changes
   - Works with old clients (ignore fallback header)
   - New clients get improved experience
   - Gradual rollout possible

### Rollback

1. **Server**: Remove code, deploy previous version
2. **Client**: Deploy previous version
3. **No data migration** needed

## Testing Strategy

### Unit Tests

- StatusMonitor: `replication_available` logic
- API: Fallback mode detection
- Response: Header setting
- Client: Polling logic

### Integration Tests

- Full request flow in fallback mode
- Status endpoint responses
- Recovery scenarios
- Multiple clients polling

### Manual Testing

1. **Simulate replication failure**: Stop replication client
2. **Verify fallback**: Check header, data served
3. **Verify polling**: Monitor status requests
4. **Simulate recovery**: Start replication client
5. **Verify reconnect**: Confirm automatic switch

### Load Testing

- 1000 concurrent clients in fallback
- CDN hit rate measurement
- Server resource usage
- Database query load

## Documentation

### User Documentation

1. **Behavior**: Explain fallback mode
2. **Detection**: How clients know they're in fallback
3. **Recovery**: Automatic reconnection
4. **Limitations**: No real-time updates in fallback

### API Documentation

1. **Status endpoint**: `/v1/status` response format
2. **Headers**: `electric-fallback-mode` meaning
3. **Status values**: "live", "fallback", "starting"

### Operational Documentation

1. **Monitoring**: How to detect fallback mode
2. **Troubleshooting**: Common causes
3. **Recovery**: How to restore replication

## Success Metrics

1. **Availability**: % of requests served (fallback + live)
   - Target: >99.9%

2. **Recovery time**: Time to auto-reconnect when live
   - Target: <20s (worst case with 10s polling)

3. **CDN hit rate**: % of status requests served by CDN
   - Target: >80%

4. **User experience**: Error rate reduction
   - Target: 50% fewer 503 errors

## References

- Electric Shapes API: `/v1/shape` endpoint
- PostgreSQL Logical Replication: Replication slots
- StatusMonitor: Existing readiness checks
- ShapeStream Client: TypeScript implementation

## Changelog

- **2025-11-06**: Initial RFC created
- **2025-11-06**: Implementation completed
- **2025-11-06**: Polling interval changed from 60s to 10s

---

## Appendix A: Example Requests

### Normal Request (Live Mode)

```http
GET /v1/shape?table=items&offset=-1 HTTP/1.1
Host: electric.example.com

HTTP/1.1 200 OK
electric-handle: shape_abc123
electric-offset: 1234_5
electric-up-to-date: true
electric-schema: {...}

[
  {"headers": {"operation": "insert"}, "value": {"id": 1, "name": "Item 1"}},
  {"headers": {"operation": "insert"}, "value": {"id": 2, "name": "Item 2"}},
  {"headers": {"control": "up-to-date"}}
]
```

### Fallback Request

```http
GET /v1/shape?table=items&offset=-1 HTTP/1.1
Host: electric.example.com

HTTP/1.1 200 OK
electric-handle: shape_abc123
electric-offset: -1
electric-up-to-date: true
electric-fallback-mode: true
electric-schema: {...}

[
  {"headers": {"operation": "insert"}, "value": {"id": 1, "name": "Item 1"}},
  {"headers": {"operation": "insert"}, "value": {"id": 2, "name": "Item 2"}}
]
```

### Status Request

```http
GET /v1/status HTTP/1.1
Host: electric.example.com

HTTP/1.1 200 OK
Cache-Control: public, max-age=5
Content-Type: application/json

{
  "status": "fallback",
  "replication_available": false,
  "connection": "up",
  "shape": "up"
}
```

## Appendix B: Code Locations

### Server (Elixir)

- `lib/electric/status_monitor.ex` - Replication tracking
- `lib/electric/shapes/api.ex` - Fallback detection & response
- `lib/electric/shapes/api/request.ex` - Request struct
- `lib/electric/shapes/api/response.ex` - Response struct & headers
- `lib/electric/plug/status_plug.ex` - Status endpoint
- `lib/electric/plug/router.ex` - Route registration

### Client (TypeScript)

- `src/client.ts` - ShapeStream implementation
- `src/constants.ts` - Header constants

### Total Changes

- **Files modified**: 8
- **Lines added**: ~250
- **Lines removed**: ~10
- **Net addition**: ~240 LOC
