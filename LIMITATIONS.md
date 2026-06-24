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

### Removed: `--zero-copy` (the durable page-cache splice relay)

The durable WAL zero-copy path was once offered as the optional `--zero-copy`
flag (Linux only): a **page-cache relay** that `splice`'d the body socket → per-stream
file, wrote the WAL header, then `splice`'d the hot file bytes → WAL segment payload.
Because the spliced payload never passed through userspace it could not be
checksummed, so that path wrote `flags = 0` / `payload_crc = 0` and relied on a
header-only CRC plus the file-before-WAL write order — leaving a **Bug #1 torn-payload
residual** (a crash could leave an unchecksummed, partially-written WAL payload that
recovery could not distinguish via CRC).

`--zero-copy` has been **removed**, collapsing the append surface to two modes:
`wal` (default, buffered, fully durable) and `memory` (zero-copy socket→file, no
WAL, not crash-durable — durability delegated to replication). The `wal` path always
sets `PAYLOAD_CHECKSUMMED` and stores the payload `crc32c` in the 38-byte header, so a
crash leaving a valid header over a `fallocate`-zeroed payload is caught by the CRC
mismatch and treated as `Torn` on recovery. With the only flag-clear writer gone,
**every WAL record is now checksummed — Bug #1 is fully closed, with no residual**.

(`memory` mode keeps the zero-copy socket→file splice for binary appends — it writes
the per-stream file only, has no WAL, and is documented as not locally crash-durable.)

### Still planned

- **(a) easy** — vectored write (`pwritev` of `[header_iov, payload_iov]`) to
  drop the header+payload heap copy on the WAL segment write — the buffered `wal`
  path still incurs the framing copy, which `pwritev` would eliminate.
