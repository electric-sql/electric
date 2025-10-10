<script setup>
import { watch, onMounted } from "vue"
import { useData, useRouter } from "vitepress"
import { posthog } from "posthog-js"
import { useSidebar } from "vitepress/theme"

import DefaultTheme from "vitepress/theme-without-fonts"

import BlogPostHeader from "../../src/components/BlogPostHeader.vue"
import NavSignupButton from "../../src/components/NavSignupButton.vue"
import SiteFooter from "../../src/components/SiteFooter.vue"
import UseCaseHeader from "../../src/components/UseCaseHeader.vue"

import ReleaseBanner from "../../src/components/home/ReleaseBanner.vue"

import HomeFeaturesAfter from "../../src/partials/home-features-after.md"
import HomeFeaturesBefore from "../../src/partials/home-features-before.md"

// Posthog analytics
const router = useRouter()
onMounted(() => {
  // Only run PostHog tracking in production
  if (window.location.hostname === 'electric-sql.com') {
    watch(
      () => router.route.data.relativePath,
      (path) => {
        posthog.init("phc_o4xENyuuSCdNPG2CWtfdqzYYXs6v8SbmVDzm3CP0Qwn", {
          api_host: `https://admin.electric-sql.cloud/api/ph`,
          ui_host: "https://us.i.posthog.com",
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

const { frontmatter } = useData()
const { hasSidebar } = useSidebar()
const shouldShowReleasebanner = frontmatter.hideReleaseBanner || !hasSidebar
</script>

<template>
  <Layout :class="!hasSidebar ? 'nav-relative' : ''">
    <template #layout-top>
      <template v-if="shouldShowReleasebanner">
        <ReleaseBanner />
      </template>
    </template>
    <template #nav-bar-content-after>
      <NavSignupButton />
    </template>
    <template #doc-before>
      <div class="vp-doc" v-if="frontmatter.case">
        <UseCaseHeader />
      </div>
      <div class="vp-doc" v-if="frontmatter.post">
        <BlogPostHeader />
      </div>
    </template>
    <template #layout-bottom>
      <SiteFooter v-if="!hasSidebar" />
    </template>
  </Layout>
</template>
