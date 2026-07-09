# Mixed read/write workload validation (local, 2026-07-02)

Interference validation of **this branch's server build** under ds-bench's new mixed
workload (concurrent writers + paced catch-up readers + SSE subscribers on shared
streams). Run on a local kind cluster — server pinned to **2 CPU / 2 Gi**, single-node
MinIO, fresh server per cell. Shapes are trustworthy; absolute numbers need the remote
(GKE, separated node pools) run before being quoted.

**Provenance.** Server: `bench/mixed-interference-validation` @ `06a8a37c5`
(= `perf/combined-t1a-t1c-t2a` head), image `durable-streams:dev`
`sha256:5468aaa3ffd1…` (built via ds-bench's `dockerfiles/durable-streams.Dockerfile`).
Harness: `electric-sql/ds-bench` @ `3bcc0f2` (`suites/mixed-{cal,writes,delivery}-local.json`);
full grids + FINDINGS in `results/mixed-{writes,delivery}-local/` there.

Baseline ceiling (50 unthrottled writers, 256 B, no readers/subscribers):
**29.7k appends/s, p50 1.5 ms / p99 6.4 ms** — vs 19.6k for the pre-perf-branch build
in the morning's v1 run, i.e. this branch is ~1.5× faster on this box at 50-stream
write saturation.

## 1. Bounded catch-up read load does not cost write throughput

Writers pinned at 17.75k ops/s (60% of ceiling); readers each replay their stream
from offset 0 at 1 replay/s:

| readers | write ops/s | write p50/p99 ms | read MiB/s | read p50/p99 ms |
| ------- | ----------- | ---------------- | ---------- | --------------- |
| 0       | 17303       | 1.2 / 9.8        | —          | —               |
| 4       | 17755       | 1.0 / 5.7        | 3.8        | 1.7 / 10.5      |
| 16      | 17756       | 0.9 / 5.3        | 15.4       | 3.9 / 17.1      |
| 64      | 17756       | 1.0 / 6.5        | 61.5       | 5.5 / 65.5      |
| 128     | 17750       | 1.1 / 52.9       | 123.0      | 4.9 / 50.9      |

The pinned rate is delivered to within noise at every level; interference is
tail-only (write p99 6.5 → 53 ms once replay bandwidth passes ~60 MiB/s on 2 CPUs).
With **unpaced** hot-loop readers (adversarial mode, v1 run) the same sweep
fair-shares writes down −39%/−65%/−82% at 16/64/128 readers, with **zero 429/503 in
either mode** — the server never sheds read load; overload is silent. Worth deciding
whether that's intended behaviour at some point, but nothing on this branch regresses.

## 2. Live SSE delivery latency is flat under write load; the latency floor is fsync

100 SSE subscribers (2/stream), write rate swept 5% → 100% of ceiling, run under both
`--durability wal` and `--durability memory`:

| rate/writer | wal write ops/s | wal deliv p50/p99 | mem write ops/s | mem deliv p50/p99 |
| ----------- | --------------- | ----------------- | --------------- | ----------------- |
| 30          | 1502            | 3.2 / 12.4        | 1502            | 1.4 / 8.7         |
| 120         | 6002            | 0.9 / 10.1        | 6002            | 0.8 / 3.5         |
| 300         | 14741           | 2.1 / 17.2        | 15001           | 0.9 / 5.1         |
| 475         | 17380           | 2.8 / 20.9        | 23752           | 1.3 / 8.5         |
| max         | 17144           | 2.8 / 22.6        | 29247           | 3.3 / 34.8        |

- Delivery p99 ≈ **write p99 + 1–3 ms in both configs at every level** — the SSE
  fan-out path (reactor) is a small constant on top of commit latency. The apparent
  "~14 ms delivery floor" in the v1 run was WAL fsync cost on the local VM disk, not
  an SSE cadence. **No SSE-side change needed.**
- Every subscriber saw every record (deliveries = exactly 2× writes) at all levels
  except memory-`max`, where the single client pod (parsing ~44k events/s while
  driving ~29k appends/s) is the prime suspect, not the server.
- Fan-out tax: 100 subscribers cost ~42% of the wal write ceiling on 2 CPUs
  (29.7k → 17.1–17.4k). A number to re-measure remotely with more server cores.

## Verdict

The perf-branch server passes both interference premises: bounded read load leaves
write throughput intact (tails couple only at high read bandwidth), and live delivery
latency tracks commit latency with ~1–3 ms of fan-out overhead all the way to
saturation. No server changes came out of this validation; this doc is the evidence
record for the branch.
