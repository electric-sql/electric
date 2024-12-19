---
title: React
description: >-
  Basic example of an Electric app using React.
deployed_url: https://basic.examples.electric-sql.com
source_url: https://github.com/electric-sql/electric/tree/main/examples/react
demo: true
homepage: true
order: 50
---

# {{ $frontmatter.title }}

{{ $frontmatter.description }}

<DemoCTAs :demo="$frontmatter" />

## Basic example using React

This is our simplest example of a web app using Electric with [React](https://react.dev) and [Vite](https://vite.dev).

The Electric-specific code is in [`./src/Example.tsx`](https://github.com/electric-sql/electric/blog/main/examples/react/src/Example.tsx):

<<< @../../examples/react/src/Example.tsx{tsx}

<DemoCTAs :demo="$frontmatter" />
