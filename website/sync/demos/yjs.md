---
title: Yjs
description: >-
  This is an example application using Electric with Yjs.
deployed_url: https://yjs.examples.electric-sql.com
source_url: https://github.com/electric-sql/electric/tree/main/examples/yjs
image: /img/demos/yjs-screenshot.png
example: true
---

# {{ $frontmatter.title }}

{{ $frontmatter.description }}

<DemoEmbed :demo="$frontmatter" />

<DemoCTAs :demo="$frontmatter" />

## Electric Yjs provider

An example text editor showing how to use Yjs and Electric together. It uses the Y-Electric [provider](https://docs.yjs.dev/tutorials/creating-a-custom-provider) to sync Yjs document and awareness changes to all connected clients. Checkout the [package](https://github.com/electric-sql/electric/tree/main/packages/y-electric) to learn how to integrate Yjs with your existing app:

<<< @../../packages/y-electric/src/y-electric.ts{typescript}

<DemoCTAs :demo="$frontmatter" />
