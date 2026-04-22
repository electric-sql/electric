<script setup>
/* TeamMembers — full card treatment for the Core team and Advisors
   sections on /about/team. Photo on top, mono-font eyebrow with role
   + location, bold name, short bio, and a small social-link row at
   the bottom. Each card is a single anchor wrapping the whole tile
   (fixes the four-stacked-anchors pattern from the previous version). */

const { items } = defineProps(['items'])
</script>

<template>
  <div class="tm-grid">
    <a
      v-for="item in items"
      :id="item.slug"
      :key="item.slug"
      :href="item.profile_uri"
      target="_blank"
      rel="noopener"
      class="tm-card"
    >
      <div class="tm-image">
        <img :src="item.image" :alt="item.name" />
      </div>

      <div class="tm-eyebrow mono">
        <span class="tm-role">{{ item.job_title }}</span>
        <span class="tm-place">
          <img
            v-if="item.flag"
            class="tm-flag"
            :src="`/img/flags/${item.flag}.svg`"
            :alt="item.country"
          />
          <span class="tm-location">{{ item.location }}</span>
        </span>
      </div>

      <h3 class="tm-name">{{ item.name }}</h3>
      <p class="tm-bio">{{ item.short_bio }}</p>

      <div v-if="item.profile_display_uri" class="tm-social mono">
        <span
          class="tm-social-icon"
          :class="`vpi-${item.profile_icon}`"
        />
        <span class="tm-social-handle">{{ item.profile_display_uri }}</span>
      </div>
    </a>
  </div>
</template>

<style scoped>
.tm-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  margin: 24px 0 48px;
}

.tm-card {
  display: flex;
  flex-direction: column;
  padding: 18px 18px 20px;
  border: 1px solid var(--ea-divider);
  border-radius: 12px;
  background: var(--ea-surface);
  text-decoration: none !important;
  color: inherit;
  transition:
    border-color 0.2s ease,
    transform 0.2s ease;
}

.tm-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}

.tm-image {
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 16px;
  aspect-ratio: 1 / 1;
  background: var(--vp-c-bg-soft);
}

.tm-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.tm-eyebrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 14px;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ea-text-3);
  margin-bottom: 10px;
  font-family: var(--vp-font-family-mono);
  line-height: 1.4;
}

.tm-role {
  white-space: nowrap;
}

.tm-place {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.tm-flag {
  width: 14px;
  height: auto;
  border-radius: 2px;
  flex-shrink: 0;
}

.tm-location {
  white-space: nowrap;
}

.tm-name {
  font-size: 18px;
  font-weight: 700;
  color: var(--ea-text-1);
  margin: 0 0 6px;
  line-height: 1.3;
  letter-spacing: -0.005em;
}

.tm-bio {
  font-size: 14px;
  line-height: 1.55;
  color: var(--ea-text-2);
  margin: 0 0 16px;
  flex: 1;
}

.tm-social {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--ea-text-3);
  font-family: var(--vp-font-family-mono);
}

.tm-social-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  opacity: 0.85;
}

.tm-social-handle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

@media (max-width: 959px) {
  .tm-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 549px) {
  .tm-grid {
    grid-template-columns: 1fr;
  }
}
</style>
