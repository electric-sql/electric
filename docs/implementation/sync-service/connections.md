# Connection Management Implementation

This document provides a deep implementation dive into connection management in Electric's sync-service.

## Overview

Electric's connection management system is a sophisticated multi-layered architecture that handles PostgreSQL connections, replication streaming, lock management, and graceful error recovery.

## 1. Connection.Manager - The State Machine

**File**: `lib/electric/connection/manager.ex`

### Two-Level State Machine

**Level 1: Phases**

- `:connection_setup` - Initial startup phase
- `:running` - Normal operation phase

**Level 2: Steps** (within each phase)

**Connection Setup Phase:**

```
{:start_replication_client, nil}
{:start_replication_client, :acquiring_lock}
{:start_replication_client, :connecting}
{:start_replication_client, :configuring_connection}
{:start_connection_pool, nil}
{:start_connection_pool, :connecting}
:start_shapes_supervisor
{:start_replication_client, :start_streaming}
```

**Running Phase:**

```
:waiting_for_streaming_confirmation
:streaming
```

### State Structure

```elixir
defmodule State do
  defstruct [
    :current_phase,
    :current_step,
    :connection_opts,
    :replication_opts,
    :pool_opts,
    :timeline_opts,
    :shape_cache_opts,
    :replication_client_pid,
    :replication_configuration_timer,
    :replication_pg_backend_pid,
    :replication_lock_timer,
    :connection_backoff,
    :pg_version,
    :pg_system_identifier,
    :pg_timeline_id,
    :manual_table_publishing?,
    :stack_id,
    :stack_events_registry,
    :inspector,
    :max_shapes,
    :persistent_kv,
    purge_all_shapes?: false,
    pool_pids: %{admin: nil, snapshot: nil},
    validated_connection_opts: %{replication: nil, pool: nil},
    drop_slot_requested: false
  ]
end
```

### Complete State Transition Flow

```
CONNECTION SETUP PHASE
────────────────────────────────────────────────────────
1. {:start_replication_client, nil}
   → Validate replication connection opts
   → Start ReplicationClient process

2. {:start_replication_client, :connecting}
   → Schedule lock status check timer
   → Update StatusMonitor

3. {:start_replication_client, :acquiring_lock}
   → Cancel lock timer
   → Initialize ShapeStatusOwner from storage
   → Schedule configuration check timer

4. {:start_replication_client, :configuring_connection}
   → Cancel configuration timer
   → Update StatusMonitor

5. {:start_connection_pool, nil}
   → Validate pooled connection opts
   → Start admin pool (25% of total, max 4, min 1)
   → Start snapshot pool (remaining connections)

6. {:start_connection_pool, :connecting}
   → Wait for both pools to be ready
   → Update StatusMonitor

7. :start_shapes_supervisor
   → Check timeline continuity (PITR detection)
   → Reset storage if timeline changed
   → Start Shapes.Supervisor via CoreSupervisor

8. {:start_replication_client, :start_streaming}
   → Send start_streaming to ReplicationClient
   → Dispatch :ready stack event
   → Transition to RUNNING PHASE

RUNNING PHASE
────────────────────────────────────────────────────────
9. :waiting_for_streaming_confirmation
   → Schedule liveness check timer (5 seconds)

10. :streaming
    → Normal operation
    → Process replication messages
```

### Pool Size Calculation

```elixir
def pool_sizes(total_pool_size) do
  max_admin_connections = 4
  min_admin_connections = 1

  # Admin pool: 1/4 of total, bounded [1, 4]
  metadata_pool_size =
    min(max(div(total_pool_size, 4), min_admin_connections), max_admin_connections)

  # Snapshot pool: remainder
  snapshot_pool_size =
    max(total_pool_size - metadata_pool_size, metadata_pool_size)

  %{snapshot: snapshot_pool_size, admin: metadata_pool_size}
end
```

**Example:** 20 total connections → 4 admin, 16 snapshot

## 2. ReplicationClient Lifecycle

**File**: `lib/electric/postgres/replication_client.ex`

### Connection Setup Sequence

