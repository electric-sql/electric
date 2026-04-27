<script setup lang="ts">
/* OgHomepage — site-wide social fallback (`DEFAULT_IMAGE` in
   config.mts).
 *
 * Renders the live `<HomeHero>` directly inside the 1200x630 OG
 * frame, paused and with its CTA buttons hidden. Reusing the live
 * hero means any text or layout tweak on the homepage propagates
 * to the social card automatically — there's no second source of
 * truth to keep in sync.
 *
 * The scoped `:deep()` overrides below tune the live hero for the
 * social card's fixed geometry:
 *
 *   - The live hero uses 24px horizontal padding on `.home-hero`
 *     and shifts the text column 16px further left (`-16px` margin)
 *     at the desktop breakpoint, so the headline lands ~8px from
 *     the viewport edge. In the OG frame the wordmark sits at
 *     left:40px, and we want the headline to align with it — so we
 *     swap to 40px padding and zero out the text-column shift.
 *
 *   - The live `.home-hero-scene` is opacity:0.85 (it's a
 *     supporting illustration on the live page) and uses a 7fr/5fr
 *     grid that gives the iso composition a relatively narrow
 *     column. On the social card the iso scene IS the visual
 *     story, so we widen the scene column, raise opacity to 1,
 *     and bump min/max-height so it fills more of the 630px frame
 *     vertically.
 */
import HomeHero from "../home/HomeHero.vue"
import OgFrame from "./OgFrame.vue"
</script>

<template>
  <OgFrame>
    <HomeHero
      :paused="true"
      :hide-actions="true"
    />
  </OgFrame>
</template>

<style scoped>
/* Outer hero band: align headline with the wordmark at 40px and
   zero out the section's vertical padding (the OgFrame stage
   already centres the slotted hero inside the 630px frame, so the
   live hero's top/bottom padding would just push the text further
   off-centre). */
:deep(.home-hero) {
  padding: 0 40px;
}

/* Inner box: pin the width to the padded outer (1200 - 80 = 1120)
   so the grid below has the full available width to allocate
   between the text column and the iso scene.
   `width` (not just `max-width`) is critical here: the OG frame
   stage flexes `.home-hero` to fill the stage, so `.home-hero-inner`
   becomes a flex item under `flex: 0 1 auto` and would otherwise
   shrink to its content's intrinsic width — which collapses the
   grid columns well below 1120px and pushes the headline into a
   three-line wrap. */
:deep(.home-hero-inner) {
  width: 1120px;
  max-width: 1120px;
}

/* Cancel the live hero's `min-width: 1200px` desktop nudge that
   pulls the text column 16px to the left — that nudge is calibrated
   for the 1280px-wide live page, not for the OG card.
   We then shift the text column 45px to the right so the headline's
   left edge aligns with the 'e' in the `electric` wordmark rather
   than the lightning-bolt icon at the wordmark's left edge.
   The wordmark SVG is `viewBox="0 0 1024 284"` rendered at
   `height: 48px` (see `OgFrame.vue`), so 1 CSS pixel = 284/48
   viewBox units. The 'e' glyph's leftmost x is 265 in viewBox
   space → 265 * 48 / 284 ≈ 44.8 CSS pixels from the SVG's left
   edge. The SVG is positioned at `left: 40px` and the hero text
   sits flush with that edge via the `padding: 0 40px` above, so a
   `translateX(45px)` here brings the headline directly under the
   'e'. We use `transform` (not extra margin) so the grid layout
   above keeps allocating the same 600px text track — the
   visible-character widths of "The agent platform" (~490–520px at
   56px bold) stay comfortably inside that track even after the
   shift, so the iso scene cell isn't crowded.
   The 45px math gets us geometrically flush with the 'e', but
   capital letters like "T" carry a tiny optical overhang past the
   nominal sidebearing, so we trim 2px to 43px so the headline reads
   visually-centred under the 'e' rather than slightly inboard. */
:deep(.home-hero-text) {
  margin-left: 0;
  transform: translateX(43px);
}

/* Pin the grid to explicit pixel columns instead of fractions.
   The live hero's `.home-hero-scene` carries an `aspect-ratio: 5/4`
   plus a `min-height` (420–620px depending on viewport), which
   gives the scene cell a *minimum width* of `min-height * 5/4`.
   Inside an `fr`-based grid, that intrinsic minimum wins over the
   fr ratios — the scene cell expands until its aspect-ratio is
   satisfied and the text column gets whatever's left. With the
   live `min-height: 420px`, the scene can pin to ~525px wide and
   strand the text column at ~565px; raising `min-height` to anchor
   a "punchier" scene (the OG card's previous approach) only made
   the imbalance worse, choking the headline column into a
   three-line "The / agent / platform" wrap.
   Explicit pixel columns side-step the aspect-ratio fight: the
   grid hands each cell a fixed track and the scene's content
   sizes itself inside that track. 600px of text gives "The agent
   platform" comfortable room at 56px bold; 492px of scene gives
   the iso composition enough footprint to read as a layered
   stack while staying out of the headline's way. */
:deep(.home-hero-grid) {
  grid-template-columns: 600px 492px;
  gap: 28px;
}

/* Lift the live hero's `max-width: 600px` cap on the headline so
   it can fully use the 600px text column we've allotted above.
   Without this bump, the cap clips a few px off the cap-height
   line of "The agent platform" at 56px bold and pushes it into a
   second line. */
:deep(.home-hero-name) {
  max-width: 600px;
}

/* Iso scene at full intensity (the live hero knocks it back to
   0.85 as a supporting illustration). Height is sized to honour
   the live `aspect-ratio: 5/4` inside the 492px column —
   492 * 4/5 ≈ 394px — with a small max-height ceiling so any
   intrinsic content growth doesn't push the scene past the 630px
   frame. */
:deep(.home-hero-scene) {
  opacity: 1;
  min-height: 380px;
  max-height: 420px;
}
</style>
