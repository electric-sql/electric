<script setup>
import Section from '../Section.vue'
import Card from '../Card.vue'

const actions = [
  {
    href: '/products',
    text: 'Products',
    theme: 'brand'
  },
  {
    href: '/docs',
    text: 'Docs'
  }
]

const products = [
  {
    slug: 'postgres-sync',
    icon: '/img/icons/electric.svg',
    title: 'Postgres Sync',
    body: `Sync from your database <span class="breaker no-wrap">into your apps</span>`,
    detail: `For partial replication, <span class="breaker no-wrap">data delivery and fan-out</span>`,
    href: '/products/postgres-sync',
  },
  {
    slug: 'durable-streams',
    icon: '/img/icons/durable-streams.svg',
    title: 'Durable Streams',
    body: `Persistent, addressable, <span class="breaker no-wrap">real-time streams</span>`,
    detail: `For resilient AI sessions <span class="breaker no-wrap">and ultra low-latency</span>`,
    href: '/products/durable-streams',
  },
  {
    slug: 'tanstack-db',
    icon: '/img/icons/tanstack.svg',
    title: 'TanStack DB',
    body: `Reactive client store <span class="breaker no-wrap">for super-fast apps</span>`,
    detail: `For sub-millisecond <span class="breaker no-wrap">reactivity and instant writes</span>`,
    href: '/products/tanstack-db',
  },
  {
    slug: 'pglite',
    icon: '/img/icons/pglite.product.svg',
    title: 'PGlite',
    body: `Embeddable Postgres <span class="breaker no-wrap">with reactivity and sync</span>`,
    detail: `For a full database inside <span class="breaker no-wrap">your client or runtime</span>`,
    href: '/products/pglite',
  },
]
</script>

<template>
  <Section :actions="actions">
    <template #title>Composable sync&nbsp;primitives</template>
    <template #tagline>
      Compose your own end-to-end
      <span class="no-wrap">reactive sync stack</span>
    </template>
    <div class="products-grid">
      <div v-for="product in products" :key="product.slug" class="product-card">
        <Card
          :href="product.href"
          :icon="product.icon"
          :title="product.title">
          <p class="body-p" v-html="product.body" />
          <hr />
          <p class="detail-p" v-html="product.detail" />
        </Card>
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
.products-grid .body-p {
  margin-top: 8px !important;
  color: var(--vp-c-text-2);
  font-size: 14.25px;
  font-weight: 500;
  max-width: none;
}
.products-grid hr {
  margin: 8px 0 10px;
}
.products-grid .detail-p {
  color: var(--vp-c-text-3);
  font-size: 13px;
  font-weight: 450;
}
.products-grid :deep(.card .icon img) {
  width: calc(40px + 1.5vw);
  height: calc(40px + 1.5vw);
  min-width: 50px;
  min-height: 50px;
  margin: -4px -2px;
}

.products-grid :deep(.breaker) {
  display: inline;
}

@media (min-width: 1149px) {
  .products-grid :deep(.icon),
  .products-grid :deep(.body) {
    margin: 0 calc(-15px + 1vw);
  }
}

@media (max-width: 1149px) {
  .products-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 24px;
  }
}

@media (max-width: 930px) {
  .products-grid :deep(.breaker) {
    display: block;
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
