<script setup lang="ts">
import { VPButton } from 'vitepress/theme'

import MarkdownContent from '../MarkdownContent.vue'
import MdExportExplicit from '../MdExportExplicit.vue'
import { useMarkdownExport } from '../../lib/useMarkdownExport'
import HomeCompositionHero from './HomeCompositionHero.vue'

withDefaults(
  defineProps<{
    /* paused freezes ambient activity on the iso-stack composition
       (sync / streams / agents canvases). Used by the OG capture so
       the screenshotted frame is a stable, deterministic still. */
    paused?: boolean
    /* hideActions removes the row of CTA buttons (Electric Cloud,
       Quickstart) below the headline copy. Set on the OG capture so
       the social graphic shows just the headline + supporting copy +
       iso composition, not interactive CTAs that have no meaning on
       a static image. */
    hideActions?: boolean
  }>(),
  { paused: false, hideActions: false }
)

const isMarkdownExport = useMarkdownExport()
const hero = {
  titleLeading: 'The agent platform',
  titlePrefix: 'built on',
  titleAccent: 'sync',
  markdownTitle: 'Electric: The agent platform built on sync',
  paragraphs: [
    'Agents are long-lived entities in the data layer. The substrate for them is a sync\u00A0engine.',
    'Electric is the first agent platform built on\u00A0sync.',
  ],
  /* Three top-level entry points into the platform — one button
     per product landing page. `Agents` carries the brand theme as
     the lead CTA (the rest of the page closes on the same Agents
     CTA in `AgentsCTAStrap`); `Streams` and `Sync` are alt-themed
     so the trio reads as "primary + two equally-weighted
     secondaries". */
  actions: [
    { text: 'Agents', href: '/agents', theme: 'brand' },
    { text: 'Streams', href: '/streams', theme: 'alt' },
    { text: 'Sync', href: '/sync', theme: 'alt' },
  ],
}
const heroMarkdown = `# ${hero.markdownTitle}

${hero.paragraphs[0]}

${hero.paragraphs[1]}

${hero.actions.map((a) => `[${a.text}](${a.href})`).join(' ')}`
</script>

<template>
  <MdExportExplicit v-if="isMarkdownExport">
    <MarkdownContent>{{ heroMarkdown }}</MarkdownContent>
  </MdExportExplicit>
  <section v-else class="home-hero">
    <div class="home-hero-inner">
      <div class="home-hero-grid">
        <div class="home-hero-text">
          <h1 class="home-hero-name">
            {{ hero.titleLeading }}<br />
            {{ hero.titlePrefix }}&nbsp;<span class="home-hero-accent">{{
              hero.titleAccent
            }}</span>
          </h1>
          <p class="home-hero-sub">
            <span class="home-hero-sub-primary">
              {{ hero.paragraphs[0] }}
            </span>
            <br /><br />
            <span class="home-hero-sub-secondary">
              {{ hero.paragraphs[1] }}
            </span>
          </p>
          <div v-if="!hideActions" class="home-hero-actions">
            <VPButton
              v-for="action in hero.actions"
              :key="action.href"
              tag="a"
              size="medium"
              :theme="action.theme"
              :text="action.text"
              :href="action.href"
            />
          </div>
        </div>
        <div class="home-hero-scene md-exclude">
          <HomeCompositionHero :paused="paused" />
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
  /* Cap the headline so it never tries to use more horizontal space
     than is needed to carry the two intended lines. Without this, at
     intermediate widths the heading column was wide enough that
     "The agent platform" would intermittently break into "The /
     agent platform" before the next breakpoint kicked in. The cap
     forces a stable line-break shape across the whole side-by-side
     range. */
  max-width: 600px;
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
  /* Mirror the headline cap so the supporting copy stays at a
     comfortable measure (~50–60ch) once the iso scene drops out
     and the text column otherwise expands to fill the full row. */
  max-width: 560px;
}

.home-hero-sub-primary {
  font-size: 1.04em;
}

