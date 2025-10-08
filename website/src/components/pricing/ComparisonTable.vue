<script setup>
const { comparisonPlans } = defineProps(['comparisonPlans'])

function formatNumber(num) {
  if (typeof num === 'string') return num
  if (num >= 1000000000) {
    const value = num / 1000000000
    return value % 1 === 0 ? value + 'B' : value.toFixed(1) + 'B'
  }
  if (num >= 1000000) {
    const value = num / 1000000
    return value % 1 === 0 ? value + 'M' : value.toFixed(1) + 'M'
  }
  if (num >= 1000) {
    const value = num / 1000
    return value % 1 === 0 ? value + 'K' : value.toFixed(1) + 'K'
  }
  return num.toString()
}

function formatStorage(num) {
  if (typeof num === 'string') return num
  if (num >= 1000) {
    const value = num / 1000
    return value % 1 === 0 ? value + 'TB' : value.toFixed(1) + 'TB'
  }
  return num + 'GB'
}
</script>

<template>
  <div class="comparison-table">
    <div class="table-header">
      <div class="metric-column header-spacer"></div>
      <div v-for="plan in comparisonPlans" :key="plan.slug" class="plan-column">
        <div class="plan-name">{{ plan.name }}</div>
        <VPButton
          :href="plan.ctaHref"
          :text="plan.ctaText"
          :theme="plan.ctaTheme"
          size="small"
          class="cta-large"
        />
        <VPButton
          :href="plan.ctaHref"
          :text="plan.ctaTextSmall || plan.ctaText"
          :theme="plan.ctaTheme"
          size="small"
          class="cta-small"
        />
      </div>
    </div>
    <div class="section first-section">
      <div class="section-header">
        <div class="section-title-wrapper">
          <div class="section-title">Typical workload</div>
          <div class="section-tagline">
            Maximum usage levels typically supported by this plan.
            <span class="no-wrap-xs">
              These are estimates, not hard&nbsp;limits</span>.</div>
        </div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" class="plan-column"></div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Monthly active users</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">{{ plan.monthlyActiveUsers }}</div>
        </div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Writes per minute</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">{{ plan.writesPerMinute }}</div>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="section-header">
        <div class="section-title-wrapper">
          <div class="section-title">Source databases</div>
          <div class="section-tagline">
            A "source" is a Postgres database connected to an
            <span class="no-wrap-xs">
              Electric sync&nbsp;service.
              Typically one per app/env.</span>
          </div>
        </div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" class="plan-column"></div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Monthly active sources</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">{{ formatNumber(plan.sources) }}</div>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="section-header">
        <div class="section-title-wrapper">
          <div class="section-title">Data processing</div>
          <div class="section-tagline">
            An "operation processed" is a change ingested from Postgres and
            <span class="no-wrap-xs">
              written to a shape&nbsp;log</span>.
            <span class="hidden-sm">
              3 inserts written to
              3 shapes = 9 operations&nbsp;processed.</span>
          </div>
        </div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" class="plan-column"></div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Operations processed</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">{{ formatNumber(plan.operations) }}</div>
        </div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Data ingested</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">{{ formatStorage(plan.gbProcessed) }}</div>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="section-header">
        <div class="section-title-wrapper">
          <div class="section-title">Shape retention</div>
          <div class="section-tagline">
            Electric caches shapes on disk and deletes inactive shapes after a retention&nbsp;period.
            <span class="hidden-sm">
              Clients re-connecting to deleted shapes re-sync from scratch.</span>
          </div>
        </div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" class="plan-column"></div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Active shapes</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">{{ formatNumber(plan.shapes) }}</div>
        </div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Inactive shape retention</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">{{ plan.shapeRetention }}</div>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="section-header">
        <div class="section-title-wrapper">
          <div class="section-title">Delivery to clients</div>
          <div class="section-tagline">
            Electric Cloud's built-in CDN enables unlimited data delivery to
            <span class="no-wrap-xs">any number of&nbsp;clients</span><span class="hidden-sm"> &mdash; <span class="no-wrap-sm">without any fan-out limits or&nbsp;charges</span></span>.</div>
        </div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" class="plan-column"></div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Operations delivered</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">Unlimited</div>
        </div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Data delivered</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">Unlimited</div>
        </div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Active clients</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">Unlimited</div>
        </div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Concurrent clients</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">Unlimited</div>
        </div>
      </div>
    </div>
    <div class="cta-row">
      <div class="metric-column"></div>
      <div v-for="plan in comparisonPlans" :key="plan.slug" class="plan-column">
        <VPButton
          :href="plan.ctaHref"
          :text="plan.ctaText"
          :theme="plan.ctaTheme"
          size="small"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.comparison-table {
  margin: 40px 0;
  background: rgba(255, 255, 255, 0.015);
  border: 1.5px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  overflow: hidden;
}

@media (max-width: 959px) {
  .comparison-table {
    overflow: visible;
    position: relative;
  }
}

.table-header {
  display: grid;
  grid-template-columns: 2fr repeat(4, 1fr);
  border-bottom: 1.5px solid rgba(255, 255, 255, 0.08);
  background: var(--vp-sidebar-bg-color);
}

.table-header .metric-column {
  padding: 16px 14px 24px 20px;
}

.table-header .plan-column {
  padding: 16px 14px 14px;
  border-left: 1.5px solid rgba(255, 255, 255, 0.08);
}

