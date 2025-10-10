---
title: Benchmarks - Reference
description: >-
  We run benchmarks for the Electric sync engine and the Electric Cloud,
  which hosts the sync engine behind a CDN.
image: /img/guides/diverse-shape-fanout.png
outline: [2, 4]
---

<script setup>
import ConcurrentShapeCreation from '/static/img/benchmarks/concurrent-shape-creation.png?url'
import DiverseShapeFanout from '/static/img/benchmarks/diverse-shape-fanout.png?url'
import ManyShapesOneClient from '/static/img/benchmarks/many-shapes-one-client.png?url'
import SingleShapeSingleClient from '/static/img/benchmarks/single-shape-single-client.png?url'
import WriteFanout from '/static/img/benchmarks/write-fanout.png?url'
import WriteFanoutMemory from '/static/img/benchmarks/write-fanout-memory.png?url'
import UnrelatedShapesOneClientLatency from '/static/img/benchmarks/unrelated-shapes-one-client-latency.png?url'
import ReplicationThroughputOptimised from '/static/img/benchmarks/replication-throughput-optimised.png?url'
import ReplicationThroughputNonOptimised from '/static/img/benchmarks/replication-throughput-non-optimised.png?url'
import ScalabilityChart from '../../src/components/ScalabilityChart.vue'
</script>

# Benchmarks

