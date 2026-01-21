<script setup>
import { computed } from 'vue'
import { useData } from 'vitepress'

const props = defineProps({
  variant: {
    type: String,
    default: 'aside', // 'aside', 'local-nav', 'footer'
  },
})

const { page } = useData()

const markdownUrl = computed(() => {
  // Get current path and append .md
  const path = page.value.relativePath.replace(/\.md$/, '')
  return `/${path}.md`
})

// Force full page navigation to bypass VitePress client-side router
function navigateToMarkdown(event) {
  event.preventDefault()
  window.location.href = markdownUrl.value
}
</script>

<template>
  <a
    v-if="variant === 'aside'"
    class="markdown-link-aside pager-link"
    :href="markdownUrl"
    @click="navigateToMarkdown"
  >
    <span class="title">✨ Markdown</span>
  </a>
  <a
    v-else-if="variant === 'local-nav'"
    class="markdown-link-local-nav"
    :href="markdownUrl"
    @click="navigateToMarkdown"
  >
    <span class="title">✨ Markdown</span>
  </a>
  <a
    v-else-if="variant === 'footer'"
    class="markdown-link-footer"
    :href="markdownUrl"
    @click="navigateToMarkdown"
  >
    <span class="title">✨ Markdown</span>
  </a>
  <a
    v-else-if="variant === 'menu'"
    class="markdown-link-menu"
    :href="markdownUrl"
    @click="navigateToMarkdown"
  >
    ✨ Markdown
  </a>
</template>

<style scoped>
/* Aside link: Wide screens - styled like a pager link */
.markdown-link-aside {
  display: block;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 10px 14px;
  width: 100%;
  height: 100%;
  transition: border-color 0.25s;
  margin-bottom: 1.2rem;
  text-decoration: none;
}

.markdown-link-aside:hover {
  border-color: var(--vp-c-brand-1);
}

.markdown-link-aside .title {
  font-size: 13px;
  font-weight: 700;
  color: var(--vp-c-text-2);
}

/* Local nav link: Medium/small screens - matches "On this page" style */
.markdown-link-local-nav {
  display: flex;
  align-items: center;
  padding: 12px 12px 11px;
  font-size: 12px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  transition: color 0.25s;
  white-space: nowrap;
  text-decoration: none;
}

.markdown-link-local-nav:hover {
  color: var(--vp-c-text-1);
}

/* Footer link: Right-aligned next to "Edit this page" */
.markdown-link-footer {
  display: flex;
  align-items: center;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-brand-1);
  transition: color 0.25s;
  text-decoration: none;
}

.markdown-link-footer:hover {
  color: var(--vp-c-brand-2);
}

/* Menu link: Mobile nav screen */
.markdown-link-menu {
  display: block;
  border-top: 1px solid var(--vp-c-divider);
  padding: 12px 0 0 0;
  margin-top: 12px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-1);
  transition: color 0.25s;
  text-decoration: none;
}

.markdown-link-menu:hover {
  color: var(--vp-c-brand-1);
}
</style>
