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
      </div>
    </div>
    <div class="section first-section">
      <div class="section-header">
        <div class="section-title-wrapper">
          <div class="section-title">Typical workload</div>
          <div class="section-tagline">Maximum usage levels typically supported by this plan. These are estimates, not hard&nbsp;limits.</div>
        </div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" class="plan-column"></div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Monthly active users</div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" :data-plan="plan.name" class="plan-column">
          <div class="metric-value">{{ plan.monthlyActiveUsers }}</div>
        </div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Writes per minute</div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" :data-plan="plan.name" class="plan-column">
          <div class="metric-value">{{ plan.writesPerMinute }}</div>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="section-header">
        <div class="section-title-wrapper">
          <div class="section-title">Source databases</div>
          <div class="section-tagline">A "source" is a sync service for a Postgres database. Each source gets a unique&nbsp;URL.</div>
        </div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" class="plan-column"></div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Monthly active sources</div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" :data-plan="plan.name" class="plan-column">
          <div class="metric-value">{{ formatNumber(plan.sources) }}</div>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="section-header">
        <div class="section-title-wrapper">
          <div class="section-title">Database ingestion</div>
          <div class="section-tagline">An "operation processed" is a change ingested from Postgres and written to a shape log. 3 inserts written to 3 shapes = 9 operations&nbsp;processed.</div>
        </div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" class="plan-column"></div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Operations processed</div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" :data-plan="plan.name" class="plan-column">
          <div class="metric-value">{{ formatNumber(plan.operations) }}</div>
        </div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Data ingested</div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" :data-plan="plan.name" class="plan-column">
          <div class="metric-value">{{ formatStorage(plan.gbProcessed) }}</div>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="section-header">
        <div class="section-title-wrapper">
          <div class="section-title">Shape retention</div>
          <div class="section-tagline">Electric caches shapes on disk and deletes inactive shapes after a retention period. Clients re-connecting to deleted shapes re-sync from scratch.</div>
        </div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" class="plan-column"></div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Active shapes</div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" :data-plan="plan.name" class="plan-column">
          <div class="metric-value">{{ formatNumber(plan.shapes) }}</div>
        </div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Inactive shape retention</div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" :data-plan="plan.name" class="plan-column">
          <div class="metric-value">{{ plan.shapeRetention }}</div>
        </div>
      </div>
    </div>
    <div class="section">
      <div class="section-header">
        <div class="section-title-wrapper">
          <div class="section-title">Delivery to clients</div>
          <div class="section-tagline">Electric Cloud's built-in CDN enables unlimited data delivery to any number of clients—without any fan-out limits or charges.</div>
        </div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" class="plan-column"></div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Operations delivered</div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" :data-plan="plan.name" class="plan-column">
          <div class="metric-value">Unlimited</div>
        </div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Data delivered</div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" :data-plan="plan.name" class="plan-column">
          <div class="metric-value">Unlimited</div>
        </div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Active clients</div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" :data-plan="plan.name" class="plan-column">
          <div class="metric-value">Unlimited</div>
        </div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Concurrent clients</div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" :data-plan="plan.name" class="plan-column">
          <div class="metric-value">Unlimited</div>
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
          :size="small"
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

.table-header {
  display: grid;
  grid-template-columns: 2fr repeat(4, 1fr);
  border-bottom: 1.5px solid rgba(255, 255, 255, 0.08);
  background: var(--vp-sidebar-bg-color);
}

.table-header .metric-column {
  padding: 20px 14px 28px 20px;
}

.table-header .plan-column {
  padding: 20px 14px 18px;
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
  padding: 24px 16px 16px 20px;
}

.section-header .section-title {
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin-bottom: 10px;
}

.section-header .section-tagline {
  font-size: 0.825rem;
  color: var(--vp-c-text-3);
  line-height: 1.5;
  max-width: 700px;
}

.section-header .plan-column {
  padding: 12px;
  border-left: 1.5px solid rgba(255, 255, 255, 0.08);
}

.metric-row {
  display: grid;
  grid-template-columns: 2fr repeat(4, 1fr);
  border-top: 1.5px solid rgba(255, 255, 255, 0.08);
}

.metric-row:first-of-type {
  border-top: none;
}

.metric-row .metric-column {
  padding: 12px 16px 12px 20px;
  text-align: left;
}

.metric-row:last-child .metric-column {
  padding-bottom: 20px;
}

.metric-row .plan-column {
  padding: 12px;
  border-left: 1.5px solid rgba(255, 255, 255, 0.08);
  text-align: center;
}

.metric-label {
  font-size: 0.925rem;
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
  padding: 24px 16px;
}

.cta-row .plan-column {
  padding: 24px 16px;
  border-left: 1.5px solid rgba(255, 255, 255, 0.08);
  display: flex;
  justify-content: center;
  align-items: center;
}

@media (max-width: 959px) {
  .table-header {
    display: none;
  }

  .section-header {
    display: block;
  }

  .section-header .section-title {
    padding: 20px 16px 12px;
    font-size: 1rem;
  }

  .section-header .section-tagline {
    grid-column: auto;
    padding: 0 16px 16px;
  }

  .metric-row {
    display: block;
    background: rgba(255, 255, 255, 0.02);
    border-radius: 8px;
    margin: 0 16px 16px;
  }

  .metric-row .metric-column {
    padding: 12px 16px 12px;
  }

  .metric-label {
    font-weight: 600;
    color: var(--vp-c-text-1);
  }

  .metric-row .plan-column {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 16px;
    border-left: none;
    border-top: 1.5px solid rgba(255, 255, 255, 0.08);
  }

  .metric-row .plan-column:first-of-type {
    border-top: none;
  }

  .plan-column::before {
    content: attr(data-plan);
    font-size: 0.8rem;
    color: var(--vp-c-text-3);
    font-weight: 500;
  }

  .metric-column,
  .plan-column {
    text-align: left;
  }

  .cta-row {
    display: block;
    margin: 16px;
  }

  .cta-row .metric-column {
    display: none;
  }

  .cta-row .plan-column {
    padding: 12px 16px;
    border-left: none;
    border-top: 1.5px solid rgba(255, 255, 255, 0.08);
  }

  .cta-row .plan-column:first-of-type {
    border-top: none;
  }

  .cta-row .plan-column::before {
    content: none;
  }
}
</style>
