<script setup>
import { ref, computed } from 'vue'
import { useData } from 'vitepress'

const props = defineProps({
  variant: {
    type: String,
    default: 'aside', // 'aside', 'local-nav', 'footer'
  },
})

const { page } = useData()
const copied = ref(false)

const markdownUrl = computed(() => {
  // Get current path and append .md
  const path = page.value.relativePath.replace(/\.md$/, '')
  return `/${path}.md`
})

async function copyMarkdown() {
  try {
    const response = await fetch(markdownUrl.value)
    if (!response.ok) {
      throw new Error(`Failed to fetch markdown: ${response.status}`)
    }
    const markdown = await response.text()
    await navigator.clipboard.writeText(markdown)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch (error) {
    console.error('Failed to copy markdown:', error)
    // Fallback: copy the URL instead
    try {
      await navigator.clipboard.writeText(window.location.origin + markdownUrl.value)
      copied.value = true
      setTimeout(() => {
        copied.value = false
      }, 2000)
    } catch (e) {
      console.error('Failed to copy URL:', e)
    }
  }
}
</script>

<template>
  <button
    v-if="variant === 'aside'"
    class="copy-markdown-aside pager-link"
    @click="copyMarkdown"
    :title="copied ? 'Copied!' : 'Copy page as Markdown'"
  >
    <span class="title">{{ copied ? 'Copied!' : 'Markdown' }}</span>
  </button>
  <button
    v-else-if="variant === 'local-nav'"
    class="copy-markdown-local-nav"
    @click="copyMarkdown"
    :title="copied ? 'Copied!' : 'Copy page as Markdown'"
  >
    <span class="title">{{ copied ? 'Copied!' : 'Markdown' }}</span>
  </button>
  <button
    v-else-if="variant === 'footer'"
    class="copy-markdown-footer"
    @click="copyMarkdown"
    :title="copied ? 'Copied!' : 'Copy page as Markdown'"
  >
    <span class="title">{{ copied ? 'Copied!' : 'Markdown' }}</span>
  </button>
  <a
    v-else-if="variant === 'menu'"
    class="copy-markdown-menu VPMenuLink"
    @click.prevent="copyMarkdown"
    href="#"
  >
    <span class="text">{{ copied ? 'Copied!' : 'Markdown' }}</span>
  </a>
</template>

<style scoped>
/* Aside button: Wide screens - styled like a pager link */
.copy-markdown-aside {
  display: block;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 10px 14px;
  width: 100%;
  height: 100%;
  transition: border-color 0.25s;
  margin-bottom: 1.2rem;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.copy-markdown-aside:hover {
  border-color: var(--vp-c-brand-1);
}

.copy-markdown-aside .title {
  font-size: 13px;
  font-weight: 700;
  color: var(--vp-c-text-2);
}

.copy-markdown-aside .title::before {
  content: '\2728 ';  /* ✨ sparkle emoji */
}

/* Local nav button: Medium/small screens - matches "On this page" style */
.copy-markdown-local-nav {
  display: flex;
  align-items: center;
  padding: 12px 12px 11px;
  font-size: 12px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.25s;
  white-space: nowrap;
}

.copy-markdown-local-nav:hover {
  color: var(--vp-c-text-1);
}

.copy-markdown-local-nav .title::before {
  content: '\2728 ';  /* ✨ sparkle emoji */
}

/* Footer button: Right-aligned next to "Edit this page" */
.copy-markdown-footer {
  display: flex;
  align-items: center;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-brand-1);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.25s;
}

.copy-markdown-footer:hover {
  color: var(--vp-c-brand-2);
}

.copy-markdown-footer .title::before {
  content: '\2728 ';  /* ✨ sparkle emoji */
}

/* Menu variant for dropdowns */
.copy-markdown-menu {
  display: block;
  padding: 0 16px;
  line-height: 32px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-1);
  cursor: pointer;
  white-space: nowrap;
  text-decoration: none !important;
}

.copy-markdown-menu:hover {
  color: var(--vp-c-brand-1);
}

.copy-markdown-menu .text::before {
  content: '\2728 ';  /* ✨ sparkle emoji */
}
</style>
