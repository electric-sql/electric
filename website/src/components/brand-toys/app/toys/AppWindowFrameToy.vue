<script setup lang="ts">
/* AppWindowFrameToy — brand-toys wrapper.
   ─────────────────────────────────────────────────────────────────
   Wraps `<AppWindowFrame>` in the `.app-mockup-root` cascade and
   slots in an `<AppTitlebar>` so the chrome reads as a believable
   empty desktop window. The body below the titlebar is left blank
   except for a faint workspace placeholder — enough that the eye
   can compare frame geometry against a real screenshot of the app.

   The `os: 'auto'` resolution lives here (same composable as the
   App page download CTA) so a Mac visitor sees Mac chrome, a
   Windows visitor sees Windows chrome, etc.

   See APP_DESKTOP_MOCKUP_PLAN.md §4.5 / §6 / phase 2 §8 for the
   contract this fulfils. */

import { computed } from 'vue'
import '../shared.css'
import AppWindowFrame from '../primitives/chrome/AppWindowFrame.vue'
import AppTitlebar from '../primitives/chrome/AppTitlebar.vue'
import { useDetectedOs } from '../../../app-download/useDetectedOs'

const props = withDefaults(
  defineProps<{
    os?: 'auto' | 'macos' | 'windows' | 'linux'
    theme?: 'light' | 'dark'
  }>(),
  { os: 'auto', theme: 'dark' }
)

const { os: detectedOs } = useDetectedOs()

const resolvedOs = computed<'macos' | 'windows' | 'linux'>(() => {
  return props.os === 'auto' ? detectedOs.value : props.os
})
</script>

<template>
  <div class="frame-toy app-mockup-root" :data-theme="theme">
    <AppWindowFrame :os="resolvedOs">
      <template #titlebar>
        <AppTitlebar :os="resolvedOs" />
      </template>
      <!--
        Empty workspace placeholder. Faint divider hints at where
        the sidebar / tile split would live; helps verify the
        rounded-corner clipping and the titlebar-against-body
        transition.
      -->
      <div class="frame-toy-body">
        <div class="frame-toy-sidebar-hint" />
        <div class="frame-toy-workspace-hint" />
      </div>
    </AppWindowFrame>
  </div>
</template>

<style scoped>
.frame-toy {
  width: 100%;
  height: 100%;
  display: flex;
  /* Pad the toy stage so the frame's drop shadow and rounded corners
     read clearly against the brand-toys background. The brand-toys
     stage adds its own padding too; this is the primitive's
     "interior" margin. */
  padding: 16px;
  box-sizing: border-box;
}

.frame-toy-body {
  flex: 1;
  display: flex;
  height: 100%;
}

.frame-toy-sidebar-hint {
  width: 240px;
  background: var(--ds-bg-subtle);
  border-right: 1px solid var(--ds-divider);
}

.frame-toy-workspace-hint {
  flex: 1;
  background: var(--ds-bg);
}
</style>
