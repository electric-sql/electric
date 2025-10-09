<script setup>
import PartialReplicationDiagramme from '../PartialReplicationDiagramme.vue'
import Section from '../Section.vue'

const actions = [
  // {
  //   href: '/why/electric',
  //   text: 'Why Electric',
  //   theme: 'brand'
  // },
  {
    // href: '/how/it-works',
    href: '/product/electric',
    text: 'How it works',
    theme: 'brand',
  },
  {
    href: '/docs/guides/shapes',
    text: 'Partial replication',
  },
]
</script>

<template>
  <Section :actions="actions">
    <template #title> Electric solves sync </template>
    <template #tagline>
      Electric is a Postgres sync engine. It&nbsp;solves
      <span class="hidden-sm">
        the hard&nbsp;problems of
        <span class="hidden-lg"> sync for you, including</span></span
      >
      <a href="/docs/guides/shapes"> partial&nbsp;replication</a>,
      <a href="/docs/api/http#caching" class="no-wrap"> fan-out</a>,
      <span class="no-wrap">
        and
        <a href="/docs/api/http"> data&nbsp;delivery</a></span
      >.
    </template>
    <PartialReplicationDiagramme />
    <template #outline>
      So you can build awesome software
      <span class="hidden-lg">&mdash;</span> without
      <span class="no-wrap"> rolling your own sync</span>.
    </template>
  </Section>
</template>
