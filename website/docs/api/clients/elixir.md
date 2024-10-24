---
outline: deep
---

# Elixir Client

We [maintain an Elixir
client](https://github.com/electric-sql/electric/tree/main/packages/elixir-client)
that will stream messages from an Electric server.

## Install

You can install it from [Hex](https://hex.pm/electric_client).

## How to use

The client exposes a
[`stream/3`](https://hexdocs.pm/electric_client/Electric.Client.html#stream/3)
function that returns an
[`Enumerable`](https://hexdocs.pm/elixir/Enumerable.html).

```elixir
Mix.install([:electric_client])

{:ok, client} = Electric.Client.new(base_url: "http://localhost:3000")

stream = Electric.Client.stream(client, "my_table", where: "something = true")

stream
|> Stream.each(&IO.inspect/1)
|> Stream.run()
```

It also has an [`Ecto`](https://hexdocs.pm/ecto) integration that will generate
updates based on an `Ecto` query:

```elixir
stream = Electric.Client.stream(client, from(t in MyTable, where: t.something == true))
```

See the [client documentation](https://hexdocs.pm/electric_client) for more details.
