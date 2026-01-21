<script setup>
import { onContentUpdated, useData } from 'vitepress'
import { nextTick, ref, watch, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  headers: {
    type: Array,
    required: true,
  },
  navHeight: {
    type: Number,
    required: true,
  },
})

const { theme, page } = useData()
const open = ref(false)
const vh = ref(0)
const main = ref(null)
const items = ref(null)

// Show markdown link on docs pages
const showMarkdownLink = computed(() => {
  return page.value.relativePath?.startsWith('docs') ?? false
})

const markdownUrl = computed(() => {
  const path = (page.value.relativePath ?? '').replace(/\.md$/, '')
  return `/${path}.md`
})

function resolveTitle(theme) {
  return (
    (typeof theme.outline === 'object' &&
      !Array.isArray(theme.outline) &&
      theme.outline.label) ||
    theme.outlineTitle ||
    'On this page'
  )
}

function closeOnClickOutside(e) {
  if (!main.value?.contains(e.target)) {
    open.value = false
  }
}

function onEscapeKey(e) {
  if (e.key === 'Escape') {
    open.value = false
  }
}

watch(open, (value) => {
  if (value) {
    document.addEventListener('click', closeOnClickOutside)
    return
  }
  document.removeEventListener('click', closeOnClickOutside)
})

onMounted(() => {
  document.addEventListener('keydown', onEscapeKey)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onEscapeKey)
})

onContentUpdated(() => {
  open.value = false
})

function toggle() {
  open.value = !open.value
  vh.value = window.innerHeight + Math.min(window.scrollY - props.navHeight, 0)
}

function onItemClick(e) {
  if (e.target.classList.contains('outline-link')) {
    if (items.value) {
      items.value.style.transition = 'none'
    }
    nextTick(() => {
      open.value = false
    })
  }
}

function scrollToTop() {
  open.value = false
  window.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
}

function onOutlineLinkClick(e) {
  const id = e.target.href?.split('#')[1]
  if (id) {
    const heading = document.getElementById(decodeURIComponent(id))
    heading?.focus({ preventScroll: true })
  }
}
</script>

<template>
  <div
    class="VPLocalNavOutlineDropdown"
    :style="{ '--vp-vh': vh + 'px' }"
    ref="main"
  >
    <button @click="toggle" :class="{ open }" v-if="headers.length > 0">
      <span class="menu-text">{{ resolveTitle(theme) }}</span>
      <span class="vpi-chevron-right icon" />
    </button>
    <button @click="scrollToTop" v-else>
      {{ theme.returnToTopLabel || 'Return to top' }}
    </button>
    <Transition name="flyout">
      <div v-if="open" ref="items" class="items" @click="onItemClick">
        <div class="header">
          <a class="top-link" href="#" @click="scrollToTop">
            {{ theme.returnToTopLabel || 'Return to top' }}
          </a>
          <a
            v-if="showMarkdownLink"
            class="markdown-link"
            :href="markdownUrl"
            target="_blank"
            rel="noopener"
          >
            ✨ Markdown
          </a>
        </div>
        <div class="outline">
          <ul class="outline-list">
            <li v-for="item in headers" :key="item.link">
              <a
                class="outline-link"
                :href="item.link"
                :title="item.title"
                @click="onOutlineLinkClick"
              >{{ item.title }}</a>
              <ul v-if="item.children?.length" class="outline-list nested">
                <li v-for="child in item.children" :key="child.link">
                  <a
                    class="outline-link"
                    :href="child.link"
                    :title="child.title"
                    @click="onOutlineLinkClick"
                  >{{ child.title }}</a>
                </li>
              </ul>
            </li>
          </ul>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.VPLocalNavOutlineDropdown {
  padding: 12px 20px 11px;
  position: static;
}

@media (min-width: 960px) {
  .VPLocalNavOutlineDropdown {
    padding: 12px 36px 11px;
  }
}

.VPLocalNavOutlineDropdown button {
  display: block;
  font-size: 12px;
  font-weight: 500;
  line-height: 24px;
  color: var(--vp-c-text-2);
  transition: color 0.5s;
  position: relative;
}

.VPLocalNavOutlineDropdown button:hover {
  color: var(--vp-c-text-1);
  transition: color 0.25s;
}

.VPLocalNavOutlineDropdown button.open {
  color: var(--vp-c-text-1);
}

.icon {
  display: inline-block;
  vertical-align: middle;
  margin-left: 2px;
  font-size: 14px;
  transform: rotate(0deg);
  transition: transform 0.25s;
}

@media (min-width: 960px) {
  .VPLocalNavOutlineDropdown button {
    font-size: 14px;
  }

  .icon {
    font-size: 16px;
  }
}

.open > .icon {
  transform: rotate(90deg);
}

.items {
  position: absolute;
  top: 40px;
  right: 16px;
  left: 16px;
  display: grid;
  gap: 1px;
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  background-color: var(--vp-c-gutter);
  max-height: calc(var(--vp-vh, 100vh) - 86px);
  overflow: hidden auto;
  box-shadow: var(--vp-shadow-3);
}

@media (min-width: 960px) {
  .items {
    right: auto;
    left: calc(var(--vp-sidebar-width) + 32px);
    width: 320px;
  }
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: var(--vp-c-bg-soft);
}

.top-link {
  display: block;
  padding: 0 16px;
  line-height: 48px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-brand-1);
}

.markdown-link {
  display: block;
  padding: 0 16px;
  line-height: 48px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-brand-1);
  text-decoration: none;
  transition: color 0.25s;
}

.markdown-link:hover {
  color: var(--vp-c-brand-2);
}

.outline {
  padding: 8px 0;
  background-color: var(--vp-c-bg-soft);
}

.outline-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.outline-list.nested {
  padding-left: 16px;
}

.outline-link {
  display: block;
  padding: 0 16px;
  line-height: 32px;
  font-size: 14px;
  font-weight: 400;
  color: var(--vp-c-text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.5s;
  text-decoration: none;
}

.outline-link:hover {
  color: var(--vp-c-text-1);
  transition: color 0.25s;
}

.flyout-enter-active {
  transition: all 0.2s ease-out;
}

.flyout-leave-active {
  transition: all 0.15s ease-in;
}

.flyout-enter-from,
.flyout-leave-to {
  opacity: 0;
  transform: translateY(-16px);
}
</style>
