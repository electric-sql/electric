<script setup>
import { ref, computed, onMounted } from 'vue'
import { data as pricing } from '../../../data/pricing.data.ts'

const config = pricing.config
const tiers = pricing.tiers

const PLAN_HIERARCHY = ['payg', 'pro', 'scale']

// Validate calculator features at dev time
onMounted(() => {
  if (import.meta.env.DEV && config.calculatorFeatures) {
    const slugs = tiers.map(t => t.slug)
    for (const feature of config.calculatorFeatures) {
      if (!slugs.includes(feature.minimumTier)) {
        console.warn(`[PricingCalculator] Feature "${feature.id}" has minimumTier "${feature.minimumTier}" which doesn't match any loaded plan slug (${slugs.join(', ')})`)
      }
    }
  }
})

// Non-linear slider stops
const WRITE_STOPS = [0, 100_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000, 250_000_000, 500_000_000, 1_000_000_000]
const RETENTION_STOPS = [0, 1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000]
const SLIDER_MAX = 1000

function valueToSlider(value, stops) {
  if (value <= stops[0]) return 0
  if (value >= stops[stops.length - 1]) return SLIDER_MAX
  for (let i = 1; i < stops.length; i++) {
    if (value <= stops[i]) {
      const segFrac = (value - stops[i - 1]) / (stops[i] - stops[i - 1])
      return Math.round(((i - 1 + segFrac) / (stops.length - 1)) * SLIDER_MAX)
    }
  }
  return SLIDER_MAX
}

function sliderToValue(pos, stops) {
  const frac = pos / SLIDER_MAX
  const seg = frac * (stops.length - 1)
  const i = Math.floor(seg)
  if (i >= stops.length - 1) return stops[stops.length - 1]
  const segFrac = seg - i
  return Math.round(stops[i] + segFrac * (stops[i + 1] - stops[i]))
}

// Inputs
const writesPerMonth = ref(5_000_000)
const retentionGB = ref(50)

const writesSlider = computed({
  get: () => valueToSlider(writesPerMonth.value, WRITE_STOPS),
  set: (v) => { writesPerMonth.value = sliderToValue(Number(v), WRITE_STOPS) },
})
const retentionSlider = computed({
  get: () => valueToSlider(retentionGB.value, RETENTION_STOPS),
  set: (v) => { retentionGB.value = sliderToValue(Number(v), RETENTION_STOPS) },
})

// Feature checkbox state: { [featureId]: boolean }
const featureChecks = ref(
  Object.fromEntries((config.calculatorFeatures || []).map(f => [f.id, false]))
)

// Currency formatter
const currencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

function safeVal(v) {
  const n = Number(v)
  return (isNaN(n) || n < 0) ? 0 : n
}

// Compute costs for all tiers
const tierCosts = computed(() => {
  const w = safeVal(writesPerMonth.value)
  const r = safeVal(retentionGB.value)

  return tiers.map(tier => {
    const writeCost = (w / 1000000) * tier.effectiveWriteRate
    const retentionCost = r * tier.effectiveRetentionRate
    const usageCost = writeCost + retentionCost

    let totalCost
    let waived = false
    if (tier.slug === 'payg') {
      if (usageCost < config.paygWaiverThreshold) {
        totalCost = 0
        waived = true
      } else {
        totalCost = usageCost
      }
    } else {
      totalCost = Math.max(usageCost, tier.monthlyFee)
    }

    return {
      tier,
      writeCost,
      retentionCost,
      usageCost,
      totalCost,
      waived,
    }
  })
})

// Find minimum tier required by feature checkboxes
const featureMinTierIndex = computed(() => {
  let maxIndex = 0
  for (const feature of (config.calculatorFeatures || [])) {
    if (featureChecks.value[feature.id]) {
      const idx = PLAN_HIERARCHY.indexOf(feature.minimumTier)
      if (idx > maxIndex) maxIndex = idx
    }
  }
  return maxIndex
})

// Recommended result
const recommendation = computed(() => {
  // Find cheapest tier
  let best = tierCosts.value[0]
  for (const tc of tierCosts.value) {
    if (tc.totalCost < best.totalCost) {
      best = tc
    }
  }

  // Bump up if feature checkboxes require a higher tier
  const bestIndex = PLAN_HIERARCHY.indexOf(best.tier.slug)
  const requiredIndex = featureMinTierIndex.value
  if (requiredIndex > bestIndex) {
    best = tierCosts.value[requiredIndex]
  }

  return best
})

const formattedTotal = computed(() => {
  return currencyFmt.format(recommendation.value.totalCost)
})

const breakdownText = computed(() => {
  const r = recommendation.value
  if (r.waived) return 'Under $5 \u2014 waived'
  const w = currencyFmt.format(r.writeCost)
  const ret = currencyFmt.format(r.retentionCost)
  const total = currencyFmt.format(r.usageCost)
  return `Writes: ${w} + Retention: ${ret} = ${total}`
})

const planNote = computed(() => {
  const r = recommendation.value
  if (r.tier.slug === 'payg') return ''
  const fee = currencyFmt.format(r.tier.monthlyFee)
  if (r.usageCost <= r.tier.monthlyFee) {
    return `The base plan cost of ${fee}, with no additional usage charges`
  }
  const extra = currencyFmt.format(r.usageCost - r.tier.monthlyFee)
  return `The base plan cost of ${fee}, plus an additional ${extra} in usage fees`
})
</script>

