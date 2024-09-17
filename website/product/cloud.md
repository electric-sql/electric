---
title: Cloud
description: >-
  Hosted Electric sync that's blazing fast
  and scales to millions of users
outline: deep
---

<script setup>
import { onMounted } from 'vue'

onMounted(async () => {
  if (typeof window !== 'undefined' && document.querySelector) {
    let links = document.querySelectorAll('.cloud-cta a.VPButton.brand')

    console.log('links', links)

    links.forEach((link) => {
      if (link.querySelector('span.vpi-electric-icon')) {
        return
      }

      const icon = document.createElement('span')
      icon.classList.add('vpi-electric-icon')

      link.prepend(icon)
    })
  }
})
</script>

<img src="/img/icons/ddn.svg" class="product-icon" />

# Cloud <Badge type="info" text="private alpha" />

Hosted Electric sync that's blazing fast
and scales to millions of users

<div class="cloud-cta">
  <VPButton
      href="/product/cloud/sign-up"
      text="Sign up "
      theme="brand"
  />
</div>

## Hosted Electric

Electric Cloud is a hosted Electric service. It provisions, runs and operates the [Electric sync engine](/product/sync) for you.

## Data delivery network

Electric [syncs data over HTTP](/docs/api/http). This allows it to integrate with CDN infrastructure. Electric Cloud leverages this to provide a global Data Delivery Network

This allows you to scale out real-time data to millions of concurrent users from a single commodity Postgres. With blazing fast load times, minimal latency and low resource use.

<!-- graphs, evidence, benchmarks -->

## More information

Electric Cloud is currently in <Badge type="tip" text="private alpha" />.

If you're interested in using it, you can sign up to the waitlist. We'll be in touch when we have capacity to onboard you.

<div class="actions cta-actions page-footer-actions left">
  <div class="action cloud-cta">
    <VPButton
        href="/product/cloud/sign-up"
        text="Sign up "
        theme="brand"
    />
  </div>
</div>