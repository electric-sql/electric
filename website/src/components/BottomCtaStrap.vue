<script setup lang="ts">
/* BottomCtaStrap — page-close CTA strap.
   ──────────────────────────────────────
   Originally inlined as `.ea-cta-strap` in `agents-home/HomePage.vue`.
   Lifted into a shared component so the same pattern can be reused on
   the Streams / Sync / Cloud landing pages without copy-paste drift.

   Layout:
     [eyebrow chip]
     [title — supports `.bottom-cta-accent` span for gradient word]
     [tagline]
     [#install slot — typically an <InstallPill tone="sunken" />]
     [actions]

   Background uses `--ea-surface-alt` (the slightly raised tone) so
   the page-close panel reads as a lift off the deepest page surface
   rather than sitting at the same depth. */

defineProps<{
  id?: string
}>()
</script>

<template>
  <section class="bottom-cta-strap" :id="id">
    <div class="bottom-cta">
      <div v-if="$slots.eyebrow" class="bottom-cta-eyebrow mono">
        <span class="dot" />
        <slot name="eyebrow" />
      </div>
      <h2 class="bottom-cta-title">
        <slot name="title" />
      </h2>
      <p v-if="$slots.tagline" class="bottom-cta-tagline">
        <slot name="tagline" />
      </p>
      <div v-if="$slots.install" class="bottom-cta-install">
        <slot name="install" />
      </div>
      <div v-if="$slots.actions" class="bottom-cta-buttons">
        <slot name="actions" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.bottom-cta-strap {
  position: relative;
  padding: 96px 24px;
  background: var(--ea-surface-alt);
  border-bottom: 1px solid var(--ea-divider);
  isolation: isolate;
  overflow: hidden;
}
.bottom-cta-strap::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse 80% 100% at 50% 50%,
    color-mix(in srgb, var(--vp-c-brand-1) 9%, transparent) 0%,
    transparent 60%
  );
  z-index: -1;
  opacity: 0.85;
}

.bottom-cta {
  position: relative;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  max-width: 720px;
  margin: 0 auto;
}

.bottom-cta-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ea-text-3);
  padding: 4px 10px;
  background: var(--ea-surface-alt);
  border: 1px solid var(--ea-divider);
  border-radius: 999px;
  margin-bottom: 22px;
}
.bottom-cta-eyebrow .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}

.bottom-cta-title {
  font-size: 38px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.015em;
  color: var(--ea-text-1);
  margin: 0;
  max-width: 560px;
  text-wrap: balance;
}

/* Accent token usable inside the title slot — wrap a word in
   `<span class="bottom-cta-accent">…</span>` for the hero gradient. */
.bottom-cta :deep(.bottom-cta-accent) {
  background: var(--vp-home-hero-name-background);
  -webkit-background-clip: text;
  background-clip: text;
  color: var(--vp-home-hero-name-color);
}

.bottom-cta-tagline {
  font-family: var(--vp-font-family-base);
  font-size: 16px;
  line-height: 1.6;
  color: var(--ea-text-2);
  margin: 14px auto 0;
  max-width: 460px;
}

/* Spacing between tagline → install pill is owned here so callers
   don't need to reach for `--margin-top` overrides on the shared
   InstallPill component. */
.bottom-cta-install {
  margin-top: 28px;
}

.bottom-cta-buttons {
  display: flex;
  gap: 10px;
  margin-top: 24px;
  flex-wrap: wrap;
  justify-content: center;
}

@media (max-width: 768px) {
  .bottom-cta-strap {
    padding: 72px 24px;
  }
}

@media (max-width: 480px) {
  .bottom-cta-strap {
    padding: 56px 20px;
  }
  .bottom-cta-title {
    font-size: 28px;
  }
  .bottom-cta-buttons {
    flex-direction: column;
    align-self: stretch;
    max-width: 280px;
    margin-left: auto;
    margin-right: auto;
  }
}
</style>
