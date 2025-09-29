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
import { data as pricing } from './data/pricing.data.ts'

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
    has a generous free tier, fixed monthly pricing with unlimited fan-out
    and <span class="no-wrap-lg">additional support to get</span> <span class="no-wrap">teams into</span> <span class="no-wrap">production faster</span>.
  </template>
  <div class="pricing-grid">
    <!-- Main Pricing Tiers -->
    <PricingCard
      v-for="tier in pricing.tiers"
      :key="tier.slug"
      :name="tier.name"
      :price="tier.price"
      :period="tier.period"
      :operations="tier.operations"
      :shapes="tier.shapes"
      :sources="tier.sources"
      :gbProcessed="tier.gbProcessed"
      :featuresLabel="tier.featuresLabel"
      :features="tier.features"
      :contactNote="tier.contactNote"
      :ctaText="tier.ctaText"
      :ctaHref="tier.ctaHref"
      :ctaTheme="tier.ctaTheme"
    />
    <!-- Divider -->
    <div class="pricing-divider"></div>
    <!-- Accelerate Service -->
    <PricingCard
      v-for="service in pricing.services"
      :key="service.slug"
      :name="service.name"
      :price="service.price"
      :period="service.period"
      :proposition="service.proposition"
      :description="service.description"
      :features="service.features"
      :ctaText="service.ctaText"
      :ctaHref="service.ctaHref"
      :ctaTheme="service.ctaTheme"
      priceColor="ddn"
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
      name="Enterprise"
      proposition="Custom pricing and enterprise solutions"
      ctaText="Contact sales"
      ctaHref="/about/contact#sales"
      ctaTheme="alt"
      priceColor="ddn"
    >
      <template #description>
        <p>We offer overage pricing for large workloads and can provide custom infrastructure, integration or project solutions.</p>
      </template>
    </PricingCard>
  </div>
</Section>

<div class="open-source-strap">
  <div class="section-head">
    <h1>Open source</h1>
    <p>
      Want free with unlimited use? Electric is fully open-source and designed for self-hosting.
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
    Comparison
  </template>
  <template #tagline>
    Choosing a plan &mdash; compare options and see what's right for you.
  </template>
  <ComparisonTable :comparisonPlans="pricing.comparisonPlans" />
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
  grid-template-columns: 1fr 1fr 1fr 2px 1fr;
  gap: 24px;
  align-items: start;
}

.pricing-divider {
  width: 0.5px;
  margin: 8px 0;
  background: rgba(255, 255, 255, 0.1);
  justify-self: center;
  align-self: stretch;
}

/* Responsive Design */
@media (max-width: 1149px) and (min-width: 806px) {
  .pricing-grid {
    grid-template-columns: 1fr 1fr 1fr;
    gap: 24px;
  }

  .pricing-divider {
    display: none;
  }

  .pricing-card:has(.service-content) {
    grid-column: 1 / -1;
  }
}

@media (max-width: 805px) and (min-width: 530px) {
  .pricing-grid {
    grid-template-columns: 1fr 1fr;
    gap: 22px;
  }

  .pricing-divider {
    display: none;
  }
}

@media (max-width: 529px) {
  .pricing-grid {
    grid-template-columns: 1fr;
    gap: 24px;
  }

  .pricing-divider {
    display: none;
  }

  .pricing-card:has(.service-content) {
    grid-column: 1;
    margin-top: 0;
  }
}

/* Enterprise Section */
.enterprise-card {
  margin: 40px 0 0;
}

.enterprise-card :deep(.card-name) {
  margin: 0;
  color: var(--ddn-color);
}

/* Reduce spacing around both sections */
.page-section {
  padding: 10px 0;
}

/* Comparison Section */
.page-section:has(.comparison-table) {
  padding-top: 50px;
}

/* Open Source Strap */
.open-source-strap {
  margin: 50px -400px 60px;
  padding: 90px 400px 116px;
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
