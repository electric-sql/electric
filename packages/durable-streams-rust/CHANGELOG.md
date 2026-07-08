# @electric-ax/durable-streams-server-rust

## 0.1.4

### Patch Changes

- 640509c: Write-path performance overhaul plus three crash-recovery correctness fixes.

  Performance: removed the WAL group-commit coordination ceiling (+55–60% saturated write throughput, p99 41→12 ms), fixed the 200k–1M stream-cardinality write cliff (1M streams now sustains 1.11M ops/s on 16 vCPU), and made `--durability memory` the buffered append path (4× faster, no longer Linux-only). New flags: `--wal-stats <secs>` and `--worker-threads <n>`.

  Fixes (found by the new seeded crash/fault simulation): multi-segment WAL recovery no longer drops acked records after the first segment; a torn, never-acked tail on a quiet stream is truncated instead of becoming reader-visible; an acked DELETE is now durable before the 204.

## 0.1.3

### Patch Changes

- 3c6e2ce: Cut SSE fan-out per-subscriber memory by ~60%. Each live subscriber used to spawn a producer task and an mpsc channel and keep the whole connection state machine resident while parked. SSE is now produced inline (new pull-based `Body::Sse`) and the connection is handed to a small dedicated streaming task, so an idle subscriber's resident footprint collapses to roughly a cursor over the shared stream tail.

  Live-tail SSE subscribers are then served from a fixed pool of epoll reactor threads instead of a parked connection task per subscriber. Each subscriber becomes a compact slab entry, so per-subscriber resident memory drops from ~7 KiB to ~0.6 KiB and stops scaling with the number of active connections. Linux only; other platforms keep the existing path.

## 0.1.2

### Patch Changes

- d1db07a: Rename the package folder to `packages/durable-streams-rust`. Drop the Intel
  macOS (`macos-13`) build from the release matrix. Correct the README throughput
  figure.

## 0.1.1

### Patch Changes

- af30a62: Import the high-performance Rust Durable Streams server as
  `@electric-ax/durable-streams-server-rust`. Released via Changesets (the anchor is
  `private`, so Changesets bumps the version and CI publishes the binary packages):
  npm (main + four platform packages), the `durable-streams` crate on crates.io, and
  a multi-arch `electricax/durable-streams-server-rust` Docker image. Adds a Rust
  build/test/clippy + conformance-matrix CI workflow and a distroless Dockerfile.
