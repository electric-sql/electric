# Limitations & planned work

## `--durability memory` is not locally crash-durable

`memory` mode writes appends to the per-stream file (page cache) and acks
immediately — no `fdatasync`, no WAL. This means:

- **Not locally crash-durable.** A power loss, kernel panic, or OOM kill before
  the OS flushes the page cache can lose any un-fsynced writes. The committed
  data is those bytes that happened to reach disk before the crash, which is
  undefined and OS-dependent.
- **Wider producer-dedup-lag window.** Because there is no WAL, the producer
  dedup state (in-memory) is only as durable as the `.meta` sidecar flush
  (debounced, not synchronous on every append). The dedup lag window described
  in [PROTOCOL.md §4.1](../../PROTOCOL.md) is wider in `memory` mode than in
  `wal` mode. Producers should bump their epoch on restart.
- **`wal → memory` mode switch is safe only from a cleanly-stopped dir.** If the
  server was last stopped gracefully (no un-replayed WAL), the data dir can be
  reused with `--durability memory`. Switching on a dir that has an un-replayed
  WAL (a `wal/` subtree with records past the last checkpoint) risks data
  divergence: the WAL records would not be replayed and the per-stream files
  would be incomplete.
- **`memory → wal` (the reverse) is safe.** Reopening a memory-written data dir
  with `--durability wal` simply runs WAL recovery over an absent or empty WAL
  and leaves the per-stream files intact — no data loss, and subsequent appends
  are immediately WAL-durable.
- **Replication is the intended (not-yet-built) durability source.** The design
  intent for `memory` mode is that durability comes from a replication layer
  (synchronous replica writes before ack). That layer is not yet implemented;
  `memory` mode today is suitable only for workloads where page-cache loss is
  acceptable (e.g. ephemeral caches, test environments, or deployments with
  external synchronous replication).

## WAL append framing copy (partially addressed)

Each binary append reads the body into a userspace heap buffer, writes it to the
per-stream file (the read view), then **copies it again** into a framed
`[header | payload]` buffer for the WAL segment write — one heap read, one
heap→heap framing copy, two kernel writes.

### Removed: `--splice-appends` (was strict-only, zero-copy)

Before WAL became the only durability mode, binary appends in `strict` could use
a true zero-copy fast path: the body went socket → pipe → per-stream file
entirely in the kernel via `splice(2)`, never touching the heap (binary streams
only — JSON transforms the body and fell back). It was a CPU-per-append lever,
off by default. It was removed with `strict` because it has a **single**
destination (the per-stream file) and so cannot also produce the WAL record: a
WAL append needs the same bytes in a second place (the WAL segment), and
`splice` consumes the socket once.

### Implemented: `--zero-copy` (page-cache relay, not tee)

The WAL zero-copy path is now implemented as the optional `--zero-copy` flag
(Linux only). Rather than `tee(2)` (which was considered but not chosen — `tee`
fans out the pipe into two destinations but requires the entire payload to fit in
the pipe buffer atomically, and does not support positioned writes to the WAL
segment), the approach is a **page-cache relay**:

1. `splice` the body socket → per-stream file (at the append offset, via pipe).
2. Write the 38-byte WAL header at the reserved WAL segment offset.
3. `splice` the just-written hot file bytes → WAL segment payload offset (via pipe).

The buffered (default) path now always sets `PAYLOAD_CHECKSUMMED` and stores the
payload `crc32c` in the header, closing Bug #1 (torn-payload-zeros): a crash leaving
a valid header over a `fallocate`-zeroed payload is caught by the CRC mismatch and
correctly treated as `Torn` on recovery.

The `--zero-copy` splice path writes `flags = 0` / `payload_crc = 0` — it uses a
**header-only CRC** (no payload checksum) — because the payload bytes never pass
through userspace and therefore cannot be checksummed. This means the zero-copy path
retains the Bug #1 torn-payload residual: crash safety relies solely on the
file-before-WAL write order (step 1 before step 3). A crash between those steps
leaves a torn WAL record, which recovery detects and truncates from the per-stream file.
See [ARCHITECTURE.md](ARCHITECTURE.md#optional-fast-paths--observability) for
the full design, and `zero_copy_torn_tail_recovered_by_replay` for the crash test.

- **Closing Bug #1 for zero-copy** would require a durable per-segment written
  high-water mark: recovery refuses to scan past it, so a zeroed-payload record
  past the high-water is rejected even without a payload CRC. Cost: +1 `fdatasync`
  per group-commit. A noted future option, not done here.

### Still planned

- **(a) easy** — vectored write (`pwritev` of `[header_iov, payload_iov]`) to
  drop the header+payload heap copy on the WAL segment write. Complementary to
  `--zero-copy` (the buffered path still incurs the framing copy; `pwritev`
  would eliminate it there without requiring the page-cache relay).
