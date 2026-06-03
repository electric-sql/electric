<script setup lang="ts">
/* AppAgentResponse — Horton response with streaming typewriter.
   ─────────────────────────────────────────────────────────────────
   The animated centrepiece of the desktop hero. Renders a fixed fixture
   string (paragraph + fenced code block + paragraph + tool-call pill)
   character-by-character at `cps` chars/sec.

   State machine:

     idle       → caret only, no body painted (used briefly between
                  loops to read as "ready")
     thinking   → small "Thinking…" line with a pulsing dot trio
                  (we render this when `state === 'thinking'`; not
                  driven by progress)
     streaming  → the body materialises from left→right at `cps`
                  chars/sec; caret follows the cursor
     completed  → full body, no caret

   Loop behaviour:
     stream → hold 3 s on completed end-state → snap to 0 → stream again

   Lifecycle hooks:
     - IntersectionObserver gates the RAF start. The RAF loop is only
       started after the toy intersects the viewport once. This keeps
       offscreen toys cheap and means the App-page hero starts the
       typewriter the moment it scrolls into view.
     - `paused` freezes the timer in place (does NOT reset progress).
     - `progress` (0..1) is a manual scrub override — when supplied,
       the driver doesn't run the internal loop; the caller drives.
       Useful for screenshot framing.
     - `prefers-reduced-motion: reduce` snaps to completed end-state
       and skips the loop.

   Pure primitive — does NOT include `.app-mockup-root`. */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CHAT_FIXTURE, CHAT_FIXTURE_LENGTH } from '../../fixtures'

type ResponseState = 'idle' | 'thinking' | 'streaming' | 'completed'

const props = withDefaults(
  defineProps<{
    state?: ResponseState
    /** Manual scrub — overrides the internal RAF driver when set. */
    progress?: number | null
    /** Freeze the internal driver in place (does not reset progress). */
    paused?: boolean
    /** Chars-per-second target for the streaming loop. */
    cps?: number
    /** Render the fenced code block segment. Defaults to `true`. */
    hasCodeBlock?: boolean
    /** Render the trailing tool-call pill. Defaults to `true`. */
    hasToolCall?: boolean
  }>(),
  {
    state: 'streaming',
    progress: null,
    paused: false,
    cps: 60,
    hasCodeBlock: true,
    hasToolCall: true,
  }
)

const HOLD_AFTER_COMPLETION_MS = 3000

const internalProgress = ref(0)
const effectiveProgress = computed(() => {
  if (props.progress !== null && props.progress !== undefined) {
    return Math.max(0, Math.min(1, props.progress))
  }
  if (props.state === 'completed') return 1
  if (props.state === 'idle' || props.state === 'thinking') return 0
  return internalProgress.value
})

const reducedMotion = ref(false)
const rootEl = ref<HTMLElement | null>(null)
const hasIntersected = ref(false)

const driven = computed(
  () =>
    props.state === 'streaming' &&
    !props.paused &&
    !reducedMotion.value &&
    hasIntersected.value &&
    (props.progress === null || props.progress === undefined)
)

let raf: number | null = null
let lastT = 0
let holdUntil = 0

function tick(t: number) {
  if (!driven.value) {
    raf = null
    return
  }
  if (lastT === 0) lastT = t
  const dt = (t - lastT) / 1000
  lastT = t

  if (internalProgress.value >= 1) {
    if (holdUntil === 0) holdUntil = t + HOLD_AFTER_COMPLETION_MS
    if (t >= holdUntil) {
      internalProgress.value = 0
      holdUntil = 0
    }
  } else {
    internalProgress.value = Math.min(
      1,
      internalProgress.value + (dt * props.cps) / CHAT_FIXTURE_LENGTH
    )
  }
  raf = requestAnimationFrame(tick)
}

watch(driven, (on) => {
  if (on) {
    lastT = 0
    holdUntil = 0
    raf = requestAnimationFrame(tick)
  } else if (raf !== null) {
    cancelAnimationFrame(raf)
    raf = null
  }
})

let observer: IntersectionObserver | null = null

onMounted(() => {
  if (typeof window === 'undefined') return

  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    reducedMotion.value = true
    internalProgress.value = 1
  }

  if (!rootEl.value) return
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          hasIntersected.value = true
          observer?.disconnect()
          observer = null
          break
        }
      }
    },
    { threshold: 0.1 }
  )
  observer.observe(rootEl.value)
})

onBeforeUnmount(() => {
  if (raf !== null) {
    cancelAnimationFrame(raf)
    raf = null
  }
  if (observer) {
    observer.disconnect()
    observer = null
  }
})

