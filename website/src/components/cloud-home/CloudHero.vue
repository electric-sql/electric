<script setup lang="ts">
/* Cloud landing-page hero — extracted from `CloudHomePage.vue` so the
   same hero block can be re-rendered headlessly on the `/og/cloud`
   social-image route without duplicating markup or styling. The two
   surfaces stay in lockstep: any text or layout tweak made here
   propagates to the live page and the OG capture together.

   Mirrors the agents / streams / sync hero extraction pattern: the
   live page mounts this with no props, the OG card mounts it with
   `paused`, `hideActions`, and an `extraExcludeRects` array carrying
   the wordmark's bbox so the mesh canvas doesn't paint under the
   brand mark in the social card's top-left corner. */
import { ref } from "vue"
import { VPButton } from "vitepress/theme"

import MeshOfStreams from "../brand-toys/MeshOfStreams.vue"

withDefaults(
  defineProps<{
    /* paused freezes ambient activity on the mesh-of-streams
       background: no message tokens travel along the rails, no
       wheel rotation, no segment pulses. Used by the OG capture so
       the screenshotted frame is a stable, deterministic still. */
    paused?: boolean
    /* hideActions removes the row of CTA buttons (Start building
       now, Docs, Pricing) below the tagline. Set on the OG capture
       so the social graphic shows just the headline + tagline +
       mesh, not interactive CTAs that have no meaning on a static
       image. */
    hideActions?: boolean
    /* extraExcludeRects forwards to `<MeshOfStreams>`. Used by the
       OG capture to reserve the wordmark's bbox in the frame's
       top-left corner so the mesh canvas never paints under the
       brand mark. */
    extraExcludeRects?: { left: number; top: number; right: number; bottom: number }[]
  }>(),
  { paused: false, hideActions: false, extraExcludeRects: () => [] }
)

const heroInnerRef = ref<HTMLElement>()
</script>

<template>
  <section class="cl-hero">
    <!-- Procedural "mesh of streams" backdrop. Mirrors the streams hero
         pattern: pass `excludeEl` so the headline / tagline / CTA row
         punches a soft hole in the rails so the copy is always
         readable. The mesh is decorative, so we set `pointer-events:
         none` on the wrapper via the `cl-hero-mesh` class. -->
    <MeshOfStreams
      class="cl-hero-mesh md-exclude"
      seed="cloud-hero"
      layout="wide"
      :wheel-count="14"
      :connection-density="0.85"
      :grid-size="24"
      :corner-radius="14"
      :track-width="1"
      :intensity="0.55"
      edge-connections
      :exclude-el="heroInnerRef"
      :exclude-margin="28"
      :exclude-feather="44"
      :paused="paused"
      :extra-exclude-rects="extraExcludeRects"
    />
    <div ref="heroInnerRef" class="cl-hero-inner">
      <h1 class="cl-hero-name">
        Electric&nbsp;<span class="cl-hero-accent">Cloud</span>
      </h1>
      <p class="cl-hero-tagline">
        Scalable data infrastructure platform for building fast, modern apps
        and <span class="no-wrap">multi-agent systems</span>.
      </p>

      <div v-if="!hideActions" class="cl-hero-row">
        <VPButton
          tag="a"
          size="medium"
          theme="brand"
          text="Start building now"
          href="https://dashboard.electric-sql.cloud/"
        />
        <VPButton
          tag="a"
          size="medium"
          theme="alt"
          text="Docs"
          href="/cloud/usage"
        />
        <VPButton
          tag="a"
          size="medium"
          theme="alt"
          text="Pricing"
          href="/pricing"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Mirrors the structure of the streams / sync homepage hero so the
   four landing pages (agents / streams / sync / cloud) feel like a
   matched set: centered name with gradient + brand-coloured
   underline, tagline, then a row of CTAs. */

.cl-hero {
  position: relative;
  /* Matches the trimmed agents / streams / sync product heroes
     (72/56) so the four landing pages share the same vertical rhythm. */
  padding: 72px 24px 56px;
  text-align: center;
  overflow: hidden;
  /* No bg colour — the hero inherits the page surface (light or dark
     theme) so the four product pages share the same look. The mesh
     paints transparent except for the brand-teal tracks / wheels and
     fades to the page bg via the canvas's built-in radial mask. */
  /* Floor the height so the mesh has room to read as a network of
     wheels, not just a thin band of tracks. The hero text + CTAs
     normally measure ~280px tall; bumping the floor to 460px gives
     the mesh ~180px of breathing room above and below. Caps on
     narrower viewports below. */
  min-height: 460px;
}

.cl-hero-mesh {
  position: absolute;
  inset: 0;
  z-index: 0;
  /* Decorative — never intercept clicks meant for the CTAs above. */
  pointer-events: none;
}

.cl-hero-inner {
  position: relative;
  z-index: 1;
  max-width: 880px;
  margin: 0 auto;
  pointer-events: none;
}

.cl-hero-inner > * {
  pointer-events: auto;
}

.cl-hero-name {
  /* Standardized to 56px to match agents / streams / sync hero names. */
  font-size: 56px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
  background: none;
  -webkit-background-clip: border-box;
  background-clip: border-box;
  -webkit-text-fill-color: currentColor;
  /* Inherit the page text colour so the headline reads correctly on
     both the light and dark themes (was hard-coded #f3f7ff back when
     the hero forced a dark bg). */
  color: var(--vp-c-text-1);
  margin: 0;
  padding-bottom: 4px;
  text-wrap: balance;
}

.cl-hero-accent {
  color: var(--vp-c-brand-1);
  -webkit-text-fill-color: currentColor;
}

.cl-hero-tagline {
  font-family: var(--vp-font-family-base);
  /* Slightly smaller than the 28px tagline on the other product heroes
     because the cloud tagline is a longer descriptive sentence rather
     than a snappy strapline. 22px keeps the H1 → tagline hierarchy
     consistent across the matched set. */
  font-size: 22px;
  font-weight: 500;
  /* Inherit the muted page text colour (was hard-coded light back
     when the hero forced a dark bg). */
  color: var(--vp-c-text-2);
  margin: 24px auto 0;
  max-width: 720px;
  line-height: 1.4;
  text-wrap: balance;
}

.cl-hero-row {
  margin-top: 32px;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

@media (max-width: 768px) {
  .cl-hero {
    /* Bumped horizontal padding from 20 → 24 for more breathing room
       from the viewport edge on tablets / large phones. */
    padding: 56px 24px 40px;
    min-height: 380px;
  }
  .cl-hero-name {
    font-size: 36px;
  }
  .cl-hero-tagline {
    font-size: 18px;
  }
}

@media (max-width: 480px) {
  .cl-hero {
    /* Bumped horizontal padding from 16 → 20 for breathing room. */
    padding: 44px 20px 32px;
    min-height: 320px;
  }
  .cl-hero-name {
    font-size: 28px;
  }
  .cl-hero-tagline {
    font-size: 16px;
  }
  /* Stack the three CTAs full-width on the smallest screens so the
     primary / Docs / pricing trio doesn't wrap awkwardly. */
  .cl-hero-row {
    flex-direction: column;
    align-items: stretch;
    max-width: 280px;
    margin-left: auto;
    margin-right: auto;
  }
}

.no-wrap {
  white-space: nowrap;
}
</style>
