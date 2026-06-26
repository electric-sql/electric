---
title: "Durable Streams at kernel speed"
description: "A Rust reference server for Durable Streams that reaches nearly a million appends per second on a single 4 vCPU node."
excerpt: >-
  We're releasing a Rust reference server for Durable Streams that reaches nearly a million operations per second on a single 4 vCPU node. Here's the architecture, the kernel-level techniques that make it fast, and how it benchmarks against other implementations.
authors: [balegas]
tags: [durable-streams, rust, performance]
image: /img/blog/durable-streams-at-kernel-speed/header.jpg
outline: [2, 3]
post: true
published: false
---

Every agent you work with today is backed by a log. [Durable Streams](/streams/) is the data primitive for storing it: an append-only log that is durable, addressable, and writable from anywhere on the internet.

Durable Streams is built around an open [protocol](https://github.com/durable-streams/durable-streams/blob/main/PROTOCOL.md). It is being used to build agent frameworks such as [Flue](https://flueframework.com/), to persist token streams in [chat applications](https://www.prisma.io/blog/building-open-chat), and is being implemented [independently](https://ursula.tonbo.io/) in open source.

Today we are releasing a new server implementation of Durable Streams, written in Rust, that scales to nearly a million operations per second on a 4 vCPU machine. It is fast, easy to deploy and open-source.

In this blog post we cover the architecture, dive into the techniques that make it fast, and benchmark it against other implementations of Durable Streams.

> [!Warning] <img src="/img/icons/durable-streams.square.svg" style="height: 20px; margin-right: 6px; margin-top: -1px; display: inline; vertical-align: text-top" /> Run it yourself
> Deploy the [reference server](#), read the [architecture doc](#), [reproduce the benchmarks](https://github.com/electric-sql/ds-bench/tree/main), and [implement the protocol](https://github.com/durable-streams/durable-streams/blob/main/PROTOCOL.md).
<!-- TODO(links): fill the two (#) placeholders above — reference-server deploy guide and architecture doc. -->

## A primer on the protocol

A durable stream is an append-only log. A writer appends data to the tail of the log. A reader supplies an offset that points to a byte position in the log and reads everything from there to the current tail. Once a reader has caught up, it can subscribe to receive new writes, which are sent to the client over SSE or long-polling.

Because the protocol is plain HTTP, a stream can be served from anywhere and can lean on existing HTTP infrastructure — CDNs in particular — for fast, global distribution.

## Architecture

At a high level, the server is made of three components: an HTTP server that implements the Durable Streams protocol; a write-ahead log (WAL) that makes each append durable; and hot storage, built on the file system, that holds every stream as a file of the protocol's wire bytes. Optionally, you can connect to an external object store to offload sealed chunks of data. The server forwards requests to hot or cold storage based on the requested offset.

![Durable Streams server — high-level data flow, durability, and tiered storage](/img/blog/durable-streams-at-kernel-speed/architecture-map.svg)

## Challenges

The job of the Durable Streams server is almost trivial. The difficulty is making it scale to a large number of streams, at high throughput and low memory usage, without losing a single byte. Our Rust implementation does this while running an order of magnitude faster than our previous Node implementation.

**Write amplification.** A small append can be copied many times between the network and the disk. Copying data is wasteful and slow. At hundreds of thousands of operations a second it can make memory usage unbearable.

**Durability.** A durable append must be flushed to the device with an `fsync`, which is a millisecond-scale operation. A naive implementation might flush every write to a stream, which would stall the server most of the time.

**Memory usage.** One record may fan out to thousands of live subscribers, and a reconnecting client may replay a long history. We want to keep memory usage stable at all times, even when the data in flight far exceeds the RAM in the box.

The key idea behind the design is to move bytes as-is, from the socket into files and back out to the socket, without any transformation, so that data never has to move into user space. Let us dig into the write and read paths to see how that is achieved.

### The write path

The diagram traces a byte through the server, with a writer feeding it on one side and live subscribers on the other.

![Durable Streams write path — append into the page cache, stage into the sharded WAL, wake live readers, and acknowledge only after a group-commit fsync](/img/blog/durable-streams-at-kernel-speed/write-path.svg)

Writes take data from the HTTP socket buffer and append it to a stream log file on disk. Once written to the file system, the bytes stay shortly in the page cache; any live subscribers that are waiting for new data on that stream are woken and go fetch data at newly written offset. Typically they will find the data in the page cache and operation returns very quickly for everyone.

**Durability.** To guarantee no data loss, every write to a stream would have to be flushed to disk before its request is acknowledged. That would cause a flood of syscalls when many streams are written concurrently.

To prevent that, we use a Write ahead log (WAL). Every append, across every stream, is staged into a sharded WAL. We call `fsync()` immediately when new data arrives for a WAL shard; while a flush is in progress, we batch other incoming requests and commit them together in a group commit once the previous batch finishes.

We keep a minimum-LSN watermark (an LSN is a sequence number in the WAL) and recycle WAL segments once all operations in a segment have been written to their stream files.

Every WAL record carries a CRC32C checksum, so on restart replay stops at the first record that fails to verify: the unacknowledged tail is discarded and each stream is repaired to its last durable record. CRC32C is a hardware instruction on modern x86 and ARM CPUs and is very fast.

Computing the checksum requires moving data into user space, which prevents using `splice` optimization to copy data directly from the socket to the file. This is a cost paid once; because data is stored in wire format, reads remain fast.

Kafka [trades durability for speed](https://kafka.apache.org/35/configuration/topic-level-configs/) by using replication to avoid disk flushes in the write path. Our server provides a `memory` mode that disables WAL and uses `splice` for copying data. This mode is intended to be used with a replication algorithm in the future.

> [!Note] Three syscalls worth knowing
>
> - **fsync(2)** — A `write()` only deposits data in the kernel's page cache; the kernel flushes it to disk whenever it likes. `fsync` (and `fdatasync`, which skips most metadata) blocks until the bytes are actually on stable storage, so they survive a crash or power loss.
> - **sendfile(2)** — Copies data directly between two file descriptors (classically a file to a socket) inside the kernel, without bouncing it through a user-space buffer. One kernel-to-kernel transfer instead of a `read()` then a `write()`: fewer copies and context switches.
> - **splice(2)** — The general zero-copy primitive. It moves data between two descriptors via a kernel pipe, with no user-space copy. It works in either direction (for example, socket to file), as long as one end is a pipe.

### The read path

![Durable Streams read path — map an offset to a byte range and serve it to the socket with zero-copy sendfile, one shared copy fanning out to every live reader](/img/blog/durable-streams-at-kernel-speed/read-path.svg)

A read request provides an address and an *offset* that maps to a byte position in a file. The server returns all bytes from the offset to the end of the file. The file already holds the wire bytes, so the server reads byte ranges and serves them without modification. On Linux that range reaches the socket through `sendfile`. This is possible only because the server owns its sockets, running a hand-rolled HTTP/1.1 loop rather than a framework that would stage the response back into user space.

Fan-out costs no more than a single read. One append advances the tail and wakes every live reader at once, and because the new bytes are already in memory, all subscribers are served from one shared copy. The cost scales with the payload, not with the number of subscribers.

Large reads stay bounded the same way: history streams out in fixed windows, so replaying a multi-gigabyte backlog costs about one window of memory rather than its full size. With no garbage collector, that footprint holds steady under load.

## Benchmarks

We run several workloads to evaluate write scalability against various implementations of Durable Streams. Each server runs on a single node, pinned to 4 vCPUs, with 16 GB of RAM and an attached NVMe disk. A separate Kubernetes client fleet drives the load on the server. The [benchmarking tool](https://github.com/electric-sql/ds-bench/tree/main) and the published [results](https://github.com/electric-sql/ds-bench/blob/main/results/REPORT.md) are available and reproducible.

The configurations we run are the following:

- **ds-rust**: the Rust Durable Streams server we have built
- **[node](https://www.npmjs.com/package/@durable-streams/server)**: our reference Node server
- [**ursula**](https://github.com/tonbo-io/ursula): Ursula with log persistence off — the best single-node scenario for Ursula
- [**s2lite**](https://github.com/s2-streamstore/s2): a comparable streaming server that implements a different protocol

### Write throughput

In this experiment, we ramp up the client fleet to saturation to find the maximum throughput of the server. Each client operation is a 256-byte binary payload over a fixed range of streams.

| # streams | ds-rust | ursula | node | s2lite |
| --------- | ------- | ------ | ---- | ------ |
| 100       | 520k    | 48k    | 55k  | 2.0k   |
| 1,000     | 650k    | 91k    | 76k  | —      |
| 10,000    | 572k    | 89k    | 63k  | —      |
| 100,000   | 860k    | —      | —    | —      |

**ds-rust** reached roughly **860,000 appends/s** at 100k streams, a ~13x speedup over the reference Node server. Group commit lets batches of writes be `fsync`ed together, and WAL sharding lets multiple `fsync` operations run in parallel across the device.

#### Memory usage

Serving a hundred thousand streams, ds-rust holds a median resident footprint of about **515 MB**, briefly spiking under a gigabyte during the write burst at initialization. At lower stream counts it sits in the tens to low hundreds of MB. Our Node server is about 800 MB at 10k streams and runs out of memory at 100k.

Once written, all data is served directly from disk without transformation. No data is copied into user space to serve a stream request. The only state kept in user space is per-stream metadata, which stays stable because memory management is explicit.

| # streams | ds-rust (peak / p50) | Node (peak / p50) |
| --------- | -------------------- | ----------------- |
| 100       | 103 / 45             | 488 / 279         |
| 1,000     | 52 / 41              | 214 / 159         |
| 10,000    | 202 / 177            | 1,052 / 793       |
| 100,000   | 950 / 515            | —                 |

*Server working-set memory under write load (peak / p50, MB).*

*We have not done any memory optimizations yet, and expect to reduce the memory used per stream.*

### SSE fan-out

One writer feeds a growing set of SSE subscribers. Median delivery latency stayed around a millisecond at small fan-outs and rose to about four milliseconds at a thousand subscribers, on par with Ursula.

| # subscribers | ds-rust (p50) | ursula (p50) |
| ------------- | ------------- | ------------ |
| 1             | 1.00          | 0.99         |
| 10            | 1.09          | 1.10         |
| 100           | 1.44          | 1.42         |
| 1,000         | 3.72          | 3.28         |

*SSE end-to-end delivery latency (p50, ms); one writer at 50 events/s.*

### Catch-up: how fast can a client replay history?

A thousand clients each attach to a pre-populated stream of 200 events and replay it from the start. ds-rust finished at about **146 ms p99** per client, moving the full log at roughly **1.3 GiB/s** in aggregate, with the zero-copy `sendfile` path doing the work. Ursula was marginally faster at 126 ms, because its snapshot-and-tail path transfers fewer bytes by design; s2lite's paginated object-store read was slowest at 331 ms.

| metric (1 KiB events, 200 per stream) | ds-rust | Ursula |
| ------------------------------------- | ------- | ------ |
| per-client catch-up p99 (ms)          | 146     | 126    |
| aggregate replay throughput (MiB/s)   | 1,306   | 1,039  |

## Summary and next steps

We shipped a Durable Streams server in Rust. It does nearly a million operations a second on a single node, and it deploys with one command:

```bash
cargo install durable-streams
```

Durable Streams is an open protocol with a growing set of independent implementations, and this Rust server is a reference for teams who want to run it themselves. It is released and ready today: deploy the [reference server](#), read the [architecture doc](#), [reproduce the benchmarks](https://github.com/electric-sql/ds-bench/tree/main), or [implement the protocol](https://github.com/durable-streams/durable-streams/blob/main/PROTOCOL.md) against the conformance suite.
<!-- TODO(links): same two (#) placeholders as the CTA block above — reference-server deploy guide and architecture doc. -->
