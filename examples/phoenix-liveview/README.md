# Elixir Phoenix Example Application

This is an example Phoenix LiveView application that uses
[`Electric.Phoenix.LiveView.electric_stream/4`](https://hexdocs.pm/electric_phoenix/Electric.Phoenix.LiveView.html#electric_stream/4)
to sync data from Postgres into a LiveView using
[Phoenix Streams](https://fly.io/phoenix-files/phoenix-dev-blog-streams/).
This keeps the LiveView automatically in-sync with Postgres, without having
to re-run queries or trigger any change handling yourself.

See the
[documentation](https://electric-sql.com/docs/integrations/phoenix#liveview-sync)
for more details.

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
