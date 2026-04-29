<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

import MarkdownContent from '../../MarkdownContent.vue'
import MdExportExplicit from '../../MdExportExplicit.vue'
import { useMarkdownExport } from '../../../lib/useMarkdownExport'
import StreamBanner from '../StreamBanner.vue'

/* AgentsCTAStrap — final full-bleed strap on the homepage. Drives
   readers towards the Electric Agents landing page and quickstart so
   the page closes with a single, focused next step. Visual language
   matches the other straps (NoSilosStrap, ManagedCloudStrap) for
   consistency, but with a slightly more emphatic gradient to mark
   the page-close. The shared `StreamBanner` runs flush along the
   bottom edge of the strap as the page's closing visual flourish. */

const stripRef = ref()
const isRevealed = ref(false)
let observer = null
const isMarkdownExport = useMarkdownExport()
const strap = {
  eyebrow: 'Build with Electric',
  title: 'Bring your agents online',
  actions: [
    { text: 'Electric Agents', href: '/agents', theme: 'brand' },
    { text: 'Quickstart', href: '/docs/agents/quickstart', theme: 'alt' },
  ],
}
const markdown = `## ${strap.title}

[${strap.actions[0].text}](${strap.actions[0].href}) [${strap.actions[1].text}](${strap.actions[1].href})`

onMounted(() => {
  observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        isRevealed.value = true
        observer?.disconnect()
      }
    },
    { threshold: 0.1 }
  )
  if (stripRef.value) observer.observe(stripRef.value)
})

onUnmounted(() => {
  observer?.disconnect()
})
</script>

<template>
  <MdExportExplicit v-if="isMarkdownExport">
    <MarkdownContent>{{ markdown }}</MarkdownContent>
  </MdExportExplicit>
  <section
    v-else
    ref="stripRef"
    :class="['ac-strap', { revealed: isRevealed }]"
  >
    <div class="ac-inner">
      <div class="ac-eyebrow mono">
        <span class="dot"></span>
        {{ strap.eyebrow }}
      </div>
      <h2 class="ac-title">
        {{ strap.title }}
      </h2>
      <div class="ac-actions">
        <VPButton
          v-for="action in strap.actions"
          :key="action.href"
          tag="a"
          size="medium"
          :theme="action.theme"
          :text="action.text"
          :href="action.href"
        />
      </div>
    </div>
    <StreamBanner class="ac-banner" />
  </section>
</template>

<style scoped>
/* Horizontal padding lives on `.ac-inner` rather than the strap
   so the trailing `StreamBanner` can run edge-to-edge along the
   strap's bottom border. The strap retains generous top padding
   for the eyebrow/title/CTA block, and a smaller bottom padding
   so the banner has visible breathing room beneath it before
   the strap's bottom border closes the page. Without that
   bottom padding the silhouettes sit pinned to the border line
   and the page closes on a cramped seam. */
.ac-strap {
  position: relative;
  padding: 96px 0 56px;
  background: var(--ea-surface-alt);
  border-bottom: 1px solid var(--ea-divider);
  isolation: isolate;
  overflow: hidden;
}
.ac-strap::before {
  /* Soft brand-tint wash — kept deliberately faint so the
     "Quickstart" alt-themed button still reads with comfortable
     contrast against the strap. The earlier 9% mix at 0.85
     opacity tinted the whole band brightly enough that the
     button's pale background blended into the wash; halving the
     mix and trimming the opacity restores the contrast while
     still hinting at the brand colour behind the headline. */
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse 80% 100% at 50% 50%,
    color-mix(in srgb, var(--vp-c-brand-1) 5%, transparent) 0%,
    transparent 60%
  );
  z-index: -1;
  opacity: 0.65;
}

.ac-inner {
  max-width: 720px;
  margin: 0 auto;
  padding: 0 24px;
  text-align: center;
  opacity: 0;
  transform: translateY(20px);
  transition:
    opacity 0.6s ease-out,
    transform 0.6s ease-out;
}
.ac-strap.revealed .ac-inner {
  opacity: 1;
  transform: translateY(0);
}

/* The closing stream banner runs flush to the strap's bottom
   border (no margin below) and sits above the strap's ::before
   gradient because it's just a default-z-index sibling above
   the negative-z gradient layer. */
.ac-banner {
  margin-top: 64px;
}

.ac-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ea-text-3);
  padding: 4px 10px;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 999px;
  margin-bottom: 22px;
}
.ac-eyebrow .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}

.ac-title {
  font-size: 42px;
  font-weight: 600;
  line-height: 1.12;
  letter-spacing: -0.015em;
  color: var(--ea-text-1);
  margin: 0;
  max-width: 620px;
  margin-left: auto;
  margin-right: auto;
  text-wrap: balance;
}
.ac-tagline {
  font-family: var(--vp-font-family-base);
  font-size: 17px;
  line-height: 1.6;
  color: var(--ea-text-2);
  margin: 16px auto 0;
  max-width: 520px;
}
.ac-tagline a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
  border-bottom: 1px solid
    color-mix(in srgb, var(--vp-c-brand-1) 35%, transparent);
}
.ac-tagline a:hover {
  border-bottom-color: var(--vp-c-brand-1);
}

.ac-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 32px;
}

@media (max-width: 768px) {
  .ac-strap {
    padding: 72px 0 44px;
  }
  .ac-inner {
    padding: 0 20px;
  }
  .ac-title {
    font-size: 32px;
  }
  .ac-tagline {
    font-size: 15px;
  }
  .ac-banner {
    margin-top: 48px;
  }
}
@media (max-width: 480px) {
  .ac-strap {
    padding: 56px 0 36px;
  }
  .ac-inner {
    padding: 0 16px;
  }
  .ac-title {
    font-size: 26px;
  }
  .ac-actions {
    flex-direction: column;
    align-self: stretch;
    max-width: 280px;
    margin-left: auto;
    margin-right: auto;
  }
  .ac-banner {
    margin-top: 40px;
  }
}
</style>
