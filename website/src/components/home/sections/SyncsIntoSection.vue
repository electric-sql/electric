<script setup>
  import Section from '../Section.vue'

  const actions = [
    {
      href: '/why/sync',
      text: 'Why sync',
      theme: 'brand'
    },
    {
      href: '/product/cloud/sign-up',
      text: 'Sign-up'
    }
  ]

  const syncTargets = [
    'apps',
    'dashboards',
    'workers',
    'agents'
  ]
</script>

<template>
  <Section :actions="actions">
    <template #title>
      Adopt sync, one route at a time
    </template>
    <template #tagline>
      Sync out of Postgres into anything you like. Without changing your stack, data or code.
    </template>
    <ul class="sync-targets">
      <li :key="target" v-for="target in syncTargets">
        {{ target }}
      </li>
    </ul>
  </Section>
</template>