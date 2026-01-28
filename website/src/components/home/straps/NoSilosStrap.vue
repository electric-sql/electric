<script setup>
import CTAStrap from '../CTAStrap.vue'

const actions = [
  {
    href: '/docs/quickstart',
    text: 'Get started',
    theme: 'brand',
  },
]
</script>

<template>
  <CTAStrap :actions="actions">
    <template #title> No&nbsp;siloes. No&nbsp;black&nbsp;boxes </template>
    <template #tagline>
      Just sync, solved, with
      <span class="no-wrap">
        <a href="/docs/api/http"> standard web tech</a>
      </span>
    </template>
  </CTAStrap>
</template>