.header-spacer {
  grid-column: 1;
}

.plan-name {
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  text-align: center;
}

.section {
  border-top: 1.5px solid rgba(255, 255, 255, 0.08);
}

.first-section {
  border-top: none;
}

.section:nth-child(odd) {
  background: rgba(255, 255, 255, 0.0375);
}

.section-header {
  display: grid;
  grid-template-columns: 2fr repeat(4, 1fr);
}

.section-header .section-title-wrapper {
  padding: 16px 16px 12px 16px;
}

.section-header .section-title {
  font-size: 1.075rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin-bottom: 10px;
}

.section-header .section-tagline {
  font-size: 0.775rem;
  color: var(--vp-c-text-3);
  line-height: 1.5;
  max-width: 700px;
}

.section-header .plan-column {
  padding: 10px;
  border-left: 1.5px solid rgba(255, 255, 255, 0.08);
}

.metric-row {
  display: grid;
  grid-template-columns: 2fr 4fr;
  border-top: 1.5px solid rgba(255, 255, 255, 0.08);
}

.metric-row:first-of-type {
  border-top: none;
}

.metric-row .metric-column {
  padding: 10px 14px 10px 16px;
  text-align: left;
}

.metric-row:last-child .metric-column {
  padding-bottom: 14px;
}

.metric-row .plan-column {
  padding: 0;
  border-left: 1.5px solid rgba(255, 255, 255, 0.08);
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0;
}

.metric-row .plan-column .metric-value {
  padding: 10px;
  text-align: center;
  border-left: 1.5px solid rgba(255, 255, 255, 0.08);
}

.metric-row .plan-column .metric-value:first-child {
  border-left: none;
}

.metric-value {
  font-size: 0.875rem;
  color: var(--vp-c-text-1-5);
  font-weight: 500;
}

.metric-label {
  font-size: 0.875rem;
  color: var(--vp-c-text-1);
  font-weight: 500;
}

.metric-value {
  font-size: 0.875rem;
  color: var(--vp-c-text-1-5);
  font-weight: 500;
}

.cta-row {
  display: grid;
  grid-template-columns: 2fr repeat(4, 1fr);
  border-top: 1.5px solid rgba(255, 255, 255, 0.1);
}

.cta-row .metric-column {
  padding: 18px 14px 22px;
}

.cta-row .plan-column {
  padding: 18px 14px 22px;
  border-left: 1.5px solid rgba(255, 255, 255, 0.08);
  display: flex;
  justify-content: center;
  align-items: center;
}

@media (max-width: 959px) {
  .table-header {
    display: flex;
    width: 100%;
    gap: 0;
    position: -webkit-sticky;
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--vp-sidebar-bg-color);
    padding: 0;
    border-bottom: 1.5px solid rgb(45, 45, 49);
    border-radius: 12px 12px 0 0;
  }

  .table-header .header-spacer {
    display: none;
  }

  .table-header .plan-column {
    flex: 1;
    padding: 0;
    border-left: none;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .table-header .plan-name {
    font-size: 0.95rem;
    font-weight: 600;
    text-align: center;
    padding: 14px 8px 12px;
  }

  .table-header .plan-column .VPButton {
    display: inline-flex;
    margin: 0 0 19px;
  }

  .table-header .plan-column .cta-small {
    display: none;
  }

  .first-section {
    border-top: none;
  }

  .cta-row {
    display: none;
  }
}

@media (max-width: 759px) {
  .table-header .plan-column .cta-large {
    display: none;
  }

  .table-header .plan-column .cta-small {
    display: inline-flex;
  }

  .section-header .section-tagline {
    max-width: 450px;
  }
  .metric-value {
    color: var(--vp-c-text-1-5);
  }
}

@media (min-width: 960px) {
  .table-header .plan-column .cta-large,
  .table-header .plan-column .cta-small {
    display: none;
  }
}

@media (max-width: 959px) {
  .section-header {
    display: block;
    border-bottom: none;
  }

  .section-header .section-title-wrapper {
    padding: 18px 16px 16px;
  }

  .section-header .section-title {
    font-size: 1rem;
    margin-bottom: 8px;
  }

  .section-header .section-tagline {
    font-size: 0.75rem;
  }

  .section-header .plan-column {
    display: none;
  }

  .metric-row {
    display: block;
    border-width: 1px;
  }

  .metric-row .metric-column {
    padding: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .metric-row .metric-label {
    font-weight: 550;
    font-size: 0.85rem;
    padding: 12px 16px;
    display: block;
  }

  .metric-row .plan-column {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0;
    padding: 0;
    border-left: none;
  }

  .metric-row .plan-column .metric-value {
    text-align: center;
    padding: 10px 6px;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
  }

  .metric-row .plan-column .metric-value:first-child {
    border-left: none;
  }

  .metric-row .plan-column .metric-value::before {
    display: none;
  }

  .cta-row {
    display: none;
  }
}

@media (max-width: 639px) {
  .table-header .plan-column:nth-child(5) {
    display: none;
  }

  .section-header .plan-column:nth-child(5) {
    display: none;
  }

  .metric-row .plan-column {
    grid-template-columns: repeat(3, 1fr);
  }

  .metric-row .plan-column .metric-value:nth-child(4) {
    display: none;
  }

  .cta-row .plan-column:nth-child(5) {
    display: none;
  }
}
</style>
