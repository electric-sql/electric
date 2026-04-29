<script setup>
/* LogoDownloads — 2-tile grid for the Logos section on the Contact
   page. Each tile previews a logo on its intended background (dark
   vs. light) and links to the SVG with a `download` attribute so
   clicking saves the file instead of navigating to it. Replaces the
   previous bulleted list of "logo / inverse logo" links. */
</script>

<template>
  <div class="ld-grid">
    <a class="ld-tile" href="/img/brand/logo.svg" download="electric-logo.svg">
      <div class="ld-preview ld-preview-dark">
        <img src="/img/brand/logo.svg" alt="Electric logo on dark" />
      </div>
      <div class="ld-meta">
        <h3 class="ld-title">Dark backgrounds</h3>
        <p class="ld-filename mono">logo.svg</p>
        <span class="ld-cta mono">Download →</span>
      </div>
    </a>

    <a
      class="ld-tile"
      href="/img/brand/logo.inverse.svg"
      download="electric-logo-inverse.svg"
    >
      <div class="ld-preview ld-preview-light">
        <img
          src="/img/brand/logo.inverse.svg"
          alt="Electric inverse logo on light"
        />
      </div>
      <div class="ld-meta">
        <h3 class="ld-title">Light backgrounds</h3>
        <p class="ld-filename mono">logo.inverse.svg</p>
        <span class="ld-cta mono">Download →</span>
      </div>
    </a>
  </div>
</template>

<style scoped>
.ld-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin: 24px 0 40px;
}

.ld-tile {
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

.ld-tile:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}

.ld-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
  min-height: 140px;
  border-bottom: 1px solid var(--ea-divider);
}

.ld-preview img {
  max-width: 100%;
  max-height: 72px;
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
}

.ld-preview-dark {
  background: #0f1115;
}

.ld-preview-light {
  background: #ffffff;
}

.ld-meta {
  padding: 16px 20px 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ld-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ea-text-1);
  margin: 0;
  line-height: 1.3;
}

.ld-filename {
  font-size: 12px;
  font-family: var(--vp-font-family-mono);
  color: var(--ea-text-3);
  margin: 0;
}

.ld-cta {
  font-size: 12px;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-brand-1);
  font-weight: 500;
  letter-spacing: 0.01em;
  margin-top: 6px;
}

@media (max-width: 549px) {
  .ld-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }
}
</style>
