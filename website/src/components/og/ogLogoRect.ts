/* Bounding box of the Electric wordmark overlaid by `OgFrame.vue` in
   the top-left of every social card, expressed in the same parent-
   relative coordinate frame the hero backgrounds use for their
   exclusion rects.
 *
 * `OgFrame` paints the wordmark via:
 *   `position: absolute; top: 32px; left: 40px; height: 48px; width: auto;`
 * The svg's intrinsic ratio (1024 / 284) gives a rendered width of
 * ~173 px at 48 px height. We add ~12 px of padding on every side so
 * the canvas geometry keeps a comfortable air-gap from the wordmark's
 * outer ink, not just its bbox.
 *
 * Each OG wrapper feeds this rect into its hero's `extraExcludeRects`
 * prop, which is plumbed through to the underlying canvas component
 * (`HeroNetworkBg`, `StreamFlowBg`, `SyncFanOutBg`). The hero section
 * fills the entire 1200x630 frame inside `OgFrame`, so a rect in
 * frame-relative coords is identical to one in hero-section coords —
 * we don't need any per-hero offset translation here.
 */
export const OG_LOGO_EXCLUDE_RECT = {
  left: 28,
  top: 20,
  right: 225,
  bottom: 92,
}
