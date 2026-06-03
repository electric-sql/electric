<script setup lang="ts">
/* AppTileHeader — workspace tile header strip.
   ─────────────────────────────────────────────────────────────────
   Mirrors `packages/agents-server-ui/src/components/EntityHeader.tsx`
   + `MainHeader.module.css`:

   - 44-px tall flexrow, --ds-bg fill (no border-bottom — the chat
     surface below provides the visual separation via its own bg).
   - 10-px lateral padding (matches the macOS hiddenInset traffic-
     light gutter; see `chromeInsetTarget` for the leftmost-tile
     padding boost).
   - Left cluster (`title`):
       - Display title — `<Text size={2}>` in the live `EntityHeader` —
         `--ds-text-1` colour, default 400 weight, 12 px (`--ds-text-sm`).
       - Session id subtitle — mono, `--ds-text-3`, 12 px (`--ds-text-sm`),
         sits to the right of the title with a small 4-px gap.
       - Copy icon (lucide `Copy`) — hover-revealed in the live
         product; we paint it dimmed at rest in the mockup.
   - Right cluster (`actions`):
       - InlineStatusBadge — soft pill with a 5-px dot, tone derived
         from `status`. 11 px / 20 px tall (toolBlock override).
       - Runner badge (lucide `Server` icon) — neutral soft.
         11 px / 18 px tall / 2 px 6 px padding (live `Badge size={1}`).
       - Sandbox badge (lucide `Box` icon) — info soft when remote /
         neutral when local.
       - View-toggle icon buttons — lucide `MessageSquare` (chat) +
         `Database` (state-explorer), matching `registerViews.ts`.
         24×24 hit area (live `IconButton size={1}`) + 13-px icon.
       - Overflow `MoreHorizontal` button — 24×24 + 15-px icon.
       - Close `X` button — 24×24 + 15-px icon.

   `chromeInsetTarget` (= the `chrome-inset-target` data attribute on
   the live header) bumps the left padding past the macOS traffic
   lights when this strip is the leftmost tile and the sidebar is
   collapsed. Scenes drive this via the prop.

   Pure primitive — does NOT include a `.app-mockup-root` wrapper.
*/

import {
  Box,
  Copy,
  Database,
  MessageSquare,
  MoreHorizontal,
  Server,
  X,
} from 'lucide-vue-next'
import AppIcon from '../AppIcon.vue'

withDefaults(
  defineProps<{
    /** Display title — e.g. "Test Message Received". */
    title: string
    /** Session id subtitle — mono, e.g. "horton/70cqMB5GnW". */
    sessionId?: string
    /** Status pill text + tone driver. */
    status?:
      | 'idle'
      | 'running'
      | 'streaming'
      | 'spawning'
      | 'paused'
      | 'stopped'
    /** Runner badge label. Hide if `null`. */
    runnerLabel?: string | null
    /** Sandbox badge label. Hide if `null`. */
    sandboxLabel?: string | null
    /** Sandbox is remote? Drives the badge tone. */
    sandboxRemote?: boolean
    /** Active view (highlights the matching toggle). */
    activeView?: 'chat' | 'state'
    /** Available view toggles. Pass `[]` to hide the strip. */
    views?: ReadonlyArray<'chat' | 'state'>
    /** Show the close (X) button. The right tile in a split sets this
     * `true`; the leftmost tile keeps the menu only. */
    showClose?: boolean
    /** Bump the left padding past macOS traffic lights — set true on
     * the leftmost tile when the sidebar is collapsed. */
    chromeInsetTarget?: boolean
  }>(),
  {
    sessionId: '',
    status: 'running',
    runnerLabel: 'Electric Agents Desktop',
    sandboxLabel: 'Local',
    sandboxRemote: false,
    activeView: 'chat',
    views: () => ['chat', 'state'],
    showClose: false,
    chromeInsetTarget: false,
  }
)

const VIEW_ICONS = {
  chat: MessageSquare,
  state: Database,
} as const

const VIEW_LABELS: Record<string, string> = {
  chat: 'Chat',
  state: 'State Explorer',
}
</script>

<template>
  <header
    class="tile-header"
    :data-chrome-inset-target="chromeInsetTarget ? 'true' : undefined"
  >
    <div class="tile-header-title">
      <span class="title-name" :title="title">{{ title }}</span>
      <span v-if="sessionId" class="title-id-group">
        <span class="title-id mono" :title="sessionId">{{ sessionId }}</span>
        <span class="title-copy" aria-hidden="true">
          <AppIcon :icon="Copy" :size="1" />
        </span>
      </span>
    </div>

    <div class="tile-header-actions">
      <span class="status-badge" :data-status="status">
        <span class="status-badge-dot" />
        <span class="status-badge-label">{{ status }}</span>
      </span>

      <span v-if="runnerLabel" class="runtime-badge" :title="runnerLabel">
        <AppIcon :icon="Server" :size="1" />
        <span class="runtime-badge-label">{{ runnerLabel }}</span>
      </span>
      <span
        v-if="sandboxLabel"
        class="runtime-badge"
        :data-tone="sandboxRemote ? 'info' : 'neutral'"
        :title="sandboxLabel"
      >
        <AppIcon :icon="Box" :size="1" />
        <span class="runtime-badge-label">{{ sandboxLabel }}</span>
      </span>

      <span v-if="views.length > 1" class="view-strip">
        <span
          v-for="view in views"
          :key="view"
          class="view-btn"
          :data-active="view === activeView ? 'true' : 'false'"
          :title="VIEW_LABELS[view]"
          aria-hidden="true"
        >
          <AppIcon :icon="VIEW_ICONS[view]" :size="2" />
        </span>
      </span>

      <span class="action-btn" aria-hidden="true" title="Tile actions">
        <AppIcon :icon="MoreHorizontal" :size="3" />
      </span>
      <span
        v-if="showClose"
        class="action-btn action-btn-close"
        aria-hidden="true"
        title="Close"
      >
        <AppIcon :icon="X" :size="3" />
      </span>
    </div>
  </header>
