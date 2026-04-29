<script setup>
import EaSection from '../../agents-home/Section.vue'
import MarkdownContent from '../../MarkdownContent.vue'
import MdExportExplicit from '../../MdExportExplicit.vue'
import ScalabilityChart from '../../ScalabilityChart.vue'
import { useMarkdownExport } from '../../../lib/useMarkdownExport'

const isMarkdownExport = useMarkdownExport()
const section = {
  title: 'Scales to millions of users.',
  body: 'Electric streams over plain HTTP, so standard CDNs fan out high-throughput data delivery without ever touching your database.',
  bodyLink: { text: 'standard CDNs', href: '/docs/sync/api/http#caching' },
  stats: [
    { value: '1M+', label: 'concurrent readers' },
    { value: '99%', label: 'CDN cache hit rate' },
    { value: '∞', label: 'DB load stays flat' },
  ],
  link: {
    text: 'Read the benchmarks',
    href: '/docs/sync/reference/benchmarks',
  },
}
const markdown = `## ${section.title}

Electric streams over plain HTTP, so [${section.bodyLink.text}](${section.bodyLink.href}) fan out high-throughput data delivery without ever touching your database.

${section.stats.map((stat) => `- \`${stat.value}\` ${stat.label}`).join('\n')}

[${section.link.text}](${section.link.href})`
</script>

<template>
  <MdExportExplicit v-if="isMarkdownExport">
    <MarkdownContent>{{ markdown }}</MarkdownContent>
  </MdExportExplicit>
  <EaSection v-else id="scales">
    <div class="st-grid">
      <div class="st-prose-col">
        <h2 class="st-title">
          {{ section.title }}
        </h2>
        <p class="st-prose">
          Electric streams over plain HTTP, so
          <a :href="section.bodyLink.href">{{ section.bodyLink.text }}</a>
          fan out high-throughput data delivery without ever touching your
          database.
        </p>
        <ul class="st-stats">
          <li v-for="stat in section.stats" :key="stat.label">
            <span class="st-stat-num">{{ stat.value }}</span>
            <span class="st-stat-label mono">{{ stat.label }}</span>
          </li>
        </ul>
        <div class="st-foot mono">
          <a :href="section.link.href">{{ section.link.text }} →</a>
        </div>
      </div>
      <div class="st-visual-col">
        <div class="st-chart-frame">
          <div class="st-chart-head">
            <span class="st-chart-eyebrow mono">
              <span class="dot"></span>
              Latency &amp; memory under load
            </span>
          </div>
          <div class="st-chart-body">
            <ScalabilityChart />
          </div>
        </div>
      </div>
    </div>
  </EaSection>
</template>

<style scoped>
.st-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
  gap: 56px;
  align-items: center;
}

/* ── Prose column ─────────────────────────────────────────────── */

.st-title {
  font-size: 32px;
  /* Section h2 — 600 (down from 800) so it sits below the home hero
     name without out-bolding it. */
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: var(--ea-text-1);
  margin: 0 0 16px;
  text-wrap: balance;
}
.st-prose {
  font-family: var(--vp-font-family-base);
  font-size: 16px;
  line-height: 1.65;
  color: var(--ea-text-2);
  margin: 0 0 24px;
  text-wrap: pretty;
}
.st-prose a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
  border-bottom: 1px solid
    color-mix(in srgb, var(--vp-c-brand-1) 35%, transparent);
}
.st-prose a:hover {
  border-bottom-color: var(--vp-c-brand-1);
}

.st-stats {
  list-style: none;
  margin: 0 0 24px;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.st-stats li {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 10px;
}
.st-stat-num {
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
  color: var(--ea-text-1);
  letter-spacing: -0.01em;
}
.st-stat-label {
  font-size: 11px;
  color: var(--ea-text-3);
  letter-spacing: 0.02em;
}

.st-foot {
  font-size: 13px;
}
.st-foot a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.st-foot a:hover {
  text-decoration: underline;
}

/* ── Chart frame ──────────────────────────────────────────────── */

.st-chart-frame {
  border-radius: 12px;
  border: 1px solid var(--ea-divider);
  background: var(--ea-surface);
  overflow: hidden;
  isolation: isolate;
  position: relative;
  transition: border-color 0.2s ease;
}
.st-chart-frame::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse 80% 60% at 50% 0%,
    color-mix(in srgb, var(--vp-c-brand-1) 5%, transparent) 0%,
    transparent 60%
  );
  z-index: 0;
  pointer-events: none;
}
.st-chart-frame:hover {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 30%, var(--ea-divider));
}

.st-chart-head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ea-divider);
  background: var(--ea-surface-alt);
}

.st-chart-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ea-text-3);
}
.st-chart-eyebrow .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}

.st-chart-body {
  position: relative;
  z-index: 1;
  padding: 12px 16px 8px;
}

/* ScalabilityChart's onResize callback writes an inline `height` onto
   its parent (the .ScalabilityGraph wrapper), defaulting to up to
   384px. Override that here so the chart actually fits the frame
   instead of leaving a gap below the canvas. */
.st-chart-body :deep(.ScalabilityGraph) {
  aspect-ratio: auto !important;
  height: 280px !important;
}
.st-chart-body :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

/* ── Responsive ───────────────────────────────────────────────── */

@media (max-width: 959px) {
  .st-grid {
    grid-template-columns: 1fr;
    gap: 32px;
    align-items: stretch;
  }
}

@media (max-width: 768px) {
  .st-title {
    font-size: 26px;
  }
  .st-stats {
    grid-template-columns: 1fr 1fr 1fr;
    gap: 10px;
  }
  .st-stats li {
    padding: 12px 14px;
  }
  .st-stat-num {
    font-size: 20px;
  }
}

@media (max-width: 480px) {
  .st-title {
    font-size: 22px;
  }
  .st-chart-body :deep(.ScalabilityGraph) {
    height: 240px !important;
  }
}
</style>
