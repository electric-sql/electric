<script setup>
import { useData } from 'vitepress'
import { useSidebar } from 'vitepress/theme'

import DefaultTheme from 'vitepress/theme-without-fonts'

import SiteFooter from '../../src/components/SiteFooter.vue'
import UseCaseHeader from '../../src/components/UseCaseHeader.vue'

import HomeFeaturesAfter from '../../src/partials/home-features-after.md'
import HomeFeaturesBefore from '../../src/partials/home-features-before.md'

const { Layout } = DefaultTheme

const { frontmatter } = useData()
const { hasSidebar } = useSidebar()
</script>

<template>
  <Layout>
    <template #home-features-before>
      <div class="vp-doc">
        <div class="container">
          <div class="features-content">
            <HomeFeaturesBefore />
          </div>
        </div>
      </div>
    </template>
    <template #home-features-after>
      <div class="vp-doc">
        <div class="container">
          <div class="features-content">
            <HomeFeaturesAfter />
          </div>
        </div>
      </div>
    </template>
    <template #doc-before>
      <div class="vp-doc" v-if="frontmatter.case">
        <UseCaseHeader />
      </div>
    </template>
    <template #layout-bottom>
      <SiteFooter v-if="!hasSidebar" />
    </template>
  </Layout>
</template>