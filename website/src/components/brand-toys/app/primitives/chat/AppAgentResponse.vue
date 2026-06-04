<script setup lang="ts">
/* AppAgentResponse — Horton response with streaming typewriter.
   ─────────────────────────────────────────────────────────────────
   The animated centrepiece of the desktop hero. Renders a fixed fixture
   string (paragraph + fenced code block + paragraph + tool-call card).

   Streaming is word-by-word — the global progress cursor advances at
   `cps` chars/sec smoothly, but the rendered text snaps DOWN to the
   last whitespace boundary the cursor has crossed. So instead of
   revealing one character per frame (which reads as a typewriter,
   not an LLM), whole words appear in chunks every ~80-100 ms — closer
   to how real LLM clients render token streams.

   State machine:

     idle       → caret only, no body painted (used briefly between
                  loops to read as "ready")
     thinking   → small "Thinking…" line with a pulsing dot trio
                  (we render this when `state === 'thinking'`; not
                  driven by progress)
     streaming  → the body materialises word-by-word at `cps`
                  chars/sec; caret follows the last revealed word
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
import { ChevronRight, Copy, Download, Wrench } from 'lucide-vue-next'
import AppIcon from '../AppIcon.vue'
import { CHAT_FIXTURES, type ChatFixtureKey } from '../../fixtures'

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
    /** Time string shown in the meta row (e.g. "14:59"). */
    timestamp?: string
    /** Which `CHAT_FIXTURES` variant to render. Defaults to
     *  `'default'` — the generic createSession-refactor demo used
     *  by the hero stage. Other variants tailor the response prose
     *  to a specific scenario card on the /app page. */
    fixtureKey?: ChatFixtureKey
  }>(),
  {
    state: 'streaming',
    progress: null,
    paused: false,
    cps: 60,
    hasCodeBlock: true,
    hasToolCall: true,
    timestamp: '14:59',
    fixtureKey: 'default',
  }
)

const fixture = computed(() => CHAT_FIXTURES[props.fixtureKey])
const fixtureLength = computed(() => fixture.value.agentResponseText.length)

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
      internalProgress.value + (dt * props.cps) / fixtureLength.value
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
  const text = fixture.value.agentResponseText
  const total = text.length
  const fenceOpen = text.indexOf('```')
  if (fenceOpen < 0 || !props.hasCodeBlock) {
    return {
      pre: { text, start: 0, end: total },
      code: null as null | { text: string; start: number; end: number },
      post: null as null | { text: string; start: number; end: number },
      total,
      lang: 'ts' as string,
    }
  }
  /* Detect the language tag right after the opening fence — the
     fixtures lock in `ts` (default), `sh` (parallel-workers,
     overnight-research), etc. We render the tag in the code-block
     header so the demo reads as multi-language even though we
     don't actually run the body through Shiki. */
  const fenceTagEnd = text.indexOf('\n', fenceOpen)
  const lang = text.slice(fenceOpen + 3, fenceTagEnd).trim() || 'ts'
  const codeStart = fenceTagEnd + 1
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
    lang,
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
  const charEnd = Math.max(0, Math.min(segment.text.length, localScaled))
  return segment.text.slice(0, snapToWordEnd(segment.text, charEnd))
}

/* ───────── Word-boundary snap ─────────
   Round `end` DOWN to the largest position ≤ `end` that sits at a
   whitespace boundary (so we never render a partial word). Returns 0
   while we're still inside the very first word — the caret marks the
   "next word inbound" beat without revealing characters of the word
   itself. This gives the chunked-token feel readers know from
   ChatGPT / Claude streaming UIs.

   Whitespace = ASCII space, tab, CR, LF, NBSP. Punctuation is treated
   as part of the surrounding word — we deliberately don't break on
   `(){}[].,;:`'"` etc. because tokens like `'@electric/auth'` or
   `createSession(jwt)` should reveal as a single chunk, not split
   mid-identifier. */
function snapToWordEnd(text: string, end: number): number {
  if (end >= text.length) return text.length
  for (let i = end - 1; i >= 0; i--) {
    const c = text.charCodeAt(i)
    /* space, tab, LF, CR, NBSP */
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 160) {
      return i + 1
    }
  }
  return 0
}

const visiblePre = computed(() => visibleSlice(segments.value.pre))
const visibleCode = computed(() =>
  segments.value.code ? visibleSlice(segments.value.code) : ''
)
const visiblePost = computed(() =>
  segments.value.post ? visibleSlice(segments.value.post) : ''
)

/* ───────── Reveal gates ─────────
   Block-level elements only mount once the streaming cursor crosses
   their segment start. This matches how a real model client renders
   token streams: the code-fence well materialises when the assistant
   emits ```, not at message creation; the post paragraph appears as
   prose resumes after the fence. Without these gates the empty
   containers reserve their natural height and the response reads
   as "lots of empty boxes filling in" instead of "blocks materialising
   one after another". */
const cursorPos = computed(() => effectiveProgress.value * segments.value.total)
const codeBlockMounted = computed(
  () =>
    props.hasCodeBlock &&
    segments.value.code !== null &&
    cursorPos.value >= segments.value.code.start
)
const postParagraphMounted = computed(
  () =>
    segments.value.post !== null && cursorPos.value >= segments.value.post.start
)

