<template>
  <div v-if="isMarkdownExport" data-md-export="parse-html">
    <slot />
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import { useMarkdownExport } from '../lib/useMarkdownExport'

const isMarkdownExport = useMarkdownExport()
</script>
