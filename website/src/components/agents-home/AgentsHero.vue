<script lang="ts">
/* Canonical install command for the agents product. Re-exported so
   the bottom CTA strap on the agents landing page (and any other
   surface that wants to render the same evidence) can pull from a
   single source of truth alongside the hero. */
export const installCommand = 'npx electric-ax agents quickstart'
</script>

<script setup lang="ts">
/* Agents landing-page hero — extracted from `HomePage.vue` so the
   same hero block can be re-rendered headlessly on the
   `/og/agents` social-image route without duplicating markup or
   styling. The two surfaces stay in lockstep: any text or layout
   tweak made here propagates to the live page and the OG capture
   together. */
import { ref } from 'vue'
import { VPButton } from 'vitepress/theme'
import HeroNetworkBg from './HeroNetworkBg.vue'
import InstallPill from '../InstallPill.vue'

withDefaults(
  defineProps<{
    /* paused freezes ambient activity on the network background:
       no random wakes / cascades auto-fire. Existing in-flight
       messages still settle, hover labels still appear, and clicks
       still wake nodes. Used by the OG capture so the screenshotted
       frame is a stable, deterministic still. */
    paused?: boolean
    /* hideActions removes the row of CTA buttons (Quickstart, Docs)
       below the install pill. Set on the OG capture so the social
       graphic shows just the headline + install evidence, not an
       interactive call-to-action that has no meaning on a static
       image. */
    hideActions?: boolean
    /* hideCopy forwards to `<InstallPill>`, switching it from an
       interactive copy-to-clipboard button to a static visual. The
       OG capture sets this so the trailing copy icon doesn't appear
       in the screenshot. */
    hideCopy?: boolean
    /* extraExcludeRects forwards to `<HeroNetworkBg>`. Used by the
       OG capture to reserve the wordmark's bbox in the frame's
       top-left corner so the mesh never paints under the brand mark. */
    extraExcludeRects?: {
      left: number
      top: number
      right: number
      bottom: number
    }[]
  }>(),
  {
    paused: false,
    hideActions: false,
    hideCopy: false,
    extraExcludeRects: () => [],
  }
)

const heroInnerRef = ref<HTMLElement>()
</script>

<template>
  <section class="ea-hero">
    <HeroNetworkBg
      class="md-exclude"
      :exclude-el="heroInnerRef"
      :spawn-rate="0.4"
      :die-rate="0.4"
      :reposition-on-spawn="true"
      :paused="paused"
      :extra-exclude-rects="extraExcludeRects"
    />
    <div ref="heroInnerRef" class="ea-hero-inner">
      <h1 class="ea-hero-name">
        Electric&nbsp;<span class="ea-hero-accent">Agents</span>
      </h1>
      <p class="ea-hero-text">The durable runtime for long-lived&nbsp;agents</p>
      <div class="ea-hero-install-row">
        <InstallPill
          :command="installCommand"
          tone="raised"
          accent="agents"
          :hide-copy="hideCopy"
        />
      </div>

      <div v-if="!hideActions" class="ea-hero-row">
        <VPButton
          tag="a"
          size="medium"
          theme="brand"
          text="Quickstart"
          href="/docs/agents/quickstart"
        />
        <VPButton
          tag="a"
          size="medium"
          theme="alt"
          text="Docs"
          href="/docs/agents/"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.ea-hero {
  position: relative;
  /* Tightened from 100/80 to compensate for the second CTA row
     (install pill + action-button row) so the hero stays roughly the
     same overall height as before the split. */
  padding: 72px 24px 56px;
  text-align: center;
  overflow: hidden;
}

.ea-hero-inner {
  position: relative;
  z-index: 1;
  max-width: 860px;
  margin: 0 auto;
  pointer-events: none;
}
.ea-hero-inner * {
  pointer-events: auto;
}

.ea-hero-name {
  font-size: 56px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
  background: none;
  -webkit-background-clip: border-box;
  background-clip: border-box;
  -webkit-text-fill-color: currentColor;
  color: var(--ea-text-1);
  margin: 0;
  padding-bottom: 4px;
  text-wrap: balance;
}

.ea-hero-accent {
  color: var(--vp-c-brand-1);
  -webkit-text-fill-color: currentColor;
}

.ea-hero-text {
  font-size: 28px;
  font-weight: 500;
  color: var(--ea-text-1);
  margin: 16px auto 30px;
  max-width: 720px;
  line-height: 1.35;
  text-wrap: balance;
}

/* Two-row CTA stack: the install pill always sits on its own line
   above the action buttons so the copyable command reads as a
   distinct affordance rather than a peer of the buttons. */
.ea-hero-install-row {
  margin-top: 24px;
  display: flex;
  justify-content: center;
}

.ea-hero-row {
  margin-top: 14px;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

/* Hero install pill is rendered by the shared `<InstallPill>` component
   in `src/components/InstallPill.vue` — pill chrome, type sizes,
   syntax-highlighting palette and clipboard behaviour all live there. */

/* Mobile: tighten hero padding and scale headline / tagline so the
   hero matches the streams / sync responsive rhythm. Without these the
   56px name overflows narrow viewports and the 100px top padding
   crowds the navbar on phones. */
@media (max-width: 768px) {
  .ea-hero {
    /* Bumped horizontal padding from 20 → 24 for more breathing room
       from the viewport edge on tablets / large phones. */
    padding: 56px 24px 40px;
  }
  .ea-hero-name {
    font-size: 36px;
  }
  .ea-hero-text {
    font-size: 22px;
  }
}

@media (max-width: 480px) {
  .ea-hero {
    /* Bumped horizontal padding from 16 → 20 for breathing room. */
    padding: 44px 20px 32px;
  }
  .ea-hero-name {
    font-size: 28px;
  }
  .ea-hero-text {
    font-size: 19px;
  }
  /* Stack the action buttons full-width on the smallest screens so
     they don't wrap awkwardly underneath the install pill. */
  .ea-hero-row {
    flex-direction: column;
    align-items: stretch;
    max-width: 280px;
    margin-left: auto;
    margin-right: auto;
  }
}
</style>
