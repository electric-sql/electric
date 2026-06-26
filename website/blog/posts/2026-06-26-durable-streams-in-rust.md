---
title: "Durable Streams in Rust"
description: "A Rust implementation of Durable Streams that reaches nearly a million appends per second on a single 4vCPU machine."
excerpt: >-
  We're releasing a new Durable Streams reference server implemented in Rust. It reaches nearly a million operations per second on a single 4vCPU machine. Here's how we've built it.
authors: [balegas]
tags: [durable-streams, rust, performance]
image: /img/blog/durable-streams-in-rust/header.jpg
outline: [2, 3]
post: true
published: true
---

<script setup>
import StorageComparisonChart from '../../src/components/StorageComparisonChart.vue'
import MemoryErrorBarChart from '../../src/components/MemoryErrorBarChart.vue'
</script>

<style>
.centered-table table {
  margin-left: auto;
  margin-right: auto;
}
</style>

The industry is moving agents out of sandboxes and onto the internet — a third wave of agents that are durable, multi-user and [long-lived](/blog/2026/06/04/serverless-agents). [Durable Streams](/streams/) is the primitive for this: an append-only log that works over HTTP. 

Durable Streams is built around an open [protocol](https://github.com/durable-streams/durable-streams/blob/main/PROTOCOL.md) and its adoption is showing up across the ecosystem. It is being used to build agent frameworks such as [Flue](https://flueframework.com/), to persist token streams in [chat applications](https://www.prisma.io/blog/building-open-chat), and is being implemented [by other open-source projects](https://ursula.tonbo.io/).

Today we are releasing a new server implementation of Durable Streams, written in Rust, that scales to nearly a million operations per second on a 4 vCPU machine. It is fast, conformant, easy to deploy and open-source.

The main principle behind its performance is to store bytes on disk in the format they are sent over the wire. A read is then a byte-range over a file, and a write is an append whose principal cost is durability. The rest of this post is how both are made inexpensive.

> [!Info] <img src="/img/icons/durable-streams.square.svg" style="height: 20px; margin-right: 6px; margin-top: -1px; display: inline; vertical-align: text-top" /> Get started with Durable&nbsp;Streams
> [Download the crate](https://crates.io/crates/durable-streams) to start building with Durable&nbsp;Streams, or [sign up for Electric&nbsp;Cloud](/cloud/) to try it as a managed service.

## A primer on the protocol

A durable stream is an append-only log. A writer appends data to the tail of the log. A reader supplies an offset that points to a byte position in the log and reads everything from there to the current tail. Once a reader has caught up, it can subscribe to receive new writes, which are sent to the client over SSE or long-polling.

Because the protocol is plain HTTP, a stream can be served from anywhere and can lean on existing HTTP infrastructure — CDNs in particular — for fast, global distribution.

## Architecture

At a high level, the server is made of four components: 

- **HTTP server** that implements the Durable Streams protocol;
- **Write-ahead log** (WAL) that makes each append durable;
- **Hot storage** that holds every stream as a file on the operating system's file system;
- **Cold storage**, an optional external object store for offloading sealed chunks of data.

The server forwards each request to hot or cold storage based on the requested offset.

![Durable Streams server — high-level data flow, durability, and tiered storage](/img/blog/durable-streams-in-rust/architecture.svg)

### Challenges

You can one-shot a naive implementation durable streams. The challenge is making it scale to a large number of streams, with high throughput, low memory usage and without losing a single byte. Our Rust implementation does this while running an order of magnitude faster than our previous Node implementation.

**Write amplification.** A small append can be copied many times between the network and the disk. Copying data is wasteful and slow. At hundreds of thousands of operations a second it can make memory usage unbearable.

**Durability.** A durable append must be flushed to the device with an `fsync`, which is a millisecond-scale operation. A naive implementation might flush every write to a stream, which would stall the server most of the time.

**Memory usage.** One record may fan out to thousands of live subscribers, and a reconnecting client may replay a long history. We want to keep memory usage stable at all times, even when the data in flight far exceeds the RAM in the box.

The key idea behind the design is to move bytes as-is, from the socket into files and back out to the socket, without touching them, such that we can keep data on the kernel side. Let us dig into the write and read paths to see how that is achieved.

### The write path

The diagram traces a byte through the server, with a writer feeding it on one side and live subscribers on the other.

![Durable Streams write path — append into the page cache, stage into the sharded WAL, wake live readers, and acknowledge only after a group-commit fsync](/img/blog/durable-streams-in-rust/write-path.svg)

Writes take data from the HTTP socket buffer and append it to a stream log file on disk. Once written to the file system, the bytes stay shortly in the page cache; any live subscribers that are waiting for new data on that stream are woken and go fetch data at newly written offset. Typically they will find the data in the page cache and operation returns very quickly for everyone without copying it.

> [!Note] Syscalls worth knowing
>
> - **`fsync(2)`** — A `write()` only saves data into kernel's page cache; the kernel flushes it to disk whenever it likes. `fsync`  blocks until the bytes are actually on stable storage, so they survive a crash or power loss.
> - **`splice(2)`** — The general zero-copy primitive. It moves data between two descriptors via a kernel pipe, with no user-space copy. It works in either direction (for example, socket to file), as long as one end is a pipe.
> - **`sendfile(2)`** — Copies data directly between two file descriptors (classically a file to a socket) inside the kernel, without bouncing it through a user-space buffer. One kernel-to-kernel transfer instead of a `read()` then a `write()`: fewer copies and context switches.

#### Durability

To guarantee no data loss, every write to a stream would have to be flushed to disk before its request is acknowledged. To avoid that we use the WAL. Every append, across every stream, is staged into a sharded WAL. We call `fsync` immediately when new data arrives for a WAL shard. While a flush is in progress, we batch other incoming requests and commit them together once the previous batch finishes.

Every WAL record carries a CRC32C checksum for recoverability. CRC32C is a hardware instruction on modern x86 and ARM CPUs and is very fast. Computing the checksum requires moving data into user space, which prevents using `splice` optimization to copy data directly from the socket to the file. This is a cost paid once; because data is stored in wire format, reads remain fast.

### The read path

![Durable Streams read path — map an offset to a byte range and serve it to the socket with zero-copy sendfile, one shared copy fanning out to every live reader](/img/blog/durable-streams-in-rust/read-path.svg)

A read request provides an address and an *offset* that maps to a byte position in a file. The server returns all bytes from the offset to the end of the file. The file already holds bytes in wire format, so the server reads byte ranges and serves them without modification. On Linux that range reaches the socket through `sendfile`, allowing a direct copy from disk to network.

**Fan-out**: One append advances the tail and wakes every live reader at once, and because the new bytes are already in memory, all subscribers are served from one shared copy. The cost scales with the payload size, not with the number of subscribers.

**Catch-up**: Large reads stay bounded the same way history streams out in fixed windows, so replaying a multi-gigabyte backlog costs about one window of memory rather than its full size. With no garbage collector, that footprint holds steady under load.

#### Tiered storage

Once a log tail prefix reaches a certain length, the server seals the log *chunk* and offloads it to object store, keeping only the active tail locally. Sealed chuncks are immutable and carry long-lived cache headers, so repeated cold reads are served from a CDN and do not reach the origin.

### Comparison with Kafka

Kafka takes a different path to append throughput: it relies on [replication](https://kafka.apache.org/35/configuration/topic-level-configs/) for durability, only flushing to disk asynchronously. This server keeps fsync-based durability on a single node and makes it cheap with the WAL and group commit. The server offers a `memory` mode that disables the WAL and uses `splice` to copy data; it is intended to pair with a replication algorithm in the future.

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
  subtitle="Appends/s; single node, 256-byte records"
  :data="[
    { label: 'rust', data: [520, 650, 572, 860], color: '#75fbfd' },
    { label: 'node', data: [55, 76, 63, null], color: '#f59e0b' },
    { label: 'ursula', data: [48, 91, 89, null], color: '#a855f7' }
  ]"
  :labels="['100', '1,000', '10,000', '100,000']"
  x-axis-title="Number of streams"
  y-axis-title="Appends/s"
  y-axis-suffix="k"
  solid-markers
/>

**rust** reached roughly **860,000 appends/s** at 100k streams, a ~13x speedup over the reference Node server. Group commit lets batches of writes be `fsync`ed together, and WAL sharding lets multiple `fsync` operations run in parallel across the device. Ursula runs as a single-node deployment with its WAL off, the best case for a single node.

#### Memory usage

Serving a hundred thousand streams, rust's median footprint is about **515 MB**, briefly spiking under a gigabyte during the write burst at initialization. At lower stream counts it sits in the tens to low hundreds of MB. Our Node server is about 800 MB at 10k streams and runs out of memory at 100k. Ursula crashed on this experiment.

Once data is appended to the log, reads are always served from disk or page memory. The read path memory doesn't increase with amount of data being served . The memory growth for Rust is justified by stream metadata and connection buffers. We're looking into optimizing this next.

<MemoryErrorBarChart
  title="Memory under write load"
  subtitle="Median resident set (bars), peak during the run (whisker)"
  :data="[
    { label: 'rust', p50: [45, 41, 177, 515], peak: [103, 52, 202, 950], color: '#75fbfd' },
    { label: 'node', p50: [279, 159, 793, null], peak: [488, 214, 1052, null], color: '#f59e0b' },
    { label: 'ursula', p50: [2644, 1817, 4286, null], peak: [3693, 2245, 5058, null], color: '#a855f7' }
  ]"
  :labels="['100', '1,000', '10,000', '100,000']"
  x-axis-title="Number of streams"
  y-axis-title="Memory (MB)"
/>

### SSE fan-out: latency at scale

One writer feeds a growing set of SSE subscribers. Median delivery latency stayed around a millisecond at small fan-outs and rose to about four milliseconds at a thousand subscribers, on par with Ursula. The differences between the two sit within the margin of error — notably, the rust implementation reaches this latency without holding stream data in memory.

<StorageComparisonChart
  title="SSE delivery latency"
  subtitle="End-to-end p50 (ms); one writer at 50 events/s"
  :data="[
    { label: 'rust', data: [1.00, 1.09, 1.44, 3.72], color: '#75fbfd' },
    { label: 'ursula', data: [0.99, 1.10, 1.42, 3.28], color: '#a855f7' }
  ]"
  :labels="['1', '10', '100', '1,000']"
  x-axis-title="Subscribers"
  y-axis-title="Latency"
  y-axis-suffix=" ms"
  solid-markers
