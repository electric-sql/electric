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
import ScalabilityChart from '../../src/components/ScalabilityChart.vue'
</script>

# Benchmarks

We run benchmarks for both the [Electric sync engine](#electric) directly, and the [Electric Cloud](#cloud), which hosts the sync engine behind a CDN.

[PGlite](#pglite) publishes its own benchmarks.

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

## Electric

The first two benchmarks measure initial sync time, i.e. read performance:

1. [many concurrent clients syncing a small shape](#_1-many-concurrent-clients-syncing-a-small-shape)
2. [a single client syncing a large shape](#_2-a-single-client-syncing-a-large-shape)

The next four measure live update time, i.e. write performance:

3. [many disjoint shapes](#_3-many-disjoint-shapes)
4. [one shape with many clients](#_4-one-shape-with-many-clients)
5. [many overlapping shapes, each with a single client](#_5-many-overlapping-shapes-each-with-a-single-client)
6. [many overlapping shapes, one client](#_6-many-overlapping-shapes-one-client)

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

#### 3. Many disjoint shapes

<figure>
  <a :href="UnrelatedShapesOneClientLatency">
    <img :src="UnrelatedShapesOneClientLatency"
        alt="Benchmark measuring how long a write that affects a single shape takes to reach a client"
    />
  </a>
</figure>

This benchmark evaluates the time it takes for a write operation to reach a client subscribed to the relevant shape. On the x-axis, the number of active shapes is shown.
Each shape in this benchmark is independent, ensuring that a write operation affects only one shape at a time.

The two graphs differ based on the type of WHERE clause used for the shapes:
- **Top Graph:** The WHERE clause is in the form `field = constant`, where each shape is assigned a unique constant. These types of WHERE clause, along with similar patterns,
  are optimised for high performance regardless of the number of shapes — analogous to having an index on the field. As shown in the graph, the latency remains consistently
  flat at 6ms as the number of shapes increases. This 6ms latency includes 3ms for PostgreSQL to process the write operation and 3ms for Electric to propagate it.
  We are actively working to optimise additional WHERE clause types in the future.
- **Bottom Graph:** The WHERE clause is in the form `field LIKE constant`, an example of a non-optimised query type.
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

## Cloud

Electric is designed to run behind a CDN, using the CDN's [request collapsing](/docs/api/http#request-collapsing) capability to scale out data delivery to lots of concurrent users.

The graph below shows the latency and compute resource of a single Electric server using this technique to handle between 100k and 1 million concurrent users, with a write workload of 960 transactions per minute:

<figure>
  <ScalabilityChart />
</figure>

These statistics were generated using our [client load benchmarking](https://github.com/electric-sql/client-load-benchmarking) suite that allows for measuring (a) client latencies and (b) sync service resource use for any combination of concurrent connected clients and database workload.

## PGlite

PGlite benchmarks are documented at [pglite.dev/benchmarks](https://pglite.dev/benchmarks).
