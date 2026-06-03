<script setup lang="ts">
/* App — tokens probe.
   ─────────────────────────────────────────────────────────────────
   First toy in the `app` group. Renders a swatch grid of the
   `--ds-*` tokens we care most about for the mockup work, both
   raw colours and surface combinations. The point is to confirm:

     1. The rescoped `tokens.css` actually loads inside `/brand-toys`
        (the website's CSS pipeline picks up the file).
     2. The `data-theme` attribute on `.app-mockup-root` switches the
        whole grid between light and dark *independently* of the
        brand-toys page's forced-dark `<html class="dark">`.
     3. The swatches read as the same warm-stone (light) / deep-navy +
        accent-teal (dark) palette the running desktop app uses, so
        future primitives have a known-good baseline.

   This toy is throwaway-flavoured — it exists for phase 1's
   end-of-phase check (per APP_DESKTOP_MOCKUP_PLAN.md §8). Once the
   chrome / sidebar / chat primitives land and render correctly, the
   probe stops being interesting; we can drop it from the registry
   in a follow-up if it gets noisy. Until then it's a quick smoke
   test that the token bridge is intact. */

import './shared.css'

defineProps<{
  theme?: 'light' | 'dark'
}>()

interface Swatch {
  /** Display name shown above the swatch. */
  name: string
  /** CSS custom property to render. */
  token: string
  /** Optional: caption shown below (purpose / usage hint). */
  caption?: string
}

interface SwatchGroup {
  title: string
  /** Caption for the whole group — what these tokens are FOR. */
  blurb?: string
  swatches: Swatch[]
}

/* Hand-picked subset — exactly the tokens we'll lean on heaviest in
   phase 2-7. The full token sheet has more, but a wall of 80 swatches
   buries the signal; this 30-ish set is the working palette. */
const groups: SwatchGroup[] = [
  {
    title: 'Surfaces',
    blurb:
      'Page bg → tile bg → raised card. Each rung sits one step above the last.',
    swatches: [
      {
        name: '--ds-bg',
        token: '--ds-bg',
        caption: 'Window background',
      },
      {
        name: '--ds-bg-subtle',
        token: '--ds-bg-subtle',
        caption: 'Chrome strap',
      },
      {
        name: '--ds-surface',
        token: '--ds-surface',
        caption: 'Tile fill',
      },
      {
        name: '--ds-surface-raised',
        token: '--ds-surface-raised',
        caption: 'Cards / popovers',
      },
      {
        name: '--ds-bg-hover',
        token: '--ds-bg-hover',
        caption: 'Row hover',
      },
    ],
  },
  {
    title: 'Text',
    blurb: 'Three-step ink ladder. Body text → secondary → muted captions.',
    swatches: [
      {
        name: '--ds-text-1',
        token: '--ds-text-1',
        caption: 'Primary',
      },
      {
        name: '--ds-text-2',
        token: '--ds-text-2',
        caption: 'Secondary',
      },
      {
        name: '--ds-text-3',
        token: '--ds-text-3',
        caption: 'Muted',
      },
      {
        name: '--ds-text-4',
        token: '--ds-text-4',
        caption: 'Faint label',
      },
    ],
  },
  {
    title: 'Borders / dividers',
    blurb: 'Border family is alpha-tinted; divider is solid warm-stone.',
    swatches: [
      {
        name: '--ds-border-1',
        token: '--ds-border-1',
      },
      {
        name: '--ds-border-2',
        token: '--ds-border-2',
      },
      {
        name: '--ds-border-3',
        token: '--ds-border-3',
      },
      {
        name: '--ds-divider',
        token: '--ds-divider',
        caption: 'Hairline rules',
      },
    ],
  },
  {
    title: 'Accent',
    blurb: 'Light = navy ink (brand). Dark = accent teal #75fbfd.',
    swatches: [
      {
        name: '--ds-accent-3',
        token: '--ds-accent-3',
      },
      {
        name: '--ds-accent-5',
        token: '--ds-accent-5',
      },
      {
        name: '--ds-accent-7',
        token: '--ds-accent-7',
      },
      {
        name: '--ds-accent-9',
        token: '--ds-accent-9',
        caption: 'Selected / active',
      },
      {
        name: '--ds-focus-ring',
        token: '--ds-focus-ring',
      },
    ],
  },
  {
    title: 'Status hues',
    blurb:
      'Status dots, state-table row tints, error toasts. Lighter in dark mode so they glow.',
    swatches: [
      {
        name: '--ds-blue-9',
        token: '--ds-blue-9',
        caption: 'message',
      },
      {
        name: '--ds-amber-9',
        token: '--ds-amber-9',
        caption: 'tool-call',
      },
      {
        name: '--ds-green-9',
        token: '--ds-green-9',
        caption: 'tool-result',
      },
      {
        name: '--ds-red-9',
        token: '--ds-red-9',
        caption: 'error',
      },
      {
        name: '--ds-yellow-9',
        token: '--ds-yellow-9',
        caption: 'warning',
      },
    ],
  },
]
</script>

