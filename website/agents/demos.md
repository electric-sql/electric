---
title: Agents demos
description: Demos and example applications built with Electric Agents.
image: /img/demos/demos-header.jpg
---

<script setup>
import { data } from '../data/agents-demos.data.ts'

const { demos } = data
const technicalExamples = [
  {
    title: 'Playground',
    description:
      'Technical examples for experimenting with Electric Agents coordination patterns.',
    link: '/docs/agents/examples/playground',
  },
]
</script>

# Agents demos

Demos and example applications built with Electric Agents.

## Demo apps

These demos showcase the kind of apps and UX you can build with Electric Agents.

<div class="demos-grid">
  <DemoListing v-for="(demo, index) in demos" :demo="demo" :key="index" />
</div>

## Technical examples

These are more technical examples demonstrating how to implement certain patterns and integrations. Source code for all of these is in the [`examples` folder](https://github.com/electric-sql/electric/tree/main/examples) on GitHub.

<ul v-for="(example, index) in technicalExamples" :key="index">
  <li>
    <h4>
      <a :href="example.link">
        {{ example.title }}</a>
    </h4>
    <p style="margin: 5px 0">
      {{ example.description }}
    </p>
  </li>
</ul>
