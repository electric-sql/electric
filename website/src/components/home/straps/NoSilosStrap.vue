<script setup>
  import CTAStrap from '../CTAStrap.vue'

  const actions = [
    {
      href: '/docs/quickstart',
      text: 'Quickstart',
      theme: 'brand'
    },
    {
      href: '/docs/tutorial',
      text: 'Tutorial'
    }
  ]
</script>

<template>
  <CTAStrap :actions="actions">
    <template #title>
      No&nbsp;siloes.
      No&nbsp;black&nbsp;boxes.
    </template>
    <template #tagline>
      Just real-time sync, solved. It’s all
      <a href="https://github.com/electric-sql" class="no-wrap">open source</a>
      and it’s all just
      <a href="/how/it-works" class="no-wrap">
        Postgres and HTTP</a>.
    </template>
  </CTAStrap>
</template>