```
:connected
    ↓
:identify_system
    - Execute IDENTIFY_SYSTEM command
    - Get: system_identifier, timeline_id, xlogpos
    ↓
:query_pg_info
    - Get server_version_num, pg_backend_pid
    ↓
:acquire_lock
    - SELECT pg_advisory_lock(hashtext('slot_name'))
    - Retry on statement timeout
    ↓
:create_publication (if try_creating_publication? = true)
    - CREATE PUBLICATION electric_publication
    ↓
:drop_slot (if recreate_slot? = true)
    - SELECT pg_drop_replication_slot('slot_name')
    ↓
:create_slot
    - CREATE_REPLICATION_SLOT [TEMPORARY] LOGICAL pgoutput
    ↓
:query_slot_flushed_lsn
    - Get confirmed_flush_lsn from pg_replication_slots
    ↓
:set_display_setting
    - Configure display settings
    ↓
:ready_to_stream
    - Wait for :start_streaming from Connection.Manager
    ↓
:start_streaming
    - START_REPLICATION SLOT logical 0/0
    ↓
:streaming
    - Process XLogData messages
    - Send standby status updates
```

### LSN Tracking and Acknowledgment

Three LSN positions maintained:

```elixir
defstruct [
  received_wal: 0,       # Offset of data received from WAL
  flushed_wal: 0,        # Offset confirmed as persisted
  last_seen_txn_lsn: Lsn.from_integer(0),
  flush_up_to_date?: true
]
```

### Standby Status Updates

```elixir
defp encode_standby_status_update(state) do
  <<
    @repl_msg_standby_status_update,  # 'r' (0x72)
    state.received_wal + 1::64,       # Last WAL byte received + 1
    state.flushed_wal + 1::64,        # Last WAL byte flushed + 1
    state.flushed_wal + 1::64,        # Last WAL byte applied + 1
    current_time()::64,
    0                                 # Reply not requested
  >>
end
```

## 3. Connection Pools

**Files**: `lib/electric/connection/manager/pool.ex`

### Two Separate Pools

**Admin Pool:**

- Size: 25% of total (min: 1, max: 4)
- Purpose: Metadata operations, DDL, administrative queries
- Used by: PublicationManager, SchemaReconciler

**Snapshot Pool:**

- Size: Remaining 75%
- Purpose: Shape snapshot queries
- Queue config: `queue_target: 5_000, queue_interval: 10_000`

### Pool Lifecycle State Machine

```elixir
@type pool_status :: :starting | :ready | :repopulating

defstruct [
  :stack_id,
  :role,                    # :admin | :snapshot
  :pool_ref,
  :pool_pid,
  :pool_size,
  :connection_manager,
  status: :starting,
  connection_pids: %{},     # %{pid() => :starting | :connected | :disconnected}
  last_connection_error: nil
]
```

### Pool Status Transitions

```elixir
def handle_continue(:update_pool_status, state) do
  pool_is_ready = num_connected(state) >= state.pool_size

  case {state.status, pool_is_ready} do
    {:starting, true} ->
      notify_connection_pool_ready(state)
      {:noreply, %{state | status: :ready}}

    {:repopulating, true} ->
      {:noreply, %{state | status: :ready}}

    {:ready, false} ->
      {:noreply, %{state | status: :repopulating}}

    _ -> {:noreply, state}
  end
end
```

## 4. Supervision Structure

### Supervision Tree Hierarchy

```
CoreSupervisor (one_for_one, auto_shutdown: any_significant)
  │
  └─── Connection.Supervisor (rest_for_one, transient, significant)
         │
         ├─── Connection.Restarter
         │
         └─── Connection.Manager.Supervisor (one_for_all)
                │
                ├─── Connection.Manager (acts as supervisor)
                │      │
                │      ├─── ReplicationClient (linked)
                │      ├─── Admin Pool (linked)
                │      └─── Snapshot Pool (linked)
                │
                └─── ConnectionResolver
```

### Supervision Strategies

**CoreSupervisor:**

- Strategy: `:one_for_one`
- `auto_shutdown: :any_significant`
- If Connection.Supervisor stops, entire CoreSupervisor shuts down

**Connection.Supervisor:**

- Strategy: `:rest_for_one`
- Children: Restarter, Manager.Supervisor
- `restart: :transient, significant: true`

**Connection.Manager.Supervisor:**

- Strategy: `:one_for_all`
- If any child crashes, restart all children

## 5. Timeline Handling & PITR Detection

**File**: `lib/electric/timeline.ex`

### Timeline Check Flow

```elixir
def check(pg_timeline, opts) do
  electric_timeline = load_timeline(opts)

  if pg_timeline != electric_timeline do
    :ok = store_timeline(pg_timeline, opts)
  end

  verify_timeline(pg_timeline, electric_timeline)
end
```

