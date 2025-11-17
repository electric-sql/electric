# Bug Investigation: Electric Pod SIGTERMs Due to WAL Sender Timeout

## Problem Summary

Electric pods in Kubernetes were receiving SIGTERMs multiple times per day (on the order of a couple of times per day) due to failing liveness checks on the `/v1/health` endpoint. The issue was resolved by disabling PostgreSQL's `wal_sender_timeout` (setting it to 0), though the root cause was not immediately clear.

**Environment:**
- PostgreSQL `wal_sender_timeout`: 60 seconds (default)
- Kubernetes liveness probe: Checking `/v1/health`
- All versions of Electric affected

## Root Cause Analysis

After investigating the Electric codebase, I've identified the root cause as a **timing issue between PostgreSQL's WAL sender timeout and Electric's transaction processing blocking behavior**.

### The Chain of Events

1. **Transaction Processing Blocks the Replication Client**
   - Location: `packages/sync-service/lib/electric/postgres/replication_client.ex:421-465`
   - When Electric receives a transaction from PostgreSQL's replication stream, it must process and persist it synchronously
   - The processing uses `apply_with_retries()` which can block indefinitely with `timeout: :infinity`
   - During transaction processing, the replication client process **cannot respond to any other messages**, including PostgreSQL's keepalive requests

2. **PostgreSQL Expects Regular Keepalive Responses**
   - PostgreSQL's `wal_sender_timeout` (default: 60 seconds) requires the replication client to send a standby status update within this timeframe
   - PostgreSQL sends primary keepalive messages requesting a reply (`reply=1`)
   - Location: `packages/sync-service/lib/electric/postgres/replication_client.ex:328-350`
   - Electric only sends standby status updates when:
     - It receives and processes a primary keepalive message with `reply=1`
     - It finishes processing a transaction (line 455)

3. **The Critical Problem**
   - If transaction processing takes longer than 60 seconds, the replication client cannot respond to PostgreSQL's keepalive messages
   - PostgreSQL interprets the lack of response as a dead/stuck client
   - PostgreSQL terminates the WAL sender connection

4. **Cascade Effect Leading to SIGTERM**
   - Replication connection terminates
   - `replication_client_ready` status becomes `false`
   - Health check at `/v1/health` returns non-200 status (202 "starting" or similar)
   - Kubernetes liveness probe fails
   - Kubernetes sends SIGTERM to restart the pod

### What Can Cause Prolonged Transaction Processing?

Location: `packages/sync-service/lib/electric/postgres/replication_client.ex:484-522`

The `apply_with_retries()` function can block for extended periods due to:

1. **Storage Backend Delays**
   - Slow writes to the shape log storage
   - Network latency to storage services
   - Storage backend overload

2. **Shape Consumer Processing**
   - The replication client waits for all shape consumers to process the transaction
   - Uses manual demand with `timeout: :infinity` (line 428)
   - A single slow consumer blocks the entire pipeline

3. **Infinite Retry Logic**
   - When receiving `:not_ready` or `:connection_not_available` errors, the client retries indefinitely
   - Location: `packages/sync-service/lib/electric/postgres/replication_client.ex:501-509`
   - Uses `Electric.StatusMonitor.wait_until_active(state.stack_id, timeout: :infinity, block_on_conn_sleeping: true)`

4. **System Resource Contention**
   - High CPU usage from other processes
   - Memory pressure causing GC pauses
   - I/O contention

## Key Code Locations

### 1. Health Check Implementation
- **File**: `packages/sync-service/lib/electric/plug/health_check_plug.ex`
- **Lines**: 1-39
- **Behavior**: Reads status from ETS table (non-blocking), returns 200 only when `replication_client_ready=true`

### 2. Replication Client Blocking
- **File**: `packages/sync-service/lib/electric/postgres/replication_client.ex`
- **Lines**: 421-429
- **Critical Comment**:
  ```elixir
  # this will block until all the consumers have processed the transaction because
  # the log collector uses manual demand, and only replies to the `call` once it
  # receives more demand.
  # The timeout for any call here is important. Different storage
  # backends will require different timeouts and the timeout will need to
  # accomodate varying number of shape consumers.
  #
  # The current solution is to set timeout: :infinity for the call that
  # sends the txn message to the consumers and waits for them all to
  ```

### 3. Standby Status Update Logic
- **File**: `packages/sync-service/lib/electric/postgres/replication_client.ex`
- **Lines**: 328-350 (primary keepalive handling)
- **Lines**: 455 (after transaction processing)
- **Lines**: 469-482 (encoding function)

### 4. Infinite Retry Logic
- **File**: `packages/sync-service/lib/electric/postgres/replication_client.ex`
- **Lines**: 484-522
- **Key**: `timeout: :infinity` when waiting for stack to become active

