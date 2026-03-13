<script setup>
const { comparisonPlans, config } = defineProps(['comparisonPlans', 'config'])

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

function formatLimitValue(val) {
  if (typeof val === 'string') return val
  return new Intl.NumberFormat('en-US').format(val)
}

function formatCurrency(amount, suffix) {
  // Strip trailing zeros: $1/1M, $0.9/1M, $0.08/GB-mo
  const str = amount % 1 === 0
    ? '$' + amount
    : '$' + parseFloat(amount.toFixed(4))
  return str + suffix
}

function formatCheck(val) {
  return val ? '\u2713' : '\u2014'
}

function formatFee(plan) {
  if (plan.type === 'enterprise') return 'Custom'
  if (typeof plan.monthlyFee === 'number') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(plan.monthlyFee)
  }
  return '\u2014'
}

function formatDiscount(plan) {
  if (plan.type === 'enterprise') return 'Custom'
  if (!plan.discountPercent) return '\u2014'
  return plan.discountPercent + '%'
}

function formatWriteRate(plan) {
  if (plan.type === 'enterprise') return 'Custom'
  return formatCurrency(plan.effectiveWriteRate, '/1M')
}

function formatRetentionRate(plan) {
  if (plan.type === 'enterprise') return 'Custom'
  return formatCurrency(plan.effectiveRetentionRate, '/GB-mo')
}

function getCommitment(plan) {
  return plan.commitment || '\u2014'
}

function getSupport(plan) {
  return plan.support || '\u2014'
}

function getLimitValue(plan, key) {
  if (!plan.limits) return '\u2014'
  const val = plan.limits[key]
  if (val === undefined || val === null) return '\u2014'
  return formatLimitValue(val)
}

function getFeatureGate(plan, key) {
  if (!plan.featureGates) return '\u2014'
  return formatCheck(plan.featureGates[key])
}

function computeScenarioCost(plan, scenario) {
  if (scenario.writesPerMonth === null || scenario.retentionGB === null) return '...'
  if (plan.type === 'enterprise') return 'Custom'
  const writeCost = (scenario.writesPerMonth / 1000000) * plan.effectiveWriteRate
  const retentionCost = scenario.retentionGB * plan.effectiveRetentionRate
  const total = writeCost + retentionCost
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(total)
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

    <!-- Group 1: Pricing -->
    <div class="section first-section">
      <div class="section-header">
        <div class="section-title-wrapper">
          <div class="section-title">Pricing</div>
          <div class="section-tagline">
            Usage-based pricing with volume discounts on higher tiers.
          </div>
        </div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" class="plan-column"></div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Monthly fee</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">{{ formatFee(plan) }}</div>
        </div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Usage discount</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">{{ formatDiscount(plan) }}</div>
        </div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Writes</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">{{ formatWriteRate(plan) }}</div>
        </div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Retention</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">{{ formatRetentionRate(plan) }}</div>
        </div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Commitment</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">{{ getCommitment(plan) }}</div>
        </div>
      </div>
    </div>

    <!-- Group 2: Limits & Features -->
    <div class="section">
      <div class="section-header">
        <div class="section-title-wrapper">
          <div class="section-title">Limits &amp; features</div>
          <div class="section-tagline">
            Resource limits and feature availability by plan.
          </div>
        </div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" class="plan-column"></div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Max databases</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">{{ getLimitValue(plan, 'maxDatabases') }}</div>
        </div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Stream TTL</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">{{ getLimitValue(plan, 'streamTTL') }}</div>
        </div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Concurrent readers/stream</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">{{ getLimitValue(plan, 'concurrentReadersPerStream') }}</div>
        </div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Postgres subqueries</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">{{ getFeatureGate(plan, 'postgresSubqueries') }}</div>
        </div>
      </div>
      <div class="metric-row">
        <div class="metric-column metric-label">Support</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">{{ getSupport(plan) }}</div>
        </div>
      </div>
    </div>

    <!-- Group 3: Workload Scenarios (placeholder) -->
    <div v-if="config && config.workloadScenarios && config.workloadScenarios.length" class="section">
      <div class="section-header">
        <div class="section-title-wrapper">
          <div class="section-title">Workload scenarios</div>
          <div class="section-tagline">
            Estimated monthly usage cost for typical workloads.
          </div>
        </div>
        <div v-for="plan in comparisonPlans" :key="plan.slug" class="plan-column"></div>
      </div>
      <div v-for="scenario in config.workloadScenarios" :key="scenario.id" class="metric-row">
        <div class="metric-column metric-label">{{ scenario.label }}</div>
        <div class="plan-column">
          <div v-for="plan in comparisonPlans" :key="plan.slug" class="metric-value" :data-plan="plan.name">{{ computeScenarioCost(plan, scenario) }}</div>
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
