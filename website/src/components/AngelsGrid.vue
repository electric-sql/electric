<script setup>
/* AngelsGrid — compact 4-column grid of angel investors. Smaller
   footprint than TeamMembers cards so the full list of backers fits
   on screen without dominating the page. Each card: small rounded
   headshot on top, name, then a short bio (typically "CEO/CTO of
   Company"). Entire card is an anchor linking to the angel's
   profile URI. */

const { items } = defineProps(['items'])
</script>

<template>
  <div class="ag-grid">
    <a
      v-for="item in items"
      :id="item.slug"
      :key="item.slug"
      :href="item.profile_uri"
      target="_blank"
      rel="noopener"
      class="ag-card"
    >
      <div class="ag-image">
        <img :src="item.image" :alt="item.name" />
      </div>
      <div class="ag-body">
        <h4 class="ag-name">{{ item.name }}</h4>
        <p class="ag-bio">{{ item.short_bio }}</p>
      </div>
    </a>
  </div>
</template>

<style scoped>
.ag-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin: 24px 0 48px;
}

.ag-card {
  display: flex;
  flex-direction: column;
  padding: 14px;
  border: 1px solid var(--ea-divider);
  border-radius: 10px;
  background: var(--ea-surface);
  text-decoration: none !important;
  color: inherit;
  transition:
    border-color 0.2s ease,
    transform 0.2s ease;
}

.ag-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}

.ag-image {
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 12px;
  aspect-ratio: 1 / 1;
  background: var(--vp-c-bg-soft);
}

.ag-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ag-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ag-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--ea-text-1);
  margin: 0;
  line-height: 1.3;
}

.ag-bio {
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--ea-text-2);
  margin: 0;
}

@media (max-width: 959px) {
  .ag-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
  }
}

@media (max-width: 699px) {
  .ag-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 419px) {
  .ag-grid {
    grid-template-columns: 1fr;
  }
}
</style>
