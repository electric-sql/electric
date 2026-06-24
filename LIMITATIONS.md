# Limitations & planned work

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
2. Write the 33-byte WAL header at the reserved WAL segment offset.
3. `splice` the just-written hot file bytes → WAL segment payload offset (via pipe).

Because the WAL uses **header-only CRC** (no payload checksum), the payload
bytes never need to pass through userspace. Crash safety relies on the
file-before-WAL write order (step 1 before step 3): a crash between them leaves
a torn WAL record, which recovery detects and truncates from the per-stream file.
See [ARCHITECTURE.md](ARCHITECTURE.md#optional-fast-paths--observability) for
the full design, and `zero_copy_torn_tail_recovered_by_replay` for the crash test.

### Still planned

- **(a) easy** — vectored write (`pwritev` of `[header_iov, payload_iov]`) to
  drop the header+payload heap copy on the WAL segment write. Complementary to
  `--zero-copy` (the buffered path still incurs the framing copy; `pwritev`
  would eliminate it there without requiring the page-cache relay).
