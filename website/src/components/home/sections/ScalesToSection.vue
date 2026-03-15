<script setup>
import ScalabilityChart from '../../ScalabilityChart.vue'

import Card from '../Card.vue'
import Section from '../Section.vue'
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
  <Section :wideSectionHead="true">
    <template #title>
      Scales to
      <span class="no-wrap"> millions of users</span>
    </template>
    <template #override-tagline>
      <p>
        Uses
        <a href="/docs/api/http#caching"> standard CDNs</a>
        to
        <span class="no-wrap">
          scale
          <span class="hidden-sm"> high-throughput</span>
          data&nbsp;delivery</span
        ><span class="hidden-lg">
          to <a href="/docs/reference/benchmarks"> millions of users</a></span
        >.
      </p>
      <!--p>
        The chart below shows latency and memory<span class="hidden-sm"
          >-use</span
        >
        stay
        <span class="hidden-lg"> low and</span>
        flat as we scale up-to
        <a href="/docs/reference/benchmarks#cloud">
          <span class="hidden-sm"> an</span>
          80Gb/s<span class="hidden-sm"> workload</span></a
        >
        to&nbsp;a
        <span class="no-wrap">
          million
          <span class="hidden-sm"> concurrent</span> users</span
        ><span class="hidden-lg">
          from a
          <span class="no-wrap"> single commodity Postgres</span></span
        >.
      </p-->
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
  </Section>
</template>
