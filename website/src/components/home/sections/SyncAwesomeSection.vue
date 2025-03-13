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
      Sync makes apps awesome
    </template>
    <template #tagline>
      Sync is the magic ingredient behind fast, modern software. From apps like Figma and Linear to AI agents running on live, local data.
    </template>
    <ul class="sync-targets">
      <li :key="target" v-for="target in syncTargets">
        {{ target }}
      </li>
    </ul>
    <!--template #outline>
      Live local data makes apps go brrr 🚀
    </template-->
  </Section>
</template>