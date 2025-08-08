---
title: Electric 1.1 is shipping with a new storage engine that's 40x faster
description: >-
  This is the story of how we've made it and why only now.
excerpt: >-
  This is the story of how we've made it and why only now.
authors: [balegas]
image: /img/blog/electric-1.1-released/header.png
tags: [ai, sync]
outline: [2, 3]
post: true
---

<script setup>
import StorageComparisonChart from '../../src/components/StorageComparisonChart.vue'
</script>

Electric is a [Postgres](https://www.postgresql.org/) sync engine that streams database changes to millions of concurrent users in real-time. Our performance goal: be faster than Postgres. But as Electric grew and customers with more demanding workloads emerged, we hit a wall—our storage layer couldn’t keep up.

We knew this day would come. It was time to build our own storage engine. This article shares the story of that journey: from recognizing the limitations of our existing system, to designing a solution tailored to Electric’s needs and ultimately seeing it deliver up to 40× performance improvements in production.

## How Electric works

The core primitive for controlling syn in Electric is the [**shape**](/docs/guides/shapes). A shape is a partial replica of a table that includes the subset of rows matching a user-defined WHERE clause. Electric continuously tails Postgres’s logical replication stream for changes, matches them against registered shape, appends them to the corresponding **shape logs** and sends them to connected clients.

Electric’s job sounds deceptively simple but scaling it to handle hundreds of thousands of shapes and millions of connected users pushes the system to its limits. Shape evaluation needs to happen in microseconds, and the storage engine must keep up with Postgres's write throughput. If it falls behind, real-time updates become sluggish—and Postgres’s WAL starts to pile up.

## Storage is a centerpiece of Electric's performance

One [difference](https://expertofobsolescence.substack.com/p/the-hard-things-about-sync) between sync engines and other types of realtime systems is that sync engines don't miss changes. Realtime systems typically offer at-most-once delivery or temporal buffering windows. if you lose connection, you're done. In Electric, users can resume shapes at any point in history. This makes the sync engine dramatically simpler to use but puts the storage engine at the heart of Electric's performance.

Writes in Electric are primarily append-only, while reads perform range scans starting from an arbitrary **offset**. Since logs can grow indefinitely we save them in chunks and periodically compact them. Compaction in Electric is unique in that it must preserve temporal ordering of creation and deletion in the log.

### Starting with an off-the-shelf solution

When we decided to [rebuild Electric](/blog/2024/07/17/electric-next), we wanted to something pragmatic that would allow us to get a running system fast and tune performance in a second step. As Kyle likes saying: "make it work, make it right, make it fast". We looked at many off-the-shelf solutions we could use, but it wasn't easy to pick one.

[LSM-tree](https://www.cs.umb.edu/~poneil/lsmtree.pdf) based stores like [RocksDB](https://rocksdb.org/) --- the most obvious choice --- combine the strengths of append-only writes and key-value access. But most of can't do compaction while preserving temporal ordering of creation and deletion of keys. [Apache Kafka](https://kafka.apache.org/) is the only production system that does this type of compaction, but it would be too hard to integrate. Possibly we could modify RocksDb to do what we needed, but was discouraging since we would need to learn a new piece of software with unpredictable success. We also looked into [SQLite](https://sqlite.org/) becuase it is SQLite and it is heavily optimized. It was fast but not always faster and we were worried of hitting issues with a non-customizable system.

None of the off-the-shelf solutions were a perfect fit for Electric's requirements. So, we ended-up picking [CubDB](https://github.com/lucaong/cubdb) as a pragmatic starting point—a tiny and mighty Elixir key-value store that was would get the job done. Our team has lot's of experience with Elixir so we would get good development speed by keeping the storage engine in the same languange. We knew this was not the best solution, but was one that didn't require a lot of initial investment.

### Discovering the limits

CubDb was performant enough initially and we didn't come across any bugs. We were able to get massive gains in optimizing other parts of the system before storage starting to become a concern. We [launched v1.0](/blog/2025/03/17/electricsql-1.0-released) and launched [Cloud Beta](/blog/2025/04/07/electric-cloud-public-beta-release) with it. As Electric scaled to production traffic with customers like [Trigger.dev](https://trigger.dev/) pushing [20,000 changes per second](https://x.com/triggerdotdev/status/1945876425225171173), the limitations started to emerge.

**CPU usage**: Writing to storage was taking up a massive part of our per-transaction time budget, with high CPU usage from updating the index and rewriting chunks.

**Latency**: P95 latency was too high due to CubDb slowing down significantly when handling large transactions. These heavy writes ended up blocking reads for extended periods.

**Rolling deploys:** Although it wasn’t part of our initial requirements, we discovered during the development of [Electric Cloud](https://dashboard.electric-sql.cloud/sources) that CubDb would not allow read-only mode, making zero-downtime architecturally impossible.

The challenges we encountered weren’t a result of CubDb being poorly designed—it just wasn’t tailored to meet Electric’s requirements. It became clear that we needed to step up and find a solution to these problems.

## Building our own storage engine

Following the lessons from [CockroachDB](https://www.cockroachlabs.com/) team when they [moved from RocksDB to Pebble](https://www.cockroachlabs.com/blog/pebble-rocksdb-kv-store/), we decided to build our own storage engine, instead of trying to modify an existing one. The scope of what we needed was reasonably small to build it ourselves and this way we could deeply integrate it with the rest of the system and taylor it to current and future requirements. What we wanted from the storage:

**Performance**: With our initial prototype, we've learned about bottlenecks and the parts of the system that were hard to scale. Essentially, we needed fast append-only writes with low CPU usage and consistent performance either with SSD or network-attached storage, two typical environments where Electric runs.

**No data-parsing in the read-path**: We've designed electric to do all the hard work at write-time tomake the read-path extremely efficient. Parsing any data in the read-path is prohibitively expensive and even worse when you have to copy it from the kernel to userland.

**Fast recovery**: We build shape log offsets based on Postgres's [LSNs](https://www.postgresql.org/docs/current/datatype-pg-lsn.html). If Electric restarts or crashes, we can discard data for incomplete transactions and resume streaming from the last acknowledged LSN from Postgres. This safety guarantee lets us prioritize speed of recovery over complex crash-recovery mechanisms.

**Cloud native**: Most Electric deployments will be in the Cloud. In our Cloud, we use attached storage, which allows to very easily scale-out readers and have zero-downtime deployments.

**Observability and control**: By owning the storage engine, we gain deep visibility into its behavior and performance. This lets us optimize better hot paths, resolve issues faster and respond quickly as requirements evolve.

## Implementation overview

Our new storage architecture is elegantly simple. For each shape, we maintain two files. One that contains the raw data for the shape and another file that is an index of specific offsets in the shape log, to enable fast lookup of user-provided offsets.

### Shape log

The shape log contains pre-serialized JSON data of the shape (the row changes from logical replication) divided into fixed-size **chunks**. Each chunk has an header that contains information about the actual length of the content for the chunk and the offset/LSN of the first JSON entry in the chunk.

**Immutable chunks**: Once a chunk is completed it becomes immutable, so coordination is only necessary for unfinished chunks. Since we track the current content length for the chunk, readers can safely consume the log even with active writers. Coordination is done at file-level, allowing multiple readers to consume shape logs safely in a distributed environment.

**Shape log scanning**: the content of the shape log is formatted to be easy to read without copying data into user space. To find the right chunk for an offset, we skip-read through the headers of the shape-log to find the chunk with the requested offset and... not sure how we retrieve the offset without copying data.

**Buffering writes**: Calling `fsync` on every write is prohibitively slow, but not calling `fsync` immediately is giving up on durability. Any performant storage system needs to address this dilemma in some way. In Electric, we deeply integrate shape logs recovery with logical replication. If Electric crashes without some changes being flushed to disk, we can resume logical replication from the last persisted position and replay missing transactions.

### Offset index

The offset index provides fast shape random offset lookup through a sparse indexing strategy. The index is simply a list of pointers to chunk boundaries in the shape log. We add a new pointer to the sparse index for every finalized chunk.

**Finding a chunk**: When a client requests data starting from a specific offset, we do a binary search on the index to locate the appropriate chunk pointer, retrieve that chunk, scan it to find the requested offset in the shape log and stream the rest of the chunk.

**Coordination-free:** Because shape logs are append-only, offset pointers are always added to the end of the sparse index. With this simple append-only strategy, the sparse index can be read and written without any coordination.

### Shared Readers

The new architecture allows single-writer, multiple readers, which is ideal for Electric, since there is only one consumer of logical replication stream at a time, but we might have multiple readers.

**Horizontal read scaling**: Electric is already quite scalable [behind a CDN](/blog/2024/12/10/electric-beta-release), but the new storage architecture allows multiple readers to be attached to shape logs without holding a connection to Postgres, giving us plenty of room to scale beyond anyone's needs.

**Zero-downtime deployments**: While an Electric server replaces another during a deployment, the newly started server can start serving shape request from shape logs before both servers agree to exchange the writer role.

## Performance Results

Enough talking, show me the numbers! To validate our new storage engine, we ran a series of performance tests, starting with focused **micro-benchmarks** to isolate specific behaviors, and then moving to **real-world workloads** to measure end-to-end performance under typical Electric usage patterns.

### Micro-benchmarks

We conducted some microbenchmarks to evaluate the new storage engine against CubDb. Tests were run on both local SSDs (MacBook Air M4) and network-attached storage (AWS EFS attached to t2.medium instances), which are common types of storage used with Electric.

We got amazing speedups both on SSD and EFS, with up to 130x and 172x faster reads and 101x and 7x faster writes, respectively.

#### Write Performance

This benchmark consists in appending a fixed number of rows to a shape log. With CubDb, every insertion needs to update the index to find the right chunk to write to. With the new engine, we simply append to the latest chunk and only modify the index when we reach the chunk size limit.

On local SSDs, the new engine achieved up to 101x faster writes when we're appending 1000 rows. These results were a bit surprising. We haven't really seen this before as appending this amount of rows to a single shape log is not very common.

With network-attached storage, where latency typically dominates, curves follow a similar profile, but now with a 5x to 7x performance improvement.

<!-- First charts pair: wrap into two-column container -->
<div class="charts-2col">
  <div class="col">
    <StorageComparisonChart 
        title="SSD Performance"
        :data="[
          { label: 'V1.1', data: [0.01, 0.12, 1.65] },
          { label: 'CubDB', data: [0.32, 3.49, 167.68] }
        ]"
        :labels="['1 row', '20 rows', '1000 rows']"
        x-axis-title="Number of Rows"
        y-axis-title="Latency"
        y-axis-suffix=" ms"
      />
  </div>
  <div class="col">
    <StorageComparisonChart 
        title="EFS Performance"
        :data="[
          { label: 'V1.1', data: [0.26, 3.39, 99.29] },
          { label: 'CubDB', data: [1.4, 15.5, 712.58] }
        ]"
        :labels="['1 row', '20 rows', '1000 rows']"
        x-axis-title="Number of Rows"
        y-axis-title="Latency"
        y-axis-suffix=" ms"
      />
  </div>
</div>

<style>
.charts-2col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  margin: 0 0 3rem 0;
}
.charts-2col .col { width: 100%; }
@media (max-width: 860px) {
  .charts-2col { grid-template-columns: 1fr; }
}
</style>

### Read Performance

This benchmark consists in reading a fixed number of chunks from a shape log and measure the total time for retrieving all chunks. This mimics clients retrieving changes for a shape from different points in time.

- TODO: confirm we (can) skip the index for the latest chunk

# Single Reader

TODO: Do random access ensure the number of retrieved chunks?

With single reader we want to see how fast we can retrieve a sequence of chunks. In this case, the baseline latency for CubDb is quite high already, which is explained by unnecessary deserialization of data in user space. With the new engine we stream data directly from disk to the network interface inside the kernel.

<!-- Single Reader pair -->
<div class="charts-2col">
  <div class="col">
    <StorageComparisonChart 
      title="Single Reader - SSD Performance"
      :data="[
        { label: 'V1.1', data: [2.64, 2.10] },
        { label: 'CubDB', data: [131.68, 154.07] }
      ]"
      :labels="['5 chunks', '10 chunks']"
      x-axis-title="Number of Chunks"
      y-axis-title="Latency"
      y-axis-suffix=" ms"
    />
  </div>
  <div class="col">
    <StorageComparisonChart 
      title="Single Reader - EFS Performance"
      :data="[
        { label: 'V1.1', data: [14.00, 14.80] },
        { label: 'CubDB', data: [1690.00, 2550.00] }
      ]"
      :labels="['5 chunks', '10 chunks']"
      x-axis-title="Number of Chunks"
      y-axis-title="Latency"
      y-axis-suffix=" ms"
    />
  </div>