### Verification Logic

```elixir
# Same timeline
defp verify_timeline(timeline, timeline), do: :ok

# No previous timeline - first run
defp verify_timeline({pg_id, timeline_id}, nil), do: :no_previous_timeline

# Different database
defp verify_timeline({pg_id, _}, {electric_pg_id, _}) when pg_id != electric_pg_id,
  do: :timeline_changed

# Different timeline (PITR occurred)
defp verify_timeline({_, timeline_id}, _), do: :timeline_changed
```

### Shape Invalidation on Timeline Change

```elixir
def handle_continue(:start_shapes_supervisor, state) do
  timeline_check = Electric.Timeline.check(
    {state.pg_system_identifier, state.pg_timeline_id},
    state.timeline_opts
  )

  timeline_changed? = timeline_check == :timeline_changed

  if timeline_changed? do
    # Stop shapes supervisor
    Electric.CoreSupervisor.stop_shapes_supervisor(stack_id: state.stack_id)

    # Clean up on-disk storage
    Electric.Shapes.Supervisor.reset_storage(shape_cache_opts: state.shape_cache_opts)

    # Purge shapes from ShapeStatus registry
    Electric.ShapeCache.ShapeStatus.reset(state.stack_id)

    # Reset replication state
    Electric.Replication.PersistentReplicationState.reset(...)
  end
end
```

## 6. Health Monitoring

**File**: `lib/electric/status_monitor.ex`

### Status States

```elixir
@type status() :: %{
  conn: :waiting_on_lock | :starting | :up | :sleeping,
  shape: :starting | :up
}
```

### Readiness Conditions

Seven conditions must be met for full readiness:

```elixir
@conditions [
  :pg_lock_acquired,
  :replication_client_ready,
  :admin_connection_pool_ready,
  :snapshot_connection_pool_ready,
  :shape_log_collector_ready,
  :supervisor_processes_ready,
  :integrety_checks_passed
]
```

### Status Computation

```elixir
def status(stack_id) do
  results = results(ets_table(stack_id))

  conn_status = case db_state(table) do
    :up -> conn_status_from_results(results)
    :sleeping -> :sleeping
  end

  shape_status = shape_status_from_results(results)

  %{conn: conn_status, shape: shape_status}
end

defp conn_status_from_results(%{pg_lock_acquired: {false, _}}),
  do: :waiting_on_lock

defp conn_status_from_results(%{
  replication_client_ready: {true, _},
  admin_connection_pool_ready: {true, _},
  snapshot_connection_pool_ready: {true, _},
  integrety_checks_passed: {true, _}
}), do: :up

defp conn_status_from_results(_), do: :starting
```

## 7. Exponential Backoff

**File**: `lib/electric/connection/manager/connection_backoff.ex`

```elixir
def init(start, max) do
  %{backoff: :backoff.init(start, max), retries_started_at: nil}
end

def fail(%{backoff: backoff, retries_started_at: retries_started_at}) do
  {time, backoff} = :backoff.fail(backoff)
  {time, %{backoff: backoff, retries_started_at: retries_started_at || System.monotonic_time(:millisecond)}}
end

def succeed(%{backoff: backoff} = conn_backoff) do
  {_, backoff} = :backoff.succeed(backoff)
  {total_retry_time(conn_backoff), %{backoff: backoff, retries_started_at: nil}}
end
```

**Default:** Start at 1 second, max at 10 seconds (exponential growth).

## 8. Graceful Shutdown

### Shutdown Sequence

```elixir
def terminate(reason, state) do
  # STEP 1: Kill snapshot pool immediately
  shutdown_child(snapshot_pool_pid, :shutdown)

  # STEP 2: Drop publication if requested
  if state.drop_slot_requested, do: drop_publication(state)

  # STEP 3: Backup shape metadata
  Electric.ShapeCache.ShapeStatus.save_checkpoint(state.stack_id)

  # STEP 4: Shutdown replication client
  shutdown_child(replication_client_pid, :shutdown, 1_000)

  # STEP 5: Kill replication backend process
  kill_replication_backend(state)

  # STEP 6: Drop replication slot if requested
  if state.drop_slot_requested, do: drop_slot(state)

  # STEP 7: Kill admin pool last
  shutdown_child(admin_pool_pid, :shutdown)
end
```

