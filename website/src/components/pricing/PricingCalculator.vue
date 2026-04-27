<script setup>
import { ref, computed, onMounted } from 'vue'
import MarkdownContent from '../MarkdownContent.vue'
import MdExportExplicit from '../MdExportExplicit.vue'
import { data as pricing } from '../../../data/pricing.data.ts'
import { useMarkdownExport } from '../../lib/useMarkdownExport'

const config = pricing.config
const tiers = pricing.tiers
const isMarkdownExport = useMarkdownExport()

const PLAN_HIERARCHY = ['payg', 'pro', 'scale']

// Validate calculator features at dev time
onMounted(() => {
  if (import.meta.env.DEV && config.calculatorFeatures) {
    const slugs = tiers.map((t) => t.slug)
    for (const feature of config.calculatorFeatures) {
      if (!slugs.includes(feature.minimumTier)) {
        console.warn(
          `[PricingCalculator] Feature "${feature.id}" has minimumTier "${feature.minimumTier}" which doesn't match any loaded plan slug (${slugs.join(', ')})`
        )
      }
    }
  }
})

// Non-linear slider stops
const WRITE_STOPS = [
  0, 100_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 25_000_000,
  50_000_000, 100_000_000, 250_000_000, 500_000_000, 1_000_000_000,
  2_000_000_000, 5_000_000_000,
]
const RETENTION_STOPS = [
  0, 1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000,
]
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
  set: (v) => {
    writesPerMonth.value = sliderToValue(Number(v), WRITE_STOPS)
  },
})
const retentionSlider = computed({
  get: () => valueToSlider(retentionGB.value, RETENTION_STOPS),
  set: (v) => {
    retentionGB.value = sliderToValue(Number(v), RETENTION_STOPS)
  },
})

// Feature checkbox state: { [featureId]: boolean }
const featureChecks = ref(
  Object.fromEntries(
    (config.calculatorFeatures || []).map((f) => [f.id, false])
  )
)

// Currency formatter
const currencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})
const integerFmt = new Intl.NumberFormat('en-US')

function safeVal(v) {
  const n = Number(v)
  return isNaN(n) || n < 0 ? 0 : n
}

// Compute costs for all tiers
const tierCosts = computed(() => {
  const w = safeVal(writesPerMonth.value)
  const r = safeVal(retentionGB.value)

  return tiers.map((tier) => {
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
  for (const feature of config.calculatorFeatures || []) {
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

const calculatorMarkdown = computed(() => {
  const lines = [
    `Default example inputs:`,
    `- Writes per month: ${integerFmt.format(writesPerMonth.value)}`,
    `- Data retention: ${integerFmt.format(retentionGB.value)} GB-months`,
    '',
    `Recommended plan: **${recommendation.value.tier.name}**`,
    `- Estimated monthly cost: ${formattedTotal.value}${recommendation.value.totalCost > 0 ? ' / month' : ''}`,
  ]

  if (breakdownText.value) {
    lines.push(`- Breakdown: ${breakdownText.value}`)
  }

  if (planNote.value) {
    lines.push(`- Notes: ${planNote.value}`)
  }

  return lines.join('\n')
})
</script>

<template>
  <MdExportExplicit v-if="isMarkdownExport">
    <MarkdownContent>{{ calculatorMarkdown }}</MarkdownContent>
  </MdExportExplicit>
  <div v-else class="calculator-container">
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
          aria-label="Writes per month"
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
          aria-label="Data retention (GB-months)"
        />
      </div>
      <div class="toggles-section">
        <label
          v-for="feature in config.calculatorFeatures"
          :key="feature.id"
          class="toggle-label"
        >
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
      <div class="result-header">
        <h4 class="result-label">Recommended plan</h4>
        <h2
          :class="`result-plan-name result-plan-name-${recommendation.tier.ctaTheme}`"
        >
          {{ recommendation.tier.name }}
        </h2>
      </div>
      <div class="result-pricing">
        <div
          :class="`result-price result-price-${recommendation.tier.ctaTheme}`"
        >
          {{ formattedTotal }}
        </div>
        <div class="result-period">/ month</div>
      </div>
      <div v-if="breakdownText" class="result-breakdown">
        {{ breakdownText }}
      </div>
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
</template>

<style scoped>
.calculator-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  margin: 40px 0;
  background: var(--ec-surface-1);
  border: 1px solid var(--ec-border-1);
  border-radius: 12px;
  overflow: hidden;
}

.calculator-inputs {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 32px;
  border-right: 1px solid var(--ec-border-1);
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
  background: var(--ec-surface-2);
  border: 1px solid var(--ec-border-2);
  border-radius: 6px;
  padding: 9px 12px;
  font-size: 0.875rem;
  color: var(--vp-c-text-1);
  font-family: inherit;
  transition:
    border-color 0.2s,
    background 0.2s;
}

.input-field:focus {
  outline: none;
  border-color: var(--electric-color);
  background: var(--ec-surface-3);
}

.input-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: var(--ec-border-2);
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
  appearance: none;
  -webkit-appearance: none;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin: 0;
  cursor: pointer;
  background: var(--ec-surface-2);
  border: 1px solid var(--ec-border-2);
  border-radius: 4px;
  display: inline-grid;
  place-content: center;
  transition:
    background 0.15s,
    border-color 0.15s;
}

.toggle-input:hover {
  border-color: var(--electric-color);
}

.toggle-input:focus-visible {
  outline: 2px solid var(--electric-color);
  outline-offset: 2px;
}

.toggle-input:checked {
  background: var(--electric-color);
  border-color: var(--electric-color);
}

.toggle-input:checked::before {
  content: '';
  width: 10px;
  height: 10px;
  background: #1a1a1a;
  clip-path: polygon(
    14% 44%,
    0 65%,
    35% 100%,
    100% 16%,
    80% 0%,
    35% 67%
  );
}

.toggle-text {
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
  user-select: none;
}

.calculator-result {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 32px;
  text-align: center;
}

.result-header {
  margin-bottom: 20px;
}

.result-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--vp-c-text-3);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  margin: 0 0 6px;
  line-height: 1.5;
}

.result-plan-name {
  font-size: 1.75rem;
  font-weight: 600;
  margin: 0;
  color: var(--vp-c-text-1);
}

.result-pricing {
  margin-bottom: 16px;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
}

.result-price {
  font-size: 2.25rem;
  font-weight: 700;
  line-height: 1;
}
.result-price-brand {
  color: var(--electric-color);
}
.result-price-alt {
  color: var(--durable-streams-color);
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
  }

  .calculator-inputs {
    gap: 12px;
    padding: 24px;
    border-right: none;
    border-bottom: 1px solid var(--ec-border-1);
  }

  .calculator-result {
    order: -1;
    padding: 28px 24px;
    border-bottom: 1px solid var(--ec-border-1);
  }

  /* When the result is shown above inputs on mobile, the inputs no longer
     need a bottom divider. */
  .calculator-inputs {
    border-bottom: none;
  }

  .toggles-section {
    gap: 4px;
  }
}

@media (max-width: 529px) {
  .calculator-inputs,
  .calculator-result {
    padding: 24px 20px;
  }

  .result-plan-name {
    font-size: 1.5rem;
  }

  .result-price {
    font-size: 2rem;
  }
}
</style>
