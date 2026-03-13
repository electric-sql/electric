<script setup>
import { ref, computed } from 'vue'
import { data as pricing } from '../../../data/pricing.data.ts'

// ============================================================================
// CALCULATOR DEFAULTS - Pro plan workload
// ============================================================================
const monthlyActiveUsers = ref(2000)
const writesPerMinute = ref(60)
const dataThroughputGB = ref(20)

// Feature toggles with clear business logic
const needsDedicatedResources = ref(false)
const needsOptimumExperience = ref(false)
const needsTeamManagement = ref(false)
const needsBespokeInfrastructure = ref(false)

// ============================================================================
// PLAN THRESHOLDS - Derived from YAML data
// ============================================================================
const PLAN_THRESHOLDS = {
  free: pricing.tiers.find(t => t.slug === 'free'),
  pro: pricing.tiers.find(t => t.slug === 'pro'),
  growth: pricing.tiers.find(t => t.slug === 'growth'),
  enterprise: pricing.enterprise[0]
}

// ============================================================================
// FEATURE-TO-PLAN MAPPING
// ============================================================================
// Each feature requirement maps to minimum plan tier needed
const FEATURE_REQUIREMENTS = {
  dedicatedResources: 'pro',      // Pro+: "Dedicated resources"
  optimumExperience: 'pro',        // Pro+: Better performance/reliability
  teamManagement: 'growth',        // Growth+: "Role-based access control"
  bespokeInfrastructure: 'enterprise' // Enterprise: "Custom infrastructure"
}

// Plan hierarchy for feature requirements
const PLAN_HIERARCHY = ['free', 'pro', 'growth', 'enterprise']

// ============================================================================
// CALCULATOR LOGIC
// ============================================================================
const recommendedPlan = computed(() => {
  let requiredPlan = 'free'
  
  // STEP 1: Check workload-based requirements
  // Find minimum plan that can handle the workload
  const mau = monthlyActiveUsers.value
  const wpm = writesPerMinute.value
  const dataGB = dataThroughputGB.value
  
  const parseNumeric = (val) => {
    if (typeof val === 'string') {
      if (val.toLowerCase() === 'unlimited') return Infinity
      const match = val.match(/[\d.]+/)
      if (!match) return Infinity
      let num = parseFloat(match[0])
      if (val.toLowerCase().includes('k')) num *= 1000
      if (val.toLowerCase().includes('m')) num *= 1000000
      return num
    }
    return val
  }

  if (mau > parseNumeric(PLAN_THRESHOLDS.free.monthlyActiveUsers) ||
      wpm > parseNumeric(PLAN_THRESHOLDS.free.writesPerMinute) ||
      dataGB > PLAN_THRESHOLDS.free.gbProcessed) {
    requiredPlan = 'pro'
  }
  
  if (mau > parseNumeric(PLAN_THRESHOLDS.pro.monthlyActiveUsers) ||
      wpm > parseNumeric(PLAN_THRESHOLDS.pro.writesPerMinute) ||
      dataGB > PLAN_THRESHOLDS.pro.gbProcessed) {
    requiredPlan = 'growth'
  }
  
  if (mau > parseNumeric(PLAN_THRESHOLDS.growth.monthlyActiveUsers) ||
      wpm > parseNumeric(PLAN_THRESHOLDS.growth.writesPerMinute) ||
      dataGB > PLAN_THRESHOLDS.growth.gbProcessed) {
    requiredPlan = 'enterprise'
  }
  
  // STEP 2: Check feature-based requirements
  // Upgrade plan if features require higher tier
  const featureChecks = [
    { enabled: needsDedicatedResources.value, requires: FEATURE_REQUIREMENTS.dedicatedResources },
    { enabled: needsOptimumExperience.value, requires: FEATURE_REQUIREMENTS.optimumExperience },
    { enabled: needsTeamManagement.value, requires: FEATURE_REQUIREMENTS.teamManagement },
    { enabled: needsBespokeInfrastructure.value, requires: FEATURE_REQUIREMENTS.bespokeInfrastructure }
  ]
  
  for (const check of featureChecks) {
    if (check.enabled) {
      const requiredIndex = PLAN_HIERARCHY.indexOf(requiredPlan)
      const featureIndex = PLAN_HIERARCHY.indexOf(check.requires)
      
      // Upgrade to higher tier if feature requires it
      if (featureIndex > requiredIndex) {
        requiredPlan = check.requires
      }
    }
  }
  
  return PLAN_THRESHOLDS[requiredPlan]
})

// Format display values
const formattedPrice = computed(() => {
  if (typeof recommendedPlan.value.price === 'number') {
    return `$${recommendedPlan.value.price}`
  }
  return recommendedPlan.value.price
})

// Input formatting for display
function formatNumberInput(value) {
  return value.toLocaleString()
}
</script>

<template>
  <div class="calculator-container">
    <div class="calculator-inputs">
      <div class="input-group">
        <label class="input-label">
          Monthly active users
          <input 
            v-model.number="monthlyActiveUsers" 
            type="number" 
            class="input-field"
            min="0"
            step="100"
          />
        </label>
      </div>
      <div class="input-group">
        <label class="input-label">
          Write workload (writes per minute)
          <input 
            v-model.number="writesPerMinute" 
            type="number" 
            class="input-field"
            min="0"
            step="10"
          />
        </label>
      </div>
      <div class="input-group">
        <label class="input-label">
          Data throughput (ingested, GB/month)
          <input 
            v-model.number="dataThroughputGB" 
            type="number" 
            class="input-field"
            min="0"
            step="10"
          />
        </label>
      </div>
      <div class="toggles-section">
        <label class="toggle-label">
          <input 
            v-model="needsDedicatedResources" 
            type="checkbox" 
            class="toggle-input"
          />
          <span class="toggle-text">Dedicated resources</span>
        </label>
        <label class="toggle-label">
          <input 
            v-model="needsOptimumExperience" 
            type="checkbox" 
            class="toggle-input"
          />
          <span class="toggle-text">Optimum user experience</span>
        </label>
        <label class="toggle-label">
          <input 
            v-model="needsTeamManagement" 
            type="checkbox" 
            class="toggle-input"
          />
          <span class="toggle-text">Team-based management features</span>
        </label>
        <label class="toggle-label">
          <input 
            v-model="needsBespokeInfrastructure" 
            type="checkbox" 
            class="toggle-input"
          />
          <span class="toggle-text">Bespoke infrastructure</span>
        </label>
      </div>
    </div>
    <div class="calculator-result">
      <div :class="`result-content result-content-${recommendedPlan.ctaTheme}`">
        <div class="result-header">
          <h4 class="result-label">Recommended plan</h4>
          <h2 :class="`result-plan-name result-plan-name-${recommendedPlan.ctaTheme}`">{{ recommendedPlan.name }}</h2>
        </div>
        <div class="result-pricing">
          <div class="result-price">{{ formattedPrice }}</div>
          <div v-if="typeof recommendedPlan.price === 'number'" class="result-period">/ month</div>
        </div>
        <div class="result-cta">
          <VPButton
            :href="recommendedPlan.ctaHref"
            :text="recommendedPlan.ctaText"
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
  margin-bottom: 30px;
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
