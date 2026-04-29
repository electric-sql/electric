<script setup>
import Section from '../Section.vue'
import ProductsGrid from '../ProductsGrid.vue'

const actions = [
  {
    href: '/sync',
    text: 'Sync',
    theme: 'brand',
  },
  {
    href: '/streams',
    text: 'Streams',
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
