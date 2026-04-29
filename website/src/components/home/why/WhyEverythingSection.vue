<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import MarkdownContent from '../../MarkdownContent.vue'
import MdExportExplicit from '../../MdExportExplicit.vue'
import { useMarkdownExport } from '../../../lib/useMarkdownExport'

/* WhyEverythingSection — alternative thesis-strap framing built
   around the "Everything you need for multi-{X} collaboration"
   headline. The rotator sits *inside* the sentence (with text
   on both sides), which means we have to keep both the prefix
   and the suffix visually anchored to the active word as it
   changes. The architecture is:

     1. The rotator container is sized to the *default* cycle
        word (`cycle[0]` — "agent", the first word in the
        cycle and the mid-width of the three). Its in-flow
        `.rotator-spacer` carries that word's text (visibility
        hidden) which fixes both the rotator's intrinsic width
        *and* its text baseline. Sizing to the default word
        (rather than the widest) means that on first paint the
        sentence already lays out exactly as it will when the
        active word is the default, so there's no width-jump
        or initial transform animation when measurements settle
        in. Wider cycle words ("device") overflow the rotator
        horizontally — that overflow is allowed by replacing
        the reel window's `overflow: hidden` with a `clip-path:
        inset(0 -100px)` that clips vertically only.

     2. The trailing " collaboration" is wrapped in an inline
        -block `.title-suffix` and given a CSS `transform:
        translateX()` whose value is `(activeWidth -
        defaultWidth)` — i.e. a *signed* offset that slides
        the suffix left for narrower words ("user") and right
        for wider ones ("device"), so it always sits right
        after the visible active word. Because the offset is
        zero when the default ("agent") is active, the suffix
        renders at its layout position on first paint and only
        animates as the user scrolls past the trigger point.
        Animating `transform` instead of the rotator's `width`
        is both cheaper (no layout) and smoother, and it means
        the prefix never shifts.

     3. Anchored centring of the line as a whole. The headline
        is wrapped in `.title-line`, an inline-block that the
        parent `text-align: center` centres as a unit. Inside
        the slab, contents are `text-align: left` and the line
        is `white-space: nowrap` *when* the default-variant
        headline fits the title's content box (checked by
        measuring a hidden ghost copy on mount + on resize).
        On viewports where the line can't fit, both the nowrap
        and the suffix translate are skipped so the line wraps
        naturally and the inline-block falls back to its own
        `text-align: center` to keep the wrapped headline
        visually centred — at those sizes the prefix anchoring
        is a worthwhile trade-off vs an overflowing slab.

     4. The reel's initial position is offset by a few cycle
        steps (`INITIAL_WORD_STEP`) so there are stack lanes
        both above *and* below the active centre on first
        paint — otherwise `wordStep = 0` lands the active lane
        at `REEL_BASE` (the very last array index) and the
        bottom peek is empty. The cycle word in the active
        slot is unchanged (the offset is a multiple of
        `cycle.length`).

   Re-measurement runs after fonts settle and on resize so the
   cached widths stay in sync with responsive font-size
   breakpoints. */

withDefaults(
  defineProps<{
    /* dark = true switches the band's background from the page's
       light surface (`--vp-c-bg`) to the alt surface
       (`--ea-surface-alt`). The radial brand-tint overlay is
       independently bumped on the dark variant so the wash stays
       visible against the darker base. */
    dark?: boolean
  }>(),
  { dark: false }
)

const isMarkdownExport = useMarkdownExport()

const sectionRef = ref<HTMLElement>()
const measureRefs = ref<HTMLElement[]>([])
const ghostRef = ref<HTMLElement>()

const cycle = ['agent', 'user', 'device'] as const
/* Headline split into a *lead* and a *tail* so the narrow-
   width forced break (≤670px) can land cleanly between "for"
   and "multi-". The trailing space lives on the lead so the
   tail starts cleanly with "multi-" (relevant once `.title-
   tail` becomes display: inline-block on its own line — a
   leading space inside the inline-block would render as a
   visible left indent at the start of the second line). At
   wider widths both spans are inline and the trailing space
   simply renders between them. */
const headlineLead = 'Everything you need for '
const headlineMid = 'multi-'
const headlinePrefix = `${headlineLead}${headlineMid}`
/* Suffix uses a non-breaking space (\u00A0) instead of a
   regular space so the leading space is *not* collapsed when
   the suffix is wrapped in `.title-suffix` (display:
   inline-block). With a normal space, CSS would strip the
   leading whitespace at the start of the inline-block's text
   line and "user" would visually butt up against
   "collaboration". */
