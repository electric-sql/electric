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
  background: #0d1117;
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
  font-size: 14px;
  line-height: 1.55;
  color: #6b7a90;
  letter-spacing: 0;
  /* Slightly de-emphasise so the hero text reads first. */
  opacity: 0.55;
  text-shadow: 0 0 1px rgba(0, 0, 0, 0.4);
  display: grid;
  gap: 0;
}

.cl-hex-row {
  display: grid;
  grid-template-columns: 10ch 47ch auto;
  column-gap: 3ch;
  align-items: baseline;
}

.cl-hex-head {
  color: #7e8fa8;
}

.cl-hex-foot {
  margin-top: 8px;
  color: #7e8fa8;
}

.cl-hex-cols {
  display: grid;
  grid-template-columns: repeat(16, 2ch);
  column-gap: 1ch;
}

.cl-hex-label,
.cl-hex-col-h {
  color: #7e8fa8;
}

.cl-hex-offset {
  color: #5a6a82;
}

.cl-hex-byte {
  color: #94a4bd;
}

.cl-hex-ascii {
  color: #75fbfd;
  letter-spacing: 0.02em;
}

.cl-hex-total {
  color: #7e8fa8;
}

@media (max-width: 768px) {
  .cl-hex-pre {
    font-size: 11px;
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

/* Light theme: the hex viewer is a dark panel either way, but we
   raise contrast slightly so it doesn't look muddy. */
:global(html:not(.dark)) .cl-hex-pre {
  opacity: 0.6;
}
</style>
