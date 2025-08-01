---
title: Contact
description: >-
  Get in touch with us by email or say hello on our community Discord.
image: /img/about/vizinada.jpg
outline: deep
---

<script setup>
import { ref } from 'vue'

// Modal state
const isImageModalOpen = ref(false)
</script>

<figure class="page-image">
  <div class="clickable-image" @click="isImageModalOpen = true">
    <img src="/img/about/vizinada.jpg" />
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
image-src="/img/about/vizinada.jpg"
image-alt="Vizinada"
@close="isImageModalOpen = false"
/>

# Contact us

ElectricSQL is a [UK registered company](https://find-and-update.company-information.service.gov.uk/company/13573370) headquartered in [Istria](https://www.istra.hr/en/explore-istria).

Get in touch by email on [info@electric-sql.com](mailto:info@electric-sql.com) or join our [community Discord](https://discord.electric-sql.com).

## Press

For media enquiries, please contact us on [press@electric-sql.com](mailto:press@electric-sql.com).

## Logos

You can download our logo here:

- [logo](/img/brand/logo.svg) for dark backgrounds
- [inverse logo](/img/brand/logo.inverse.svg) for light backgrounds
