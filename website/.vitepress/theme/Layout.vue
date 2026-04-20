<script setup>
import { watch, onMounted, onBeforeUnmount, computed, ref } from 'vue'
import { useData, useRoute, useRouter } from 'vitepress'
import { posthog } from 'posthog-js'
import { useSidebar, useLocalNav } from 'vitepress/theme'

import DefaultTheme from 'vitepress/theme-without-fonts'

import BlogPostHeader from '../../src/components/BlogPostHeader.vue'
import LocalNavOutlineDropdown from '../../src/components/LocalNavOutlineDropdown.vue'
import MarkdownLink from '../../src/components/MarkdownLink.vue'
import NavSignupButton from '../../src/components/NavSignupButton.vue'
import SiteFooter from '../../src/components/SiteFooter.vue'
import UseCaseHeader from '../../src/components/UseCaseHeader.vue'

import CloudSectionNav from './components/CloudSectionNav.vue'
import MegaNav from './components/MegaNav.vue'
import MegaNavMobile from './components/MegaNavMobile.vue'

import ReleaseBanner from '../../src/components/home/ReleaseBanner.vue'

import HomeFeaturesAfter from '../../src/partials/home-features-after.md'
import HomeFeaturesBefore from '../../src/partials/home-features-before.md'

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

const { Layout } = DefaultTheme

const { frontmatter, page } = useData()
const { hasSidebar } = useSidebar()
const { headers } = useLocalNav()

// Show markdown link on docs pages (same pages that show edit link)
const showMarkdownLink = computed(() => {
  return page.value.relativePath?.startsWith('docs') ?? false
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

// Cloud section: render the CloudSectionNav from the layout (so it
// sits at a consistent vertical position across docs and home
// layouts) instead of inline in each markdown file.
const route = useRoute()
const isCloudRoute = computed(() => {
  const p = route.path || ''
  return p === '/cloud' || p === '/cloud/' || p.startsWith('/cloud/') || p.startsWith('/pricing')
})

// Toggle a body class so the non-scoped CSS in CloudSectionNav.vue
// can lift `--vp-doc-top-height` and shift the right-rail aside down
// below the bar.
function syncCloudBodyClass(active) {
  if (typeof document === 'undefined') return
  document.body.classList.toggle('has-cloud-nav', !!active)
}

watch(isCloudRoute, syncCloudBodyClass, { immediate: false })

onMounted(() => {
  syncCloudBodyClass(isCloudRoute.value)
})

onBeforeUnmount(() => {
  syncCloudBodyClass(false)
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
    <template #doc-top>
      <!-- Cloud section pill nav (rendered from the layout so its
           vertical position stays consistent across docs and home
           layouts). -->
      <CloudSectionNav v-if="isCloudRoute" placement="doc" />
      <!-- Local nav bar: Medium screens - markdown link floats right -->
      <div v-if="showMarkdownLink" class="markdown-link-local-nav-container">
        <MarkdownLink variant="local-nav" />
      </div>
      <!-- Small screens: Custom dropdown with markdown link -->
      <div v-if="showMarkdownLink" class="custom-local-nav-dropdown">
        <LocalNavOutlineDropdown :headers="headers" :navHeight="navHeight" />
      </div>
    </template>
    <template #home-hero-before>
      <CloudSectionNav v-if="isCloudRoute" placement="home" />
    </template>
    <template #page-top>
      <!-- `layout: page` (used by the cloud overview to get a blank,
           full-bleed canvas like streams / sync / agents) doesn't
           expose the home-hero slots, so render the cloud pill nav
           here too. -->
      <CloudSectionNav v-if="isCloudRoute" placement="home" />
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
    <template #doc-footer-before>
      <!-- Footer: Right-aligned next to "Edit this page" -->
      <div v-if="showMarkdownLink" class="markdown-link-footer-container">
        <MarkdownLink variant="footer" />
      </div>
    </template>
    <template #layout-bottom>
      <SiteFooter v-if="!hasSidebar" />
    </template>
  </Layout>
</template>
