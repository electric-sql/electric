<script setup lang="ts">
import { VPButton } from 'vitepress/theme'

import HomeCompositionHero from './HomeCompositionHero.vue'
</script>

<template>
  <section class="home-hero">
    <div class="home-hero-inner">
      <div class="home-hero-grid">
      <div class="home-hero-text">
        <p class="home-hero-eyebrow">
          Open source · Apache 2.0
        </p>
        <h1 class="home-hero-name">
          The agent platform
          built on&nbsp;<span class="home-hero-accent">sync</span>
        </h1>
        <p class="home-hero-sub">
          <span class="home-hero-sub-primary">
            Agents are long-lived entities in the data layer.
            The substrate for them is a sync&nbsp;engine.
          </span>
          <br /><br />
          <span class="home-hero-sub-secondary">
            Electric is the first agent platform built on&nbsp;sync.
          </span>
        </p>
        <div class="home-hero-actions">
          <VPButton
            tag="a"
            size="medium"
            theme="brand"
            text="Electric Cloud »"
            href="https://dashboard.electric-sql.cloud/"
          />
        </div>
      </div>
      <div class="home-hero-scene">
        <HomeCompositionHero />
      </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Outer = full-bleed band. Inner = centred max-width container. Same pattern
   as agents-home / streams-home / sync-home so the hero reaches the viewport
   edges and matches the cross-page rhythm. */
.home-hero {
  position: relative;
  /* Top padding is intentionally tighter than the agents/streams/sync
     landing-page heroes (which use 100px). The homepage hero already adds
     visual height via the eyebrow + isometric scene, so this keeps the
     content starting close to the navbar. */
  padding: 8px 24px 48px;
  /* `overflow: visible` lets the iso composition stack bleed past the
     border-bottom into the start of the next product section. The
     scene cell sits on `z-index: 2` so its protruding lower layers
     render *over* the next section's background rather than getting
     covered by it. */
  overflow: visible;
  border-bottom: 1px solid var(--vp-c-divider);
}

.home-hero-inner {
  /* Matches `.home-product-inner` (1152px) on the product
     sections below so the hero headline and copy line up
     with the eyebrow / title text in every product band —
     previously the hero used 1280px which pushed the text
     ~64px further left than the rest of the page. */
  max-width: 1152px;
  margin: 0 auto;
}

.home-hero-grid {
  display: grid;
  grid-template-columns: 5fr 7fr;
  gap: 36px;
  /* Vertically centre the text block against the iso scene cell — the
     scene is taller, so this pushes the title down to the visual middle
     of the hero rather than crowding the navbar. */
  align-items: center;
  max-width: 100%;
}

.home-hero-text {
  position: relative;
  z-index: 1;
  pointer-events: none;
}
.home-hero-text * {
  pointer-events: auto;
}

.home-hero-eyebrow {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ea-text-3);
  margin: 0 0 18px;
}

.home-hero-name {
  font-size: 56px;
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: -0.02em;
  background: none;
  -webkit-background-clip: border-box;
  background-clip: border-box;
  -webkit-text-fill-color: currentColor;
  color: var(--ea-text-1);
  margin: 0;
  padding-bottom: 4px;
}

.home-hero-accent {
  color: var(--vp-c-brand-1);
  -webkit-text-fill-color: currentColor;
}

.home-hero-sub {
  font-size: 20px;
  font-weight: 500;
  color: var(--ea-text-1);
  margin: 22px 0 0;
  line-height: 1.4;
}

.home-hero-sub-primary {
  font-size: 1.04em;
}

.home-hero-sub-secondary {
  font-size: 0.92em;
  color: var(--ea-text-2);
}

.home-hero-actions {
  margin-top: 32px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.home-hero-scene {
  position: relative;
  /* z-index lifts the iso scene above the next section so the
     lower layers can bleed downward past the hero seam without
     getting covered by the agents product section's background. */
  z-index: 2;
  width: 100%;
  aspect-ratio: 5 / 4;
  min-height: 420px;
  max-height: 620px;
  /* Slightly knocked back so the iso composition reads as a
     supporting illustration rather than competing with the
     headline copy beside it. Applied here (rather than on the
     iso stack itself) so the whole scene — labels, shadows,
     borders — fades together. */
  opacity: 0.85;
}

@media (max-width: 1099px) {
  .home-hero-grid {
    grid-template-columns: 1fr;
    gap: 28px;
  }
  .home-hero-scene {
    order: -1;
    aspect-ratio: 16 / 9;
    min-height: 320px;
  }
}

@media (max-width: 768px) {
  .home-hero {
    padding: 8px 20px 32px;
  }
  .home-hero-name {
    font-size: 40px;
  }
  .home-hero-sub {
    font-size: 17px;
  }
  .home-hero-install-text {
    font-size: 12px;
  }
  .home-hero-scene {
    min-height: 260px;
  }
}

@media (max-width: 480px) {
  .home-hero-name {
    font-size: 32px;
  }
  .home-hero-sub {
    font-size: 16px;
  }
}
</style>