const headlineSuffix = '\u00A0collaboration'
/* The default word — first in the cycle and the mid-width of
   the three. Used as the rotator's intrinsic width AND as the
   ghost line's word, so that on first paint the sentence
   already lays out exactly as it will once measurements
   settle and the active word is the default. */
const defaultWord = cycle[0]
/* The aria-label / markdown export uses a regular space so
   screen readers and the .md export get a normal, meaningful
   sentence rather than one containing a non-breaking space. */
const headlineFull = `${headlinePrefix}${defaultWord} collaboration`
const markdown = `## ${headlineFull}`

const REEL_COPIES = 50
const REEL_LANES = REEL_COPIES * cycle.length
const REEL_BASE = REEL_LANES - 1
/* Initial wordStep offset so the active centre lane has stack
   lanes both above and below it on first paint (otherwise
   wordStep = 0 lands the active lane at REEL_BASE — the very
   last array index — and the bottom peek lane is missing). A
   small multiple of cycle.length keeps the active word
   unchanged (`activeWordIdx === 0`) while shifting the active
   *stack* index off the boundary. */
const INITIAL_WORD_STEP = cycle.length

const reelStack = computed(() => {
  const reversed = [...cycle].reverse()
  const out: string[] = []
  for (let i = 0; i < REEL_COPIES; i++) out.push(...reversed)
  return out
})

const wordStep = ref<number>(INITIAL_WORD_STEP)
const activeStackIdx = computed(() => Math.max(0, REEL_BASE - wordStep.value))
/* Narrow-mode flag — true when the viewport is ≤670px and the
   headline is rendered as two forced lines with the rotator on
   the second line. The reel layout flips from "active centred
   between an above-peek and a below-peek" to "active at the
   top with two faded lanes below", and the line-centring logic
   re-engages the suffix translate (which is normally suppressed
   in fallback wrap mode). */
const isNarrowMode = ref(false)
/* `reelOffsetLh` translates the whole stack vertically so the
   active lane lands at the desired `y` position inside the
   `.rotator-window`. In wide mode the active lane sits at
   window y = 1lh (one lane visible above, one below). In
   narrow mode it shifts to y = 0lh so the active word stays at
   its baseline and two faded lanes appear *under* it. */
const reelOffsetLh = computed(() =>
  isNarrowMode.value ? -activeStackIdx.value : 1 - activeStackIdx.value
)
/* `wordStep` is the absolute, unbounded forward step counter;
   the active cycle index (used to look up the measured width)
   is just `wordStep` mod cycle.length. Negative `wordStep` is
   already clamped at 0 above, so a plain modulo suffices. */
const activeWordIdx = computed(() => wordStep.value % cycle.length)

function laneOpacity(idx: number): number {
  const signed = idx - activeStackIdx.value
  if (isNarrowMode.value) {
    /* Active stays full-strength; the two lanes immediately
       below are the only visible peeks, with the further-down
       lane fading more so the column reads as a soft trailing
       echo rather than a hard list. */
    if (signed === 0) return 1
    if (signed === 1) return 0.34
    if (signed === 2) return 0.18
    return 0
  }
  const dist = Math.abs(signed)
  if (dist === 0) return 1
  if (dist === 1) return 0.28
  return 0
}

const wordWidths = ref<number[]>([])
const activeWidth = computed(() => wordWidths.value[activeWordIdx.value] ?? 0)
/* The default word's measured width — the rotator is sized to
   this, and the suffix translate is computed *relative* to
   it. Anchoring on the default (rather than the widest)
   means the suffix offset is exactly zero when the default
   word is active, which is how it starts on page load — so
   the suffix renders at its correct position on first paint
   and only animates as the user scrolls past the trigger
   point. */
const defaultWidth = computed(() => wordWidths.value[0] ?? 0)
/* The widest measured cycle word — used to size `.rotator-
   window`'s box so the vertical fade mask covers the full
   horizontal area where any lane can land (peeks of wider
   words extend rightward past the rotator's content box
   because lanes are left-aligned). Without this, the mask
   would only fade across the rotator's default-width box
   and the wider parts of peek lanes would render
   unmasked. */