</div>

# Concurrent readers

We run the read workload with 200 concurrent readers for the same shape. In CubDb all readers and writers need to go through the index to find the right chunk, while new storage clients will find a concurrency bottleneck when trying to access the latest changes in an unfinished chunk.

This is an extreme use case for Electric as we expect contention on shape logs to be relatively low as data can be offloaded to the CDN and live clients will always be retrieving data from latest offsets (which will be cached).

<!-- Multiple Readers pair -->
<div class="charts-2col">
  <div class="col">
    <StorageComparisonChart 
      title="Multiple Readers - SSD Performance"
      :data="[
        { label: 'V1.1', data: [250.00, 210.00] },
        { label: 'CubDB', data: [16040.00, 27860.00] }
      ]"
      :labels="['5 chunks', '10 chunks']"
      x-axis-title="Number of Chunks"
      y-axis-title="Latency"
      y-axis-suffix=" ms"
    />
  </div>
  <div class="col">
    <StorageComparisonChart 
      title="Multiple Readers - EFS Performance"
      :data="[
        { label: 'V1.1', data: [1332.00, 1908.00] },
        { label: 'CubDB', data: [120600.00, 133800.00]}
      ]"
      :labels="['5 chunks', '10 chunks']"
      x-axis-title="Number of Chunks"
      y-axis-title="Latency"
      y-axis-suffix=" ms"
    />
  </div>
