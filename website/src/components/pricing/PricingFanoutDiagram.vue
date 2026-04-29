<script setup lang="ts">
/* PricingFanoutDiagram — horizontal flow showing the metered side of the
   pricing model (Writes → Retention) feeding into the always-free
   delivery path (Reads → Egress → Fan-out). The paid boxes use the
   solid hairline-card vocabulary; the free boxes use a dashed outline
   in the brand colour. Arrows are inline SVG so the fan-out node can
   show multiple outgoing rays converging back toward the centre of
   the Egress box. On narrow viewports the free side collapses to a
   compact row of pills underneath the two paid boxes. */

import MarkdownContent from '../MarkdownContent.vue'
import MdExportExplicit from '../MdExportExplicit.vue'
import { useMarkdownExport } from '../../lib/useMarkdownExport'

const isMarkdownExport = useMarkdownExport()

const markdown = `**You pay for**:

- Writes: $1 per 1M writes
- Retention: $0.10 per GB-month

**Always free**:

- Reads
- Egress
- Fan-out`
</script>

<template>
  <MdExportExplicit v-if="isMarkdownExport">
    <MarkdownContent>{{ markdown }}</MarkdownContent>
  </MdExportExplicit>
  <div v-else class="pfd-host">
    <div
      class="pfd"
      aria-label="Pricing model: pay for writes and retention; reads, egress and fan-out delivery are unlimited and free."
    >
      <!-- Shared SVG defs for arrowheads. refX is offset back from the
         marker tip by ~stroke-width so the arrowhead sits ahead of
         the line's round cap (otherwise the cap pokes through the
         tip). With orient="auto" this offset is applied along the
         line's own direction, so it works for the angled fan-out
         rays as well. -->
      <svg class="pfd-defs" aria-hidden="true" focusable="false">
        <defs>
          <marker
            id="pfd-ah-paid"
            markerWidth="6"
            markerHeight="6"
            refX="3.9"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 6 3, 0 6" class="pfd-ah-paid" />
          </marker>
          <marker
            id="pfd-ah-free"
            markerWidth="6"
            markerHeight="6"
            refX="3.9"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 6 3, 0 6" class="pfd-ah-free" />
          </marker>
        </defs>
      </svg>

      <!-- ── YOU PAY FOR ─────────────────────────────────────────── -->
      <div class="pfd-paid">
        <div class="pfd-label pfd-label-paid mono">YOU PAY FOR</div>
        <div class="pfd-row">
          <div class="pfd-box pfd-box-paid">
            <div class="pfd-box-name">Writes</div>
            <div class="pfd-box-rate">$1 per 1M writes</div>
          </div>
          <div class="pfd-arrow pfd-arrow-line" aria-hidden="true">
            <svg viewBox="0 0 40 12">
              <line
                x1="2"
                y1="6"
                x2="34"
                y2="6"
                class="pfd-line pfd-line-paid"
                marker-end="url(#pfd-ah-paid)"
              />
            </svg>
          </div>
          <div class="pfd-box pfd-box-paid">
            <div class="pfd-box-name">Retention</div>
            <div class="pfd-box-rate">$0.10 per GB&middot;month</div>
          </div>
        </div>
      </div>

      <!-- ── Bridge between paid and free ────────────────────────── -->
      <div class="pfd-bridge" aria-hidden="true">
        <div class="pfd-arrow pfd-arrow-line">
          <svg viewBox="0 0 40 12">
            <line
              x1="2"
              y1="6"
              x2="34"
              y2="6"
              class="pfd-line pfd-line-paid"
              marker-end="url(#pfd-ah-paid)"
            />
          </svg>
        </div>
      </div>

      <!-- ── ALWAYS FREE (boxes — desktop) ───────────────────────── -->
      <div class="pfd-free pfd-free-boxes">
        <div class="pfd-label pfd-label-free mono">ALWAYS FREE</div>
        <div class="pfd-row">
          <div class="pfd-box pfd-box-free">
            <div class="pfd-box-name">Reads</div>
          </div>
          <div class="pfd-arrow pfd-arrow-line" aria-hidden="true">
            <svg viewBox="0 0 40 12">
              <line
                x1="2"
                y1="6"
                x2="34"
                y2="6"
                class="pfd-line pfd-line-free"
                marker-end="url(#pfd-ah-free)"
              />
            </svg>
          </div>
          <div class="pfd-box pfd-box-free">
            <div class="pfd-box-name">Egress</div>
          </div>
          <!-- Fan-out: 5 rays that conceptually converge at the Egress box
             (origin (-50, 40) in viewBox space, off-screen to the left).
             We only draw the visible portion — from x=0 (just past
             Egress) to x=36 (just before the Fan-out box) — so the
             rays don't overdraw Egress. The centre ray is horizontal
             so it lines up with the in-row arrows; the four others
             share the same vertex which gives both the start (left
             edge) and the end (right edge) evenly-spaced y values. -->
          <div class="pfd-arrow pfd-arrow-fanout" aria-hidden="true">
            <svg viewBox="0 0 38 80">
              <line
                x1="0"
                y1="19.1"
                x2="36"
                y2="4"
                class="pfd-line pfd-line-free"
                marker-end="url(#pfd-ah-free)"
              />
              <line
                x1="0"
                y1="29.5"
                x2="36"
                y2="22"
                class="pfd-line pfd-line-free"
                marker-end="url(#pfd-ah-free)"
              />
              <line
                x1="0"
                y1="40"
                x2="36"
                y2="40"
                class="pfd-line pfd-line-free"
                marker-end="url(#pfd-ah-free)"
              />
              <line
                x1="0"
                y1="50.5"
                x2="36"
                y2="58"
                class="pfd-line pfd-line-free"
                marker-end="url(#pfd-ah-free)"
              />
              <line
                x1="0"
                y1="60.9"
                x2="36"
                y2="76"
                class="pfd-line pfd-line-free"
                marker-end="url(#pfd-ah-free)"
              />
            </svg>
          </div>
          <div class="pfd-box pfd-box-free">
            <div class="pfd-box-name">Fan-out</div>
          </div>
        </div>
      </div>

      <!-- ── ALWAYS FREE (pills — mobile) ────────────────────────── -->
      <div class="pfd-free-pills">
        <div class="pfd-label pfd-label-free mono">ALWAYS FREE</div>
        <ul class="pfd-pills">
          <li class="pfd-pill">Reads</li>
          <li class="pfd-pill">Egress</li>
          <li class="pfd-pill">Fan-out</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pfd-host {
  /* Host establishes the container so the @container queries below can
     also restyle the .pfd grid itself (an element cannot be matched by
     a container query on its own container). */
  width: 100%;
  container-type: inline-size;
  container-name: pfd;
}