/>

<div style="height: 1.25rem"></div>

### Catch-up: how fast can a client replay history?

A thousand clients attach to a single pre-populated stream and replay it from the start — the shape of a fleet reconnecting after a long disconnect. rust peaks at about **2.0 GB/s** in aggregate, with the zero-copy `sendfile` path doing the work; node tops out around **900 MB/s**. Ursula's run failed: its stream at 2000 events, creation chokes under the larger pre-fill.

<div class="centered-table">

| replay throughput (1 KB events, MB/s) |  rust  |  node  | ursula |
| ------------------------------------- | :----: | :----: | :----: |
| 200 events per stream                 | 1,306  |  700   | 1,039  |
| 2,000 events per stream               | 2,037  |  906   |   —    |

</div>

## What's next

Durable Streams is the data primitive for server less agents. With increasing adoption in open-source, we were compelled to build a  production-grade reference implementation. Our implementations reaches 800k operations a second on a small machine with stable memory usage. This is the first release and there is plenty ahead:

- **Benchmarks**: our early benchmarks focus on write path. We want to build a comprehensive [benchmark suite](https://github.com/electric-sql/ds-bench) that evaluate both read and write path and stress stability under load.
- **Multi-node:** A multi-node server for high availability and horizontal scalability for large-scale deployments.
- **Performance improvements:** we've already have identified a bunch of improvements to work on next.
- **Chaos testing:** Deterministic chaos simulation to shake out bugs under faults and partitions.
