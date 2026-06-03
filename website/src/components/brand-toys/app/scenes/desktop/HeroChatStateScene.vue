<script setup lang="ts">
/* HeroChatStateScene — desktop hero composition.
   ─────────────────────────────────────────────────────────────────
   The "live, durable, agentic" desktop story. Composes every chrome
   + content primitive into a single shippable scene that drops into
   `AppDownloadPage.vue` §2 in phase 8.

   Chrome architecture (post-review correction — see §0 of
   APP_DESKTOP_MOCKUP_PLAN.md):

     macOS    →  No separate titlebar component. AppWindowFrame
                 paints the traffic-lights overlay at top-left. The
                 sidebar's 44-px header band IS the drag region the
                 lights sit on. When the sidebar is hidden by a
                 container-query breakpoint, the leftmost tile's
                 header gets `chromeInsetTarget` so its title clears
                 the lights (78-px left padding bump).

     Windows  →  AppTitlebar mounted in the frame's `titlebar` slot.
     / Linux     A 32-px DesktopTitleBar strip with app icon + menu
                 sections + window controls.

   Layout (full size):

     ┌─[ AppWindowFrame ]──────────────────────────────────────────┐
     │ [● ●  ●]                                                     │  ← traffic lights overlay (macOS)
     │           ─                                                  │  ← OR custom DesktopTitleBar (Win/Linux)
     ├──────────────┬───────────────────────────────────────────────┤
     │              │                                               │
     │  AppSidebar  │ ChatTileContent (left) │ StateTileContent     │
     │              │                        │   (right)            │
     │  …footer…    │                        │                      │
     └──────────────┴────────────────────────┴──────────────────────┘

   Responsive breakpoints (driven by @container queries on the scene
   root — independent of the page's media queries so the scene works
   inside any column width):

     ≥ 1100 px → full layout (sidebar + tile pair, default split)
     ≥  860 px → sidebar hidden; leftmost tile claims chromeInsetTarget
     ≥  640 px → state tile dropped; chat fills workspace
     <  640 px → workspace only; chrome stripped to the bare minimum

   Animation pass-through:
   - `progress`, `paused`, `cps` → ChatTileContent → AppAgentResponse
   - `pulseRate` → StateTileContent → AppStateInspector

   Pure scene — DOES include `.app-mockup-root` so it can be dropped
   into the page directly. */

import { computed } from 'vue'
import AppSidebar from '../../primitives/sidebar/AppSidebar.vue'
import AppTitlebar from '../../primitives/chrome/AppTitlebar.vue'
import AppTitlebarControls from '../../primitives/chrome/AppTitlebarControls.vue'
import AppWindowFrame from '../../primitives/chrome/AppWindowFrame.vue'
import ChatTileContent from '../../primitives/workspace/parts/ChatTileContent.vue'
import StateTileContent from '../../primitives/workspace/parts/StateTileContent.vue'
import {
  type DetectedOs,
  useDetectedOs,
} from '../../../../app-download/useDetectedOs'

type SceneOs = 'auto' | DetectedOs
type SceneTheme = 'light' | 'dark'

const props = withDefaults(
  defineProps<{
    /**
     * `'auto'` resolves to the visitor's actual OS via UA sniffing
     * (defaults to macOS on the server). Concrete values force the
     * scene to a specific platform — useful for screenshot capture.
     */
    os?: SceneOs
    theme?: SceneTheme
    /** Manual scrub for the typewriter — `null` = RAF-driven loop. */
    progress?: number | null
    paused?: boolean
    cps?: number
    pulseRate?: number
    /** Display title text shown in the chat tile header. */
    title?: string
    /** Session id subtitle (mono) — e.g. "horton/70cqMB5GnW". */
    sessionId?: string
    /**
     * Chat-tile flex ratio inside the workspace split (0..1). Default
     * 0.5 = 50/50 split — matches the live product's default splitter
     * position when both tiles are open. Scenes consumed by
     * AppDownloadPage.vue keep this fixed; toy exposes it for review.
     */
    splitRatio?: number
  }>(),
  {
    os: 'auto',
    theme: 'dark',
    progress: null,
    paused: false,
    cps: 60,
    pulseRate: 0.8,
    title: 'Test Message Received',
    sessionId: 'horton/70cqMB5GnW',
    splitRatio: 0.5,
  }
)

const { os: detectedOs } = useDetectedOs()

const resolvedOs = computed<DetectedOs>(() =>
  props.os === 'auto' ? detectedOs.value : props.os
)

/** Windows / Linux paint a real custom titlebar; macOS does NOT —
 * the OS overlays the traffic lights via hiddenInset. */
const showCustomTitlebar = computed(() => resolvedOs.value !== 'macos')
</script>

