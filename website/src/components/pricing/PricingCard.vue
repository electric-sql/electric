<script setup>
const { 
  name, 
  price,
  priceQualifier,
  who,
  featuresTitle,
  features,
  ctaText,
  ctaHref,
  ctaTheme = 'brand',
  priceColor = 'electric'
} = defineProps([
  'name', 'price', 'priceQualifier', 'who', 'featuresTitle', 'features',
  'ctaText', 'ctaHref', 'ctaTheme', 'priceColor'
])

const priceColorVar = priceColor === 'ddn' ? 'var(--ddn-color)' : 'var(--electric-color)'

function formatPrice(p) {
  if (typeof p === 'number') return '$' + p
  return p
}
</script>

<template>
  <div class="pricing-card">
    <div class="card-header">
      <h3 class="card-name">{{ name }}</h3>
      <div class="card-price">
        <span class="price-amount" :style="{ color: priceColorVar }">{{ formatPrice(price) }}</span>
        <span v-if="priceQualifier" class="price-qualifier">{{ priceQualifier }}</span>
      </div>
    </div>
    <div class="card-content">
      <div v-if="who" class="card-who">
        <slot name="who">For {{ who }}</slot>
      </div>
      <div v-if="features && features.length" class="card-features">
        <div v-if="featuresTitle" class="features-title">
          {{ featuresTitle }}
        </div>
        <div v-for="feature in features" :key="feature" class="feature-item">
          {{ feature }}
        </div>
      </div>
    </div>
    <div class="card-footer">
      <VPButton
        :href="ctaHref"
        :text="ctaText"
        :theme="ctaTheme"
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

.card-header {
  margin-bottom: 24px;
}

.card-name {
  font-size: 1.4rem;
  font-weight: 650;
  margin: 2px 0 16px 0;
  color: var(--vp-c-text-1);
}

.card-price {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.price-amount {
  font-size: 2rem;
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
  color: var(--vp-c-text-1-5);
  line-height: 1.5;
  margin-bottom: 24px;
}

.card-features {
  margin-top: 0;
}

.features-title {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--vp-c-text-3);
  margin-bottom: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.feature-item {
  font-size: 0.875rem;
  color: var(--vp-c-text-1-5);
  margin-bottom: 8px;
  line-height: 1.4;
  font-weight: 400;
}

.card-footer {
  margin-top: 6px;
  margin-bottom: 6px;
}
</style>
