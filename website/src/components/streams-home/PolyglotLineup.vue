<script setup lang="ts">
import MarkdownContent from "../MarkdownContent.vue"
import MdExportExplicit from "../MdExportExplicit.vue"
import { useMarkdownExport } from "../../lib/useMarkdownExport"
import { ref, watch, onMounted, onBeforeUnmount } from "vue"
import { useDemoVisibility } from "../../../.vitepress/theme/composables/useDemoVisibility"

interface CardLine {
  html: string
  receive?: boolean
}

interface Card {
  lang: string
  icon: string
  tagline: string
  lines: CardLine[]
}

const cards: Card[] = [
  {
    lang: "TypeScript",
    icon: "TS",
    tagline: "browser · Node · Edge · Workers",
    lines: [
      {
        html: `<span class="kw">import</span> { stream } <span class="kw">from</span> <span class="str">'@durable-streams/client'</span>`,
      },
      { html: "" },
      {
        html: `<span class="kw">for await</span> (<span class="kw">const</span> m <span class="kw">of</span> stream({`,
      },
      { html: `  url: STREAM_URL, live: <span class="str">'sse'</span>` },
      { html: `})) render(m)`, receive: true },
    ],
  },
  {
    lang: "Python",
    icon: "Py",
    tagline: "data scientists · workers",
    lines: [
      {
        html: `<span class="kw">from</span> durable_streams <span class="kw">import</span> stream`,
      },
      { html: "" },
      {
        html: `<span class="kw">with</span> stream(STREAM_URL, live=<span class="str">'sse'</span>) <span class="kw">as</span> r:`,
      },
      {
        html: `  <span class="kw">for</span> x <span class="kw">in</span> r.iter_json():`,
        receive: true,
      },
      { html: `    process(x)` },
    ],
  },
  {
    lang: "Swift",
    icon: "Sw",
    tagline: "iOS · macOS app",
    lines: [
      { html: `<span class="kw">let</span> task = URLSession.shared` },
      { html: `  .dataTask(with: URLRequest(url: URL(...)))` },
      { html: `task.resume()` },
      {
        html: `<span class="cm">// SSE lines parsed by EventSource</span>`,
        receive: true,
      },
    ],
  },
  {
    lang: "Go",
    icon: "Go",
    tagline: "servers · AnyCable · Rails",
    lines: [
      { html: `resp, _ := http.Get(STREAM_URL)` },
      { html: `scanner := bufio.NewScanner(resp.Body)` },
      { html: `<span class="kw">for</span> scanner.Scan() {`, receive: true },
      { html: `  handle(scanner.Bytes())` },
      { html: `}` },
    ],
  },
  {
    lang: "curl",
    icon: "$_",
    tagline: "shell · scripts · debugging",
    lines: [
      { html: `curl -N <span class="str">"$URL?live=sse"</span>` },
      { html: "" },
      { html: `<span class="cm"># prints SSE</span>` },
      { html: `<span class="cm"># data: lines</span>`, receive: true },
    ],
  },
]

const markdownCards = [
  `GET https://api.streams.dev/v1/stream/chat-42?live=sse`,
  ...cards.map(
    (card) => `### ${card.lang}

${card.tagline}

\`\`\`
${card.lines.map((line) => line.html.replace(/<[^>]+>/g, "")).join("\n")}
\`\`\``
  ),
].join("\n\n")

interface BannerEvent {
  text: string
  cursor: boolean
}

const FIXTURE_LINES = [
  `data: {"role":"user","text":"Hello"}`,
  `data: {"role":"assistant","text":"Hi there!"}`,
  `data: {"role":"user","text":"What time is it?"}`,
  `data: {"role":"assistant","text":"Almost noon."}`,
  `data: {"role":"user","text":"Thanks!"}`,
]

const STEADY_STATE: BannerEvent[] = [
  { text: FIXTURE_LINES[0], cursor: false },
  { text: FIXTURE_LINES[1], cursor: true },
]

const rootRef = ref<HTMLElement>()
const isActive = useDemoVisibility(rootRef)
const isMarkdownExport = useMarkdownExport()

const visibleEvents = ref<BannerEvent[]>([...STEADY_STATE])
const pulsingCards = ref<Set<number>>(new Set())

let cycleIdx = 1
let tickTimer: number | null = null
const pulseTimers: number[] = []

