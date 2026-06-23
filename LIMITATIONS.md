# Limitations & planned work

## WAL append is not zero-copy (planned)

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

### Planned

- **(a) easy** — vectored write (`pwritev` of `[header_iov, payload_iov]`) to
  drop the header+payload heap copy on the WAL segment write.
- **(b) zero-copy for WAL** — `socket → pipe`, then `tee(2)` the pipe into two,
  `splice` one copy to the per-stream file and the other to the WAL segment
  (after a positioned write of the 33-byte framed header). Feasible because the
  WAL uses **header-only CRC** (B-light framing): the payload is never
  checksummed, so the server never needs the payload bytes in userspace. This is
  the WAL-mode successor to the removed `--splice-appends`.
