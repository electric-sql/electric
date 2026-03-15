<script setup>
import CTAStrap from '../home/CTAStrap.vue'

const actions = [
  {
    href: '/docs/quickstart',
    text: 'Quickstart',
    theme: 'brand',
  },
  {
    href: '/docs/intro',
    text: 'Docs',
  },
  {
    href: '/demos',
    text: 'Demos',
  },
]
</script>

<template>
  <CTAStrap :actions="actions">
    <template #title>Get started</template>
    <template #tagline>
      Start with the
      <a href="/docs/quickstart">Quickstart</a>. Dive deeper with the
      <span class="no-wrap">
        <a href="/docs/intro">Docs</a>
        and
        <a href="/demos">Demos</a>.
      </span>
    </template>
  </CTAStrap>
</template>
