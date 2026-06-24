# Architecture & performance

A reference for how the Rust Durable Streams server is built and why it's fast. The thesis in one line: **store each stream as the exact bytes that go on the wire, so a write is an append and a read is a byte range** — then make the append durable cheaply and the read leave the kernel as few times as possible.

- [The model](#the-model)
- [High-level: write path and read path](#high-level-write-path-and-read-path)
- [Write path in detail](#write-path-in-detail)
- [Durability](#durability)
- [Read path in detail](#read-path-in-detail)
- [Keeping I/O fast from ingestion to fan-out](#keeping-io-fast-from-ingestion-to-fan-out)
- [Where the time goes](#where-the-time-goes)
- [Tiering: hot buffer → cold storage](#tiering-hot-buffer--cold-storage-optional)
- [Optional fast paths & observability](#optional-fast-paths--observability)

## The model

A stream is an append-only log. On disk it's a single contiguous data file holding **exactly the wire bytes** a reader receives, plus a small `.meta` sidecar for recovery. There is no per-message framing on disk, no reframing on read, no database, no broker — just a process and a data directory (`store::StreamState`).

Two things fall out of that choice:

- A **read is a `pread`/byte-range** of the file → it is served with `sendfile(2)` on Linux (kernel page cache → socket, zero-copy), positioned reads elsewhere.
- An **append is a `write` + an `fsync`** (in `wal` mode; `memory` mode omits the fsync — see [Durability modes](#durability-modes)) → durability cost is dominated by the fsync, which we amortize across concurrent writers.

The HTTP layer is a single hand-rolled HTTP/1.1 loop (`engine_raw`) — no framework — so it owns the socket and can serve reads zero-copy.

## High-level: write path and read path

```mermaid
flowchart LR
  C(["Client"])

  subgraph WRITE["WRITE  ·  POST append"]
    direction TB
    W1["Engine: parse request<br/>(http1)"] --> W2["handlers::handle_append"]
    W2 --> W3["encode_wire<br/>(JSON flatten, append delimiter)"]
    W3 --> W4[["per-stream appender mutex"]]
    W4 --> W5["write_all → data file<br/>(lands in page cache)"]
    W5 --> W6["update tail + resident cache"]
    W6 --> W8["publish tail<br/>(watch channel)"]
    W8 --> W7["group-commit fsync<br/>(WAL shard committer)"]
    W7 --> W9["204 / 200 — only after durable"]
  end

  subgraph READ["READ  ·  GET"]
    direction TB
    R1["Engine: parse request<br/>(http1)"] --> R2["handlers::handle_read"]
    R2 --> R3{"mode"}
    R3 -->|"catch-up"| RB["read_range_body"]
    R3 -->|"long-poll"| R5["park on tail watch<br/>(timeout)"]
    R3 -->|"SSE"| R6["subscribe tail watch<br/>(loop)"]
    R5 --> RB
    R6 --> RB
    RB --> R7{"resident in<br/>tail cache?"}
    R7 -->|"yes (configurable cache)"| R8["Body::Full<br/>(from memory)"]
    R7 -->|"no / large / cold"| R9["Body::FileRange<br/>(sendfile)"]
    R8 --> R10(["socket"])
    R9 --> R10
  end

  C ==>|"append"| W1
  C ==>|"read"| R1
  W8 -. "wakes" .-> R5
  W8 -. "wakes" .-> R6
```

The dotted edges are the only coupling between writers and readers: publishing the new tail on a per-stream `watch` channel is what wakes live subscribers. Everything else is independent.

## Write path in detail

`handlers::handle_append` (src/handlers.rs):

1. **Parse idempotency headers** — `Producer-Id` / `Producer-Epoch` / `Stream-Seq`. Duplicate `(producer, epoch, seq)` is acknowledged without re-appending (exactly-once producers).
2. **`encode_wire`** — turn the request body into the contiguous wire representation. In JSON mode this flattens arrays and appends the `,` delimiter so the on-disk bytes are already a valid stream fragment.
3. **Acquire the per-stream appender mutex** (`AsyncMutex<Appender>`). This is the _only_ serialization point, and it's per-stream — different streams never contend.
4. **`write_wire`** — `write_all` the bytes to the data file (they land in the OS page cache immediately), advance the tail under a short `RwLock` write, update the **resident tail cache**, then **publish the new tail** on the `watch` channel. Note the order: the cache is populated _before_ the wake, so a woken subscriber reliably hits it.
5. **Durability** — in `wal` mode the append is staged into the stream's assigned WAL shard, and the response returns only after the shard's group-commit committer `fdatasync`s the segment covering this record. See [Durability](#durability) below. In `wal` mode everything above and the entire read path are identical regardless of workload. In `memory` mode binary appends take a separate socket→file splice path (zero-copy `splice(2)`, no WAL, no `fdatasync`) that bypasses `handle_append` / `encode_wire` via the engine zero-copy intercept and acks immediately after the page-cache write.

Visibility vs durability are deliberately decoupled: the bytes are in the page cache (and the tail is published) before durability resolves, so a live reader sees data with minimal latency, while the _appender_ doesn't get its 2xx until the data is durable.

## Durability

### Durability modes

The server supports two durability modes, chosen at startup via `--durability`.

**`wal` (default)** — durable, single-node no-loss durability via a sharded write-ahead log. An append acks only after its record is durable in the WAL (group-commit `fdatasync`). This is the safe default for any deployment where local disk loss must not cause data loss. See [`durable-wal.md`](../../docs/durable-wal.md) for the full design.

**`memory` (Linux-only)** — no WAL, no `fsync`: binary appends move `socket→file` via `splice(2)` (zero-copy in the kernel); JSON appends are buffered writes; ack fires on the page-cache write. The per-stream files are the only durable-enough record, and recovery is the existing sidecar pass (rebuild stream state from the per-stream files + `.meta` sidecars). **NOT locally crash-durable** — a power loss or kernel panic can lose any un-fsynced page. Durability is delegated to (future) replication. Exits with status 2 on non-Linux.

| Mode     | ack after        | fsync                  | WAL | crash-safe?          |
| -------- | ---------------- | ---------------------- | --- | -------------------- |
| `wal`    | WAL fdatasync    | group-commit per shard | yes | yes                  |
| `memory` | page-cache write | never                  | no  | no (page-cache only) |

### `wal` mode

Every append is written to the per-stream data file (page cache, no hot fsync — this is the read surface) and simultaneously staged into one of N WAL shards (FNV-1a stream→shard routing, N = CPU cores by default). A per-shard group-commit committer `fdatasync`s the segment covering those records and advances a durable watermark; the ack is released only then. Because one committer batches **many streams' appends into a single fat WAL fsync**, the server is cardinality-insensitive — it is as fast on 10,000 streams as on 10.

Per-stream files are `fdatasync`'d off the ack path at a periodic **checkpoint**, after which the bounded WAL is recycled. On boot, recovery replays the WAL from its oldest retained segment, reconciles each stream's durable tail (torn-tail repair via truncation + `fdatasync`), then resets the WAL for fresh appends.

The invariant: **visibility is never gated on durability**. Bytes land in the page cache and the tail is published before the WAL `fdatasync`, so live readers see an append at memory latency while the appender's acknowledgement waits for the WAL commit.

### `memory` mode

In `memory` mode no WAL is created or attached. Appends write directly to the per-stream file (buffered write for JSON; zero-copy `socket→file` splice for binary) and ack immediately after the page-cache write — no `fdatasync`, no WAL staging. The per-stream file is the data; the `.meta` sidecar records the stream configuration and tail. On restart, the server runs the same sidecar pass it runs in `wal` mode (rebuild each stream from its file + sidecar) — there is no WAL to replay. Durability is delegated to replication (not yet built).

## Read path in detail

`handlers::handle_read` parses the offset and dispatches by mode:

- **Catch-up** (`GET`, no `live`) — `read_range_body(start, tail)`. If the range is covered by the resident tail cache it returns `Body::Full` straight from memory; otherwise `tier::resolve_range` resolves the logical range to placement- aware slices (walking the fork parent chain for forked streams). If every slice is local (the live data file and/or sealed chunk files) it returns a zero-copy `Body::FileRange`; if any slice is remote it streams a bounded `Body::Channel` (one range-GET per remote segment).
- **Long-poll** (`live=long-poll`) — if the consumer is behind the tail, return the backlog immediately. Otherwise park on the stream's `watch` receiver until the next append or the timeout (204).
- **SSE** (`live=sse`) — spawn a task that subscribes to the `watch` channel and, on each tail change, reads the new range (cache fast-path), encodes it (`json` / `text` / `base64`), and pushes a frame onto an `mpsc` channel; the engine streams those frames as chunked transfer-encoding.

The engine then serves the response body with the matching primitive:

| body kind                | how it's written                                            |
| ------------------------ | ----------------------------------------------------------- |
| `Full` (cached / small)  | one coalesced write (head + body)                           |
| `FileRange` (large/cold) | **`sendfile(2)`** zero-copy on Linux; positioned reads else |
| `Channel` (SSE / cold)   | chunked transfer-encoding                                   |

## Keeping I/O fast from ingestion to fan-out

This is the diagram to anchor the performance story on — the byte flow and the technique that keeps each hop cheap.

```mermaid
flowchart TB
  subgraph ING["① Ingestion"]
    A1["N concurrent appends"] --> A2["encode to wire bytes<br/>(contiguous, ready-to-send)"]
    A2 --> A3["append to data file"]
    A3 --> A4{{"group-commit<br/>N appends → 1 barrier fsync"}}
  end

  A3 ==> PC[("OS page cache<br/>— the hot tier")]
  A3 ==> RC["resident tail cache<br/>(last chunk, configurable via --tail-cache-bytes,<br/>in heap)"]
  A3 -.-> TW[/"tail watch channel<br/>(one notify per append — before fsync)"/]

  subgraph FAN["② Fan-out"]
    direction TB
    TW -. "wake" .-> SUBS["live subscribers<br/>(SSE / long-poll)"]
    RC ==>|"shared read + encode<br/>(one copy serves all N)"| SUBS
    PC ==>|"sendfile<br/>(zero-copy byte range)"| BIG["catch-up & large reads"]
  end

  SUBS ==> SOCK(["sockets"])
  BIG ==> SOCK
```

The techniques, each with its mechanism and payoff:

1. **Contiguous wire-byte storage.** The file _is_ the response. Reads are byte ranges with no reframing and no per-message copy — and this is what makes `sendfile` zero-copy possible at all.
2. **Group-commit coalesced fsync.** The durability contract ("return after fsync") is the expensive part of an append. Concurrent appenders share a single in-flight barrier fsync, so throughput scales with the _batch size_ per fsync rather than one fsync per message. This is why unbatched appends hit ~30k/s where a per-append-fsync server (Node) does ~130/s.
3. **Per-stream single writer, lock-free reads.** One async mutex orders a stream's appends; there is no global lock (streams live in a `DashMap`). Reads take a brief tail snapshot and do positioned reads — they never block the writer and never wait on each other.
4. **Pre-fsync visibility.** Appended bytes are in the page cache and the tail is published before the fsync resolves, so live readers see data at memory latency; only the appender's acknowledgement waits for durability.
5. **`watch`-channel wakeups.** Live readers park on a per-stream `watch`; an append is one `send_replace` that wakes all of them. No polling loop, no timer churn.
6. **Resident tail cache (fan-out de-duplication).** Without it, N caught-up SSE/long-poll subscribers each re-read (and re-encode) the _same_ just-appended bytes — N× duplicated work that grows with audience size. The cache keeps the last chunk in the heap so all N share one read (and SSE encodes once per subscriber off that shared buffer). For small hot reads it's also fewer syscalls than `sendfile` and skips the read-offload pool hop.
7. **Zero-copy egress.** `FileRange` reads are served with `sendfile` (page cache → socket, no userspace copy → ~5× less CPU per byte than a buffered copy). The **`--read-offload`** strategy keeps a cold backfill's disk fault off the async workers so one slow read can't stall unrelated requests.
8. **Bounded memory everywhere.** Large reads stream in fixed chunks (the resident cache is configurable via `--tail-cache-bytes`; cold reads stream in windows) so serving a multi-GB backfill costs ~a chunk of RAM, not the read size.

## Where the time goes

The hot read path is essentially syscall-bound — at 1 KB it's recv + send (+ a file read for cold data) with almost no application CPU — which is why the I/O strategy (epoll + `sendfile`) is the lever, not the handler code. The append path is fsync-bound, which is why group-commit is the lever there.

Measured on a dedicated 12-core Xeon (Linux); server cgroup-pinned, client on disjoint cores, 2 repeats. Headlines (full table in the README / PR):

- **Small hot reads** (1 KB): cache-served, syscall-bound — **236k req/s** @ 8 cores (256k @ 4); scales with server cores until the load generator (3 cores) saturates.
- **Large resident reads** (1 MB): **11.2k/s at ~266% CPU** — zero-copy `sendfile` does the page-cache → socket transfer at a fraction of a buffered copy's CPU.
- **Appends:** fsync-bound; group-commit folds concurrent appends into ~one fsync — **210k/s** @ conn 256.

## Tiering: hot buffer → cold storage (optional)

Opt-in (`--tier`, off by default). The append-only, immutable-by-position model makes tiering almost free: once data leaves the live tail it never changes, so the server breaks each stream into fixed-size, CDN-friendly **segments** (default 8 MiB), **seals** them, and offloads them to object storage — keeping only the hot tail local. Catch-up reads of cold history come from the object store (and a CDN in front of it); the origin does little work for old data.

```mermaid
flowchart TB
  subgraph HOT["Hot tier (local)"]
    TAIL["active tail<br/>(unsealed, in the data file)"]
    SEG2["sealed segment N<br/>(local chunk file, pending upload)"]
  end
  subgraph COLD["Cold tier (S3-compatible: R2 / Tigris / MinIO / B2)"]
    OBJ0[("segment 0")]
    OBJ1[("segment 1")]
  end
  MAN["per-stream manifest<br/>logical_start → Local | Remote(key)<br/>+ sealed_offset watermark"]

  TAIL ==>|"crosses 8 MiB → seal"| SEG2
  SEG2 ==>|"upload → head-verify → flip manifest → unlink local"| OBJ1

  RD{{"GET ?offset"}} --> MAN
  MAN -->|"offset ≥ sealed_offset<br/>(local)"| TAIL
  MAN -->|"offset < sealed_offset<br/>(remote)"| COLD
  TAIL --> OUT(["response<br/>(sendfile, zero-copy)"])
  COLD --> OUT2(["response<br/>(range-GET, buffered)"])
```

Key properties:

- **The manifest is the authority.** A read resolves each requested offset against the per-stream manifest (held in memory, persisted in the `.meta` sidecar): at or above `sealed_offset` → local (zero-copy `sendfile`, unchanged); below it → the named object via range-GET, spliced into the response. A range spanning the boundary yields a mix.
- **Durability is never weakened.** An append still acks only after the local group-commit fsync. Offload is strictly _post-durability_: seal → upload → `head`-verify → durably flip `local → remote` → _only then_ unlink the staged chunk file. So a read never routes to an object that isn't there.
- **Chunk reclaim + live-file compaction.** Sealed segments are separate chunk files, so reclaiming a chunk is an `unlink` — safe even under an in-flight read (Unix keeps an open fd readable after unlink). The live data file's redundant sealed prefix is reclaimed by **compaction**: once it exceeds `--tier-compact-bytes` (default 64 MiB), the file is rewritten to hold only the hot tail `[sealed_offset, tail)`. Compaction runs under the per-stream appender lock (so `tail` is frozen): it writes the residual tail to a temp file, persists a `pending_compaction` intent, atomically renames it over the live file, then swaps the read handle together with its logical base (`file_base`) for readers as one consistent pair. In-flight reads drain off the old fd (the same unlink-after-open safety), so reads stay lock-free and never observe freed blocks — which is why compaction replaces the earlier `fallocate` hole-punch that raced those lazy reads. A crash mid-compaction recovers from the intent (`file_base = tail − file_size`). Trade-off: bounded write-amplification (the hot tail is rewritten once per threshold); tune or disable with `--tier-compact-bytes` (`0` disables).
- **JSON-safe sealing.** A JSON seal boundary always lands on a whole-value boundary (a byte-level scanner that ignores commas/brackets inside strings and honours escapes), so a sealed segment still reads back wrapped as `[ … ]`.
- **CDN-native.** Fully-sealed ranges are immutable, so they're served with `Cache-Control: immutable` and a long max-age — the CDN absorbs repeat cold reads before they reach the origin or the object store.

A cold or mixed (local + remote) read is streamed chunk-by-chunk as a `Body::Channel`, materializing one window at a time, so memory stays bounded regardless of how large the cold range is. Fully-local reads still use the zero-copy `Body::FileRange`/`sendfile` path; only the resident tail cache returns a small `Body::Full` from memory.

## Optional fast paths & observability

- **OpenTelemetry** (`--features telemetry`, off by default, zero-cost when off). A `ds.request` span plus lean, bounded-cardinality metrics aimed at the two pivots this document keeps returning to: **`ds.append.fsync.batch_size`** (group-commit health) and **`ds.read.offload.wait`** (cold-read pool pressure), alongside fsync/lock-wait/append/read latency histograms and the tail-cache hit ratio. This is how you watch the levers above in production.

- **Payload CRC (Bug #1 closed)** — every WAL record is written by the buffered `wal` path, which always sets `PAYLOAD_CHECKSUMMED` and stores the payload `crc32c` in the 38-byte header. A crash leaving a valid header over a `fallocate`-zeroed (never-fully-written) payload is therefore caught by the CRC mismatch on recovery (the record decodes as `Torn`, not as a zero-padded `Record`). There is no longer any unchecksummed WAL writer — the old `--zero-copy` durable splice relay that opted out of the payload CRC has been removed, so Bug #1 is fully closed.
