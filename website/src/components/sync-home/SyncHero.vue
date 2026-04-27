<script lang="ts">
/* Canonical install command for the sync product. Re-exported so the
   bottom CTA strap on the sync landing page (and any other surface
   that wants to render the same evidence) can pull from a single
   source of truth alongside the hero. */
export const installCommand = "npx @electric-sql/start my-electric-app"
</script>

<script setup lang="ts">
/* Sync landing-page hero — extracted from `SyncHomePage.vue` so the
   same hero block can be re-rendered headlessly on the `/og/sync`
   social-image route without duplicating markup or styling. The two
   surfaces stay in lockstep: any text or layout tweak made here
   propagates to the live page and the OG capture together. */
import { ref } from "vue"
import { VPButton } from "vitepress/theme"
import SyncFanOutBg from "./SyncFanOutBg.vue"
import InstallPill from "../InstallPill.vue"

withDefaults(
  defineProps<{
    /* paused freezes ambient activity on the fan-out background:
       no random update tokens auto-spawn. Existing tokens still
       finish their flight, hover labels still appear, and clicks
       still fire updates. Used by the OG capture so the screenshotted
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
    /* extraExcludeRects forwards to `<SyncFanOutBg>`. Used by the
       OG capture to reserve the wordmark's bbox in the frame's
       top-left corner so the canvas geometry never paints under
       the brand mark. */
    extraExcludeRects?: { left: number; top: number; right: number; bottom: number }[]
  }>(),
  { paused: false, hideActions: false, hideCopy: false, extraExcludeRects: () => [] }
)

const heroInnerRef = ref<HTMLElement>()
</script>

<template>
  <section class="sh-hero">
    <SyncFanOutBg
      class="md-exclude"
      :exclude-el="heroInnerRef"
      :labels-on-hover="true"
      :spawn-rate="0.15"
      :die-rate="0.15"
      :paused="paused"
      :extra-exclude-rects="extraExcludeRects"
    />
    <div ref="heroInnerRef" class="sh-hero-inner">
      <h1 class="sh-hero-name">
        Electric&nbsp;<span class="sh-hero-accent">Sync</span>
      </h1>
      <p class="sh-hero-text">
        Composable sync primitives for multi-agent&nbsp;systems
      </p>

      <div class="sh-hero-install-row">
        <!-- Single-accent highlighting to match the agents and
             streams hero pills: every other token (`npx`, the
             `my-electric-app` placeholder name) renders muted and
             only `@electric-sql/start` — the actual Electric
             package — picks up the brand colour. -->
        <InstallPill
          :command="installCommand"
          tone="raised"
          accent="@electric-sql/start"
          :hide-copy="hideCopy"
        />
      </div>

      <div v-if="!hideActions" class="sh-hero-row">
        <VPButton
          tag="a"
          size="medium"
          theme="brand"
          text="Quickstart"
          href="/docs/sync/quickstart"
        />
        <VPButton
          tag="a"
          size="medium"
          theme="alt"
          text="Docs"
          href="/docs/sync"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.sh-hero {
  position: relative;
  padding: 80px 24px 72px;
  text-align: center;
  overflow: hidden;
}

.sh-hero-inner {
  position: relative;
  z-index: 1;
  max-width: 880px;
  margin: 0 auto;
  pointer-events: none;
}
.sh-hero-inner > * {
  pointer-events: auto;
}

.sh-hero-name {
  font-size: 56px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: var(--ea-text-1);
  margin: 0;
  padding-bottom: 4px;
  text-wrap: balance;
}

.sh-hero-accent {
  color: var(--vp-c-brand-1);
}

.sh-hero-text {
  font-size: 28px;
  font-weight: 500;
  color: var(--ea-text-1);
  margin: 16px auto 32px;
  max-width: 720px;
  line-height: 1.35;
  text-wrap: balance;
}

/* Two-row CTA stack mirroring the Agents hero: the copyable install
   pill always sits on its own line above the Quickstart / Docs
   buttons so it reads as a distinct, scannable affordance rather
   than a peer of the buttons. */
.sh-hero-install-row {
  margin-top: 24px;
  display: flex;
  justify-content: center;
}

.sh-hero-row {
  margin-top: 14px;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

@media (max-width: 768px) {
  .sh-hero {
    padding: 56px 24px 48px;
  }
  .sh-hero-name { font-size: 36px; }
  .sh-hero-text { font-size: 22px; }
}

@media (max-width: 480px) {
  .sh-hero {
    padding: 44px 20px 36px;
  }
  .sh-hero-name { font-size: 28px; }
  .sh-hero-text { font-size: 19px; }

  .sh-hero-row {
    flex-direction: column;
    align-items: stretch;
    max-width: 280px;
    margin-left: auto;
    margin-right: auto;
  }
}
</style>
