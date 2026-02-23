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

### IMPORTANT: User reports this happens repeatedly WITHOUT server restarts

Per Marius (Feb 23): "this is happening over and over again, unrelated to server
restarts." This rules out a one-time writer crash as the primary explanation and
points to a systemic issue that recurs during normal operation.

### Hypothesis 1: Repeated Shape Invalidation + Cleanup Race (Most Likely)

The requests include `expired_handle`, confirming the shape HAS been rotated before.
If something keeps invalidating the `offer_items` shape, the cleanup race window
(documented as issue #3760 at `api.ex:737-751`) would repeatedly expose the
out-of-bounds condition.

**Triggers for shape invalidation:**
1. **TRUNCATE on `offer_items`** (`consumer.ex:535-545`) — ANY truncate in a
   transaction causes the shape to be rotated. If the app periodically truncates
   this table (ETL, bulk refresh, etc.), shapes are repeatedly invalidated.
2. **Schema/DDL changes** (`consumer.ex:440-456`) — column alterations, index changes.
3. **Relation changes** via `SchemaReconciler` detecting drift between PG and local schema.
4. **Subquery invalidation** (`consumer.ex:276-310`) — if the shape uses subqueries.

**The race window during async cleanup (`shape_cleaner.ex`):**

```
T1: Consumer terminates (e.g., truncate detected)
    → terminate callback runs: flushes buffer, preserves @read_path_keys in stack ETS
    → remove_shape_async() spawns background cleanup task

T2: Cleanup task starts running:
    1. ShapeStatus.remove_shape()  -- removes handle from shape registry
    2. Consumer.stop()             -- ensures consumer is stopped
    3. Storage.cleanup!()          -- :ets.delete(stack_ets, shape_handle)
                                      moves data files to trash via AsyncDeleter
    4. ShapeLogCollector.remove_shape()

T3: Between T1 and T2.1: A client request arrives
    → validate_shape_handle(H) → PASSES (ShapeStatus still has it)
    → fetch_latest_offset(H) → reads from stack ETS → returns correct offset
    → NOT out of bounds (offset is correct from terminate flush)

T4: Between T2.1 and T2.3: A client request arrives
    → validate_shape_handle(H) → FAILS (ShapeStatus removed it)
    → resolve_shape_handle returns nil → 409 (correct behavior)

T5: Between T2.2 and T2.3: An edge case
    → If populate_read_through_cache! fires after ETS delete but before
      ShapeStatus remove (shouldn't happen given ordering above)
    → last_seen_txn_offset = nil (not on disk) → low offset → out of bounds
```

**For `changes_only` shapes, the impact is worse:** After invalidation and
recreation, the new shape has NO historical data. The new shape's offset starts
at `last_before_real_offsets()` ({0, :infinity}). A client from the old
incarnation with a real offset like `6868065325280_0` would be massively out
of bounds — and the 10-second grace period can't help because the data doesn't
exist in the new shape at all.

**Why this causes "over and over":** If something is repeatedly invalidating
the shape (periodic truncation, frequent schema reconciliation, etc.), each
cycle creates a new race window. TanstackDb silently handles 409s (refetching
with new handle), but 400 "out of bounds" errors surface as failures.

### Hypothesis 2: Chunk Boundary Race During Large Transactions

During `append_to_log!` in the write loop, chunk boundaries are written to the
ETS metadata cache **mid-transaction** when `bytes_in_chunk >= chunk_bytes_threshold`
(default: 10 MB). But `last_seen_txn_offset` is only updated **after** the
entire reduce loop completes, in `register_complete_txn` (`write_loop.ex:362-376`).

```
Timeline during a single append_to_log! call:
1. Processing line N: bytes_in_chunk exceeds 10MB threshold
2. maybe_write_closing_chunk_boundary fires:
   a. Chunk boundary written to ETS cache (max offset = line N's offset Z)
   b. update_chunk_boundaries_cache updates stack ETS  ← VISIBLE TO READERS
   c. flush_buffer runs → updates last_seen_txn_offset = Y (PREVIOUS txn's offset)
3. Processing continues for lines N+1 through end of transaction
4. After reduce loop: register_complete_txn → last_seen_txn_offset = final offset

Between steps 2b and 4, a concurrent reader sees:
  - get_chunk_end_log_offset() → Z (from chunk boundary, mid-current-txn)
  - fetch_latest_offset() → Y (from previous txn, Y < Z)
  - Response offset = Z
  - Next request with offset Z: fetch_latest_offset() → still Y → OUT OF BOUNDS
```

**Conditions required:** Transaction must produce >10 MB of data for the shape.
This could explain "over and over" if the `offer_items` table regularly receives
large bulk operations. Resolves once the transaction finishes processing.

### Hypothesis 3: Writer Crash with Unflushed Buffer

**Note:** Marius says the error is unrelated to server restarts. This hypothesis
would only apply if individual consumer/writer processes crash (without a full
server restart) and are restarted by the supervision tree.

The two-layer offset tracking system:
1. **`last_seen_txn_offset`** — stored in ETS only (NOT persisted to disk).
   Updated synchronously during `append_to_log!` via `register_complete_txn`.
   This is what `fetch_latest_offset` reads first.
2. **`last_persisted_txn_offset`** — persisted to disk AND cached in ETS.
   Updated only when the write buffer is flushed (every 64KB or 1s boundary).

**Key finding:** `last_seen_txn_offset` is NOT in `@stored_keys`
(`pure_file_storage.ex:65-74`), meaning `write_metadata!` is a no-op for it.
It only exists in the ETS cache. If the consumer crashes uncleanly (`:kill`, OOM),
`terminate` doesn't run, and the ETS metadata may reflect a stale offset.

However, during clean termination (`:shutdown`), `terminate` runs
`flush_and_close_all` → `flush_buffer` which updates the ETS metadata with
correct values. And `clean_shape_ets_entry` preserves `@read_path_keys`
(including `last_seen_txn_offset`). So clean terminations should not cause
offset regression.

### Hypothesis 4: CDN/Proxy Serving Stale Response

The requests go through `api3.autarc.energy/v1/electric-shape-proxy/`. If a CDN
or caching proxy served a stale response (e.g., from before a shape rotation),
the client could end up with an offset from a previous shape incarnation.

Non-live responses have `cache-control: public, max-age=60, stale-while-revalidate=300`.
If the shape was rotated and the CDN served a cached response with the old offset
but the new handle, the client's offset would be out of bounds for the new shape.

### Why `log=changes_only` Is Likely Key

For `changes_only` shapes:
- The initial snapshot is empty (`querying.ex:106-108`)
- The shape only accumulates log entries from WAL changes after creation
- If a shape is lost and recreated, it has NO historical log entries
- The new shape's `last_offset` starts at `LogOffset.last_before_real_offsets()` ({0, :infinity})
- A client holding offset `6868065325280_0` from the old shape would be massively out of bounds

This makes `changes_only` shapes **especially vulnerable**: after any shape
rotation, the new incarnation cannot possibly catch up to the client's old
offset, because the historical data simply doesn't exist.

## Questions to Ask the User (Marius)

1. **Are there TRUNCATE operations on `offer_items`?** (ETL, cron, bulk refresh)
   → Check for server logs: `"Truncate operation encountered while processing txn"`
2. **Are there DDL/schema changes on `offer_items`?** (migrations, ALTER TABLE)
   → Check for server logs: `"Schema for the table...changed - terminating shape"`
3. **Does the shape use WHERE clauses with subqueries?**
4. **Is Electric running multiple instances behind a load balancer?**
   (Different instances could have different offsets for the same shape)
5. **What is the typical transaction size for `offer_items`?**
   (Large bulk inserts >10MB would trigger the chunk boundary race)
6. **Can you share the server logs around the time of the error?**
   Looking for "Truncate operation", "Schema...changed", "terminating shape",
   "Notifying...clients about new changes" messages

## Impact

When the 400 error occurs:
1. The Electric stream for that shape is terminated
2. TanStack DB is waiting for a txid to appear in the stream
3. The txid never arrives → `TimeoutWaitingForTxIdError`
4. Optimistic mutations are reverted
5. For the user, data appears to vanish

## Potential Fixes

### Fix 1: Return 409 Instead of 400 for Persistent Out-of-Bounds (Recommended)

When the out-of-bounds grace period expires and the shape can't catch up, return
a 409 with the current handle instead of 400. This tells the client to refetch
from scratch, which is the correct recovery behavior.

**Rationale:** The 400 response is a dead end — the client doesn't know how to
recover. A 409 triggers the existing "must refetch" logic in TanstackDb and
other clients. This is the same as shape rotation, so existing client logic
handles it.

**Location:** `api.ex:793-799` — change from `Response.invalid_request` to
`Response.error` with status 409.

**Trade-off:** The client loses its position and must re-sync from the beginning.

### Fix 2: Prevent chunk_end_offset from exceeding last_seen_txn_offset

In `determine_log_chunk_offset` (`api.ex:422-432`), cap `chunk_end_offset` to
never exceed `request.last_offset`:

```elixir
chunk_end_offset =
  case Shapes.get_chunk_end_log_offset(api.stack_id, handle, offset) do
    nil -> last_offset
    end_offset -> LogOffset.min(end_offset, last_offset)
  end
```

This prevents the response offset from being set to a mid-transaction chunk
boundary that's ahead of `last_seen_txn_offset`.

### Fix 3: Persist `last_seen_txn_offset` to Disk

Add `:last_seen_txn_offset` to `@stored_keys` in `pure_file_storage.ex`, and write
it to disk in `update_global_persistence_information`. This eliminates the gap
between ETS and disk for crash scenarios.

**Trade-off:** Additional disk I/O per transaction.

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
