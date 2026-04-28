<script setup>
import { onMounted, onUnmounted, ref } from 'vue'

import MarkdownContent from '../../MarkdownContent.vue'
import MdExportExplicit from '../../MdExportExplicit.vue'
import { useMarkdownExport } from '../../../lib/useMarkdownExport'

/* WhyLoopsSection — "Managed agents without the lock-in" strap.

   Sits between the hero and the product panels as the unfold of
   the hero's claim ("Electric is the first agent platform built
   on sync"). The 28 Apr review call landed on a single centred
   proposition — managed agents without the lock-in — and the
   "without the lock-in" qualifier carries the model / compute /
   stack-portability point so the cards can stay focused on what
   you *get* from the managed side.

   Cards stay deliberately close to the Claude managed-agents
   reference copy (`claude.com/blog/claude-managed-agents`) that
   came up in review feedback — short noun-phrase title + a
   single concrete sentence, with the technical framing kept off
   the homepage. The eyebrows map back to the 28 Apr call's
   data wiring · communication · collaboration triple:
     1. Data wiring      →  Long-lived logical agents.
     2. Business systems →  Integrate AI coworkers.
     3. Collaboration    →  Multi-agent collaboration.

   No SVG / no animation beyond a soft reveal-on-scroll, so the
   band reads as a clean typographic beat between the hero
   composition and the noisier product sections below.

   `dark` swaps the band's background between the page's default
   surface (`--ea-bg`) and the alt surface (`--ea-surface-alt`)
   so callers can slot the strap into either side of the
   homepage's L/D alternation. The cards always sit on the
   "other" surface — they're the lit foreground tile against
   whichever band background is in play — so the contrast
   between band and card stays consistent in both variants. */

defineProps({
  dark: { type: Boolean, default: false },
})

const sectionRef = ref()
const isRevealed = ref(false)
let observer = null
const isMarkdownExport = useMarkdownExport()

const head = {
  title: 'Managed agents without the lock-in',
}

const cards = [
  {
    eyebrow: 'Data wiring',
    title: 'Long-lived logical agents',
    body: 'Deploy long-running, durable agents that scale to zero.',
  },
  {
    eyebrow: 'Business systems',
    title: 'Integrate AI coworkers',
    body: 'Integrate agents into your existing teams and systems.',
  },
  {
    eyebrow: 'Collaboration',
    title: 'Multi-agent collaboration',
    body: 'Scale out multi-user, multi-agent systems with humans in the loop.',
  },
]

