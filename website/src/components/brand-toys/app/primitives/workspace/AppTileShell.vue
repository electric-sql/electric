<script setup lang="ts">
/* AppTileShell — workspace tile chrome.
   ─────────────────────────────────────────────────────────────────
   Mirrors `packages/agents-server-ui/src/components/workspace/TileContainer.module.css`:

   - .tile: column flex, fills its parent column, --ds-bg fill,
     overflow hidden. The shared chat-column geometry (`--chat-col-width`,
     `--chat-surface-width`) is set on the body so descendants inherit
     the same column width regardless of where the tile sits.
   - .body: column flex, flex:1, min:0 — the content slot is the only
     thing that scrolls; the chrome stays put.

   The shell renders a `<header>` slot for `<AppTileHeader>` (or any
   custom header) and a `<default>` slot for the body content. Scenes
   compose `<AppTileShell><AppTileHeader … /><ChatTileContent /></AppTileShell>`.

   Pure primitive — does NOT include `.app-mockup-root`. */
</script>

<template>
  <section class="tile">
    <slot name="header" />
    <div class="tile-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.tile {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--ds-bg);
  position: relative;
  font-family: var(--ds-font-body);
}

.tile-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  /* Shared chat-column geometry — kept in sync with the live product
     so chat tiles render the same regardless of where they sit in the
     workspace. */
  --chat-col-width: 80ch;
  --chat-surface-width: calc(var(--chat-col-width) + 24px);
}
</style>
