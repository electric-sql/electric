<script setup>
import Section from '../Section.vue'
import ProductsGrid from '../ProductsGrid.vue'

const actions = [
  {
    href: '/products',
    text: 'Products',
    theme: 'brand',
  },
  {
    href: '/docs',
    text: 'Docs',
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
    <ProductsGrid />
  </Section>
</template>
