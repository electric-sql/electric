---
title: Python client
description: >-
  Python client for Durable Streams with sync and async APIs. Generator-based stream consumption and IdempotentProducer for exactly-once writes.
outline: [2, 3]
---

# Python client

Use `durable-streams` when you want direct read and write access to Durable Streams from Python.

It gives you:

- `stream()` and `astream()` for read-only stream consumption
- `DurableStream` and `AsyncDurableStream` for read/write operations
- `IdempotentProducer` for exactly-once writes with batching and retries

<IntentLink intent="create" serviceType="streams" serviceVariant="json" />

## Install

```bash
pip install durable-streams
```

Or with `uv`:

```bash
uv add durable-streams
```

## Read from a stream

```python
from durable_streams import stream

with stream("https://streams.example.com/my-stream") as res:
    for item in res.iter_json():
        print(item)
```

The synchronous API is a good fit for scripts, workers, and services that want generator-based consumption with minimal overhead.

## Async reading

```python
from durable_streams import astream

async with astream("https://streams.example.com/my-stream") as res:
    async for item in res.iter_json():
        print(item)
```

Use `astream()` when you want the same streaming model in an async application.

## Create and append

```python
from durable_streams import DurableStream

handle = DurableStream.create(
    "https://streams.example.com/my-stream",
    content_type="application/json",
    ttl_seconds=3600,
)

handle.append({"message": "hello"})
handle.append({"message": "world"})

with handle.stream() as res:
    for item in res.iter_json():
        print(item)
```

## Exactly-once writes

For reliable, high-throughput writes with exactly-once semantics, use `IdempotentProducer`:

```python
import asyncio
import json
from durable_streams import AsyncDurableStream, IdempotentProducer

async def main():
    stream = await AsyncDurableStream.create(
        "https://streams.example.com/events",
        content_type="application/json",
    )

    producer = IdempotentProducer(
        stream,
        producer_id="event-processor-1",
        auto_claim=True,
        linger_ms=5,
        max_batch_bytes=65536,
        on_error=lambda err: print(f"Batch failed: {err}"),
    )

    events = [{"type": "click", "x": 100}, {"type": "scroll", "y": 200}]
    for event in events:
        producer.append_nowait(json.dumps(event))

    await producer.flush()
    await producer.close()

asyncio.run(main())
```

## Key features

- Sync and async APIs with context-manager support
- Generator-based streaming for memory-efficient reads
- `iter_json()` and custom `decode=` hooks for structured payloads
- `IdempotentProducer` with `append_nowait()` for fire-and-forget batched writes
- Support for long-poll and SSE live modes

## More

- [Python client README](https://github.com/durable-streams/durable-streams/blob/main/packages/client-py/README.md)
- [JSON mode](../json-mode) for structured message streams
- [Other clients](other) for the rest of the official client libraries
