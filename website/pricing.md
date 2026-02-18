---
layout: home
title: Pricing
description: >-
  Electric Cloud has scalable pricing for teams of all sizes, with a generous free tier, unlimited data delivery and support to get you into production faster.
hideReleaseBanner: true
---

<script setup>
import { onMounted } from 'vue'
import { UsedBySection } from './src/components/home'
import Section from './src/components/home/Section.vue'
import Quote from './src/components/home/Quote.vue'
import PricingCard from './src/components/pricing/PricingCard.vue'
import ComparisonTable from './src/components/pricing/ComparisonTable.vue'
import PricingCalculator from './src/components/pricing/PricingCalculator.vue'
import { data as pricing } from './data/pricing.data.ts'

import LogoStrip from '/static/img/blog/electric-beta-release/logo-strip.svg'
import LogoStripSm from '/static/img/blog/electric-beta-release/logo-strip.sm.svg'
import LogoStripXs from '/static/img/blog/electric-beta-release/logo-strip.xs.svg'
import LogoStripXxs from '/static/img/blog/electric-beta-release/logo-strip.xxs.svg'

const tiers = pricing.tiers
const services = pricing.services
const enterprise = pricing.enterprise
const comparisonPlans = pricing.comparisonPlans

onMounted(() => {
  if (typeof window !== 'undefined' && document.querySelector) {
    document.querySelectorAll('.strap-actions a[href^="https://github.com"]').forEach((link) => {
      if (!link.querySelector('.vpi-social-github')) {
        const icon = document.createElement('span')
        icon.classList.add('vpi-social-github')

        link.prepend(icon)
      }
    })
  }
})
</script>

<p class="intro-zap-container hidden-lg">
  <img src="/img/home/zap-with-halo.svg"
      alt="Electric zap with halo"
      class="intro-zap"
  />
</p>
<p class="intro-zap-container block-lg">
  <img src="/img/home/zap-with-halo.svg"
      alt="Electric zap with halo"
      class="intro-zap-sm"
  />
</p>

<Section :actions="[]">
  <template #title>
    Scalable pricing for
    <span class="no-wrap">teams of all sizes</span>
  </template>
  <template #tagline>
    <a href="/product/cloud">Electric Cloud</a>
    has a generous free tier,
    <span class="inline hidden-md">
      fixed plans with</span> <a class="no-wrap" href="#details">unlimited data delivery</a> and
    <span class="no-wrap-lg">
      <span class="inline hidden-sm">
        additional</span>
      support</span>
    <span class="no-wrap-sm">
      to get you</span> <span class="no-wrap-sm">
      into production&nbsp;faster</span>.
  </template>
  <div class="pricing-grid">
    <PricingCard
      v-for="tier in tiers"
      :key="tier.slug"
      :plan="tier"
    />
    <PricingCard
      v-for="service in services"
      :key="service.slug"
      :plan="service"
      class="service-card"
    />
  </div>
</Section>

<Section :actions="[]">
  <template #title>
    Need more?
  </template>
  <template #tagline>
    Higher limits<span class="inline hidden-sm">, more support,</span> or bespoke&nbsp;requirements?
  </template>
  <div class="enterprise-card">
    <PricingCard
      v-for="ent in enterprise"
      :key="ent.slug"
      :plan="ent"
    />
  </div>
</Section>

<figure class="logo-strap">
  <img :src="LogoStrip" class="hidden-md" />
  <img :src="LogoStripXxs" class="block-md hidden-sm logo-strap-md" />
  <img :src="LogoStripXxs" class="block-sm hidden-md logo-strap-sm" />
</figure>

<div class="quotes">
  <Quote image="/img/home/quotes/trigger.jpg">
    <template #quote>
        “We use ElectricSQL to power Trigger.dev Realtime<span class="hidden-md">, a core feature of our product</span><span class="hidden-xs">. It<span class="inline hidden-sm">'s&nbsp;simple to operate and it</span>&nbsp;scales to</span><span class="inline-xs"> with</span> millions of updates per&nbsp;day.”
    </template>
    <template #attribution>
      <span class="hidden-md">
        &mdash;</span>
      Matt Aitken, CEO, <a href="https://trigger.dev"><cite class="highlight">Trigger.dev</cite></a>
    </template>
  </Quote>
  <Quote image="/img/home/quotes/otto.jpg">
    <template #quote>
      “ElectricSQL enables us to reliably stream agent updates
      in real-time at&nbsp;scale.<span class="hidden-xs"> It has dramatically simplified
      our&nbsp;architecture<span class="hidden-md">
        while delivering cell-level reactive updates</span>.</span>
    </template>
    <template #attribution>
      <span class="hidden-md">
        &mdash;</span>
      Sully Omar, CEO, <a href="https://ottogrid.ai"><cite class="highlight">Otto</cite></a>
    </template>
  </Quote>
</div>

<div class="open-source-strap">
  <div class="section-head">
    <h1>Open source</h1>
    <p>
      Want free with unlimited use?
      <span class="no-wrap">Electric is fully open-source</span><span class="hidden inline-sm">.</span> <span class="hidden-sm">
        <span class="no-wrap-sm"> and <span class="no-wrap">designed for self-hosting.</span></span></span>
    </p>
  </div>
  <div class="strap-actions">
    <div class="action">
      <VPButton
        href="/docs/guides/deployment"
        text="Self-hosting"
        theme="brand"
      />
    </div>
    <div class="action">
      <VPButton
        href="https://github.com/electric-sql/electric"
        text="GitHub"
        theme="alt"
        target="_blank"
      />
    </div>
  </div>
