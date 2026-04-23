<script setup lang="ts">
/* MidPageStrap — full-bleed CTA punctuation between sections.
   ──────────────────────────────────────────────────────────
   Originally inlined as `.ea-mid-strap` in `agents-home/HomePage.vue`.
   Lifted into a shared component so the same pattern can be reused on
   the Streams / Sync / Cloud landing pages without copy-paste drift.

   Layout:
     [eyebrow chip]
     [title]
     [tagline]
     [actions]

   `tone` controls the background:
     bg       — uses `--ea-bg` (page's deepest surface in dark mode);
                pairs with a *lighter* section above to read as a step
                *down* — the agents-page placement.
     surface  — uses `--ea-surface` (the slightly raised tone); pairs
                with a *darker* section above for the inverse step. */

defineProps<{
  id?: string
  tone?: "bg" | "surface"
}>()
</script>

<template>
  <section
    class="mid-strap"
    :class="`mid-strap--${tone ?? 'bg'}`"
    :id="id"
  >
    <div class="mid-strap-inner">
      <div v-if="$slots.eyebrow" class="mid-strap-eyebrow mono">
        <span class="dot" />
        <slot name="eyebrow" />
      </div>
      <h2 class="mid-strap-title">
        <slot name="title" />
      </h2>
      <p v-if="$slots.tagline" class="mid-strap-tagline">
        <slot name="tagline" />
      </p>
      <div v-if="$slots.actions" class="mid-strap-actions">
        <slot name="actions" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.mid-strap {
  position: relative;
  padding: 80px 24px;
  border-bottom: 1px solid var(--ea-divider);
  isolation: isolate;
  overflow: hidden;
}
.mid-strap--bg {
  background: var(--ea-bg);
}
.mid-strap--surface {
  background: var(--ea-surface);
}
.mid-strap::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse 70% 90% at 50% 50%,
    color-mix(in srgb, var(--vp-c-brand-1) 7%, transparent) 0%,
    transparent 60%
  );
  z-index: -1;
  opacity: 0.85;
}

.mid-strap-inner {
  max-width: 720px;
  margin: 0 auto;
  text-align: center;
}

.mid-strap-eyebrow {
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
  margin-bottom: 18px;
}
.mid-strap-eyebrow .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}

.mid-strap-title {
  font-size: 34px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.015em;
  color: var(--ea-text-1);
  margin: 0 auto;
  max-width: 580px;
  text-wrap: balance;
}

.mid-strap-tagline {
  font-family: var(--vp-font-family-base);
  font-size: 16px;
  line-height: 1.6;
  color: var(--ea-text-2);
  margin: 14px auto 0;
  max-width: 520px;
}

.mid-strap-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 28px;
}

/* Accent token usable inside the title slot — `.mid-strap-accent`
   gets the same hero-gradient text fill as the bottom CTA accent. */
.mid-strap :deep(.mid-strap-accent) {
  background: var(--vp-home-hero-name-background);
  -webkit-background-clip: text;
  background-clip: text;
  color: var(--vp-home-hero-name-color);
}

@media (max-width: 768px) {
  .mid-strap {
    padding: 60px 24px;
  }
  .mid-strap-title {
    font-size: 26px;
  }
  .mid-strap-tagline {
    font-size: 15px;
  }
}

@media (max-width: 480px) {
  .mid-strap {
    padding: 48px 20px;
  }
  .mid-strap-title {
    font-size: 22px;
  }
  .mid-strap-actions {
    flex-direction: column;
    align-self: stretch;
    max-width: 280px;
    margin-left: auto;
    margin-right: auto;
  }
}
</style>
