# Elixir Phoenix Example Application

Shows an example of using [Electric's Postgresql sync
engine](https://electric-sql.com/) to maintain identical across multiple
browser windows.

Instead of subscribing to an internal Phoenix pub-sub system, each LiveView
instance instead subscribes to the same [Electric
Shape](https://electric-sql.com/docs/guides/shapes) using
[`Electric.Phoenix.live_stream/4`](https://hexdocs.pm/electric_phoenix/Electric.Phoenix.html#live_stream/4).

Because of this, updates to the database from any client are synced immediately
to all other connected clients without any extra work by the developer.

## Getting started

To start your Phoenix server:

- Run `mix electric.start` to start an Electric instance and associated Postgres DB.
- Run `mix setup` to install and setup dependencies
- Start Phoenix endpoint with `mix phx.server` or inside IEx with `iex -S mix phx.server`

Now you can visit [`localhost:4000`](http://localhost:4000) from your browser.

If you open two separate windows, you will see you changes happen
simultaneously in both windows.

## Implementation

See the [`Electric.PhoenixExampleWeb.TodoLive.Index`
module](./lib/electric_phoenix_example_web/live/todo_live/index.ex) and the
[`Electric.Phoenix` documentation](https://hexdocs.pm/electric_phoenix/).
