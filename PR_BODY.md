## Summary

Enhanced ETS table performance by enabling read and write concurrency across multiple high-traffic tables. This optimization significantly improves performance under concurrent workloads, particularly addressing slow deletes with large numbers of shapes.

## Problem

ShapeStatus tables were experiencing lock contention during concurrent operations:
- **LastUsedTable**: 5-50+ concurrent API clients updating timestamps via `await_snapshot_start()` calls (dozens to hundreds per second)
- **MetaTable**: 10-20+ concurrent consumers updating offsets/xmins during transaction processing across different shapes
- Without `write_concurrency`, all operations serialized on a global write lock
- **Shape deletes were blocked** waiting behind concurrent write operations, causing slow performance with many shapes

## Solution

Added `write_concurrency: true` to ShapeStatus tables (LastUsedTable and MetaTable) since they have:
- Multiple concurrent writers to distributed keys (different shape_handle per operation)
- High write frequency under load
- No hot key contention

Also added appropriate concurrency options to other high-traffic tables following best practices:
- **StatusMonitor**: `read_concurrency` only (single GenServer writer, many concurrent readers for health checks)
- **EtsInspector**: `read_concurrency` only (cache pattern with single GenServer writer)
- **CallHomeReporter**: Both flags (concurrent metric aggregation)
- **RefCounter**: Both flags (concurrent ref count updates)
- **StackConfig**: Both flags (concurrent config updates)
- **InMemoryStorage**: `read_concurrency` only (single Consumer writer per shape, many readers)
- **PureFileStorage**: Both flags (buffering pattern with concurrent access)

## Expected Improvements

- Faster shape deletion operations (no longer blocked by timestamp updates)
- Better scalability with increasing number of concurrent shapes
- Reduced contention on API client operations
- Smoother consumer offset/xmin updates during replication

## Tables Modified

| Table | read_concurrency | write_concurrency | Rationale |
|-------|------------------|-------------------|-----------|
| **ShapeStatus (LastUsedTable)** | ✅ | ✅ | High concurrent writes to distributed keys |
| **ShapeStatus (MetaTable)** | ✅ | ✅ | Multiple consumers updating different shapes |
| **StatusMonitor** | ✅ | ❌ | Single GenServer writer, many readers |
| **EtsInspector** | ✅ | ❌ | Cache pattern, single writer |
| **CallHomeReporter** | ✅ | ✅ | Concurrent metric aggregation |
| **RefCounter** | ✅ | ✅ | Concurrent ref counting |
| **StackConfig** | ✅ | ✅ | Concurrent config updates |
| **InMemoryStorage** | ✅ | ❌ | Single Consumer writer per shape |
| **PureFileStorage** | ✅ | ✅ | Buffering with concurrent access |

## Testing

- Formatted code to comply with Elixir line length limits (98 chars)
- Updated CHANGELOG.md with performance improvement notes
