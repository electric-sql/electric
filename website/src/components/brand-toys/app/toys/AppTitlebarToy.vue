<script setup lang="ts">
/* AppTitlebarToy — brand-toys wrapper.
   ─────────────────────────────────────────────────────────────────
   Wraps `<AppTitlebar>` in the `.app-mockup-root` token cascade and
   resolves the `os: 'auto'` value via `useDetectedOs()` so the
   visitor previews their own platform's chrome by default. The
   explicit `macos | windows | linux` values force a fixed variant
   for screenshotting / per-OS review.

   See APP_DESKTOP_MOCKUP_PLAN.md §4.5 (OS detection) and §6 (toy
   schema) for the contract. */

import { computed } from 'vue'
import '../shared.css'
import AppTitlebar from '../primitives/chrome/AppTitlebar.vue'
import { useDetectedOs } from '../../../app-download/useDetectedOs'

const props = withDefaults(
  defineProps<{
    os?: 'auto' | 'macos' | 'windows' | 'linux'
    mode?: 'full' | 'compact'
    theme?: 'light' | 'dark'
    title?: string
  }>(),
  { os: 'auto', mode: 'full', theme: 'dark', title: '' }
)

const { os: detectedOs } = useDetectedOs()

const resolvedOs = computed<'macos' | 'windows' | 'linux'>(() => {
  return props.os === 'auto' ? detectedOs.value : props.os
})
</script>

<template>
  <div class="tb-toy app-mockup-root" :data-theme="theme">
    <!--
      The toy stage paints a thin "stage strap" so the titlebar
      reads as one band against a wider canvas. The titlebar fills
      the strap horizontally; the strap's background is the page
      bg behind the chrome.
    -->
    <div class="tb-toy-strap">
      <AppTitlebar :os="resolvedOs" :mode="mode" :title="title" />
    </div>
  </div>
</template>

<style scoped>
.tb-toy {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.tb-toy-strap {
  width: 100%;
  max-width: 960px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--ds-divider);
  /* The body below the titlebar is empty so we can read the bar in
     isolation; a tall strap makes the bar feel anchored without
     pulling focus. */
  box-shadow: var(--ds-shadow-2);
}

/* Add a small workspace strip below the bar so the eye reads the
   titlebar AS a titlebar, not a free-floating chip. */
.tb-toy-strap::after {
  content: '';
  display: block;
  height: 80px;
  background: var(--ds-bg);
}
</style>
