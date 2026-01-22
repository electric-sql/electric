<script setup>
import Section from '../Section.vue'
import Card from '../Card.vue'

const actions = [
  {
    href: '/products',
    text: 'View all products',
    theme: 'brand',
  },
]

const products = [
  {
    slug: 'postgres-sync',
    icon: '/img/icons/electric.svg',
    title: 'Postgres Sync',
    body: `Sync data from Postgres into local apps with partial replication and live queries.`,
    href: '/products/postgres-sync',
  },
  {
    slug: 'durable-streams',
    icon: '/img/icons/durable-streams.svg',
    title: 'Durable Streams',
    body: `Resumable streaming protocol for AI responses and multi-step workflows.`,
    href: '/products/durable-streams',
  },
  {
    slug: 'tanstack-db',
    icon: '/img/icons/tanstack.svg',
    title: 'TanStack DB',
    body: `Reactive client database with optimistic updates and sync integration.`,
    href: '/products/tanstack-db',
  },
  {
    slug: 'pglite',
    icon: '/img/icons/pglite.svg',
    title: 'PGlite',
    body: `Lightweight WASM Postgres for browser, Node.js, and embedded use.`,
    href: '/products/pglite',
  },
]
</script>

<template>
  <Section :actions="actions">
    <template #title>With composable sync&nbsp;primitives</template>
    <template #tagline>
      Compose your own end-to-end reactive sync stack.
    </template>
    <div class="products-grid">
      <div v-for="product in products" :key="product.slug" class="product-card">
        <Card
          :href="product.href"
          :icon="product.icon"
          :title="product.title"
          :body="product.body"
        />
      </div>
    </div>
  </Section>
</template>

<style scoped>
.products-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 24px;
  margin: 32px 0px 40px;
}

@media (max-width: 1099px) {
  .products-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 24px;
  }
}

@media (max-width: 518px) {
  .products-grid {
    margin: 32px 24px 40px;
    gap: 20px;
    grid-template-columns: 1fr;
  }

  .products-grid .product-card {
    position: relative;
    display: block;
    width: 100%;
    max-width: 340px;
    margin: 0 auto;
  }
}
</style>