/* ───────── Fixture splitting ─────────
   Split the fixture into [pre, code, post] segments at the fenced
   ```ts ... ``` block. Each segment carries its [startChar, endChar]
   range so we can compute "how many chars of THIS segment are visible
   given the global progress" without re-walking the string each frame. */
const segments = computed(() => {
  const text = CHAT_FIXTURE.agentResponseText
  const total = text.length
  const fenceOpen = text.indexOf('```')
  if (fenceOpen < 0 || !props.hasCodeBlock) {
    return {
      pre: { text, start: 0, end: total },
      code: null as null | { text: string; start: number; end: number },
      post: null as null | { text: string; start: number; end: number },
      total,
    }
  }
  const codeStart = text.indexOf('\n', fenceOpen) + 1
  const fenceClose = text.indexOf('```', codeStart)
  const codeEnd = fenceClose
  const postStart = text.indexOf('\n', fenceClose + 3) + 1
  return {
    pre: {
      text: text.slice(0, fenceOpen).replace(/\n+$/, '').trimEnd(),
      start: 0,
      end: fenceOpen,
    },
    code: {
      text: text.slice(codeStart, codeEnd).replace(/\n+$/, ''),
      start: codeStart,
      end: codeEnd,
    },
    post: {
      text: text.slice(postStart).trimStart(),
      start: postStart,
      end: total,
    },
    total,
  }
})

function visibleSlice(segment: { text: string; start: number; end: number }) {
  const cursor = effectiveProgress.value * segments.value.total
  if (cursor <= segment.start) return ''
  if (cursor >= segment.end) return segment.text
  /* Map global cursor → local cursor proportionally. We work in
     ORIGINAL character offsets but render against the trimmed
     `segment.text` — so we scale the local cursor to the trimmed
     length. */
  const localOriginal = cursor - segment.start
  const localScaled = Math.floor(
    (localOriginal / (segment.end - segment.start)) * segment.text.length
  )
  return segment.text.slice(
    0,
    Math.max(0, Math.min(segment.text.length, localScaled))
  )
}

const visiblePre = computed(() => visibleSlice(segments.value.pre))
const visibleCode = computed(() =>
  segments.value.code ? visibleSlice(segments.value.code) : ''
)
const visiblePost = computed(() =>
  segments.value.post ? visibleSlice(segments.value.post) : ''
)

const caretSegment = computed<'pre' | 'code' | 'post' | 'done'>(() => {
  if (effectiveProgress.value >= 1) return 'done'
  const cursor = effectiveProgress.value * segments.value.total
  if (segments.value.code && cursor < segments.value.code.start) return 'pre'
  if (segments.value.code && cursor < segments.value.code.end) return 'code'
  if (segments.value.post) return 'post'
  return 'pre'
})

const toolCallVisible = computed(
  () =>
    props.hasToolCall &&
    effectiveProgress.value >= CHAT_FIXTURE.toolCall.appearAt
)

/* Render single-backtick inline code as <code class="inline-code">.
   v-html is safe here because the fixture is hand-crafted — we belt+brace
   by escaping HTML-special chars before re-introducing the <code> tag. */