function clearTimers() {
  if (tickTimer !== null) {
    window.clearInterval(tickTimer)
    tickTimer = null
  }
  pulseTimers.forEach((t) => window.clearTimeout(t))
  pulseTimers.length = 0
  pulsingCards.value = new Set()
}

function tick() {
  cycleIdx = (cycleIdx + 1) % FIXTURE_LINES.length
  const next = FIXTURE_LINES[cycleIdx]
  const prev = visibleEvents.value[1]?.text ?? FIXTURE_LINES[0]
  visibleEvents.value = [
    { text: prev, cursor: false },
    { text: next, cursor: true },
  ]

  cards.forEach((_, i) => {
    pulseTimers.push(
      window.setTimeout(() => {
        const next = new Set(pulsingCards.value)
        next.add(i)
        pulsingCards.value = next
        pulseTimers.push(
          window.setTimeout(() => {
            const cleared = new Set(pulsingCards.value)
            cleared.delete(i)
            pulsingCards.value = cleared
          }, 420)
        )
      }, i * 90)
    )
  })
}

function start() {
  clearTimers()
  visibleEvents.value = [...STEADY_STATE]
  cycleIdx = 1
  tickTimer = window.setInterval(tick, 1200)
}

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

onMounted(() => {
  if (reducedMotion()) {
    visibleEvents.value = [...STEADY_STATE]
    return
  }
  watch(
    isActive,
    (v) => {
      if (v) start()
      else clearTimers()
    },
    { immediate: true }
  )
})

onBeforeUnmount(() => {
  clearTimers()
})
</script>

<template>
  <MdExportExplicit v-if="isMarkdownExport">
    <MarkdownContent>{{ markdownCards }}</MarkdownContent>
  </MdExportExplicit>
  <div v-else ref="rootRef" class="pl">
    <span class="sr-only">
      A single HTTP stream URL is consumed by five clients written in
      TypeScript, Python, Swift, Go and curl. Each receives the same
      server-sent events.
    </span>

    <div class="pl-banner" aria-hidden="true">
      <div class="pl-banner-url">
        <span class="pl-banner-method">GET</span>
        <span class="pl-banner-host"
          >https://api.streams.dev/v1/stream/chat-42</span
        ><span class="pl-banner-q">?live=sse</span>
      </div>
      <div class="pl-banner-divider" />
      <div class="pl-banner-stream">
        <transition-group name="pl-line" tag="div" class="pl-banner-lines">
          <div
            v-for="ev in visibleEvents"
            :key="ev.text"
            class="pl-banner-line"
          >
            <span class="pl-banner-line-text">{{ ev.text }}</span
            ><span v-if="ev.cursor" class="pl-banner-cursor">▍</span>
          </div>
        </transition-group>
      </div>
    </div>

    <div class="pl-caption">one URL, every client</div>

    <div class="pl-grid" aria-hidden="true">
      <div
        v-for="(c, ci) in cards"
        :key="c.lang"
        class="pl-card"
        :class="{ 'pl-card--pulse': pulsingCards.has(ci) }"
      >
        <div class="pl-card-head">
          <span class="pl-card-icon">{{ c.icon }}</span>
          <span class="pl-card-lang">{{ c.lang }}</span>
        </div>
        <pre class="pl-card-code"><code><span
          v-for="(line, li) in c.lines"
          :key="li"
          class="pl-line-row"
          :class="{
            'pl-line-row--receive': line.receive,
            'pl-line-row--blank': !line.html,
            'pl-line-row--pulse': line.receive && pulsingCards.has(ci),
          }"
        ><span class="pl-line-content" v-html="line.html || '&#8203;'" /></span></code></pre>
        <div class="pl-card-foot">{{ c.tagline }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pl {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* ── Banner ────────────────────────────────────────────────────────────── */

.pl-banner {
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  padding: 14px 18px;
  background: var(--ea-surface-alt);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  box-shadow: inset 0 1px 0 0
    color-mix(in srgb, var(--ea-divider) 60%, transparent);
}

.pl-banner-url {
  color: var(--ea-text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.5;
}

.pl-banner-method {
  color: var(--vp-c-brand-1);
  font-weight: 700;
  margin-right: 8px;
}

.pl-banner-host {
  color: var(--ea-text-1);
}

.pl-banner-q {
  color: var(--ea-text-2);
}

.pl-banner-divider {
  margin: 10px 0;
  height: 1px;
  background: var(--ea-divider);
}

.pl-banner-stream {
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  color: var(--ea-text-2);
  min-height: 38px;
  position: relative;
}

.pl-banner-lines {
  position: relative;
}

.pl-banner-line {
  display: block;
  line-height: 1.55;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: color-mix(in srgb, var(--vp-c-brand-1) 75%, var(--ea-text-2));
}

.pl-banner-line-text {
  color: inherit;
}

.pl-banner-cursor {
  display: inline-block;
  margin-left: 2px;
  color: var(--vp-c-brand-1);
  transform: translateY(1px);
}

@media (prefers-reduced-motion: no-preference) {
  .pl-banner-cursor {
    animation: pl-blink 1s steps(2, start) infinite;
  }
}

@keyframes pl-blink {
  to {
    opacity: 0;
  }
}

.pl-line-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}
.pl-line-enter-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.pl-line-leave-active {
  position: absolute;
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.pl-line-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

@media (prefers-reduced-motion: reduce) {
  .pl-line-enter-active,
  .pl-line-leave-active {
    transition: none;
  }
}

/* ── Caption ──────────────────────────────────────────────────────────── */

.pl-caption {
  text-align: center;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--ea-text-2);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-top: -2px;
}

/* ── Grid ─────────────────────────────────────────────────────────────── */

.pl-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.pl-card {
  display: flex;
  flex-direction: column;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  overflow: hidden;
  min-width: 0;
  min-height: 148px;
}

.pl-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--ea-surface-alt);
  border-bottom: 1px solid var(--ea-divider);
}

