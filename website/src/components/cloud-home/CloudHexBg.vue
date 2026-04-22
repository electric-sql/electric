<script setup lang="ts">
import { computed } from "vue"

// Hero background that recreates the original Cloud header art:
// a hex-viewer rendering of a quote about query-driven sync, with
// columns for offset, 16 hex bytes, and the ASCII representation.
//
// Visual conventions match the streams / sync hero backgrounds:
// dense enough to read as "infrastructure", with a radial fade so
// the headline copy sits on a quiet centre.

const QUOTE =
  "Query-Driven Sync is going to be transformational IMO. " +
  "It's already changed my perspective on not just modern " +
  "server state, but also app state. It's what I dreamt " +
  "of being possible over 5 years ago when I started the " +
  "original React Query."

interface Row {
  offset: string
  hex: string[]
  ascii: string
}

const BYTES_PER_ROW = 16

const rows = computed<Row[]>(() => {
  const out: Row[] = []
  for (let i = 0; i < QUOTE.length; i += BYTES_PER_ROW) {
    const slice = QUOTE.slice(i, i + BYTES_PER_ROW)
    const hex: string[] = []
    let ascii = ""
    for (let j = 0; j < BYTES_PER_ROW; j++) {
      const ch = slice.charCodeAt(j)
      if (Number.isNaN(ch)) {
        hex.push("  ")
      } else {
        hex.push(ch.toString(16).toUpperCase().padStart(2, "0"))
        ascii += printable(slice[j])
      }
    }
    out.push({
      offset: "0x" + i.toString(16).toUpperCase().padStart(8, "0"),
      hex,
      ascii,
    })
  }
  return out
})

function printable(ch: string): string {
  const code = ch.charCodeAt(0)
  // Replace non-printable bytes with the standard hex-viewer dot.
  if (code < 0x20 || code > 0x7e) return "."
  return ch
}

const colHeaders = Array.from({ length: BYTES_PER_ROW }, (_, i) =>
  i.toString(16).toUpperCase().padStart(2, "0")
)

const totalLabel = computed(() => `${QUOTE.length} bytes total`)
</script>

<template>
  <div class="cl-hex-bg" aria-hidden="true">
    <div class="cl-hex-mask">
      <div class="cl-hex-pre">
        <div class="cl-hex-row cl-hex-head">
          <span class="cl-hex-offset cl-hex-label">Offset</span>
          <span class="cl-hex-cols">
            <span v-for="(h, i) in colHeaders" :key="i" class="cl-hex-col-h">
              {{ h }}
            </span>
          </span>
          <span class="cl-hex-label">ASCII</span>
        </div>

        <div v-for="(row, idx) in rows" :key="idx" class="cl-hex-row">
          <span class="cl-hex-offset">{{ row.offset }}</span>
          <span class="cl-hex-cols">
            <span v-for="(byte, bIdx) in row.hex" :key="bIdx" class="cl-hex-byte">
              {{ byte }}
            </span>
          </span>
          <span class="cl-hex-ascii">{{ row.ascii }}</span>
        </div>

        <div class="cl-hex-row cl-hex-foot">
          <span class="cl-hex-offset"></span>
          <span class="cl-hex-total">{{ totalLabel }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cl-hex-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
  /* Sit on the page surface so the hero blends with the rest of the
     page in both themes — text colours below adapt per theme. */
  background: var(--vp-c-bg);
  /* Light theme defaults — desaturated stone greys that read on the
     warm-stone page background. Dark theme overrides below. */
  --cl-hex-fg: #7a8294;
  --cl-hex-head: #8a93a6;
  --cl-hex-offset: #aab2c0;
  --cl-hex-byte: #6e7889;
  --cl-hex-ascii: #2a6f78;
}

/* Anchor the hex viewer to the centre, then mask outwards so the
   headline copy sits on a quiet middle band. The actual rendering
   is just text — we let it bleed off the edges on narrow viewports
   instead of trying to scale the text. */
