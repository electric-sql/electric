<script lang="ts">
/* Canonical install command for the streams product. Re-exported so
   the bottom CTA strap on the streams landing page (and any other
   surface that wants to render the same evidence) can pull from a
   single source of truth alongside the hero. */
export const installCommand = "npm i @durable-streams/client"
</script>

<script setup lang="ts">
/* Streams landing-page hero — extracted from `StreamsHomePage.vue`
   so the same hero block can be re-rendered headlessly on the
   `/og/streams` social-image route without duplicating markup or
   styling. The two surfaces stay in lockstep: any text or layout
   tweak made here propagates to the live page and the OG capture
   together. */
import { ref } from "vue"
import { VPButton } from "vitepress/theme"
import StreamFlowBg from "./StreamFlowBg.vue"
import InstallPill from "../InstallPill.vue"

withDefaults(
  defineProps<{
    /* paused freezes ambient activity on the rail background: no
       new comet tokens auto-spawn on rails. Existing tokens still
       finish their travel, hover labels still appear, and clicks
       still produce a burst. Used by the OG capture so the
       screenshotted frame is a stable, deterministic still. */
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
    /* extraExcludeRects forwards to `<StreamFlowBg>`. Used by the
       OG capture to reserve the wordmark's bbox in the frame's
       top-left corner so rails never paint under the brand mark. */
    extraExcludeRects?: { left: number; top: number; right: number; bottom: number }[]
  }>(),
  { paused: false, hideActions: false, hideCopy: false, extraExcludeRects: () => [] }
)

const heroInnerRef = ref<HTMLElement>()
</script>

<template>
  <section class="ds-hero">
    <StreamFlowBg
      class="md-exclude"
      :exclude-el="heroInnerRef"
      :paused="paused"
      :extra-exclude-rects="extraExcludeRects"
    />
    <div ref="heroInnerRef" class="ds-hero-inner">
      <h1 class="ds-hero-name">
        Electric&nbsp;<span class="ds-hero-accent">Streams</span>
      </h1>
      <p class="ds-hero-text">
        The data primitive for the agent&nbsp;loop
      </p>

      <div class="ds-hero-install-row">
        <!-- Accent the package name only: every other token (`npm`,
             `i`) renders muted and just `@durable-streams/client`
             picks up the brand colour. Reads lighter than the
             default positional 4-colour palette and points the eye
             at the actual product name in the command. -->
        <InstallPill
          :command="installCommand"
          tone="raised"
          accent="@durable-streams/client"
          :hide-copy="hideCopy"
        />
      </div>

      <div v-if="!hideActions" class="ds-hero-row">
        <VPButton
          tag="a"
          size="medium"
          theme="brand"
          text="Quickstart"
          href="/docs/streams/quickstart"
        />
        <VPButton
          tag="a"
          size="medium"
          theme="alt"
          text="Docs"
          href="/docs/streams"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.ds-hero {
  position: relative;
  /* Bottom padding bumped from 56 → 96 to give the hero (and the
     animated stream-flow background that paints behind it) more room
     to breathe before the first section takes over. Top stays at 72
     so the headline still anchors high on the viewport. */
  padding: 72px 24px 96px;
  text-align: center;
  overflow: hidden;
}

.ds-hero-inner {
  position: relative;
  z-index: 1;
  max-width: 860px;
  margin: 0 auto;
  pointer-events: none;
}
.ds-hero-inner * {
  pointer-events: auto;
}

.ds-hero-name {
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

.ds-hero-accent {
  color: var(--vp-c-brand-1);
  -webkit-text-fill-color: currentColor;
}

.ds-hero-text {
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
.ds-hero-install-row {
  margin-top: 24px;
  display: flex;
  justify-content: center;
}

.ds-hero-row {
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

@media (max-width: 768px) {
  .ds-hero {
    /* Bumped horizontal padding from 20 → 24 for more breathing room
       from the viewport edge on tablets / large phones. Bottom
       padding scales with the desktop bump (40 → 64) so the hero
       still has air below the CTAs at this breakpoint. */
    padding: 56px 24px 64px;
  }
  .ds-hero-name {
    font-size: 36px;
  }
  .ds-hero-text {
    font-size: 22px;
  }
}

@media (max-width: 480px) {
  .ds-hero {
    /* Bumped horizontal padding from 16 → 20 for breathing room.
       Bottom padding scales with the desktop bump (32 → 52). */
    padding: 44px 20px 52px;
  }
  .ds-hero-name {
    font-size: 28px;
  }
  .ds-hero-text {
    font-size: 19px;
  }
  /* Stack the action buttons full-width on the smallest screens so
     they don't wrap awkwardly underneath the install pill. */
  .ds-hero-row {
    flex-direction: column;
    align-items: stretch;
    max-width: 280px;
    margin-left: auto;
    margin-right: auto;
  }
}
</style>
