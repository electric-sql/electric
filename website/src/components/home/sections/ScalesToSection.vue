<script setup>
  import ScalabilityChart from '../../ScalabilityChart.vue'
  import Section from '../Section.vue'

  const actions = [
    {
      href: '/product/cloud',
      text: 'Electric Cloud',
      theme: 'brand'
    },
    {
      href: '/docs/reference/benchamrks',
      text: 'Benchmarks'
    }
  ]
</script>

<template>

  <Section :actions="actions">
    <template #title>
      Scales to millions of users
    </template>
    <template #tagline>
      Leveraging
      <a href="/docs/api/http#caching">
        existing CDN infrastructure</a>
      to scale data delivery to
      <a href="/docs/reference/benchmarks">
        millions of concurrent&nbsp;users</a>
      on a single commodity Postgres.
    </template>
    <figure>
      <ScalabilityChart />
    </figure>
    <template #outline>
      With a
      <a href="/product/cloud">
        managed cloud platform</a>
      that connects to your
      <a href="/docs/guides/deployment#_1-running-postgres">
        existing Postgres host</a>.
    </template>
  </Section>
</template>