.home-hero-sub-secondary {
  /* Match the primary supporting paragraph size — keeps the two-block
     supporting copy as a single visual stratum below the headline
     instead of tapering into a smaller "punchline" line. The colour
     intentionally stays at full text-1 (not the muted text-2) because
     this is the headline's punchline and should read as strongly as
     the primary line above it. */
  font-size: 1.04em;
  color: var(--ea-text-1);
  /* Hold the punchline on a single line at tablet+ widths — the
     line is short enough (~50ch) to fit comfortably inside the
     hero text column at desktop, and at tablet (480px column,
     861–1199) the marginal overhang past the column cap reads as
     intentional emphasis rather than a wrap. The mobile-stacked
     ≤860 rule below resets it to normal wrapping so the line
     re-flows once the column collapses to the gutter. */
  white-space: nowrap;
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

/* Tablet shared (≈861–1199): swap the fr-based 7fr/5fr (or 8fr/4fr)
   split for a fixed-width text column + flex scene cell. The fr-based
   layouts tied the scene cell to a fraction of the grid width, so as
   the viewport narrowed the scene cell collapsed to the right edge of
   the hero — but the headline's visible text only takes ~457px of its
   column even at the widest tablet sizes, leaving a large empty gap
   *inside* the text column that visually stranded the iso
   composition against the page's right edge. Capping the text column
   at 480px (just above the headline's natural wrap point) keeps the
   headline shape stable while giving the scene cell a much wider
   footprint, which pulls the iso composition's centre closer to the
   centre of the hero's right portion (between the headline's right
   edge and the viewport's right edge). Gap is unified to 24px across
   both tablet sub-ranges.

   The scene cell additionally gets a small leftward translate so the
   iso's *visual* centre lands closer to the midpoint between the
   headline's natural right edge (~480px) and the page's right edge,
   rather than the geometric midpoint of the scene cell (which sits a
   touch right of that — the rotated iso bands extend further right
   than the cell's nominal right boundary, while the cell's left side
   has the wide text column padding it). 24px gives a balanced look
   without the iso visibly drifting past the right edge of its
   column. */
@media (max-width: 1199px) and (min-width: 861px) {
  .home-hero-grid {
    grid-template-columns: 480px 1fr;
    gap: 24px;
  }
  .home-hero-scene {
    transform: translateX(-24px);
  }
}

/* Medium (≈1000–1199): step the headline down a notch so it never
   drifts into a "The / agent platform" break, and trim the iso
   scene's max footprint a touch. The scene stays at the wider 5/4
   aspect at this range — collapsing it to a square here was causing
   the graphic to feel disproportionately small relative to the copy
   block. (The grid template itself is set in the shared tablet rule
   above.) */
@media (max-width: 1199px) and (min-width: 1000px) {
  .home-hero-name {
    font-size: 48px;
  }
  .home-hero-scene {
    aspect-ratio: 5 / 4;
    min-height: 380px;
    max-height: 520px;
  }
}

/* Compact (≈861–999): collapse the iso scene to a square,
   supporting-illustration size. This is the narrowest range where
   the scene still reads as a distinct three-layer stack beside the
   copy. (The grid template itself is set in the shared tablet rule
   above.) */
@media (max-width: 999px) and (min-width: 861px) {
  .home-hero {
    /* The iso scene is taller than the copy at this width, so add
       generous top padding so the headline doesn't crowd the navbar
       once the layout tightens. Bumped from 40px to make the scene
       feel anchored at ~959 specifically. */
    padding: 56px 24px 56px;
  }
  .home-hero-name {
    font-size: 48px;
  }
  .home-hero-scene {
    aspect-ratio: 1 / 1;
    min-height: 320px;
    max-height: 400px;
  }
}

/* Mobile-stacked (≤860): rather than a small icon-sized graphic, the
   iso scene goes BIG — it's rendered larger than the viewport itself,
   bleeding off the top, left and right edges. The bleed is aggressive
   on the top axis: only the lower-front strip of the scene stays on
   screen, where the iso composition's labelled layers concentrate
   their visual mass.

   Sizing summary:
     scene width   W = 140vw
     scene height  H = 140vw  (aspect 1/1)
     side bleed    = 20vw per side  (visible width 100vw)
     top bleed     = 100vw          (visible height 40vw)

   With this aggressive top bleed the visible window is a 100vw ×
   40vw rectangle at the top of the hero, so the iso composition's
   stage and Z-spread inside `HomeCompositionHero.vue` are tuned
   specifically to land inside that window — the stage is anchored
   *near* (not at) the scene's bottom, and the Z-spread is
   compressed so all three labelled bands fit in the 40vw visible
   strip rather than getting bled off above it. */
@media (max-width: 860px) {
  .home-hero {
    /* Top padding goes to 0 so the bled scene can hug the navbar.
       The horizontal padding stays so the *text* respects the page
       gutter — the scene escapes those gutters via its own
       wider-than-viewport width and viewport-relative margins below.
       `overflow: visible` (inherited from base) is critical: it lets
       the scene's negative margin-top render *above* the hero's top
       edge so the navbar can visually crop it. The Layout's
       `overflow-x: clip` (set in `custom.css`) is what prevents
       horizontal scrolling from the side bleeds without turning
       the page into a scroll container, so the upward bleed isn't
       clipped by an ancestor before it reaches the viewport top. */
    padding: 0 24px 48px;
  }
  .home-hero-grid {
    /* Switch from grid to flex column at mobile. CSS Grid's
       auto-track sizing interacts awkwardly with negative margins
       on items (browsers vary on whether the track shrinks to fit
       the outer-margin-box or stays at content size, which can
       leave a visible gap below the bled scene). Flex column
       reliably places the next item right after the bled scene's
       outer-end, which is what we want here. */
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .home-hero-scene {
    display: block;
    order: -1;
    /* 140vw width — wider than the viewport so the scene bleeds 20vw
       past each side. The negative inline margins use the standard
       "wider-than-100vw bleed inside a padded container" trick:
       margin-left = 50% (centre of parent) − 70vw (half scene width)
       puts the scene's left edge 20vw past the viewport's left edge,
       independent of the section's horizontal padding.

       Height is set explicitly (140vw, square footprint) rather than
       via `aspect-ratio: 1/1 + height: auto`. Both should produce the
       same result, but the explicit height avoids a Chromium quirk
       where an aspect-ratio-derived height occasionally collapses to
       0 inside a flex column with negative margin-top on the same
       item — which was making the bleed silently no-op. */
    width: 140vw;
    height: 140vw;
    margin-left: calc(50% - 70vw);
    margin-right: calc(50% - 70vw);
    aspect-ratio: auto;
    min-height: 0;
    /* Don't constrain height — combined with `width: 140vw` and the
       1/1 footprint, a max-height would crop the iso layers. */
    max-height: none;
    /* Aggressive top bleed: the scene sits 100vw above its
       natural position, leaving only the lower ~40vw strip of the
       scene visible inside the hero — see the sizing summary
       above. The iso composition's stage anchor and Z-spread in
       `HomeCompositionHero.vue` are tuned to land the labelled
       bands inside that 40vw visible strip.

       For the bleed to be *visible* off the top of the screen, the
       mobile navbar needs to be transparent so the iso scene shows
       through behind the logo / hamburger (the scene stays at the
       base `z-index: 2`, below the navbar's z-index of 30, so the
       navbar elements stay tappable on top of it). That mobile
       navbar transparency rule is in `custom.css` under
       `.home-page .VPNavBar` — without it, the opaque mobile
       navbar crops the bleed at its bottom edge and the bleed
       effect disappears. */
    margin-top: -100vw;
    margin-bottom: 0;
    /* Restored to full opacity — the scene is the visual anchor at
       the top of the page rather than a supporting illustration. */
    opacity: 1;
  }
  .home-hero-text {
    /* Centre the constrained copy block under the bled scene above,
       and add a tight top margin so the headline sits just under the
       scene's visible lower edge. */
    margin: 16px auto 0;
  }
  /* Keep the headline at the same 48px used at the medium/compact
     widths above instead of letting it jump back up to the base
     56px once the scene falls away. */
  .home-hero-name {
    font-size: 48px;
  }
  /* Once the text column collapses to the gutter the punchline
     can no longer fit on a single line; let it re-flow normally. */
  .home-hero-sub-secondary {
    white-space: normal;
  }
}

/* Between the stacked-tablet and larger-phone ranges, lift the bled
   composition a touch further so it sits slightly closer to the navbar
   before the narrower-phone typography rules take over below 500px. */
@media (max-width: 860px) and (min-width: 501px) {
  .home-hero-scene {
    margin-top: -112vw;
  }
  .home-hero-text {
    margin-top: 22px;
  }
}

@media (max-width: 860px) and (min-width: 701px) {
  .home-hero-scene {
    transform: translateY(-18px);
  }
}

@media (max-width: 768px) {
  .home-hero {
    padding: 0 20px 48px;
  }
  /* Step the headline down a notch at narrow phones — 48px crowds
     the column once the gutter shrinks. */
  .home-hero-name {
    font-size: 44px;
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
    padding: 0 20px 40px;
  }
  .home-hero-name {
    font-size: 36px;
  }
  .home-hero-sub {
    font-size: 16px;
  }
}

@media (max-width: 370px) {
  .home-hero-name {
    font-size: clamp(28px, 9.2vw, 34px);
  }
}
</style>
