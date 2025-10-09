---
title: 'Electric 1.1: new storage engine with 100x faster writes'
description: >-
  How we built a new storage engine for Electric, why we did it now, and how it delivers lower latency, higher throughput, and zero‑downtime deploys.
excerpt: >-
  A behind‑the‑scenes look at Electric's new storage engine: why we built it, how it works, and how it improves performance in production.
authors: [icehaunter, balegas]
image: /img/blog/electric-1.1-released/header.png
tags: [ai, sync]
outline: [2, 3]
post: true
---

<script setup>
import StorageComparisonChart from '../../src/components/StorageComparisonChart.vue'
import StorageComparisonChartColumn from '../../src/components/StorageComparisonChartColumn.vue'
import StorageEngineDiagram from '/static/img/blog/electric-v1.1-new-storage/storage-engine-diagram.svg'

// Raw performance data
const readPerformanceData = {
  '1.0.24': [131.68, 154.07, 1690.00, 2550.00],
  '1.1.0': [2.64, 2.10, 14.00, 14.80]
}

const writePerformanceData = {
  '1.0.24': [0.32, 3.49, 167.68, 1.4, 15.5, 712.58],
  '1.1.0': [0.01, 0.12, 1.65, 0.26, 3.39, 99.29]
}

// Compute normalized data (relative to 1.0.24)
const normalizedReadData = {
  '1.0.24': readPerformanceData['1.0.24'].map(() => 1.0),
  '1.1.0': readPerformanceData['1.1.0'].map((value, index) => value / readPerformanceData['1.0.24'][index])
}

const normalizedWriteData = {
  '1.0.24': writePerformanceData['1.0.24'].map(() => 1.0),
  '1.1.0': writePerformanceData['1.1.0'].map((value, index) => value / writePerformanceData['1.0.24'][index])
}
</script>

