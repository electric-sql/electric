<script setup lang="ts">
import { computed, ref } from "vue"
import MarkdownContent from "./MarkdownContent.vue"
import MdExportExplicit from "./MdExportExplicit.vue"
import { useMarkdownExport } from "../lib/useMarkdownExport"

/* InstallPill — single source of truth for the "$ npx … " install
   snippets that appear in landing-page hero rows and end-of-page CTA
   straps. Replaces the per-page `.ea-/.ds-/.sh-` install-pill copies
   that all carried slightly different padding, type sizes and
   syntax-highlighting palettes.

   API
   ───
   command   The full command shown inside the pill (no leading `$`).
             The tokens are split on whitespace and coloured
             positionally — runner / package / sub-arg / trailing.
   clipboard Optional override for what gets copied. Defaults to
             `command` so the user copies exactly what they see.
   tone      Visual tone for the pill surface:
               raised — pill bg = --ea-surface-alt (use on --ea-bg
                        backgrounds, e.g. landing-page heroes)
               sunken — pill bg = --ea-bg            (use on
                        --ea-surface-alt backgrounds, e.g. the
                        bottom CTA straps which sit on alt-surface)
             Defaults to `raised`.
   accent    Optional single-token accent mode. When provided, the
             positional 4-colour palette is dropped: every token
             renders in the muted `--ea-text-2` text colour except
             the matching token, which gets the brand colour. Use
             this when the multi-colour highlighting reads as noisy
             and you only want to draw the eye to one keyword (e.g.
             `accent="agents"` on the agents landing pill). */
type Tone = "raised" | "sunken"

const props = withDefaults(
  defineProps<{
    command: string
    clipboard?: string
    tone?: Tone
    accent?: string
  }>(),
  { clipboard: "", tone: "raised", accent: "" }
)

const tokens = computed(() => props.command.trim().split(/\s+/))
const copyText = computed(() => props.clipboard || props.command)
const markdownCommand = computed(() => `\`\`\`sh\n${props.command}\n\`\`\``)
const accentIndex = computed(() =>
  props.accent ? tokens.value.indexOf(props.accent) : -1
)
const isMarkdownExport = useMarkdownExport()

const copied = ref(false)
let resetTimer: ReturnType<typeof setTimeout> | null = null

function copy() {
  navigator.clipboard?.writeText(copyText.value)
  copied.value = true
  if (resetTimer) clearTimeout(resetTimer)
  resetTimer = setTimeout(() => {
    copied.value = false
  }, 1800)
}
</script>

<template>
  <MdExportExplicit v-if="isMarkdownExport">
    <MarkdownContent>{{ markdownCommand }}</MarkdownContent>
  </MdExportExplicit>

  <button
    v-else
    class="install-pill"
    :class="[`install-pill--${tone}`, { copied }]"
    type="button"
    @click="copy"
    :aria-label="copied ? 'Copied' : 'Copy install command'"
  >
    <span class="install-pill-text">
      <span class="install-pill-prompt">$</span>
      <template v-for="(tok, i) in tokens" :key="i">
        <!-- Inline space text node between tokens — `display: inline`
             on each `<span>` means a literal space here is rendered. -->
        <span v-if="i > 0">&nbsp;</span>
        <span
          :class="[
            'install-pill-tok',
            accentIndex >= 0
              ? i === accentIndex
                ? 'install-pill-tok--accent'
                : 'install-pill-tok--muted'
              : `install-pill-tok-${i}`,
          ]"
          >{{ tok }}</span
        >
      </template>
    </span>
    <span class="install-pill-copy" aria-hidden="true">
      <svg
        v-if="!copied"
        xmlns="http://www.w3.org/2000/svg"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </svg>
      <svg
        v-else
        xmlns="http://www.w3.org/2000/svg"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  </button>
</template>

<style scoped>
.install-pill {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 14px;
  /* Sized larger than a chip so the pill holds its own next to a
     row of medium VPButtons — this is the install evidence that
     anchors the hero and bottom CTA. */
  padding: 14px 20px;
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s;
  user-select: none;
  font: inherit;
}
.install-pill:hover {
  border-color: var(--vp-c-brand-1);
}

/* Surface tones — pick the one that contrasts with the background
   the pill is being placed on. */
.install-pill--raised {
  background: var(--ea-surface-alt);
}
.install-pill--sunken {
  background: var(--ea-bg);
}

.install-pill-text {
  font-family: var(--vp-font-family-mono);
  font-size: 15.5px;
  color: var(--ea-text-1);
  letter-spacing: -0.01em;
}

.install-pill-prompt {
  color: var(--vp-c-brand-1);
  margin-right: 0.5em;
}

/* Positional syntax highlighting for the command tokens — reuses the
   .tk-* event-colour palette used by the larger code blocks so the
   styling reads as part of one system. Used when the caller does
   not pass an `accent` prop.
     tok-0 — runner (npx, npm, pnpm, …)        → muted grey
     tok-1 — package / main name               → brand
     tok-2 — sub-command / first arg           → amber
     tok-3+ — trailing args                    → green               */
.install-pill-tok-0 {
  color: var(--ea-text-2);
}
.install-pill-tok-1 {
  color: var(--vp-c-brand-1);
  font-weight: 500;
}
.install-pill-tok-2 {
  color: var(--ea-event-tool-call);
}
.install-pill-tok-3,
.install-pill-tok-4,
.install-pill-tok-5,
.install-pill-tok-6 {
  color: var(--ea-event-tool-result);
}

/* Single-token accent mode (caller passes `accent="<token>"`). The
   whole command renders muted; only the matching token picks up the
   brand colour, so the eye is drawn to one keyword instead of the
   four-colour positional palette above. */
.install-pill-tok--muted {
  color: var(--ea-text-2);
}
.install-pill-tok--accent {
  color: var(--vp-c-brand-1);
  font-weight: 500;
}

.install-pill-copy {
  color: var(--ea-text-2);
  display: flex;
  transition: color 0.2s;
}
.install-pill.copied .install-pill-copy {
  color: var(--vp-c-brand-1);
}

@media (max-width: 768px) {
  .install-pill {
    padding: 12px 18px;
    gap: 12px;
  }
  .install-pill-text {
    font-size: 14px;
  }
}

@media (max-width: 480px) {
  .install-pill {
    padding: 10px 14px;
    gap: 10px;
  }
  .install-pill-text {
    font-size: 13px;
  }
}
</style>
