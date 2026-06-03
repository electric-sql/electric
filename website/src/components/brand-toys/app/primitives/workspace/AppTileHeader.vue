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
       - Display title — `--ds-text-1`, weight 500, 14 px.
       - Session id subtitle — mono, `--ds-text-3`, 11 px, sits to
         the right of the title with a small gap. Concatenated
         inline (no line break) — matches the live UI.
       - Copy icon — clipboard glyph, hover-revealed in the live UI;
         we paint it dimmed at rest in the mockup.
   - Right cluster (`actions`):
       - InlineStatusBadge — soft pill with a 5-px dot, tone derived
         from `status`.
       - Runner badge — server icon + label, neutral soft.
       - Sandbox badge — box icon + label, info soft when remote /
         neutral when local.
       - View-toggle icon buttons — chat, state-explorer, etc.
       - Overflow `…` button.
       - Close `X` button.

   `chromeInsetTarget` (= the `chrome-inset-target` data attribute on
   the live header) bumps the left padding past the macOS traffic
   lights when this strip is the leftmost tile and the sidebar is
   collapsed. Scenes drive this via the prop.

   Pure primitive — does NOT include a `.app-mockup-root` wrapper.
*/

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
    activeView?: 'chat' | 'state' | 'logs' | 'fork'
    /** Available view toggles. Pass `[]` to hide the strip. */
    views?: ReadonlyArray<'chat' | 'state' | 'logs' | 'fork'>
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

const VIEW_LABELS: Record<string, string> = {
  chat: 'Chat',
  state: 'State',
  logs: 'Logs',
  fork: 'Forks',
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
          <span class="copy-glyph">
            <span class="copy-glyph-front" />
            <span class="copy-glyph-back" />
          </span>
        </span>
      </span>
    </div>

    <div class="tile-header-actions">
      <span class="status-badge" :data-status="status">
        <span class="status-badge-dot" />
        <span class="status-badge-label">{{ status }}</span>
      </span>

      <span v-if="runnerLabel" class="runtime-badge" :title="runnerLabel">
        <span class="runtime-badge-icon icon-server" aria-hidden="true" />
        <span class="runtime-badge-label">{{ runnerLabel }}</span>
      </span>
      <span
        v-if="sandboxLabel"
        class="runtime-badge"
        :data-tone="sandboxRemote ? 'info' : 'neutral'"
        :title="sandboxLabel"
      >
        <span class="runtime-badge-icon icon-box" aria-hidden="true" />
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
          <span :class="`view-glyph view-glyph-${view}`" />
        </span>
      </span>

      <span class="action-btn" aria-hidden="true" title="More">
        <span class="action-glyph action-glyph-more" />
      </span>
      <span
        v-if="showClose"
        class="action-btn"
        aria-hidden="true"
        title="Close"
      >
        <span class="action-glyph action-glyph-close" />
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
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.title-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--ds-text-1);
  letter-spacing: -0.005em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
  /* Cap the display title so the session id always gets some room
     before the right cluster takes the rest. */
  max-width: 60%;
}

.title-id-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--ds-text-3);
}

.title-id {
  font-size: 11.5px;
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
  opacity: 0.5;
}

/* Clipboard glyph — two stacked rounded rectangles with a small
   notch on top. Drawn purely in CSS so we don't drag a Lucide icon. */
.copy-glyph {
  position: relative;
  width: 10px;
  height: 10px;
  display: inline-block;
}
.copy-glyph-front,
.copy-glyph-back {
  position: absolute;
  border: 1px solid currentColor;
  border-radius: 1.5px;
}
.copy-glyph-back {
  width: 8px;
  height: 8px;
  left: 0;
  top: 2px;
}
.copy-glyph-front {
  width: 8px;
  height: 8px;
  left: 2px;
  top: 0;
  background: var(--ds-bg);
}

/* ───────── Actions cluster ───────── */

.tile-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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

/* ───────── Runtime badges (runner + sandbox) ───────── */

.runtime-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px 0 6px;
  border-radius: var(--ds-radius-full);
  background: var(--ds-gray-a3);
  color: var(--ds-text-2);
  font-size: 11.5px;
  line-height: 1;
  flex-shrink: 0;
  border: 1px solid var(--ds-divider);
  max-width: 220px;
}

.runtime-badge[data-tone='info'] {
  background: var(--ds-accent-a3);
  color: var(--ds-accent-11, var(--ds-accent-9));
  border-color: transparent;
}

.runtime-badge-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.runtime-badge-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  position: relative;
  display: inline-block;
}

/* Server glyph — three stacked rounded rectangles with a small dot. */
.icon-server {
  border: 1px solid currentColor;
  border-radius: 2px;
}
.icon-server::before,
.icon-server::after {
  content: '';
  position: absolute;
  left: 1px;
  width: 8px;
  height: 1px;
  background: currentColor;
}
.icon-server::before {
  top: 3px;
}
.icon-server::after {
  bottom: 3px;
}

/* Box glyph — open carton seen from the side. */
.icon-box {
  border: 1px solid currentColor;
  border-radius: 1px;
  transform: skewY(-12deg);
}
.icon-box::before {
  content: '';
  position: absolute;
  left: -1px;
  right: -1px;
  top: 3px;
  height: 1px;
  background: currentColor;
}

/* ───────── View-toggle icons ───────── */

.view-strip {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  margin-left: 2px;
}

.view-btn {
  width: 26px;
  height: 26px;
  border-radius: var(--ds-radius-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-text-3);
  background: transparent;
  position: relative;
}

.view-btn[data-active='true'] {
  background: var(--ds-bg-hover);
  color: var(--ds-text-1);
}

.view-glyph {
  width: 14px;
  height: 14px;
  position: relative;
  display: inline-block;
}

/* Chat glyph — speech bubble with rounded tail. */
.view-glyph-chat {
  border: 1.5px solid currentColor;
  border-radius: 3px;
}
.view-glyph-chat::after {
  content: '';
  position: absolute;
  left: 2px;
  bottom: -3px;
  width: 4px;
  height: 4px;
  background: var(--ds-bg);
  border-left: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
  transform-origin: left bottom;
}

/* State glyph — three stacked rows. */
.view-glyph-state::before,
.view-glyph-state::after,
.view-glyph-state {
  --line: 1.5px solid currentColor;
}
.view-glyph-state {
  border-top: var(--line);
  border-bottom: var(--line);
}
.view-glyph-state::before,
.view-glyph-state::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  border-top: 1.5px solid currentColor;
}

/* ───────── Action buttons (more / close) ───────── */

.action-btn {
  width: 26px;
  height: 26px;
  border-radius: var(--ds-radius-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-text-3);
  margin-left: 2px;
}

.action-glyph {
  position: relative;
  display: inline-block;
}

/* Three-dot more glyph. */
.action-glyph-more {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
}
.action-glyph-more::before,
.action-glyph-more::after {
  content: '';
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  top: 0;
}
.action-glyph-more::before {
  left: -7px;
}
.action-glyph-more::after {
  left: 7px;
}

/* Close X glyph. */
.action-glyph-close {
  width: 12px;
  height: 12px;
}
.action-glyph-close::before,
.action-glyph-close::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 11px;
  height: 1.5px;
  background: currentColor;
  border-radius: 1px;
}
.action-glyph-close::before {
  transform: rotate(45deg);
}
.action-glyph-close::after {
  transform: rotate(-45deg);
}
</style>
