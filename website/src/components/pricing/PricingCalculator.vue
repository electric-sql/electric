<script setup>
import { ref, computed } from 'vue'

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
// PLAN THRESHOLDS - Based on plan YAML files
// ============================================================================
const PLAN_THRESHOLDS = {
  free: {
    name: 'Free',
    maxMAU: 1000,
    maxWPM: 20,
    maxDataGB: 10,
    price: 0,
    ctaText: 'Get started',
    ctaHref: 'https://dashboard.electric-sql.cloud',
    ctaTheme: 'brand'
  },
  pro: {
    name: 'Pro',
    maxMAU: 10000,
    maxWPM: 300,
    maxDataGB: 100,
    price: 29,
    ctaText: 'Get started',
    ctaHref: 'https://dashboard.electric-sql.cloud?plan=pro',
    ctaTheme: 'brand'
  },
  growth: {
    name: 'Growth',
    maxMAU: 200000,
    maxWPM: 6000,
    maxDataGB: 2000,
    price: 349,
    ctaText: 'Get started',
    ctaHref: 'https://dashboard.electric-sql.cloud?plan=growth',
    ctaTheme: 'brand'
  },
  enterprise: {
    name: 'Enterprise',
    maxMAU: Infinity,
    maxWPM: Infinity,
    maxDataGB: Infinity,
    price: 'Custom',
    ctaText: 'Contact sales',
    ctaHref: '/about/contact#sales',
    ctaTheme: 'alt'
  }
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
  
  if (mau > PLAN_THRESHOLDS.free.maxMAU || 
      wpm > PLAN_THRESHOLDS.free.maxWPM || 
      dataGB > PLAN_THRESHOLDS.free.maxDataGB) {
    requiredPlan = 'pro'
  }
  
  if (mau > PLAN_THRESHOLDS.pro.maxMAU || 
      wpm > PLAN_THRESHOLDS.pro.maxWPM || 
      dataGB > PLAN_THRESHOLDS.pro.maxDataGB) {
    requiredPlan = 'growth'
  }
  
  if (mau > PLAN_THRESHOLDS.growth.maxMAU || 
      wpm > PLAN_THRESHOLDS.growth.maxWPM || 
      dataGB > PLAN_THRESHOLDS.growth.maxDataGB) {
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
          Writes per minute
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
          Data throughput (GB/month)
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
        <h4 class="toggles-title">Additional requirements</h4>
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
      <div class="result-content">
        <div class="result-header">
          <h4 class="result-label">Recommended plan</h4>
          <h2 class="result-plan-name">{{ recommendedPlan.name }}</h2>
        </div>
        <div class="result-pricing">
          <div class="result-price">{{ formattedPrice }}</div>
          <div v-if="typeof recommendedPlan.price === 'number'" class="result-period">/ month</div>
        </div>
        <div class="result-cta">
          <VPButton
            :href="recommendedPlan.ctaHref"
            :text="recommendedPlan.ctaText"
            :theme="recommendedPlan.ctaTheme"
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
  gap: 24px;
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
  padding: 10px 14px;
  font-size: 1rem;
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
  gap: 12px;
  margin-top: 8px;
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
  background: rgba(0, 210, 160, 0.08);
  border: 1px solid rgba(0, 210, 160, 0.2);
  border-radius: 12px;
  padding: 32px;
  width: 100%;
  text-align: center;
}

.result-header {
  margin-bottom: 24px;
}

.result-label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--vp-c-text-2);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 12px 0;
}

.result-plan-name {
  font-size: 2rem;
  font-weight: 700;
  color: var(--electric-color);
  margin: 0;
}

.result-pricing {
  margin-bottom: 28px;
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
}

.result-price {
  font-size: 2.5rem;
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

@media (max-width: 959px) {
  .calculator-container {
    grid-template-columns: 1fr;
    gap: 32px;
    padding: 32px 24px;
  }
  
  .calculator-result {
    order: -1;
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
