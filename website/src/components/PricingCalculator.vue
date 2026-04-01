<script setup>
import { computed, ref } from 'vue'

const MILLION = 1_000_000
const BASE_WRITE_RATE = 1
const POSTGRES_SYNC_SURCHARGE_RATE = 2
const RETENTION_RATE = 0.1

const WRITE_TICKS = [
  0, 100_000, 250_000, 500_000,
  1_000_000, 2_000_000, 5_000_000,
  10_000_000, 20_000_000, 50_000_000,
  100_000_000, 200_000_000, 500_000_000,
  1_000_000_000, 2_000_000_000, 5_000_000_000,
]

const RETENTION_TICKS = [
  0, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000,
]

function valueToSlider(value, ticks) {
  for (let i = 0; i < ticks.length - 1; i++) {
    if (value <= ticks[i + 1]) {
      const frac = (value - ticks[i]) / (ticks[i + 1] - ticks[i])
      return i + frac
    }
  }
  return ticks.length - 1
}

function sliderToValue(pos, ticks) {
  const i = Math.floor(pos)
  if (i >= ticks.length - 1) return ticks[ticks.length - 1]
  const frac = pos - i
  return ticks[i] + frac * (ticks[i + 1] - ticks[i])
}

function snapWrites(v) {
  if (v <= 0) return 0
  if (v < 1_000_000) return Math.round(v / 10_000) * 10_000
  if (v < 10_000_000) return Math.round(v / 100_000) * 100_000
  return Math.round(v / 1_000_000) * 1_000_000
}

function snapRetention(v) {
  if (v <= 0) return 0
  if (v < 1) return Math.round(v * 10) / 10
  if (v < 10) return Math.round(v * 2) / 2
  return Math.round(v)
}

const presets = {
  aiChat: {
    label: 'AI chat app',
    totalWrites: 1_500_000,
    postgresSyncWrites: 0,
    retentionGb: 1,
  },
  postgresSync: {
    label: 'Postgres Sync dashboard',
    totalWrites: 1_500_000,
    postgresSyncWrites: 500_000,
    retentionGb: 2,
  },
}

const activePreset = ref('aiChat')
const totalWrites = ref(presets.aiChat.totalWrites)
const postgresSyncWrites = ref(presets.aiChat.postgresSyncWrites)
const retentionGb = ref(presets.aiChat.retentionGb)

function clamp(value) {
  return Number.isFinite(value) ? Math.max(value, 0) : 0
}

const safeWrites = computed(() => clamp(totalWrites.value))
const safeRetention = computed(() => clamp(retentionGb.value))
const safePgWrites = computed(() =>
  Math.min(safeWrites.value, clamp(postgresSyncWrites.value))
)

const writesSlider = computed(() => valueToSlider(safeWrites.value, WRITE_TICKS))
const pgSlider = computed(() => valueToSlider(safePgWrites.value, WRITE_TICKS))
const retSlider = computed(() => valueToSlider(safeRetention.value, RETENTION_TICKS))

const baseWriteCost = computed(() => (safeWrites.value / MILLION) * BASE_WRITE_RATE)
const pgSurcharge = computed(
  () => (safePgWrites.value / MILLION) * POSTGRES_SYNC_SURCHARGE_RATE
)
const retentionCost = computed(() => safeRetention.value * RETENTION_RATE)
const totalUsage = computed(
  () => baseWriteCost.value + pgSurcharge.value + retentionCost.value
)

const plans = computed(() => {
  const defs = [
    { name: 'PAYG', fee: 0, discount: 0, waivedBelow: 5 },
    { name: 'Pro', fee: 249, discount: 0.1 },
    { name: 'Scale', fee: 1999, discount: 0.2 },
  ]
  return defs.map((p) => {
    const after = totalUsage.value * (1 - p.discount)
    const waived = p.waivedBelow !== undefined && after < p.waivedBelow
    const bill = waived ? 0 : Math.max(p.fee, after)
    return { ...p, after, waived, bill }
  })
})