const caretSegment = computed<'pre' | 'code' | 'post' | 'done'>(() => {
  if (effectiveProgress.value >= 1) return 'done'
  if (segments.value.code && cursorPos.value < segments.value.code.start)
    return 'pre'
  if (segments.value.code && cursorPos.value < segments.value.code.end)
    return 'code'
  if (segments.value.post) return 'post'
  return 'pre'
})

const toolCallVisible = computed(() => {
  if (!props.hasToolCall || fixture.value.toolCall === null) return false
  /* If a fixture sets a manual `appearAt` ratio, honour it as an
     override. Otherwise fire the tool-call card a small lead before
     the code block reveals — every default fixture's code block IS
     the tool's result, so the natural rhythm reads as
     "agent prepares → tool call → code result". The lead value
     (~28 chars at 60 cps ≈ 0.4 s) gives the tool-call's enter
     transition time to settle before the code block fades in below
     it. */
  const manual = fixture.value.toolCall.appearAt
  if (manual !== undefined) {
    return effectiveProgress.value >= manual
  }
  if (segments.value.code) {
    const TOOL_CALL_LEAD_CHARS = 28
    const trigger = Math.max(
      0,
      segments.value.code.start - TOOL_CALL_LEAD_CHARS
    )
    return cursorPos.value >= trigger
  }
  /* No code block AND no manual override — never show. Fixtures
     without a code block need to opt-in via `appearAt`. */
  return false
})

/** Show the meta row (✓ done · time · copy) once the streaming run has
 * completed — matches the live AgentResponse, which only paints the
 * meta row when `done === true` is on the section. */
const showMetaRow = computed(
  () => props.state === 'completed' || effectiveProgress.value >= 1
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
        <span v-if="caretSegment === 'pre'" class="caret" aria-hidden="true" />
      </p>

      <Transition name="reveal">
        <div
          v-if="hasToolCall && toolCallVisible && fixture.toolCall"
          class="tool-call-card"
          aria-label="Tool call"
        >
          <div class="tool-call-header">
            <span class="tool-call-icon" aria-hidden="true">
              <AppIcon :icon="Wrench" :size="2" />
            </span>
            <span class="tool-call-name mono">{{ fixture.toolCall.name }}</span>
            <span class="tool-call-summary">{{ fixture.toolCall.args }}</span>
            <span class="tool-call-toggle" aria-hidden="true">
              <AppIcon :icon="ChevronRight" :size="1" />
            </span>
          </div>
        </div>
      </Transition>

      <Transition name="reveal">
        <div v-if="codeBlockMounted" class="code-block">
          <div class="code-block-row">
            <div class="code-block-header">
              <span>{{ segments.lang }}</span>
            </div>
            <div class="code-block-actions" aria-hidden="true">
              <span class="code-block-action-btn" title="Copy code">
                <AppIcon :icon="Copy" :size="1" />
              </span>
              <span class="code-block-action-btn" title="Download code">
                <AppIcon :icon="Download" :size="1" />
              </span>
            </div>
          </div>
          <div class="code-block-body">
            <pre class="mono"><code>{{ visibleCode }}<span
              v-if="caretSegment === 'code'"
              class="caret"
              aria-hidden="true"
            /></code></pre>
          </div>
        </div>
      </Transition>

      <Transition name="reveal">
        <p v-if="postParagraphMounted" class="paragraph">
          <span v-html="renderInline(visiblePost)" />
          <span
            v-if="caretSegment === 'post'"
            class="caret"
            aria-hidden="true"
          />
        </p>
      </Transition>

      <!--
        Meta row at the bottom of the response: ✓ done · time + copy
        button on the right. Only appears once streaming has completed,
        matching the live AgentResponse component (which only renders
        this row when the section's `done === true`).
      -->
      <div
        class="meta-row"
        :data-visible="showMetaRow ? 'true' : 'false'"
        aria-hidden="true"
      >
        <span class="meta-done">✓ done</span>
        <span class="meta-sep">·</span>
        <span class="meta-time">{{ timestamp }}</span>
        <span class="meta-copy" title="Copy response">
          <AppIcon :icon="Copy" :size="1" />
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* Mirrors `AgentResponse.module.css` `.root`:
     margin-inline: auto; width: max(0px, calc(100% - 24px));
   That keeps the agent text column 12-px in from each edge of the
   user-bubble surface above — so the bubble's rounded corners visually
   wrap around the agent column rather than running flush. */
.agent-response-root {
  margin-inline: auto;
  width: max(0px, calc(100% - 24px));
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-family: var(--ds-font-body);
  color: var(--ds-text-1);
}

/* ───────── Body ───────── */

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

/* ───────── Code block ─────────
   Mirrors `MarkdownCodeBlock.tsx` + `markdown.css` — a 2-row layout:

     ┌──────────────────────────────────────────────────┐
     │ ts                          [copy] [download]    │  .code-block-row
     ├──────────────────────────────────────────────────┤
     │ <pre><code>…</code></pre>                        │  .code-block-body
     └──────────────────────────────────────────────────┘

   The header row sits ABOVE the bordered body. Language label is plain
   muted mono text on the left; copy + download icon-buttons sit on the
   right. Body has its own border + tinted background, slightly darker
   than the surface so the code reads as inset content. */

.code-block {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.code-block-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 16px;
  padding: 0 2px;
  gap: 8px;
}

.code-block-header {
  display: inline-flex;
  align-items: center;
  color: var(--ds-text-3);
  font-family: var(--ds-font-body);
  font-size: var(--ds-text-xs);
  line-height: 1;
  min-width: 0;
}
.code-block-header span {
  font-family: var(--ds-font-mono);
  text-transform: lowercase;
}

.code-block-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.code-block-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--ds-radius-2);
  color: var(--ds-text-4, var(--ds-text-3));
  opacity: 0.7;
}

