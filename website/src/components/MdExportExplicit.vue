<template>
  <div v-if="isMarkdownExport" data-md-export="explicit">
    <slot />
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import { useMarkdownExport } from '../lib/useMarkdownExport'

const isMarkdownExport = useMarkdownExport()
</script>
