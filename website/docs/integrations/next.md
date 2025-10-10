---
outline: deep
title: Next.js - Integrations
description: >-
  How to use Electric with Next.js.
image: /img/integrations/electric-next.jpg
---

<img src="/img/integrations/next.svg" class="product-icon" />

# Next.js

[Next.js](https://mobx.js.org) is a full-stack React framework.

## Electric and Next.js

Next.js is based on React. Electric [works with React](./react). You can integrate Electric into your Next.js application like any other npm / React library.

### Examples

#### Next.js example

See the [Nextjs example](/demos/nextjs) on GitHub. This demonstrates using Electric for read-path sync and a Next.js API for handling writes:

<<< @../../examples/nextjs/app/page.tsx

It also demonstrates using a [shape-proxy endpoint](https://github.com/electric-sql/electric/blob/main/examples/nextjs/app/shape-proxy/route.ts) for proxying access to the Electric sync service. This allows you to implement [auth](/docs/guides/auth) and routing in-front-of Electric (and other concerns like transforming or decrypting the stream) using your Next.js backend:

<<< @../../examples/nextjs/app/shape-proxy/route.ts

#### ElectroDrizzle

[ElectroDrizzle](https://github.com/LeonAlvarez/ElectroDrizzle) is an example application by [Leon Alvarez](https://github.com/LeonAlvarez) using Next.js, [Drizzle](https://orm.drizzle.team), [PGLite](/product/pglite) and Electric together.

See the [Getting Started guide here](https://github.com/LeonAlvarez/ElectroDrizzle?tab=readme-ov-file#getting-started).

#### SSR

Next.js supports SSR. We are currently [experimenting with patterns](https://github.com/electric-sql/electric/pull/1596) to use Electric with SSR in a way that supports server rendering _and_ client-side components seamlessly moving into realtime sync.

<HelpWanted issue="1596">
  <template v-slot:thing>
    a pull request
  </template>
  <template v-slot:doing>
    open
  </template>
  to improving our Next.js documentation, patterns and framework integrations.
</HelpWanted>
