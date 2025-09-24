---
layout: home
title: Pricing
description: >-
  Electric has a generous free tier with low-cost usage-based pricing and additional support for teams that need to ship faster.
hideReleaseBanner: true
---

<script setup>
import Section from './src/components/home/Section.vue'
import PricingCard from './src/components/pricing/PricingCard.vue'
import { data as pricing } from './data/pricing.data.ts'
</script>

<p class="intro-zap-container">
  <img src="/img/home/zap-with-halo.svg"
      alt="Electric zap with halo"
      class="intro-zap"
  />
</p>

<Section :actions="[]">
  <template #title>
    Scalable pricing for
    <span class="no-wrap">teams of all sizes</span>
  </template>
  <template #tagline>
    <a href="/product/cloud">Electric Cloud</a> has a generous free tier with scalable,
    <span class="no-wrap">usage-based</span> <span class="no-wrap">pricing-tiers</span> and <span class="no-wrap-lg">additional support to get</span> <span class="no-wrap">teams into</span> <span class="no-wrap">production faster</span>.
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

<style scoped>
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
</style>
