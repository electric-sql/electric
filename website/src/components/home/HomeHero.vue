<script setup lang="ts">
import { ref } from 'vue'
import { VPButton } from 'vitepress/theme'
import HomeIsoBg from './HomeIsoBg.vue'
import HomeIsoLegend from './HomeIsoLegend.vue'
import type { Substrate } from './iso/types'

const heroTextRef = ref<HTMLElement>()

// Active legend filter — drives the iso scene's per-substrate alpha.
// `null` = show everything (default).
const activeFilter = ref<Substrate | null>(null)
const hoverFilter = ref<Substrate | null>(null)
// Hover takes precedence over active for smooth previewing.
const effectiveFilter = ref<Substrate | null>(null)
function recompute() {
  effectiveFilter.value = hoverFilter.value ?? activeFilter.value
}
function onLegendChange(v: Substrate | null) {
  activeFilter.value = v
  recompute()
}
function onLegendHover(v: Substrate | null) {
  hoverFilter.value = v
  recompute()
}

const installCopied = ref(false)
function copyInstall() {
  navigator.clipboard.writeText('npx @electric-sql/start my-app')
  installCopied.value = true
  setTimeout(() => {
    installCopied.value = false
  }, 2000)
}
</script>

<template>
  <section class="home-hero">
    <div class="home-hero-inner">
      <div class="home-hero-grid">
      <div ref="heroTextRef" class="home-hero-text">
        <p class="home-hero-eyebrow">
          Open source · Apache 2.0
        </p>
        <h1 class="home-hero-name">
          The data&nbsp;platform<br />
          for <span class="home-hero-underline">multi-agent</span>
        </h1>
        <p class="home-hero-sub">
          Sync, streams and agents — the composable primitives underneath
          collaborative business&nbsp;software.
        </p>
        <div class="home-hero-actions">
          <div class="home-hero-install" @click="copyInstall">
            <span class="home-hero-install-text">
              <span class="home-hero-install-prompt">$</span>
              npx&nbsp;@electric-sql/start&nbsp;my-app
            </span>
            <span class="home-hero-install-copy" :class="{ copied: installCopied }">
              <svg
                v-if="!installCopied"
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
              <svg
                v-else
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          </div>
          <VPButton
            tag="a"
            size="medium"
            theme="alt"
            text="GitHub"
            href="https://github.com/electric-sql/electric"
          />
        </div>
      </div>
      <div class="home-hero-scene">
        <ClientOnly>
          <HomeIsoBg
            crop="world"
            :exclude-el="heroTextRef"
            :auto-start="true"
            :filter="effectiveFilter"
            :zoom="1.35"
            :bleed="{ top: 0.08, right: 0.35, bottom: 0.18, left: 0.05 }"
            feather
          />
          <div class="home-hero-legend">
            <HomeIsoLegend
              :active="activeFilter"
              @update:active="onLegendChange"
              @hover="onLegendHover"
            />
          </div>
        </ClientOnly>
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
  overflow: hidden;
  border-bottom: 1px solid var(--vp-c-divider);
}

.home-hero-inner {
  max-width: 1280px;
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
  font-weight: 800;
  line-height: 1.05;
  letter-spacing: -0.02em;
  background: var(--vp-home-hero-name-background);
  -webkit-background-clip: text;
  background-clip: text;
  color: var(--vp-home-hero-name-color);
  margin: 0;
  padding-bottom: 4px;
}

.home-hero-underline {
  text-decoration: underline;
  text-decoration-color: var(--vp-c-brand-1);
  text-underline-offset: 0.1em;
  text-decoration-thickness: 0.135em;
}

.home-hero-sub {
  font-size: 20px;
  font-weight: 500;
  color: var(--ea-text-1);
  margin: 22px 0 0;
  line-height: 1.4;
}

.home-hero-actions {
  margin-top: 32px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.home-hero-install {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--ea-surface-alt);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s;
  user-select: none;
}
.home-hero-install:hover {
  border-color: var(--vp-c-brand-1);
}
.home-hero-install-text {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  color: var(--ea-text-1);
  letter-spacing: -0.01em;
}
.home-hero-install-prompt {
  color: var(--ea-text-2);
  margin-right: 6px;
}
.home-hero-install-copy {
  color: var(--ea-text-2);
  display: flex;
  transition: color 0.2s;
}
.home-hero-install-copy.copied {
  color: var(--vp-c-brand-1);
}

.home-hero-scene {
  position: relative;
  width: 100%;
  aspect-ratio: 5 / 4;
  min-height: 420px;
  max-height: 620px;
  /* No `overflow: hidden` here — the iso canvas uses `bleed` to extend
     past this slot. The page-level `.home-hero` band still clips
     anything that would push outside the viewport. */
}

.home-hero-legend {
  position: absolute;
  /* Centred horizontally within the scene cell (the right column of
     the grid), not across the full hero. */
  left: 50%;
  transform: translateX(-50%);
  bottom: 12px;
  z-index: 2;
}

@media (max-width: 768px) {
  .home-hero-legend {
    bottom: 8px;
  }
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
