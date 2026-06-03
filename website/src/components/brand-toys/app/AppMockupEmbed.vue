<script setup lang="ts">
/* AppMockupEmbed — page-side wrapper for desktop-app mockups.
   ─────────────────────────────────────────────────────────────────
   Two responsibilities:

   1. CSS isolation — wraps the requested scene in `AppMockupShadowHost`
      so the parent page's typography and layout cascades don't leak
      into the mockup.

   2. Inner-scale rendering — the wrapper is sized at 100 % of its
      container, but the scene is rendered at `1 / scale` × intrinsic
      size and visually scaled back down by `scale`. Same trick the
      hero uses: every UI element (sidebar rows, tile headers, message
      text, state-inspector rows…) lands on screen at `scale` × its
      native size, giving a denser, screenshot-like read inside any
      embed footprint while keeping the scene's intrinsic layout box
      unchanged so its container queries / column widths still fire
      at the design widths.

   Optional `aspect` prop applies a CSS aspect-ratio so the embed sits
   inside its grid cell at a known shape (e.g. 16/9 inside a §3.5
   scenario card). When omitted, the embed fills its parent and the
   parent decides the height.

   Optional `frame` prop adds a rounded card around the mockup with a
   thin border + soft shadow so the embed reads as a panel rather than
   floating against the section background. The hero turns this OFF
   because the window-frame chrome is already its own visual boundary;
   the §3.5 cards turn it ON so the mockup looks "framed" inside the
   card. */

import { type Component, markRaw } from 'vue'
import AppMockupShadowHost from './AppMockupShadowHost.vue'

const props = withDefaults(
  defineProps<{
    /** The scene component to render — usually `HeroChatStateScene`
     * with different prop combos per embed. */
    scene: Component
    /** Props forwarded to the scene component inside the shadow root. */
    sceneProps?: Record<string, unknown>
    /** Visual scale factor applied to the inner scene. The scene
     * renders at `1 / scale` × the wrapper's pixel size and is
     * compressed visually by `scale`. Default `0.8` matches the
     * hero — every UI element ends up at 80 % of its native size on
     * screen, which trades a tiny readability hit for a markedly
     * denser rendering that reads like a screenshot. */
    scale?: number
    /** CSS aspect-ratio string applied to the embed — e.g. `'16/9'`
     * for §3.5 scenario cards. When omitted the embed fills its
     * parent and the parent decides the height. */
    aspect?: string
    /** Wrap the embed in a rounded card with a thin border + soft
     * shadow. Defaults to `true`. The hero turns this off because
     * its own window-frame chrome already sits inside a hero stage
     * with its own visual rhythm. */
    frame?: boolean
  }>(),
  {
    sceneProps: () => ({}),
    scale: 0.8,
    aspect: undefined,
    frame: true,
  }
)

/** Mark the scene non-reactive — Vue will warn otherwise because we
 * pass it through to the shadow-host as a prop. The scene is a
 * concrete component and never changes after the initial render. */
const sceneRaw = markRaw(props.scene)

/** `1 / scale` — the inner element renders at this percentage of the
 * wrapper's size before the visual scale is applied. */
const innerSize = `${(100 / props.scale).toFixed(4)}%`
</script>

<template>
  <div
    class="app-mockup-embed"
    :class="{ 'is-framed': frame }"
    :style="aspect ? { aspectRatio: aspect } : undefined"
  >
    <div
      class="app-mockup-embed-inner"
      :style="{
        width: innerSize,
        height: innerSize,
        transform: `scale(${scale})`,
      }"
    >
      <AppMockupShadowHost :scene="sceneRaw" :scene-props="sceneProps" />
    </div>
  </div>
</template>

<style scoped>
.app-mockup-embed {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.app-mockup-embed.is-framed {
  /* Soft rounded card so the embed reads as a framed panel rather
     than floating. The window-frame chrome inside has its own
     rounded corners (10 px radius); we use a slightly larger 12 px
     radius here so the card edges sit OUTSIDE the chrome's. */
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04);
  background: var(--vp-c-bg-soft);
}

.app-mockup-embed-inner {
  /* Width / height / transform are set inline above so the
     scale-with-larger-content trick is driven by the `scale` prop.
     `transform-origin: top left` keeps the visible top-left corner
     anchored to the wrapper's top-left so the embed doesn't drift
     when the prop changes. */
  transform-origin: top left;
}

.app-mockup-embed-inner :deep(.app-mockup-shadow-host) {
  /* The shadow host's scoped style sets `height: 100 %` of its
     parent, which is the inner size wrapper above. That gives us a
     scene rendered at `1 / scale` × the embed's pixel size. */
  width: 100%;
  height: 100%;
}
</style>
