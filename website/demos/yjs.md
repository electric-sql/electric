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

## Electric Yjs provider

The example implements a [Yjs Provider](https://docs.yjs.dev/tutorials/creating-a-custom-provider) that allows you to sync Yjs operations. This is implemented in [`y-electric.ts`](https://github.com/electric-sql/electric/blob/main/examples/yjs/app/y-electric.ts):

<<< @../../examples/yjs/app/y-electric.ts{typescript}

<DemoCTAs :demo="$frontmatter" />