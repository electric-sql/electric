---
title: Sync
description: >-
  Build fast, resilient, and collaborative applications with composable sync primitives
layout: home
aside: false
hero:
  name: 'Sync'
  text: 'makes apps awesome'
  tagline: >-
    Sync is the magic ingredient behind fast, modern software.<br />From apps like Figma and Linear to multi-user, multi-agent AI applications.
  actions:
    - theme: brand
      text: View products
      link: /products
    - theme: alt
      text: Quickstart
      link: /docs/quickstart
  image:
    src: /img/icons/electric.svg
---

<script setup>
import { VPButton } from 'vitepress/theme'
</script>

## Why sync?

Applications today are increasingly real-time and collaborative. Users expect instant updates, offline support, and seamless multi-user experiences. Traditional request-response architectures can't keep up.

Sync provides a fundamentally better approach: instead of fetching data on demand, you sync data proactively. This enables instant UI updates, offline-first experiences, and automatic conflict resolution.

---

## What you can build {#solutions}

<div class="solutions-grid">

<div class="solution-panel" id="reactivity">
<div class="panel-icon">
<img src="/img/home/sync-targets/app.svg" alt="Reactivity" />
</div>
<div class="panel-content">
<h3 class="panel-title">Reactivity</h3>
<p class="panel-subtitle">Fast, modern apps</p>
<p class="panel-body">Build apps like Linear and Figma with instant, optimistic UI. Sync data into a local store for sub-millisecond reads and updates that feel instantaneous.</p>
<p><strong>Use:</strong> <a href="/products/postgres-sync">Postgres Sync</a> + <a href="/products/tanstack-db">TanStack DB</a></p>
</div>
</div>

<div class="solution-panel" id="resilience">
<div class="panel-icon">
<img src="/img/home/sync-targets/agent.svg" alt="Resilience" />
</div>
<div class="panel-content">
<h3 class="panel-title">Resilience</h3>
<p class="panel-subtitle">Resilient AI apps</p>
<p class="panel-body">AI apps that work reliably, even with patchy connectivity. Durable streams ensure AI responses are never lost and can resume from any point.</p>
<p><strong>Use:</strong> <a href="/products/durable-streams">Durable Streams</a></p>
</div>
</div>

<div class="solution-panel" id="collaboration">
<div class="panel-icon">
<img src="/img/home/sync-targets/agent.svg" alt="Collaboration" />
</div>
<div class="panel-content">
<h3 class="panel-title">Collaboration</h3>
<p class="panel-subtitle">Collaborative AI apps</p>
<p class="panel-body">Multi-user, multi-agent apps with real-time collaboration. Sync shared state between users and AI agents with automatic conflict resolution.</p>
<p><strong>Use:</strong> <a href="/products/durable-streams">Durable Streams</a> + <a href="/products/tanstack-db">TanStack DB</a></p>
</div>
</div>

<div class="solution-panel" id="durability">
<div class="panel-icon">
<img src="/img/home/sync-targets/worker.svg" alt="Durability" />
</div>
<div class="panel-content">
<h3 class="panel-title">Durability</h3>
<p class="panel-subtitle">Durable workflows</p>
<p class="panel-body">Multi-step agentic workflows that resume after failures. Build reliable, long-running processes with durable state and event streams.</p>
<p><strong>Use:</strong> <a href="/products/durable-streams">Durable Streams</a></p>
</div>
</div>

</div>

---

## Get started

Ready to build with sync? Explore our products to find the right tools for your use case.

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="/products"
        text="View products"
        theme="brand"
    />
  </div>
  <div class="action">
    <VPButton
        href="/docs/quickstart"
        text="Quickstart"
        theme="alt"
    />
  </div>
</div>

<style>
.solutions-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
  margin: 32px 0px 40px;
  align-items: stretch;
}

.solution-panel {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 20px;
  padding: 24px;
  background-color: var(--vp-c-bg-soft);
  border: 1px solid rgba(42, 44, 52, 0.5);
  border-radius: 12px;
  height: 100%;
}

.panel-icon {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
}

.panel-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.panel-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.panel-title {
  margin: 0 0 4px 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.panel-subtitle {
  margin: 0 0 8px 0;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--vp-c-brand-1);
}

.panel-body {
  margin: 0 0 12px 0;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--vp-c-text-2);
  flex: 1;
}

.panel-content p strong {
  color: var(--vp-c-text-2);
  font-weight: 500;
}

@media (max-width: 768px) {
  .solutions-grid {
    grid-template-columns: 1fr;
    gap: 20px;
  }

  .solution-panel {
    padding: 20px;
  }

  .panel-icon {
    width: 40px;
    height: 40px;
  }
}
</style>
