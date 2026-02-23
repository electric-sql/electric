# Bug Analysis: "offset out of bounds for this shape" in Offer Feature

## Summary

A user experienced an error where Electric returned a 400 response with
`{"message":"Invalid request","errors":{"offset":["out of bounds for this shape"]}}`.
This caused the TanStack DB client to throw a `TimeoutWaitingForTxIdError` because
it was waiting for the Electric stream to deliver a transaction, but the stream was
cancelled by the 400 response. The optimistic mutations were then reverted, making
it look like there was no data.

## Failing Requests

**Request 1 (offer_items):**
```
GET /v1/shape?cursor=43416960&expired_handle=31151682-1771848608763531&handle=31151682-1771848960440939&log=changes_only&offset=6868065325280_0&table=offer_items
```

**Request 2 (offer_footer_columns):**
```
GET /v1/shape?handle=92517397-1771849261380462&expired_handle=92517397-1771626649364729&log=changes_only&offset=6857806196176_6&table=offer_footer_columns&cursor=43414400&where=company_id='...' AND deleted_at IS NULL
```

Both are **non-live** requests with `log=changes_only`, using handles that indicate
prior shape rotations (presence of `expired_handle`).

## Root Cause Analysis

### How the Error is Triggered

The "out of bounds" check is in `packages/sync-service/lib/electric/shapes/api.ex:44-45`:

```elixir
defguardp is_out_of_bounds(request)
          when LogOffset.is_log_offset_lt(request.last_offset, request.params.offset)
```

This fires when the **server's known last offset** (`request.last_offset`) is
**less than** the client's requested offset (`request.params.offset`). The server's
`last_offset` is determined by `fetch_latest_offset()` in the storage layer.

### The Out-of-Bounds Recovery Mechanism

When detected, the server gives a grace period (`long_poll_timeout / 2` ≈ 10s) for
the shape to catch up before returning the 400 error (`api.ex:600-613`):

```elixir
defp do_serve_shape_log(%Request{new_changes_ref: ref} = request)
     when is_out_of_bounds(request) do
  Process.send_after(self(), {ref, :out_of_bounds_timeout}, div(request.api.long_poll_timeout, 2))
  handle_live_request(request)
end
```

If the shape catches up during this window, the request succeeds. Otherwise,
the 400 is returned at `api.ex:793-799`.

### Primary Hypothesis: Writer Crash with Unflushed Buffer

The most likely root cause is a **gap between ETS metadata and disk persistence**
after a writer process crash.

**The two-layer offset tracking system:**

1. **`last_seen_txn_offset`** — stored in ETS only (NOT persisted to disk).
   Updated synchronously during `append_to_log!` via `register_complete_txn`.
   This is what `fetch_latest_offset` reads first.

2. **`last_persisted_txn_offset`** — persisted to disk AND cached in ETS.
   Updated only when the write buffer is flushed (every 64KB or 1s boundary).

**Key finding:** `last_seen_txn_offset` is NOT in `@stored_keys`
(`pure_file_storage.ex:65-74`), meaning `write_metadata!` is a no-op for it.
It only exists in the ETS cache.

**The vulnerability window:**

```
T1: Consumer processes transaction, calls append_to_log!()
    → Writer stores data in ETS buffer
    → Writer updates last_seen_txn_offset = X in ETS (via register_complete_txn)
    → Writer updates last_persisted_txn_offset = Y on disk (Y < X, buffer not flushed yet)
    → Consumer sends {ref, :new_changes, X} to API listeners
    → Client receives response with offset X

T2: Buffer flush scheduled but hasn't run yet
    → ETS has last_seen_txn_offset = X
    → Disk has last_persisted_txn_offset = Y (Y < X)

T3: Writer/consumer process crashes (OOM, timeout, :kill, etc.)
    → Buffer data lost (not flushed to disk)
    → Writer's ETS table deleted
    → clean_shape_ets_entry NOT called (unclean termination)

T4: New transaction arrives for this shape
    → ConsumerRegistry detects no running consumer
    → Calls ShapeCache.start_consumer_for_handle()
    → New writer calls init_writer!() → register_with_stack()
    → register_with_stack reads stable_offset = Y from disk
    → Uses :ets.insert() to OVERWRITE stack_ets with last_seen_txn_offset = Y

T5: Client makes next request with offset = X
    → fetch_latest_offset() reads from ETS: last_seen_txn_offset = Y
    → Y < X → "out of bounds for this shape"
    → 10-second grace period expires (shape can't catch up to X because
      the log entries between Y and X were in the unflushed buffer and are now lost)
    → Returns 400 error
```

