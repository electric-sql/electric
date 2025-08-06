---
title: "Electric 1.1 - Better performance with new storage"
description: >-
  With version 1.1 Electric is shipping with a new and improved
  storage engine. Read about why we replaced the old one and how we made it fast.
excerpt: >-
  With version 1.1 Electric is shipping with a new and improved
  storage engine. Read about why we replaced the old one and how we made it fast.
authors: [icehaunter]
image: /img/blog/electric-1.0-released/header2.jpg
tags: [release]
outline: [2, 3]
post: true
---

<script setup>


import oneShapeWriteImg from '/static/img/blog/electric-v1.1-new-storage/1-shape-latency.svg?url'
import nShapesWriteImg from '/static/img/blog/electric-v1.1-new-storage/n-shape-write-latency.svg?url'
import concurrentShapeCreationImg from '/static/img/blog/electric-v1.1-new-storage/concurrent-shape-creation.svg?url'
import writeFanoutImg from '/static/img/blog/electric-v1.1-new-storage/single-shape-fanout.svg?url'
import diverseShapeFanoutImg from '/static/img/blog/electric-v1.1-new-storage/diverse-shape-fanout.svg?url'

</script>

# Why We Built a Custom Storage Engine for Electric

The most engaging applications today feel magical: data updates flow instantly across all users, changes appear in real-time without page reloads, and UI stays perfectly in sync. This is the power of sync engines—they replace traditional request-response patterns with continuous data synchronization, letting your application work with local data that automatically stays in sync with your database. It's not evolution, it's revolution.

Electric is a Postgres sync engine that allows developers to sync subsets of data into their applications, handling the core concerns of partial replication, fan-out, and data delivery. Developers declare what we call a *shape*—put simply a SQL query with a WHERE clause filter on a table—and Electric continuously streams changes matching that shape definition from the database to the application.

Our goal is ambitious: build a sync engine that's faster than Postgres itself, handles any write load you can throw at it, and scales to millions of concurrent users while keeping infrastructure costs low. The storage engine of electric is one of the cornerstones for achieving that goals. 

With Electric v1.1, we made a radical decision: we rebuilt our storage engine from scratch. The new storage delivers up to **X** performance improvements and enables capabilities like zero-downtime deployments that were architecturally impossible before. Building the storage engine ourselves required more upfront effort, but allow us to take complete control of it. We can now fine-tune performance for our exact workloads and evolve it to satisfy new requirements. This article tells the story of that journey—from recognizing the mismatch between what we had and what we needed for our sync engine, through designing the ideal solution, to the jaw-dropping benchmark results.

## How Electric works

Electric's job is deceptively simple: Users request shapes they want to follow, Electric tails Postgres's logical replication stream for the latests changes on the database, matches incoming changes against registered shapes, writes matching changes to the corresponding shape logs on disk and fans-out those changes to clients on request. It's critical to keep up with Postgres Logical Replication. Lagging behind means higher latency for live updates and a growing write-ahead-log on the source database.

[Architecture Diagram]

**Creating shapes**: A shape is a partial replica of a database table. When created, Electric takes an initial *snapshot*—querying Postgres for all existing rows matching the shape's WHERE clause—and saves it to a file. From that point on, any incoming `INSERT`, `UPDATE` and `DELETE` operations coming from logical replication stream is going to be matched against the registered shapes.

**Filtering the logical replication stream**: When a row change matches a shape, we persist it in the corresponding "shape log". With hundreds of thousands of shapes to evaluate for each incoming change, Electric has an extremely limited time budget to evaluate each of them. In another article, we'll talk about how we made Electric scale to handle the maximum throughput the beefiest Postgres you can rent today can generate.

**Persisting shapes to disk**: Once Electric determines which shapes are affected by each change, it writes those changes to persistent storage—the "shape log". A single database transaction might affect dozens of shapes, which results in writing to dozens of files with expensive IO. Shape logs are split in fixed-size *chunks*, which are aligned with the maximum size of data we send in Shape responses. 