const markdown = `## ${head.title}

${cards
  .map((c) => `### ${c.title} (${c.eyebrow})\n\n${c.body}`)
  .join('\n\n')}`

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
  if (sectionRef.value) observer.observe(sectionRef.value)
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
    ref="sectionRef"
    :class="['why-loops', { revealed: isRevealed, 'why-loops--alt': dark }]"
  >
    <div class="why-loops-inner">
      <div class="why-loops-head">
        <h2 class="why-loops-title">{{ head.title }}</h2>
      </div>
      <div class="why-loops-grid">
        <article
          v-for="(card, i) in cards"
          :key="card.title"
          class="why-card"
          :style="{ '--reveal-delay': `${i * 60}ms` }"
        >
          <div class="why-card-eyebrow mono">
            <span class="dot" aria-hidden="true"></span>
            <span>{{ card.eyebrow }}</span>
          </div>
          <h3 class="why-card-title">{{ card.title }}</h3>
          <p class="why-card-body">{{ card.body }}</p>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.why-loops {
  position: relative;
  padding: 96px 24px;
  background: var(--ea-bg);
  border-bottom: 1px solid var(--ea-divider);
  isolation: isolate;
  overflow: hidden;
}
/* Alt-surface variant — band sits on the lighter alt surface so
   the cards (which always render on the "other" surface) flip to
   `--ea-bg`. Keeps the contrast between band and card consistent
   in either L/D position. */
.why-loops--alt {
  background: var(--ea-surface-alt);
}

/* Subtle brand-tint wash from the top edge — same pattern as the
   CTA straps so the band reads as a deliberate full-bleed beat
   rather than a plain page colour. Centred high so the headline
   sits in the warmest part of the wash and the cards below cool
   back to the band base. */
.why-loops::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse 70% 90% at 50% 0%,
    color-mix(in srgb, var(--vp-c-brand-1) 6%, transparent) 0%,
    transparent 55%
  );
  z-index: -1;
  opacity: 0.7;
}
.why-loops--alt::before {
  background: radial-gradient(
    ellipse 70% 90% at 50% 0%,
    color-mix(in srgb, var(--vp-c-brand-1) 10%, transparent) 0%,
    transparent 55%
  );
}

.why-loops-inner {
  max-width: 1152px;
  margin: 0 auto;
}

.why-loops-head {
  max-width: 720px;
  margin: 0 auto 48px;
  text-align: center;
  opacity: 0;
  transform: translateY(20px);
  transition:
    opacity 0.6s ease-out,
    transform 0.6s ease-out;
}
.why-loops.revealed .why-loops-head {
  opacity: 1;
  transform: translateY(0);
}

.why-loops-title {
  font-size: 38px;
  /* Same step-down from the hero (700) as the other strap titles
     (NoSilos, ManagedCloud, AgentsCTA, …) so this band sits in
     the established type hierarchy. */
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.015em;
  color: var(--ea-text-1);
  margin: 0;
  text-wrap: balance;
}

.why-loops-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  align-items: stretch;
}

.why-card {
  display: flex;
  flex-direction: column;
  background: var(--ea-surface-alt);
  border: 1px solid var(--ea-divider);
  border-radius: 14px;
  padding: 28px 28px 32px;
  /* Stagger the cards in on reveal — `--reveal-delay` is set
     per-card in the template so each card animates ~60ms after
     the one before it. */
  opacity: 0;
  transform: translateY(20px);
  transition:
    opacity 0.6s ease-out var(--reveal-delay, 0ms),
    transform 0.6s ease-out var(--reveal-delay, 0ms),
    border-color 0.2s ease-out;
}
.why-loops.revealed .why-card {
  opacity: 1;
  transform: translateY(0);
}
/* Cards always sit on the *other* surface from the band. When
   the band is on its alt surface we flip the cards back to
   `--ea-bg` so the surface contrast is preserved. */
.why-loops--alt .why-card {
  background: var(--ea-bg);
}
.why-card:hover {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 35%, var(--ea-divider));
}

.why-card-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vp-c-brand-1);
  /* Matches the eyebrow→title gap to the title→body gap below
     so the three rows step down through the card with a single
     consistent rhythm. */
  margin-bottom: 10px;
}
.why-card-eyebrow .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}

.why-card-title {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.01em;
  color: var(--ea-text-1);
  margin: 0 0 10px;
}
.why-card-body {
  font-size: 15px;
  line-height: 1.6;
  color: var(--ea-text-2);
  margin: 0;
}

@media (max-width: 960px) {
  .why-loops-grid {
    /* Tablet: keep 2-up + a full-width tail card so the layout
       still reads as a grid rather than a pure stack. The third
       card spans the row and re-centres so the band closes
       symmetrically. */
    grid-template-columns: repeat(2, 1fr);
  }
  .why-card:nth-child(3) {
    grid-column: 1 / -1;
    max-width: 520px;
    margin-left: auto;
    margin-right: auto;
  }
}

@media (max-width: 768px) {
  .why-loops {
    padding: 72px 20px;
  }
  .why-loops-head {
    margin-bottom: 32px;
  }
  .why-loops-title {
    font-size: 30px;
  }
}

@media (max-width: 600px) {
  .why-loops-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .why-card:nth-child(3) {
    max-width: none;
  }
  .why-card {
    padding: 24px 24px 28px;
  }
}

@media (max-width: 480px) {
  .why-loops {
    padding: 56px 16px;
  }
  .why-loops-title {
    font-size: 26px;
  }
}
</style>