</div>

### Electric benchmarks

TODO

## Lessons learned

This journey taught us many lessons. One is that you can get massive speedups when the baseline is really unoptimized for your use-case :). The second (and more seriously) is to know when it is a good time to address performance.

Starting off with CubDb was a good choice. It got us to v1.0 with minimal issues which gave us enough space to work on shipping a piece of software that just works. During that time, we learned a great deal about how Electric behaves under real-world workloads—surfacing bottlenecks in lots of other places. Had we chosen to build our own storage system from day one, we likely would’ve made a number of incorrect assumptions and premature optimizations. Instead, our production experience gave us the insight we needed to design the right solution.

Owning this critical piece of infrastructure allows us to reason deeply about performance, rapidly diagnose issues, and optimize for our exact workloads—all within our codebase.

This isn’t a universal playbook. It worked well for us because the scope of what we had to build was relatively small and it was one our team’s core areas of expertise.

## Conclusions

We’ve taken a big step toward delivering on an ambitious promise: a sync engine that is faster than Postgres. With our new storage engine, we’ve unlocked significant performance headroom and laid the foundation for building a performant and more capable sync engine.

None of this would’ve been possible without our incredible engineering team. Huge thanks to the Electric team for their insight, code reviews, and relentless focus on making Electric better. True innovation requires team work, patience, and the courage to challenge assumptions.

Ready to experience the magic of sync? [Sign up for Electric Cloud](https://electric-sql.com/cloud)—it’s free.