const maxWidth = computed(() =>
  wordWidths.value.length ? Math.max(...wordWidths.value) : 0
)
/* Signed pixel offset applied to the trailing " collaboration"
   via `translateX`: negative for narrower words ("user"),
   positive for wider words ("device"), zero for the default
   ("agent"). Pulls the suffix to sit right after the visible
   active word rather than after the rotator's right edge.
   Animating this instead of the rotator's own `width` keeps
   the prefix completely still and avoids per-frame layout
   work. */
const suffixOffset = computed(() => {
  if (!wordWidths.value.length || defaultWidth.value <= 0) return 0
  return activeWidth.value - defaultWidth.value
})
/* Width of the default-variant rendered headline. Used to
   detect whether the line fits in the title's content box,
   which decides between anchored / fallback layout modes. */
const lineWidth = ref(0)

/* `.title-line` style picker. Three modes:
     - narrow (≤670px): no inline style — CSS handles the
       block-level layout that puts `.title-lead` and
       `.title-tail` on their own lines.
     - anchored (default fits): pin `min-width` to the default-
       variant width, force `nowrap`, and left-align so the
       prefix anchors at the slab's left edge.
     - fallback (default doesn't fit at the current font size,
       but viewport is still > 670px): centre the wrapped
       headline. */
const lineStyle = computed(() => {
  if (isNarrowMode.value) return undefined
  if (lineWidth.value > 0) {
    return {
      minWidth: `${lineWidth.value}px`,
      whiteSpace: 'nowrap' as const,
      textAlign: 'left' as const,
    }
  }
  return { textAlign: 'center' as const }
})

/* In narrow mode the second line ("multi-{X} collaboration")
   is centred as a unit. Without further compensation only the
   suffix would shift as the active word changes width, which
   reads visually off-balance against the static first line.
   Translating the whole tail by `-suffixOffset / 2` (paired
   with the suffix's own `+suffixOffset`) splits the slack
   evenly between the prefix and suffix, so the active word
   stays anchored at the line's visual centre. Returns
   `undefined` outside narrow mode so the wide-mode anchored
   centring is unaffected. */
const tailStyle = computed(() => {
  if (!isNarrowMode.value) return undefined
  return { transform: `translateX(${-suffixOffset.value / 2}px)` }
})

/* Suffix translate is enabled in either anchored mode (single
   line, prefix-anchored) *or* narrow mode (two lines, balanced
   centring). It's suppressed only in the fallback wrap mode
   (>670px, headline doesn't fit) where the line wraps
   naturally and an inline transform would tug the wrapped
   suffix off the trailing position. */
const suffixStyle = computed(() => {
  if (isNarrowMode.value || lineWidth.value > 0) {
    return { transform: `translateX(${suffixOffset.value}px)` }
  }
  return undefined
})

function measureWords() {
  const els = measureRefs.value
  if (els.length) {
    const widths = els.map((el) => (el ? el.getBoundingClientRect().width : 0))
    /* Skip any frame where the spans report zero (pre-paint,
       font not loaded yet, etc) — leaves the previous
       measurement in place until we get good numbers. */
    if (widths.every((w) => w > 0)) {
      wordWidths.value = widths
    }
  }
  if (ghostRef.value) {
    const ghostWidth = ghostRef.value.getBoundingClientRect().width
    const title = ghostRef.value.parentElement
    /* Only apply the anchored min-width when the default-
       variant headline actually fits inside the title's
       available content box. On narrower viewports (or large
       cycle words) the ghost can be wider than the column —
       forcing a min-width then would cause horizontal overflow
       / a busted line break. In that case we fall back to
       natural inline sizing: the line wraps as it likes and
       the prefix is allowed to shift, which is the correct
       trade-off vs an overflowing slab. */
    if (ghostWidth > 0 && title) {
      const cs = getComputedStyle(title)
      const titleBox = title.getBoundingClientRect().width
      const padX =
        (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
      const avail = titleBox - padX
      lineWidth.value = ghostWidth <= avail ? ghostWidth : 0
    }
  }
}

const WORD_STEP_PX = 100
const TRANSITION_MS = 360

let anchorScrollY: number | null = null
let isAnimating = false
let animTimer = 0
let scrollRaf = 0
let resizeObs: ResizeObserver | null = null
let narrowMql: MediaQueryList | null = null
function onNarrowChange(e: MediaQueryListEvent) {
  isNarrowMode.value = e.matches
}

function onScroll() {
  if (scrollRaf) return
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0
    if (!sectionRef.value) return

    const rect = sectionRef.value.getBoundingClientRect()
    const vh = window.innerHeight
    const scrollY = window.scrollY

    if (anchorScrollY === null) {
      if (rect.top <= vh) anchorScrollY = scrollY
      return
    }

    if (isAnimating) return

    const delta = scrollY - anchorScrollY
    if (Math.abs(delta) < WORD_STEP_PX) return

    const dir = delta > 0 ? 1 : -1
    const nextStep = wordStep.value + dir
    if (nextStep < 0 || nextStep > REEL_BASE) {
      anchorScrollY = scrollY
      return
    }

    wordStep.value = nextStep
    isAnimating = true
    animTimer = window.setTimeout(() => {
      isAnimating = false
      animTimer = 0
      anchorScrollY = window.scrollY
    }, TRANSITION_MS)
  })
}

