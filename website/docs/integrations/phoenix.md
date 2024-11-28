---
outline: deep
title: Phoenix - Integrations
description: >-
  How to use Electric with Phoenix.
image: /img/integrations/electric-phoenix.jpg
---

<script setup>
  import HelpWanted from '/src/components/HelpWanted.vue'
</script>

<img src="/img/integrations/phoenix.svg" class="product-icon" />

# Phoenix

[Phoenix](https://www.phoenixframework.org) is a full-stack web development framework for [Elixir](https://elixir-lang.org).

## Electric and Phoenix

Electric is [developed in Elixir](/product/electric#how-does-it-work) and provides [an Elixir client](/docs/api/clients/elixir). We've leveraged this to develop a batteries-included Phoenix integration for:

- [front-end sync](#front-end-sync): into a front-end client from a Postgres-backed Phoenix application
- [LiveView sync](#liveview-sync): into Phoenix LiveView from Postgres in realtime via [Phoenix.Streams](/docs/integrations/phoenix#liveview-sync)

`Electric.Phoenix` is published on Hex as [hex.pm/packages/electric_phoenix](https://hex.pm/packages/electric_phoenix).

### Inspiration

It was inspired by [`josevalim/sync`](https://github.com/josevalim/sync). You can read José's [original design document](https://github.com/josevalim/sync/blob/main/DESIGN.md).

## How to use

### Front-end sync

Phoenix is a general framework that provides a number of different methods to get data from the server to the client. These include exposing [REST APIs](https://hexdocs.pm/phoenix/routing.html#resources) and using [Absinthe](https://hexdocs.pm/absinthe/overview.html) to expose a GraphQL endpoint.

`Electric.Phoenix` provides an alternative method: exposing [Shapes](/docs/guides/shapes) that sync data directly from Postgres into the client. With this, shapes are exposed and configured in your Phoenix Router. For example, here we expose a predefined shape of all visible todos, deriving the shape definition from an Ecto query using your existing data model:

```elixir
defmodule MyAppWeb.Router do
  use Phoenix.Router
  alias MyApp.Todos.Todo

  scope "/shapes" do
    pipe_through :browser

    get "/todos", Electric.Phoenix.Plug,
      shape: Electric.Client.shape!(Todo, where: "visible = true")
  end
end
```

Because the shape is defined in your Router, it can use Plug middleware for authorization. See [Parameter-based shapes](https://hexdocs.pm/electric_phoenix/Electric.Phoenix.Plug.html#module-parameter-based-shapes) for more details.

### LiveView sync

[Phoenix LiveView](https://hexdocs.pm/phoenix_live_view) allows you to develop interactive web applications in Elixir/Phoenix, often without writing any front-end code.

LiveView provides a primitive, called [Phoenix.Streams](https://fly.io/phoenix-files/phoenix-dev-blog-streams) that allows you to stream data into a LiveView. `Electric.Phoenix` provides a wrapper around this to automatically stream a [Shape](/docs/guides/shapes) into a LiveView.

The key primitive is an [`electric_stream/4`](https://hexdocs.pm/electric_phoenix/Electric.Phoenix.LiveView.html#electric_stream/4) function that wraps [`Phoenix.LiveView.stream/4`](https://hexdocs.pm/phoenix_live_view/Phoenix.LiveView.html#stream/4) to provide a live updating collection of items.

```elixir
def mount(_params, _session, socket) do
  socket =
    Electric.Phoenix.LiveView.electric_stream(
      socket,
      :visible_todos,
      from(t in Todo, where: t.visible == true)
    )

  {:ok, socket}
end
```

This makes your LiveView applications real-time. In fact, it allows you to build interactive, real-time multi-user applications straight out of your existing Ecto schema, without writing any JavaScript at all 🤯

### More details

For more details and full documentation see [hexdocs.pm/electric_phoenix](https://hexdocs.pm/electric_phoenix).

## Examples

### Phoenix LiveView

See the
[phoenix-liveview example](https://github.com/electric-sql/electric/tree/main/examples/phoenix-liveview)
on GitHub.

This is an example Phoenix LiveView application that uses
[`Electric.Phoenix.LiveView.electric_stream/4`](https://hexdocs.pm/electric_phoenix/Electric.Phoenix.LiveView.html#electric_stream/4)
to sync data from Postgres into a LiveView using
[Phoenix Streams](https://fly.io/phoenix-files/phoenix-dev-blog-streams/).
This keeps the LiveView automatically in-sync with Postgres, without having
to re-run queries or trigger any change handling yourself.

See the
[documentation](https://electric-sql.com/docs/integrations/phoenix#liveview-sync)
for more details.

### Gatekeeper Auth

The
[gatekeeper-auth](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth)
example also contains a Phoenix application that uses
[`Electric.Phoenix.Plug`](https://hexdocs.pm/electric_phoenix/Electric.Phoenix.Plug.html)
to authorize shape access and issue shape-scoped access tokens.

<HelpWanted issue="1878">
  an equivalent integration for other server-side frameworks, such as Rails, Laravel, Django, etc.
</HelpWanted>
