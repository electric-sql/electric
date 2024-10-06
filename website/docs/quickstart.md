---
title: Quickstart
description: >-
  Get up-and-running with Electric and real-time sync of your Postgres data.
outline: 2
---

# Quickstart

Let's get you up-and-running with Electric and real-time sync of your Postgres data.

First we'll setup Electric and show you how to use the low-level HTTP API directly. Then we'll create a simple React app using our higher-level TypeScript client.

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

In a new terminal, use `curl` to request a [Shape](/docs/guides/shapes) containing all rows in the `foo` table:

```sh
curl -i 'http://localhost:3000/v1/shape/foo?offset=-1'
```

::: info A bit of explanation about the URL structure.

- `/v1/shape/` is a standard prefix with the API version and the shape sync endpoint path
- `foo` is the name of the [`root_table`](/docs/guides/shapes#root-table) of the shape (and is required); if you wanted to sync data from the `items` table, you would change the path to `/v1/shape/items`
- `offset=-1` means we're asking for the *entire* Shape as we don't have any of the data cached locally yet. If we had previously fetched the shape and wanted to see if there were any updates, we'd set the offset to the last offset we'd already seen.
:::

You should get a response like this:

```http
HTTP/1.1 400 Bad Request
date: Thu, 18 Jul 2024 10:36:01 GMT
content-length: 34
vary: accept-encoding
cache-control: max-age=0, private, must-revalidate
x-request-id: F-NISWIE1CJTnIgAAADQ
access-control-allow-origin: *
access-control-expose-headers: *
access-control-allow-methods: GET, POST, OPTIONS
content-type: application/json; charset=utf-8

{"root_table":["table not found"]}
```

So it didn't work! Which makes sense... as it's an empty database without any tables or data. Let's fix that.

### Create a table and insert some data

Use a Postgres client to connect to Postgres. For example, with [psql](https://www.postgresql.org/docs/current/app-psql.html) you can run:

```sh
psql "postgresql://postgres:password@localhost:54321/electric"
```

Then create a `foo` table

```sql
CREATE TABLE foo (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  value FLOAT
);
```

And insert some rows:

```sql
INSERT INTO foo (name, value) VALUES
  ('Alice', 3.14),
  ('Bob', 2.71),
  ('Charlie', -1.618),
  ('David', 1.414),
  ('Eve', 0);
```

#### Now try the curl command again

Exit your Postgres client (e.g.: with `psql` enter `\q`) and try the `curl` request again:

```sh
curl -i 'http://localhost:3000/v1/shape/foo?offset=-1'
```

Success! You should see the data you just put into Postgres in the shape response:

```bash
HTTP/1.1 200 OK
date: Thu, 18 Jul 2024 10:49:12 GMT
content-length: 643
vary: accept-encoding
cache-control: max-age=60, stale-while-revalidate=300
x-request-id: F-NJAXyulHAQP2MAAABN
access-control-allow-origin: *
access-control-expose-headers: *
access-control-allow-methods: GET, POST, OPTIONS
content-type: application/json; charset=utf-8
x-electric-shape-id: 3833821-1721299734314
x-electric-chunk-last-offset: 0_0
x-electric-schema: {"id":{"type":"int4","pk_index":0},"name":{"type":"varchar","max_length":255},"value":{"type":"float8"}}
etag: 3833821-1721299734314:-1:0_0

[{"offset":"0_0","value":{"id":"1","name":"Alice","value":"3.14"},"key":"\"public\".\"foo\"/1","headers":{"operation"
:"insert"}},{"offset":"0_0","value":{"id":"2","name":"Bob","value":"2.71"},"key":"\"public\".\"foo\"/2","headers":
{"operation":"insert"}},{"offset":"0_0","value":{"id":"3","name":"Charlie","value":"-1.618"},"key":"\"public\".\"foo\
"/3","headers":{"operation":"insert"}},{"offset":"0_0","value":{"id":"4","name":"David","value":"1.414"},"key":"\"pub
lic\".\"foo\"/4","headers":{"operation":"insert"}},{"offset":"0_0","value":{"id":"5","name":"Eve","value":"0.0"},"key
":"\"public\".\"foo\"/5","headers":{"operation":"insert"}},{"headers":{"control":"up-to-date"}}]
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
    url: `http://localhost:3000/v1/shape/foo`,
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

Note that the row with id `2` has the name `"Bob"`. Go back to your Postgres client and update the name of that row. It'll instantly be synced to your component!

```sql
UPDATE foo SET name = 'James' WHERE id = 2;
```

Congratulations! You've built your first real-time, reactive Electric app!
