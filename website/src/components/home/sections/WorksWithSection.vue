<script setup>
import EaSection from '../../agents-home/Section.vue'
import WorksWithStack from '../WorksWithStack.vue'
</script>

<template>
  <EaSection :dark="true">
    <template #title>Works with your&nbsp;stack</template>
    <template #subtitle>
      Drop in Electric next to your existing API and database. Any web
      framework, any client &mdash;
      <span class="no-wrap">if it speaks HTTP and JSON</span>, it
      <span class="no-wrap">speaks Electric</span>.
    </template>
    <WorksWithStack />
    <template #actions>
      <VPButton
        tag="a"
        size="medium"
        theme="brand"
        text="Quickstart"
        href="/docs/sync/quickstart"
      />
      <VPButton
        tag="a"
        size="medium"
        theme="alt"
        text="Read the Docs"
        href="/docs/sync/"
      />
    </template>
  </EaSection>
</template>
