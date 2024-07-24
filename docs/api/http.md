---
outline: deep
---

# HTTP API

The HTTP API is the primary, low level API for syncing data with Electric Next.

Normative API documentation is published as an [OpenAPI](https://www.openapis.org/what-is-openapi) specification:

- [download the specification file](https://github.com/electric-sql/electric-next/blob/main/docs/electric-api.yaml) to view or use with other OpenAPI [tooling](https://tools.openapis.org/)
- <a href="/openapi.html" target="_blank">view the HTML documentation</a> generated using [Redocly](https://redocly.com)

The rest of this page will describe the features of the API.

<div class="tip custom-block">
  <p class="custom-block-no-title">💡 If you haven't already, walkthrough the <a href="/guides/quickstart">Quickstart</a> to get a feel for using the HTTP API.</p>
</div>

## Syncing shapes

The API allows you to sync [Shapes](/guides/shapes) of data out of Postgres using the
<a href="/openapi.html#/paths/~1v1~1shape~1{root_table}/get"
    target="_blank">
  <code>GET /v1/shape</code></a> endpoint. The pattern is as follows.

First you make an initial sync request to get the current data for the Shape, such as:

```sh
curl -i 'http://localhost:3000/v1/shape/foo?offset=-1'
```

Then you switch into a live mode to use long-polling to receive real-time updates. We'll go over these steps in more detail below. First a note on the data that the endpoint returns.

### Shape Log

When you sync a shape from Electric, you get the data in the form of a log of logical database operations. This is the **Shape Log**.

The `offset` that you see in the messages and provide as the `?offset=...` query parameter in your request identifies a position in the log. The messages you see in the response are shape log entries (the ones with `value`s and `action` headers) and control messages (the ones with `control` headers).

The Shape Log is similar conceptually to the logical replication stream from Postgres. Except that instead of getting all the database operations, you're getting the ones that affect the data in your Shape. It's then the responsibility of the client to consume the log and materialize out the current value of the shape.

<figure>
  <a href="/img/api/shape-log.jpg">
    <img srcset="/img/api/shape-log.sm.png 1064w, /img/api/shape-log.png 1396w"
        sizes="(max-width: 767px) 600px, 1396px"
        src="/img/api/shape-log.png"
        alt="Shape log flow diagramme"
    />
  </a>
  <figcaption className="figure-caption text-end">
    Shape log flow diagramme.
  </figcaption>
</figure>

### Initial sync request

When you make an initial sync request, with `offset=-1`, you're telling the server that you want the whole log, from the start for a given shape.

When a shape is first requested, Electric queries Postgres for the data and populates the log by turning the query results into insert operations. This allows you to sync shapes without having to pre-define them. Electric then streams out the log data in the response.

Sometimes a log can fit in a single response. Sometimes it's too big and requires multiple requests. In this case, the first request will return a batch of data and an `x-electric-chunk-last-offset` header. An HTTP client should then continue to make requests setting the `offset` parameter to the this header value. This allows the client to paginate through the shape log until it has recieved all the current data.

### Control messages

The client will then recieve an `up-to-date` control message at the end of the response data:

```json
{"headers": {"control": "up-to-date"}}
```

This indicates that the client has all the data that the server was aware of when fulfilling the request. The client can then switch into live mode to recieve real-time updates.

::: info Must-refetch
Note that the other control message is `must-refetch` which indicates that the client must throwaway their local shape data and re-sync from scratch:

```json
{"headers": {"control": "must-refetch"}}
```
:::

### Live mode

Once a client is up-to-date, it can switch to live mode to receive real-time updates, by making requests with `live=true`, an `offset` and a `shape_id`, e.g.:

```sh
curl -i 'http://localhost:3000/v1/shape/foo?live=true&offset=0_0&shape_id=3833821-1721812114261'
```

The `live` parameter puts the server into live mode, where it will hold open the connection, waiting for new data arrive. This allows you to implement a long-polling strategy to consume real-time updates.

The server holds open the request until either a timeout (returning `204 No content`) or when new data is available, which it sends back as the response. The client then reconnects and the server blocks again for new content. This way the client is always updated as soon as new data is available.

### Clients

The algorithm for consuming the HTTP API described above can be implemented from scratch for your application. Howerver, it's typically implemented by clients that can be re-used and provide a simpler interface for application code.

There are a number of existing clients, such as the [TypeScript](/api/clients/typescript) and [Elixir](/api/clients/elixir) clients. If one doesn't exist for your language or environment, we hope that the pattern is simple enough that you should be able to [write your own client](/guides/write-your-own-client) quite simply.