onMounted(() => {
  measureWords()

  /* Fonts can still be swapping in on first mount; re-measure
     once `document.fonts.ready` resolves so the rotator settles
     into the correct widths instead of getting stuck at the
     fallback-font measurements. */
  if (typeof document !== 'undefined') {
    const fonts = (
      document as unknown as { fonts?: { ready?: Promise<unknown> } }
    ).fonts
    if (fonts?.ready) {
      fonts.ready.then(() => measureWords()).catch(() => {})
    }
  }

  /* Headline font-size shrinks at the 910/480 breakpoints,
     and the line-anchor threshold also depends on the title's
     content-box width — observe the per-word measurement
     spans, the full ghost line, *and* the title element so a
     viewport resize refreshes all three caches. The narrow
     (≤670px) two-line mode is tracked separately via
     matchMedia below. */
  if (typeof ResizeObserver !== 'undefined') {
    resizeObs = new ResizeObserver(() => measureWords())
    measureRefs.value.forEach((el) => el && resizeObs!.observe(el))
    if (ghostRef.value) resizeObs.observe(ghostRef.value)
    const title = ghostRef.value?.parentElement
    if (title) resizeObs.observe(title)
  }

  /* Narrow-mode flag — drives the forced two-line layout and
     the two-faded-words-below rotator window. Tracked via
     matchMedia rather than ResizeObserver so the breakpoint
     transition is event-driven rather than polled. */
  if (typeof window !== 'undefined' && window.matchMedia) {
    narrowMql = window.matchMedia('(max-width: 670px)')
    isNarrowMode.value = narrowMql.matches
    narrowMql.addEventListener('change', onNarrowChange)
  }

  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  if (animTimer) {
    clearTimeout(animTimer)
    animTimer = 0
  }
  if (resizeObs) resizeObs.disconnect()
  if (narrowMql) {
    narrowMql.removeEventListener('change', onNarrowChange)
    narrowMql = null
  }
})
</script>