</template>

<style scoped>
.tile-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 10px;
  background: var(--ds-bg);
  font-family: var(--ds-font-body);
}

/* When this header is the leftmost tile under a hiddenInset
   titlebar (= macOS, sidebar collapsed), bump the left padding past
   the traffic lights so the title clears them. The 78-px value
   matches the live `padding-left: 78px` (the hiddenInset variant uses
   122/196 in different fullscreen states; the marketing mockup
   targets the standard non-fullscreen case). */
.tile-header[data-chrome-inset-target='true'] {
  padding-left: 78px;
}

/* ───────── Title cluster ───────── */

.tile-header-title {
  display: inline-flex;
  align-items: baseline;
  gap: var(--ds-space-2);
  flex: 1;
  min-width: 0;
}

/* Display title — `<Text size={2}>` in the live `EntityHeader` →
   `--ds-text-sm` (12px) at the default 400 weight, no letter-spacing. */
.title-name {
  font-size: var(--ds-text-sm);
  line-height: var(--ds-text-sm-lh);
  color: var(--ds-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
  min-width: 0;
}

.title-id-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  color: var(--ds-text-3);
  flex-shrink: 1;
}

/* Session id subtitle — mono at `--ds-text-sm` (12px) per the live
   `EntityHeader.module.css` `.subtitle` rule. */
.title-id {
  font-size: var(--ds-text-sm);
  line-height: var(--ds-text-sm-lh);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.title-copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  opacity: 0.55;
  color: var(--ds-text-3);
}

/* ───────── Actions cluster ───────── */

.tile-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

/* ───────── Status pill ───────── */

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 8px;
  border-radius: var(--ds-radius-full);
  background: var(--ds-gray-a3);
  color: var(--ds-text-2);
  font-size: 11px;
  line-height: 1;
  text-transform: lowercase;
  flex-shrink: 0;
}

.status-badge-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}

.status-badge[data-status='running'],
.status-badge[data-status='streaming'] {
  background: var(--ds-blue-a3);
  color: var(--ds-blue-11, var(--ds-blue-9));
}
.status-badge[data-status='idle'] {
  background: var(--ds-green-a3);
  color: var(--ds-green-11, var(--ds-green-9));
}
.status-badge[data-status='spawning'],
.status-badge[data-status='paused'] {
  background: var(--ds-amber-a3);
  color: var(--ds-amber-11, var(--ds-amber-9));
}
.status-badge[data-status='stopped'] {
  background: var(--ds-gray-a3);
  color: var(--ds-text-3);
}

/* ───────── Runtime badges (runner + sandbox) ─────────
   Live `<Badge tone="neutral" variant="soft" size={1}>` →
   font-size 11px, line-height 1, height 18px, padding 2px 6px,
   weight 500, gap 4px (Badge default). */

.runtime-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 2px 6px;
  border-radius: var(--ds-radius-full);
  background: var(--ds-gray-a3);
  color: var(--ds-gray-11);
  font-size: var(--ds-text-xs);
  font-weight: 500;
  line-height: 1;
  /* Allow runtime badges to shrink — when the tile is narrow the
     "Electric Agents Desktop" badge must yield space so the title
     stays visible. The label inside truncates with ellipsis. */
  flex-shrink: 1;
  min-width: 28px;
  max-width: 110px;
  box-sizing: border-box;
}

.runtime-badge[data-tone='info'] {
  background: var(--ds-accent-a3);
  color: var(--ds-accent-11, var(--ds-accent-9));
}

.runtime-badge-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ───────── View-toggle icons ─────────
   Live: `<IconButton size={1}>` → 24×24, with Icon size={2} (13px). */

.view-strip {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  margin-left: 2px;
}

.view-btn {
  width: 24px;
  height: 24px;
  border-radius: var(--ds-radius-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-text-3);
  background: transparent;
}

.view-btn[data-active='true'] {
  background: var(--ds-bg-hover);
  color: var(--ds-text-1);
}

/* ───────── Action buttons (more / close) ─────────
   Live: SplitMenu trigger + close-tile button both use IconButton size={1}
   (24×24) with Icon size={3} (15px). */

.action-btn {
  width: 24px;
  height: 24px;
  border-radius: var(--ds-radius-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-text-3);
}
</style>
