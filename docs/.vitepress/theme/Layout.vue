<script setup>
import { useData } from 'vitepress'
import { useSidebar } from 'vitepress/theme'

import DefaultTheme from 'vitepress/theme-without-fonts'

import HomeFeaturesAfter from './home-features-after.md'
import HomeFeaturesBefore from './home-features-before.md'

import Footer from './footer.md'
import UseCaseHeader from './use-case-header.md'

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
      <div class="vp-doc">
        <UseCaseHeader v-if="frontmatter.case" />
      </div>
    </template>
    <template #layout-bottom>
      <Footer v-if="!hasSidebar" />
    </template>
  </Layout>
</template>