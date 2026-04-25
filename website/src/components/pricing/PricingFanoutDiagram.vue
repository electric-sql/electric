<script setup lang="ts">
/* PricingFanoutDiagram — simple "what you pay for / what you don't"
   panel. Two rate cards for the metered dimensions, followed by a
   row of pills listing the dimensions that are unlimited and free.
   No animation; sits directly on the section background and matches
   the hairline-card vocabulary used on `SyncStackDiagram`. */

interface FreeItem {
  label: string
}

import MarkdownContent from '../MarkdownContent.vue'
import MdExportExplicit from '../MdExportExplicit.vue'
import { useMarkdownExport } from '../../lib/useMarkdownExport'

const freeItems: FreeItem[] = [
  { label: "Reads" },
  { label: "Egress" },
  { label: "Fan-out" },
  { label: "Active clients" },
  { label: "Connections" },
  { label: "Services" },
]

const isMarkdownExport = useMarkdownExport()

const markdown = `**You pay for**:

- Writes: $1 per million
- Retention: $0.10 per GB-month

**Always free**:

${freeItems.map((item) => `- ${item.label}`).join('\n')}`
</script>

<template>
  <MdExportExplicit v-if="isMarkdownExport">
    <MarkdownContent>{{ markdown }}</MarkdownContent>
  </MdExportExplicit>
  <div v-else class="pfd" aria-label="Pricing model: pay for writes and retention; reads, egress, fan-out, active clients, connections and services are unlimited and free.">
    <div class="pfd-paid">
      <div class="pfd-paid-label mono">YOU PAY FOR</div>
      <div class="pfd-cards">
        <div class="pfd-card">
          <div class="pfd-card-name">Writes</div>
          <div class="pfd-card-rate">
            <span class="pfd-card-amount">$1</span>
            <span class="pfd-card-unit">per million</span>
          </div>
        </div>
        <div class="pfd-card">
          <div class="pfd-card-name">Retention</div>
          <div class="pfd-card-rate">
            <span class="pfd-card-amount">$0.10</span>
            <span class="pfd-card-unit">per GB&middot;month</span>
          </div>
        </div>
      </div>
    </div>

    <div class="pfd-free">
      <div class="pfd-free-label mono">ALWAYS FREE</div>
      <ul class="pfd-pills">
        <li v-for="item in freeItems" :key="item.label" class="pfd-pill">
          <svg
            class="pfd-pill-tick"
            viewBox="0 0 16 16"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M3.5 8.5l3 3 6-7"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          {{ item.label }}
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.pfd {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 28px;
}

/* ── Header labels ──────────────────────────────────────────────── */

.pfd-paid-label,
.pfd-free-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ea-text-3);
  margin-bottom: 14px;
}
.pfd-free-label {
  color: var(--vp-c-brand-1);
}

/* ── Paid rate cards ────────────────────────────────────────────── */

.pfd-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  max-width: 640px;
}

.pfd-card {
  position: relative;
  padding: 22px 22px 22px 26px;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 10px;
  overflow: hidden;
}
.pfd-card::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--vp-c-brand-1);
  opacity: 0.85;
}

.pfd-card-name {
  font-family: var(--vp-font-family-base);
  font-size: 15px;
  font-weight: 600;
  color: var(--ea-text-2);
  letter-spacing: -0.005em;
  margin-bottom: 6px;
}

.pfd-card-rate {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.pfd-card-amount {
  font-family: var(--vp-font-family-base);
  font-size: 28px;
  font-weight: 700;
  color: var(--ea-text-1);
  letter-spacing: -0.02em;
}

.pfd-card-unit {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--ea-text-2);
}

/* ── Free pills row ─────────────────────────────────────────────── */

.pfd-pills {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
}

.pfd-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 6px 10px;
  background: color-mix(in srgb, var(--vp-c-brand-1) 8%, var(--ea-surface));
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 28%, var(--ea-divider));
  border-radius: 999px;
  font-family: var(--vp-font-family-base);
  font-size: 13.5px;
  font-weight: 500;
  color: var(--ea-text-1);
  white-space: nowrap;
}

.pfd-pill-tick {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  color: var(--vp-c-brand-1);
}

/* ── Responsive ─────────────────────────────────────────────────── */

@media (max-width: 540px) {
  .pfd-cards {
    grid-template-columns: 1fr;
  }
  .pfd-card-amount {
    font-size: 24px;
  }
}
</style>
