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

We do not currently ship a maintained `examples/nextjs` app in this repository.
The previous example was removed from `main` on April 23, 2026 after it fell
behind the supported Next.js and React stack.

When integrating Electric with Next.js, the key pieces are:

- Use the normal Electric React client patterns inside client components.
- Proxy Electric through a Next.js route handler or other server-side endpoint
  so secrets stay on the server.
- Handle writes through your own API and keep Electric on the read path.

The [Next.js demo page](/sync/demos/nextjs) remains as a historical deployment
reference. For current implementation guidance, see the
[auth guide](/docs/sync/guides/auth), [shapes guide](/docs/sync/guides/shapes), and
[write patterns guide](/docs/sync/guides/writes).

#### ElectroDrizzle

[ElectroDrizzle](https://github.com/LeonAlvarez/ElectroDrizzle) is an example application by [Leon Alvarez](https://github.com/LeonAlvarez) using Next.js, [Drizzle](https://orm.drizzle.team), [PGLite](/sync/pglite) and Electric together.

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