<template>
  <div class="calculator-container">
    <div class="calculator-inputs">
      <div class="input-group">
        <label class="input-label">
          Writes per month
          <input
            v-model.number="writesPerMonth"
            type="number"
            class="input-field"
            min="0"
            step="1000000"
          />
        </label>
        <input
          v-model="writesSlider"
          type="range"
          class="input-slider"
          min="0"
          :max="SLIDER_MAX"
          step="1"
        />
      </div>
      <div class="input-group">
        <label class="input-label">
          Data retention (GB-months)
          <input
            v-model.number="retentionGB"
            type="number"
            class="input-field"
            min="0"
            step="10"
          />
        </label>
        <input
          v-model="retentionSlider"
          type="range"
          class="input-slider"
          min="0"
          :max="SLIDER_MAX"
          step="1"
        />
      </div>
      <div class="toggles-section">
        <label v-for="feature in config.calculatorFeatures" :key="feature.id" class="toggle-label">
          <input
            v-model="featureChecks[feature.id]"
            type="checkbox"
            class="toggle-input"
          />
          <span class="toggle-text">{{ feature.label }}</span>
        </label>
      </div>
    </div>
    <div class="calculator-result">
      <div :class="`result-content result-content-${recommendation.tier.ctaTheme}`">
        <div class="result-header">
          <h4 class="result-label">Recommended plan</h4>
          <h2 :class="`result-plan-name result-plan-name-${recommendation.tier.ctaTheme}`">{{ recommendation.tier.name }}</h2>
        </div>
        <div class="result-pricing">
          <div class="result-price">{{ formattedTotal }}</div>
          <div class="result-period">/ month</div>
        </div>
        <div v-if="breakdownText" class="result-breakdown">{{ breakdownText }}</div>
        <div v-if="planNote" class="result-note">{{ planNote }}</div>
        <div class="result-cta">
          <VPButton
            :href="recommendation.tier.ctaHref"
            :text="recommendation.tier.ctaText"
            theme="brand"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.calculator-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 40px;
  margin: 40px 0;
  padding: 40px;
  background: rgba(255, 255, 255, 0.03);
  border: 0.5px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
}

.calculator-inputs {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.calculator-title {
  font-size: 1.5rem;
  font-weight: 650;
  color: var(--vp-c-text-1);
  margin: 0;
}

.calculator-description {
  font-size: 0.95rem;
  color: var(--vp-c-text-2);
  margin: 0;
  line-height: 1.5;
}

.input-group {
  display: flex;
  flex-direction: column;
}

.input-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--vp-c-text-2);
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.input-field {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 9px 12px;
  font-size: 0.875rem;
  color: var(--vp-c-text-1);
  font-family: inherit;
  transition: border-color 0.2s, background 0.2s;
}

.input-field:focus {
  outline: none;
  border-color: var(--electric-color);
  background: rgba(255, 255, 255, 0.08);
}

.input-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.1);
  outline: none;
  margin-top: 2px;
  cursor: pointer;
}

.input-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--electric-color);
  cursor: pointer;
  border: none;
}

.input-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--electric-color);
  cursor: pointer;
  border: none;
}

.toggles-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 0px;
}

.toggles-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin: 0 0 8px 0;
}

.toggle-label {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 8px 0;
}

.toggle-input {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: var(--electric-color);
}

.toggle-text {
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
  user-select: none;
}

.calculator-result {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 20px;
}

.result-content {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 32px;
  width: 100%;
  text-align: center;
}
.result-content-brand {
  border: 1px solid var(--electric-color);
}
.result-content-alt {
  border: 1px solid var(--ddn-color);
}

.result-header {
  margin-bottom: 20px;
}

.result-label {
  font-size: 0.825rem;
  font-weight: 500;
  color: var(--vp-c-text-3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0;
  line-height: 1.5;
}

.result-plan-name {
  font-size: 2.25rem;
  font-weight: 700;
  margin: 0;
}
.result-plan-name-brand {
  color: var(--electric-color);
}
.result-plan-name-alt {
  color: var(--ddn-color);
}

.result-pricing {
  margin-bottom: 16px;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
}

.result-price {
  font-size: 2rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
  line-height: 1;
}

.result-period {
  font-size: 1.1rem;
  color: var(--vp-c-text-2);
  font-weight: 500;
}

.result-breakdown {
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
  margin-bottom: 8px;
  line-height: 1.5;
}

.result-note {
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
  margin-bottom: 24px;
  line-height: 1.5;
  font-style: italic;
}

.result-cta {
  display: flex;
  justify-content: center;
}

@media (max-width: 759px) {
  .calculator-container {
    grid-template-columns: 1fr;
    gap: 24px;
    padding: 32px 24px;
  }

  .calculator-result {
    order: -1;
    padding-top: 0;
  }

  .calculator-inputs {
    gap: 12px;
  }

  .toggles-section {
    gap: 4px;
  }
}

@media (max-width: 529px) {
  .calculator-container {
    padding: 24px 20px;
  }

  .result-content {
    padding: 24px 20px;
  }

  .result-plan-name {
    font-size: 1.75rem;
  }

  .result-price {
    font-size: 2rem;
  }
}
</style>