We run benchmarks for [cloud](#cloud), [core Electric](#electric) and [PGlite](#pglite).

## Understanding the benchmarks

Electric is designed to be simple, scalable and low-cost to run. This means that it should handle a high number of concurrent users, with high read and write workloads, corresponding to high throughput of data from Postgres out to many clients, through various shape topologies, for a variety of workloads.

Our goals are to support millions of concurrent users, hundreds of thousands of shapes and high read and write throughput from a single Electric instance, with minimal impact on the source Postgres. With low, stable and predictable compute and memory usage. In order to work towards this, we use benchmarks internally to measure and inform work to improve performance.

This page lists a selection of these benchmarks, to give you an indication of:

1. the types of benchmarks that the Electric team is running
2. the performance levels that we're seeing for our internal benchmark runs

> [!Warning] Benchmarks are always highly workload, version and hardware dependent.
> These benchmarks are **not in any way guaranteed to be representative of the performance numbers that you will see when running Electric on your own hardware**.
>
> You **must** test Electric yourself, with a representative workload, on your own infrastructure.

### Running yourself

We are in the process of open sourcing our [electric-sql/benchmarking-fleet](https://github.com/electric-sql/benchmarking-fleet) repo. When public, you will be able to follow the instructions there to run the benchmarks yourself.

### Continuous integration

We are working to set up benchmarks to run on every release (patch, minor and major). When this is done, we will document how to see the release benchmarks and how to track improvements and/or regression in performance.

## Cloud

Electric is designed to run behind a CDN, using the CDN's [request collapsing](/docs/api/http#request-collapsing) capability to scale out data delivery to lots of concurrent users.

The graph below shows the latency and compute resource of a single Electric server using this technique to handle between 100k and 1 million concurrent users, with a write workload of 960 transactions per minute:

<figure>
  <ScalabilityChart />
</figure>

These statistics were generated using our [client load benchmarking](https://github.com/electric-sql/client-load-benchmarking) suite that allows for measuring (a) client latencies and (b) sync service resource use for any combination of concurrent connected clients and database workload.

## Electric

The first two benchmarks measure a client's initial sync time:

1. [many concurrent clients syncing a small shape](#_1-many-concurrent-clients-syncing-a-small-shape)
2. [a single client syncing a large shape](#_2-a-single-client-syncing-a-large-shape)

The next four measure how long it takes for clients to recieve an update after a write:

3. [many independent shapes](#_3-many-independent-shapes)
4. [one shape with many clients](#_4-one-shape-with-many-clients)
5. [many overlapping shapes, each with a single client](#_5-many-overlapping-shapes-each-with-a-single-client)
6. [many overlapping shapes, one client](#_6-many-overlapping-shapes-one-client)

The last two benchmarks measure how long it takes Electric to process a write:

7. [write throughput with optimised where clauses](#_7-write-throughput-with-optimised-where-clauses)
8. [write throughput with non-optimised where clauses](#_8-write-throughput-with-non-optimised-where-clauses)

### Initial sync

#### 1. Many concurrent clients syncing a small shape

<figure>
  <a :href="ConcurrentShapeCreation">
    <img :src="ConcurrentShapeCreation"
        alt="Benchmark measuring many concurrent clients syncing a small shape"
    />
  </a>
</figure>

This measures the memory use and the time to sync all the data into all the clients for an increasing number of concurrent clients performing
an initial sync of a 500 row single shape. The results show stable memory use with time to sync all data rising roughly linearly up to 2,000 concurrent clients.

#### 2. A single client syncing a large shape

<figure>
  <a :href="SingleShapeSingleClient">
    <img :src="SingleShapeSingleClient"
        alt="Benchmark measuring a single client syncing an increasingly large shape"
    />
  </a>
</figure>

This measures a single client syncing a single large shape of up-to 1M rows. The sync time is linear, the memory is stable.

### Live updates

#### 3. Many independent shapes

<figure>
  <a :href="UnrelatedShapesOneClientLatency">
    <img :src="UnrelatedShapesOneClientLatency"
        alt="Benchmark measuring how long a write that affects a single shape takes to reach a client"
    />
  </a>
</figure>

This benchmark evaluates the time it takes for a write operation to reach a client subscribed to the relevant shape. On the x-axis, the number of active shapes is shown.
Each shape in this benchmark is independent, ensuring that a write operation affects only one shape at a time.

The two graphs differ based on the type of where clause used for the shapes:
- **Top Graph:** The where clause is in the form `field = constant`, where each shape is assigned a unique constant. These types of where clause, along with
  [other patterns](/docs/guides/shapes#optimised-where-clauses),
  are optimised for high performance regardless of the number of shapes — analogous to having an index on the field. As shown in the graph, the latency remains consistently
  flat at 6ms as the number of shapes increases. This 6ms latency includes 3ms for PostgreSQL to process the write operation and 3ms for Electric to propagate it.
  We are actively working to optimise additional where clause types in the future.
- **Bottom Graph:** The where clause is in the form `field ILIKE constant`, an example of a non-optimised query type.
  In this case, the latency increases linearly with the number of shapes because Electric must evaluate each shape individually to determine if it is affected by the write.
  Despite this, the response times remain low, a tenth of a second for 10,000 shapes.

#### 4. One shape with many clients

<figure>
  <a :href="WriteFanout">
    <img :src="WriteFanout"
        alt="Benchmark measuring write fanout into to one shape with many clients"
    />
  </a>
</figure>

Measures write latency (i.e.: time for the client to see the write) for a transaction of increasing size written to one shape log, streamed to an increasing number of clients.

Below is the memory use for the same benchmark.

<figure>
  <a :href="WriteFanoutMemory">
    <img :src="WriteFanoutMemory"
        alt="Benchmark measuring memory use for write fanout into one shape with many clients"
    />
  </a>
</figure>

#### 5. Many overlapping shapes, each with a single client

<figure>
  <a :href="DiverseShapeFanout">
    <img :src="DiverseShapeFanout"
        alt="Benchmark measuring write fanout into many shapes, each with a single client"
    />
  </a>
</figure>

In this benchmark there are a varying number of shapes with each shape having a single client subscribed to it. It shows the average length of time it takes for a single write that affects all the shapes to reach each client.

Latency and memory use rises linearly.

#### 6. Many overlapping shapes, one client

<figure>
  <a :href="ManyShapesOneClient">
    <img :src="ManyShapesOneClient"
        alt="Benchmark measuring write fanout into many shapes, all streamed to the same client"
    />
  </a>
</figure>

In this benchmark there are a varying number of shapes with just one client subscribed to one of the shapes. It shows the length of time it takes for a single write that affects all the shapes to reach the client.

Latency and peak memory use rises linearly. Average memory use is flat.

#### 7. Write throughput with optimised where clauses

<figure>
  <a :href="ReplicationThroughputOptimised">
    <img :src="ReplicationThroughputOptimised"
        alt="Benchmark measuring how many writes per second Electric can process"
    />
  </a>
</figure>

This benchmark measures how long each write takes to process with a varying number of shapes. Each shape in this benchmark
is using an optimised where clause, specifically `field = constant`.

> [!Tip] Optimised where clauses
> When you create a shape, you can specify a where clause that filters the rows that the shape is interested in.
> In Electric, we filter the changes we receive from Postgres so that each shape only receives changes that affect the rows it is interested in.
> If there are lots of shapes, this could mean we have to evaluate lots of where clauses for each write, however we have optimised this process
> so that we can evaluate millions of where clauses at once, providing the where clauses follow various patterns, which we call optimised where clauses.
> `field = constant` is one of the patterns we optimise, we can evaluate millions of these where clauses at once by indexing the shapes based on the constant
> value for each shape. This index is internal to Electric, and nothing to do with Postgres indexes. It's a hashmap if you're interested.
> `field = const AND another_condition` is another pattern we optimise. We aim to optimise a large subset of Postgres where clauses in the future.
> Optimised where clauses mean that we can process writes in a quarter of a millisecond, regardless of how many shapes there are.
>
> For more information on optimised where clauses, see the [shape API](/docs/guides/shapes#optimised-where-clauses).

The top graph shows throughput for Postgres 14, the bottom graph for Postgres 15.

The green line shows how fast we process writes that affect shapes. You can see in both graphs that throughput is flat at 0.17-0.27 milliseconds per change
(4000 - 6000 row changes per second) regardless of how many shapes there are.

The purple line shows how fast we ignore writes that don't affect any shapes. For Postgres 14 (top graph) this is flat at 0.02 milliseconds per change (50,000 row changes per second).For Postgres 15 (bottom graph) the throughput scales linearly with the number of shapes. This is because Postgres 15 has the ability to filter the replication stream based on a
where clause, so we use this to filter out writes that don't affect any shapes. However as you can see in the graph, in this situation this is not a good optimisation!
We're working on improving this, but at the moment it's kept as it's beneficial when using non-optimised where clauses (see benchmark 8).

#### 8. Write throughput with non-optimised where clauses

<figure>
  <a :href="ReplicationThroughputNonOptimised">
    <img :src="ReplicationThroughputNonOptimised"
        alt="Benchmark measuring how many writes per second Electric can process"
    />
  </a>
</figure>

This benchmark also measures how long each write takes to process with a varying number of shapes, but in this benchmark each shape
is using an non-optimised where clause, specifically `field ILIKE constant`. You can see in both graphs that throughput scales linearly with the number of shapes.
This is because, for non-optimised where clauses, Electric has to evaluate each shape individually to determine if it is affected by the write.

The top graph shows throughput for Postgres 14. You can see throughput is the roughly the same regardless of whether the write affects shapes (green) or not (purple),
140k row changes per second per shape.

The bottom graph shows throughput for Postgres 15. Postgres 15 has the ability to filter the replication stream based on a where clause,
so we use this to filter out writes that don't affect any shapes. So for writes that affect shapes, we get the same  140k row changes per second per shape as Postgres 14,
but for writes that don't affect shapes, we get 1400k row changes per second per shape.

## PGlite

PGlite benchmarks are documented at [pglite.dev/benchmarks](https://pglite.dev/benchmarks).
