---
title: Electrify, Ignition, Liftoff!
description: >-
  ElectricSQL graduated from batch #6 of the Intel Ignite programme in Munich and joined Intel's Liftoff programme.
excerpt: >-
  ElectricSQL was selected by Intel as one of 10 startups to participate
  in batch #6 of it's Intel Ignite accelerator programme in Munich.
authors: [thruflo]
image: /img/blog/intel-ignite/header.jpg
tags: [company]
outline: deep
post: true
---

<script setup>
import { ref } from 'vue'

// Modal states
const isMentorsModalOpen = ref(false)
const isBatch6ModalOpen = ref(false)
const isAiPcModalOpen = ref(false)
</script>

ElectricSQL was selected by Intel as one of 10 startups to participate in [batch #6](https://intelignite.com/intel-ignite-selects-10-startups-for-fall-2023-european-cohort/) of it's [Intel Ignite](https://intelignite.com) accelerator programme in Munich.

It's a unique opportunity and our thanks go to [Alois](https://www.linkedin.com/in/alois-eder-013b0460/), [Kate](https://www.linkedin.com/in/katehach/), [Markus](https://www.linkedin.com/in/markusbohl/) and [Martha](https://www.linkedin.com/in/martha-ivanovas-78a897b/) on the programme team. We'd also like to thank our mentors [Ralph](https://www.linkedin.com/in/ralphdw/), [Karl](https://www.linkedin.com/in/0xpit/), [Benny](https://www.linkedin.com/in/fuhry/) and of course, the amazing [Diego](https://www.linkedin.com/in/diego-bailón-humpert-92390a28b/).

<div class="clickable-image" @click="isMentorsModalOpen = true">
  <img src="/img/blog/intel-ignite/mentors.jpg" />
  <div class="image-overlay">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"></circle>
      <path d="m21 21-4.35-4.35"></path>
      <line x1="11" y1="8" x2="11" y2="14"></line>
      <line x1="8" y1="11" x2="14" y2="11"></line>
    </svg>
  </div>
</div>

<ImageModal
:is-open="isMentorsModalOpen"
image-src="/img/blog/intel-ignite/mentors.jpg"
image-alt="Intel Ignite mentors"
@close="isMentorsModalOpen = false"
/>

The network around Ignite is unique and the other companies in the batch were all, without exception, exceptional. Doing everything from building fusion power reactors to next-generation chip manufacturing:

- [Deep Detection](https://deepdetection.tech) – high speed, multispectral analysis technology
- [Dotphoton](https://www.dotphoton.com) – massive-scale data processing and compression
- [FononTech](https://www.fonontech.com) – impulse printing of 3D interconnects for vertical chips
- [Giskard](https://www.giskard.ai) – testing and QA framework for AI
- [Proxima Fusion](https://www.proximafusion.com) – actually building stellarator fusion plants
- [Quantum Diamonds](https://www.quantumdiamonds.de) – quantum sensing for semiconductors
- [Semron](https://www.semron.ai) – high-density edge AI inference chip
- [SuperDuper](https://superduperdb.com) – bringing AI to the database
- [Zerve](https://www.zerve.ai) – reinventing data science collaboration

It was a privilege to be in the room.

<div class="clickable-image" @click="isBatch6ModalOpen = true">
  <img src="/img/blog/intel-ignite/batch6.jpg" />
  <div class="image-overlay">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"></circle>
      <path d="m21 21-4.35-4.35"></path>
      <line x1="11" y1="8" x2="11" y2="14"></line>
      <line x1="8" y1="11" x2="14" y2="11"></line>
    </svg>
  </div>
</div>

<ImageModal
:is-open="isBatch6ModalOpen"
image-src="/img/blog/intel-ignite/batch6.jpg"
image-alt="Intel Ignite batch 6"
@close="isBatch6ModalOpen = false"
/>

We look forward to continuing the collaboration through the [Intel Liftoff](https://www.intel.com/content/www/us/en/developer/tools/oneapi/liftoff.html) programme, where we plan to integrate our [local-first sync engine](https://legacy.electric-sql.com/docs/intro/local-first) with the [Intel oneAPI stack](https://www.intel.com/content/www/us/en/developer/tools/oneapi/overview.html) to power the next generation of [local RAG applications](/blog/2024/02/05/local-first-ai-with-tauri-postgres-pgvector-llama) running on [Intel's vision of the AI PC](https://www.intel.com/content/www/us/en/products/docs/processors/core-ultra/ai-pc.html).

<div class="clickable-image" @click="isAiPcModalOpen = true">
  <img src="/img/blog/intel-ignite/ai-pc.jpg" />
  <div class="image-overlay">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"></circle>
      <path d="m21 21-4.35-4.35"></path>
      <line x1="11" y1="8" x2="11" y2="14"></line>
      <line x1="8" y1="11" x2="14" y2="11"></line>
    </svg>
  </div>
</div>

<ImageModal
:is-open="isAiPcModalOpen"
image-src="/img/blog/intel-ignite/ai-pc.jpg"
image-alt="Intel AI PC"
@close="isAiPcModalOpen = false"
/>

Sometimes you experience the world changing around you. Other times you have an opportunity to be that change. With the Intel Ignite programme, the change is all around you. If you're a deep tech startup in Europe, we highly recommend that [you apply](https://intelignite.com/apply).
