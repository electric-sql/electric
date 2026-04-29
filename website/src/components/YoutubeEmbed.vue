<script setup lang="ts">
import MarkdownContent from './MarkdownContent.vue'
import MdExportExplicit from './MdExportExplicit.vue'

import { useMarkdownExport } from '../lib/useMarkdownExport'

const props = withDefaults(
  defineProps<{
    videoId: string
    title?: string
  }>(),
  { title: 'YouTube video player' }
)

const src = `https://www.youtube-nocookie.com/embed/${props.videoId}?rel=0`
const youtubeUrl = `https://www.youtube.com/watch?v=${props.videoId}`
const isMarkdownExport = useMarkdownExport()
</script>

<template>
  <MdExportExplicit v-if="isMarkdownExport">
    <MarkdownContent>
      Watch on YouTube: [{{ title }}]({{ youtubeUrl }})
    </MarkdownContent>
  </MdExportExplicit>

  <iframe
    v-else
    :src="src"
    :title="title"
    allow="encrypted-media; fullscreen; picture-in-picture"
    class="youtube-embed"
    sandbox="allow-presentation allow-same-origin allow-scripts"
  >
  </iframe>
</template>
