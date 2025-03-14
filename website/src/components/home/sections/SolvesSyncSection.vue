<script setup>
  import Section from '../Section.vue'

  const actions = [
    {
      href: '/why/electric',
      text: 'Why Electric',
      theme: 'brand'
    },
    {
      href: '/how/it-works',
      text: 'How it works'
    }
  ]
</script>

<template>
  <Section :actions="actions">
    <template #title>
      Electric solves sync
    </template>
    <template #tagline>
      Electric is a Postgres sync engine. It solves the hard problems of sync for you, including
      <a href="/docs/guides/shapes">
        partial&nbsp;replication</a>,
      <a href="/docs/api/http#caching">
        fan&nbsp;out</a>,
      and
      <a href="/how/it-works">
        data&nbsp;delivery</a>.
    </template>
    ... diagramme ...
    <template #outline>
      So you can build awesome, next-gen software &mdash; without rolling your own sync.
    </template>
  </Section>
</template>