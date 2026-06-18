# Benchmarks

This document describes the performance experiments we run against this server:
the run environment, how the measurements are set up, and an engine-level
comparison against [Ursula](https://github.com/tonbo-io/ursula), a Raft-based
durable-streams server.

These benchmarks are **tailored for the way this server is deployed** — a single
self-contained binary with a data directory, no broker or external database.
They emphasise the paths that deployment actually exercises: hot resident
catch-up reads (served zero-copy with `sendfile(2)`), group-commit append
throughput, and cold-tier offload. They are not a general database benchmark and
they are not tuned to flatter any particular shape of workload.

The full harness (server launch, cgroup pinning, load-generator scripts and
aggregation) is being prepared as a **separate, reproducible benchmark
repository** so the numbers below can be re-run end to end.

## Run environment

|                |                                                          |
| -------------- | -------------------------------------------------------- |
| Machine        | Dedicated Hetzner server                                 |
| CPU            | Intel Xeon E5-1650 v3 @ 3.50 GHz (6 cores / 12 threads)  |
| Memory         | 251 GB                                                   |
| OS             | Ubuntu 24.04, Linux kernel 6.8                           |
| CPU governor   | `performance` (pinned before each run for stable clocks) |
| Load generator | `wrk` (compiled, multi-threaded)                         |

## How it's set up

The goal is to measure _server_ cost with no contention from the load
generator, and to read CPU directly from the kernel rather than parsing `/proc`.

- **Server in its own cgroup.** Each server runs as a transient `systemd`
  service. That gives it a dedicated cgroup: `AllowedCPUs` (a cpuset) pins it to
  a fixed set of cores, `MemoryMax` bounds its page cache (so cold reads do real
  disk I/O), and `CPUUsageNSec` reports exact server CPU over the measurement
  window — no sampling.
- **Client on disjoint cores.** `wrk` is `taskset`-pinned to a _disjoint_ set of
  cores, so client and server never steal each other's CPU. On the 12-thread box
  the split is **server 0–7, client 8–10, with core 11 reserved** for the system
  and `sshd` (so a saturating run can never lock the box out).
- **Matched durability.** Both servers are configured as pure local-durable:
  this server with cold tiering off, Ursula as a single-node Raft group with a
  disk write-ahead log and no cold backend. So an append is _fsync versus fsync_
  and a read is _read versus read_.
- **Repeats.** Each cell runs 3 times; we report the median and the coefficient
  of variation (cv) across repeats.

## This server (raw engine)

Server cgroup-pinned to 8 cores, `wrk` on 3 disjoint cores, governor
`performance`.

**Reads** (conn 256):

| read size | throughput | server CPU |
| --------- | ---------- | ---------- |
| 1 KB      | 236k /s    | 508 %      |
| 16 KB     | 160k /s    | 456 %      |
| 1 MB      | 11.2k /s   | 266 %      |

**Read scaling by server cores** (1 KB, conn 256): 2c → **193k**, 4c → **256k**,
8c → 236k /s — scales until the 3-core load generator saturates past 4 server
cores.

**Appends** (100 B): 116k /s @ conn 64, **210k /s** @ conn 256 (group commit).
`--splice-appends` (1 MB binary): 375 → 404 /s at **76% → 43% CPU** (a CPU
lever, not a throughput one). Cold-tier read (`--tier local`): ~**5 GB/s**.

## Byte vs JSON mode

The server speaks two body modes: **binary** stores the POST body verbatim
(wire == body), and **JSON** parses and reframes it (single values are wrapped
into the stream's JSON array; array POSTs are flattened into individual records).
The append path is where they could diverge — binary is `splice(2)`-eligible,
JSON is not. Measured at a 100-byte payload, 3 repeats, cv mostly < 1%.

**Appends** (median):

| mode                        | conn | appends/s      | CPU% | note                 |
| --------------------------- | ---- | -------------- | ---- | -------------------- |
| binary                      | 64   | 118k /s        | 354  |                      |
| binary                      | 256  | 220k /s        | 561  |                      |
| json (single value)         | 64   | 117k /s        | 359  | ≈ binary             |
| json (single value)         | 256  | 217k /s        | 560  | ≈ binary             |
| json (10-record array)      | 64   | 103k batches/s | 338  | = **1.0M records/s** |
| json (10-record array)      | 256  | 212k batches/s | 594  | = **2.1M records/s** |
| binary + `--splice-appends` | 64   | 95k /s         | 333  | _slower_             |
| binary + `--splice-appends` | 256  | 108k /s        | 364  | _slower_             |

**Reads** (catch-up GET, conn 256): binary **118k /s** (613% CPU) vs json
**111k /s** (665% CPU).

Takeaways:

- **JSON single-value append costs essentially nothing** vs binary at this size
  (117k vs 118k, same CPU). Appends are fsync/group-commit-bound, so the JSON
  transform is in the noise — the bottleneck is durability, not parsing.
- **JSON reads are ~6% below binary** at equal preload, at slightly higher CPU.
  Reads are byte-range serves of the stored wire bytes, so the modes are nearly
  read-equivalent; the small gap is the stored-size difference plus framing.
- **`--splice-appends` is a large-body lever, not a small one.** At 100 B it
  _reduces_ append throughput (95k vs 118k): the per-request splice setup
  (pipe + fresh fd + offset) outweighs the userspace copy it eliminates. It pays
  off only for large binary ingest (≈ 1 MB), which is why it is off by default.
- **Array flattening is efficient** — 10-record array POSTs sustain ~2.1M
  records/s, so JSON batching is the high-ingest path when records are small.

Caveat: this is a 100-byte payload. The JSON transform cost scales with payload
size and structure, so a large-value / deeply-nested comparison is a follow-up.

## Engine-level comparison: this server vs Ursula

Both servers run the _same_ binary-protocol shape — `PUT` a stream, `POST` raw
bytes, `GET` to read back — under the methodology above, pinned to the same 8
cores. Reads are catch-up `GET`s of a pre-seeded stream; appends are covered in
two ways (see open questions).

<!-- RESULTS:BEGIN -->

Median of 3 repeats; cv across repeats was < 1% for nearly every cell.

**Reads** — catch-up `GET` of a resident stream:

| size  | conn | this server | Ursula  | ratio | this CPU% | Ursula CPU% | this p99 | Ursula p99 |
| ----- | ---- | ----------- | ------- | ----- | --------- | ----------- | -------- | ---------- |
| 1 KB  | 16   | 216k /s     | 71k /s  | 3.05× | 474       | 493         | 0.09 ms  | 0.46 ms    |
| 1 KB  | 64   | 232k /s     | 88k /s  | 2.63× | 501       | 581         | 0.38 ms  | 1.36 ms    |
| 1 KB  | 256  | 236k /s     | 97k /s  | 2.42× | 509       | 643         | 1.12 ms  | 4.45 ms    |
| 1 KB  | 1024 | 240k /s     | 93k /s  | 2.58× | 541       | 668         | 6.44 ms  | 142 ms     |
| 16 KB | 256  | 160k /s     | 76k /s  | 2.11× | 456       | 615         | 1.63 ms  | 5.71 ms    |
| 1 MB  | 256  | 11.2k /s    | 6.1k /s | 1.83× | 269       | 584         | 22.3 ms  | 50.9 ms    |

This server serves reads at **1.8–3×** the throughput, and the gap is widest at
small sizes where the zero-copy `sendfile(2)` path matters most.

**Read scaling by server cores** (1 KB, conn 256) — the cleanest efficiency
view, because at 2 and 4 cores both servers use essentially the same CPU:

| server cores | this server | Ursula | ratio | this CPU% | Ursula CPU% |
| ------------ | ----------- | ------ | ----- | --------- | ----------- |
| 2 cores      | 203k /s     | 48k /s | 4.26× | 200       | 199         |
| 4 cores      | 258k /s     | 75k /s | 3.42× | 382       | 374         |
| 8 cores      | 235k /s     | 97k /s | 2.43× | 513       | 635         |

At an _equal CPU budget_ this server delivers **3–4×** the read throughput (its
own throughput plateaus at 8 cores only because the 3-core load generator
saturates first).

**Appends — concurrent single-record** (one `POST` per message, the
many-independent-producers case):

| conn | this server | Ursula | ratio | this CPU% | Ursula CPU% | this p99 | Ursula p99 |
| ---- | ----------- | ------ | ----- | --------- | ----------- | -------- | ---------- |
| 64   | 117k /s     | 553 /s | 211×  | 357       | 56          | 0.78 ms  | 144 ms     |
| 256  | 219k /s     | 478 /s | 458×  | 559       | 58          | 1.88 ms  | 833 ms     |

Here group commit dominates: this server folds the concurrent appends into shared
fsyncs, while Ursula commits roughly one fsync per request (~500/s, fsync-bound,
50-ms-plus latency). This is the workload group commit is built for; see the
bulk-ingest row for the amortised view.

**Appends — bulk ingest** (Ursula's `append-batch` of 512 records vs a single
equally-sized `POST` here — one fsync each, conn 16):

| batch       | this server            | Ursula                 | ratio | this CPU% | Ursula CPU% |
| ----------- | ---------------------- | ---------------------- | ----- | --------- | ----------- |
| 512 × 100 B | 287 MB/s (2.87M rec/s) | 180 MB/s (1.80M rec/s) | 1.59× | 58        | 159         |

Once fsync is amortised both servers ingest at hundreds of MB/s; this server is
**~1.6× faster at roughly a third of the CPU** (58% vs 159%).

> **Coming next: multi-stream.** Everything above drives a _single_ stream. The
> next experiment is a multi-stream fan-out comparison — many concurrent streams
> with independent producers and consumers. That is the workload where Ursula's
> multi-Raft, thread-per-core design is meant to scale, so it is the fair test of
> both servers under realistic load. Results will be added here.

<!-- RESULTS:END -->

## Engine exploration: hyper, raw, and io_uring

This server now ships a **single** hand-rolled HTTP/1.1 engine (`raw`). It got
there after an exploration with **three** interchangeable engines behind a
`--http-engine` flag, sharing one handler/store layer — only the I/O loop
differed:

- **`hyper`** — portable default, tokio + hyper, buffered reads.
- **`raw`** — owns the socket, so reads are served zero-copy with `sendfile(2)`
  and binary appends with `splice(2)`.
- **`io_uring`** — a thread-per-core runtime backed by `io_uring`: batched
  submit/complete with no epoll round-trip, async in-kernel file reads, and no
  blocking-pool handoff for cold reads.

We kept the measurements because **io_uring was genuinely the best option in some
cases** and that's worth remembering. All numbers below are from the same
cgroup-pinned methodology (1 KB reads, conn 256 unless noted).

**Small reads on a CPU-constrained server — io_uring wins:**

| server cores | hyper   | raw         | io_uring    |
| ------------ | ------- | ----------- | ----------- |
| 2 cores      | 123k /s | 180k /s     | **257k /s** |
| 4 cores      | 195k /s | 253k /s     | 254k /s     |
| 8 cores      | 216k /s | **235k /s** | 222k /s     |

The hot small-read path is essentially syscall-bound, so the only lever is _fewer
mode switches_. io_uring folds `recv` + `send` into roughly one `io_uring_enter`,
where `raw` issues separate `recvfrom` + `sendto`/`sendfile`. At the syscall level
(a separate Docker micro-bench) that showed as **419k/s @ p50 103 µs for io_uring
vs 355k/s @ 148 µs for raw**. The advantage is real only while the server is the
bottleneck; as cores scale the gap closes and reverses (8c: raw ≥ io_uring).

**Where io_uring lost:**

- **Large reads.** 1 MB: raw **11.3k /s @ 269% CPU** vs io_uring 7.6k /s @ 477%.
  raw's `sendfile` is zero-copy; io_uring's streamed file reads copy through
  userspace buffers (no `splice`/`SEND_ZC` wired up), so zero-copy wins decisively.
- **Appends.** conn 256: raw **208k /s** vs io_uring 91k /s — io_uring was the
  weakest appender and regressed past 4 cores.
- **CPU efficiency.** io_uring traded CPU for throughput (~500% vs raw's ~290% on
  small reads).

**Where io_uring also genuinely helped:** cold-read isolation came for free. Its
async in-kernel file reads kept a cold backfill off the hot path _without_ the
`--read-offload` knob `raw` needs — hot 4 KB reads under a concurrent 1 GB cold
backfill stayed ~78 µs median / ~80 ms max with no worker collapse (`raw inline`
spiked to ~715 ms; `raw tail` was the tightest at ~10.7 ms but needs the knob).

**Why we dropped it.** `raw` is the best all-rounder — top-or-tied reads at scale,
2× on large reads at half the CPU, and the best appends. io_uring only wins small
reads on a CPU-bound host, is the worst appender, and burns more CPU per request.
Against that, the second engine cost a `tokio-uring` dependency, a thread-per-core
runtime, a `panic = abort` foot-gun, and `io_uring` syscalls that the default
container seccomp profile blocks — plus a whole second I/O loop to maintain.
Collapsing to one engine removed ~1,600 LOC and 4 dependencies.

So the verdict is **not** "io_uring is slower" — it's "one zero-copy engine is the
better product." The case where io_uring would pay off is specific and worth
flagging: a **small-read-heavy, CPU-constrained** deployment on an
`io_uring`-capable host where its syscall-batching and knob-free cold isolation
outweigh raw's zero-copy large-read and append advantages.

## Open questions and caveats

These shape how the numbers should be read, and what we still want to measure:

- **Append model — single-record vs batched.** This server's high append
  throughput comes from _group commit_: concurrent independent producers'
  appends coalesce into one shared fsync. Ursula amortises fsync differently, via
  an explicit `append-batch` endpoint. We therefore report both a concurrent
  single-record append test and a fair bulk-ingest test (Ursula's batched append
  versus a single equally-sized append on our side — one fsync each).
- **Busy-poll vs parking runtime.** Ursula uses a thread-per-core runtime that
  spins; this server parks idle workers. This inflates Ursula's measured read
  CPU% relative to ours, so read CPU/operation for Ursula is likely overstated.
- **Single-stream vs multi-stream.** This study drives a single stream. Ursula
  is multi-Raft and is designed to scale throughput across many streams; a
  single-stream test does not exercise that. A multi-stream fan-out comparison is
  the next experiment.
- **Record framing vs raw bytes.** Ursula stores framed records; this server
  stores the literal wire bytes. Payload sizes are matched, but on-disk and
  on-wire framing differ slightly.
- **Cold tier not yet compared.** Both servers support an S3-compatible cold
  tier; a cross-implementation cold-read comparison (memory-capped, served from
  object storage) is not yet part of this suite.
