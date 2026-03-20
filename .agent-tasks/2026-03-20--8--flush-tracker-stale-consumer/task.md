# Task: FlushTracker stale consumer edge case tests

## Problem

When a consumer dies via `handle_materializer_down` with `:shutdown` reason:
1. Consumer stops with `{:stop, :shutdown, state}` (skipping `stop_and_clean`)
2. `terminate/2` calls `handle_writer_termination` clause 3 which returns `:ok` without cleanup
3. ConsumerRegistry ETS entry is NOT removed (unregister_name is a no-op)
4. ShapeLogCollector is NOT notified to remove the shape from FlushTracker
5. If no future transactions affect that shape, the stale FlushTracker entry persists indefinitely
6. This blocks `last_global_flushed_offset` advancement → unbounded WAL growth

This only affects `allow_subqueries` stacks since `handle_materializer_down` requires materializers.

## Goal

Write tests demonstrating this edge case at different levels:
1. FlushTracker unit level: a shape tracked but never flushed/removed blocks advancement
2. ShapeLogCollector integration level: a consumer that dies out-of-band after receiving a transaction leaves FlushTracker stuck
3. Full integration: demonstrate the materializer-death path that triggers handle_materializer_down → consumer death → stale FlushTracker
