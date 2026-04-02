<script setup>
const { plan } = defineProps(['plan'])

const priceColorVar = (plan.priceColor === 'ddn') ? 'var(--ddn-color)' : 'var(--electric-color)'

function formatPrice(p) {
  if (p.type === 'enterprise') return 'Custom'
  if (p.type === 'service') return ''
  if (typeof p.monthlyFee === 'number') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(p.monthlyFee)
  }
  return ''
}

function formatRate(rate) {
  if (rate % 1 === 0) return '$' + rate
  return '$' + parseFloat(rate.toFixed(4))
}

const hasCommitment = plan.commitment && plan.commitment !== 'None'
const commitmentLabel = (() => {
  if (plan.commitment === 'Custom') return 'Custom commitment'
  return plan.commitment + ' commitment'
})()

const hasPaidPrice = plan.type === 'tier' && plan.monthlyFee > 0
const label = plan.shortName || plan.name
</script>

<template>
  <div :class="['pricing-card', { 'pricing-card-highlighted': plan.highlighted }]">
    <div class="card-header">
      <div :class="['card-label', { 'card-label-highlighted': plan.highlighted }]">{{ label }}</div>
      <div v-if="hasPaidPrice" class="card-price">
        <span class="price-amount" :style="{ color: priceColorVar }">{{ formatPrice(plan) }}</span>
        <span v-if="plan.priceQualifier" class="price-qualifier">{{ plan.priceQualifier }}</span>
      </div>
      <div v-else-if="plan.type === 'enterprise'" class="card-hero-name">{{ formatPrice(plan) }}</div>
      <div v-else class="card-hero-name">{{ plan.name }}</div>
    </div>

    <div class="card-content">
      <div v-if="plan.who" class="card-who">
        {{ plan.who }}
        <span v-if="hasCommitment" class="detail-commitment"> — {{ commitmentLabel }}</span>
      </div>
     

      <div class="card-details">
        <div v-if="plan.billingBehavior" class="detail-billing">{{ plan.billingBehavior }}</div>

        <div v-if="plan.effectiveWriteRate !== undefined" class="card-rates">
          <div class="rate-line">
            <span>{{ formatRate(plan.effectiveWriteRate) }} per 1M writes</span>
            <span v-if="plan.discountPercent" class="discount-badge">{{ plan.discountPercent }}% discount</span>
          </div>
          <div class="rate-line">
            <span>{{ formatRate(plan.effectiveRetentionRate) }} per GB-month</span>
            <span v-if="plan.discountPercent" class="discount-badge">{{ plan.discountPercent }}% discount</span>
          </div>
        </div>
      </div>

      <div v-if="plan.features && plan.features.length" class="card-features">
        <div v-if="plan.support" class="features-support">{{ plan.support }}</div>
        <div v-for="feature in plan.features" :key="feature" class="feature-item">
          <span class="feature-check">&#10003;</span>
          <span>{{ feature }}</span>
        </div>
      </div>
    </div>

    <div class="card-footer">
      <VPButton
        :href="plan.ctaHref"
        :text="plan.ctaText"
        :theme="plan.ctaTheme || 'brand'"
      />
    </div>
  </div>
</template>

<style scoped>
.pricing-card {
  background: rgba(255, 255, 255, 0.03);
  border: 0.5px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 32px 30px;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.pricing-card-highlighted {
  border: 1.5px solid var(--electric-color);
}

.card-header {
  margin-bottom: 16px;
}

.card-label {
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--vp-c-text-2);
  margin-bottom: 8px;
}

.card-label-highlighted {
  color: var(--electric-color);
  font-weight: 600;
}

.card-hero-name {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
  line-height: 1.2;
}

.card-price {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.price-amount {
  font-size: 2.25rem;
  font-weight: 700;
  line-height: 1;
}

.price-qualifier {
  font-size: 1rem;
  color: var(--vp-c-text-3);
  font-weight: 500;
}

.card-content {
  flex: 1;
  margin-bottom: 24px;
}

.card-who {
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
  line-height: 1.5;
  margin-bottom: 20px;
}

.card-details {
  margin-bottom: 16px;
}

.detail-commitment {
  font-size: 0.825rem;
  font-weight: 500;
  color: var(--vp-c-text-2);
  margin-bottom: 10px;
}

.detail-billing {
  font-size: 0.8rem;
  color: var(--vp-c-text-2);
  margin-bottom: 8px;
}

.card-rates {
  margin-top: 4px;
}

.rate-line {
  font-size: 0.875rem;
  color: var(--vp-c-text-1);
  margin-bottom: 2px;
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.discount-badge {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--electric-color);
  white-space: nowrap;
}

.card-features {
  margin-top: 0;
}

.features-support {
  font-size: 0.825rem;
  color: var(--vp-c-text-2);
  margin-bottom: 10px;
}

.feature-item {
  font-size: 0.875rem;
  color: var(--vp-c-text-1-5);
  margin-bottom: 6px;
  line-height: 1.4;
  font-weight: 400;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.feature-check {
  color: var(--electric-color);
  font-weight: 600;
  flex-shrink: 0;
}

.card-footer {
  margin-top: 6px;
  margin-bottom: 6px;
}
</style>
