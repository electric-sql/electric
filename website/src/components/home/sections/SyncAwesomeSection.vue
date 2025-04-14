<script setup>
  import Section from '../Section.vue'
  import SyncTarget from '../SyncTarget.vue'

  const actions = [
    {
      href: '/blog/2025/04/09/building-ai-apps-on-sync',
      text: 'Why sync',
      theme: 'brand'
    },
    {
      href: 'https://dashboard.electric-sql.cloud/',
      text: 'Sign-up'
    }
  ]

  const syncTargets = [
    {
      slug: 'agent',
      title: 'Agents',
      body:  `
        Keep AI agents and
        <span class="no-wrap">
          users in sync </span>&nbsp;&nbsp;&nbsp;
      `,
      href: '/demos/ai-chat'
    },
    {
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
      href: '/demos/linearlite'
    },
    {
      slug: 'dashboard',
      title: 'Dashboards',
      body:  `
        Build live,
        <span class="no-wrap">
          real-time</span>
        dashboards&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      `,
      href: '#dashboard-examples'
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
      href: '/docs/integrations/cloudflare'
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
      From apps
      <a href="/demos/linearlite">
        like
        <span class="hidden-559">
          Figma and</span>
        Linear</a>
      to
      <a href="/demos/ai-chat">
        <span class="no-wrap">multi-user</span>, <span class="no-wrap">multi-agent</span> <span class="no-wrap">AI apps</span></a>.
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