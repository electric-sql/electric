---
title: Vue
description: >-
  Basic example of an Electric app using Vue3.
deployed_url: https://basic.examples.electric-sql.com
source_url: https://github.com/electric-sql/electric/tree/main/examples/vue
image: /img/demos/items-screenshot.png
example: true
---

# {{ $frontmatter.title }}

{{ $frontmatter.description }}

<DemoCTAs :demo="$frontmatter" />


This is our simplest example of a web app using Electric with [vue](https://vuejs.org) and [Vite](https://vite.dev).

The Electric-specific code is in [`./src/Example.vue`](https://github.com/electric-sql/electric/blog/main/examples/vue/src/Example.vue):

<<< @../../examples/vue/src/Example.vue{vue}

<DemoCTAs :demo="$frontmatter" />
