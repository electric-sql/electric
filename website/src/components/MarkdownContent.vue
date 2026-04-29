<template>
  <div v-if="isMarkdownExport" data-md-export="content" hidden>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { useMarkdownExport } from '../lib/useMarkdownExport'

const isMarkdownExport = useMarkdownExport()
</script>
