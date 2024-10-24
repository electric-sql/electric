---
outline: deep
title: Next.js - Integrations
image: /img/integrations/electric-next.jpg
---

<script setup>
  import HelpWanted from '/src/components/HelpWanted.vue'
</script>

<img src="/img/integrations/next.svg" class="product-icon" />

# Next.js

[Next.js](https://mobx.js.org) is a full-stack React framework.

## Electric and Next.js

Next.js is based on React. Electric [works with React](./react). You can integrate Electric into your Next.js application like any other npm / React library.

### SSR

Next.js supports SSR. We are currently [experimenting with patterns](https://github.com/electric-sql/electric/pull/1596) to use Electric with SSR in a way that supports server rendering *and* client-side components seamlessly moving into realtime sync.

### Examples

[ElectroDrizzle](https://github.com/LeonAlvarez/ElectroDrizzle) is an example Next.js application using ElectricSQL and PGLite.

<HelpWanted issue="1596">
  <template v-slot:thing>
    a pull request
  </template>
  <template v-slot:doing>
    open
  </template>
  to improving our Next.js documentation, patterns and framework integrations.
</HelpWanted>
