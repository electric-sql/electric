<script setup>
import CTAStrap from '../home/CTAStrap.vue'

const actions = [
  {
    href: '/docs/sync/quickstart',
    text: 'Quickstart',
    theme: 'brand',
  },
  {
    href: '/docs/sync/',
    text: 'Docs',
  },
  {
    href: '/sync/demos/',
    text: 'Demos',
  },
]
</script>

<template>
  <CTAStrap :actions="actions">
    <template #title>Get started</template>
    <template #tagline>
      Start with the
      <a href="/docs/sync/quickstart">Quickstart</a>. Dive deeper with the
      <span class="no-wrap">
        <a href="/docs/sync/">Docs</a>
        and
        <a href="/sync/demos/">Demos</a>.
      </span>
    </template>
  </CTAStrap>
</template>
