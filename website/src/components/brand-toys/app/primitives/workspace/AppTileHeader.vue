<script setup lang="ts">
/* AppTileHeader — workspace tile header strip.
   ─────────────────────────────────────────────────────────────────
   Mirrors `packages/agents-server-ui/src/components/MainHeader.module.css`:

   - 44-px tall flexrow.
   - 10-px lateral padding (matches the titlebar's traffic-light
     gutter — when this is the leftmost tile and the sidebar is
     hidden, the title clears the OS controls).
   - --ds-bg fill so the header reads as part of the column body
     (no border-bottom; the chat surface below provides visual
     separation via its own background).
   - Title slot on the left, actions slot on the right.

   Pure primitive — does NOT include `.app-mockup-root`.
*/

withDefaults(
  defineProps<{
    /** Title text — usually the entity url or a session label. */
    title?: string
    /** Subtle status pip color (status-dot semantics). */
    status?: 'idle' | 'running' | 'streaming' | 'paused' | 'stopped'
    /** Add a left inset for traffic lights when the leftmost tile is
     * sat under a hiddenInset titlebar (= macOS desktop, sidebar
     * collapsed). The host scene drives this. */
    leftInset?: number
  }>(),
  {
    title: '/horton/code-refactor',
    status: 'streaming',
    leftInset: 0,
  }
)
</script>

<template>
  <header
    class="tile-header"
    :style="{ paddingLeft: leftInset > 0 ? `${leftInset}px` : undefined }"
  >
    <div class="tile-header-title">
      <span
        class="tile-header-status"
        :data-status="status"
        :aria-label="`Status: ${status}`"
      />
      <span class="tile-header-label mono">{{ title }}</span>
    </div>

    <div class="tile-header-actions">
      <span class="tile-header-action" aria-hidden="true">
        <span class="tile-header-action-glyph dots" />
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

.tile-header-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.tile-header-status {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--ds-gray-8);
}

.tile-header-status[data-status='running'],
.tile-header-status[data-status='streaming'] {
  background: var(--ds-blue-9);
}
.tile-header-status[data-status='idle'] {
  background: var(--ds-green-9);
}
.tile-header-status[data-status='paused'] {
  background: var(--ds-amber-9);
}
.tile-header-status[data-status='stopped'] {
  background: var(--ds-gray-8);
}

.tile-header-label {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--ds-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
  letter-spacing: -0.005em;
}

.tile-header-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.tile-header-action {
  width: 28px;
  height: 28px;
  border-radius: var(--ds-radius-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ds-text-3);
}

.tile-header-action-glyph.dots {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  position: relative;
}
.tile-header-action-glyph.dots::before,
.tile-header-action-glyph.dots::after {
  content: '';
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
}
.tile-header-action-glyph.dots::before {
  left: -7px;
}
.tile-header-action-glyph.dots::after {
  right: -7px;
}
</style>