.code-block-body {
  background: color-mix(in oklab, var(--ds-bg) 72%, var(--ds-surface));
  border: 1px solid var(--ds-gray-a4, var(--ds-border-1));
  border-radius: var(--ds-radius-3);
  padding: 9px 11px;
  overflow-x: auto;
}

.code-block-body pre {
  margin: 0;
  padding: 0;
  background: none;
  border-radius: 0;
}

.code-block-body code {
  font-family: var(--ds-font-mono);
  font-size: var(--ds-text-xs);
  line-height: 1.5;
  color: var(--ds-text-1);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
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

/* ───────── Tool-call card ─────────
   Mirrors `InlineEventCard` + `toolBlock.module.css` — a full-width
   card with a tinted header strip. The collapsed shape is:

     ┌──────────────────────────────────────────────────┐
     │ [🔧] tool_name  summary…              [chevron]  │  .tool-call-header
     └──────────────────────────────────────────────────┘

   - Card: 1px gray-a3 border, radius-4, surface bg, shadow-1
   - Header: gap 8, padding 7px 10px, mono 12px, gray-a1 tinted bg
   - Wrench icon (18×18), tool name (mono), summary (body, ellipsis),
     chevron (16×16 right). */

.tool-call-card {
  border: 1px solid var(--ds-gray-a3, var(--ds-border-1));
  border-radius: var(--ds-radius-4);
  overflow: hidden;
  background: var(--ds-surface);
  box-shadow: var(--ds-shadow-1);
}

.tool-call-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  font-size: 12px;
  line-height: 1.45;
  font-family: var(--ds-font-mono);
  color: var(--ds-text-1);
  background: var(--ds-gray-a1, transparent);
}

.tool-call-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--ds-text-3);
}

.tool-call-name {
  flex-shrink: 0;
  font-family: var(--ds-font-mono);
}

.tool-call-summary {
  color: var(--ds-text-3);
  font-family: var(--ds-font-body);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.tool-call-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: auto;
  flex-shrink: 0;
  color: var(--ds-text-3);
}

/* ───────── Reveal transition ─────────
   Shared enter animation for block-level reveals (code-block, post
   paragraph, tool-call card). Each block fades + lifts in over 220 ms
   when the streaming cursor crosses its segment start, so the
   response reads as "blocks materialising one after another" rather
   than "everything painted at t=0". No leave animation — we never
   unmount these once revealed within a single loop iteration. */
.reveal-enter-active {
  transition:
    opacity 220ms ease,
    transform 220ms ease;
}
.reveal-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.reveal-enter-to {
  opacity: 1;
  transform: translateY(0);
}

/* ───────── Meta row (✓ done · time · copy) ─────────
   Mirrors `.metaRow` from AgentResponse.module.css — only painted
   when the run is "done". The copy button lives at margin-left:auto
   so it pins to the right edge of the column, like the live UI. */
.meta-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  font-size: var(--ds-text-xs);
  color: var(--ds-text-4, var(--ds-text-3));
  opacity: 0;
  transform: translateY(2px);
  transition:
    opacity 220ms ease,
    transform 220ms ease;
  pointer-events: none;
  margin-top: 4px;
}
.meta-row[data-visible='true'] {
  opacity: 0.7;
  transform: none;
}

.meta-done {
  /* Match `.doneText` — slightly more muted than .meta-time. */
  opacity: 0.85;
}

.meta-sep {
  opacity: 0.7;
}

.meta-time {
  /* Match `.timeText` — same muted tone as .meta-sep. */
  opacity: 0.95;
}

.meta-copy {
  margin-left: auto;
  /* Live `<IconButton size={1}>` → 24×24 with Icon size={1} (11px). */
  width: 24px;
  height: 24px;
  border-radius: var(--ds-radius-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: inherit;
}

/* ───────── Reduced motion ───────── */

@media (prefers-reduced-motion: reduce) {
  .caret,
  .thinking-dots .dot,
  .meta-row {
    animation: none !important;
    transition: none !important;
  }
  .reveal-enter-active {
    transition: none !important;
  }
  .reveal-enter-from {
    opacity: 1;
    transform: none;
  }
  .meta-row[data-visible='true'] {
    opacity: 0.7;
    transform: none;
  }
}
</style>
