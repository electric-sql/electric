<script setup lang="ts">
/* AppTitlebar — OS-aware titlebar primitive.
   ─────────────────────────────────────────────────────────────────
   Three platform variants:

   - macOS:    traffic lights on the left, optional title centred,
               28-px tall band. The native macOS app delegates the
               menu to the system menubar, so the titlebar is sparse.

   - Windows:  app icon menu button + horizontal menu strip
               (File / Edit / View / Window / Help) + flexible drag
               region + min / max / close glyph buttons on the right,
               34-px tall band. Mirrors
               packages/agents-server-ui/src/components/DesktopTitleBar.tsx
               (which is the renderer-side strip the real app paints
               on Win/Linux).

   - Linux:    same shape as Windows. Real GNOME/KDE differ slightly
               in button order, but the agents-desktop chrome ships
               the same right-aligned min/max/close pattern across
               both — so we follow that.

   Two modes:

   - `full`:    everything described above. Default; what the App page
                hero strap renders.
   - `compact`: strips the menu strip + sidebar/search chrome buttons
                + window controls, keeping only the OS identifier
                (traffic lights or app icon) and an optional title.
                Used by scenes when the container narrows past the
                breakpoint that hides full chrome.

   Pure primitive — does NOT include a `.app-mockup-root` wrapper.
   Mount inside a scene or toy that provides the cascade. */

import AppTrafficLights from './AppTrafficLights.vue'

withDefaults(
  defineProps<{
    /** Resolved platform — `auto` is resolved upstream by the toy/scene. */
    os?: 'macos' | 'windows' | 'linux'
    /** Layout density. */
    mode?: 'full' | 'compact'
    /** Optional centred title. macOS shows it in the band centre,
     * Windows/Linux at the start of the drag region. */
    title?: string
  }>(),
  { os: 'macos', mode: 'full', title: '' }
)

const MENU_SECTIONS = ['File', 'Edit', 'View', 'Window', 'Help'] as const
</script>

<template>
  <!--
    Single root that varies its layout via data-os / data-mode. Scenes
    can also reach in via :deep(.app-titlebar [data-tb-buttons]) to
    flip individual sections at narrow container widths (this is the
    contract documented in §4.6 of the plan).
  -->
  <div class="app-titlebar" :data-os="os" :data-mode="mode">
    <!-- macOS: traffic lights left, optional centred title. -->
    <template v-if="os === 'macos'">
      <span class="tb-leading"><AppTrafficLights /></span>
      <span class="tb-title-center" v-if="title">{{ title }}</span>
      <span class="tb-trailing" />
    </template>

    <!-- Windows / Linux: app icon, menu strip, drag region, min/max/close. -->
    <template v-else>
      <button class="tb-app-menu" type="button" aria-label="Application menu">
        <!--
          Inlined Electric icon-mark, matching
          packages/agents-desktop/assets/icon-mark.svg. Drawn as
          currentColor so the glyph follows --ds-text-1 (light) or
          --ds-accent-9 (dark) via the `.tb-app-icon` colour rule below.
        -->
        <svg
          class="tb-app-icon"
          viewBox="199 198 580 628"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M533.63 203.148c2.797-2.805 6.58-4.373 10.506-4.373h234.645L444.163 533.775c-2.797 2.809-6.58 4.373-10.506 4.373H199.012L533.63 203.148Z"
            fill="currentColor"
          />
          <path
            d="M492.491 545.588c0-4.12 3.343-7.474 7.452-7.474h278.838l-286.29 287.115V545.588Z"
            fill="currentColor"
          />
        </svg>
      </button>

      <nav
        v-if="mode === 'full'"
        class="tb-menu"
        aria-label="Application"
        data-tb-menu
      >
        <button
          v-for="section in MENU_SECTIONS"
          :key="section"
          type="button"
          class="tb-menu-item"
        >
          {{ section }}
        </button>
      </nav>

      <span v-if="title && mode === 'full'" class="tb-title-inline">
        {{ title }}
      </span>

      <span class="tb-drag-region" />

      <div
        v-if="mode === 'full'"
        class="tb-window-controls"
        aria-hidden="true"
        data-tb-buttons
      >
        <span class="tb-wc tb-wc-min" />
        <span class="tb-wc tb-wc-max" />
        <span class="tb-wc tb-wc-close" />
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ───────── Shared shell ───────── */

.app-titlebar {
  display: flex;
  align-items: center;
  width: 100%;
  background: var(--ds-chrome-bg);
  color: var(--ds-text-1);
  font-family: var(--ds-font-body);
  font-size: 12px;
  line-height: 1;
  user-select: none;
  -webkit-user-select: none;
  flex-shrink: 0;
}

