<script setup>
  import Section from '../Section.vue'
  import SyncTarget from '../SyncTarget.vue'

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

  const syncTargets = [{
      slug: 'app',
      title: 'Apps',
      body: `
        Make apps
        <span class="no-wrap">
          <span class="sync-targets-super-fast">
            super</span>
          fast</span>
        <span class="no-wrap">
          and collaborative</span>
      `,
      // href: '/use-cases/data-sync'
    },
    {
      slug: 'dashboard',
      title: 'Dashboards',
      body:  `
        Keep dashboards live
        <span class="no-wrap">
          and real-time</span>
      `,
      // href: '/use-cases/cache-invalidation'
    },
    {
      slug: 'worker',
      title: 'Workers',
      body:  `
        Sync data into
        <span class="no-wrap-1117">
          workers
          <span class="no-wrap">
            at the edge</span>
        </span>
      `,
      // href: '/use-cases/local-first-software'
    },
    {
      slug: 'agent',
      title: 'Agents',
      body:  `
        Run AI agents on
        <span class="no-wrap">
          live local data&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
      `,
      // href: '/use-cases/local-ai'
    }
  ]
</script>

<template>
  <Section :actions="actions">
    <template #title>
      Sync makes apps awesome
    </template>
    <template #tagline>
      Sync is the magic
      <span class="hidden-lg">
        ingredient</span>
      behind
      <span class="hidden-lg">
        fast,</span>
      modern software.
      From apps like
      <span class="hidden-559">
        Figma and</span>
      Linear to AI agents running on
      <span class="hidden-559">
        live</span>
      local data.
    </template>
    <div class="sync-targets">
      <SyncTarget v-for="target in syncTargets"
          :key="target.name"
          :target="target"
      />
    </div>
  </Section>
</template>

<style scoped>
  .sync-targets {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: 32px;
    margin: 32px 0px 40px;
    overflow: hidden;
  }
  @media (max-width: 959px) {
    .sync-targets {
      gap: 30px;
      grid-template-columns: 1fr 1fr;
    }
  }
  @media (max-width: 518px) {
    .sync-targets {
      margin: 32px 24px 40px;
      gap: 24px;
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 559px) {
    .hidden-559 {
      display: none;
    }
  }
</style>

<style>
  @media (min-width: 959px) and (max-width: 1117px) {
    .no-wrap-1117 {
      white-space: nowrap;
    }
  }

  @media (max-width: 389px) {
    .sync-targets-super-fast {
      display: none;
    }
  }
  @media (min-width: 745px) and (max-width: 802px) {
    .sync-targets-super-fast {
      display: none;
    }
  }
</style>