</div>

<Section :actions="[]">
  <template #override-title>
    <h1 id="details">
      Compare plans
    </h1>
  </template>
  <template #tagline>
    Dive into the details to see
    <span class="no-wrap-xs">
      what's
      <span class="no-wrap">
        right for you</span></span>.
  </template>
  <ComparisonTable :comparisonPlans="comparisonPlans" />
</Section>

<Section :actions="[]">
  <template #title>
    Model your workload
  </template>
  <template #tagline>
    Use our calculator to find the right plan<span class="hidden-sm">
      for your&nbsp;workload</span>.
  </template>
  <PricingCalculator />
</Section>

<div class="open-source-strap">
  <div class="section-head">
    <h1>Get in touch</h1>
    <p>
      Let's chat
      <span class="hidden-sm">
        through your requirements and
      </span>
      <span class="inline-sm">
        to
      </span>
      <span class="no-wrap-sm">
        see
        <span class="no-wrap-xs">
          how we can&nbsp;help</span></span>.
    </p>
  </div>
  <div class="strap-actions">
    <div class="action">
      <VPButton
        href="/about/contact#sales"
        text="Contact sales"
        theme="brand"
      />
      &nbsp;
      <VPButton
          href="https://discord.electric-sql.com"
          text="Ask on Discord"
          theme="alt"
      />
    </div>
  </div>
</div>

<style>
  @supports (overflow: clip) {
    @media (max-width: 959px) {
      .Layout {
        /* Enables sticky header support for the comparison table */
        overflow-x: clip !important;
      }
    }
  }
</style>

<style scoped>
.electric-green {
  color: var(--electric-color);
  font-weight: 600;
}
.intro-zap-sm {
  height: 60px;
  margin: 36px auto -6px;
}
@media (min-width: 768px) and (max-width: 959px) {
  .intro-zap-sm {
    margin: 48px auto 0px;
  }
}
@media (max-width: 767px) {
  .intro-zap-sm {
    height: 52px;
  }
}

.pricing-grid {
  margin: 40px 0 40px;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: 24px;
  align-items: start;
}

@media (max-width: 1149px) and (min-width: 806px) {
  .pricing-grid {
    grid-template-columns: 1fr 1fr 1fr;
    gap: 24px;
  }

  .service-card {
    grid-column: 1 / -1;
  }

  .service-card :deep(.card-features),
  .enterprise-card :deep(.card-features) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0;
  }

  .service-card :deep(.features-title),
  .enterprise-card :deep(.features-title) {
    width: 100%;
    margin-bottom: 8px;
  }

  .service-card :deep(.feature-item),
  .enterprise-card :deep(.feature-item) {
    margin-bottom: 0;
    display: flex;
    align-items: center;
  }

  .service-card :deep(.feature-item::after),
  .enterprise-card :deep(.feature-item::after) {
    content: "•";
    margin: 0 10px;
    color: var(--vp-c-text-3);
  }

  .service-card :deep(.feature-item:last-child::after),
  .enterprise-card :deep(.feature-item:last-child::after) {
    content: none;
  }
}

@media (max-width: 805px) and (min-width: 530px) {
  .pricing-grid {
    grid-template-columns: 1fr 1fr;
    gap: 22px;
  }
}

@media (max-width: 529px) {
  .pricing-grid {
    grid-template-columns: 1fr;
    gap: 24px;
  }
}

.enterprise-card {
  margin: 40px 0 0;
}

@media (min-width: 530px) {
  .enterprise-card :deep(.card-features) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0;
  }

  .enterprise-card :deep(.features-title) {
    width: 100%;
    margin-bottom: 8px;
  }

  .enterprise-card :deep(.feature-item) {
    margin-bottom: 0;
    display: flex;
    align-items: center;
  }

  .enterprise-card :deep(.feature-item::after) {
    content: "•";
    margin: 0 10px;
    color: var(--vp-c-text-3);
  }

  .enterprise-card :deep(.feature-item:last-child::after) {
    content: none;
  }
}

.page-section {
  padding: 10px 0;
}

.page-section:has(.comparison-table) {
  padding-top: 50px;
}

.open-source-strap {
  margin: 50px -400px 50px;
  padding: 90px 400px 106px;
  background: var(--vp-sidebar-bg-color);
}

.open-source-strap .section-head {
  max-width: 725px;
}

.open-source-strap .section-head h1 {
  margin-bottom: 16px;
}

.open-source-strap .section-head p {
  margin: 10px 0 !important;
  color: var(--vp-c-text-2);
  font-weight: 500;
}

.strap-actions {
  margin-top: 24px;
  display: flex;
  justify-content: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}

@media (max-width: 959px) {
  .page-section {
    padding: 5px 0;
  }

  .page-section:has(.comparison-table) {
    padding-top: 40px;
  }

  .open-source-strap {
    margin: 50px -48px 60px;
    padding: 80px 48px 70px;
    text-align: center;
  }

  .open-source-strap .section-head {
    text-align: center;
    max-width: 635px;
    margin-left: auto;
    margin-right: auto;
  }

  .strap-actions {
    justify-content: center;
  }
}

.logo-strap {
  margin-top: 40px;
  margin-bottom: 40px;
  width: 100%;
  display: flex;
  justify-content: center;
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
  margin-bottom: 100px;
}
@media (max-width: 749px) {
  .quotes {
    grid-template-columns: 1fr;
    max-width: 512px;
    margin: 0 auto;
  }
}
</style>
