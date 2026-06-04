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
     3. We clone every stylesheet-bearing `<link>` and `<style>`
        element from `document.head` into the shadow root. Vite (in
        dev) and VitePress (in prod) inject the brand-toys components'
        scoped CSS into the page like any other Vue scoped style; by
        cloning those tags into the shadow root we make the same rules
        available inside, where they can match the mockup DOM. In prod
        VitePress emits links as `rel="preload stylesheet"`, so the
        clone logic checks `relList.contains('stylesheet')` rather
        than exact string equality.
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

/* The shadow root needs a baseline reset. The shadow boundary blocks
   STYLE RULES from the host page, but it does NOT block CSS
   inheritance — the host element gets its computed styles from the
   page (e.g. `text-align: center` from `.ad-hero`), and the shadow
   content inherits those through the host. So we need to explicitly
   neutralise every inheritable text/typography property on `:host`
   and re-establish a known baseline on the mount point. */
const SHADOW_RESET = `
  :host {
    /* Take the parent's grid/flex slot but stop layout from leaking
       into the host page's reflow as the inner mockup updates. */
    display: block;
    contain: content;
    /* Block every inheritable text/typography property from the
       host page. \`text-align\` is the one that bit us first
       (\`.ad-hero { text-align: center }\` inherits straight through
       the shadow boundary into every text node), but the same risk
       applies to the rest — neutralise the lot in one place so
       future host-page rules can't surprise us. */
    text-align: initial;
    text-indent: initial;
    text-transform: initial;
    text-decoration: initial;
    direction: initial;
    letter-spacing: initial;
    word-spacing: initial;
    white-space: initial;
    word-break: initial;
    overflow-wrap: initial;
    font: initial;
    color: initial;
    line-height: initial;
    cursor: initial;
  }

  .app-mockup-shadow-mount {
    /* Re-establish a known baseline that matches the live Electron
       app's renderer: SF / system-ui at 13 px / 1.45, left-aligned.
       Brand-toys design tokens override per-element from here. */
    text-align: left;
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
  /* VitePress prod emits stylesheet links as
     `<link rel="preload stylesheet" as="style">`. That works in the
     page head, but cloning the exact rel into a shadow root is less
     predictable and, more importantly, our old selector missed it
     entirely. Normalize cloned stylesheet links to plain
     `rel="stylesheet"` so the shadow root definitely applies them.
     The browser cache still deduplicates the request. */
  if (
    node instanceof HTMLLinkElement &&
    node.relList.contains('stylesheet') &&
    node.href
  ) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = node.href
    if (node.crossOrigin) link.crossOrigin = node.crossOrigin
    if (node.media) link.media = node.media
    shadow.appendChild(link)
    return
  }

  /* For `<style>` we copy the text content verbatim. */
  shadow.appendChild(node.cloneNode(true))
}

function isStyleNode(node: Node): node is HTMLStyleElement | HTMLLinkElement {
  return (
    node instanceof HTMLStyleElement ||
    (node instanceof HTMLLinkElement && node.relList.contains('stylesheet'))
  )
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
    'link[rel~="stylesheet"], style'
  )
  for (const el of Array.from(headStyles)) {
    cloneIntoShadow(el, shadow)
  }

  /* 3. Watch for new styles (Vite HMR in dev, dynamic imports in
     prod) and clone them into the shadow root as they arrive. */
  styleObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of Array.from(m.addedNodes)) {
        if (isStyleNode(node)) {
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
