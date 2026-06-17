<script setup lang="ts">
/* AppSidebarToy — brand-toys wrapper.
   ─────────────────────────────────────────────────────────────────
   Renders the full `<AppSidebar>` primitive at a sidebar-shaped
   width (240 px default, matches `SIDEBAR_DEFAULT_WIDTH = 240` in
   the live product). The toy stage centres the column and pads
   laterally so the eye reads it as a clean cut-out of the sidebar
   inside a wider window.

   The `noHeader` toggle exposes both shapes:
     - `false` → 44 px header spacer included (sidebar mounted in a
                 frame WITHOUT a top titlebar; the header is the
                 traffic-light overlap zone the live macOS app uses).
     - `true`  → no spacer (sidebar mounted in a frame WITH a top
                 titlebar; the titlebar already provides the y-offset
                 — this is the `HeroChatStateScene` shape).

   See APP_DESKTOP_MOCKUP_PLAN.md §6 for the controls schema. */

import '../shared.css'
import AppSidebar from '../primitives/sidebar/AppSidebar.vue'

withDefaults(
  defineProps<{
    /**
     * Sidebar column width. The default 240 mirrors
     * SIDEBAR_DEFAULT_WIDTH in `agents-server-ui`.
     */
    width?: number
    /** Suppress the 44-px header spacer (see file comment above). */
    noHeader?: boolean
    sectionLabel?: string
    showFooter?: boolean
    serverUrl?: string
    theme?: 'light' | 'dark'
  }>(),
  {
    width: 240,
    noHeader: false,
    sectionLabel: 'Today',
    showFooter: true,
    serverUrl: 'localhost:4437',
    theme: 'dark',
  }
)
</script>

<template>
  <div class="sb-toy app-mockup-root" :data-theme="theme">
    <div class="sb-toy-stage" :style="{ width: `${width}px` }">
      <AppSidebar
        :no-header="noHeader"
        :section-label="sectionLabel"
        :show-footer="showFooter"
        :server-url="serverUrl"
      />
    </div>
  </div>
</template>

<style scoped>
.sb-toy {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  /* Pad top + bottom so the brand-toys stage's frame border doesn't
     visually clash with the sidebar's own divider edges. */
  padding: 24px 0;
  /* The brand-toys stage uses --ds-bg as the toy bg via the `dark`
     stage preset; the sidebar's own --ds-chrome-bg already differs
     enough to read against it. */
}

.sb-toy-stage {
  height: 100%;
  /* Outer rim hints at where the rest of the window would sit —
     the sidebar's right-edge divider already paints a hairline; we
     just need top/bottom hairlines for the column to feel framed. */
  border-top: 1px solid var(--ds-divider);
  border-bottom: 1px solid var(--ds-divider);
  /* Top-left corner rounding so the column looks like the real
     macOS sidebar shape (10-px outer radius from the window frame
     — we approximate at 6 px since this toy doesn't render the
     full frame). */
  border-top-left-radius: 6px;
  border-bottom-left-radius: 6px;
  overflow: hidden;
}
</style>