**Fan-out to clients**: For retrieving latest changes for a shape, users make shape requests with an *offset* parameter, a point in time from which they want to retrieve all changes. At this point Electric has to find the shape log chunk that contains the offset and retrieve all changes up to the head of the log. The read-path must handle massive concurrency, as thousands of clients might simultaneously request shapes while new changes continue to be written.

## A Storage engine for sync-engines

When we decided to rewrite [Electric](https://electric-sql.com/blog/2024/07/17/electric-next) (yes! we scrapped a two-year project and started fresh with very ambitious scalability requirements), we wanted to build the fastest possible sync engine. 

Unlike Realtime APIs that typically offer at-most-once delivery or temporal buffering windows, Electric's shapes are persistent and can be resumed from any point in time. This makes the sync engine dramatically simpler to use but puts the storage engine at the heart of Electric's performance.

Writes in Electric are primarily append-only, adding rows to the shape logs, while reads perform range scans on these log files based on a given offset. Since logs can grow indefinitely we save them in chunks  and periodically compact chunks into the base snapshot. Compaction in Electric is unique in that it must preserve offset-based temporal ordering. To achieve this, we compact `UPDATE` operations for a single row only between its corresponding `INSERT` and `DELETE` boundaries, ensuring that the offsets marking a row’s creation and deletion preserve their relative order and we can always tell when a row was created or deleted independently of compaction.

### Picking an off-the-shelf store for Electric

When we started, we wanted to something pragmatic that would allow us to get a running system fast and tune performance in a second step. As Kyle likes saying: "make it work, make it right, make it fast". We looked at many off-the-shelf solutions we could use, but it wasn't easy to pick one.

LSM-tree based stores like RocksDB --- the most obvious choice --- combine the strengths of append-only writes and key-value access. But most of them don't support dual-key compaction, which makes most of the options non-suitable. There are a lot of proposal in academia, but not many production-grade open-source solutions. Apache Kafka is the only production system with native dual-key compaction support, but that would be hard to integrate and would still need customization. RocksDb follows a pluggable approach, so we could theoretically implement our own algorithm, but was discouraging since we would need to learn a new piece of software with unpredictable results. We also looked into SQLite. The idea was to build on its insane performance to get quick gains on performance without a lot of optimization work. It was fast but not always faster than our competing prototype and we were afraid we could hit barriers with less customizable approach.

None of the off-the-shelf solutions were a perfect fit for Electric's requirements. So, we ended-up picking CubDB as a pragmatic starting point—a solid Elixir key-value store that could get us to production quickly. Our team has lot's of experience with Elixir so we would get good development speed by keeping the storage engine in Elixir. We knew this was not the best solution, but would get our feet of the ground. We made an algorithm that would keep shape snapshots off CubDb and use CubDB KV to index (a B-Tree) and scan shape log chunks.

### Solid but cracks under pressure

Looking back, CubDb was a good initial choice. It was performant enough and we didn't come across any bugs.  We were able to optimize other parts of the system before having any concerns with storage. We launched v1.0 and deployed it to Cloud. But as we scaled to production traffic with customers like Trigger.dev pushing [20,000 changes per second](https://x.com/triggerdotdev/status/1945876425225171173), the limitations started to emerge.

**Storage was consuming our CPU budget**: Writing to storage was taking up a massive part of our per-transaction time budget, with high CPU usage from updating the index and rewriting chunks. 

**Latency**: P95 latency was too high due to CubDb slowing down significantly when handling large transactions. These heavy writes ended up blocking reads for extended periods. The problem was even worse when using network-attached storage.

**Rolling deploys:** Although it wasn’t part of our initial requirements, we discovered during the development of Cloud that CubDb doesn’t support shared readers, which made no-downtime deployments unfeasible. This limitation turned into a hard requirement for our new design.

The challenges we encountered weren’t a result of CubDb being poorly designed—it just wasn’t tailored to meet Electric’s requirements. It became clear that we needed to step up and make our storage engine more performant.

## Building our own storage engine

Following the lessons from CockroachDB team when they [moved from RocksDB to Pebble](https://www.cockroachlabs.com/blog/pebble-rocksdb-kv-store/), we decided to build our own storage engine, instead of trying to modify an existing one. The scope of what we needed was reasonably small to build it ourselves and this way we can deeply integrate it with the rest of the system, allowing us to tailor it to our current and future requirements.

**Performance characteristics**: With our initial prototype, we've learned about bottlenecks and the parts of the system that were hard to scale. Essentially, we need fast append-only writes with low CPU usage and consistent performance either with SSD or network-attached storage.

**Zero-copy data transfer**: We've designed electric to do all the filtering logic at write-time to avoid any data parsing during reads. This design results in more compute overhead on the write-path but makes the read-path extremely efficient. This lets us stream data  from disk to the network interface inside the kernel.

**Recoverability**: Every Postgres transaction comes with a Log Sequence Number (LSN) that gives us a total ordering of transactions. We use LSN to build offsets in Electric. If Electric restarts or crashes, we can discard data for incomplete transactions and resume streaming from the last acknowledged LSN. This safety guarantee lets us prioritize speed of recovery over complex crash-recovery mechanisms.

**Cloud native**: Electric is mostly deployed on Cloud. In our deployment we're currently using attached storage, which allow scale-out readers and do zero-downtime deployments. We incorporate these requirements in our storage design. In the future, we plan to build bottomless storage for Electric.

# Implementation overview

Our custom storage architecture is very simple: we maintain two files for each shape—a shape log that stores the binary data for the shape, and a sparse index that enables fast offset lookups in the log.

## Shape log

The shape log contains pre-serialized JSON data divided into fixed-size chunks. Each chunk has an header that contains information about the actual length of the content and the offset/LSN for the first row change in the log.

**Immutable chunks**: Once a chunk is completed it becomes immutable, so coordination is only necessary for unfinished chunks. We keep track of the current content length for a chunk in the chunk headers, so readers can safely consume the log even with active writers. Coordination is done at file-level, allowing multiple readers to consume shape logs safely in a distributed environment.

**Shape log scanning**: the content of the shape log is formatted to be easy to read without copying data into user space. To find the right chunk for an offset, we skip-read through the headers of the shape-log to find the chunk with the requested offset and... not sure how we retrieve the offset without copying data.

**Buffered writes for performance**: Calling `fsync` on every write is prohibitively slow, but not calling `fsync` immediately is giving up on durability. Any performant storage system needs to address this dilemma in some way. In Electric, we deeply integrate shape logs recovery with logical replication. If Electric crashes without some changes being flushed to disk, we can resume logical replication from the last persisted position and replay missing transactions. 

## Offset index

The offset index provides fast shape random offset lookup through a sparse indexing strategy. The index is simply a list of  pointers to chunk boundaries in the shape log. We add a new pointer to the sparse index for every finalized chunk.

**Finding a chunk**: When a client requests data starting from a specific offset, we do a binary search on the index to locate the appropriate chunk pointer, retrieve that chunk, scan it to find the requested offset in the shape log and stream the rest of the chunk.

**Coordination-free:** Because shape logs are append-only, offset pointers are always added to the end of the sparse index. With this simple append-only lust, the sparse index can be read and written without any coordination.

## Improved concurrency

In the new storage architecture we've decouple readers and writers, allowing a single writer process --- the process that is tailing Postgres logical replication --- to share access to shape logs with multiple reader processes, unlocking new capabilities for Electric.

**Horizontal read scaling**: Electric is already quite scalable for handling reads behind a CDN, but the new storage architecture allows for scaling the number of readers without holding a connection to Postgres, giving us plenty of room to scale beyond anyone's needs.

**Zero-downtime deployments**: With this design it's possible to achieve zero downtime deployments. While a node replaces another during a deployment, the newly started node can start serving shapes in read-only mode. When it is determined healthy, the old electric server disconnects from Postgres and the new server becomes the sole follower of the Postgres logical replication stream.

## Performance Results

Enough talking, show me the numbers! ...

### Micro-benchmarks

We conducted some microbenchmarks to evaluate the new storage engine against CubDb. Tests were run on both local SSDs (MacBook Air M4) and network-attached storage (AWS EFS attached to t2.medium instances), which are common types of storage used with Electric. 

We got amazing speedups both on SSD and EFS, with up to 130x and 172x faster reads and 101x and 7x faster writes, respectively.

#### Write Performance (will use charts)

The write performance benchmark consists in inserting a fixed number of rows to a shape log. We vary the number of rows and measure the time to complete the operation. With CubDb, every insertion needs to update the b-tree index to find the offset to write to which is quite inefficient and produces a degenerate tree (we always add a larger key to the index). With the new engine, we always write to the latest chunk and only add new index entries when we reach the chunk size limit.

On local SSDs, the new engine achieved up to 101x faster writes when we're appending 1000 rows. These results were a bit surprising as we wouldn't expect CubDb to become so slow with the number of operations. We haven't really seen this before as appending this amount of rows to a single shape log is not very common.

With network-attached storage, where latency typically dominates, we still saw 5-7 speedups.

| Rows | Storage | V1.1 (Average latency) | CubDB (Average) | Speedup |
| ---- | ------- | ---------------------- | --------------- | ------- |
| 1000 | SSD     | 1.65 ms                | 167.68 ms       | 101.40  |
| 20   | SSD     | 0.12 ms                | 3.49 ms         | 29.58   |
| 1    | SSD     | 0.01 ms                | 0.32 ms         | 33.46   |
| 1000 | EFS     | 99.29 ms               | 712.58 ms       | 7.18    |
| 20   | EFS     | 3.39 ms                | 15.50 ms        | 4.57    |
| 1    | EFS     | 0.26 ms                | 1.40 ms         | 5.40    |

### Read Performance

The read performance benchmarks consists in reading a fixed number of chunks from a shape log and measure the total time for retrieving all chunks. This mimics clients retrieving changes for a shape from different points in time, or requesting the initial snapshot of a shape (large number of chunks). Clients that are at the tip of the shape log will always hit the latest chunk, skipping the index.

- TODO: confirm we (can) skip the index for the latest chunk

# Single Reader

TODO: Do random access ensure the number of retrieved chunks?

With single reader we want to see how fast we can retrieve a sequence of chunks. In this case, the baseline latency for CubDb is quite high already, which is explained by transferring data from disk> > user space > network interface. With the new engine we stream data directly from disk to the network interface.

| Chunks | Storage | V1.1 (Average latency) | CubDB (Average) | Speedup |
| ------ | ------- | ---------------------- | --------------- | ------- |
| 10     | SSD     | 2.10 ms                | 154.07 ms       | 73.2    |
| 5      | SSD     | 2.64 ms                | 131.68 ms       | 49.96   |
| 10     | EFS     | 14.80 ms               | 2550.00 ms      | 172.34  |
| 5      | EFS     | 14.00 ms               | 1690.00 ms      | 120.19  |

# Multiple readers

We run the read workload with 200 concurrent readers for the same shape. The results show that the performance degrades a lot faster with more contention. In CubDb all readers and writers need to go through the index to find the right chunk, while new storage clients will find a concurrency bottleneck when trying to access the latest changes in an unfinished chunk. This is an extreme use case for Electric as we expect contention on shape logs to be relatively low as data can be offloaded to the CDN and live clients will always be retrieving data from latest offsets (which will be cached). 

| Chunks | Storage | V1.1 (Average latency) | CubDB (Average latency) | Speedup |
| ------ | ------- | ---------------------- | ----------------------- | ------- |
| 10     | SSD     | 210.00 ms              | 27860.00 ms             | 130.25  |
| 5      | SSD     | 250.00 ms              | 16040.00 ms             | 64.06   |
| 10     | EFS     | 1332.00 ms             | 120600.00 ms            | 90.49   |
| 5      | EFS     | 1908.00 ms             | 133800.00 ms            | 70.10   |

### Electric benchmarks

TODO



# Issues

## Conclusions

- Performance

  - Dramatic CPU usage drop,

  - Lower overall latency
  - Room for improvement 

- We own our storage engine

  - Simple design, fit to our needs
  - New features in the horizon

  - Cloud-friendly



## What this means for the future

Owning our storage layer opens up possibilities for ongoing innovation that would be impossible with off-the-shelf solutions:

**More and larger shapes**: We can now handle shapes of any size—many gigabytes—efficiently, something that was impossible with our previous architecture.

**Advanced features on the horizon**: Our storage foundation enables future innovations like multi-table shapes that will be efficient due to our fast storage engine.

**Continuous optimization**: We're not hampered by off-the-shelf databases not designed for our exact use case. We can continue pushing the boundaries of sync performance.

We're deeply committed to building the most performant, scalable, and reliable sync engine possible. This storage engine is just the beginning—it's the foundation that lets us keep innovating and stay ahead of whatever demands our customers throw at us.

More Scalable than anyone's needs.

Next post cover real usage of new storage





## The Numbers: Microbenchmarks

While developing this storage, we wanted to be able to see the performance benefits in isolation, to compare to CubDB. Those isolated benchmarks turned out to be quite impressive.

**Write Performance:**

- SSD (MacBook Air M4): 30x faster than CubDB
- NFS (AWS t2.medium (2vCPU), EFS storage): 8x faster than CubDB

**Read Performance:**

- SSD (MacBook Air M4): 40x-80x faster than CubDB
- NFS (AWS t2.medium (2vCPU), EFS storage): 70x-90x faster than CubDB

<details>
<summary>Benchmark numbers</summary>

### Write throughput, txns/ser with N rows in each txn

MacBook Air M4,

```
##### With input Large transaction (1000 ops) #####
Name                      ips        average  deviation         median         99th %
PureFileStorage        604.71        1.65 ms    ±14.69%        1.64 ms        2.09 ms
FileStorage              5.96      167.68 ms     ±7.61%      164.81 ms      233.74 ms

Comparison:
PureFileStorage        604.71
FileStorage              5.96 - 101.40x slower +166.03 ms

##### With input Medium transaction (20 ops) #####
Name                      ips        average  deviation         median         99th %
PureFileStorage        8.49 K       0.118 ms   ±273.26%     0.00838 ms        1.52 ms
FileStorage            0.29 K        3.49 ms    ±26.57%        3.45 ms        5.32 ms

Comparison:
PureFileStorage        8.49 K
FileStorage            0.29 K - 29.58x slower +3.37 ms

##### With input Small transaction (1 op) #####
Name                      ips        average  deviation         median         99th %
PureFileStorage      104.54 K        9.57 μs  ±1219.24%        1.46 μs        6.83 μs
FileStorage            3.12 K      320.04 μs    ±46.44%         303 μs      605.22 μs

Comparison:
PureFileStorage      104.54 K
FileStorage            3.12 K - 33.46x slower +310.48 μs
```

EC2 machine, CPU Information: Intel(R) Xeon(R) CPU E5-2686 v4 @ 2.30GHz, storage **on EFS drive**

```
##### With input Large transaction (1000 ops) #####
Name                      ips        average  deviation         median         99th %
PureFileStorage         10.07       99.29 ms    ±13.26%      100.69 ms      141.64 ms
FileStorage              1.40      712.58 ms    ±22.05%      725.28 ms      908.44 ms

Comparison:
PureFileStorage         10.07
FileStorage              1.40 - 7.18x slower +613.29 ms

##### With input Medium transaction (20 ops) #####
Name                      ips        average  deviation         median         99th %
PureFileStorage        295.02        3.39 ms   ±289.61%      0.0521 ms       40.94 ms
FileStorage             64.50       15.50 ms    ±38.81%       14.68 ms       33.05 ms

Comparison:
PureFileStorage        295.02
FileStorage             64.50 - 4.57x slower +12.11 ms

##### With input Small transaction (1 op) #####
Name                      ips        average  deviation         median         99th %
PureFileStorage        3.86 K        0.26 ms  ±1408.18%     0.00885 ms      0.0535 ms
FileStorage            0.71 K        1.40 ms   ±313.52%        0.77 ms        6.52 ms

Comparison:
PureFileStorage        3.86 K
FileStorage            0.71 K - 5.40x slower +1.14 ms
```

### Chunk-aligned read throughput, single reader

MacBook Air M4

```
##### With input 10 chunks #####
Name                      ips        average  deviation         median         99th %
PureFileStorage        475.38        2.10 ms    ±33.67%        2.01 ms        5.08 ms
FileStorage              6.49      154.07 ms    ±69.28%      137.81 ms      436.22 ms

Comparison:
PureFileStorage        475.38
FileStorage              6.49 - 73.24x slower +151.97 ms

##### With input 5 chunks #####
Name                      ips        average  deviation         median         99th %
PureFileStorage        379.42        2.64 ms    ±68.84%        2.11 ms       11.60 ms
FileStorage              7.59      131.68 ms    ±87.64%       99.40 ms      493.95 ms

Comparison:
PureFileStorage        379.42
FileStorage              7.59 - 49.96x slower +129.04 ms
```

EC2 machine, CPU Information: Intel(R) Xeon(R) CPU E5-2686 v4 @ 2.30GHz, storage **on EFS drive**

```
##### With input 10 chunks #####
Name                      ips        average  deviation         median         99th %
PureFileStorage         67.52       0.0148 s    ±73.26%       0.0131 s       0.0850 s
FileStorage              0.39         2.55 s    ±41.05%         2.55 s         3.29 s

Comparison:
PureFileStorage         67.52
FileStorage              0.39 - 172.34x slower +2.54 s

##### With input 5 chunks #####
Name                      ips        average  deviation         median         99th %
PureFileStorage         71.24       0.0140 s    ±33.50%       0.0128 s       0.0348 s
FileStorage              0.59         1.69 s    ±87.73%         1.50 s         3.64 s

Comparison:
PureFileStorage         71.24
FileStorage              0.59 - 120.19x slower +1.67 s
```

### Chunk-aligned read throughput, 200 reader concurrency (same machine)

Measured time is time to satisfy all 200 readers

MacBook Air M4

```
##### With input 10 chunks #####
Name                      ips        average  deviation         median         99th %
PureFileStorage          4.68         0.21 s     ±5.86%         0.21 s         0.25 s
FileStorage            0.0359        27.86 s     ±0.00%        27.86 s        27.86 s

Comparison:
PureFileStorage          4.68
FileStorage            0.0359 - 130.25x slower +27.65 s

##### With input 5 chunks #####
Name                      ips        average  deviation         median         99th %
PureFileStorage          3.99         0.25 s     ±3.08%         0.25 s         0.26 s
FileStorage            0.0624        16.04 s     ±0.00%        16.04 s        16.04 s

Comparison:
PureFileStorage          3.99
FileStorage            0.0624 - 64.06x slower +15.79 s
```

EC2 machine, CPU Information: Intel(R) Xeon(R) CPU E5-2686 v4 @ 2.30GHz, storage **on EFS drive**

```
##### With input 10 chunks #####
Name                      ips        average  deviation         median         99th %
PureFileStorage          0.75     0.0222 min     ±2.36%     0.0223 min     0.0228 min
FileStorage           0.00828       2.01 min     ±0.00%       2.01 min       2.01 min

Comparison:
PureFileStorage          0.75
FileStorage           0.00828 - 90.49x slower +1.99 min

##### With input 5 chunks #####
Name                      ips        average  deviation         median         99th %
PureFileStorage          0.52     0.0318 min     ±5.26%     0.0321 min     0.0334 min
FileStorage           0.00747       2.23 min     ±0.00%       2.23 min       2.23 min

Comparison:
PureFileStorage          0.52
FileStorage           0.00747 - 70.10x slower +2.20 min
```

</details>

## **Implementation stories**

While implementing this storage and looking into CubDB optimizations, I’ve found some interesting aspects of CubDB and of Erlang/Elixir file interaction quirks.

- CubDB turned out to be way slower on large transactions than expected. 1000-change transaction write is ~500x slower than 1 change write (which is worse amplification than our new storage, which is ~100x slower for 1000 changes as compared to 1 change), but also it’s 150ms in absolute numbers!
- I’ve always been aware of “file server” entity in BEAM - a special GenServer that serializes all file operations on the BEAM node to (a) allow for cross-node file access in distributed Erlang deployments, and to (b) ensure no race conditions are visible within the system. This is very useful… until you want to access a lot of files of a lot of shapes in parallel. For cleanup, for example, when PostgreSQL database has been changed. Suddenly, having a bottleneck to 10000 `File.rm_rf!/1` calls on unrelated directories is way more costly than expected. We’re using a property that only the storage should be accessing it’s own file structures to drop down to lower (internal in some cases) APIs for more direct access.
- Turns out some internal implementations of Erlang’s file access could be optimized further. Importantly for us, skip-reads can be optimized. Our log file is structured to have a fixed-width LSN as a prefix (16 bytes), followed by length-prefix JSON line and when looking for an line to start reading from, we’re considering only the LSN, skipping the JSON if it’s irrelevant. We want our reads to be fast, so we’re using `:read_ahead` - a flag in Erlang that reads ahead a certain byte range into a special binary buffer (which is very efficient, as it’s not being copied yet as a binary into Erlang VM heap), and then feeds `IO.binread/1` operations from that buffer. Each `IO.binread/1` does result in a binary copy into Erlang VM, but unfortunately we can’t skip reading the JSON - `:file.position(file, {:cur, 10)` call to move file cursor 10 bytes ahead currently results in buffer being dropped and refilled (plus an `fseek` call), killing any performance benefits. I’ll be opening a PR to address that in BEAM.
- We’ve also considered using SQLite as the storage backend. It was indeed faster than CubDB, but we chose against it to own the layer and current implementation showed itself to be faster than SQLite.

## Real-World Impact: Full System Benchmarks

Ok, back to performance: microbenchmarks are fine, but we needed to see how new storage affects the system as a whole. Turns out, pretty strongly:

[comment]: # I'll redo the images with 1.1 label instead of the PR label

<figure style="max-width: 512px">
  <a :href="oneShapeWriteImg">
    <img :src="oneShapeWriteImg" />
  </a>
</figure>

<figure style="max-width: 512px">
  <a :href="nShapesWriteImg">
    <img :src="nShapesWriteImg" />
  </a>
</figure>

<figure style="max-width: 512px">
  <a :href="concurrentShapeCreationImg">
    <img :src="concurrentShapeCreationImg" />
  </a>
</figure>

<figure style="max-width: 512px">
  <a :href="writeFanoutImg">
    <img :src="writeFanoutImg" />
  </a>
</figure>

<figure style="max-width: 512px">
  <a :href="diverseShapeFanoutImg">
    <img :src="diverseShapeFanoutImg" />
  </a>
</figure>

[comment]: # Here’s a good place for Trigger.dev results when we have them

## What This Means for Electric Users

This new storage implementation makes Electric faster and more scalable than before.

We can comfortably support way more shapes on the same per-transaction time budget. Lowered CPU per write should also improve scalability on the same hardware. This change make Electric definitely faster than Postgres for most common workloads. Even Trigger.dev’s 10k changes per second was fine.

Reads are also much faster and use way less CPU now, as they are a very direct file reads. This should make CDNs useful but not necessary for most installations.

We’re running our own cloud-hosted version of Electric, and it’s very important to us to be efficient in resource usage. We ourselves are very happy with the metrics we’re seeing out of our cloud, with lowered resource usage.

## From 1.0 to 1.1

Ok, but that’s just the latest in the chain of improvements we’ve made from 1.0. We’ve had 23 minor versions with bug fixes and improvements, but some of them also had a large performance impact. Let’s take a look at our progress.
