---
title: Jobs
description: >-
  Join a small, technical, multi-disciplinary team that's passionate
  about product, engineering and developer experience.
image: /img/about/villa-discussion.jpg
outline: deep
---

<script setup>
import { data as activeJobs } from '../../data/activeJobs.data.ts'
import { ref } from 'vue'

const currentlyHiring = activeJobs.length > 0

// Modal state
const isImageModalOpen = ref(false)
</script>

<figure class="page-image">
  <div class="clickable-image" @click="isImageModalOpen = true">
    <img src="/img/about/villa-discussion.jpg" />
    <div class="image-overlay">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"></circle>
        <path d="m21 21-4.35-4.35"></path>
        <line x1="11" y1="8" x2="11" y2="14"></line>
        <line x1="8" y1="11" x2="14" y2="11"></line>
      </svg>
    </div>
  </div>
</figure>

<ImageModal
:is-open="isImageModalOpen"
image-src="/img/about/villa-discussion.jpg"
image-alt="Villa discussion"
@close="isImageModalOpen = false"
/>

<h1 id="#join">Join the ElectricSQL team</h1>

We're a [small, technical team](/about/team) that's passionate about our work, our product and our culture. We work remote-first, on European time, with a four day week.

<div v-if="currentlyHiring">

## Active roles

> [!Tip] We're hiring!
>
> <ul><li v-for="job in activeJobs"><a :href="job.link">{{ job.title }}</a></li></ul>

</div>

## Stage

We're a Seed-stage [VC-backed](/about/team#investors) startup.

## Benefits

We work a 4 day week with flexible hours and no fetishisation of working late.

You get 25 days holiday + public holidays, equipment of your choice and a mandate to contribute to open source.

## Location

We're a remote-first team but we organise quarterly on-sites in Europe.

So far places we've met up in include Amsterdam, Dublin, Istanbul, Istria, Lisbon, London, Munich, Paris, Stockholm and Zagreb.

## Diversity

We especially welcome female applicants, applicants from ethnic groups that are under represented in tech and LGBTQ+ applicants.

We're happy for you to fit work around your children or other life commitments.

<div v-if="!currentlyHiring">

## Active roles

> [!Warning] No active roles
> Sorry, we don't have any roles open at the moment. If you're interested in joining the team, you can keep an eye out for [hiring announcements on Discord](https://discord.electric-sql.com).

</div>
