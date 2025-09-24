<script setup>
const { 
  name, 
  price, 
  period = 'month',
  // Tier-specific props
  operations,
  shapes,
  sources,
  gbProcessed,
  // Service-specific props
  proposition,
  description,
  // Common props
  featuresLabel = null,
  features = [],
  contactNote,
  ctaText = 'Get started',
  ctaHref = 'https://dashboard.electric-sql.cloud/',
  ctaTheme = 'brand',
  // Style variants
  priceColor = 'electric' // 'electric' or 'ddn'
} = defineProps([
  'name', 'price', 'period', 'operations', 'shapes', 'sources',
  'gbProcessed', 'proposition', 'description', 'featuresLabel', 'features', 
  'contactNote', 'ctaText', 'ctaHref', 'ctaTheme', 'priceColor'
])

// Determine if this is a tier card (has metrics) or service card
const isTierCard = operations !== undefined

function formatNumber(num) {
  if (num >= 1000000000) {
    return (num / 1000000000) + 'B'
  }
  if (num >= 1000000) {
    return (num / 1000000) + 'M'
  }
  if (num >= 1000) {
    return (num / 1000) + 'K'
  }
  return num.toString()
}

function formatStorage(num, unit = 'GB') {
  if (num >= 1000 && unit === 'GB') {
    return (num / 1000) + 'TB'
  }
  return num + '' + unit
}

function formatPrice(price) {
  if (price >= 1000) {
    return (price / 1000).toLocaleString() + 'k'
  }
  return price.toLocaleString()
}

const priceColorVar = priceColor === 'ddn' ? 'var(--ddn-color)' : 'var(--electric-color)'
</script>

<template>
  <div class="pricing-card">
    <div class="card-header">
      <h3 class="card-name">{{ name }}</h3>
      <div class="card-price">
        <span class="price-amount" :style="{ color: priceColorVar }">${{ formatPrice(price) }}</span>
        <span class="price-period">/ {{ period }}</span>
      </div>
    </div>

    <div class="card-content">
      <!-- Tier Metrics -->
      <div v-if="isTierCard" class="metrics">
        <div class="metric-item">
          <span class="metric-value">{{ formatNumber(operations) }}</span>
          operations
        </div>
        <hr />
        <div class="metric-item">
          <span class="metric-value">{{ formatStorage(gbProcessed) }}</span>
          processed
        </div>
        <div class="metric-item">
          <span class="metric-value">{{ formatNumber(shapes) }}</span>
          active shapes
        </div>
        <div class="metric-item">
          <span class="metric-value">{{ sources }}</span>
          sources
        </div>
      </div>

      <!-- Service Content -->
      <div v-else class="service-content">
        <div class="service-text">
          <div class="proposition">{{ proposition }}</div>
          <hr class="service-divider" />
          <div class="description">{{ description }}</div>
        </div>
      </div>

      <!-- Features (common to both types) -->
      <div v-if="features.length > 0" class="features">
        <div class="features-title" v-if="featuresLabel">{{ featuresLabel }}</div>
        <div v-if="isTierCard" class="feature-item" v-for="feature in features" :key="feature">
          {{ feature }}
        </div>
        <div v-else>
          <div class="service-features-stacked">
            <div class="feature-item" v-for="feature in features" :key="feature">
              {{ feature }}
            </div>
          </div>
          <div class="service-features-inline">
            <span v-for="(feature, index) in features" :key="feature" class="service-feature-item">
              <span v-if="index === 0">{{ feature }}</span>
              <span v-else>{{ feature.charAt(0).toLowerCase() + feature.slice(1) }}</span>
              <span v-if="index < features.length - 1" class="feature-separator"> • </span>
            </span>
          </div>
        </div>
      </div>

      <!-- Contact Note (for Growth tier) -->
      <div v-if="contactNote" class="contact-note">
        {{ contactNote }}
      </div>
    </div>

    <div class="card-footer">
      <div class="actions cta-actions">
        <div class="action">
          <VPButton
            :href="ctaHref"
            :text="ctaText"
            :theme="ctaTheme"
          />
        </div>
      </div>
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
  align-items: stretch;
  justify-content: flex-start;
  flex-direction: column;
  text-align: left;
  height: 100%;
}

.card-header {
  text-align: left;
  margin-bottom: 24px;
}

.card-name {
  font-size: 1.4rem;
  font-weight: 650;
  margin: 0 0 16px 0;
  color: var(--vp-c-text-1);
}

.card-price {
  display: flex;
  align-items: baseline;
  justify-content: flex-start;
  gap: 4px;
}

.price-amount {
  font-size: 2.2rem;
  font-weight: 700;
  line-height: 1;
}

.price-period {
  font-size: 1rem;
  color: var(--vp-c-text-2);
  font-weight: 500;
}

.card-content {
  flex: 1;
  margin-bottom: 24px;
}

/* Tier Metrics */
.metrics {
  margin-bottom: 24px;
}

.metric-item {
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
  margin-bottom: 8px;
  line-height: 1.4;
}

.metric-item:last-child {
  margin-bottom: 0;
}

.metric-value {
  color: var(--vp-c-text-1);
  font-weight: 600;
}

/* Service Content */
.service-content {
  margin-bottom: 20px;
}

.service-text {
  display: flex;
  flex-direction: column;
}

.proposition {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  text-align: left;
  margin-bottom: 0px;
  line-height: 1.4;
}

.description {
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
  line-height: 1.4;
  text-align: left;
}

.service-divider {
  margin: 16px 0;
}

/* Default: show stacked features */
.service-features-stacked {
  display: block;
}

.service-features-inline {
  display: none;
}

/* Inline layout for full-width service cards */
@media (max-width: 1149px) and (min-width: 806px) {
  .pricing-card:has(.service-content) .service-text {
    flex-direction: row;
    gap: 6px;
    align-items: baseline;
  }
  
  .pricing-card:has(.service-content) .proposition {
    margin-bottom: 0;
  }
  
  .pricing-card:has(.service-content) .proposition {

  }
  
  .pricing-card:has(.service-content) .proposition::after {
    content: " ";
  }
  
  .pricing-card:has(.service-content) .description {
    margin-bottom: 0;
    text-transform: lowercase;
  }
  
  .pricing-card:has(.service-content) .service-divider {
    display: none;
  }
  
  .pricing-card:has(.service-content) .service-features-stacked {
    display: none;
  }
  
  .pricing-card:has(.service-content) .service-features-inline {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
  }
  .pricing-card:has(.service-content) .service-features-inline .service-feature-item {
    line-height: 1.7;
  }
}

.service-feature-item {
  font-size: 0.75rem;
  color: var(--vp-c-text-1);
  line-height: 1.4;
  font-weight: 450;
}

.feature-separator {
  color: var(--vp-c-text-3);
  margin: 0 4px 0 2px;
  font-size: 0.8rem;
}

/* Features */
.features {
  margin-bottom: 20px;
  padding-top: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.features-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--vp-c-text-2);
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.feature-item {
  font-size: 0.775rem;
  color: var(--vp-c-text-1);
  margin-bottom: 8px;
  line-height: 1.4;
  font-weight: 450;
}

.contact-note {
  font-style: italic;
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
  text-align: left;
  margin-top: 16px;
  line-height: 1.4;
}

.card-footer {
  margin-top: auto;
}

.cta-actions {
  display: flex;
  justify-content: flex-start;
  margin: 0;
}
</style>