Electric is a [Postgres](https://www.postgresql.org/) sync engine that [streams database changes to millions of concurrent users in real time](https://electric-sql.com/blog/2024/12/10/electric-beta-release#scalable). Our mission is simple: be faster than Postgres.

After a year of progress, rapid growth exposed our limits. The storage engine had become a critical bottleneck — replication lag climbing, CPUs maxing out, and the system was having trouble keeping pace with the largest deployments. We made a bold decision: build our own storage engine from scratch.

The result? 102X faster writes and 73X faster reads on SSD. This is the story of how we made it.

## How Electric works

The core primitive for controlling sync in Electric is the [**shape**](/docs/guides/shapes). A shape is a partial replica of a table that includes the subset of rows matching a user-defined WHERE clause. Electric continuously tails Postgres's logical replication stream for changes, matches them against registered shapes, appends them to the corresponding **[shape logs](/docs/api/http#shape-log)**, and sends them to clients using HTTP long polling.

:::info Why this architecture is different

**CDN-native fan-out**: CDNs de-duplicate shape requests and collapse load, moving it out of your infrastructure.

**Cost physics**: There's no persistent socket tax—you pay only for actual data transfer, which means lower egress costs and fewer hot servers at scale.

**Operational simplicity**: Shape log persistence means zero-downtime deploys without managing stateful socket fleets.

:::

Electric's job sounds simple, until you have hundreds of thousands of shapes to match and millions of clients hitting the system at once. At that scale, every microsecond counts. Fall behind Postgres throughput and real-time becomes sluggish and Postgres's [WAL](https://www.postgresql.org/docs/current/wal-intro.html) starts to pile up. It's not pretty.

<figure>
  <a href="/img/api/shape-log.jpg">
    <img srcset="/img/api/shape-log.sm.png 1064w, /img/api/shape-log.png 1396w"
        sizes="(max-width: 767px) 600px, 1396px"
        src="/img/api/shape-log.png"
    alt="Flow diagram showing how changes are matched to shapes, appended to shape logs, and streamed to clients"
    />
  </a>
  <figcaption class="figure-caption text-end">
    Flow of changes into shape logs and out to clients.
  </figcaption>

</figure>

## Storage is the beating heart of Electric

One [difference](https://expertofobsolescence.substack.com/p/the-hard-things-about-sync) between sync engines and other types of real‑time systems is that sync engines don't miss changes. Real‑time systems typically offer at‑most‑once delivery or temporal buffering windows. If you lose connection, you're done. In Electric, users can resume shapes at any point in history. This makes the sync engine dramatically simpler to use but storage becomes the beating heart of the system.

### Picking an off-the-shelf solution

When we decided to [rebuild Electric](/blog/2024/07/17/electric-next), we focused on shipping a working system that users could trust, and fine-tune performance later. As Kyle Mathews says: "make it work, make it right, make it fast".

Writes in Electric are append‑only, while reads are mostly range scans. Since logs can grow indefinitely, we compact them periodically. Compaction in Electric is unique in that it must preserve the temporal ordering of creation and deletion of keys in the log. We looked at the available options.

[Apache Kafka](https://kafka.apache.org/) is the production system that is closest to our needs. However, it's too complex and would be hard to integrate.
[LSM‑tree](https://www.cs.umb.edu/~poneil/lsmtree.pdf)‑based stores like [RocksDB](https://rocksdb.org/) are good for append‑only writes but not ideal for range scans. We also looked into [SQLite](https://sqlite.org/) because it is heavily optimized. It was fast, but not always faster, and we were worried about hitting issues with a non‑customizable system.

None of the off‑the‑shelf solutions were a perfect fit for Electric's requirements. So, we ended up picking [CubDB](https://github.com/lucaong/cubdb) as a pragmatic starting point — a tiny and mighty Elixir key‑value store that would get the job done. Our team has lots of experience with Elixir, so we would get good development speed by keeping the storage engine in the same language. We knew this was not the best solution, but it was one that didn't require a lot of initial engineering investment.

### Reaching the limits

CubDB was performing well enough and we didn't come across any bugs. We were able to get huge performance gains by optimizing other parts of the system before even thinking of storage. We [launched v1.0](/blog/2025/03/17/electricsql-1.0-released) and later [Cloud Beta](/blog/2025/04/07/electric-cloud-public-beta-release) with it. As Electric scaled to production traffic with customers like [Trigger.dev](https://trigger.dev/) pushing [20,000 changes per second](https://x.com/triggerdotdev/status/1945876425225171173), the limitations started to emerge.

**CPU usage**: Writing to storage consumed excessive CPU time. This was due to frequent updates to CubDB's internal structures.

**Latency**: P95 latency was too high. Large transactions blocked reads for extended periods.

**Technical limitations:** CubDB's architecture made zero-downtime deployments impossible in our Cloud, because it wasn't possible to have shared access to logs across instances.

The challenges we encountered weren’t due to CubDB being poorly designed — it simply wasn’t the right fit for Electric’s use case. We knew this day would come, and we were grateful for how far our initial storage solution with CubDB had taken us.

## Building our own storage engine

Following the lessons from [CockroachDB](https://www.cockroachlabs.com/) when they [replaced RocksDB with Pebble](https://www.cockroachlabs.com/blog/pebble-rocksdb-kv-store/), we chose to build our storage engine from scratch and own this layer of the system. The scope of our needs was small enough to make this feasible. We could more easily adapt it to our needs over time. Here's what we needed from our storage:

**Performance**: With our initial prototype, we learned about bottlenecks and the parts of the system that were hard to scale. Reducing CPU usage and the number of system calls were two top priorities.

**Optimize read path**: We've designed Electric to do all the hard work at write time to make the read path extremely efficient. Parsing any data in the read path is prohibitively expensive.

**Fast recovery**: Electric implements the Postgres's logical replication [protocol](https://www.postgresql.org/docs/current/logical-replication.html). When it crashes, we want to resume replication from a safe checkpoint and recover quickly.

**Cloud native**: In our [Cloud](https://dashboard.electric-sql.cloud/sources), we ship patches constantly. Zero-downtime deployments are a non-negotiable. At some point we also want to start moving shape logs to object store.

**Observability**: By owning the storage engine, we gain deep visibility into its behavior and performance. This lets us optimize hot paths, resolve issues faster, and respond quickly as requirements evolve.

## Implementation overview

Our new storage architecture is elegantly simple. For each shape, we maintain two files: the **shape log**, which contains the raw data for the shape, and the **offset index**, which is a list of pointers into the shape log for fast lookup of offsets. Addressing shape logs by offset matches how [clients request shapes](/docs/api/http#shape-log).

<figure style="margin: 1rem auto 2rem auto; text-align: center; max-width: 100%;">
  <img :src="StorageEngineDiagram" alt="Storage engine diagram – look-up of shape log offset" style="max-width: 80%; height: auto; display: block; margin: 0 auto;" />
  <figcaption style="max-width: 100%; text-align: center; color: var(--vp-c-text-2); font-size: 0.95em;">To hande a shape request with offset 0/B100, 1) find the closest chunk boundary in the shape index (0/B0A1), 2) scan the shape log until finding the requested offset, 3) send all data until the next shape boundary (0/BF0F) </figcaption>
</figure>

### Shape log

The shape log contains pre‑serialized JSON lines of the shape data (the row change from Postgres's logical replication) and their corresponding offset. Shape logs are divided into fixed‑size **chunks**. The first entry of the log is the **chunk boundary** and is used for indexing. Changes matching the shape are appended to the end of the log.

**Immutable chunks**: Once a chunk reaches its max size, it is marked as complete and becomes immutable. Readers can safely access completed chunks.

**Shape‑log scanning**: To find the right offset for a user request, we use the shape index to locate the chunk that contains the requested offset and then scan the chunk to find the first JSON line for that offset. We use a [read‑ahead](https://man7.org/linux/man-pages/man2/readahead.2.html) technique to reduce the number of system calls while scanning the file.

**Buffering writes**: Calling [`fsync()`](https://man7.org/linux/man-pages/man2/fsync.2.html) on every write is prohibitively slow, but not calling `fsync()` immediately is giving away durability. Any high‑performance storage system needs to address this dilemma in some way. In Electric, we deeply integrate shape‑log recovery with logical replication. If Electric crashes without some changes being flushed to disk, we can resume logical replication from the last persisted position and replay missing transactions.

### Shape index

The shape index provides fast shape offset lookup through a sparse indexing strategy. The index is simply a list of pointers to chunk boundaries in the shape log. We add a new pointer to the sparse index for every finalized chunk.

**Finding a chunk**: When a client requests data starting from a specific offset, we do a binary search on the index to locate the appropriate chunk pointer, retrieve that chunk, and scan it from there, as explained above.

**Lock‑free**: Because shape logs are append‑only, offset pointers are always added to the end of the index. This means that the index can be read and written without any locking. We keep a number of chunk pointers in memory to avoid reading the index from disk for [live requests](/docs/api/http#live-mode).

### Read-only mode

The new architecture decouples readers and writers, allowing the Electric server connected to Postgres to share access with other Electric servers accessing the shape logs in read-only mode. This unlocks new capabilities.

**Horizontal read scaling**: Electric is already quite scalable [behind a CDN](/blog/2024/12/10/electric-beta-release), but read-only mode allows horizontal scaling of the read path. Electric can scale to any read workload.

**Zero‑downtime deployments**: Keeping the system available during deploys is critical for our Cloud infrastructure. We achieve zero-downtime deployments by allowing servers to continue serving data from shape logs, while the old and new server switchover the connection to Postgres.

## Performance evaluation

Enough talk — show me the numbers! To validate our new storage engine, we ran a series of performance tests.

Microbenchmarks ran on a local SSD (MacBook Air M4), and end‑to‑end benchmarks ran on AWS t2.medium instances with network-attached storage (EFS).

### Micro-benchmarks

We conducted a series of microbenchmarks to evaluate the new storage engine against CubDB. We saw strong speedups on both SSDs and EFS, with 102x and 7x faster writes and 73x and 172x faster reads, respectively.

#### Write performance

This benchmark consists of appending a fixed number of rows to a shape log. With CubDB, every insertion needs to update the index to locate the right chunk to write to. With the new engine, we simply append to the latest chunk and only modify the index when we reach the chunk‑size limit.

On local SSDs, the new engine wrote 102x faster when appending 1,000 rows.

With network‑attached storage, the network latency slows both storage engines down but we still see the same sort of speedup, but now with a 5x to 7x performance improvement.

<!-- Write performance chart - normalized to 1.0.24 -->

<StorageComparisonChartColumn 
  title="Write performance"
  :data="[
    { label: '1.0.24', data: normalizedWriteData['1.0.24'] },
    { label: '1.1.0', data: normalizedWriteData['1.1.0'] }
  ]"
  :labels="['1 row (SSD)', '20 rows (SSD)', '1000 rows (SSD)', '1 row (EFS)', '20 rows (EFS)', '1000 rows (EFS)']"
  x-axis-title="Test Configuration"
  y-axis-title="Relative Latency"
  y-axis-suffix=""
  speedup-new-label="1.1.0"
  speedup-old-label="1.0.24"
  :raw-data="writePerformanceData"
/>

#### Read performance

This benchmark consists of reading a fixed number of chunks starting from an arbitrary offset in a shape log and measuring the total time to retrieve all chunks.

In this case, the baseline latency for CubDB is quite high due to the number of system calls required to find the requested offset in the initial chunk. The new storage engine uses a read‑ahead optimization to reduce the number of system calls.

<!-- Read performance chart - normalized to 1.0.24 -->

<StorageComparisonChartColumn 
  title="Read performance"
  :data="[
    { label: '1.0.24', data: normalizedReadData['1.0.24'] },
    { label: '1.1.0', data: normalizedReadData['1.1.0'] }
  ]"
  :labels="['5 chunks (SSD)', '10 chunks (SSD)', '5 chunks (EFS)', '10 chunks (EFS)']"
  x-axis-title="Test Configuration"
  y-axis-title="Relative Latency"
  y-axis-suffix=""
  speedup-new-label="1.1.0"
  speedup-old-label="1.0.24"
  :raw-data="readPerformanceData"
/>

### End-to-End benchmarks

The following [benchmarks](/docs/reference/benchmarks) run the full Electric stack end-to-end and report application‑level latency. The results give a clearer picture of potential improvements at runtime. We ran these experiments in AWS in the same setting as the micro-benchmarks (t2.medium instances with EFS).

#### Shape creation

In this benchmark, we create an increasing number of concurrent shapes until the system saturates. This is a fairly expensive operation, as we need to query Postgres and write a new file to disk with each request.
This is a scenario we had optimized for CubDB, so it performs reasonably well; however, the new engine is still significantly faster overall — about 1.63x on average across the run.

<StorageComparisonChart
  title="Concurrent shape creation"
  :data="[
    { label: '1.0.24', data: [262.1276595744681, 1823.464953271028, 3372.4007682458387, 4824.357766143106, 6301.927855711423, 7716.663525498891, 8874.89802955665, 10121.796846846846, 10649.21264108352, 12448.447175506684] },
    { label: '1.1.0', data: [187.86666666666667, 1109.8722222222223, 1955.5307917888563, 2862.72395273899, 3766.8748971193418, 4585.170394736842, 5587.4834362717575, 6413.2947164323805, 7083.659537319948, 8110.119808306709] }
  ]"
  :labels="['50','450','850','1250','1650','2050','2450','2850','3250','3650']"
  x-axis-title="Number of shapes"
  y-axis-title="Latency"
  y-axis-suffix=" ms"
  :columns="1"
  :height="300"
/>

#### Write throughput

This benchmark drives writes to arbitrary shapes and measures the end‑to‑end latency for a client to receive the data. This is the critical path for Electric: the longer writes take, the greater the replication lag becomes. We had a significant speedup for the new storage — 5x at 1,500 shapes — which means that the new storage is able to keep replication lag lower.

<StorageComparisonChart
  title="Write throughput: time to see writes"
  :data="[
    { label: '1.0.24', data: [213.0, 667.0, 1187.0, 1625.0, 2185.0, 2920.0, 3309.0, 3759.0] },
    { label: '1.1.0', data: [56.0, 127.0, 203.0, 311.0, 402.0, 431.0, 603.0, 710.0] }
  ]"
  :labels="['100','300','500','700','900','1100','1300','1500']"
  x-axis-title="Number of shapes"
  y-axis-title="Latency"
  y-axis-suffix=" ms"
  :columns="1"
  :height="300"
/>

#### Reads fan‑out

This benchmark measures read latency when streaming changes from one shape to a large number of connected clients. It stresses the concurrency of the read path until resources saturate. In practice, most Electric deployments will run behind a CDN (or an HTTP cache), which will de‑duplicate requests for the same shape. But benchmarks show that Electric can go pretty far without any caching in front of it.

Across the range, the new engine delivers consistently lower end‑to‑end latency — roughly 3.5–4.5x faster, and about 3.8x faster at 1,000 concurrent clients. Lower read‑path latency keeps live clients closer to real time.

<StorageComparisonChart
  title="Reads fan‑out: connected clients vs latency"
  :data="[
    { label: '1.0.24', data: [26.5, 176.0, 324.9, 487.9, 556.5, 685.7, 761.6, 926.2, 990.8, 1215.7, 1259.2] },
    { label: '1.1.0', data: [21.5, 53.5, 72.1, 120.5, 157.9, 199.3, 197.8, 225.1, 239.7, 274.9, 334.6] }
  ]"
  :labels="['5','100','200','300','400','500','600','700','800','900','1000']"
  x-axis-title="Connected clients"
  y-axis-title="Latency"
  y-axis-suffix=" ms"
  :columns="1"
  :height="260"
/>

## Lessons learned

Starting with CubDB was a good choice. It got us to v1.0 with minimal issues, giving us time to ship software that just works. Before addressing storage performance, [we've fixed tons of bugs, made Electric a reliable system](https://electric-sql.com/blog/2025/08/04/reliability-sprint) and learned a great deal about how it behaves under real‑world workloads, surfacing bottlenecks in many other places that were far more important to our core proposition. Had we chosen to build our own storage system from day one, we would have made some wrong assumptions and done lots of premature optimizations. Instead, our production experience gave us the insight we needed to design the right solution in the right moment.

This isn't a universal playbook. It worked well for us because the scope of what we had to build was relatively small, and it was one of our team's core areas of expertise.

## What's next

We've taken a big step toward our ambitious goal: being **faster than Postgres**. The new storage engine has delivered significant performance gains with 102x faster writes on SSD.

Beyond making Electric faster, we're laying the groundwork to continue building better open-source and cloud products. In Cloud, we're already seeing benefits with rolling deployments, horizontal scalability but it doesn't end there. There is an exciting roadmap ahead!

None of this would've been possible without our incredible engineering team. Huge thanks to the Electric [team](/about/team) for their insight, code reviews, and relentless focus on making Electric better.

Ready to experience the sync? [Sign up for Electric Cloud](https://electric-sql.com/cloud)—it's free.