.cl-hex-mask {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Radial fade — the centre stays clear, the edges fade in. */
  -webkit-mask-image: radial-gradient(
    ellipse 65% 75% at 50% 50%,
    transparent 0%,
    rgba(0, 0, 0, 0.55) 45%,
    rgba(0, 0, 0, 0.85) 80%,
    rgba(0, 0, 0, 0.95) 100%
  );
  mask-image: radial-gradient(
    ellipse 65% 75% at 50% 50%,
    transparent 0%,
    rgba(0, 0, 0, 0.55) 45%,
    rgba(0, 0, 0, 0.85) 80%,
    rgba(0, 0, 0, 0.95) 100%
  );
}

.cl-hex-pre {
  margin: 0;
  padding: 0;
  font-family: var(
    --vp-font-family-mono,
    ui-monospace,
    SFMono-Regular,
    Menlo,
    Consolas,
    monospace
  );
  /* Reduced ~10% from 14px so the hex viewer feels less dominant
     against the hero copy. */
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--cl-hex-fg);
  letter-spacing: 0;
  /* Slightly de-emphasise so the hero text reads first. */
  opacity: 0.55;
  display: grid;
  gap: 0;
  /* Each row is a fixed-width hex dump; never let it wrap or get
     squeezed. The hex viewer is purely decorative (aria-hidden) and
     bleeds off the edges via the surrounding mask, so it's safe to
     overflow rather than reflow on narrow viewports. */
  white-space: nowrap;
}

.cl-hex-row {
  display: grid;
  grid-template-columns: 10ch 47ch auto;
  column-gap: 3ch;
  align-items: baseline;
  /* Belt-and-braces: stop any individual cell from wrapping. */
  white-space: nowrap;
}

.cl-hex-head {
  color: var(--cl-hex-head);
}

.cl-hex-foot {
  margin-top: 8px;
  color: var(--cl-hex-head);
}

.cl-hex-cols {
  display: grid;
  grid-template-columns: repeat(16, 2ch);
  column-gap: 1ch;
}

.cl-hex-label,
.cl-hex-col-h {
  color: var(--cl-hex-head);
}

.cl-hex-offset {
  color: var(--cl-hex-offset);
}

.cl-hex-byte {
  color: var(--cl-hex-byte);
}

.cl-hex-ascii {
  color: var(--cl-hex-ascii);
  letter-spacing: 0.02em;
}

.cl-hex-total {
  color: var(--cl-hex-head);
}

@media (max-width: 768px) {
  .cl-hex-pre {
    /* Reduced ~10% from 11px to match the desktop trim and to keep
       the hex dump unobtrusive on smaller viewports. */
    font-size: 10px;
    opacity: 0.45;
  }
  .cl-hex-mask {
    -webkit-mask-image: radial-gradient(
      ellipse 75% 80% at 50% 50%,
      transparent 0%,
      rgba(0, 0, 0, 0.6) 40%,
      rgba(0, 0, 0, 0.95) 90%
    );
    mask-image: radial-gradient(
      ellipse 75% 80% at 50% 50%,
      transparent 0%,
      rgba(0, 0, 0, 0.6) 40%,
      rgba(0, 0, 0, 0.95) 90%
    );
  }
}

</style>

<!-- Dark-theme overrides for the hex viewer palette. Lives in an
     unscoped block because Vue's scoped CSS compiler mangles a
     `:global(html.dark)` prefix into a bare `html.dark { … }` rule
     that dims/colour-shifts the whole page. The defaults above target
     light mode; we only need to swap accent colours here. -->
<style>
html.dark .cl-hex-bg {
  --cl-hex-fg: #6b7a90;
  --cl-hex-head: #7e8fa8;
  --cl-hex-offset: #5a6a82;
  --cl-hex-byte: #94a4bd;
  --cl-hex-ascii: #75fbfd;
}
</style>
