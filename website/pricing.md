---
layout: home
title: Pricing
description: >-
  Electric Cloud has usage-based pricing with unlimited data delivery. Pay for writes and retention, not egress.
hideReleaseBanner: true
---

<script setup>
import Section from './src/components/home/Section.vue'
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
const config = pricing.config
</script>

<Section :actions="[]">
  <template #title>
    Placeholder hero title
  </template>
  <template #tagline>
    Placeholder hero tagline for the
    <a href="/product/cloud">Electric Cloud</a>
    pricing page.
  </template>
  <div class="ingress-egress-illustration">
    <p class="illustration-placeholder">[Ingress/Egress illustration — to be designed]</p>
  </div>
  <div class="pricing-grid">
    <PricingCard
      v-for="tier in tiers"
      :key="tier.slug"
      :plan="tier"
    />
  </div>
</Section>

<figure class="logo-strap">
  <img :src="LogoStrip" class="hidden-md" />
  <img :src="LogoStripXxs" class="block-md hidden-sm logo-strap-md" />
  <img :src="LogoStripXxs" class="block-sm hidden-md logo-strap-sm" />
</figure>

<Section :actions="[]">
  <template #title>Need more support?</template>
  <template #tagline>Placeholder tagline</template>
  <div class="support-card">
    <div class="support-options">
      <div class="support-option">
        <h3>Accelerate</h3>
        <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
      </div>
      <div class="support-option">
        <h3>Enterprise</h3>
        <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
      </div>
    </div>
    <div class="support-cta">
      <VPButton href="/about/contact#sales" text="Contact sales" theme="alt" />
    </div>
  </div>
</Section>

<div class="open-source-strap">
  <div class="section-head">
    <h1>Unlimited data delivery</h1>
    <p>
      We don't charge for egress, data delivery, fan-out, active users,
      concurrent users, clients, connections, seats, apps, sources — or monthly
      bills under $5/month.
    </p>
  </div>
  <div class="section-head" style="margin-top: 24px;">
    <h2 style="font-size: 1.25rem; margin-bottom: 12px;">Using existing CDN infrastructure</h2>
    <p>
      We uniquely can do this because we deliver real-time data through
      existing CDN infrastructure. Using caching and request-collapsing to handle
      concurrency at the CDN layer.
    </p>
  </div>
  <div class="strap-actions">
    <div class="action">
      <VPButton
        href="https://dashboard.electric-sql.cloud"
        text="Sign up"
        theme="brand"
      />
      &nbsp;
      <VPButton
        href="/docs/api/http"
        text="Learn more"
        theme="alt"
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
  <ComparisonTable :comparisonPlans="comparisonPlans" :config="config" />
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

<Section :actions="[]">
  <template #title>Frequently asked questions</template>
  <div class="faq-list">
    <details class="faq-item">
      <summary>Lorem ipsum question one?</summary>
      <p>Lorem ipsum answer one. Placeholder content to be replaced.</p>
    </details>
    <details class="faq-item">
      <summary>Lorem ipsum question two?</summary>
      <p>Lorem ipsum answer two. Placeholder content to be replaced.</p>
    </details>
    <details class="faq-item">
      <summary>Lorem ipsum question three?</summary>
      <p>Lorem ipsum answer three. Placeholder content to be replaced.</p>
    </details>
    <details class="faq-item">
      <summary>Lorem ipsum question four?</summary>
      <p>Lorem ipsum answer four. Placeholder content to be replaced.</p>
    </details>
    <details class="faq-item">
      <summary>Lorem ipsum question five?</summary>
      <p>Lorem ipsum answer five. Placeholder content to be replaced.</p>
    </details>
  </div>
</Section>

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
.pricing-grid {
  margin: 40px 0 40px;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 24px;
  align-items: start;
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

.ingress-egress-illustration {
  margin: 40px 0;
  padding: 40px;
  background: rgba(255, 255, 255, 0.03);
  border: 0.5px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  text-align: center;
}

.illustration-placeholder {
  color: var(--vp-c-text-3);
  font-style: italic;
}

.support-card {
  margin: 40px 0;
  padding: 40px;
  background: rgba(255, 255, 255, 0.03);
  border: 0.5px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
}

.support-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 40px;
  margin-bottom: 32px;
}

.support-option h3 {
  font-size: 1.25rem;
  font-weight: 650;
  color: var(--vp-c-text-1);
  margin-bottom: 12px;
}

.support-option p {
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}

.support-cta {
  text-align: center;
}

@media (max-width: 639px) {
  .support-options {
    grid-template-columns: 1fr;
    gap: 24px;
  }
}

.faq-list {
  margin: 40px 0;
}

.faq-item {
  background: rgba(255, 255, 255, 0.03);
  border: 0.5px solid rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  margin-bottom: 12px;
  overflow: hidden;
}

.faq-item summary {
  padding: 16px 20px;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  cursor: pointer;
  list-style: none;
}

.faq-item summary::-webkit-details-marker {
  display: none;
}

.faq-item summary::before {
  content: "+";
  display: inline-block;
  width: 20px;
  font-weight: 400;
  color: var(--vp-c-text-3);
}

.faq-item[open] summary::before {
  content: "\2212";
}

.faq-item p {
  padding: 0 20px 16px 40px;
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
  line-height: 1.6;
}
</style>
