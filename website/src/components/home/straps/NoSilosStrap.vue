<script setup>
import CTAStrap from '../CTAStrap.vue'

const actions = [
  {
    href: '/docs/quickstart',
    text: 'Get started',
    theme: 'brand',
  }
]
</script>

<template>
  <CTAStrap :actions="actions">
    <template #title> No&nbsp;siloes. No&nbsp;black&nbsp;boxes. </template>
    <template #tagline>
      Just
      <span class="hidden-sm"> real-time</span>
      sync, solved &mdash; it’s all
      <a href="https://github.com/electric-sql" class="no-wrap"> open source</a>
      <span class="no-wrap-xs">
        and it’s
        <a href="/docs/api/http" class="no-wrap">
          all just HTTP</a>
      </span>
    </template>
  </CTAStrap>
</template>
