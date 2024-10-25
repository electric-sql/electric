---
title: Literature
description: >-
  A selection of research papers that relate to local-first software and distributed databases.
outline: deep
---

<script setup>
  import { data as papers } from '../../data/literature.data.ts'
</script>

# Literature

ElectricSQL builds on decades of research into distributed database technology. Some of which was authored by [our team and advisors](/about/team).

> [!Tip] Edit this page
> If you'd like to suggest a paper or an edit to make to this page, please
> <span class="no-wrap-sm">[submit a pull‑request](https://github.com/electric-sql/electric/edit/main/website/docs/reference/alternatives.md)</span>.

## Research papers

This page lists a non-exhaustive selection of papers that chart the development of some of the concepts and algorithms that ElectricSQL and [other systems](./alternatives) are based on.

<div v-for="section in papers">
  <h3 :id="section.year">
    {{ section.year }}
    <a class="header-anchor" :href="`#${ section.year }`">
      &ZeroWidthSpace;</a></h3>
  <ul style="padding: 0; list-style: none">
    <li v-for="paper in section.papers">
      <a :href="paper.url" target="_blank">
        {{ paper.title }}</a>
      by
      <span v-for="(author, index) in paper.authors"><span v-if="index > 0 && index < paper.authors.length - 1">, </span><span v-if="index > 0 && index == paper.authors.length - 1"> and </span>{{ author }}</span>
    </li>
  </ul>
</div>