---
title: HTTP API
description: >-
  The HTTP API is the primary, low level API for syncing data with Electric.
outline: deep
layout: false
---

# HTTP API

The HTTP API is the primary, low level API for syncing data with Electric.

Normative API documentation is published as an [OpenAPI](https://www.openapis.org/what-is-openapi) specification:

- [download the specification file](https://github.com/electric-sql/electric/blob/main/website/electric-api.yaml) to view or use with other OpenAPI [tooling](https://tools.openapis.org/)
- <a href="/openapi.html" target="_blank">view the HTML documentation</a> generated using [Redocly](https://redocly.com)

The rest of this page will describe the features of the API.

<div class="tip custom-block">
  <p class="custom-block-no-title">💡 If you haven't already, you may like to walkthrough the <a href="/docs/quickstart">Quickstart</a> to get a feel for using the HTTP API.</p>
</div>

## Syncing shapes

The API allows you to sync [Shapes](/docs/guides/shapes) of data out of Postgres using the
<a href="/openapi.html#/paths/~1v1~1shape~1%7Broot_table%7D/get"
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

The Shape Log is similar conceptually to the logical replication stream from Postgres. Except that instead of getting all the database operations, you're getting the ones that affect the data in your Shape. It's then the responsibility of the client to consume the log and materialize out the current value of the shape. The values included in the shape log are strings formatted according to Postgres' display settings. The [OpenAPI](https://www.openapis.org/what-is-openapi) specification defines the display settings the HTTP API adheres to.
