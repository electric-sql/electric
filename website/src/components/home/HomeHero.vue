<script setup lang="ts">
import { VPButton } from 'vitepress/theme'

import HomeCompositionHero from './HomeCompositionHero.vue'
</script>

<template>
  <section class="home-hero">
    <div class="home-hero-inner">
      <div class="home-hero-grid">
      <div class="home-hero-text">
        <h1 class="home-hero-name">
          The agent&nbsp;platform<br />
          built on&nbsp;<span class="home-hero-accent">sync</span>
        </h1>
        <p class="home-hero-sub">
          <span class="home-hero-sub-primary">
            Agents are long-lived entities in the data&nbsp;layer.
            The&nbsp;substrate for them is a sync&nbsp;engine.
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
            text="Electric Cloud"
            href="/cloud"
          />
          <VPButton
            tag="a"
            size="medium"
            theme="alt"
            text="Quickstart"
            href="/docs/agents/quickstart"
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
  /* 7/5 in favour of the text — gives the headline room to break
     cleanly across two lines ("The agent platform" / "built on sync")
     without squeezing onto three. The iso composition still has enough
     room to read as a supporting illustration. */
  grid-template-columns: 7fr 5fr;
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
  /* Match the primary supporting paragraph size — keeps the two-block
     supporting copy as a single visual stratum below the headline
     instead of tapering into a smaller "punchline" line. */
  font-size: 1.04em;
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

/* On wider screens, tuck the text column a touch further left so the
   headline aligns closer to the section's visual edge and the iso scene
   on the right has a bit more breathing room. */
@media (min-width: 1200px) {
  .home-hero-text {
    margin-left: -16px;
  }
}

/* Intermediate (tablet-ish) widths: keep the side-by-side layout for as
   long as possible, but trim the iso scene so it doesn't dominate the
   text column once the cell narrows. The hero is taller than at full
   width so add a bit more vertical breathing room — matching the
   pattern we use once the scene drops out below 860px. */
@media (max-width: 1099px) and (min-width: 861px) {
  .home-hero {
    padding: 40px 24px 56px;
  }
  .home-hero-grid {
    /* Bias the split further toward the text — the iso scene only needs
       enough room to read as a stacked diagram, while the headline +
       supporting copy benefit from every extra px. */
    grid-template-columns: 8fr 4fr;
    gap: 24px;
  }
  /* Knock the headline down a touch so "The agent platform" still fits
     on one line — at the full 56px the narrower text column was forcing
     a third line in this range. */
  .home-hero-name {
    font-size: 48px;
  }
  .home-hero-scene {
    /* Trim the scene's footprint at this breakpoint so it sits as a
       supporting visual rather than competing with the copy. */
    aspect-ratio: 1 / 1;
    min-height: 300px;
    max-height: 380px;
  }
}

/* Below ~860px the side-by-side layout stops working. Rather than
   stacking the iso scene under the copy (which both pushed the page
   down and gave the scene awkward proportions), just drop it entirely
   and let the copy own the hero. With the scene gone we also need to
   add vertical breathing room — the iso composition was previously
   shaping the hero's height — so the copy gets generous top/bottom
   padding to feel like an intentional hero band rather than a
   collapsed sliver. */
@media (max-width: 860px) {
  .home-hero {
    padding: 56px 24px 64px;
  }
  .home-hero-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }
  .home-hero-scene {
    display: none;
  }
}

@media (max-width: 768px) {
  .home-hero {
    padding: 48px 20px 56px;
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
}

@media (max-width: 480px) {
  .home-hero {
    padding: 40px 20px 48px;
  }
  .home-hero-name {
    font-size: 32px;
  }
  .home-hero-sub {
    font-size: 16px;
  }
}
</style>
