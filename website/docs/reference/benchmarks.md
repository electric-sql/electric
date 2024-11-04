---
title: Benchmarks - Reference
outline: [2, 4]
---

<script setup>
import ConcurrentShapeCreation from '/static/img/benchmarks/concurrent-shape-creation.png?url'
import DiverseShapeFanout from '/static/img/benchmarks/diverse-shape-fanout.png?url'
import ManyShapesOneClient from '/static/img/benchmarks/many-shapes-one-client.png?url'
import SingleShapeSingleClient from '/static/img/benchmarks/single-shape-single-client.png?url'
import WriteFanout from '/static/img/benchmarks/write-fanout.png?url'
import WriteFanoutMemory from '/static/img/benchmarks/write-fanout-memory.png?url'
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

The first two benchmarks measure initial sync time (i.e.: read performance):

1. many concurrent clients syncing a small shape
2. a single client syncing a large shape

The next three measure fanout of live streaming data (i.e.: write performance:

3. into to one shape with many concurrent clients
4. into many shapes, each with a single client
5. into many shapes, all streamed to one client

### Initial sync

#### 1. Many concurrent clients syncing a small shape

<figure>
  <a :href="ConcurrentShapeCreation">
    <img :src="ConcurrentShapeCreation"
        alt="Benchmark measuring many concurrent clients syncing a small shape"
    />
  </a>
</figure>

This measures the memory use and time-to-sync-all-the-data-into-all-clients for an increasing number of concurrent clients performing an initial sync of a (500 row) single shape. The results show stable memory use with time to sync all data rising roughly linearly up-to 2,000 concurrent clients.

#### 2. A single client syncing a large shape

<figure>
  <a :href="SingleShapeSingleClient">
    <img :src="SingleShapeSingleClient"
        alt="Benchmark measuring a single client syncing an increasingly large shape"
    />
  </a>
</figure>

This measures a single client syncing a single large shape of up-to 1M rows. The sync time is linear, the memory is stable.

### Write fanout

#### 3. One shape with many clients

<figure>
  <a :href="WriteFanout">
    <img :src="WriteFanout"
        alt="Benchmark measuring write fanout into to one shape with many clients"
    />
  </a>
</figure>

Measures write latency (i.e.: time for the client to see the write) and memory use for a transaction of increasing size written to one shape log, streamed to an increasing number of clients.

<figure>
  <a :href="WriteFanoutMemory">
    <img :src="WriteFanoutMemory"
        alt="Benchmark measuring memory use for write fanout into one shape with many clients"
    />
  </a>
</figure>

#### 4. Many shapes, each with a single client

<figure>
  <a :href="DiverseShapeFanout">
    <img :src="DiverseShapeFanout"
        alt="Benchmark measuring write fanout into many shapes, each with a single client"
    />
  </a>
</figure>

Shows "diverse write fanout", where we do a single write into many shapes that each have a single client listening to them (and the write is seen by all shapes).

Latency rises linearly. Memory usage is relatively flat.

#### 5. Many shapes, streamed to one client

<figure>
  <a :href="ManyShapesOneClient">
    <img :src="ManyShapesOneClient"
        alt="Benchmark measuring write fanout into many shapes, all streamed to the same client"
    />
  </a>
</figure>

Similar to the diverse write fanout, but with many shapes the write falls into, only one is  actively listened to.

## Cloud <Badge type="warning" text="coming soon" />

Cloud benchmarks test the performance and scalability of Electric when running behind a CDN.

We will post them here when available.

## PGlite

PGlite benchmarks are documented at [pglite.dev/benchmarks](https://pglite.dev/benchmarks).
