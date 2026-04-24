<script setup>
import { computed } from 'vue'
import { data as primitives } from '../../../data/primitives.data.ts'

const props = defineProps({
  // Slugs (in render order) of the primitives to feature. Defaults to the
  // "what to pair Postgres Sync with" lineup used on the Postgres Sync
  // primitive page; the new top-level Sync landing page passes its own
  // ordering (postgres-sync, tanstack-db, pglite) to introduce the
  // primitives that compose the sync stack.
  order: {
    type: Array,
    default: () => ['tanstack-db', 'pglite', 'durable-streams'],
  },
})

const products = computed(() =>
  props.order
    .map((slug) => primitives.find((p) => p.slug === slug))
    .filter(Boolean)
)
</script>

<template>
  <div class="compose-stack">
    <a
      v-for="product in products"
      :key="product.slug"
      :href="product.href"
      class="compose-card no-visual"
    >
      <div class="compose-icon">
        <img :src="product.icon" :alt="product.title" />
      </div>
      <h3 class="compose-title">{{ product.title }}</h3>
      <p class="compose-body">
        <span v-html="product.body" />.
      </p>
      <p class="compose-detail">
        <span v-html="product.detail" />.
      </p>
    </a>
  </div>
</template>

<style scoped>
.compose-stack {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
}

.compose-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 32px;
  border-radius: 8px;
  border: 1px solid var(--ea-divider);
  background: var(--ea-surface);
  text-decoration: none;
  transition: border-color 0.2s;
}

.compose-card:hover {
  border-color: var(--vp-c-brand-1);
}

.compose-icon {
  margin-bottom: 8px;
}

.compose-icon img {
  width: 48px;
  height: 48px;
  display: block;
  object-fit: contain;
}

.compose-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--ea-text-1);
  line-height: 1.3;
}

.compose-body {
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--ea-text-2);
  font-weight: 500;
}

.compose-detail {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ea-text-3);
}

.compose-card :deep(.breaker),
.compose-card :deep(.no-wrap),
.compose-card :deep(.no-wrap-xs),
.compose-card :deep(.no-wrap-sm),
.compose-card :deep(.no-wrap-md) {
  white-space: normal;
}

@media (max-width: 820px) {
  .compose-stack {
    grid-template-columns: 1fr;
    gap: 20px;
  }
}
</style>