<template>
  <MdExportExplicit v-if="isMarkdownExport">
    <MarkdownContent>{{ markdown }}</MarkdownContent>
  </MdExportExplicit>
  <section
    v-else
    ref="sectionRef"
    class="why-everything"
    :class="{
      'why-everything--alt': dark,
      'why-everything--narrow': isNarrowMode,
    }"
  >
    <h2 class="why-everything-title" :aria-label="headlineFull">
      <!-- The visible line. Its `min-width` is pinned to the
           default-variant rendered headline (measured from the
           ghost below) so the inline-block stays a stable
           centred slab; inside, contents are left-aligned so
           the prefix anchors at the line's left edge and only
           the suffix " collaboration" translates as the active
           cycle word changes. -->
      <span aria-hidden="true" class="title-line" :style="lineStyle"
        ><!-- "Everything you need for " — held in its own span
           so the narrow-mode CSS can flip it to display:
           block and force the second line's break right after
           "for". The trailing space stays on the lead so the
           tail starts cleanly with "multi-" without a visible
           leading space at the start of the wrapped line. --><span
          class="title-lead"
          >{{ headlineLead }}</span
        ><!-- "multi-{rotator} collaboration" — kept together as
           a single inline-block in narrow mode so the entire
           second line can be centred (and translated) as one
           unit. --><span class="title-tail" :style="tailStyle"
          >{{ headlineMid
          }}<span class="rotator"
            ><!-- In-flow spacer carrying the *default* cycle word
             (visibility hidden). Sets both the rotator's
             intrinsic width — anchored to the default word
             ("agent", first in the cycle) — and the rotator's
             text baseline. Anchoring on the default rather
             than the widest means the rotator's natural width
             matches what the line will be when the active
             word is the default, so first paint has no
             initial transform animation. Wider words ("device")
             overflow horizontally; that overflow is allowed
             by `.rotator-window`'s clip-path. -->
            <span class="rotator-spacer">{{ defaultWord }}</span>
            <!-- Hidden measurement copies of each cycle word; live
             inside `.rotator` so they inherit the exact font /
             letter-spacing the visible reel will use. -->
            <span
              v-for="(w, i) in cycle"
              :key="`m-${i}`"
              ref="measureRefs"
              class="rotator-measure"
              >{{ w }}</span
            >
            <span
              class="rotator-window"
              :style="maxWidth > 0 ? { width: `${maxWidth}px` } : undefined"
            >
              <span
                class="rotator-stack"
                :style="{ transform: `translateY(${reelOffsetLh}lh)` }"
              >
                <span
                  v-for="(w, i) in reelStack"
                  :key="i"
                  class="rotator-lane"
                  :style="{ top: `${i}lh`, opacity: laneOpacity(i) }"
                  >{{ w }}</span
                >
              </span>
            </span> </span
          ><span class="title-suffix" :style="suffixStyle">{{
            headlineSuffix
          }}</span></span
        ></span
      >
      <!-- Hidden ghost: the default-variant rendered headline.
           Lives at the end of the title and is taken out of
           flow so it doesn't push other content; its measured
           width feeds `.title-line`'s `min-width` above. -->
      <span ref="ghostRef" aria-hidden="true" class="title-ghost"
        >{{ headlinePrefix }}{{ defaultWord }}{{ headlineSuffix }}</span
      >
    </h2>
  </section>
</template>

<style scoped>
.why-everything {
  position: relative;
  padding: 100px 0;
  background: var(--vp-c-bg);
  border-bottom: 1px solid var(--vp-c-divider);
  isolation: isolate;
  overflow: hidden;
}
/* Dark variant — alt surface as the band background. The radial
   brand-tint overlay below picks up its own dark-variant strength
   so the wash stays readable against the darker base. */
.why-everything--alt {
  background: var(--ea-surface-alt);
}
.why-everything::before {
  /* Brand-tint wash — geometry copied from the CTA straps
     (`ac-strap`, `ns-strap`, `mc-strap`) so the glow sits as one
     broad ellipse that fills most of the band rather than a
     concentrated dot at the headline. Earlier multi-layer
     versions used tightly-bounded inner ellipses (220×140px)
     which left the glow too small to read against the wide
     headline; matching the CTA strap's `80% 100% at 50% 50%`
     ellipse means the bright pool spans the band width and
     "lights" the entire headline area. */
  content: '';
  position: absolute;
  inset: 0;
  /* Multi-stop falloff (rather than a single colour → transparent
     pair) eases the gradient curve so it doesn't terminate in a
     visible elliptical edge. The two-stop version was clearly
     readable as an ellipse because the linear interpolation
     ended sharply at the transparent stop; stepping the mix
     down through ~half- and ~quarter-strength midpoints
     simulates an ease-out, and pushing the transparent stop
     past where the visible falloff sits keeps that final
     boundary outside the band so it never reads as an edge. */
  background: radial-gradient(
    ellipse 75% 120% at 50% 50%,
    color-mix(in srgb, var(--vp-c-brand-1) 9%, transparent) 0%,
    color-mix(in srgb, var(--vp-c-brand-1) 5%, transparent) 35%,
    color-mix(in srgb, var(--vp-c-brand-1) 2%, transparent) 60%,
    transparent 90%
  );
  z-index: -1;
  opacity: 0.2;
  pointer-events: none;
}
.why-everything--alt::before {
  /* Bump the brand-tint mix on the dark variant so the wash
     stays visible against `--ea-surface-alt`. The CTA straps
     step from 6% (light) → 10% (dark); the centred glow here
     carries a touch more so the headline reads as "lit" rather
     than just tinted. Same multi-stop ease as the light variant
     so the falloff stays smooth rather than ending in a hard
     elliptical line. */
  background: radial-gradient(
    ellipse 75% 120% at 50% 50%,
    color-mix(in srgb, var(--vp-c-brand-1) 18%, transparent) 0%,
    color-mix(in srgb, var(--vp-c-brand-1) 11%, transparent) 35%,
    color-mix(in srgb, var(--vp-c-brand-1) 5%, transparent) 60%,
    transparent 90%
  );
}
.why-everything-title {
  font-size: 36px;
  font-weight: 600;
  line-height: 1.15;
  letter-spacing: -0.018em;
  color: var(--ea-text-1);
  margin: 0 auto;
  max-width: 1152px;
  padding: 0 24px;
  text-align: center;
  /* `position: relative` so the absolutely-positioned ghost
     can sit at the title's start without affecting layout.
     `text-wrap: balance` is intentionally omitted — the line's
     overall width is already pinned to the default-variant
     width via `.title-line`'s min-width, so there's nothing
     for the balance algorithm to do. */
  position: relative;
}

