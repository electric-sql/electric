---
title: Writing your own client - Guide
description: >-
  How to write your own client for the Electric sync service.
outline: [2, 4]
---

# Writing your own client

How to write a client for Electric.

## For any language that speaks HTTP and JSON

Electric is designed to be (relatively!) simple to create a client for, in any language that speaks HTTP and JSON.

The high level scope is to:

1. implement a long-polling strategy to [consume the HTTP API](#consume-the-http-api)
2. (optionally) [materialise the shape log](#materialise-the-shape-log) into a data structure or local store
3. (optionally) [provide reactivity bindings](#reactivity-bindings)

> [!Warning] Before you start
> It's well worth looking through the source code for the existing [Typescript](https://github.com/electric-sql/electric/tree/main/packages/typescript-client) and [Elixir](https://github.com/electric-sql/electric/tree/main/packages/elixir-client) clients.
> You're also welcome to [raise an issue on GitHub](https://github.com/electric-sql/electric) and [flag up your plans on Discord](https://discord.electric-sql.com).

### Consume the HTTP API

The [Electric sync service](/product/sync) syncs data over an [HTTP API](/docs/api/http). The primary job of a client is to consume this API using HTTP requests.

There are two phases to syncing a shape:

1. [initial sync](#initial-sync) where you load all the data the server is currently aware of
2. [live mode](#live-mode) where you wait for and consume live updates in real-time

#### Initial sync

Your client needs to talk to [a running instance of Electric](./installation). In development this should be accessible on a local URL like `http://localhost:3000`.

##### Construct your shape URL

The first thing you'll then need to do is encode a [shape definition](/docs/guides/shapes#defining-shapes) into a URL that you make a `GET` request to. You can see the
<a href="/openapi.html" target="_blank">specification for the URL structure here</a>.

##### Make the initial `offset=-1` request

The first request to a shape should set the `offset` parameter to `-1`. This indicates to Electric that you want to consume all of the data from the beginning of the [Shape log](/docs/api/http#shape-log). For example, you might make a request to:

```http
GET /v1/shape/items?offset=-1
```

The body of the response will contain a JSON array of messages. The headers of the response will contain two pieces of important information:

- `electric-shape-handle` - an ephemeral identifier to an existing shape log
- `electric-offset` - the offset value for your next request

If the last message in the response body contains an `up-to-date` control message:

```json
{"headers":{"control":"up-to-date"}}
```

Then the response will also contain an (easier to parse!):

- `electric-up-to-date` header

Either of which indicate that you can [process the messages](#materialise-the-shape-log) and switch into [live mode](#live-mode). Otherwise, you should continue to accumulate messages by making additional requests to the same URL, with the new shape handle, offset and cursor. For example:

```http
GET /v1/shape/items?offset=0_0&shape_handle=38083685-1729874417404
```

In this way, you keep making GET requests with increasing offsets until you load all the data that the server is aware of, at which point you get the `up-to-date` message.

#### Live mode

... woohoo! ...






### Materialise the shape log

/docs/api/http#shape-log

### Reactivity bindings

## Example

### Pseudocode

... steps ...