function applyPreset(key) {
  activePreset.value = key
  const p = presets[key]
  totalWrites.value = p.totalWrites
  postgresSyncWrites.value = p.postgresSyncWrites
  retentionGb.value = p.retentionGb
}

function clearPreset() {
  activePreset.value = null
}

function fmt(n) {
  return new Intl.NumberFormat('en-US').format(n)
}

function usd(n) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: n >= 100 ? 0 : 2,
    maximumFractionDigits: n >= 100 ? 0 : 2,
  }).format(n)
}
</script>

<template>
  <div class="calc">
    <!-- Preset tabs -->
    <div class="presets">
      <button
        v-for="(preset, key) in presets"
        :key="key"
        :class="{ active: activePreset === key }"
        type="button"
        @click="applyPreset(key)"
      >{{ preset.label }}</button>
      <button
        :class="{ active: activePreset === null }"
        type="button"
        @click="clearPreset"
      >Custom</button>
    </div>

    <div class="body">
      <!-- Inputs -->
      <div class="inputs">
        <div class="field">
          <label for="calc-writes">Total writes / month</label>
          <input id="calc-writes" v-model.number="totalWrites" type="number" min="0" :max="WRITES_MAX" step="100000" @input="clearPreset" />
          <input type="range" :value="writesSlider" min="0" :max="WRITE_TICKS.length - 1" step="0.01" @input="totalWrites = snapWrites(sliderToValue(+$event.target.value, WRITE_TICKS)); clearPreset()" />
          <span class="hint">{{ fmt(safeWrites) }} writes &times; $1 / million</span>
        </div>
        <div class="field">
          <label for="calc-pg">Postgres Sync writes / month</label>
          <input id="calc-pg" v-model.number="postgresSyncWrites" type="number" min="0" :max="safeWrites" step="100000" @input="clearPreset" />
          <input type="range" :value="pgSlider" min="0" :max="WRITE_TICKS.length - 1" step="0.01" @input="postgresSyncWrites = snapWrites(sliderToValue(+$event.target.value, WRITE_TICKS)); clearPreset()" />
          <span class="hint">{{ fmt(safePgWrites) }} writes with extra $2 / million surcharge</span>
        </div>
        <div class="field">
          <label for="calc-ret">Retention (GB-month)</label>
          <input id="calc-ret" v-model.number="retentionGb" type="number" min="0" :max="RETENTION_MAX" step="0.5" @input="clearPreset" />
          <input type="range" :value="retSlider" min="0" :max="RETENTION_TICKS.length - 1" step="0.01" @input="retentionGb = snapRetention(sliderToValue(+$event.target.value, RETENTION_TICKS)); clearPreset()" />
          <span class="hint">{{ safeRetention }} GB &times; $0.10 / GB-month</span>
        </div>
      </div>

      <!-- Cost breakdown -->
      <div class="breakdown">
        <div class="row">
          <span>Base writes</span>
          <span>{{ usd(baseWriteCost) }}</span>
        </div>
        <div class="row">
          <span>Postgres Sync surcharge</span>
          <span>{{ usd(pgSurcharge) }}</span>
        </div>
        <div class="row">
          <span>Retention</span>
          <span>{{ usd(retentionCost) }}</span>
        </div>
        <div class="row total">
          <span>Monthly usage</span>
          <strong>{{ usd(totalUsage) }}</strong>
        </div>
      </div>
    </div>

    <!-- Plan cards -->
    <div class="plans">
      <div
        v-for="plan in plans"
        :key="plan.name"
        class="plan"
        :class="{ highlighted: plan.name === 'Pro' }"
      >
        <div class="plan-name">{{ plan.name }}</div>
        <div class="plan-bill">{{ usd(plan.bill) }}<span class="per">/mo</span></div>
        <dl>
          <div v-if="plan.discount > 0">
            <dt>Discount</dt>
            <dd>{{ plan.discount * 100 }}%</dd>
          </div>
          <div>
            <dt>Usage</dt>
            <dd>{{ usd(plan.after) }}</dd>
          </div>
          <div v-if="plan.fee > 0">
            <dt>Included credit</dt>
            <dd>{{ usd(plan.fee) }}</dd>
          </div>
          <div v-if="plan.waived">
            <dt colspan="2" class="waived">Waived (below $5)</dt>
          </div>
        </dl>
      </div>
    </div>

    <p class="note">
      Postgres Sync writes are a subset of total writes. Each is billed at $1/M
      base plus the $2/M surcharge.<br /> Reads and data delivery are always free.
    </p>
  </div>
