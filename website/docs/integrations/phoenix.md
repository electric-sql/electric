---
outline: deep
title: Phoenix - Integrations
description: >-
  How to use Electric with Phoenix.
image: /img/integrations/electric-phoenix.jpg
---

<img src="/img/integrations/phoenix.svg" class="product-icon" />

# Phoenix

[Phoenix](https://www.phoenixframework.org) is a full-stack web development framework for [Elixir](https://elixir-lang.org).

## Electric and Phoenix

Electric is [developed in Elixir](/product/electric#how-does-it-work), has a first-class [Elixir client](/docs/api/clients/elixir) and a deep Phoenix framework integration in the form of the official [Phoenix.Sync](https://hexdocs.pm/phoenix_sync) library.

<figure>
  <div style="aspect-ratio: 16/9" class="embed-container">
    <YoutubeEmbed video-id="rlzL5wnWa9o" />
  </div>
</figure>

### Phoenix.Sync

Phoenix.Sync enables real-time sync for Postgres-backed [Phoenix](https://www.phoenixframework.org/) applications. You can use it to sync data into Elixir, `LiveView` and frontend web and mobile applications.

The library integrates with `Plug` and `Phoenix.{Controller, LiveView, Router, Stream}`. It uses [ElectricSQL](https://electric-sql.com) as the core sync engine, either as an embedded application dependency, or running as an external HTTP service.

The APIs map [Ecto queries](https://hexdocs.pm/ecto/Ecto.Query.html) to [Shapes](/docs/guides/shapes).

Documentation is available at [hexdocs.pm/phoenix_sync](https://hexdocs.pm/phoenix_sync).

## Usage

There are four key APIs:

- [`Phoenix.Sync.Client.stream/2`](https://hexdocs.pm/phoenix_sync/Phoenix.Sync.Client.html#stream/2) for low level usage in Elixir
- [`Phoenix.Sync.LiveView.sync_stream/4`](https://hexdocs.pm/phoenix_sync/Phoenix.Sync.LiveView.html#sync_stream/4) to sync into a LiveView stream
- [`Phoenix.Sync.Router.sync/2`](https://hexdocs.pm/phoenix_sync/Phoenix.Sync.Router.html#sync/2) macro to expose a statically defined shape in your Router
- [`Phoenix.Sync.Controller.sync_render/3`](https://hexdocs.pm/phoenix_sync/Phoenix.Sync.Controller.html#sync_render/3) to expose dynamically constructed shapes from a Controller

### Low level usage in Elixir

Use [`Phoenix.Sync.Client.stream/2`](https://hexdocs.pm/phoenix_sync/Phoenix.Sync.Client.html#stream/2) to convert an `Ecto.Query` into an Elixir `Stream`:

```elixir
stream = Phoenix.Sync.Client.stream(Todos.Todo)

stream =
  Ecto.Query.from(t in Todos.Todo, where: t.completed == false)
  |> Phoenix.Sync.Client.stream()
```

### Sync into a LiveView stream

Swap out `Phoenix.LiveView.stream/3` for [`Phoenix.Sync.LiveView.sync_stream/4`](https://hexdocs.pm/phoenix_sync/Phoenix.Sync.LiveView.html#sync_stream/4) to automatically keep a LiveView up-to-date with the state of your Postgres database:

```elixir
defmodule MyWeb.MyLive do
  use Phoenix.LiveView
  import Phoenix.Sync.LiveView

  def mount(_params, _session, socket) do
    {:ok, sync_stream(socket, :todos, Todos.Todo)}
  end

  def handle_info({:sync, event}, socket) do
    {:noreply, sync_stream_update(socket, event)}
  end
end
```

LiveView takes care of automatically keeping the front-end up-to-date with the assigned stream. What Phoenix.Sync does is automatically keep the _stream_ up-to-date with the state of the database.

This means you can build fully end-to-end real-time multi-user applications without writing Javascript _and_ without worrying about message delivery, reconnections, cache invalidation or polling the database for changes.

### Sync shapes through your Router

Use the [`Phoenix.Sync.Router.sync/2`](https://hexdocs.pm/phoenix_sync/Phoenix.Sync.Router.html#sync/2) macro to expose statically (compile-time) defined shapes in your Router:

```elixir
defmodule MyWeb.Router do
  use Phoenix.Router
  import Phoenix.Sync.Router

  pipeline :sync do
    plug :my_auth
  end

  scope "/shapes" do
    pipe_through :sync

    sync "/todos", Todos.Todo
  end
end
```

Because the shapes are exposed through your Router, the client connects through your existing Plug middleware. This allows you to do real-time sync straight out of Postgres _without_ having to translate your auth logic into complex/fragile database rules.

### Sync dynamic shapes from a Controller

Sync shapes from any standard Controller using the [`Phoenix.Sync.Controller.sync_render/3`](https://hexdocs.pm/phoenix_sync/Phoenix.Sync.Controller.html#sync_render/3) view function:

```elixir
defmodule Phoenix.Sync.LiveViewTest.TodoController do
  use Phoenix.Controller
  import Phoenix.Sync.Controller
  import Ecto.Query, only: [from: 2]

  def show(conn, %{"done" => done} = params) do
    sync_render(conn, params, from(t in Todos.Todo, where: t.done == ^done))
  end

  def show_mine(%{assigns: %{current_user: user_id}} = conn, params) do
    sync_render(conn, params, from(t in Todos.Todo, where: t.owner_id == ^user_id))
  end
end
```

This allows you to define and personalise the shape definition at runtime using the session and request.

### Consume shapes in the frontend

You can sync _into_ any client in any language that [speaks HTTP and JSON](/docs/api/http). For example, using the Electric [Typescript client](/docs/api/clients/typescript):

```typescript
import { Shape, ShapeStream } from "@electric-sql/client";

const stream = new ShapeStream({
  url: `/shapes/todos`,
});
const shape = new Shape(stream);

// The callback runs every time the data changes.
shape.subscribe((data) => console.log(data));
```

Or binding a shape to a component using the [React bindings](/docs/integrations/react):

```tsx
import { useShape } from "@electric-sql/react";

const MyComponent = () => {
  const { data } = useShape({
    url: `shapes/todos`,
  });

  return <List todos={data} />;
};
```

See the Electric [demos](/demos) and [documentation](/docs/intro) for more client-side usage examples.

## Installation and configuration

`Phoenix.Sync` can be used in two modes:

1. `:embedded` where Electric is included as an application dependency and Phoenix.Sync consumes data internally using Elixir APIs
2. `:http` where Electric does _not_ need to be included as an application dependency and Phoenix.Sync consumes data from an external Electric service using it's [HTTP API](/docs/api/http)

### Embedded mode

In `:embedded` mode, Electric must be included an application dependency but does not expose an HTTP API (internally or externally). Messages are streamed internally between Electric and Phoenix.Sync using Elixir function APIs. The only HTTP API for sync is that exposed via your Phoenix Router using the `sync/2` macro and `sync_render/3` function.

Example config:

```elixir
# mix.exs
defp deps do
  [
    {:electric, ">= 1.0.0-beta.20"},
    {:phoenix_sync, "~> 0.3"}
  ]
end

# config/config.exs
config :phoenix_sync,
  env: config_env(),
  mode: :embedded,
  repo: MyApp.Repo

# application.ex
children = [
  MyApp.Repo,
  # ...
  {MyApp.Endpoint, phoenix_sync: Phoenix.Sync.plug_opts()}
]
```

### HTTP

In `:http` mode, Electric does not need to be included as an application dependency. Instead, Phoenix.Sync consumes data from an external Electric service over HTTP.

```elixir
# mix.exs
defp deps do
  [
    {:phoenix_sync, "~> 0.3"}
  ]
end

# config/config.exs
config :phoenix_sync,
  env: config_env(),
  mode: :http,
  url: "https://api.electric-sql.cloud",
  credentials: [
    secret: "...",    # required
    source_id: "..."  # optional, required for Electric Cloud
  ]

# application.ex
children = [
  MyApp.Repo,
  # ...
  {MyApp.Endpoint, phoenix_sync: Phoenix.Sync.plug_opts()}
]
```

### Local HTTP services

It is also possible to include Electric as an application dependency and configure it to expose a local HTTP API that's consumed by Phoenix.Sync running in `:http` mode:

```elixir
# mix.exs
defp deps do
  [
    {:electric, ">= 1.0.0-beta.20"},
    {:phoenix_sync, "~> 0.3"}
  ]
end

# config/config.exs
config :phoenix_sync,
  env: config_env(),
  mode: :http,
  http: [
    port: 3000,
  ],
  repo: MyApp.Repo,
  url: "http://localhost:3000"

# application.ex
children = [
  MyApp.Repo,
  # ...
  {MyApp.Endpoint, phoenix_sync: Phoenix.Sync.plug_opts()}
]
```

This is less efficient than running in `:embedded` mode but may be useful for testing or when needing to run an HTTP proxy in front of Electric as part of your development stack.

### Different modes for different envs

Apps using `:http` mode in certain environments can exclude `:electric` as a dependency for that environment. The following example shows how to configure:

- `:embedded` mode in `:dev`
- `:http` mode with a local Electric service in `:test`
- `:http` mode with an external Electric service in `:prod`

With Electric only included and compiled as a dependency in `:dev` and `:test`.

```elixir
# mix.exs
defp deps do
  [
    {:electric, "~> 1.0.0-beta.20", only: [:dev, :test]},
    {:phoenix_sync, "~> 0.3"}
  ]
end

# config/dev.exs
config :phoenix_sync,
  env: config_env(),
  mode: :embedded,
  repo: MyApp.Repo

# config/test.esx
config :phoenix_sync,
  env: config_env(),
  mode: :http,
  http: [
    port: 3000,
  ],
  repo: MyApp.Repo,
  url: "http://localhost:3000"

# config/prod.exs
config :phoenix_sync,
  mode: :http,
  url: "https://api.electric-sql.cloud",
  credentials: [
    secret: "...",    # required
    source_id: "..."  # optional, required for Electric Cloud
  ]

# application.ex
children = [
  MyApp.Repo,
  # ...
  {MyApp.Endpoint, phoenix_sync: Phoenix.Sync.plug_opts()}
]
```

## Examples

The source code for Phoenix.Sync is maintained at [electric-sql/phoenix_sync](https://github.com/electric-sql/phoenix_sync). You can see various usage examples in the [test/support](https://github.com/electric-sql/phoenix_sync/tree/main/test/support) folder.

### Phoenix LiveView

The main Electric monorepo has a [Phoenix LiveView example](/demos/phoenix-liveview). This is an example Phoenix LiveView application that uses [`Electric.Phoenix.LiveView.sync_stream/4`](https://hexdocs.pm/phoenix_sync/Phoenix.Sync.LiveView.html#sync_stream/4) to sync data from Postgres into a LiveView using [Phoenix Streams](https://fly.io/phoenix-files/phoenix-dev-blog-streams/).

### Gatekeeper Auth

The [Gatekeeper auth](/demos/gatekeeper-auth) example also contains a Phoenix application that uses Plug to authorize shape access and issue shape-scoped access tokens.

### Conductor

There's also a conference demo app using Phoenix.Sync on GitHub at [thruflo/conductor](https://github.com/thruflo/conductor). This demonstrates using the LiveView, Router and Controller integrations.

## Support

There's an `#elixir` channel in the [Electric Discord](https://discord.electric-sql.com) that's a good place to ask questions.

<HelpWanted issue="1878">
  an equivalent integration for other server-side frameworks, such as Rails, Laravel, Django, etc.
</HelpWanted>

