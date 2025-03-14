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
    <template #override-tagline>
      <p>
        Electric uses
        <a href="/docs/api/http#caching">
          existing CDNs</a>
        to scale high-throughput data delivery to
        <a href="/docs/reference/benchmarks">
          millions of users</a>.
      </p>
      <p>
        The chart below shows latency and memory-use stay low and flat as we scale
        <a href="/docs/reference/benchmarks#cloud">
          an 80Gb/s workload</a>
        to a million concurrent users from a single commodity Postgres.
      </p>
    </template>
    <figure>
      <ScalabilityChart />
    </figure>
    <template #outline>
      You can
      <a href="/docs/guides/deployment">
        host it yourself</a>
      or use the
      <a href="/product/cloud">
        Electric Cloud</a>
      platform for managed sync with a built-in data delivery network.
    </template>
  </Section>
</template>