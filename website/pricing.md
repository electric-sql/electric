---
layout: home
title: Pricing
description: >-
  Electric has a generous free tier with low-cost usage-based pricing and additional support for teams that need to ship faster.
hideReleaseBanner: true
---

<script setup>
import { onMounted } from 'vue'
import Section from './src/components/home/Section.vue'
import PricingCard from './src/components/pricing/PricingCard.vue'
import ComparisonTable from './src/components/pricing/ComparisonTable.vue'
import PricingCalculator from './src/components/pricing/PricingCalculator.vue'
import { data as pricing } from './data/pricing.data.ts'

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
    <span class="no-wrap-lg">unlimited data delivery</span>
    and <span class="no-wrap-lg">additional support</span> <span class="no-wrap">to get teams into</span> <span class="no-wrap">production faster</span>.
  </template>
  <div class="pricing-grid">
    <PricingCard
      v-for="tier in tiers"
      :key="tier.slug"
      :name="tier.name"
      :price="tier.price"
      :priceQualifier="tier.priceQualifier"
      :who="tier.who"
      :featuresTitle="tier.featuresTitle"
      :features="tier.features"
      :ctaText="tier.ctaText"
      :ctaHref="tier.ctaHref"
      :ctaTheme="tier.ctaTheme"
      :priceColor="tier.priceColor"
    />
    <PricingCard
      v-for="service in services"
      :key="service.slug"
      :name="service.name"
      :price="service.price"
      :priceQualifier="service.priceQualifier"
      :who="service.who"
      :featuresTitle="service.featuresTitle"
      :features="service.features"
      :ctaText="service.ctaText"
      :ctaHref="service.ctaHref"
      :ctaTheme="service.ctaTheme"
      :priceColor="service.priceColor"
      class="service-card"
    />
  </div>
</Section>

<Section :actions="[]">
  <template #title>
    Need more?
  </template>
  <template #tagline>
    Higher limits, more support, or bespoke requirements?
  </template>
  <div class="enterprise-card">
    <PricingCard
      v-for="ent in enterprise"
      :key="ent.slug"
      :name="ent.name"
      :price="ent.price"
      :who="ent.who"
      :features="ent.features"
      :featuresTitle="ent.featuresTitle"
      :ctaText="ent.ctaText"
      :ctaHref="ent.ctaHref"
      :ctaTheme="ent.ctaTheme"
      priceColor="ddn"
    />
  </div>
</Section>

<div class="open-source-strap">
  <div class="section-head">
    <h1>Open source</h1>
    <p>
      Want free with unlimited use?
      Electric is fully open-source and
      <span class="no-wrap-sm">
        designed for
        <span class="no-wrap">
          self-hosting</span></span>.
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
  <template #title>
    Compare plans
  </template>
  <template #tagline>
    Dive into the details to see what's right for you.
  </template>
  <ComparisonTable :comparisonPlans="comparisonPlans" />
</Section>

<Section :actions="[]">
  <template #title>
    Model your workload
  </template>
  <template #tagline>
    Use our calculator to find the right plan for your workload.
  </template>
  <PricingCalculator />
</Section>

<style scoped>
.intro-zap-sm {
  height: 60px;
  margin: 32px auto -12px;
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

  .service-card :deep(.card-features) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0;
  }

  .service-card :deep(.features-title) {
    width: 100%;
    margin-bottom: 8px;
  }

  .service-card :deep(.feature-item) {
    margin-bottom: 0;
    display: flex;
    align-items: center;
  }

  .service-card :deep(.feature-item::after) {
    content: "•";
    margin: 0 10px;
    color: var(--vp-c-text-3);
  }

  .service-card :deep(.feature-item:last-child::after) {
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
    margin: 50px -24px 60px;
    padding: 80px 24px 70px;
    text-align: center;
  }

  .open-source-strap .section-head {
    text-align: center;
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
  }

  .strap-actions {
    justify-content: center;
  }
}
</style>
