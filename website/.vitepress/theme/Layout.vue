<script setup>
import { useData } from 'vitepress'
import { useSidebar } from 'vitepress/theme'

import DefaultTheme from 'vitepress/theme-without-fonts'

import BlogPostHeader from '../../src/components/BlogPostHeader.vue'
import NavSignupButton from '../../src/components/NavSignupButton.vue'
import SiteFooter from '../../src/components/SiteFooter.vue'
import UseCaseHeader from '../../src/components/UseCaseHeader.vue'

import ReleaseBanner from '../../src/components/home/ReleaseBanner.vue'

import HomeFeaturesAfter from '../../src/partials/home-features-after.md'
import HomeFeaturesBefore from '../../src/partials/home-features-before.md'

const { Layout } = DefaultTheme

const { frontmatter } = useData()
const { hasSidebar } = useSidebar()
</script>

<template>
  <Layout :class="!hasSidebar ? 'nav-relative' : ''">
    <template #layout-top>
      <template v-if="!hasSidebar">
        <ReleaseBanner
          link="/docs/integrations/vue"
          subtitle="now available!"
          description="Build reactive Vue apps with seamless sync!"
          background="#262626"
        >
          <template #icon>
            <img src="https://vuejs.org/logo.svg" alt="Vue.js logo" style="width: 20px; height: 20px; vertical-align: middle; margin-right: 8px;" />
          </template>
          <template #title>
            <span class="vue-text-gradient">Introducing Vue Composables</span>
          </template>
        </ReleaseBanner>
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