---
title: Remix
description: >-
  Example of an Electric app using Remix.
deployed_url: https://remix.examples.electric-sql.com/
source_url: https://github.com/electric-sql/electric/tree/main/examples/nextjs
image: /img/demos/items-screenshot.png
example: true
---

# {{ $frontmatter.title }}

{{ $frontmatter.description }}

<DemoCTAs :demo="$frontmatter" />

## Remix example app

This is an example using Electric with [Remix](https://remix.run/).

The entrypoint for the Electric-specific code is in [`./app/routes/_index.tsx`](https://github.com/electric-sql/electric/blob/main/examples/remix/app/routes/_index.tsx):

<<< @../../examples/remix/app/routes/\_index.tsx{tsx}

<DemoCTAs :demo="$frontmatter" />
