<script setup>
import CTAStrap from "../CTAStrap.vue"

const actions = [
  {
    href: "/docs/quickstart",
    text: "Quickstart",
    theme: "brand",
  },
  // {
  //   href: '/docs/tutorial',
  //   text: 'Tutorial'
  // },
  {
    href: "/docs/intro",
    text: "Docs",
  },
]
</script>

<template>
  <CTAStrap :actions="actions">
    <template #title> No&nbsp;siloes. No&nbsp;black&nbsp;boxes. </template>
    <template #tagline>
      Just
      <span class="hidden-sm"> real-time</span>
      sync, solved. It’s all
      <a href="https://github.com/electric-sql" class="no-wrap"> open source</a>
      <span class="no-wrap-xs">
        and it’s all just
        <span class="no-wrap">
          <a href="/docs/api/http"> Postgres and HTTP</a></span
        ></span
      >.
    </template>
  </CTAStrap>
</template>