/* ── Anchored centred line ─────────────────────────────────── */
.title-line {
  /* Inline-block whose `min-width`, `white-space: nowrap`, and
     `text-align` are set inline based on whether the default-
     variant headline fits the title's content box.

     - Anchored mode (`min-width` set, `nowrap`, `text-align:
       left`): the parent's centring centres the slab as a
       whole; inside, contents are left-aligned so the prefix
       anchors at the slab's left edge and only the trailing
       " collaboration" translates horizontally as the active
       cycle word changes.

     - Fallback mode (`text-align: center`): on viewports
       where the line can't fit, the inline-block fills the
       parent's content box (because its content wraps) so
       parent-level centring becomes a no-op. Switching the
       inline-block's own `text-align` to `center` keeps the
       wrapped headline visually centred — the trade-off is
       that the prefix is no longer anchored, but a centred
       wrapped headline matches the rest of the page far
       better than a left-aligned one. */
  display: inline-block;
}
.title-ghost {
  /* Hidden full-headline ghost rendered with the default
     cycle word. Out of flow so it doesn't push the visible
     content; read by JS for `.title-line`'s `min-width`. */
  position: absolute;
  top: 0;
  left: 0;
  visibility: hidden;
  pointer-events: none;
  white-space: nowrap;
}

/* ── Inline rotator (default-word width) ───────────────────── */
.rotator {
  position: relative;
  display: inline-block;
  vertical-align: baseline;
  color: var(--vp-c-brand-1);
  /* No explicit height or width — the in-flow `.rotator-spacer`
     below carries the *default* cycle word (visibility hidden)
     and supplies both the rotator's intrinsic width *and* its
     text baseline. Anchoring on the default word rather than
     the widest means first paint already lays out at the
     correct width and the suffix renders at translateX(0px)
     with no initial animation. Wider cycle words overflow the
     rotator horizontally, allowed by the window's clip-path. */
}
.rotator-spacer {
  /* In-flow text carrying the *default* cycle word. Visibility
     hidden so the visible glyphs come from the reel below;
     this element gives `.rotator` (a) a real text baseline so
     its inline-block sits on the same baseline as the
     surrounding sentence rather than aligning by its bottom
     edge, and (b) its intrinsic width = the default word's
     rendered width. */
  visibility: hidden;
  white-space: nowrap;
}
.rotator-measure {
  /* Hidden, off-flow measurement copies of every cycle word —
     read by JS on mount + on resize to compute the rotator's
     animated width. Lives inside `.rotator` so it inherits the
     same font / letter-spacing as the visible reel. */
  position: absolute;
  top: 0;
  left: 0;
  visibility: hidden;
  pointer-events: none;
  white-space: nowrap;
}
.rotator-window {
  /* Anchored on the rotator's left edge and extends `1lh`
     above and below so the immediately-adjacent stack lanes
     roll smoothly into the centre slot. The window's `width`
     is set inline to the *widest* measured cycle word, not
     the rotator's own (default-word) width — that way the
     vertical-fade mask covers the full horizontal area where
     any lane can land. Without it, peek lanes for wider
     words would extend past the rotator's right edge and
     render unmasked. With the window pre-sized to fit the
     widest lane, plain `overflow: hidden` is enough to clip
     the off-screen vertical lanes. */
  position: absolute;
  top: -1lh;
  bottom: -1lh;
  left: 0;
  /* `width` is set inline (= maxWidth) when measurements are
     available; this `right: 0` is the fallback before first
     measurement so the window covers at least the rotator. */
  right: 0;
  overflow: hidden;
  pointer-events: none;
  -webkit-mask-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.55) 0%,
    black 32%,
    black 68%,
    rgba(0, 0, 0, 0.55) 100%
  );
  mask-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.55) 0%,
    black 32%,
    black 68%,
    rgba(0, 0, 0, 0.55) 100%
  );
}
.rotator-stack {
  /* Positioning context for the absolutely-placed lanes below.
     The stack itself contributes no intrinsic block size — its
     children are taken out of flow and stacked manually via
     per-lane `top` values — but the `transform` transition
     still rolls the whole stack vertically for the reel
     animation. */
  position: relative;
  display: block;
  transition: transform 0.34s cubic-bezier(0.65, 0, 0.35, 1);
  will-change: transform;
}
.rotator-lane {
  /* Lanes are absolutely positioned and left-aligned with the
     rotator's content box. Sharing the same left anchor gives
     a consistent x-position for all three cycle words rather
     than each word being centred at a slightly different
     point; wider words extend rightward past the rotator's
     right edge (allowed by the window's clip-path). The
     vertical position is supplied by the inline `top: ${i}lh`
     style so lanes still stack at 1lh increments, and the
     parent stack's `translateY` rolls them all together. */
  position: absolute;
  left: 0;
  height: 1lh;
  line-height: inherit;
  white-space: nowrap;
  transition: opacity 0.34s cubic-bezier(0.65, 0, 0.35, 1);
}

