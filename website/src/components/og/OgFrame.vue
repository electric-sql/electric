<script setup lang="ts">
/* OgFrame — shared 1200x630 chrome for every /og/* route.
 *
 * Each card slots its own content into this frame. The frame's job is
 * deliberately minimal:
 *   - Lock the rendered surface to exactly 1200x630, so the
 *     Playwright capture can clip the viewport directly without any
 *     cropping math.
 *   - Apply the same `--ea-bg` plate the live site uses, so cards
 *     that don't paint their own background still match the brand
 *     surface tone.
 *   - Stamp the Electric wordmark in the top-left as an absolutely-
 *     positioned overlay. The hero components slotted in carry their
 *     own headline / tagline / install-pill copy and an animated
 *     canvas that paints under everything; the wordmark sits above
 *     all of it so the brand reads no matter what's drawn behind. */
</script>

<template>
  <div class="og-frame">
    <div class="og-frame-stage">
      <slot />
    </div>
    <img class="og-frame-logo" src="/img/brand/logo.svg" alt="Electric" />
  </div>
</template>

<style scoped>
.og-frame {
  /* Lock to the social-card dimensions exactly. The Playwright capture
     uses a 1200x630 viewport and clips the viewport directly, so any
     scrollbar / margin / padding outside this box never enters the
     screenshot. */
  width: 1200px;
  height: 630px;
  position: relative;
  overflow: hidden;
  /* Match the site's force-dark plate so any space the slotted hero
     doesn't fill (top/bottom gutters introduced by hero padding)
     reads as the same brand surface tone, not a separate card. */
  background: var(--ea-bg, #0c0e14);
  color: var(--ea-text-1, rgba(255, 255, 245, 0.94));
  font-family: var(--vp-font-family-base);
}

/* Centering stage for the slotted hero. The live heros are sections
   with vertical padding sized for the tall live page, so the
   inner content (headline + tagline + pill) is shorter than 630px
   even when the bg canvas fills the frame. We force the slotted
   hero section to fill the full 1200x630 stage and switch to flex
   so the inner content lands in the visual middle of the card.
   The hero's animated bg canvas is `position: absolute; inset: 0`
   on the section — making the section fill the stage means the
   canvas paints under the full social card, not just under the
   text it lives next to on the live page. */
.og-frame-stage {
  position: absolute;
  inset: 0;
  display: flex;
}

/* The slotted hero `<section>` (`.ea-hero` / `.sh-hero` / `.ds-hero`
   / `.home-hero`) is the direct child of the stage — make it fill
   the stage and centre its inner content vertically. We zero out
   the section's vertical padding (which was sized for the live
   landing-page rhythm, not the 630px social card) but keep some
   horizontal padding so the headline still has gutter to breathe.
   Using `:deep()` because the hero is rendered inside the slot and
   carries its own scoped class names. */
.og-frame-stage > :deep(*) {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-top: 0;
  padding-bottom: 0;
  box-sizing: border-box;
}

.og-frame-logo {
  /* Overlay the wordmark above whatever the hero paints (animated
     canvas, gradients, geometry) so the brand reads regardless of
     the hero's background tone. Slightly inset from the corner to
     give the mark room to breathe; sized to feel anchored without
     overpowering the hero copy.
     If you change `height` here, update the matching pixel maths in
     `ogLogoRect.ts` so the per-hero canvas exclusion rect still
     wraps the new wordmark footprint. */
  position: absolute;
  top: 32px;
  left: 40px;
  height: 48px;
  width: auto;
  display: block;
  z-index: 10;
  pointer-events: none;
}
</style>