**Why the grace period doesn't help:** The log entries between Y and X were in the
writer's ETS buffer which was lost during the crash. The shape would need to
re-process those WAL entries, but the new consumer starts from the current WAL
position, not from Y. The entries between Y and X may already be past the
replication slot's retention.

### Secondary Hypothesis: CDN/Proxy Serving Stale Response

The requests go through `api3.autarc.energy/v1/electric-shape-proxy/`. If a CDN
or caching proxy served a stale response (e.g., from before a shape rotation),
the client could end up with an offset from a previous shape incarnation.

Non-live responses have `cache-control: public, max-age=60, stale-while-revalidate=300`.
If the shape was rotated and the CDN served a cached response with the old offset
but the new handle, the client's offset would be out of bounds for the new shape.

This is less likely because:
- The cache key includes the handle, so different shape incarnations are different cache entries
- The `expired_handle` parameter acts as an additional cache buster

### Why `log=changes_only` May Be Relevant

For `changes_only` shapes:
- The initial snapshot is empty (`querying.ex:106-108`)
- The shape only accumulates log entries from WAL changes after creation
- If a shape is lost and recreated, it has NO historical log entries
- The new shape's `last_offset` starts at `LogOffset.last_before_real_offsets()` ({0, :infinity})
- A client holding offset `6868065325280_0` from the old shape would be massively out of bounds

This makes `changes_only` shapes more vulnerable to this bug than `full` shapes,
because full shapes at least have a snapshot that covers historical data.

## Impact

When the 400 error occurs:
1. The Electric stream for that shape is terminated
2. TanStack DB is waiting for a txid to appear in the stream
3. The txid never arrives → `TimeoutWaitingForTxIdError`
4. Optimistic mutations are reverted
5. For the user, data appears to vanish

## Potential Fixes

### Fix 1: Persist `last_seen_txn_offset` to Disk (Recommended)

Add `:last_seen_txn_offset` to `@stored_keys` in `pure_file_storage.ex`, and write
it to disk in `update_global_persistence_information`. This eliminates the gap
between ETS and disk, making writer crashes safe.

**Trade-off:** Small additional disk I/O per transaction (one extra metadata file write).

### Fix 2: Force Flush on Consumer Terminate

In the consumer's terminate callback, ensure the writer buffer is always flushed
before the process exits. This is already done for clean termination via
`close_all_files(state)`, but may not execute during `:kill` signals.

**Trade-off:** Doesn't help with `:kill` or OOM crashes where terminate doesn't run.

### Fix 3: Return 409 Instead of 400 for Persistent Out-of-Bounds

When the out-of-bounds grace period expires and the shape can't catch up, return
a 409 with the current handle instead of 400. This tells the client to refetch
from scratch, which is the correct recovery behavior.

**Trade-off:** The client loses its position and must re-sync from the beginning.
This is the same as what happens during shape rotation, so existing client logic
handles it.

### Fix 4: Detect Offset Regression and Invalidate Shape

In `register_with_stack`, check if the new `stable_offset` is less than the
existing `last_seen_txn_offset` in ETS. If so, the shape's log has a gap and
should be invalidated, forcing clients to re-sync.

## Relevant Code Paths

| File | Line | Description |
|------|------|-------------|
| `shapes/api.ex` | 44-45 | `is_out_of_bounds` guard definition |
| `shapes/api.ex` | 600-613 | Out-of-bounds handler with grace period |
| `shapes/api.ex` | 793-799 | 400 error response on timeout |
| `shape_cache/pure_file_storage.ex` | 65-74 | `@stored_keys` — note `last_seen_txn_offset` is absent |
| `shape_cache/pure_file_storage.ex` | 468-485 | `read_latest_offset` / `latest_offset` fallback chain |
| `shape_cache/pure_file_storage.ex` | 727-757 | `register_with_stack` — overwrites ETS with disk values |
| `shape_cache/pure_file_storage/write_loop.ex` | 362-376 | `register_complete_txn` — updates `last_seen_txn_offset` |
| `shape_cache/pure_file_storage/write_loop.ex` | 311-340 | `flush_buffer` — syncs `last_persisted_txn_offset` to disk |
| `shapes/consumer.ex` | 554-565 | `append_to_log!` then `notify_new_changes` sequence |
| `shape_cache.ex` | 80-98 | `resolve_shape_handle` calls `fetch_latest_offset` |