<template>
  <!--
    The wrapping element MUST carry both `app-mockup-root` (which
    activates the `--ds-*` cascade from tokens.css) and `data-theme`
    (which selects light vs dark within the cascade). Every future
    mockup primitive / scene follows the same pattern.
  -->
  <div class="probe-root app-mockup-root" :data-theme="theme ?? 'dark'">
    <header class="probe-header">
      <p class="probe-eyebrow mono">App tokens probe</p>
      <h1 class="probe-title">--ds-* working palette</h1>
      <p class="probe-blurb">
        Sanity check that the token bridge from
        <code>packages/agents-server-ui/src/ui/tokens.css</code> resolves
        correctly inside the marketing site. Toggle <code>theme</code> in the
        controls panel — the swatches should switch independently of the
        <code>html.dark</code> class the brand-toys harness forces.
      </p>
    </header>

    <section v-for="group in groups" :key="group.title" class="probe-group">
      <header class="probe-group-head">
        <h2 class="probe-group-title">{{ group.title }}</h2>
        <p v-if="group.blurb" class="probe-group-blurb">{{ group.blurb }}</p>
      </header>
      <ul class="probe-grid">
        <li v-for="s in group.swatches" :key="s.token" class="probe-cell">
          <div
            class="probe-swatch"
            :style="{ background: `var(${s.token})` }"
            :title="s.token"
          />
          <p class="probe-cell-name mono">{{ s.name }}</p>
          <p v-if="s.caption" class="probe-cell-caption">{{ s.caption }}</p>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
/* All cell colours are read from the `--ds-*` cascade (which the
   `.app-mockup-root` selector carries); the cell typography mirrors
   the tokens too so the probe genuinely "looks like the app" rather
   than the website's scoped CSS. The only place we deliberately do
   NOT use --ds-* is the swatch borders themselves, which we want
   visible against the page bg regardless of the swatch hue
   underneath. */

.probe-root {
  /* Override the shared baseline's solid bg with a soft inner padding
     so the probe never visually butts up against the brand-toys
     stage chrome. */
  padding: var(--ds-space-7);
  min-height: 100%;
  font-family: var(--ds-font-body);
}

.probe-header {
  margin-bottom: var(--ds-space-7);
  max-width: 720px;
}

.probe-eyebrow {
  margin: 0 0 var(--ds-space-2);
  font-size: var(--ds-text-2xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ds-text-3);
}

.probe-title {
  margin: 0 0 var(--ds-space-3);
  font-size: var(--ds-text-3xl);
  line-height: var(--ds-text-3xl-lh);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ds-text-1);
}

.probe-blurb {
  margin: 0;
  font-size: var(--ds-text-base);
  line-height: var(--ds-text-base-lh);
  color: var(--ds-text-2);
}

.probe-blurb code {
  font-family: var(--ds-font-mono);
  font-size: 12px;
  padding: 1px 5px;
  border-radius: var(--ds-radius-2);
  background: var(--ds-chip-bg);
  border: 1px solid var(--ds-chip-border);
  color: var(--ds-text-1);
}

.probe-group {
  margin-bottom: var(--ds-space-7);
}

.probe-group-head {
  margin-bottom: var(--ds-space-4);
  border-bottom: 1px solid var(--ds-divider);
  padding-bottom: var(--ds-space-2);
}

.probe-group-title {
  margin: 0;
  font-size: var(--ds-text-lg);
  line-height: var(--ds-text-lg-lh);
  font-weight: 600;
  color: var(--ds-text-1);
  letter-spacing: -0.005em;
}

.probe-group-blurb {
  margin: 4px 0 0;
  font-size: var(--ds-text-sm);
  line-height: var(--ds-text-sm-lh);
  color: var(--ds-text-3);
}

.probe-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--ds-space-3);
}

.probe-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.probe-swatch {
  /* Squarish swatch with a thin border so even fully-transparent
     tokens (like --ds-border-1 in light mode) are still visible — they
     read as a faint inner tint over the white card. */
  width: 100%;
  height: 56px;
  border-radius: var(--ds-radius-3);
  border: 1px solid var(--ds-border-2);
  background-clip: padding-box;
}

.probe-cell-name {
  margin: 0;
  font-size: 11px;
  line-height: 1.3;
  color: var(--ds-text-2);
  /* Tokens that overflow get truncated rather than wrapping — keeps
     each cell exactly 3 lines tall so the grid is uniform. */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.probe-cell-caption {
  margin: 0;
  font-size: 10.5px;
  line-height: 1.3;
  color: var(--ds-text-3);
}
</style>
