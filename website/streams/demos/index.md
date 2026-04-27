---
title: Streams demos
description: Demos and example applications built with Electric Streams.
image: /img/demos/demos-header.jpg
---

<script setup>
import { data } from '../../data/streams-demos.data.ts'

const { demos, examples } = data
const technicalExamples = [
  ...examples,
  {
    title: 'Yjs demo',
    description:
      'Collaborative editor example using y-durable-streams as a Yjs provider.',
    link: 'https://github.com/durable-streams/durable-streams/tree/main/examples/yjs-demo',
  },
]
</script>

# Streams demos

Demos and example applications built with Electric Streams.

## Demo apps

These demos showcase the kind of apps and UX you can build with Electric Streams.

<div class="demos-grid">
  <DemoListing v-for="(demo, index) in demos" :demo="demo" :key="index" />
</div>

## Technical examples

These are more technical examples demonstrating how to implement certain patterns and integrations.

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