.pfd {
  /* Box borders: paid uses the standard subtle card border colour
     (--ec-border-1), matching the pricing cards and FAQ items below;
     free uses the brand colour (dashed). Arrows use a fainter pair
     so they sit visually behind the boxes — these mix with the
     surface (not transparent), so where the line overlaps the
     arrowhead the two don't compound and produce a darker tip. */
  --pfd-paid-stroke: var(--ec-border-1);
  --pfd-free-stroke: var(--vp-c-brand-1);
  --pfd-paid-arrow: color-mix(in srgb, var(--ea-text-1) 45%, var(--ea-surface));
  --pfd-free-arrow: color-mix(
    in srgb,
    var(--vp-c-brand-1) 55%,
    var(--ea-surface)
  );
  --pfd-box-h: 82px;

  width: 100%;
  display: grid;
  justify-content: center;
  align-items: end;
  grid-template-columns: auto auto auto;
  grid-template-areas: 'paid bridge free';
  column-gap: 18px;
  row-gap: 0;
}

.pfd-defs {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
}

.pfd-paid {
  grid-area: paid;
}
.pfd-bridge {
  grid-area: bridge;
}
.pfd-free-boxes {
  grid-area: free;
}
.pfd-free-pills {
  display: none;
}

/* ── Groups (paid / free) ───────────────────────────────────────── */

