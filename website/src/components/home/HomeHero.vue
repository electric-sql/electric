<script setup lang="ts">
import { ref } from 'vue'
import { VPButton } from 'vitepress/theme'

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
      <div class="home-hero-text">
        <p class="home-hero-eyebrow">
          Open source · Apache 2.0
        </p>
        <h1 class="home-hero-name">
          The agent platform
          built on&nbsp;<span class="home-hero-accent">sync</span>
        </h1>
        <p class="home-hero-sub">
          Agents are long-lived entities that live in the data layer.
          The substrate for them is a sync&nbsp;engine.
          <br /><br />
          Electric is the first agent platform built on&nbsp;sync.
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
        <div class="home-hero-placeholder" aria-label="Homepage hero graphic placeholder">
          TBD
        </div>
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
}

.home-hero-placeholder {
  position: absolute;
  inset: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--vp-c-divider);
  border-radius: 16px;
  background: transparent;
  color: var(--ea-text-3);
  font-family: var(--vp-font-family-mono);
  font-size: 18px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
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
