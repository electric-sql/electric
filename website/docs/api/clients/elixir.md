---
title: Elixir Client
description: >-
  Electric provides an Elixir client and a Phoenix integration.
image: /img/integrations/electric-phoenix.jpg
outline: deep
---

# Elixir client

Electric provides an [Elixir client](#how-to-use) that wraps the [HTTP API](/docs/api/http) into a higher-level stream interface and a [Phoenix integration](#phoenix-integration) that adds sync to your Phoenix application.

## How to use

The [`Electric.Client`](https://hex.pm/packages/electric_client) library allows you to stream [Shapes](/docs/guides/shapes) into your Elixir application. It's published to Hex as the [`electric_client`](https://hex.pm/packages/electric_client) package.

### Stream

The client exposes a [`stream/3`](https://hexdocs.pm/electric_client/Electric.Client.html#stream/3) that streams a [Shape Log](/docs/api/http#shape-log) into an [`Enumerable`](https://hexdocs.pm/elixir/Enumerable.html):

```elixir
Mix.install([:electric_client])

{:ok, client} = Electric.Client.new(base_url: "http://localhost:3000")

stream = Electric.Client.stream(client, "my_table", where: "something = true")

stream
|> Stream.each(&IO.inspect/1)
|> Stream.run()
```

You can materialise the shape stream into a variety of data structures. For example by matching on insert, update and delete operations and applying them to a Map or an Ecto struct. (See the [Redis example](/demos/redis) example and Typescript [Shape class](/docs/api/clients/typescript#shape) for reference).

### Ecto queries

The `stream/3` function also supports deriving the shape definition from an [`Ecto.Query`](https://hexdocs.pm/ecto/Ecto.Query.html):

```elixir
import Ecto.Query, only: [from: 2]

query = from(t in MyTable, where: t.something == true)

stream = Electric.Client.stream(client, query)
```

See the documentation at [hexdocs.pm/electric_client](https://hexdocs.pm/electric_client) for more details.

## Phoenix integration

Electric also provides an [`Electric.Phoenix`](https://hex.pm/packages/electric_phoenix) integration allows you to:

- sync data into a [front-end app](/docs/integrations/phoenix#front-end-sync) from a Postgres-backed Phoenix application; and
- add real-time streaming from Postgres into Phoenix LiveView via [Phoenix.Streams](/docs/integrations/phoenix#liveview-sync)

See the [Phoenix framework integration page](/docs/integrations/phoenix) for more details.
