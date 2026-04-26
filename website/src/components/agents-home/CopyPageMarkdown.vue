<template>
  <button class="copy-page-md" :class="{ copied }" @click="copy" :title="copied ? 'Copied!' : 'Copy this page as Markdown'">
    <svg v-if="!copied" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
    <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
    <span>{{ copied ? 'Copied!' : 'Copy as Markdown' }}</span>
  </button>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vitepress'

const copied = ref(false)
const route = useRoute()

async function copy() {
  const path = route.path
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const mdUrl = `${origin}${path}.md`

  try {
    const res = await fetch(mdUrl)
    if (!res.ok) throw new Error(`Failed to fetch ${mdUrl}`)
    let md = await res.text()

    md = md.replace(/^---\n[\s\S]*?\n---\n*/, '')
    md = md.replace(/<script[\s\S]*?<\/script>\n*/gi, '')

    await navigator.clipboard.writeText(md.trim())
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch {
    const content = document.querySelector('.vp-doc')
    if (content instanceof HTMLElement) {
      await navigator.clipboard.writeText(content.innerText)
      copied.value = true
      setTimeout(() => { copied.value = false }, 2000)
    }
  }
}
</script>

<style scoped>
.copy-page-md {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  margin-bottom: 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 13px;
  font-family: var(--vp-font-family-base);
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s, background 0.2s;
  line-height: 1;
}

.copy-page-md:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-text-3);
  background: var(--vp-c-bg-elv);
}

.copy-page-md.copied {
  color: var(--vp-c-green-1);
  border-color: var(--vp-c-green-1);
}
</style>
