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

# Cloud <Badge type="warning" text="private beta" />

Hosted Electric sync that's blazing fast
and scales to millions of users

<div class="cloud-cta">
  <VPButton
      href="https://dashboard.electric-sql.cloud/"
      text="Sign up "
      theme="brand"
  />
</div>

## Hosted Electric

Electric Cloud is a hosted Electric service. It provisions, runs and operates the [Electric sync engine](/product/electric) for you.

## Data delivery network

Electric [syncs data over HTTP](/docs/api/http). This allows it to integrate with CDN infrastructure. Electric Cloud leverages this to provide a global Data Delivery Network

This allows you to scale out real-time data to [millions of concurrent users](/docs/reference/benchmarks#cloud) from a single commodity Postgres. With fast load times, low latency and consistent, low resource use.

## Available now

Electric Cloud is available now in <Badge type="warning" text="private beta" />.

<div class="actions cta-actions page-footer-actions left">
  <div class="action cloud-cta">
    <VPButton
        href="https://dashboard.electric-sql.cloud/"
        text="Sign up "
        theme="brand"
    />
  </div>
</div>