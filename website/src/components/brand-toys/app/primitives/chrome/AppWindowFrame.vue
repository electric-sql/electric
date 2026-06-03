<script setup lang="ts">
/* AppWindowFrame — outer window shell.
   ─────────────────────────────────────────────────────────────────
   Provides the rounded rectangle, hairline border and drop shadow
   that frame any "this looks like the desktop app" mockup.

   OS-specific chrome model — matches the live `agents-desktop`
   Electron app:

     macOS    →  hiddenInset titlebar style. The OS paints the
                 traffic lights at a fixed top-left position; the
                 renderer just provides a 44-px-tall drag region
                 (the leftmost column's top spacer). NO separate
                 titlebar component — the lights are an absolute
                 overlay on this frame at top-left.

     Windows  →  Custom `DesktopTitleBar` strip across the top of
     / Linux     the window with app icon + menu sections + window
                 controls. Slotted in via the `titlebar` slot.

   Outer corner radii (visual approximations sized for marketing):
     macOS    →  10 px (Big Sur+)
     Windows  →   8 px (Mica)
     Linux    →   6 px (GNOME / Adwaita)

   Pure primitive — does NOT include a `.app-mockup-root` wrapper.
   Mount inside a scene or toy that provides the cascade. */

import AppTrafficLights from './AppTrafficLights.vue'

withDefaults(
  defineProps<{
    os?: 'macos' | 'windows' | 'linux'
    /**
     * On macOS, paint the traffic-light overlay at top-left of the
     * frame. Set to `false` for nested windows / preview shells that
     * shouldn't claim window-controls. Has no effect on Windows / Linux.
     */
    showTrafficLights?: boolean
  }>(),
  { os: 'macos', showTrafficLights: true }
)
</script>

<template>
  <div class="app-window-frame" :data-os="os">
    <!--
      Windows / Linux paint a custom titlebar strip above the
      workspace. macOS does NOT — the OS overlays the traffic lights
      via the hiddenInset style. The titlebar slot is therefore only
      consumed by Windows / Linux scenes; macOS scenes leave it empty.
    -->
    <slot name="titlebar" />

    <!--
      Traffic-light overlay for macOS. Absolutely positioned at the
      fixed Apple coordinates (≈ x:13 y:13 from the top-left corner)
      so the lights land in the same place every frame regardless of
      what content sits below. The leftmost column's 44-px header
      spacer (sidebar header on full layouts, leftmost tile's
      MainHeader when sidebar is hidden) provides the drag region the
      lights sit on.
    -->
    <div
      v-if="os === 'macos' && showTrafficLights"
      class="app-window-frame-traffic-lights"
      aria-hidden="true"
    >
      <AppTrafficLights />
    </div>

    <div class="app-window-frame-body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.app-window-frame {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--ds-bg);
  /* The outer hairline reads as the window's edge against whatever
     stage / page background sits behind it. Light mode uses a warm
     stone divider; dark mode the cool grey alpha border. */
  border: 1px solid var(--ds-divider);
  /* Drop shadow grounds the window against the page background.
     Modest in light mode, stronger in dark mode where the deeper
     contrast benefits from a softer falloff. */
  box-shadow: var(--ds-shadow-3);
  overflow: hidden;
}

.app-window-frame[data-os='macos'] {
  border-radius: 10px;
}
.app-window-frame[data-os='windows'] {
  border-radius: 8px;
}
.app-window-frame[data-os='linux'] {
  border-radius: 6px;
}

/* Traffic-lights overlay. Position matches the Apple hiddenInset
   default coordinates so the lights land where the OS would paint
   them. Z-indexed above the workspace so the lights stay on top of
   any content the leftmost column scrolls under them. */
.app-window-frame-traffic-lights {
  position: absolute;
  top: 13px;
  left: 13px;
  z-index: 10;
  /* The lights themselves are non-interactive in the mockup — there's
     nothing to close — but we keep the click target so hover states
     read correctly during animated capture. */
  pointer-events: auto;
}

.app-window-frame-body {
  flex: 1;
  min-height: 0;
  /* The body itself doesn't paint a background — the frame's bg
     shows through. Tiles inside the body provide their own surface. */
  display: flex;
  flex-direction: column;
}
</style>
