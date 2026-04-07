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
import IngressEgressIllustration from './src/components/pricing/IngressEgressIllustration.vue'
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
    Pay for writes and retention. Reads&nbsp;are&nbsp;free.
  </template>
  <template #tagline>
    <a href="/product/cloud">Electric Cloud</a> charges for data
    ingress and retention. Egress, fan-out, concurrent users, and data
    delivery are unlimited at no additional&nbsp;cost.
  </template>
  <IngressEgressIllustration />
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
  <template #tagline>
    Hands-on help and bespoke solutions
    <span class="no-wrap-xs">for teams that need&nbsp;more</span>.
  </template>
  <div class="support-card">
    <div class="support-options">
      <div class="support-option">
        <h3>Scale</h3>
        <p>Proactive, hands-on support from the Electric team. Architecture
          reviews, integration guidance, and direct access to founders to
          help you ship faster.</p>
      </div>
      <div class="support-option">
        <h3>Enterprise</h3>
        <p>Bespoke solutions for teams with custom requirements.
          Unlimited databases, custom SLAs, and dedicated support.</p>
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
      clients, or connections — or monthly bills under $5/month.
    </p>
  </div>
  <div class="section-head" style="margin-top: 24px;">
    <h2 style="font-size: 1.25rem; margin-bottom: 12px;">Powered by CDN caching</h2>
    <p>
      Electric delivers real-time data over HTTP, using CDN caching and
      request collapsing to handle millions of concurrent readers without
      proportional infrastructure cost. Your costs scale with writes,
      not users.
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
    Usage-based pricing with <span class="no-wrap-xs">volume discounts <span class="no-wrap">on higher tiers</span></span>.
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
      <summary>What counts as a write?</summary>
      <p>A write is a message written to a durable stream, up to 10 KB in
        size. Messages larger than 10 KB are automatically chunked into
        multiple write units — for example, a 1 MB message counts as 100
        write units.</p>
    </details>
    <details class="faq-item">
      <summary>Why don't you charge for reads or egress?</summary>
      <p>Electric delivers real-time data over HTTP using CDN caching and
        request collapsing. This means concurrent readers are handled at the
        CDN layer without proportional infrastructure cost. Your costs scale
        with data written, not with the number of users reading it.</p>
    </details>
    <details class="faq-item">
      <summary>What are service costs?</summary>
      <p>Services that run additional infrastructure carry an additional cost
        on top of the base write rate. Postgres Sync adds +$2 per 1M writes,
        metered on the filtered shape log output (the writes emitted to
        shapes, not the raw replication input). This gives an effective rate
        of $3 per 1M writes for live Postgres changes. Initial sync and
        snapshots are billed at the base rate only.</p>
    </details>
    <details class="faq-item">
      <summary>How does the monthly fee work on Pro and Scale?</summary>
      <p>The monthly fee on Pro ($249) and Scale ($1,999) acts as a prepaid
        usage credit. Your usage is calculated at the discounted rate (10%
        off for Pro, 20% off for Scale) and if it stays under the monthly
        fee, you pay only the fee. Usage above the fee is billed as
        overage.</p>
    </details>
    <details class="faq-item">
      <summary>Do I need a credit card for the PAYG plan?</summary>
      <p>No. You can sign up and start building without a payment method. We
        waive monthly usage under $5. If your usage grows past $10 (or $5 if
        your workspace was blocked in the previous billing month), we'll ask
        you to add a payment method to continue.</p>
    </details>
    <details class="faq-item">
      <summary>How is retention measured?</summary>
      <p>Retention is measured in byte-seconds — the amount of data stored
        and for how long. This is converted to GB-months for billing at
        $0.10 per GB-month. Retention accounts for TTL-based automatic
        deletion, so you only pay for data that's actually retained.</p>
    </details>
    <details class="faq-item">
      <summary>Can I upgrade or downgrade my plan?</summary>
      <p>Yes. You can upgrade from PAYG to Pro, PAYG to Scale, or Pro to
        Scale at any time — upgrades take effect immediately with prorated
        charges. Downgrades take effect at the end of your current billing
        period, provided your usage is within the target plan's limits.</p>
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

.billing-dimensions {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 32px;
  text-align: center;
}

.dimension {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.dimension-rate {
  font-size: 2rem;
  font-weight: 700;
  color: var(--electric-color);
  line-height: 1.2;
}

.dimension-free .dimension-rate {
  color: var(--vp-c-green-1, #42b883);
}

.dimension-label {
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--vp-c-text-1);
}

.dimension-detail {
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
  margin-top: 2px;
}

@media (max-width: 529px) {
  .billing-dimensions {
    grid-template-columns: 1fr;
    gap: 24px;
  }
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
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.faq-item summary::-webkit-details-marker {
  display: none;
}

.faq-item summary::before {
  content: "+";
  flex-shrink: 0;
  width: 14px;
  text-align: center;
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

.faq-item p:first-of-type {
  margin-top: -10px !important;
}
</style>
