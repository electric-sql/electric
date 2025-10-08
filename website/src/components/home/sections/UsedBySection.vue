<script setup>
import LogoStrip from "/static/img/blog/electric-beta-release/logo-strip.svg"
import LogoStripSm from "/static/img/blog/electric-beta-release/logo-strip.sm.svg"
import LogoStripXs from "/static/img/blog/electric-beta-release/logo-strip.xs.svg"
import LogoStripXxs from "/static/img/blog/electric-beta-release/logo-strip.xxs.svg"

import Quote from "../Quote.vue"
import Section from "../Section.vue"

const actions = [
  // {
  //   href: '/why/case-studies',
  //   text: 'Case studies',
  //   theme: 'brand'
  // },
  {
    href: "/use-cases/data-sync",
    text: "Use cases",
    theme: "brand",
  },
  {
    href: "/demos",
    text: "Examples",
  },
]
</script>

<style scoped>
.logo-strap {
  margin-top: 100px;
}
.logo-strap-md,
.logo-strap-sm {
  width: 100%;
  margin: 0 auto;
}
.logo-strap-md {
  max-width: 384px;
}
.logo-strap-sm {
  max-width: 320px;
}
.quotes {
  padding: 16px 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  flex: row;
}
@media (max-width: 749px) {
  .quotes {
    grid-template-columns: 1fr;
    max-width: 512px;
    margin: 0 auto;
  }
}
</style>

<template>
  <figure class="logo-strap">
    <img :src="LogoStrip" class="hidden-md" />
    <img :src="LogoStripXxs" class="block-md hidden-sm logo-strap-md" />
    <img :src="LogoStripXxs" class="block-sm hidden-md logo-strap-sm" />
  </figure>
  <Section :actions="actions" id="dashboard-examples">
    <template #title> Used by world leading&nbsp;companies </template>
    <template #tagline>
      Built into
      <span class="hidden-sm"> developer tools like</span>
      <a
        href="https://www.npmjs.com/package/firebase-tools?activeTab=dependencies"
        target="_blank"
        >Firebase</a
      >
      and
      <a href="https://supabase.com/blog/database-build-v2" target="_blank">
        Supabase</a
      >. Used
      <span class="hidden-sm"> in production</span>
      by
      <span class="hidden-sm"> products like</span>
      <span class="no-wrap">
        <a href="https://trigger.dev/product/realtime" target="_blank">
          Trigger.dev</a
        >, <a href="https://ottogrid.ai" target="_blank"> Otto</a> and
        <a href="https://doorboost.com" target="_blank"> Doorboost</a></span
      >.
    </template>
    <div class="quotes">
      <Quote
        image="/img/home/quotes/trigger.jpg"
        href="https://trigger.dev/launchweek/0/realtime"
      >
        <template #quote>
          “We use ElectricSQL to power Trigger.dev Realtime<span
            class="hidden-md"
            >, a core feature of our product</span
          >. It's&nbsp;simple to operate
          <span class="hidden-md"> as we already use Postgres,</span>
          and it scales to millions of updates&nbsp;per&nbsp;day.”
        </template>
        <template #attribution>
          <span class="hidden-md"> &mdash;</span>
          Matt Aitken, CEO, <cite class="highlight">Trigger.dev</cite>
        </template>
      </Quote>
      <Quote image="/img/home/quotes/otto.jpg" href="https://ottogrid.ai">
        <template #quote>
          “ElectricSQL enables us to reliably stream agent updates in real-time
          at scale. It has dramatically simplified our&nbsp;architecture<span
            class="hidden-md"
          >
            while delivering cell-level reactive updates</span
          >.
        </template>
        <template #attribution>
          <span class="hidden-md"> &mdash;</span>
          Sully Omar, CEO, <cite class="highlight">Otto</cite>
        </template>
      </Quote>
    </div>
  </Section>
</template>
