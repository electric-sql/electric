---
title: "Durable Streams at kernel speed"
description: >-
  A new open-source Rust reference server for Durable Streams that reaches a million operations per second on a single machine — durable, with no cluster and no replicas.
excerpt: >-
  Today we're releasing a Rust reference server for Durable Streams that scales to a million operations per second on a single machine. Here's the architecture, the kernel-level techniques that get it there, and how it benchmarks against existing implementations.
authors: [balegas]
image: /img/blog/durable-streams-at-kernel-speed/header.jpg
tags: [durable-streams, rust, performance]
outline: [2, 3]
post: true
published: false
---

<!-- TODO(asset): no header.jpg was provided — add /img/blog/durable-streams-at-kernel-speed/header.jpg before publishing (other posts use a header.jpg/hero.png in the same folder). -->

Every agent you work with today is backed by a log. [Durable Streams](/streams/) is the data primitive for storing that state: an append-only log that is durable, addressable, and writable from anywhere, so an agent can be [long-lived](/blog/2026/06/04/serverless-agents), shareable, and free to live on the internet.

Durable Streams is built around an open protocol. It is being used to build agent frameworks such as [Flue](https://flueframework.com/) and to persist token streams in chat applications such as Prisma's [oss.chat](https://www.prisma.io/blog/building-open-chat), and it is being implemented independently by projects such as [Ursula](https://ursula.tonbo.io/).

Today we are releasing a new reference-server implementation of Durable Streams, written in Rust, that scales to a million operations per second on a single machine. It's open source, performant, and maintained — a server people can build on and deploy easily.

In this blogpost we cover the architecture, dive into the techniques that get it there, and benchmark it against existing implementations.

> [!Warning] <img src="/img/icons/durable-streams.square.svg" style="height: 20px; margin-right: 6px; margin-top: -1px; display: inline; vertical-align: text-top" /> Run it yourself
> Deploy the [reference server](#), read the [architecture doc](#), [reproduce the benchmarks](#), and [implement the protocol](https://github.com/durable-streams/durable-streams/blob/main/PROTOCOL.md).
<!-- TODO(links): fill the three (#) placeholders above — reference-server deploy guide, architecture doc, and benchmark-reproduction repo/instructions. -->

## A primer on the protocol

A durable stream is an append-only log. A writer appends data to the tail; a reader supplies an offset — a position that maps to a precise byte in the log — and receives everything from there to the current tail. Once it has caught up, the reader can follow the stream live, over Server-Sent Events or long-polling.

Because the protocol is plain HTTP, a stream can be served from anywhere and can lean on existing HTTP infrastructure — CDNs in particular — for fast, global distribution.

## Architecture

At a high level the server has just two jobs: append the bytes of an HTTP request body to a file, and fan bytes from an arbitrary position in a file out to one or many clients. The model is almost trivially simple; the difficulty is making it scale.

The server is a single, standalone Rust binary. It has three parts: an HTTP server that implements the durable streams protocol, taking requests in and streaming responses out; a write-ahead log that makes each append durable; and a hot storage, built on the file system, that holds the recent tail of every stream as a file of the protocol's wire bytes. Behind it sits cold storage — an object store — that receives sealed chunks: the settled prefixes of streams, handed off once they can no longer change.

![Durable Streams server — high-level data flow, durability, and tiered storage](/img/blog/durable-streams-at-kernel-speed/architecture-map.svg)

Because every append is committed to the write-ahead log before it is acknowledged, the server is durable on its own: a single node is production-grade, with no cluster and no replicas. The approach is not new — it is the design behind [Kafka](https://docs.confluent.io/kafka/design/efficient-design.html) and other high-throughput logs, here inside a single binary.

## Challenges

The model is simple; making it fast is not. The same bytes pass through the server far more often than the work requires — an early version of ours sustained only a few tens of thousands of appends a second <!-- TODO(figure): drop in the exact naive append/s number --> — and three costs dominate.

**Write amplification.** A small append can be copied many times on its way to disk. At hundreds of thousands a second, the ceiling is how often each byte is moved, not the bandwidth of the disk.

**Durability.** A durable append must be flushed to the device with an `fsync`, which is slow — milliseconds, not microseconds. Paid once per append across tens of thousands of streams, it caps throughput long before the disk does.

**Sending data out.** One record may fan out to thousands of live subscribers, and a reconnecting client may replay a long history. Both are bounded by memory, not bandwidth: the footprint has to follow the working set, not the size of the audience or the history. Holding it to about <!-- TODO(figure): memory figure -->[N] MiB at either extreme is, to us, the most interesting result of this work.

The read and write paths are where the server removes these costs. We take each in turn, beginning with reads.

## The read path

The diagram traces a byte through the server — a writer feeding it on one side, readers drawing from the same files on the other. We follow it in two passes, reads first.

![Durable Streams server internals — HTTP engine, writer and reader, sharded WAL, page cache over per-stream log files, cold storage](/img/blog/durable-streams-at-kernel-speed/wal-architecture.svg)

Reads are where the server sends data out, and the constraint there is memory. A read names an offset, and because the file already holds the wire bytes, the server answers with a byte range from it — nothing to decode or reframe. On Linux that range reaches the socket through `sendfile`, moved from the page cache to the wire without passing through the server's address space, so a caught-up reader is served from RAM at roughly a fifth of the CPU a buffered copy would cost. This is possible only because the server owns its sockets, running a hand-written HTTP/1.1 loop rather than a framework that would stage the response back into user space.

Fan-out costs no more than a single read. A live reader holds nothing but its offset and a place on the stream's watch channel; one append advances the tail and wakes every waiter at once, and because the new bytes are already in the page cache, the whole audience is served from one copy. Delivering an append does not grow more expensive as its audience does.

Large reads stay bounded the same way: history streams out in fixed windows, so replaying a multi-gigabyte backlog costs about one window of memory rather than its size — and with no garbage collector, that footprint holds steady under load.

## The write path

The other direction answers the first two costs. An append enters through the same loop and is ordered by a per-stream lock — the only lock on the path, so different streams never contend and reads never wait on writes. Its bytes are written once into the page cache and the tail is published at once, waking live readers; only the acknowledgement waits for durability, so a reader sees the append at memory latency while the writer waits for the disk.

That single write is the answer to write amplification, and for binary streams the server goes further: an append can `splice` from the socket straight into the file — the mirror of `sendfile` on the read side — never copying through user space, which roughly halves the CPU it costs.

Durability is made cheap by the write-ahead log. Every append, across every stream, is staged into a sharded WAL, and a per-shard committer makes a whole batch durable with one `fsync` rather than one per append. Because a single `fsync` covers the appends of many streams, its cost falls to a fraction per append and the number of flushes stops tracking the number of streams — the answer to durability's per-stream tax. The stream files still take every byte and remain the read surface; they are flushed off the hot path at a checkpoint, after which the WAL is recycled and, on restart, replayed to repair a torn tail.

## Results

All figures below come from a single node — four CPUs, with a Kubernetes client fleet driving load — measured against two other implementations: Ursula, a single-node Raft log, and s2lite, an object-store-backed log. The suite covers three workloads: write throughput, catch-up, and fan-out. These are best-case, single-node numbers rather than a replicated result, and run-to-run variance is within roughly twenty percent.

**Write throughput.** Ramping the client fleet until throughput plateaued, the durable WAL mode reached roughly 800,000 appends per second on four CPUs and the non-durable memory mode about a million; the gap between them is precisely the `fsync` the memory mode does not pay. The amortized flush also makes throughput nearly independent of stream count — a hundred thousand streams perform much as a hundred do — because one `fsync` still serves many. Ursula reached about 154,000 appends per second in memory and 10,000 on disk, and s2lite about 2,000, its stream creation flattening past a hundred streams. Median append latency held between a fraction of a millisecond and about two milliseconds at saturation, against hundreds of milliseconds for Ursula's disk mode and roughly fifty for s2lite.

| streams | Durable · WAL | Durable · memory | Ursula · in-mem | Ursula · disk | s2lite |
|:--|--:|--:|--:|--:|--:|
| 100 | 494k | 444k | 51k | 4k | 2k |
| 1,000 | 636k | 496k | 86k | 5k | — |
| 10,000 | 628k | 509k | 106k | 6k | — |
| 100,000 | ~810k | ~1.0M | 154k | 10k | — |

*Append throughput at saturation (append/s); single node, 4 CPUs, 256-byte records.*

**Catch-up.** A thousand clients each reconnect to a pre-populated stream and replay it from the start. The server completed catch-up at about 146 ms p99 per client, moving the full log at roughly 1.3 GiB/s in aggregate. Ursula was slightly faster, at 126 ms — its snapshot-and-tail path transfers fewer bytes by design — and s2lite's paginated read was slowest, at 331 ms.

| metric (1 KiB events, 200 per stream) | Durable | Ursula | s2lite |
|:--|--:|--:|--:|
| per-client catch-up p99 (ms) | 146 | 126 | 331 |
| response body per client (KiB) | 200 | 158 | 471 |
| aggregate replay throughput (MiB/s) | 1,306 | 1,039 | 1,301 |

**Fan-out.** With one writer feeding a growing set of SSE subscribers, median delivery latency stayed well under a millisecond at small fan-outs and rose to only a few milliseconds at a thousand subscribers — competitive with Ursula and ten to fifty times faster than s2lite's object-store path. Serving the shared tail from cache rather than re-reading it for each subscriber cut latency at high fan-out by roughly fifteen to twenty percent.

| subscribers | Durable (cache off) | Durable (cache on) | Ursula · in-mem | Ursula · disk | s2lite |
|:--|--:|--:|--:|--:|--:|
| 1 | 0.38 / 0.56 | 0.32 / 0.50 | 0.39 / 0.57 | 0.41 / 0.63 | — |
| 10 | 0.48 / 0.67 | 0.45 / 0.65 | 0.49 / 0.66 | 0.50 / 0.70 | 51.3 / 52.0 |
| 100 | 0.84 / 1.17 | 0.79 / 1.14 | 0.81 / 1.11 | 0.87 / 1.20 | 50.9 / 52.0 |
| 1,000 | 3.60 / 5.06 | 2.85 / 4.30 | 2.67 / 3.92 | 2.95 / 4.50 | 52.2 / 54.0 |

*SSE end-to-end delivery latency (p50 / p99 ms); one writer at 50 events/s.*

**Memory.** The most telling figure is the one that barely moves. Across a wide fan-out and a multi-gigabyte replay alike, resident memory held to about <!-- TODO(figure): memory figures from report -->[N] MiB. Because egress is zero-copy and large reads stream in fixed windows, the footprint tracks the working set rather than the volume sent — a thousand listeners or a gigabyte of backfill cost close to what a single reader does.

## Summary and next steps

The result is a single standalone binary that reaches about a million operations a second, stays durable on one machine, and serves wide fan-outs and large histories in a near-constant footprint. None of what gets it there is new, and little of it lives above the kernel: the file is the response, served to the socket by `sendfile` without a copy through user space, and a single `fsync` makes many appends durable at once. That is rather the point — a single node can be made production-grade with techniques that are already well understood.

Durable Streams is an open protocol with a growing set of independent implementations, and this server is a reference for the teams who want to run it themselves. It is released and ready today: deploy the [reference server](#), read the [architecture doc](#), [reproduce the benchmarks](#), or [implement the protocol](https://github.com/durable-streams/durable-streams/blob/main/PROTOCOL.md) against the conformance suite. A multi-node server is in development.
<!-- TODO(links): same three (#) placeholders as the CTA block above — reference-server deploy guide, architecture doc, benchmark-reproduction repo. -->
