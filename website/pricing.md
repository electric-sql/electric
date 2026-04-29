---
layout: page
title: Cloud Pricing
titleTemplate: false
description: >-
  Electric Cloud has usage-based pricing with unlimited data delivery. Pay for writes and retention, not egress.
sidebar: false
hideReleaseBanner: true
pageClass: pricing-page
mdExport:
  mode: parse-html
---

<script setup>
import { VPButton } from 'vitepress/theme'
import EaSection from './src/components/agents-home/Section.vue'
import MidPageStrap from './src/components/MidPageStrap.vue'
import PricingCard from './src/components/pricing/PricingCard.vue'
import ComparisonTable from './src/components/pricing/ComparisonTable.vue'
import PricingCalculator from './src/components/pricing/PricingCalculator.vue'
import PricingFanoutDiagram from './src/components/pricing/PricingFanoutDiagram.vue'
import { data as pricing } from './data/pricing.data.ts'
import { useMarkdownExport } from './src/lib/useMarkdownExport'

import LogoStrip from '/static/img/blog/electric-beta-release/logo-strip.svg'
import LogoStripSm from '/static/img/blog/electric-beta-release/logo-strip.sm.svg'
import LogoStripXs from '/static/img/blog/electric-beta-release/logo-strip.xs.svg'
import LogoStripXxs from '/static/img/blog/electric-beta-release/logo-strip.xxs.svg'

const tiers = pricing.tiers
const services = pricing.services
const enterprise = pricing.enterprise
const comparisonPlans = pricing.comparisonPlans
const config = pricing.config
const isMarkdownExport = useMarkdownExport()
</script>

<MdExportParseHtml>
<section class="pr-hero">
  <div class="pr-hero-inner">
    <h1 class="pr-hero-name">
      Cloud&nbsp;<span class="pr-hero-accent">Pricing</span>
    </h1>
    <p class="pr-hero-text">
      Pay for writes and retention. Reads are&nbsp;free
    </p>
    <p class="pr-hero-tagline">
      <a href="/cloud/">Electric Cloud</a> charges for data ingress and
      retention. Egress, fan-out, concurrent users, and data delivery are
      unlimited at no additional&nbsp;cost.
    </p>
    <div class="pr-hero-row">
      <VPButton
        href="https://dashboard.electric-sql.cloud"
        text="Sign up"
        theme="brand"
        size="medium"
      />
      <VPButton
        href="/about/contact#sales"
        text="Contact sales"
        theme="alt"
        size="medium"
      />
    </div>
  </div>
</section>

<EaSection id="plans">
  <PricingFanoutDiagram class="pricing-illustration" />

  <div class="pricing-grid">
    <PricingCard
      v-for="tier in tiers"
      :key="tier.slug"
      :plan="tier"
    />
  </div>
</EaSection>

<EaSection id="customers" :dark="true">
  <figure class="logo-strap md-exclude">
    <img :src="LogoStrip" class="hidden-md" alt="Used by Google, Supabase, Trigger.dev, otto, and Doorboost" />
    <img :src="LogoStripXxs" class="block-md hidden-sm logo-strap-md" alt="Used by Google, Supabase, Trigger.dev, otto, and Doorboost" />
    <img :src="LogoStripXxs" class="block-sm hidden-md logo-strap-sm" alt="Used by Google, Supabase, Trigger.dev, otto, and Doorboost" />
  </figure>
</EaSection>

<EaSection
  id="support"
  title="Need more&nbsp;support?"
  subtitle="Hands-on help and bespoke solutions for teams that need&nbsp;more."
>
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
</EaSection>

<EaSection
  id="unlimited-delivery"
  :dark="true"
  title="Unlimited data&nbsp;delivery"
  subtitle="We don't charge for egress, data delivery, fan-out, active clients, connections, number of services — or monthly bills under&nbsp;$5/month."
>
  <div class="delivery-callout">
    <h3>Powered by CDN caching</h3>
    <p>
      Electric delivers real-time data over HTTP, using CDN caching and
      request collapsing to handle millions of concurrent readers without
      proportional infrastructure cost. Your costs scale with writes,
      not&nbsp;users.
    </p>
  </div>
  <template #actions>
    <VPButton
      href="https://dashboard.electric-sql.cloud"
      text="Sign up"
      theme="brand"
      size="medium"
    />
    <VPButton
      href="/docs/sync/api/http"
      text="Learn more"
      theme="alt"
      size="medium"
    />
  </template>
</EaSection>

<EaSection
  id="details"
  title="Compare plans"
  subtitle="Usage-based pricing with volume discounts on higher&nbsp;tiers."
>
  <ComparisonTable :comparisonPlans="comparisonPlans" :config="config" />
</EaSection>

<EaSection
  id="calculator"
  :dark="true"
  title="Model your workload"
  subtitle="Use our calculator to find the right plan for your&nbsp;workload."
  v-if="!isMarkdownExport"
>
  <PricingCalculator />
</EaSection>

