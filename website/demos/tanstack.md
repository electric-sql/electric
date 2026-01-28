---
title: Tanstack
description: >-
  Example of an Electric app using Tanstack Query for optimistic state.
deployed_url: https://tanstack-app.examples.electric-sql.com/
source_url: https://github.com/electric-sql/electric/tree/main/examples/tanstack
image: /img/demos/items-screenshot.png
example: true
---

# {{ $frontmatter.title }}

{{ $frontmatter.description }}

<DemoCTAs :demo="$frontmatter" />

## Electric with Tanstack Query

This is an example TanStack application developed using Electric for read-path sync, together with Tanstack Query for local writes with [optimistic state](/docs/guides/writes#optimistic-state).

See the [Electric <> Tanstack integration docs](/docs/integrations/tanstack) for more context and a [video of the example running here](https://x.com/msfstef/status/1828763769498952173).

The main Electric code is in [`./src/Example.tsx`](https://github.com/electric-sql/electric/blob/main/examples/tanstack/src/Example.tsx):

<<< @../../examples/tanstack/src/Example.tsx{tsx}

<DemoCTAs :demo="$frontmatter" />
