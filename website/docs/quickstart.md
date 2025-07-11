---
title: Quickstart
description: >-
  Get up-and-running with Electric and real-time sync of your Postgres data.
outline: 2
---

<p class="intro-zap-container">
  <img src="/img/home/zap-with-halo.svg"
      alt="Electric zap with halo"
      class="intro-zap"
  />
</p>

# Quickstart

Let's get you up-and-running with Electric and start syncing data out of Postgres in real-time.

First we'll setup Electric and show you how to use the low-level [HTTP API](/docs/api/http) directly. Then we'll create a simple React app using our higher-level [React hooks](/docs/integrations/react#useshape).

## Setup

We're going to run a fresh Postgres and Electric using [Docker Compose](https://docs.docker.com/compose). First create a new folder to work in:

```sh
mkdir my-first-electric
cd my-first-electric
```

Then download and run this [docker-compose.yaml](https://github.com/electric-sql/electric/blob/main/website/public/docker-compose.yaml) file:

```sh
curl -O https://electric-sql.com/docker-compose.yaml
docker compose up
```

You can now start using Electric!

## HTTP API

First let's try the low-level [HTTP API](/docs/api/http).

In a new terminal, use `curl` to request a [Shape](/docs/guides/shapes) containing all rows in the `scores` table:

```sh
curl -i 'http://localhost:3000/v1/shape?table=scores&offset=-1'
```

::: info A bit of explanation about the URL structure.

- `/v1/shape` is a standard prefix with the API version and the shape sync endpoint path
- `scores` is the name of the [`table`](/docs/guides/shapes#table) of the shape (and is required); if you wanted to sync data from the `items` table, you would change the path to `/v1/shape?table=items`
- `offset=-1` means we're asking for the *entire* Shape as we don't have any of the data cached locally yet. If we had previously fetched the shape and wanted to see if there were any updates, we'd set the offset to the last offset we'd already seen.
:::

The `docker-compose.yaml` file includes an initialization script that automatically creates a `scores` table and populates it with sample data when the database starts up. This means you can immediately start querying the data without manual setup.

You should see the sample data in the shape response:

```bash
HTTP/1.1 200 OK
transfer-encoding: chunked
date: Wed, 09 Apr 2025 20:07:01 GMT
cache-control: public, max-age=604800, s-maxage=3600, stale-while-revalidate=2629746
x-request-id: GDS_PHZhjLuApVQAAAEB
electric-server: ElectricSQL/1.0.4
access-control-allow-origin: *
access-control-expose-headers: *
access-control-allow-methods: GET, HEAD, DELETE, OPTIONS
content-type: application/json; charset=utf-8
etag: "64351139-1744229222132:-1:0_0"
electric-handle: 64351139-1744229222132
electric-schema: {"id":{"type":"int4","not_null":true,"pk_index":0},"name":{"type":"varchar","max_length":255},"value":{"type":"float8"}}
electric-offset: 0_0

[{"key":"\"public\".\"scores\"/\"1\"","value":{"id":"1","name":"Alice","value":"3.14"},"headers":{"operation":"insert","relation":["public","scores"]}}
,{"key":"\"public\".\"scores\"/\"2\"","value":{"id":"2","name":"Bob","value":"2.71"},"headers":{"operation":"insert","relation":["public","scores"]}}
,{"key":"\"public\".\"scores\"/\"3\"","value":{"id":"3","name":"Charlie","value":"-1.618"},"headers":{"operation":"insert","relation":["public","scores"]}}
,{"key":"\"public\".\"scores\"/\"4\"","value":{"id":"4","name":"David","value":"1.414"},"headers":{"operation":"insert","relation":["public","scores"]}}
,{"key":"\"public\".\"scores\"/\"5\"","value":{"id":"5","name":"Eve","value":"0"},"headers":{"operation":"insert","relation":["public","scores"]}}
]
```

::: info What are those messages in the response data?
When you request shape data using the HTTP API you're actually requesting entries from a log of database operations affecting the data in the shape. This is called the [Shape Log](/docs/api/http#shape-log).

The `offset` that you see in the messages and provide as the `?offset=...` query parameter in your request identifies a position in the log. The messages you see in the response are shape log entries (the ones with `value`s and `operation` headers) and control messages (the ones with `control` headers).
:::

At this point, you could continue to fetch data using HTTP requests. However, let's switch up to fetch the same shape to use in a React app instead.

## React app

Run the following to create a standard React app:

```sh
npm create --yes vite@latest react-app -- --template react-ts
```

Change into the `react-app` subfolder and install the `@electric-sql/react` package:

```sh
cd react-app
npm install @electric-sql/react
```

Replace the contents of `src/App.tsx` with the following. Note that we're requesting the same shape as before:

```tsx
import { useShape } from '@electric-sql/react'

function Component() {
  const { data } = useShape({
    url: `http://localhost:3000/v1/shape`,
    params: {
      table: `scores`
    }
  })

  return (
    <pre>{ JSON.stringify(data, null, 2) }</pre>
  )
}

export default Component
```

Finally run the dev server to see it all in action!

```sh
npm run dev
```

Navigate to http://localhost:5173 in your web browser. You should see output like this:

```json
[
    {
        "id": 1,
        "name": "Alice",
        "value": 3.14
    },
    {
        "id": 2,
        "name": "Bob",
        "value": 2.71
    },
    {
        "id": 3,
        "name": "Charlie",
        "value": -1.618
    },
    {
        "id": 4,
        "name": "David",
        "value": 1.414
    },
    {
        "id": 5,
        "name": "Eve",
        "value": 0
    }
]
```

#### Postgres as a real-time database

Note that the row with id `2` has the name `"Bob"`. To see real-time updates in action, connect to your Postgres database using a client like [psql](https://www.postgresql.org/docs/current/app-psql.html):

```sh
psql "postgresql://postgres:password@localhost:54321/electric"
```

Then update the name of that row. It'll instantly be synced to your component!

```sql
UPDATE scores SET name = 'James' WHERE id = 2;
```

Congratulations! You've built your first real-time, reactive Electric app!