<MidPageStrap id="contact">
  <template #title>
    Get in&nbsp;touch
  </template>
  <template #tagline>
    Let's chat through your requirements and see how we can&nbsp;help.
  </template>
  <template #actions>
    <VPButton
      href="/about/contact#sales"
      text="Contact sales"
      theme="brand"
      size="medium"
    />
    <VPButton
      href="https://discord.electric-sql.com"
      text="Ask on Discord"
      theme="alt"
      size="medium"
    />
  </template>
</MidPageStrap>

<EaSection id="faq" :dark="true" title="Frequently asked&nbsp;questions">
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
</EaSection>

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
/* Pricing hero — mirrors the agents / streams / sync / cloud landing
   page heroes so the four product landing pages and pricing feel like
   a matched set: centered name with brand-coloured accent, then a
   strapline, supporting tagline, and a row of CTAs. */

.pr-hero {
  position: relative;
  padding: 72px 24px 56px;
  text-align: center;
  overflow: hidden;
}

.pr-hero-inner {
  position: relative;
  z-index: 1;
  max-width: 860px;
  margin: 0 auto;
}

.pr-hero-name {
  font-size: 56px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: var(--vp-c-text-1);
  margin: 0;
  padding-bottom: 4px;
  text-wrap: balance;
}

.pr-hero-accent {
  color: var(--vp-c-brand-1);
}

.pr-hero-text {
  font-size: 28px;
  font-weight: 500;
  color: var(--vp-c-text-1);
  margin: 16px auto 0;
  max-width: 720px;
  line-height: 1.35;
  text-wrap: balance;
}

.pr-hero-tagline {
  font-family: var(--vp-font-family-base);
  font-size: 17px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  margin: 18px auto 0;
  max-width: 640px;
  line-height: 1.6;
  text-wrap: pretty;
}

.pr-hero-tagline a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
  border-bottom: 1px solid
    color-mix(in srgb, var(--vp-c-brand-1) 35%, transparent);
}

.pr-hero-tagline a:hover {
  border-bottom-color: var(--vp-c-brand-1);
}

.pr-hero-row {
  margin-top: 28px;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.pricing-illustration {
  margin: 0 auto 56px;
  max-width: 1040px;
}

.pricing-grid {
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
  .pr-hero {
    padding: 44px 20px 32px;
  }

  .pr-hero-name {
    font-size: 30px;
  }

  .pr-hero-text {
    font-size: 20px;
  }

  .pr-hero-tagline {
    font-size: 15px;
  }

  .pr-hero-row {
    flex-direction: column;
    align-items: stretch;
    max-width: 280px;
    margin-left: auto;
    margin-right: auto;
  }

  .pricing-grid {
    grid-template-columns: 1fr;
    gap: 24px;
  }
}

@media (max-width: 959px) {
  .pr-hero {
    padding: 56px 24px 40px;
  }

  .pr-hero-name {
    font-size: 38px;
  }

  .pr-hero-text {
    font-size: 22px;
  }

  .pr-hero-tagline {
    font-size: 16px;
  }
}

/* "Powered by CDN caching" sub-callout inside the unlimited-delivery
   section. Rendered as a tertiary block below the section header — same
   prose tone as the section subtitle but bumped down a level visually. */
.delivery-callout {
  max-width: 720px;
}

.delivery-callout h3 {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.01em;
  color: var(--vp-c-text-1);
  margin: 0 0 10px;
}

.delivery-callout p {
  font-size: 16px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  margin: 0;
}

.logo-strap {
  margin: 0;
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

@media (max-width: 529px) {
  .logo-strap {
    margin-top: 24px;
    margin-bottom: 56px;
  }
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
  background: var(--ec-surface-1);
  border: 1px solid var(--ec-border-1);
  border-radius: 12px;
  overflow: hidden;
}

.support-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.support-option {
  padding: 36px 36px 28px;
}

.support-option + .support-option {
  border-left: 1px solid var(--ec-border-1);
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
  margin: 0;
}

.support-cta {
  text-align: center;
  padding: 24px 36px 32px;
  border-top: 1px solid var(--ec-border-1);
}

@media (max-width: 639px) {
  .support-options {
    grid-template-columns: 1fr;
  }
  .support-option {
    padding: 28px 24px 24px;
  }
  .support-option + .support-option {
    border-left: none;
    border-top: 1px solid var(--ec-border-1);
  }
  .support-cta {
    padding: 20px 24px 28px;
  }
}

.faq-list {
  margin: 0;
}

.faq-item {
  background: var(--ec-surface-1);
  border: 1px solid var(--ec-border-1);
  border-radius: 8px;
  margin-bottom: 10px;
  overflow: hidden;
  transition: border-color 0.2s, background 0.2s;
}

.faq-item:hover {
  border-color: var(--ec-border-2);
}

.faq-item[open] {
  border-color: var(--ec-border-2);
}

.faq-item summary {
  padding: 14px 18px;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.faq-item summary::-webkit-details-marker {
  display: none;
}

.faq-item summary::before {
  content: "+";
  flex-shrink: 0;
  width: 14px;
  text-align: center;
  font-weight: 500;
  color: var(--vp-c-text-3);
  transition: color 0.2s;
}

.faq-item:hover summary::before {
  color: var(--electric-color);
}

.faq-item[open] summary::before {
  content: "\2212";
  color: var(--electric-color);
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
</MdExportParseHtml>
