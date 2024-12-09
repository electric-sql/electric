---
title: Next.js
description: >-
  Example of an Electric app using Next.js.
source_url: https://github.com/electric-sql/electric/tree/main/examples/nextjs
example: true
---

# {{ $frontmatter.title }}

{{ $frontmatter.description }}

<DemoCTAs :demo="$frontmatter" />

## Next.js example app

This is an example using Electric with [Next.js](/docs/integrations/next).

The entrypoint for the Electric-specific code is in [`./app/page.tsx`](https://github.com/electric-sql/electric/blog/main/examples/nextjs/app/page.tsx):

<<< @../../examples/nextjs/app/page.tsx{tsx}

<DemoCTAs :demo="$frontmatter" />
