<script setup>
import { watch, onMounted, computed, ref } from 'vue'
import { useData, useRouter } from 'vitepress'
import { posthog } from 'posthog-js'
import { useSidebar, useLocalNav } from 'vitepress/theme'

import DefaultTheme from 'vitepress/theme-without-fonts'

import BlogPostHeader from '../../src/components/BlogPostHeader.vue'
import LocalNavOutlineDropdown from '../../src/components/LocalNavOutlineDropdown.vue'
import MarkdownLink from '../../src/components/MarkdownLink.vue'
import NavSignupButton from '../../src/components/NavSignupButton.vue'
import SiteFooter from '../../src/components/SiteFooter.vue'
import UseCaseHeader from '../../src/components/UseCaseHeader.vue'

import DocsSidebarHero from './components/DocsSidebarHero.vue'
import MegaNav from './components/MegaNav.vue'
import MegaNavMobile from './components/MegaNavMobile.vue'

import ReleaseBanner from '../../src/components/home/ReleaseBanner.vue'

// Posthog analytics
const router = useRouter()
onMounted(() => {
  // Only run PostHog tracking in production
  if (window.location.hostname === 'electric-sql.com') {
    watch(
      () => router.route.data.relativePath,
      (path) => {
        posthog.init('phc_o4xENyuuSCdNPG2CWtfdqzYYXs6v8SbmVDzm3CP0Qwn', {
          api_host: `https://admin.electric-sql.cloud/api/ph`,
          ui_host: 'https://us.i.posthog.com',
        })
        posthog.capture(`$pageview`, {
          $current_url: window.location.href,
        })
      },
      { immediate: true }
    )
  }
})

// Accessibility: VitePress's default Layout doesn't wrap the content
// area in a <main> landmark and doesn't expose a slot that lets us add
// one. Patch role="main" onto the content wrapper on every route change
// so screen reader users get a proper main landmark to jump to (WCAG
// 2.4.1 "Bypass Blocks"). The skip-to-content link VitePress already
// provides targets the same #VPContent element, so the skip link and
// the landmark stay consistent.
watch(
  () => router.route.data.relativePath,
  () => {
    requestAnimationFrame(() => {
      const contentEl =
        document.querySelector('.VPContent') ||
        document.querySelector('.VPHome')
      if (contentEl && !contentEl.hasAttribute('role')) {
        contentEl.setAttribute('role', 'main')
      }
    })
  },
  { immediate: true }
)

const { Layout } = DefaultTheme

const { frontmatter, page } = useData()
const { hasSidebar } = useSidebar()
const { headers } = useLocalNav()

// Show markdown link in the doc footer on all sidebar pages.
const showMarkdownLink = computed(() => {
  return hasSidebar.value
})

// Local nav height for dropdown positioning
const navHeight = ref(0)

onMounted(() => {
  navHeight.value = parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--vp-nav-height')
  )
})
const shouldShowReleasebanner = frontmatter.hideReleaseBanner || !hasSidebar

const layoutClass = computed(() => {
  const classes = []
  if (!hasSidebar.value) classes.push('nav-relative')
  if (frontmatter.value?.pageClass) classes.push(frontmatter.value.pageClass)
  return classes.join(' ')
})
</script>

<template>
  <Layout :class="layoutClass">
    <template #layout-top>
      <template v-if="shouldShowReleasebanner">
        <ReleaseBanner />
      </template>
    </template>
    <template #nav-bar-content-before>
      <MegaNav />
    </template>
    <template #nav-bar-content-after>
      <NavSignupButton />
    </template>
    <template #nav-screen-content-before>
      <MegaNavMobile />
    </template>
    <template #sidebar-nav-before>
      <DocsSidebarHero />
    </template>
    <template #doc-top>
      <!-- Local nav bar: Medium screens - markdown link floats right -->
      <div v-if="showMarkdownLink" class="markdown-link-local-nav-container">
        <MarkdownLink variant="local-nav" />
      </div>
      <!-- Small screens: Custom dropdown with markdown link -->
      <div v-if="showMarkdownLink" class="custom-local-nav-dropdown">
        <LocalNavOutlineDropdown :headers="headers" :navHeight="navHeight" />
      </div>
    </template>
    <template #doc-before>
      <div class="vp-doc" v-if="frontmatter.case">
        <UseCaseHeader />
      </div>
      <div class="vp-doc" v-if="frontmatter.post">
        <BlogPostHeader />
      </div>
    </template>
    <template #aside-outline-before>
      <!-- Wide screens: Above "On this page" -->
      <MarkdownLink v-if="showMarkdownLink" variant="aside" />
    </template>
    <template #layout-bottom>
      <SiteFooter v-if="!hasSidebar" />
    </template>
  </Layout>
</template>
