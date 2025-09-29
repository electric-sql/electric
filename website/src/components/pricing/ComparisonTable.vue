<script setup>
const { comparisonPlans } = defineProps(['comparisonPlans'])
</script>

<template>
  <div class="comparison-table">
    <!-- Desktop: Row Layout -->
    <div class="comparison-header desktop-only">
      <div class="header-cell plan-header">Plan</div>
      <div class="header-cell benefits-header">Benefits</div>
      <div class="header-cell when-header">When you should choose</div>
      <div class="header-cell supports-header">Supports (usage level)</div>
      <div class="header-cell cta-header">Action</div>
    </div>
    
    <div class="comparison-rows">
      <div v-for="plan in comparisonPlans" :key="plan.slug" class="plan-row">
        <!-- Desktop: Row Layout -->
        <div class="row-cell plan-name desktop-only">{{ plan.name }}</div>
        <div class="row-cell benefits desktop-only">{{ plan.benefits }}</div>
        <div class="row-cell when-to-choose desktop-only">{{ plan.when_to_choose }}</div>
        <div class="row-cell supports-usage desktop-only">{{ plan.supports_usage }}</div>
        <div class="row-cell cta-cell desktop-only">
          <VPButton
            :href="plan.ctaHref"
            :text="plan.ctaText"
            :theme="plan.ctaTheme"
          />
        </div>

        <!-- Mobile: Stacked Layout -->
        <div class="mobile-plan-card mobile-only">
          <div class="mobile-plan-header">
            <h4 class="mobile-plan-name">{{ plan.name }}</h4>
            <div class="mobile-cta">
              <VPButton
                :href="plan.ctaHref"
                :text="plan.ctaText"
                :theme="plan.ctaTheme"
              />
            </div>
          </div>
          <div class="mobile-plan-details">
            <div class="mobile-detail">
              <div class="mobile-label">Benefits</div>
              <div class="mobile-value">{{ plan.benefits }}</div>
            </div>
            <div class="mobile-detail">
              <div class="mobile-label">When to choose</div>
              <div class="mobile-value">{{ plan.when_to_choose }}</div>
            </div>
            <div class="mobile-detail">
              <div class="mobile-label">Usage level</div>
              <div class="mobile-value">{{ plan.supports_usage }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Main Container - Card Styling */
.comparison-table {
  background: rgba(255, 255, 255, 0.03);
  border: 0.5px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  margin: 40px 0;
  overflow: hidden;
}

/* Desktop Layout */
.comparison-header {
  display: grid;
  grid-template-columns: 1fr 2fr 2fr 1.5fr 120px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.header-cell {
  padding: 20px 16px;
  font-weight: 650;
  color: var(--vp-c-text-1);
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.plan-row {
  display: grid;
  grid-template-columns: 1fr 2fr 2fr 1.5fr 120px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.plan-row:last-child {
  border-bottom: none;
}

.row-cell {
  padding: 20px 16px;
  color: var(--vp-c-text-2);
  line-height: 1.5;
  vertical-align: top;
  display: flex;
  align-items: flex-start;
}

.plan-name {
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.cta-cell {
  justify-content: center;
  align-items: center;
}

/* Mobile Layout */
.mobile-plan-card {
  padding: 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.mobile-plan-card:last-child {
  border-bottom: none;
}

.mobile-plan-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
  gap: 16px;
}

.mobile-plan-name {
  font-size: 1.2rem;
  font-weight: 650;
  color: var(--vp-c-text-1);
  margin: 0;
  flex: 1;
}

.mobile-cta {
  flex-shrink: 0;
}

.mobile-plan-details {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mobile-detail {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mobile-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.mobile-value {
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
  line-height: 1.5;
}

/* Responsive Display */
.desktop-only {
  display: block;
}

.mobile-only {
  display: none;
}

/* Tablet Breakpoint - Switch to mobile layout */
@media (max-width: 1024px) {
  .desktop-only {
    display: none;
  }
  
  .mobile-only {
    display: block;
  }
}

/* Mobile Adjustments */
@media (max-width: 767px) {
  .mobile-plan-header {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
  
  .mobile-cta {
    align-self: flex-start;
  }
  
  .mobile-plan-card {
    padding: 20px;
  }
}
</style>