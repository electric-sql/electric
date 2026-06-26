---
title: "Durable Streams at kernel speed"
description: "A Rust implementation of Durable Streams that reaches a million appends per second on a single 4vCPU machine."
excerpt: >-
  We're releasing a new Durable Streams reference server implemented in Rust. It reaches a million operations per second on a single 4vCPU machine. Here's how we've built it.
authors: [balegas]
tags: [durable-streams, rust, performance]
image: /img/blog/durable-streams-at-kernel-speed/header.jpg
outline: [2, 3]
post: true
published: true
---

<script setup>
import StorageComparisonChart from '../../src/components/StorageComparisonChart.vue'
import MemoryErrorBarChart from '../../src/components/MemoryErrorBarChart.vue'
</script>

The industry is moving agents out of sandboxes and onto the internet — a third wave of agents that are durable, multi-user and [long-lived](/blog/2026/06/04/serverless-agents). [Durable Streams](/streams/) is the primitive for this: an append-only log that works over HTTP. 

Durable Streams is built around an open [protocol](https://github.com/durable-streams/durable-streams/blob/main/PROTOCOL.md) and its adoption is showing up across the ecosystem. It is being used to build agent frameworks such as [Flue](https://flueframework.com/), to persist token streams in [chat applications](https://www.prisma.io/blog/building-open-chat), and is being implemented [by other open-source projects](https://ursula.tonbo.io/).

Today we are releasing a new server implementation of Durable Streams, written in Rust, that scales to nearly a million operations per second on a 4 vCPU machine. It is fast, conformant, easy to deploy and open-source, and [published on crates.io](https://crates.io/crates/durable-streams).

Its speed comes from a single decision: the bytes stored on disk are the bytes sent on the wire. A read is then a byte-range over a file, and a write is an append whose principal cost is durability. The rest of this post is how both are made inexpensive.

> [!Warning] <img src="/img/icons/durable-streams.square.svg" style="height: 20px; margin-right: 6px; margin-top: -1px; display: inline; vertical-align: text-top" /> Run it yourself
> Deploy the [reference server](#), read the [architecture doc](#), [reproduce the benchmarks](https://github.com/electric-sql/ds-bench/tree/main), and [implement the protocol](https://github.com/durable-streams/durable-streams/blob/main/PROTOCOL.md).
<!-- TODO(links): fill the two (#) placeholders above — reference-server deploy guide and architecture doc. -->

## A primer on the protocol

A durable stream is an append-only log. A writer appends data to the tail of the log. A reader supplies an offset that points to a byte position in the log and reads everything from there to the current tail. Once a reader has caught up, it can subscribe to receive new writes, which are sent to the client over SSE or long-polling.

Because the protocol is plain HTTP, a stream can be served from anywhere and can lean on existing HTTP infrastructure — CDNs in particular — for fast, global distribution.

## Architecture

At a high level, the server is made of three components: an HTTP server that implements the Durable Streams protocol; a write-ahead log (WAL) that makes each append durable; and hot storage, built on the file system, that holds every stream as a file of the protocol's wire bytes. Optionally, you can connect to an external object store to offload sealed chunks of data. The server forwards requests to hot or cold storage based on the requested offset.

![Durable Streams server — high-level data flow, durability, and tiered storage](/img/blog/durable-streams-at-kernel-speed/architecture.svg)

### Challenges

The job of the Durable Streams server is almost trivial. The difficulty is making it scale to a large number of streams, at high throughput and low memory usage, without losing a single byte. Our Rust implementation does this while running an order of magnitude faster than our previous Node implementation.

**Write amplification.** A small append can be copied many times between the network and the disk. Copying data is wasteful and slow. At hundreds of thousands of operations a second it can make memory usage unbearable.

**Durability.** A durable append must be flushed to the device with an `fsync`, which is a millisecond-scale operation. A naive implementation might flush every write to a stream, which would stall the server most of the time.

**Memory usage.** One record may fan out to thousands of live subscribers, and a reconnecting client may replay a long history. We want to keep memory usage stable at all times, even when the data in flight far exceeds the RAM in the box.

The key idea behind the design is to move bytes as-is, from the socket into files and back out to the socket, without touching them, such that we can keep data on the kernel side. Let us dig into the write and read paths to see how that is achieved.

### The write path

The diagram traces a byte through the server, with a writer feeding it on one side and live subscribers on the other.

![Durable Streams write path — append into the page cache, stage into the sharded WAL, wake live readers, and acknowledge only after a group-commit fsync](/img/blog/durable-streams-at-kernel-speed/write-path.svg)

Writes take data from the HTTP socket buffer and append it to a stream log file on disk. Once written to the file system, the bytes stay shortly in the page cache; any live subscribers that are waiting for new data on that stream are woken and go fetch data at newly written offset. Typically they will find the data in the page cache and operation returns very quickly for everyone without copying it.

> [!Note] Syscalls worth knowing
>
> - **fsync(2)** — A `write()` only deposits data in the kernel's page cache; the kernel flushes it to disk whenever it likes. `fsync` (and `fdatasync`, which skips most metadata) blocks until the bytes are actually on stable storage, so they survive a crash or power loss.
> - **sendfile(2)** — Copies data directly between two file descriptors (classically a file to a socket) inside the kernel, without bouncing it through a user-space buffer. One kernel-to-kernel transfer instead of a `read()` then a `write()`: fewer copies and context switches.
> - **splice(2)** — The general zero-copy primitive. It moves data between two descriptors via a kernel pipe, with no user-space copy. It works in either direction (for example, socket to file), as long as one end is a pipe.

#### Durability

To guarantee no data loss, every write to a stream would have to be flushed to disk before its request is acknowledged. To avoid that we use a WAL. Every append, across every stream, is staged into a sharded WAL. We call `fsync` immediately when new data arrives for a WAL shard. While a flush is in progress, we batch other incoming requests and commit them together once the previous batch finishes.

Every WAL record carries a CRC32C checksum for recoverability. CRC32C is a hardware instruction on modern x86 and ARM CPUs and is very fast. Computing the checksum requires moving data into user space, which prevents using `splice` optimization to copy data directly from the socket to the file. This is a cost paid once; because data is stored in wire format, reads remain fast.

### The read path

![Durable Streams read path — map an offset to a byte range and serve it to the socket with zero-copy sendfile, one shared copy fanning out to every live reader](/img/blog/durable-streams-at-kernel-speed/read-path.svg)

A read request provides an address and an *offset* that maps to a byte position in a file. The server returns all bytes from the offset to the end of the file. The file already holds the wire bytes, so the server reads byte ranges and serves them without modification. On Linux that range reaches the socket through `sendfile`, allowing a direct copy from disk to network. 

**Fan-out**:One append advances the tail and wakes every live reader at once, and because the new bytes are already in memory, all subscribers are served from one shared copy. The cost scales with the payload, not with the number of subscribers.

**Catch-up**: Large reads stay bounded the same way history streams out in fixed windows, so replaying a multi-gigabyte backlog costs about one window of memory rather than its full size. With no garbage collector, that footprint holds steady under load.

### Tiered storage

A single node is a reliable server because it does not hold streams in memory. Hot data lives on disk and is served from the page cache through `sendfile`, so the server is bounded by disk rather than RAM and survives restarts. Once data leaves the live tail it is immutable, so the server seals it into fixed-size segments and uploads them to an object store, keeping only the active tail locally. Sealed segments are immutable and carry long-lived cache headers, so repeated cold reads are served from a CDN and do not reach the origin. Offload happens only after the data is durable: a segment is uploaded and verified before its local copy is removed, so a read is never directed at an object that is not there. A single binary together with an object store is therefore a complete and durable server.

### Comparing with Kafka

Kafka takes a different path to append throughput: it keeps `fsync` off the critical path and [relies on replication](https://kafka.apache.org/35/configuration/topic-level-configs/) for durability, flushing to disk asynchronously. This server keeps fsync-based durability on a single node and makes it cheap with the WAL and group commit, so it never pays a per-stream fsync. For the replicated style, the server offers a `memory` mode that disables the WAL and uses `splice` to copy data; it is intended to pair with a replication algorithm in the future.

## Benchmarks

We run several workloads to evaluate write scalability against various implementations of Durable Streams. Each server runs on a single node, pinned to 4 vCPUs, with 16 GB of RAM and an attached NVMe disk. A separate Kubernetes client fleet drives the load on the server. The [benchmarking tool](https://github.com/electric-sql/ds-bench/tree/main) and the published [results](https://github.com/electric-sql/ds-bench/blob/main/results/REPORT.md) are available and reproducible.

The configurations we run are the following:

- **[rust](https://crates.io/crates/durable-streams)**: this implementation
- **[node](https://www.npmjs.com/package/@durable-streams/server)**: our reference Node server
- [**ursula**](https://github.com/tonbo-io/ursula): a Kafka-inspired implementation that uses replication for durability

### Write throughput

In this experiment, we ramp up the client fleet to saturation to find the maximum throughput of the server. Each client operation is a 256-byte binary payload over a fixed range of streams.

<StorageComparisonChart
  title="Write throughput at saturation"
  :data="[
    { label: 'rust', data: [520, 650, 572, 860], color: '#06b6d4' },
    { label: 'node', data: [55, 76, 63, null], color: '#f59e0b' },
    { label: 'ursula', data: [48, 91, 89, null], color: '#a855f7' }
  ]"
  :labels="['100', '1,000', '10,000', '100,000']"
  x-axis-title="Number of streams"
  y-axis-title="Appends/s"
  y-axis-suffix="k"
/>

*Append throughput at saturation (appends/s); single node, 256-byte records.*

**rust** reached roughly **860,000 appends/s** at 100k streams, a ~13x speedup over the reference Node server. Group commit lets batches of writes be `fsync`ed together, and WAL sharding lets multiple `fsync` operations run in parallel across the device. Ursula runs as a single-node deployment with its WAL off, the best case for a single node.

#### Memory usage

Serving a hundred thousand streams, rust holds a median resident footprint of about **515 MB**, briefly spiking under a gigabyte during the write burst at initialization. At lower stream counts it sits in the tens to low hundreds of MB. Our Node server is about 800 MB at 10k streams and runs out of memory at 100k.

Once written, all data is served directly from disk without transformation. No data is copied into user space to serve a stream request. The only state kept in user space is per-stream metadata, which stays stable because memory management is explicit.

<MemoryErrorBarChart
  title="Working-set memory — p50 (bars) with peak (whisker)"
  :data="[
    { label: 'rust', p50: [45, 41, 177, 515], peak: [103, 52, 202, 950], color: '#06b6d4' },
    { label: 'node', p50: [279, 159, 793, null], peak: [488, 214, 1052, null], color: '#f59e0b' },
    { label: 'ursula', p50: [2644, 1817, 4286, null], peak: [3693, 2245, 5058, null], color: '#a855f7' }
  ]"
  :labels="['100', '1,000', '10,000', '100,000']"
  x-axis-title="Number of streams"
  y-axis-title="Resident memory"
  y-axis-suffix=" MB"
/>

### SSE fan-out: latency at scale

One writer feeds a growing set of SSE subscribers. Median delivery latency stayed around a millisecond at small fan-outs and rose to about four milliseconds at a thousand subscribers, on par with Ursula.

<StorageComparisonChart
  title="SSE delivery latency (p50)"
  :data="[
    { label: 'rust', data: [1.00, 1.09, 1.44, 3.72], color: '#06b6d4' },
    { label: 'ursula', data: [0.99, 1.10, 1.42, 3.28], color: '#a855f7' }
  ]"
  :labels="['1', '10', '100', '1,000']"
  x-axis-title="Subscribers"
  y-axis-title="Latency"
  y-axis-suffix=" ms"
/>

*SSE end-to-end delivery latency (p50, ms); one writer at 50 events/s.*

### Catch-up: how fast can a client replay history?

A thousand clients each attach to a pre-populated stream and replay it from the start. With 200 events per stream, rust finished at about **146 ms p99** per client, moving the full log at roughly **1.3 GB/s** in aggregate, with the zero-copy `sendfile` path doing the work; node completed the same replay at 186 ms (~700 MB/s) and Ursula at 126 ms, its snapshot-and-tail path transferring fewer bytes by design. At 2,000 events per stream the gap widens: rust replays at **925 ms p99** and ~2.0 GB/s, against node's 2.1 s and ~900 MB/s. Ursula could not complete this run — its stream creation chokes under the larger pre-fill.

| replay throughput (1 KB events, MB/s) | rust | node | ursula |
| ------------------------------------- | ----- | ----- | ----- |
| 200 events per stream                 | 1,306 | 700   | 1,039 |
| 2,000 events per stream               | 2,037 | 906   | —     |

*A — marks a run that crashed or could not complete (e.g. ran out of memory, or choked on stream creation).*

## Summary and next steps

Durable Streams is an open protocol with a growing set of independent implementations, and this Rust server is a reference for teams who want to run it themselves. It is released and ready today — install it from [crates.io](https://crates.io/crates/durable-streams) with `cargo install durable-streams`, read the [architecture doc](#), [reproduce the benchmarks](https://github.com/electric-sql/ds-bench/tree/main), or have fun [implementing the protocol](https://github.com/durable-streams/durable-streams/blob/main/PROTOCOL.md) yourself.

This is a first release and there is plenty ahead:

- **Performance and memory.** Further throughput gains and lower per-stream memory — we have not yet done any memory optimization.
- **Multi-node.** A multi-node server for high availability and horizontal scalability.
- **Chaos testing.** Deterministic chaos simulation to shake out bugs under faults and partitions.
