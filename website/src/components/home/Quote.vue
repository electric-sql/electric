<script setup>
import Card from './Card.vue'

const { image, href } = defineProps(['image', 'href'])
</script>

<style scoped>
.quote {
  font-style: italic;
  font-weight: 450;
  font-size: 14px;
  color: var(--vp-c-text-2);
}

.quote-caption {
  margin-top: 12px;
  font-weight: 450;
  font-size: 14px;
  color: var(--vp-c-text-3);
}

@media (max-width: 559px) {
  .quote {
    font-size: 13px;
  }
  .quote-caption {
    font-size: 13px;
    margin-bottom: 6px;
  }
}
</style>

<template>
  <Card :image="image" :href="href">
    <div class="quote">
      <slot name="quote" />
    </div>
    <div class="quote-caption">
      <slot name="attribution" />
    </div>
  </Card>
</template>