</template>

<style scoped>
/* ── Container ── */
.calc {
  margin: 28px 0 8px;
}

/* ── Preset tabs ── */
.presets {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--vp-c-divider);
  margin-bottom: 0;
}

.presets button {
  appearance: none;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 10px 18px;
  color: var(--vp-c-text-2);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}

.presets button:hover {
  color: var(--vp-c-text-1);
}

.presets button.active {
  color: var(--vp-c-brand-1);
  border-bottom-color: var(--vp-c-brand-1);
}

/* ── Body: inputs + breakdown ── */
.body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  padding: 24px 0 20px;
}

/* ── Input fields ── */
.inputs {
  display: grid;
  gap: 18px;
}

.field {
  display: grid;
  gap: 6px;
}

.field label {
  font-weight: 600;
  font-size: 14px;
  color: var(--vp-c-text-1);
}

.field input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font: inherit;
  font-size: 15px;
  transition: border-color 0.2s;
}

.field input:focus {
  outline: none;
  border-color: var(--vp-c-brand-1);
}

.field input[type='range'] {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 6px;
  border: none;
  border-radius: 3px;
  background: var(--vp-c-divider);
  cursor: pointer;
  padding: 0;
  margin: 2px 0 0;
}

.field input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  border: 2px solid var(--vp-c-bg);
  box-shadow: 0 0 0 1px var(--vp-c-brand-1);
  cursor: pointer;
  transition: transform 0.15s;
}

.field input[type='range']::-webkit-slider-thumb:hover {
  transform: scale(1.15);
}

.field input[type='range']::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  border: 2px solid var(--vp-c-bg);
  box-shadow: 0 0 0 1px var(--vp-c-brand-1);
  cursor: pointer;
}

.field input[type='range']::-moz-range-track {
  height: 6px;
  border-radius: 3px;
  background: var(--vp-c-divider);
}

.field input[type='range']:focus {
  outline: none;
}

.hint {
  font-size: 13px;
  color: var(--vp-c-text-3);
}

/* ── Breakdown ── */
.breakdown {
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  overflow: hidden;
  align-self: start;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  font-size: 14px;
  color: var(--vp-c-text-2);
  border-bottom: 1px solid var(--vp-c-divider);
}

.row:last-child {
  border-bottom: none;
}

.row.total {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-weight: 600;
}

.row.total strong {
  font-size: 18px;
}

/* ── Plan cards ── */
.plans {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  padding-bottom: 8px;
}

.plan {
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  padding: 20px;
  background: var(--vp-c-bg);
  transition: border-color 0.2s;
}

.plan.highlighted {
  border-color: var(--vp-c-brand-1);
}

.plan-name {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
  margin-bottom: 6px;
}

.plan-bill {
  font-size: 28px;
  font-weight: 700;
  color: var(--vp-c-text-1);
  margin-bottom: 16px;
  line-height: 1.1;
}

.per {
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-3);
}

.plan dl {
  margin: 0;
  display: grid;
  gap: 10px;
}

.plan dl div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}

.plan dt {
  color: var(--vp-c-text-3);
}

.plan dd {
  margin: 0;
  text-align: right;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.waived {
  color: var(--electric-color) !important;
  font-weight: 600;
}

/* ── Footnote ── */
.note {
  margin: 14px 0 0;
  font-size: 13px;
  color: var(--vp-c-text-3);
}

/* ── Responsive ── */
@media (max-width: 768px) {
  .body {
    grid-template-columns: 1fr;
  }

  .plans {
    grid-template-columns: 1fr;
  }
}
</style>
