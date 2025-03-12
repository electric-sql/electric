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
      Just works
    </template>
    <template #tagline>
      Electric solves the hard problems of
      <a href="/how/it-works">
        resilient sync</a>,
      <a href="/docs/guides/shapes">
        partial&nbsp;replication</a>,
      <a href="/docs/api/http#caching">
        fan&nbsp;out</a>
      and
      <a href="/how/it-works">
        data&nbsp;delivery</a>.
    </template>
    ... diagramme ...
    <template #outline>
      So you can build awesome apps, without rolling your own sync engine.
    </template>
  </Section>
</template>