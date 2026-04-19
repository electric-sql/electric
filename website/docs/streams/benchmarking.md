---
title: Benchmarking
description: >-
  Benchmarks package to measure server performance. Use it to validate that your server meets performance expectations or to compare configurations.
outline: [2, 3]
---

# Benchmarking

The `@durable-streams/benchmarks` package measures server performance -- latency overhead and message throughput. Use it to validate that your server meets performance expectations or to compare configurations.

## Installation

```bash
npm install @durable-streams/benchmarks
```

## Usage

The benchmarks run against a live server via the programmatic API:

```typescript
import { runBenchmarks } from "@durable-streams/benchmarks"

runBenchmarks({
  baseUrl: "http://localhost:4437",
  environment: "local",
})
```

Results are printed to the console and written to `benchmark-results.json` in the current directory.

## What's measured

### Latency

- **Baseline ping** -- raw network latency (HEAD request)
- **Round-trip time** -- append a 100-byte message and receive it via long-poll
- **Overhead** -- round-trip time minus baseline ping (protocol overhead)

Target: < 10ms overhead per round-trip.

### Message throughput

- **Small messages** -- 1,000 messages of 100 bytes each, batched with concurrency
- **Large messages** -- 50 messages of 1MB each

Target: 100+ messages/second for small messages.

## Output

Each metric reports min, max, mean, p50, p75, and p99 values. The JSON output includes all statistics:

```json
{
  "environment": "local",
  "baseUrl": "http://localhost:4437",
  "timestamp": "2026-02-18T10:30:00Z",
  "results": {
    "Baseline Ping": {
      "min": 0.5,
      "max": 1.2,
      "mean": 0.7,
      "p50": 0.6,
      "unit": "ms"
    },
    "Latency - Total RTT": {
      "min": 2.1,
      "max": 5.3,
      "mean": 3.2,
      "p50": 3.0,
      "unit": "ms"
    },
    "Throughput - Small Messages": {
      "min": 450,
      "max": 620,
      "mean": 530,
      "p50": 520,
      "unit": "msg/sec"
    }
  }
}
```

---

See also: [Building a server](building-a-server) | [Deployment](deployment)
