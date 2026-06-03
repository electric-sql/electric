<script setup lang="ts">
/* AppMockupShadowHost — render a brand-toys mockup inside a shadow root.
   ─────────────────────────────────────────────────────────────────
   The brand-toys mockup primitives are pixel-tuned against the live
   Electron app's design tokens. When mounted directly in a VitePress
   page they inherit:

     - VitePress's global typography (font-family, font-size,
       line-height) which the design tokens then have to fight,
     - VitePress's `* { box-sizing: border-box }` is fine, but its
       `body { line-height: 24px }` etc. cascades down,
     - The page's link colours / form resets / focus rings.

   None of which are addressed by the components' own `<style scoped>`
   rules — scoped styles isolate selectors, not cascading inheritance.
   The cleanest fix is a real DOM boundary, so we drop the entire
   mockup tree into a shadow root.

   How it works:

     1. The host element renders an empty `<div>` in the page's normal
        DOM (so SSR + layout still work).
     2. On mount, we attach an `open` shadow root to the host.
     3. We clone every `<link rel="stylesheet">` and `<style>` element
        from `document.head` into the shadow root. Vite (in dev) and
        VitePress (in prod) inject the brand-toys components' scoped
        CSS into `document.head` like any other Vue scoped style; by
        cloning those tags into the shadow root we make the same
        rules available inside, where they can match the mockup DOM.
        In prod everything is bundled into one stylesheet `<link>`
        which we clone the same way.
     4. We watch `document.head` for new style nodes (HMR in dev) and
        clone them into the shadow root as they arrive — so editing a
        scoped style in a brand-toys component still hot-reloads
        correctly.
     5. We mount a fresh `createApp()` of the slotted scene component
        into the shadow root. Using a separate app (vs. teleporting
        from the parent app) keeps the Vue scoped-style `data-v-*`
        attribute matching consistent inside the shadow boundary.

   Style inheritance — the actual goal:
   The shadow boundary blocks inherited properties (font-family,
   color, line-height, etc.) from crossing in from the host page. We
   re-establish a known baseline on the shadow's `:host` and the
   mount point itself so the mockup has a predictable starting
   typography that the design-token CSS can override per-element. */

import {
  createApp,
  h,
  markRaw,
  onBeforeUnmount,
  onMounted,
  ref,
  type Component,
} from 'vue'

/* Side-effect import: makes Vite inject the brand-toys design-token
   CSS into `document.head`. The shadow-DOM cloner below picks it up
   and re-injects into the shadow root so `var(--ds-*)` references
   inside the scene resolve. Without this, the scene renders an
   un-themed skeleton — borders are 0px, backgrounds transparent —
   because every pixel-level style reads through these tokens. */
import './shared.css'

const props = defineProps<{
  /** The scene component to mount inside the shadow root. */
  scene: Component
  /** Props forwarded to the scene component. */
  sceneProps?: Record<string, unknown>
}>()

const hostRef = ref<HTMLDivElement | null>(null)
let shadowApp: ReturnType<typeof createApp> | null = null
let styleObserver: MutationObserver | null = null

/* The shadow root needs a baseline reset. VitePress's body sets a
   `font-family` / `font-size` / `line-height` we don't want bleeding
   in via `inherit`; the shadow boundary blocks normal inheritance,
   but the mount point still needs sensible defaults so the
   design-token CSS can override per-element. */
const SHADOW_RESET = `
  :host {
    /* Take the parent's grid/flex slot but stop layout from leaking
       into the host page's reflow as the inner mockup updates. */
    display: block;
    contain: content;
    /* Reset typography that would otherwise inherit from the host
       page even with the shadow boundary in place — the boundary
       only blocks inheritance THROUGH it, not the host element's
       own computed styles which the inner mount-point sees as
       its parent. */
    font: initial;
    color: initial;
    line-height: initial;
  }

  .app-mockup-shadow-mount {
    /* Match the live Electron app's renderer baseline:
       SF / system-ui at 13 px / 1.45. The brand-toys design tokens
       override this per-element where needed. */
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
      Oxygen, Ubuntu, Cantarell, 'Helvetica Neue', Arial, sans-serif;
    font-size: 13px;
    line-height: 1.45;
    color: #fff;
    width: 100%;
    height: 100%;
    display: block;
    box-sizing: border-box;
  }

  .app-mockup-shadow-mount *,
  .app-mockup-shadow-mount *::before,
  .app-mockup-shadow-mount *::after {
    box-sizing: border-box;
  }
`

function cloneIntoShadow(node: Node, shadow: ShadowRoot): void {
  /* `cloneNode(true)` for `<link>` re-fetches the same URL — that's
     fine: the browser cache deduplicates, so the shadow root and
     the page share one network round-trip. For `<style>` we just
     copy the text content. */
  shadow.appendChild(node.cloneNode(true))
}

onMounted(() => {
  if (!hostRef.value) return

  const shadow = hostRef.value.attachShadow({ mode: 'open' })

  /* 1. Baseline reset. */
  const resetStyle = document.createElement('style')
  resetStyle.textContent = SHADOW_RESET
  shadow.appendChild(resetStyle)

  /* 2. Clone the page's stylesheets into the shadow root so the
     brand-toys components' scoped CSS rules can match elements
     mounted inside. We clone everything — VitePress's global rules
     can't match anyway because the shadow root has no `body`,
     `html`, or `.VPDoc` ancestors for them to bind to, so the
     duplication is harmless. */
  const headStyles = document.head.querySelectorAll(
    'link[rel="stylesheet"], style'
  )
  for (const el of Array.from(headStyles)) {
    cloneIntoShadow(el, shadow)
  }

  /* 3. Watch for new styles (Vite HMR in dev, dynamic imports in
     prod) and clone them into the shadow root as they arrive. */
  styleObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of Array.from(m.addedNodes)) {
        if (
          node instanceof HTMLStyleElement ||
          (node instanceof HTMLLinkElement && node.rel === 'stylesheet')
        ) {
          cloneIntoShadow(node, shadow)
        }
      }
    }
  })
  styleObserver.observe(document.head, { childList: true })

  /* 4. Mount point + fresh Vue app. `markRaw` on the scene component
     prevents Vue from making it reactive (it's already a component
     definition; making it reactive would warn). */
  const mountPoint = document.createElement('div')
  mountPoint.className = 'app-mockup-shadow-mount'
  shadow.appendChild(mountPoint)

  const Scene = markRaw(props.scene)
  shadowApp = createApp({
    render: () => h(Scene, props.sceneProps ?? {}),
  })
  shadowApp.mount(mountPoint)
})

onBeforeUnmount(() => {
  if (styleObserver) {
    styleObserver.disconnect()
    styleObserver = null
  }
  if (shadowApp) {
    shadowApp.unmount()
    shadowApp = null
  }
})
</script>

<template>
  <div ref="hostRef" class="app-mockup-shadow-host" />
</template>

<style scoped>
.app-mockup-shadow-host {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