### 5. Connection Configuration
- **File**: `packages/sync-service/lib/electric/postgres/replication_client.ex`
- **Lines**: 132-154
- **Key Finding**: No TCP keepalive settings configured
- **Options**: Only `timeout`, `auto_reconnect: false`, `sync_connect: false`

## Why Disabling wal_sender_timeout "Fixes" the Issue

Setting PostgreSQL's `wal_sender_timeout=0` disables the timeout completely, meaning:
- PostgreSQL will **never** terminate the replication connection due to lack of keepalive responses
- Electric can take as long as needed to process transactions
- However, this masks the underlying problem rather than solving it

**Downsides of this workaround:**
- PostgreSQL cannot detect truly dead/stuck replication clients
- Replication slots may accumulate WAL indefinitely if Electric actually crashes
- No protection against resource exhaustion from stuck connections

## Proper Solutions

### Option 1: Asynchronous Transaction Processing (Recommended)
Modify the replication client to process transactions asynchronously:
- Receive transaction from PostgreSQL
- Immediately send standby status update
- Process transaction in a separate process/task
- Maintain ordering guarantees through queuing

### Option 2: Periodic Keepalive Sender
Implement a separate process that sends standby status updates periodically:
- Independent of transaction processing
- Sends updates every ~10-20 seconds
- Only advances LSN when safe to do so

### Option 3: Configure TCP Keepalives
Add TCP-level keepalive settings to the replication connection:
```elixir
socket_options: [
  :inet6,  # if IPv6
  {:keepalive, true},
  {:tcp_keepalive_time, 30},      # Send first keepalive after 30s of idle
  {:tcp_keepalive_intvl, 10},     # Send subsequent keepalives every 10s
  {:tcp_keepalive_probes, 3}      # Drop connection after 3 failed probes
]
```

Location: `packages/sync-service/lib/electric/connection/manager/connection_resolver.ex:157-166`

**Note**: This only helps at the TCP level and won't help with application-level `wal_sender_timeout`

### Option 4: Increase wal_sender_timeout
Increase PostgreSQL's `wal_sender_timeout` to a higher value (e.g., 300 seconds or 5 minutes):
- Gives Electric more time to process large transactions
- Still provides protection against truly stuck connections
- Simple configuration change
- Doesn't address the fundamental issue

### Option 5: Set Transaction Processing Timeout
Add a maximum timeout for transaction processing:
- If processing exceeds the timeout, fail fast and disconnect
- Allow the connection manager to handle reconnection
- Prevents indefinite blocking

Location: `packages/sync-service/lib/electric/postgres/replication_client.ex:428`

Change from `timeout: :infinity` to a reasonable value (e.g., `timeout: 50_000` for 50 seconds)

## Monitoring Recommendations

To detect when this issue occurs:

1. **Add metrics for transaction processing duration**
   - Track time spent in `apply_with_retries()`
   - Alert if processing exceeds 30-40 seconds

2. **Monitor replication lag**
   - Already implemented at line 411: `receive_lag: DateTime.diff(DateTime.utc_now(), txn.commit_timestamp, :millisecond)`
   - Alert on increasing lag

3. **Track replication client disconnections**
   - Log and count disconnection events
   - Categorize by reason (timeout vs. other errors)

4. **Health check status transitions**
   - Monitor when `replication_client_ready` transitions from `true` to `false`
   - Track frequency and duration

## Testing Recommendations

1. **Load test with large transactions**
   - Create transactions that take 60+ seconds to process
   - Verify keepalive behavior

2. **Simulate slow storage backend**
   - Add artificial delays to storage writes
   - Observe replication connection stability

3. **Test with slow shape consumers**
   - Create consumers that deliberately process slowly
   - Verify behavior under backpressure

## Related Configuration

- **ELECTRIC_REPLICATION_IDLE_TIMEOUT**: Controls when Electric closes connections due to inactivity (default: 0/disabled)
  - Location: `packages/sync-service/config/runtime.exs:269-274`
  - This is **separate** from PostgreSQL's `wal_sender_timeout`

## Conclusion

The root cause is a **blocking transaction processing design that prevents the replication client from responding to PostgreSQL's keepalive messages within the 60-second `wal_sender_timeout` window**.

While disabling `wal_sender_timeout` works around the issue, the proper solution is to either:
1. Make transaction processing asynchronous (best long-term solution)
2. Implement periodic keepalive sending independent of transaction processing
3. Increase the timeout to a more reasonable value
4. Add transaction processing timeouts with proper failure handling

The issue affects all versions of Electric because it's fundamental to the synchronous transaction processing architecture.
