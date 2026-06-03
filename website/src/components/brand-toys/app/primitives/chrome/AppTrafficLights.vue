<script setup lang="ts">
/* AppTrafficLights — macOS close / minimize / maximize dots.
   ─────────────────────────────────────────────────────────────────
   Three 12-px circles, 8-px gap, real macOS colours
   (#ff5f57 / #febc2e / #28c840). Glyphs (×, −, +) appear inside the
   dots when `state="hover"` or `state="active"`, matching macOS
   behaviour where the glyphs are normally hidden and revealed when
   the cursor enters the traffic-light area.

   We do not delegate to native window chrome — the marketing mockup
   is HTML, not an Electron BrowserWindow. The dots here are rendered
   purely in CSS so they look right at any DPI and in a screenshot.

   Pure primitive — does NOT include a `.app-mockup-root` wrapper.
   Mount inside a scene or toy that provides the cascade. */

withDefaults(
  defineProps<{
    /**
     * Visual state of the dots.
     *  - `normal`: filled dots, no glyphs (default macOS look).
     *  - `hover`: glyphs visible (cursor over the group).
     *  - `active`: window has focus AND cursor over the group —
     *    same as `hover` for our purposes.
     */
    state?: 'normal' | 'hover' | 'active'
  }>(),
  { state: 'normal' }
)
</script>

<template>
  <div class="traffic-lights" :data-state="state" aria-hidden="true">
    <span class="dot dot-close">
      <span class="glyph glyph-close" />
    </span>
    <span class="dot dot-min">
      <span class="glyph glyph-min" />
    </span>
    <span class="dot dot-max">
      <span class="glyph glyph-max" />
    </span>
  </div>
</template>

<style scoped>
.traffic-lights {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  /* Anti-aliasing helper — keeps the small dot edges crisp. */
  flex-shrink: 0;
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* A faint inner ring (1px, 12% opacity) is what gives macOS dots
     their slightly-engraved look. Hidden behind the glyph layer. */
  box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.2);
  position: relative;
}

.dot-close {
  background: #ff5f57;
}
.dot-min {
  background: #febc2e;
}
.dot-max {
  background: #28c840;
}

/* Glyphs — drawn with 1-px lines for the X / − / +. Hidden by default
   and revealed when the parent's data-state flips to hover/active. */
.glyph {
  opacity: 0;
  transition: opacity 0.12s ease;
  color: #4d0000; /* dark red for close X — common macOS glyph color */
  /* Centred. The actual glyph shape is drawn via the variant below. */
  position: relative;
  width: 6px;
  height: 6px;
  display: inline-block;
}

.dot-min .glyph {
  color: #5a3a00;
}
.dot-max .glyph {
  color: #003305;
}

/* Reveal glyphs on hover/active. */
.traffic-lights[data-state='hover'] .glyph,
.traffic-lights[data-state='active'] .glyph {
  opacity: 1;
}

/* Glyph shapes — pure pseudo-elements so we don't ship icons. */
.glyph-close::before,
.glyph-close::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 6.5px;
  height: 1px;
  background: currentColor;
  border-radius: 1px;
}
.glyph-close::before {
  transform: rotate(45deg);
}
.glyph-close::after {
  transform: rotate(-45deg);
}

.glyph-min::before {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 6.5px;
  height: 1px;
  background: currentColor;
  border-radius: 1px;
}

.glyph-max::before,
.glyph-max::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  background: currentColor;
  border-radius: 1px;
}
.glyph-max::before {
  width: 6.5px;
  height: 1px;
}
.glyph-max::after {
  width: 1px;
  height: 6.5px;
}
</style>