/* ───────── macOS variant ───────── */

.app-titlebar[data-os='macos'] {
  height: 28px;
  /* Traffic lights sit ~13px from the window's left edge. The frame
     contributes the rounded corner; here we just pad the inside. */
  padding: 0 13px;
  position: relative;
}

.app-titlebar[data-os='macos'] .tb-leading {
  display: inline-flex;
  align-items: center;
}

.app-titlebar[data-os='macos'] .tb-title-center {
  position: absolute;
  inset: 0;
  margin: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 500;
  color: var(--ds-text-2);
  pointer-events: none;
  /* Truncate gracefully if the window is narrower than the title. */
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-titlebar[data-os='macos'] .tb-trailing {
  flex: 1;
}

/* macOS compact mode: identical to full at this scale. The traffic
   lights are the only OS marker the eye needs — no title, no extras. */
.app-titlebar[data-os='macos'][data-mode='compact'] .tb-title-center {
  display: none;
}

/* ───────── Windows / Linux shared ───────── */

.app-titlebar[data-os='windows'],
.app-titlebar[data-os='linux'] {
  height: 34px;
}

.tb-app-menu {
  all: unset;
  width: 24px;
  height: 24px;
  margin-left: 8px;
  margin-right: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: var(--ds-radius-2);
  cursor: default;
}

.tb-app-menu:hover {
  background: var(--ds-bg-hover);
}

.tb-app-icon {
  width: 14px;
  height: 14px;
  /* Light mode: ink-coloured. Dark mode: accent teal (matches the
     real desktop app's behaviour where the icon flips to brand
     teal in dark mode). */
  color: var(--ds-text-1);
}

/* In dark mode the icon flips to accent teal, matching the live
   product (DesktopTitleBar.module.css `:global(html[data-theme='dark'])
   .appIcon { background: var(--ds-accent-9); }`).

   This selector works because the surrounding `.app-mockup-root`
   carries `data-theme="dark"` whenever the scene/toy is in dark
   mode; we read up the cascade rather than expecting a closer
   ancestor. */
:global(.app-mockup-root[data-theme='dark']) .tb-app-icon {
  color: var(--ds-accent-9);
}

.tb-menu {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 100%;
  flex-shrink: 0;
}

.tb-menu-item {
  all: unset;
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 8px;
  border-radius: var(--ds-radius-2);
  cursor: default;
  color: var(--ds-text-2);
  font-size: 12px;
  /* Cursor convention: the FIRST menu item reads as the "active" one
     (open) — light hover bg, primary text colour. Mirrors real
     dropdown-menu hover state to add a touch of life to a still
     screenshot. */
}
.tb-menu-item:hover {
  background: var(--ds-bg-hover);
  color: var(--ds-text-1);
}

.tb-title-inline {
  margin-left: 12px;
  color: var(--ds-text-2);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}

.tb-drag-region {
  flex: 1;
  min-width: 24px;
  height: 100%;
}

/* ───────── Window controls (Windows/Linux right side) ───────── */

.tb-window-controls {
  display: inline-flex;
  align-items: stretch;
  height: 100%;
  flex-shrink: 0;
  margin-left: auto;
}

.tb-wc {
  width: 46px;
  height: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-text-2);
  position: relative;
}

.tb-wc:hover {
  background: var(--ds-bg-hover);
}

/* Glyphs drawn with currentColor pseudo-elements — same idea as
   DesktopTitleBar.module.css. */
.tb-wc-min::before {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 10px;
  height: 1px;
  background: currentColor;
}

.tb-wc-max::before {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 9px;
  height: 9px;
  border: 1px solid currentColor;
  box-sizing: border-box;
}

.tb-wc-close::before,
.tb-wc-close::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 11px;
  height: 1px;
  background: currentColor;
}
.tb-wc-close::before {
  transform: rotate(45deg);
}
.tb-wc-close::after {
  transform: rotate(-45deg);
}

/* Windows-style red close hover. */
.tb-wc-close:hover {
  background: #c42b1c;
  color: #ffffff;
}

/* Linux variant: same controls, slightly less aggressive close-button
   hover (matches GNOME/Adwaita where the close hover is tinted, not
   solid red). Tiny tweak — preserves the family resemblance to the
   Windows variant while reading "this isn't Windows". */
.app-titlebar[data-os='linux'] .tb-wc-close:hover {
  background: var(--ds-red-a5);
  color: var(--ds-text-1);
}
</style>
