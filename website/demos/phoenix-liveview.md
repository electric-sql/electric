---
title: Phoenix LiveView
description: >-
  Example of a Phoenix LiveView app using Electric.
deployed_url: https://phoenix-liveview.examples.electric-sql.com
source_url: https://github.com/electric-sql/electric/tree/main/examples/phoenix-liveview
example: true
---

# {{ $frontmatter.title }}

{{ $frontmatter.description }}

<DemoCTAs :demo="$frontmatter" />

## Syncing into Phoenix LiveView using Electric

This is an example app using our [`Electric.Phoenix`](/docs/integrations/phoenix) integration library.

It uses Electric for read-path sync into a LiveView using [`electric_stream/4`](https://hexdocs.pm/electric_phoenix/Electric.Phoenix.LiveView.html#electric_stream/4) and standard Phoenix APIs for writes. This keeps the LiveView automatically in-sync with Postgres, without having to re-run queries or trigger any change handling yourself.

See e.g.: [`lib/electric_phoenix_example_web/live/todo_live/index.ex`](https://github.com/electric-sql/electric/blog/main/examples/phoenix-liveview/lib/electric_phoenix_example_web/live/todo_live/index.ex):

<<< @../../examples/phoenix-liveview/lib/electric_phoenix_example_web/live/todo_live/index.ex{elixir}

<DemoCTAs :demo="$frontmatter" />
