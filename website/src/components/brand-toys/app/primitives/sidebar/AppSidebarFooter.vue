<script setup lang="ts">
/* AppSidebarFooter — bottom-anchored row in the sidebar.
   ─────────────────────────────────────────────────────────────────
   Mirrors `packages/agents-server-ui/src/components/SidebarFooter.tsx`
   + `SidebarFooter.module.css`:

     [● localhost:4437       ⌄]   [filter]   [settings]

   Components in the live product:
     - ServerPicker      — green status pip + server URL + chevron
     - SidebarViewMenu   — filter / grouping icon
     - SettingsMenu      — settings cog (theme + Settings… launcher)

   The strip has an 8-px padding all around with a top hairline
   divider to separate it from the session list above.

   Pure primitive — does NOT include `.app-mockup-root`. */

withDefaults(
  defineProps<{
    /** Server URL displayed in the picker. */
    serverUrl?: string
    /** Status of the server connection — drives the dot colour. */
    serverStatus?: 'connected' | 'reconnecting' | 'disconnected'
  }>(),
  {
    serverUrl: 'localhost:4437',
    serverStatus: 'connected',
  }
)
</script>

<template>
  <div class="sidebar-footer">
    <div class="server-picker">
      <span class="server-picker-dot" :data-status="serverStatus" />
      <span class="server-picker-label mono">{{ serverUrl }}</span>
      <span class="server-picker-chevron" aria-hidden="true" />
    </div>
    <span class="footer-icon-btn" aria-hidden="true" title="View options">
      <span class="footer-icon footer-icon-filter" />
    </span>
    <span class="footer-icon-btn" aria-hidden="true" title="Settings">
      <span class="footer-icon footer-icon-settings" />
    </span>
  </div>
</template>

<style scoped>
.sidebar-footer {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px;
  border-top: 1px solid var(--ds-divider);
  flex-shrink: 0;
  font-family: var(--ds-font-body);
}

/* ───────── Server picker ───────── */

.server-picker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  /* 3-px row inset + 22-px icon slot to match the SidebarRow
     concentric halo geometry above. */
  padding: 3px;
  border-radius: var(--ds-radius-item);
  color: var(--ds-text-2);
}

.server-picker-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  /* The icon-slot the dot sits in is 22-px wide on SidebarRow; we
     keep the dot itself smaller and let the gap shape the column. */
  margin-left: 4px;
  background: var(--ds-gray-8);
}
.server-picker-dot[data-status='connected'] {
  background: var(--ds-green-9);
  box-shadow: 0 0 0 2px var(--ds-green-a3);
}
.server-picker-dot[data-status='reconnecting'] {
  background: var(--ds-amber-9);
}
.server-picker-dot[data-status='disconnected'] {
  background: var(--ds-red-9);
}

.server-picker-label {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--ds-text-1);
}

.server-picker-chevron {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-right: 1.4px solid var(--ds-text-3);
  border-bottom: 1.4px solid var(--ds-text-3);
  transform: rotate(45deg) translate(-1px, -1px);
}

/* ───────── Footer icon buttons ───────── */

.footer-icon-btn {
  width: 26px;
  height: 26px;
  border-radius: var(--ds-radius-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-text-3);
  flex-shrink: 0;
}

.footer-icon {
  position: relative;
  display: inline-block;
  width: 14px;
  height: 14px;
}

/* Filter / sliders glyph — three horizontal rules with offset
   knobs. */
.footer-icon-filter::before,
.footer-icon-filter::after,
.footer-icon-filter {
  --bar: 1.4px solid currentColor;
}
.footer-icon-filter::before,
.footer-icon-filter::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 1.4px;
  background: currentColor;
}
.footer-icon-filter::before {
  top: 3px;
}
.footer-icon-filter::after {
  bottom: 3px;
}
.footer-icon-filter {
  border-top: var(--bar);
}

/* Settings cog glyph — drawn with a circular border + radial spokes.
   Approximation; the real lucide cog has 8 spokes. */
.footer-icon-settings {
  border: 1.4px solid currentColor;
  border-radius: 50%;
}
.footer-icon-settings::before,
.footer-icon-settings::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  background: currentColor;
}
.footer-icon-settings::before {
  width: 12px;
  height: 1.4px;
}
.footer-icon-settings::after {
  width: 1.4px;
  height: 12px;
}
</style>
