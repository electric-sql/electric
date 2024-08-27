<script setup>
import DefaultTheme from 'vitepress/theme-without-fonts'

import HomeFeaturesAfter from './home-features-after.md'
import HomeFeaturesBefore from './home-features-before.md'

import Footer from './footer.md'

const { Layout } = DefaultTheme
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
    <template #layout-bottom>
      <Footer v-if="$frontmatter.layout == 'home'" />
    </template>
  </Layout>
</template>