/* ── Trailing " collaboration" with translate animation ────── */
.title-suffix {
  /* Inline-block so we can apply `transform: translateX()` —
     the offset is set inline based on `(activeWidth -
     defaultWidth)` and slides the suffix left for narrower
     words / right for wider ones, so it sits right after the
     visible active word. Zero offset for the default word
     means no initial transform animation on first paint.
     Animating `transform` instead of the rotator's own width
     keeps the prefix completely still and avoids per-frame
     layout work. */
  display: inline-block;
  vertical-align: baseline;
  transition: transform 0.34s cubic-bezier(0.65, 0, 0.35, 1);
  will-change: transform;
}

/* Drop the headline to its medium step earlier than the
   page's general 768px breakpoint — at 36px the line stops
   fitting the column comfortably well above 768px (the rotator
   sits *inside* the sentence, so the natural wrap is awkward),
   and the 26px step still reads as a confident statement
   rather than a body-paragraph. The 72px section padding then
   kicks in at the page's standard 768px so other parts of the
   layout stay in step. */
@media (max-width: 910px) {
  .why-everything-title {
    font-size: 26px;
  }
}
@media (max-width: 768px) {
  .why-everything {
    padding: 72px 0;
  }
}
/* Forced two-line layout — the headline deliberately breaks
   between "for" and "multi-" so the rotator + the surrounding
   visible content sit on a short, centrable second line. The
   rotator's vertical reel also flips: instead of one peek lane
   above + one below, the active word stays at its baseline and
   *two* faded lanes appear directly under it. The mask is
   re-shaped to fade only downward; lane opacities (and the
   reel offset that lands the active lane at window y = 0) are
   handled in JS. The padding/margin around the title is left
   untouched — the additional lanes extend down into the
   section's existing bottom padding. */
@media (max-width: 670px) {
  .why-everything--narrow .title-line {
    display: block;
  }
  .why-everything--narrow .title-lead {
    display: block;
  }
  .why-everything--narrow .title-tail {
    /* In narrow mode the tail carries its own `translateX
       (-suffixOffset / 2)` so the *whole* second line slides
       to keep the active word centred (paired with the suffix's
       own `+suffixOffset` for adjacency). Without a transition
       on the tail the prefix would jump while the suffix
       continued to glide, so the two halves are matched on the
       same easing curve / duration as `.title-suffix` above. */
    display: inline-block;
    transition: transform 0.34s cubic-bezier(0.65, 0, 0.35, 1);
    will-change: transform;
  }
  .why-everything--narrow .rotator-window {
    top: 0;
    bottom: -2lh;
    -webkit-mask-image: linear-gradient(
      to bottom,
      black 0%,
      black 38%,
      rgba(0, 0, 0, 0.55) 100%
    );
    mask-image: linear-gradient(
      to bottom,
      black 0%,
      black 38%,
      rgba(0, 0, 0, 0.55) 100%
    );
  }
}
@media (max-width: 480px) {
  .why-everything {
    padding: 56px 0;
  }
  .why-everything-title {
    font-size: 22px;
  }
}
</style>