.pfd-paid,
.pfd-free-boxes {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

/* All boxes + arrows in a single horizontal row, vertically centred so
   in-row arrows always sit on the box centreline. */
.pfd-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

/* ── Section labels ─────────────────────────────────────────────── */

.pfd-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  line-height: 1;
  padding-left: 2px;
}
.pfd-label-paid {
  color: var(--ea-text-1);
}
.pfd-label-free {
  color: var(--vp-c-brand-1);
}

/* ── Boxes ──────────────────────────────────────────────────────── */

.pfd-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 12px 18px;
  border-radius: 10px;
  background: var(--ea-surface);
  height: var(--pfd-box-h);
  flex: 0 0 auto;
}

.pfd-box-paid {
  border: 1px solid var(--pfd-paid-stroke);
  min-width: 168px;
}
.pfd-box-free {
  border: 1px dashed var(--pfd-free-stroke);
  background: color-mix(in srgb, var(--vp-c-brand-1) 5%, var(--ea-surface));
  min-width: 112px;
}

.pfd-box-name {
  font-family: var(--vp-font-family-base);
  font-size: 14px;
  font-weight: 600;
  color: var(--ea-text-1);
  letter-spacing: -0.005em;
  line-height: 1.2;
}
.pfd-box-free .pfd-box-name {
  color: var(--vp-c-brand-1);
}

.pfd-box-rate {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--ea-text-2);
  margin-top: 4px;
  line-height: 1.2;
  white-space: nowrap;
}

/* ── Arrows ─────────────────────────────────────────────────────── */

.pfd-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.pfd-arrow svg {
  display: block;
}

.pfd-arrow-line svg {
  width: 36px;
  height: 12px;
}

.pfd-line {
  stroke-width: 1.6;
  stroke-linecap: round;
  fill: none;
}
.pfd-line-paid {
  stroke: var(--pfd-paid-arrow);
}
.pfd-line-free {
  stroke: var(--pfd-free-arrow);
}

.pfd-ah-paid {
  fill: var(--pfd-paid-arrow);
}
.pfd-ah-free {
  fill: var(--pfd-free-arrow);
}

.pfd-arrow-fanout {
  overflow: visible;
}
.pfd-arrow-fanout svg {
  width: 38px;
  height: var(--pfd-box-h);
  overflow: visible;
}

/* ── Bridge arrow between paid and free ────────────────────────── */

.pfd-bridge {
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--pfd-box-h);
}

/* ── Mobile pill layout ─────────────────────────────────────────── */

.pfd-free-pills {
  flex-direction: column;
  gap: 10px;
}
.pfd-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 8px;
  list-style: none;
  padding: 0;
  margin: 0;
}
.pfd-pill {
  display: inline-flex;
  align-items: center;
  padding: 7px 14px;
  border-radius: 999px;
  border: 1px dashed var(--pfd-free-stroke);
  background: color-mix(in srgb, var(--vp-c-brand-1) 6%, var(--ea-surface));
  color: var(--vp-c-brand-1);
  font-family: var(--vp-font-family-base);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.005em;
  white-space: nowrap;
}

/* ── Responsive ─────────────────────────────────────────────────── */

/* Stacked layout: paid boxes on top, free items as pills below.
   Arrows are dropped completely on mobile since the flow is implied
   by the vertical stacking. */
@container pfd (max-width: 880px) {
  .pfd {
    grid-template-columns: auto;
    grid-template-areas:
      'paid'
      'free';
    justify-items: center;
    align-items: stretch;
    row-gap: 18px;
  }
  .pfd-bridge {
    display: none;
  }
  .pfd-free-boxes {
    display: none;
  }
  /* No arrow between the two paid boxes on mobile. */
  .pfd-paid .pfd-arrow {
    display: none;
  }
  .pfd-free-pills {
    display: flex;
    grid-area: free;
    align-items: center;
  }
  .pfd-paid {
    align-items: center;
  }
  .pfd-free-pills .pfd-label {
    text-align: center;
  }
}

@container pfd (max-width: 540px) {
  .pfd-row {
    gap: 10px;
  }
  .pfd-box-paid {
    min-width: 0;
    flex: 1 1 0;
    padding: 10px 12px;
  }
  .pfd-box-name {
    font-size: 13px;
  }
  .pfd-box-rate {
    font-size: 11px;
  }
}
</style>
