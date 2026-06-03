<script setup lang="ts">
/* AppWindowFrame — outer window shell.
   ─────────────────────────────────────────────────────────────────
   Provides the rounded rectangle, hairline border and drop shadow
   that frame any "this looks like the desktop app" mockup. Carries
   no chrome of its own — the titlebar comes from the
   `<AppTitlebar>` primitive (or any header you slot in), and the
   workspace below from default-slot content.

   OS-specific geometry — thin but real differences:

   - macOS:       10-px outer corner radius (matches Big Sur+).
   - Windows 11:   8-px outer corner radius (Mica window style).
   - Linux:        6-px outer corner radius (GNOME / Adwaita).

   We do NOT delegate any of this to native window-rounding — the
   mockup is HTML, not an Electron BrowserWindow. The values above
   are visual approximations sized for marketing; nobody is going to
   pixel-compare.

   The frame is `overflow: hidden` so a slotted titlebar's background
   gets clipped to the rounded corners cleanly.

   Pure primitive — does NOT include a `.app-mockup-root` wrapper.
   Mount inside a scene or toy that provides the cascade. */

withDefaults(
  defineProps<{
    os?: 'macos' | 'windows' | 'linux'
  }>(),
  { os: 'macos' }
)
</script>

<template>
  <div class="app-window-frame" :data-os="os">
    <!--
      Two slots so a scene can compose chrome (titlebar) +
      workspace independently. Most callers will pass an
      <AppTitlebar /> first, then any body content. Falling back
      to default-slot-only is fine when the caller doesn't want a
      titlebar (rare but supported).
    -->
    <slot name="titlebar" />
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

.app-window-frame-body {
  flex: 1;
  min-height: 0;
  /* The body itself doesn't paint a background — the frame's bg
     shows through. Tiles inside the body provide their own surface. */
  display: flex;
  flex-direction: column;
}
</style>