<template>
  <div
    class="hero-scene app-mockup-root"
    :data-os="resolvedOs"
    :data-theme="theme"
    :style="{ '--split-ratio': splitRatio }"
  >
    <AppWindowFrame :os="resolvedOs">
      <template v-if="showCustomTitlebar" #titlebar>
        <AppTitlebar :os="resolvedOs" :title="title" mode="full" />
      </template>

      <div class="hero-scene-body">
        <div class="hero-scene-sidebar">
          <div v-if="resolvedOs === 'macos'" class="sidebar-titlebar-row">
            <AppTitlebarControls
              :collapsed="false"
              :chrome-inset-target="true"
            />
          </div>
          <AppSidebar
            :no-header="resolvedOs === 'macos'"
            section-label="Today"
            :show-footer="true"
          />
        </div>

        <div class="hero-scene-workspace">
          <div class="hero-scene-tile hero-scene-tile-chat">
            <ChatTileContent
              :title="title"
              :session-id="sessionId"
              :progress="progress"
              :paused="paused"
              :cps="cps"
              density="comfortable"
              :show-close="true"
            />
          </div>
          <div class="hero-scene-tile hero-scene-tile-state">
            <StateTileContent
              :title="title"
              :session-id="sessionId"
              :pulse-rate="pulseRate"
              :paused="paused"
              density="comfortable"
              :show-close="true"
            />
          </div>
        </div>
      </div>
    </AppWindowFrame>
  </div>
</template>

<style scoped>
/* The scene root is the @container query origin. Container queries
   drive layout reflow based on the scene's own width — independent of
   the page's media queries so the scene works in any column width. */
.hero-scene {
  width: 100%;
  height: 100%;
  display: flex;
  background: transparent;
  font-family: var(--ds-font-body);
  container-type: inline-size;
  container-name: hero-scene;
}

.hero-scene-body {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

/* Sidebar column — fixed 240 px (matches SIDEBAR_DEFAULT_WIDTH in the
   live product). The sidebar primitive itself doesn't carry a width;
   the column wrapper sets it. */
.hero-scene-sidebar {
  flex: 0 0 240px;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* On macOS the sidebar gets a 44-px titlebar-controls row at top
   that holds the sidebar-toggle, search, and history buttons (matches
   the live `TitlebarControls` overlay). The traffic lights sit over
   the leftmost 84-px of this row via the AppWindowFrame overlay. */
.sidebar-titlebar-row {
  flex-shrink: 0;
  height: 44px;
  display: flex;
  align-items: center;
  background: var(--ds-chrome-bg);
  border-bottom: 1px solid transparent;
}

.hero-scene-workspace {
  flex: 1;
  min-width: 0;
  display: flex;
  /* The workspace splits horizontally between the chat tile and the
     state tile. `--split-ratio` (default 0.6) drives the chat tile's
     share via flex-grow on the chat tile and (1 - split) on the state
     tile. We keep both at flex-basis: 0 so the ratios apply directly. */
  background: var(--ds-bg);
}

.hero-scene-tile {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  /* Hairline divider between the two tiles — same style the live
     product uses on workspace splits. */
  border-left: 1px solid var(--ds-divider);
}

.hero-scene-tile:first-child {
  border-left: none;
}

.hero-scene-tile-chat {
  flex: var(--split-ratio) 0 0;
}

.hero-scene-tile-state {
  flex: calc(1 - var(--split-ratio)) 0 0;
}

/* ───────── Container-query breakpoints ─────────

   We intentionally use `@container` over `@media` so the scene
   reflows based on its OWN width inside the surrounding page column,
   not the viewport. A small embed (e.g. inside a 600-px column) gets
   the compact layout even on a 1920-px screen.

   Breakpoints map (= the §6 plan widths shifted in slightly to
   account for scene padding inside the page column):

     < 1100 px → sidebar hidden; chat tile becomes the leftmost
                 column and (on macOS) needs to clear the traffic
                 lights — chromeInsetTarget pushes its title 78 px
                 right past them.
     <  860 px → state tile dropped; chat fills workspace.
     <  640 px → chat fills workspace, no further drops.
*/

@container hero-scene (max-width: 1099px) {
  .hero-scene-sidebar {
    display: none;
  }
  /* The chat tile is now the leftmost column under the macOS traffic
     lights — hint its tile header to bump its left padding so the
     title clears them. */
  .hero-scene-tile-chat :deep(.tile-header) {
    padding-left: 78px;
  }
}

/* On Windows / Linux the custom titlebar already sits across the top
   so the leftmost tile doesn't need the inset bump. Override the
   above when the scene's OS is non-macOS. */
.hero-scene[data-os='windows'] .hero-scene-tile-chat :deep(.tile-header),
.hero-scene[data-os='linux'] .hero-scene-tile-chat :deep(.tile-header) {
  padding-left: 10px;
}

@container hero-scene (max-width: 859px) {
  .hero-scene-tile-state {
    display: none;
  }
  .hero-scene-tile-chat {
    flex: 1 0 0;
  }
  /* Single-tile mode — hide the chat tile's close X. With no other
     tile in the workspace there's nothing to close back to, matching
     the live UI's full-width chat layout. */
  .hero-scene-tile-chat :deep(.action-btn-close) {
    display: none;
  }
}

@container hero-scene (max-width: 639px) {
  /* When the chat tile is the only thing left in the workspace, drop
     the chat-surface column-cap entirely so the bubble + composer
     fill the available width — matches the live product's mobile
     layout where there's no concept of a chat-surface gutter. */
  .hero-scene-tile-chat :deep(.chat-column),
  .hero-scene-tile-chat :deep(.composer-inner) {
    width: 100%;
    max-width: 100%;
  }
}
</style>
