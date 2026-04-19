<script setup lang="ts">
import { ref, computed } from "vue"

interface Source {
  key: string
  label: string
  color: string
  tier: "pinned" | "stable" | "slow-changing" | "volatile"
  tierLabel: string
  tokens: number
  max: number
  description: string
}

const TOTAL_BUDGET = 32_768

const sources = ref<Source[]>([
  {
    key: "system",
    label: "system prompt",
    color: "#6b7280",
    tier: "pinned",
    tierLabel: "pinned",
    tokens: 2_048,
    max: 4_096,
    description: "Never changes between requests",
  },
  {
    key: "tools",
    label: "tool definitions",
    color: "#8b5cf6",
    tier: "stable",
    tierLabel: "stable",
    tokens: 5_120,
    max: 6_144,
    description: "Changes rarely — high cache hit rate",
  },
  {
    key: "codebase",
    label: "codebase context",
    color: "#f59e0b",
    tier: "slow-changing",
    tierLabel: "slow-changing",
    tokens: 14_336,
    max: 16_384,
    description: "Updates as files change",
  },
  {
    key: "conversation",
    label: "conversation",
    color: "#0ea5e9",
    tier: "volatile",
    tierLabel: "volatile",
    tokens: 7_552,
    max: 16_384,
    description: "Changes every turn — placed last",
  },
])

const filledTokens = computed(() =>
  sources.value.reduce((sum, s) => sum + s.tokens, 0),
)

function segmentPercent(tokens: number): number {
  return (tokens / TOTAL_BUDGET) * 100
}

function formatTokens(n: number): string {
  return n.toLocaleString("en-US")
}

const hoveredSource = ref<string | null>(null)

const cacheHitPercent = computed(() => {
  const stableTokens = sources.value
    .filter((s) => s.tier === "pinned" || s.tier === "stable" || s.tier === "slow-changing")
    .reduce((sum, s) => sum + s.tokens, 0)
  return Math.round((stableTokens / filledTokens.value) * 100)
})
</script>

<template>
  <div class="context-demo">
    <div class="demo-layout">
      <!-- Left: bar + explanation -->
      <div class="demo-main">
        <div class="bar-header">
          <span class="bar-title">Context Window</span>
          <span class="bar-budget">{{ formatTokens(TOTAL_BUDGET) }} tokens</span>
        </div>

        <div class="bar-track">
          <div
            v-for="src in sources"
            :key="src.key"
            class="bar-segment"
            :class="{ hovered: hoveredSource === src.key }"
            :style="{
              width: segmentPercent(src.tokens) + '%',
              background: src.color,
            }"
            @mouseenter="hoveredSource = src.key"
            @mouseleave="hoveredSource = null"
          >
            <span v-if="segmentPercent(src.tokens) > 8" class="segment-label">
              {{ src.label }}
            </span>
          </div>
          <div class="bar-empty" />
        </div>

        <div class="cache-indicator">
          <div class="cache-line" :style="{ width: cacheHitPercent + '%' }">
            <span class="cache-label">← cacheable prefix ({{ cacheHitPercent }}%)</span>
          </div>
        </div>

        <!-- Source list -->
        <div class="source-list">
          <div
            v-for="src in sources"
            :key="src.key"
            class="source-row"
            :class="{ hovered: hoveredSource === src.key }"
            @mouseenter="hoveredSource = src.key"
            @mouseleave="hoveredSource = null"
          >
            <span class="source-dot" :style="{ background: src.color }" />
            <span class="source-name">{{ src.label }}</span>
            <span class="source-tier" :class="src.tier">{{ src.tierLabel }}</span>
            <span class="source-tokens">{{ formatTokens(src.tokens) }}</span>
            <span class="source-desc">{{ src.description }}</span>
          </div>
        </div>
      </div>

      
    </div>
  </div>
</template>

<style scoped>
.demo-layout {
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  background: var(--ea-surface);
  padding: 28px;
}

.demo-main {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ── Bar header ──────────────────────────────────────────────────── */

.bar-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.bar-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ea-text-1);
}

.bar-budget {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--ea-text-2);
}

/* ── Bar track ───────────────────────────────────────────────────── */

.bar-track {
  height: 44px;
  border-radius: 6px;
  background: var(--ea-surface-alt);
  overflow: hidden;
  display: flex;
}

.bar-segment {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
  min-width: 0;
  cursor: default;
  transition: opacity 0.2s;
}

.bar-segment.hovered {
  opacity: 0.85;
}

.bar-segment:first-child {
  border-radius: 6px 0 0 6px;
}

.bar-empty {
  flex: 1;
}

.segment-label {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 500;
  color: #fff;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  padding: 0 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

/* ── Cache indicator ─────────────────────────────────────────────── */

.cache-indicator {
  height: 20px;
  position: relative;
}

.cache-line {
  height: 100%;
  border-right: 2px dashed var(--vp-c-brand-1);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  transition: width 0.4s ease;
}

.cache-label {
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  color: var(--vp-c-brand-1);
  white-space: nowrap;
  padding-right: 8px;
}

/* ── Source list ──────────────────────────────────────────────────── */

.source-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.source-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: default;
  transition: background 0.15s;
}

.source-row.hovered {
  background: var(--ea-surface-alt);
}

.source-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.source-name {
  font-size: 12px;
  font-weight: 500;
  color: var(--ea-text-1);
  white-space: nowrap;
}

.source-tier {
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 1px 6px;
  border-radius: 3px;
  white-space: nowrap;
}

.source-tier.pinned {
  color: #6b7280;
  background: color-mix(in srgb, #6b7280 15%, transparent);
}

.source-tier.stable {
  color: #8b5cf6;
  background: color-mix(in srgb, #8b5cf6 15%, transparent);
}

.source-tier.slow-changing {
  color: #f59e0b;
  background: color-mix(in srgb, #f59e0b 15%, transparent);
}

.source-tier.volatile {
  color: #0ea5e9;
  background: color-mix(in srgb, #0ea5e9 15%, transparent);
}

.source-tokens {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--ea-text-2);
  margin-left: auto;
  flex-shrink: 0;
}

.source-desc {
  font-size: 11px;
  color: var(--ea-text-2);
  opacity: 0.7;
}

/* ── Responsive ──────────────────────────────────────────────────── */

@media (max-width: 768px) {
  .demo-layout {
    padding: 20px;
  }
  .source-desc {
    display: none;
  }
}

@media (max-width: 480px) {
  .demo-layout {
    padding: 16px;
  }
  .bar-track {
    height: 36px;
  }
  .segment-label {
    font-size: 8px;
    padding: 0 3px;
  }
  .cache-label {
    font-size: 9px;
    padding-right: 4px;
  }
  .source-name {
    font-size: 11px;
  }
  .source-tokens {
    font-size: 10px;
  }
  .source-tier {
    font-size: 9px;
    padding: 1px 4px;
  }
}
</style>
