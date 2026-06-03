<script setup lang="ts">
/* HeroChatStateSceneToy — brand-toys wrapper.
   ─────────────────────────────────────────────────────────────────
   Renders the desktop hero scene exactly as it will appear on the
   App page §2, with controls for OS, theme, animation scrub,
   pulse rate, and the workspace split ratio so we can verify each
   axis in isolation.

   Stage size flows directly into the scene — drag the brand-toys
   stage from 1280×800 down to 320×400 to walk the breakpoint cascade
   (sidebar hidden → state tile dropped → titlebar compact). See
   APP_DESKTOP_MOCKUP_PLAN.md §6 for the responsive verification list. */

import { computed } from 'vue'
import '../shared.css'
import HeroChatStateScene from '../scenes/desktop/HeroChatStateScene.vue'

const props = withDefaults(
  defineProps<{
    os?: 'auto' | 'macos' | 'windows' | 'linux'
    theme?: 'light' | 'dark'
    /** -1 = let the internal RAF driver run; otherwise scrub to value. */
    progress?: number
    paused?: boolean
    cps?: number
    pulseRate?: number
    splitRatio?: number
    title?: string
    sessionId?: string
  }>(),
  {
    os: 'auto',
    theme: 'dark',
    progress: -1,
    paused: false,
    cps: 60,
    pulseRate: 0.8,
    splitRatio: 0.6,
    title: 'Test Message Received',
    sessionId: 'horton/70cqMB5GnW',
  }
)

const progressProp = computed(() =>
  props.progress < 0 ? null : props.progress
)
</script>

<template>
  <div class="scene-toy">
    <HeroChatStateScene
      :os="os"
      :theme="theme"
      :progress="progressProp"
      :paused="paused"
      :cps="cps"
      :pulse-rate="pulseRate"
      :split-ratio="splitRatio"
      :title="title"
      :session-id="sessionId"
    />
  </div>
</template>

<style scoped>
/* The scene root carries `width: 100%; height: 100%` and the
   container query origin — we just need a flex shell so the toy
   stage fills its frame cleanly. */
.scene-toy {
  width: 100%;
  height: 100%;
  display: flex;
  /* The brand-toys stage paints its own background; we keep the toy
     wrapper transparent so the scene's window-frame shadow can read
     against it. The scene itself draws the window-fill via
     AppWindowFrame's --ds-bg. */
  background: transparent;
}
</style>
