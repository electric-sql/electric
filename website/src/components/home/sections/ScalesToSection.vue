<script setup>
  import ScalabilityChart from '../../ScalabilityChart.vue'

  import Card from '../Card.vue'
  import Section from '../Section.vue'

  const actions = [
    {
      href: '/product/cloud',
      text: 'Electric Cloud',
      theme: 'brand'
    },
    {
      href: '/docs/reference/benchmarks',
      text: 'Benchmarks'
    }
  ]
</script>

<style scoped>
  .content {
    padding: 16px 0;
  }
  .scalability-chart {
    margin-top: -10px;
  }
</style>

<template>
  <Section :actions="actions" :wideSectionHead="true">
    <template #title>
      Scales to
      <span class="no-wrap">
        millions of users</span>
    </template>
    <template #override-tagline>
      <p>
        Electric uses
        <a href="/docs/api/http#caching">
          standard CDNs</a>
        to
        <span class="no-wrap">
          scale
          <span class="hidden-sm">
            high-throughput</span>
          data&nbsp;delivery</span><span class="hidden-lg"> to
          <a href="/docs/reference/benchmarks">
            millions of users</a></span>.
      </p>
      <p>
        The chart below shows latency and memory<span class="hidden-sm">-use</span> stay
        <span class="hidden-lg">
          low and</span>
        flat as we scale up-to
        <a href="/docs/reference/benchmarks#cloud">
          <span class="hidden-sm">
            an</span>
          80Gb/s<span class="hidden-sm"> workload</span></a>
        to&nbsp;a
        <span class="no-wrap">
          million
          <span class="hidden-sm">
            concurrent</span> users</span><span class="hidden-lg">
        from a
        <span class="no-wrap">
          single commodity Postgres</span></span>.
      </p>
    </template>
    <div class="content">
      <div class="hidden-xs">
        <Card>
          <div class="scalability-chart">
            <ScalabilityChart />
          </div>
        </Card>
      </div>
      <div class="block-xs">
        <ScalabilityChart />
      </div>
    </div>
    <template #outline>
      You can
      <a href="/docs/guides/deployment">
        host it yourself</a>
      or use the
      <a href="/product/cloud">
        Electric Cloud</a>&nbsp;platform<span class="hidden-lg"> for managed sync with a built-in data delivery network</span>.
    </template>
  </Section>
</template>
