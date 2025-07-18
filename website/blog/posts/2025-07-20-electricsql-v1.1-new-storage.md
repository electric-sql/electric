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

## The Problem: When Your Key-Value Store Becomes Your Bottleneck

We’re making ElectricSQL - a sync engine that helps deliver data from PostgreSQL database to clients along with the updates. Querying the PostgreSQL for data is easy, but we also want to subscribe to future changes that affect the data we’ve just queried. Luckily, PostgreSQL provides a replication stream that we can follow and reason about.

Electric's job is deceptively simple: take a PostgreSQL database, slice it up into "shapes" (think `SELECT * FROM users WHERE team_id = 123`), and keep those shapes in perfect sync with live updates. Every change that comes through Postgres replication needs to get classified, filtered, and written to potentially dozens of shape logs. In practice, this means being able to evaluate Postgres where clauses over data coming from the replication stream, and then being able to write it those changes to disk multiple times while keeping up with PostgreSQL replication stream. Extremely boiled down, our system has only 3 pieces that are doing performance-sensitive operations: where clause evaluation, shape log writes, and shape log reads. Two of those are dependent on the log storage implementation.

On the first implementation, we used to store Erlang terms on disk, and convert them to JSON on their way out. Unfortunately, it turned out to be quite slow and quite wasteful on the CPU to re-serialize the same data again and again. To avoid this issue, we pre-form JSON on write, and our shape logs are essentially a list of JSON lines.

CubDB seemed like the obvious choice for storing these logs. It's an Elixir key-value store, handles persistence, and integrates cleanly with our stack. But as we started pushing real workloads through Electric, things got slower than we anticipated. Writes are a big part of the time budget we have per transaction to keep up with a fast Postgres, and they were taking up plenty of CPU too. Moreover, given CubDB architecture, we couldn’t decouple writes and they also took up more CPU than we’d like.

We’re aiming to make a fast and scalable sync engine, and we have a cloud service to run, where CPU and disk contention can get pretty high, so we needed to do something.

We needed to own the low level of our stack to best optimize it for our purposes. Owning this layer allows us to focus on the best possible solution for the problem instead of trying to work around the limitations of existing implementations. We have control and opportunity to use business logic insight to gain more performance with less complexity at the cost of generality.

## **The Solution: An Append-Only Log Tailored for Sync**

The insight was that we don't actually need a general-purpose key-value store. We need exactly two operations:

- Append changes to a shape's log
- Read a section of that log (for initial sync or catching up)

There are some system properties that we’re utilizing to get the performance we want while keeping the consistency. There are four main ones:

1. Transactions come from PostgreSQL in LSN (Log Sequence Number) order. This absolute ordering allows us to keep a single LSN as a boundary, for example for last written transaction.
2. Our appends are all-or-nothing - an append to log should only be visible in full as a complete transaction, to avoid leaving clients in an inconsistent state
3. Our reads are “chunk-aligned”. In order to better utilize CDN-level caching in front of ElectricSQL while also limiting single transfer size for clients, we align upper boundaries of all reads to a common chunk boundary (if the 10MiB chunk is complete, that is). This gives us a natural sparse pointer index.
4. ElectricSQL is functionally a cache. If Electric crashes mid-write (which is fairly unlikely with Elixir and BEAM), then we should be able to replay the transaction from Postgres on reconnection

All of the above gives us a pretty simple design. We have a two-file system, a log file and a chunk file. Log file is a binary file that contains the JSON along with relevant auxiliary information (it’s LSN is the main one), and a chunk index is a sparse pointer (every 10MB of JSON) to start and end of the chunk. Chunk index is doing double-duty, as the upper chunk boundary is exactly what we’re reading up to.

All fast writes are buffered writes. Calling `fsync` after every small transaction is very slow, and here we utilize ability to continue from Postgres to keep consistency in case of a crash and a missing write. Once persisted and `fsync`-ed we update the stored LSN of the “last persisted transaction” and that gives us a clean recovery point to continue from.

Simplicity of the resulting system is also it’s strength. It’s fast because there’s just less places to be slow. It’s reliable because we’re essentially moving a pointer at a correct point in time and that’s it.
There is one other benefit to this new file structure we’re controlling - it’s ready for object storage. Because we have a simple linearly-readable file format, we can very easily reuse it when uploading chunks to S3, freeing up local storage on the deployments.

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
