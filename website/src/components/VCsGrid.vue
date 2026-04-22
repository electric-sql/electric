<script setup>
/* VCsGrid — horizontal cards for VC firms. Logo treatment instead of
   headshot (VCs are almost always represented by firm branding on
   team pages, not individual faces). The logo sits on a lighter
   surface stripe at the top of the card; firm name and short bio
   follow below. Each card is an anchor wrapping the full tile. */

const { items } = defineProps(['items'])
</script>

<template>
  <div class="vc-grid">
    <a
      v-for="item in items"
      :id="item.slug"
      :key="item.slug"
      :href="item.profile_uri"
      target="_blank"
      rel="noopener"
      class="vc-card"
    >
      <div class="vc-logo">
        <img :src="item.image" :alt="item.name" />
      </div>
      <div class="vc-body">
        <h4 class="vc-name">{{ item.name }}</h4>
        <p class="vc-bio">{{ item.short_bio }}</p>
        <div class="vc-url mono">{{ item.profile_display_uri }}</div>
      </div>
    </a>
  </div>
</template>

<style scoped>
.vc-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  margin: 24px 0 48px;
}

.vc-card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ea-divider);
  border-radius: 12px;
  background: var(--ea-surface);
  overflow: hidden;
  text-decoration: none !important;
  color: inherit;
  transition:
    border-color 0.2s ease,
    transform 0.2s ease;
}

.vc-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}

.vc-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 24px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--ea-divider);
  min-height: 120px;
}

.vc-logo img {
  max-width: 100%;
  max-height: 72px;
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
}

.vc-body {
  padding: 18px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.vc-name {
  font-size: 17px;
  font-weight: 700;
  color: var(--ea-text-1);
  margin: 0;
  line-height: 1.3;
  letter-spacing: -0.005em;
}

.vc-bio {
  font-size: 14px;
  line-height: 1.5;
  color: var(--ea-text-2);
  margin: 0;
}

.vc-url {
  font-size: 11.5px;
  font-family: var(--vp-font-family-mono);
  color: var(--ea-text-3);
  letter-spacing: 0.01em;
  margin-top: 4px;
}

@media (max-width: 959px) {
  .vc-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 549px) {
  .vc-grid {
    grid-template-columns: 1fr;
  }
}
</style>
