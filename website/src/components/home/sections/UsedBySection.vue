<script setup>
  import LogoStrip from '/static/img/blog/electric-beta-release/logo-strip.svg'
  import LogoStripSm from '/static/img/blog/electric-beta-release/logo-strip.sm.svg'
  import LogoStripXs from '/static/img/blog/electric-beta-release/logo-strip.xs.svg'
  import LogoStripXxs from '/static/img/blog/electric-beta-release/logo-strip.xxs.svg'

  import Quote from '../Quote.vue'
  import Section from '../Section.vue'

  const actions = [
    {
      href: '/why/case-studies',
      text: 'Case studies',
      theme: 'brand'
    }
  ]
</script>

<style scoped>
  .logo-strap {
    margin-top: 100px;
  }
  .quotes {
    display: flex;
    flex: row;
  }
</style>

<template>
  <figure class="logo-strap">
    <img :src="LogoStrip" class="hidden-sm" />
    <img :src="LogoStripSm" class="hidden-xs block-sm" />
    <img :src="LogoStripXs" class="hidden-xxs block-xs" />
    <img :src="LogoStripXxs" class="block-xxs" />
  </figure>
  <Section :actions="actions">
    <template #title>
      Used by world leading companies
    </template>
    <template #tagline>
      Built into developer tools like
      <a href="https://www.npmjs.com/package/firebase-tools?activeTab=dependencies" target="_blank">
        Google Firebase</a>
      and
      <a href="https://supabase.com/blog/database-build-v2"
          target="_blank">
        Supabase</a>.
      Used in production by products like
      <a href="https://trigger.dev/product/realtime" target="_blank">
        Trigger.dev</a>,
      <a href="https://ottogrid.ai" target="_blank">
        Otto</a> and
      <a href="https://doorboost.com" target="_blank">
        Doorboost</a>.
    </template>
    <div class="quotes">
      <Quote>
        <template #quote>
          We use ElectricSQL to power Trigger.dev Realtime, a core feature of our product.
          It's simple to operate as we already use Postgres, and it scales to millions of updates per day.
        </template>
        <template #attribution>
          &mdash; Matt Aitken, CEO, <cite>Trigger.dev</cite>
        </template>
      </Quote>
      <Quote>
        <template #quote>
          ElectricSQL enables us to reliably stream agent updates in real-time at scale.
          It has dramatically simplified our architecture while delivering cell-level reactive updates.
        </template>
        <template #attribution>
          &mdash; Sully Omar, CEO, <cite>Ottogrid.ai</cite>
        </template>
      </Quote>
    </div>
  </Section>
</template>