function renderInline(input: string): string {
  if (!input) return ''
  const escaped = input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped.replace(
    /`([^`]+)`/g,
    (_, inner) => `<code class="inline-code">${inner}</code>`
  )
}
</script>

<template>
  <div ref="rootEl" class="agent-response-root" :data-state="state">
    <div class="agent-avatar" aria-hidden="true">
      <span class="agent-glyph" />
    </div>

    <div class="agent-body">
      <template v-if="state === 'thinking'">
        <div class="thinking">
          <span class="thinking-label">Thinking</span>
          <span class="thinking-dots">
            <span class="dot" /><span class="dot" /><span class="dot" />
          </span>
        </div>
      </template>

      <template v-else>
        <p class="paragraph">
          <span v-html="renderInline(visiblePre)" />
          <span
            v-if="caretSegment === 'pre'"
            class="caret"
            aria-hidden="true"
          />
        </p>

        <div v-if="hasCodeBlock && segments.code" class="code-slab">
          <div class="code-slab-tag mono">ts</div>
          <pre class="code-slab-body mono"><code>{{ visibleCode }}<span
              v-if="caretSegment === 'code'"
              class="caret"
              aria-hidden="true"
            /></code></pre>
        </div>

        <p v-if="segments.post" class="paragraph">
          <span v-html="renderInline(visiblePost)" />
          <span
            v-if="caretSegment === 'post'"
            class="caret"
            aria-hidden="true"
          />
        </p>

        <div
          v-if="hasToolCall"
          class="tool-call-pill"
          :data-visible="toolCallVisible ? 'true' : 'false'"
          aria-label="Tool call"
        >
          <span class="tool-call-chip mono">tool</span>
          <span class="tool-call-name mono">{{
            CHAT_FIXTURE.toolCall.name
          }}</span>
          <span class="tool-call-args mono">{{
            CHAT_FIXTURE.toolCall.args
          }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.agent-response-root {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  font-family: var(--ds-font-body);
  color: var(--ds-text-1);
  width: 100%;
}

/* ───────── Avatar ───────── */

.agent-avatar {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: var(--ds-radius-full);
  background: var(--ds-accent-a3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.agent-glyph {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: var(--ds-accent-9);
  position: relative;
}
.agent-glyph::before,
.agent-glyph::after {
  content: '';
  position: absolute;
  background: var(--ds-text-on-accent);
}
.agent-glyph::before {
  /* Lightning bolt left arm. */
  left: 5px;
  top: 2px;
  width: 2px;
  height: 6px;
  transform: skewX(-20deg);
}
.agent-glyph::after {
  /* Lightning bolt right arm. */
  right: 4px;
  bottom: 2px;
  width: 2px;
  height: 6px;
  transform: skewX(-20deg);
}

/* ───────── Body ───────── */

.agent-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 4px;
}

.paragraph {
  margin: 0;
  font-size: var(--ds-chat-text);
  line-height: var(--ds-chat-text-lh);
  color: var(--ds-text-1);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

:deep(.inline-code) {
  font-family: var(--ds-font-mono);
  font-size: 0.92em;
  background: var(--ds-chip-bg);
  border: 1px solid var(--ds-chip-border);
  padding: 0 4px;
  border-radius: var(--ds-radius-1);
  color: var(--ds-text-1);
}

/* ───────── Code slab ───────── */

.code-slab {
  position: relative;
  background: var(--ds-code-bg, var(--ds-surface-soft));
  border: 1px solid var(--ds-border-1);
  border-radius: var(--ds-radius-3);
  padding: 12px 14px;
  overflow: hidden;
}

.code-slab-tag {
  position: absolute;
  top: 8px;
  right: 10px;
  padding: 0 6px;
  border-radius: var(--ds-radius-1);
  background: var(--ds-chip-bg);
  border: 1px solid var(--ds-chip-border);
  color: var(--ds-text-3);
  font-size: 10px;
  line-height: 16px;
  text-transform: lowercase;
  letter-spacing: 0.04em;
}

.code-slab-body {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--ds-text-1);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.code-slab-body code {
  font-family: var(--ds-font-mono);
}

/* ───────── Caret ───────── */

.caret {
  display: inline-block;
  width: 1.5px;
  height: 1.05em;
  background: var(--ds-accent-9);
  vertical-align: text-bottom;
  margin-left: 1px;
  animation: agent-caret-blink 1s steps(2, start) infinite;
}

@keyframes agent-caret-blink {
  0%,
  50% {
    opacity: 1;
  }
  51%,
  100% {
    opacity: 0;
  }
}

/* ───────── Thinking dots ───────── */

.thinking {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ds-text-3);
  font-size: var(--ds-chat-text);
}
.thinking-dots {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.thinking-dots .dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.4;
  animation: thinking-pulse 1.2s ease-in-out infinite;
}
.thinking-dots .dot:nth-child(2) {
  animation-delay: 0.15s;
}
.thinking-dots .dot:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes thinking-pulse {
  0%,
  100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  50% {
    opacity: 1;
    transform: translateY(-1px);
  }
}

/* ───────── Tool-call pill ───────── */

.tool-call-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px 5px 5px;
  border: 1px solid var(--ds-border-1);
  border-radius: var(--ds-radius-3);
  background: var(--ds-surface-soft);
  align-self: flex-start;
  opacity: 0;
  transform: translateY(4px);
  transition:
    opacity 220ms ease,
    transform 220ms ease;
  pointer-events: none;
}
.tool-call-pill[data-visible='true'] {
  opacity: 1;
  transform: translateY(0);
}

.tool-call-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--ds-radius-1);
  background: var(--ds-accent-a3);
  color: var(--ds-accent-11, var(--ds-accent-9));
  font-size: 10px;
  line-height: 1;
  text-transform: lowercase;
  letter-spacing: 0.04em;
}

.tool-call-name {
  font-size: 12px;
  color: var(--ds-text-1);
}

.tool-call-args {
  font-size: 12px;
  color: var(--ds-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 280px;
}

/* ───────── Reduced motion ───────── */

@media (prefers-reduced-motion: reduce) {
  .caret,
  .thinking-dots .dot,
  .tool-call-pill {
    animation: none !important;
    transition: none !important;
  }
  .tool-call-pill {
    opacity: 1;
    transform: none;
  }
}
</style>