.pl-card-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 18px;
  padding: 0 5px;
  border: 1px solid var(--ea-divider);
  border-radius: 4px;
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 700;
  color: var(--ea-text-1);
  letter-spacing: 0.04em;
  background: var(--ea-surface);
}

.pl-card-lang {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  font-weight: 700;
  color: var(--ea-text-1);
  letter-spacing: 0.01em;
}

.pl-card-code {
  flex: 1;
  margin: 0;
  padding: 10px 12px;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  line-height: 1.45;
  color: var(--ea-text-2);
  overflow-x: auto;
  background: var(--ea-surface);
}

.pl-card-code code {
  display: block;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  background: none;
  padding: 0;
  white-space: pre;
}

.pl-line-row {
  display: block;
  padding: 0 4px;
  margin: 0 -4px;
  border-radius: 3px;
  transition: background 0.5s ease;
}

.pl-line-row--blank {
  min-height: 1.45em;
}

.pl-line-row--pulse {
  background: color-mix(in srgb, var(--vp-c-brand-1) 8%, transparent);
}

/* Keep a single accent in the syntax highlighting: only string
   literals (URLs, mode names, package paths) render in the brand
   colour. Keywords drop down to a slightly muted text-1 so each
   card reads as ordinary code with one meaningful value popping —
   instead of every `import`/`for`/`const`/`with` shouting in
   primary, which made the cards feel over-coloured. */
.pl-line-content :deep(.kw) {
  color: color-mix(in srgb, var(--ea-text-1) 75%, transparent);
}
.pl-line-content :deep(.str) {
  color: var(--vp-c-brand-1);
}
.pl-line-content :deep(.cm) {
  color: color-mix(in srgb, var(--ea-text-2) 85%, transparent);
  font-style: italic;
}

.pl-card-foot {
  padding: 8px 12px;
  border-top: 1px solid var(--ea-divider);
  background: var(--ea-surface-alt);
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--ea-text-2);
  text-align: center;
  letter-spacing: 0.01em;
}

/* ── Responsive ───────────────────────────────────────────────────────── */

@media (max-width: 1100px) {
  .pl-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .pl-banner {
    font-size: 12px;
    padding: 12px 14px;
  }
  .pl-banner-stream {
    font-size: 11.5px;
  }
  .pl-grid {
    display: flex;
    grid-template-columns: none;
    gap: 12px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    padding: 4px 16px;
    margin: 0 -16px;
    scrollbar-width: none;
  }
  .pl-grid::-webkit-scrollbar {
    display: none;
  }
  .pl-card {
    flex: 0 0 calc(100% - 32px);
    max-width: 320px;
    scroll-snap-align: center;
  }
}

@media (max-width: 480px) {
  .pl-banner-url {
    font-size: 11.5px;
  }
}

/* ── Reduced motion ───────────────────────────────────────────────────── */

@media (prefers-reduced-motion: reduce) {
  .pl-line-row {
    transition: none;
  }
  .pl-line-row--pulse {
    background: transparent;
  }
}
</style>
