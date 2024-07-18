---
outline: deep
---

# Elixir Client

The Elixir client is being developed in [electric-sql/electric-next/pull/38](https://github.com/electric-sql/electric-next/pull/38). At the moment it provides a GenStage producer that can be used to stream a Shape as per:

```elixir
opts = [
  base_url: "http://...",
  shape_definition: %Electric.Client.ShapeDefinition{
    table: "..."
  }
]

{:ok, pid, stream} = Electric.Client.ShapeStream.stream(opts)

stream
|> Stream.each(&IO.inspect/1)
|> Stream.run()
```

See the [shape_stream_test.exs](https://github.com/electric-sql/electric-next/blob/thruflo/elixir-client/elixir_client/test/electric/client/shape_stream_test.exs) for more details.

