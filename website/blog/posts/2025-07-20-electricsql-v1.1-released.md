---
title: Electric 1.1 is shipping with a new storage engine that's 40x faster
description: >-
  This is the story of how we've made it and why only now.
excerpt: >-
  This is the story of how we've made it and why only now.
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
</script>

Electric is a [Postgres](https://www.postgresql.org/) sync engine that streams database changes to millions of concurrent users in real-time. Our performance goal: be faster than Postgres. But as Electric grew and customers with more demanding workloads emerged, we hit a wall: our storage layer couldn’t keep up.

We knew this day would come. It was time to build our own storage engine. This article shares the story of that journey: from recognizing the limitations of our existing system, to designing a solution tailored to Electric’s needs and ultimately seeing it deliver up to 40x performance improvements in production.

## How does Electric works

The core primitive for controlling syn in Electric is the [**shape**](/docs/guides/shapes). A shape is a partial replica of a table that includes the subset of rows matching a user-defined WHERE clause. Electric continuously tails Postgres’s logical replication stream for changes, matches them against registered shape, appends them to the corresponding **shape logs** and sends them to connected clients.

Electric’s job sounds deceptively simple but scaling it to handle hundreds of thousands of shapes and millions of clients pushes the system to its limits. Shape evaluation needs to happen in microseconds, and the storage engine must keep up with Postgres's write throughput. If it falls behind, real-time updates become sluggish and Postgres’s WAL starts to pile up.

<figure>
  <a href="/img/api/shape-log.jpg">
    <img srcset="/img/api/shape-log.sm.png 1064w, /img/api/shape-log.png 1396w"
        sizes="(max-width: 767px) 600px, 1396px"
        src="/img/api/shape-log.png"
        alt="Shape log flow diagramme"
    />
  </a>
  <figcaption class="figure-caption text-end">
    Shape log flow diagramme.
  </figcaption>
  
</figure>

## Storage is a centerpiece of Electric's performance

One [difference](https://expertofobsolescence.substack.com/p/the-hard-things-about-sync) between sync engines and other types of realtime systems is that sync engines don't miss changes. Realtime systems typically offer at-most-once delivery or temporal buffering windows. if you lose connection, you're done. In Electric, users can resume shapes at any point in history. This makes the sync engine dramatically simpler to use but puts the storage engine at the heart of Electric's performance.


### Starting with an off-the-shelf solution

When we decided to [rebuild Electric](/blog/2024/07/17/electric-next), we decided to start with pragmatic storage solution that would allow us to get a running system fast and tune performance in a second step. As Kyle likes saying: "make it work, make it right, make it fast". 

Writes in Electric are primarily append-only, while reads perform range scans starting from an arbitrary **offset**. Since logs can grow indefinitely we save them in **chunks** and periodically compact them. Compaction in Electric is unique in that it must preserve temporal ordering of creation and deletion in the log. 

We looked at many off-the-shelf solutions we could use, but it wasn't easy to pick one. [LSM-tree](https://www.cs.umb.edu/~poneil/lsmtree.pdf) based stores like [RocksDB](https://rocksdb.org/) combine the strengths of append-only writes and key-value access. But most of can't do compaction while preserving temporal ordering of creation and deletion of keys. [Apache Kafka](https://kafka.apache.org/) is the only production system that does this type of compaction, but it would be too hard to integrate. Possibly we could modify RocksDb to do what we needed, but was discouraging since we would need to learn a new piece of software with unpredictable success. We also looked into [SQLite](https://sqlite.org/) becuase it is SQLite and it is heavily optimized. It was fast but not always faster and we were worried of hitting issues with a non-customizable system.

None of the off-the-shelf solutions were a perfect fit for Electric's requirements. So, we ended-up picking [CubDB](https://github.com/lucaong/cubdb) as a pragmatic starting point—a tiny and mighty Elixir key-value store that was would get the job done. Our team has lot's of experience with Elixir so we would get good development speed by keeping the storage engine in the same languange. We knew this was not the best solution, but was one that didn't require a lot of initial investment.

### Discovering the limits

CubDb was performant enough initially and we didn't come across any bugs. We were able to get massive gains in optimizing other parts of the system before storage starting to become a concern. We [launched v1.0](/blog/2025/03/17/electricsql-1.0-released) and launched [Cloud Beta](/blog/2025/04/07/electric-cloud-public-beta-release) with it. As Electric scaled to production traffic with customers like [Trigger.dev](https://trigger.dev/) pushing [20,000 changes per second](https://x.com/triggerdotdev/status/1945876425225171173), the limitations started to emerge.

**CPU usage**: Writing to storage was taking up a massive part of our per-transaction time budget, with high CPU usage from updating the index and rewriting chunks.

**Latency**: P95 latency was too high due to CubDb slowing down significantly when handling large transactions. These heavy writes ended up blocking reads for extended periods.

**Rolling deploys:** Although it wasn’t part of our initial requirements, we discovered during the development of [Electric Cloud](https://dashboard.electric-sql.cloud/sources) that CubDb would not allow read-only mode, making zero-downtime architecturally impossible.

The challenges we encountered weren’t a result of CubDb being poorly designed, it just wasn’t tailored to meet Electric’s requirements. It became clear that we needed to step up and find a solution to these problems.

## Building our own storage engine

Following the lessons from [CockroachDB](https://www.cockroachlabs.com/) when they [replaced RocksDB with Pebble](https://www.cockroachlabs.com/blog/pebble-rocksdb-kv-store/), we chose to build our storage engine from scratch. The scope of our needs was small enough to make this feasible, and doing so allowed us to integrate it deeply with the rest of the system and tailor it to both current and future requirements. Here’s what we needed from our storage:

<figure style="margin: 1rem 0 2rem 0;">
  <img :src="StorageEngineDiagram" alt="Storage engine diagram – look-up of shape log offset" style="max-width: 100%; height: auto;" />
  <figcaption style="text-align: center; color: var(--vp-c-text-2); font-size: 0.95em;">Storage engine diagram – look-up of shape log offset</figcaption>
</figure>

**Performance**: With our initial prototype, we've learned about bottlenecks and the parts of the system that were hard to scale. Essentially, we needed fast append-only writes with low CPU usage and consistent performance either with SSD or network-attached storage, two typical environments where Electric runs.

**No data-parsing in the read-path**: We've designed electric to do all the hard work at write-time to be able to make the read-path extremely efficient. Parsing any data in the read-path is prohibitively expensive, so we want to avoid loading and parsing data as much as possible.

**Fast recovery**: We build shape log offsets based on Postgres's [LSNs](https://www.postgresql.org/docs/current/datatype-pg-lsn.html). If Electric restarts or crashes, we can discard data for incomplete transactions and resume streaming from the last acknowledged LSN from Postgres. This property lets us prioritize speed of recovery over complex crash-recovery mechanisms.

**Cloud native**: Most Electric deployments will be in the Cloud. In our Cloud, we use attached storage, which allows to very easily scale-out readers and have zero-downtime deployments.

**Observability and control**: By owning the storage engine, we gain deep visibility into its behavior and performance. This lets us optimize hot paths, resolve issues faster and respond quickly as requirements evolve.

## Implementation overview

Our new storage architecture is elegantly simple. For each shape, we maintain two files. The **shape log** that contains the raw data for the shape, and the **offset index** that contains offset pointers into the shape lof for fast look-up of requested offsets.

### Shape log

The shape log contains pre-serialized JSON lines of the shape data (the row change from Postgres's logical replication) divided into fixed-size **chunks**. Each chunk has an header that contains the offset/LSN of the first JSON line in the chunk and the current length of the chunk.

**Immutable chunks**: Once a chunk reaches it's max size it is marked as  completed and becomes immutable. We track the current content length for the chunk, so readers can safely consume the log even with active writers. Coordination is done at file-level, allowing multiple readers to consume shape logs safely in a distributed environment.

**Shape log scanning**: To find the right offset for a user request, we use the offset index to locate the chunk that contains the requested offset and then scan the chunk to find the first JSON line for the requested offset. We use  [read-ahead](https://man7.org/linux/man-pages/man2/readahead.2.html) techinique to reduce the number of syscalls while scanning the file.

**Buffering writes**: Calling [`fsync()`](https://man7.org/linux/man-pages/man2/fsync.2.html) on every write is prohibitively slow, but not calling `fsync()` immediately is giving up on durability. Any performant storage system needs to address this dilemma in some way. In Electric, we deeply integrate shape logs recovery with logical replication. If Electric crashes without some changes being flushed to disk, we can resume logical replication from the last persisted position and replay missing transactions.

### Offset index

The offset index provides fast shape random offset lookup through a sparse indexing strategy. The index is simply a list of pointers to chunk boundaries in the shape log. We add a new pointer to the sparse index for every finalized chunk.

**Finding a chunk**: When a client requests data starting from a specific offset, we do a binary search on the index to locate the appropriate chunk pointer, retrieve that chunk and scan it from there, as explained before.

**Lock-free** Because shape logs are append-only, offset pointers are always added to the end of the index. This means that the index can be read and written without any locking. For the unfinalized chuck and the last few chuncks, we actually keep the offsets in memory to avoid reading the index in the most common cases.

### Shared logs

The new architecture allows single-writer and multiple reader processes, which is ideal for Electric, since there is only one consumer of logical replication stream at a time, but can have multiple servers accessing the logs in read-only mode.

**Horizontal read scaling**: Electric is already quite scalable [behind a CDN](/blog/2024/12/10/electric-beta-release), but the new storage architecture allows multiple readers to be attached to shape logs without holding a connection to Postgres, giving us plenty of room to scale beyond anyone's needs.

**Zero-downtime deployments**: While an Electric server replaces another during a deployment, the newly started server can start serving shape request from shape logs before both servers agree to exchange the writer role. This was not possible with our previous system and critical for Electric Cloud.

## Performance evaluation

Enough talking, show me the numbers! To validate our new storage engine, we ran a series of performance tests.

### Micro-benchmarks

We conducted some microbenchmarks to evaluate the new storage engine against CubDb. Tests were run on both local SSDs (MacBook Air M4) and network-attached storage (AWS EFS attached to t2.medium instances), which are common types of storage used with Electric.

We got amazing speedups both on SSD and EFS, with up to 101x and 7x faster writes and 130x and 172x faster reads, respectively.

#### Write performance

This benchmark consists in appending a fixed number of rows to a shape log. With CubDb, every insertion needs to update the index to find the right chunk to write to. With the new engine, we simply append to the latest chunk and only modify the index when we reach the chunk size limit.

On local SSDs, the new engine achieved up to 101x faster writes when we're appending 1000 rows. These results were a bit surprising. We haven't really seen this before as appending this amount of rows to a single shape log is not very common.

With network-attached storage, where latency typically dominates, curves follow a similar profile, but now with a 5x to 7x performance improvement.

<!-- First charts pair: wrap into two-column container -->
<div class="charts-2col">
  <div class="col">
    <StorageComparisonChartColumn 
        title="Write performance - SSD"
          :data="[
            { label: '1.0.24', data: [0.32, 3.49, 167.68] },
    { label: '1.1.0', data: [0.01, 0.12, 1.65] }
  ]"
        :labels="['1 row', '20 rows', '1000 rows']"
        x-axis-title="Number of Rows"
        y-axis-title="Latency"
        y-axis-suffix=" ms"
        y-scale-type="logarithmic"
        speedup-new-label="1.1.0"
        speedup-old-label="1.0.24"
      />
  </div>
  <div class="col">
    <StorageComparisonChartColumn 
        title="Write performance - EFS"
          :data="[
            { label: '1.0.24', data: [1.4, 15.5, 712.58] },
    { label: '1.1.0', data: [0.26, 3.39, 99.29] }
  ]"
        :labels="['1 row', '20 rows', '1000 rows']"
        x-axis-title="Number of Rows"
        y-axis-title="Latency"
        y-axis-suffix=" ms"
        y-scale-type="logarithmic"
        speedup-new-label="1.1.0"
        speedup-old-label="1.0.24"
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

#### Read performance

This benchmark consists in reading a fixed number of chunks starting from an arbitrary offset in a shape log and measure the total time for retrieving all chunks.

In this case, the baseline latency for CubDb is quite high due to to the amount of syscalls to find the requested offset in the initial chunk. The new storage engine uses the read-ahead optimization to reduce the number of syscalls.

<!-- Single Reader pair -->
<div class="charts-2col">
  <div class="col">
    <StorageComparisonChartColumn 
              title="Read performance - SSD"
        :data="[
          { label: '1.0.24', data: [131.68, 154.07] },
    { label: '1.1.0', data: [2.64, 2.10] }
  ]"
      :labels="['5 chunks', '10 chunks']"
      x-axis-title="Number of Chunks"
      y-axis-title="Latency"
      y-axis-suffix=" ms"
      y-scale-type="logarithmic"
      speedup-new-label="1.1.0"
      speedup-old-label="1.0.24"
    />
  </div>
  <div class="col">
    <StorageComparisonChartColumn 
              title="Read performance - EFS"
        :data="[
          { label: '1.0.24', data: [1690.00, 2550.00] },
    { label: '1.1.0', data: [14.00, 14.80] }
  ]"
      :labels="['5 chunks', '10 chunks']"
      x-axis-title="Number of Chunks"
      y-axis-title="Latency"
      y-axis-suffix=" ms"
      y-scale-type="logarithmic"
      speedup-new-label="1.1.0"
      speedup-old-label="1.0.24"
    />
  </div>
</div>

### Electric benchmarks

The following benchmarks run the full Electric stack end‑to‑end and report application‑level latency and throughput. We use network-attached storage (AWS EFS attached to t2.medium instances). The results give a more clear picture of potential improvements in runtime.

#### Shape Creation

In this benchmarks we create more and more concurrent shapes concurrently until saturating the system. This is a fairly expensive operation as we need to query Postgres and write a new file to disk with each request.
This is a scenario we had optimized, ao CubDB still does pretty well so it performs relatively well; however, the new engine is still significantly faster overall - about 1.63x on average across the run.

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

This benchmark drives writes to arbitrary shapes and measures the end‑to‑end latency for a client to receive the data. This is the critical path for Electric: the longer writes take, the higher is the lag for consuming Postgres logical replication stream. We've gained significat speedup-~5x at 1500 shapes- and we're able to handle a lot more data before starting to saturate.

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

#### Writes fan-out (maybe exclude this one)

This experiment measures write amplification when a single transaction touches many shapes (50 or 450). It’s an extreme case for Electric — in real apps a transaction usually affects only a handful of shapes — but it’s useful to observe the worst‑case behavior in the write path.

Results show the new storage engine reduces end‑to‑end latency substantially: about ~2.4x faster at 50 shapes and ~3.8x at 450 shapes (1472 ms → 385 ms). Lower fan‑out latency here directly translates to less time holding up the Postgres replication stream and more headroom before I/O becomes the bottleneck.

<StorageComparisonChart
  title="Writes fan‑out: shapes touched per transaction"
  :data="[
    { label: '1.0.24', data: [133.33333333333334, 1472.1764705882354] },
    { label: '1.1.0', data: [54.57142857142857, 385.1] }
  ]"
  :labels="['50','450']"
  x-axis-title="Shapes per transaction"
  y-axis-title="Latency"
  y-axis-suffix=" ms"
  :columns="1"
  :height="260"
/>

#### Reads fan‑out

This benchmark measures read latency when streaming changes from one shape to a large number of connected clients. It stresses the concurrency of the read path until resources saturate. In practice, Most Electric deployments will runs behind a CDN (or an HTTP Cache) which will de-duplicate requests for the same shape. But benchmarks show that Electric can go pretty far without any caching in front of it.

Across the range, the new engine delivers consistently lower end‑to‑end latency — roughly ~3.5–4.5× faster, and about ~3.8× faster at 1,000 concurrent clients. Lower read‑path latency keeps tail recipients closer to real time and reduces pressure on buffers.

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

This journey taught us many lessons. One is that you can get massive speedups when the baseline is really unoptimized for your use-case :). The second (and more seriously) is to know when it is a good time to address performance.

Starting off with CubDb was a good choice. It got us to v1.0 with minimal issues which gave us enough space to work on shipping a piece of software that just works. During that time, we learned a great deal about how Electric behaves under real-world workloads, surfacing bottlenecks in lots of other places. Had we chosen to build our own storage system from day one, we likely would’ve made a number of incorrect assumptions and premature optimizations. Instead, our production experience gave us the insight we needed to design the right solution.

Owning this critical piece of infrastructure allows us to reason deeply about performance, rapidly diagnose issues, and optimize for our exact workloads, all within our codebase.

This isn’t a universal playbook. It worked well for us because the scope of what we had to build was relatively small and it was one our team’s core areas of expertise.

## Conclusions

We’ve taken a big step toward delivering on an ambitious promise: a sync engine that is faster than Postgres. With our new storage engine, we’ve unlocked significant performance headroom and we're laying the foundation for building a more capable sync engine.

None of this would've been possible without our incredible engineering team. Huge thanks to the Electric [team](/about/team) for their insight, code reviews, and relentless focus on making Electric better, and a special mention to **Ilia Borovitinov** who has lead the development of this project.

Ready to experience the magic of sync? [Sign up for Electric Cloud](https://electric-sql.com/cloud)—it’s free.