### Child Shutdown Logic

```elixir
defp shutdown_child(pid, :shutdown, timeout) when is_pid(pid) do
  ref = Process.monitor(pid)
  Process.exit(pid, :shutdown)

  receive do
    {:DOWN, ^ref, :process, ^pid, _} -> :ok
  after
    timeout -> shutdown_child(pid, :kill)
  end
end
```

## 9. Lock Management & Stuck Lock Recovery

**File**: `lib/electric/postgres/lock_breaker_connection.ex`

### Lock Acquisition

```elixir
defp acquire_lock_query(%State{slot_name: lock_name} = state) do
  query = "SELECT pg_advisory_lock(hashtext('#{lock_name}'))"
  {:query, query, state}
end
```

### Stuck Lock Detection

Every 10 seconds during lock acquisition:

```elixir
def handle_continue(:check_lock_not_abandoned, state) do
  if state.current_step == {:start_replication_client, :acquiring_lock} and
       not is_nil(state.replication_pg_backend_pid) do
    {:ok, breaker_pid} = LockBreakerConnection.start(...)
    LockBreakerConnection.stop_backends_and_close(breaker_pid, lock_name, pg_backend_pid)
  end
end
```

### Lock Breaker Query

```sql
WITH inactive_slots AS (
  select slot_name
  from pg_replication_slots
  where active = false
    and database = 'dbname'
    and slot_name = 'slot_name'
),
stuck_backends AS (
  select pid
  from pg_locks, inactive_slots
  where
    hashtext(slot_name) = (classid::bigint << 32) | objid::bigint
    and locktype = 'advisory'
    and objsubid = 1
    and granted
    and pid != <current_backend_pid>
)
SELECT pg_terminate_backend(pid) FROM stuck_backends;
```

## 10. Scale-to-Zero

**File**: `lib/electric/connection/restarter.ex`

### Stop Connection Subsystem

```elixir
def handle_cast(:stop_connection_subsystem, state) do
  StatusMonitor.database_connections_going_to_sleep(state.stack_id)

  Electric.Connection.Manager.Supervisor.stop_connection_manager(stack_id: state.stack_id)

  Electric.StackSupervisor.dispatch_stack_event(
    state.stack_events_registry,
    state.stack_id,
    :scaled_down_database_connections
  )

  {:noreply, state}
end
```

### Restore Connection Subsystem

```elixir
def handle_cast(:restore_connection_subsystem, %{wait_until_conn_up_ref: nil} = state) do
  StatusMonitor.database_connections_waking_up(state.stack_id)

  Electric.Connection.Manager.Supervisor.restart(stack_id: state.stack_id)

  ref = StatusMonitor.wait_until_conn_up_async(state.stack_id)

  {:noreply, %{state | wait_until_conn_up_ref: ref}}
end
```

## 11. Essential Files

| File                                                           | Purpose                |
| -------------------------------------------------------------- | ---------------------- |
| `lib/electric/connection/manager.ex`                           | Core state machine     |
| `lib/electric/postgres/replication_client.ex`                  | Replication connection |
| `lib/electric/postgres/replication_client/connection_setup.ex` | Setup state machine    |
| `lib/electric/connection/manager/pool.ex`                      | Pool lifecycle         |
| `lib/electric/status_monitor.ex`                               | Health status          |
| `lib/electric/timeline.ex`                                     | PITR detection         |
| `lib/electric/connection/supervisor.ex`                        | Supervision structure  |
| `lib/electric/connection/restarter.ex`                         | Scale-to-zero          |
| `lib/electric/postgres/lock_breaker_connection.ex`             | Stuck lock recovery    |
| `lib/electric/connection/manager/connection_resolver.ex`       | Connection validation  |

## 12. Key Implementation Insights

### Separation of Concerns

- **Connection subsystem**: Ephemeral, restarts on errors
- **Shape subsystem**: Persistent, survives connection failures

### Defensive Programming

- **Timeline tracking**: Detects PITR and invalidates shapes
- **Lock breaking**: Recovers from abandoned locks
- **Exponential backoff**: Prevents thundering herd
- **Connection validation**: Auto-fallback for SSL and IPv6 issues

### LSN Management

- Three-level tracking: received_wal, flushed_wal, last_seen_txn_lsn
- Flush boundaries ensure Postgres only advances slot after shape logs are persisted
- Keepalive optimization advances slot during keepalives to prevent bloat
