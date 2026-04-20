<script setup lang="ts">
import { ref } from "vue"
import { VPButton } from "vitepress/theme"

import EaSection from "../agents-home/Section.vue"
import CloudHexBg from "./CloudHexBg.vue"

const heroInnerRef = ref<HTMLElement>()
</script>

<template>
  <div class="cl-home">
    <!-- ─────────────────── §1 — Hero ─────────────────── -->
    <section class="cl-hero">
      <CloudHexBg />
      <div ref="heroInnerRef" class="cl-hero-inner">
        <h1 class="cl-hero-name">
          Electric <span class="cl-hero-accent">Cloud</span>
        </h1>
        <p class="cl-hero-tagline">
          Scalable data infrastructure platform for building fast, modern apps
          and <span class="no-wrap">multi-agent systems</span>.
        </p>

        <div class="cl-hero-row">
          <VPButton
            tag="a"
            size="medium"
            theme="brand"
            text="Start building now »"
            href="https://dashboard.electric-sql.cloud/"
          />
          <VPButton
            tag="a"
            size="medium"
            theme="alt"
            text="See pricing"
            href="/pricing"
          />
        </div>
      </div>
    </section>

    <!-- ─────────── §2 — Scalable data infrastructure ─────────── -->
    <EaSection
      id="scalable-infrastructure"
      title="Scalable data infrastructure"
      subtitle="Electric Cloud is a reactive data platform designed for running multi-user, multi-agent systems that provides turnkey hosting of Durable Streams and Postgres Sync."
    >
      <div class="cl-product-grid">
        <a class="cl-product-card" href="/streams">
          <div class="cl-product-card-head">
            <img
              src="/img/icons/durable-streams.svg"
              alt=""
              class="cl-product-icon"
            />
            <h3>Durable&nbsp;Streams</h3>
          </div>
          <p>
            We host
            <a href="/streams" @click.stop>Durable&nbsp;Streams</a>
            with
            <a href="#protocols" @click.stop>multiple protocols</a>,
            from raw binary streams, to JSON mode, to protocol specific
            transports and user-defined sync protocols using Durable State.
            See the
            <a
              href="/blog/2026/01/22/announcing-hosted-durable-streams"
              @click.stop
            >
              announcement blog post here</a>.
          </p>
          <span class="cl-product-cta">Explore Durable Streams →</span>
        </a>

        <a class="cl-product-card" href="/sync">
          <div class="cl-product-card-head">
            <img src="/img/icons/electric.svg" alt="" class="cl-product-icon" />
            <h3>Postgres&nbsp;Sync</h3>
          </div>
          <p>
            We provision, run and operate the
            <a href="/sync" @click.stop>Postgres sync engine</a>
            for you. This connects to your Postgres, consumes changes over
            logical replication and provides a service endpoint for
            <a href="/docs/guides/shapes" @click.stop>syncing shapes</a>
            into your client.
          </p>
          <span class="cl-product-cta">Explore Postgres Sync →</span>
        </a>
      </div>
    </EaSection>

    <!-- ─────────── §3 — Data delivery network ─────────── -->
    <EaSection
      id="data-delivery-network"
      :dark="true"
      title="Data delivery network"
      subtitle="Electric syncs data over HTTP via CDN infrastructure. Electric Cloud leverages this to provide a global Data Delivery Network."
    >
      <p class="cl-ddn-prose">
        This allows you to scale out real-time data to
        <a href="/docs/reference/benchmarks#cloud">millions of concurrent users</a>.
        With fast load times, low latency and consistent, low resource use.
      </p>

      <div class="cl-stat-row">
        <div class="cl-stat">
          <div class="cl-stat-value">Millions</div>
          <div class="cl-stat-label">of concurrent users per&nbsp;shape</div>
        </div>
        <div class="cl-stat">
          <div class="cl-stat-value">Global</div>
          <div class="cl-stat-label">CDN delivery, edge cached</div>
        </div>
        <div class="cl-stat">
          <div class="cl-stat-value">HTTP</div>
          <div class="cl-stat-label">just standard, cacheable HTTP</div>
        </div>
      </div>
    </EaSection>

    <!-- ───────────────── §4 — Protocols ───────────────── -->
    <EaSection
      id="protocols"
      title="Protocols"
      subtitle="Electric Cloud supports multiple sync protocols. Electric syncs data over plain HTTP, which lets it integrate with CDN infrastructure for global, cached delivery."
    >
      <p class="cl-protocols-prose">
        See the
        <a href="/docs/api/http">HTTP API reference</a>
        for details.
      </p>

      <div class="cl-protocols-grid">
        <div class="cl-protocols-card">
          <h3>Clients</h3>
          <p>Electric provides clients for consuming sync data:</p>
          <ul class="cl-protocol-list">
            <li>
              <a href="/docs/api/clients/typescript">
                <span class="cl-protocol-name">TypeScript client</span>
                <span class="cl-protocol-arrow">→</span>
              </a>
            </li>
            <li>
              <a href="/docs/api/clients/elixir">
                <span class="cl-protocol-name">Elixir client</span>
                <span class="cl-protocol-arrow">→</span>
              </a>
            </li>
          </ul>
        </div>

        <div class="cl-protocols-card">
          <h3>Integrations</h3>
          <p>
            See our
            <a href="/docs/integrations/react">integrations</a>
            for framework-specific guides.
          </p>
          <ul class="cl-protocol-list">
            <li>
              <a href="/docs/integrations/react">
                <span class="cl-protocol-name">React, Vue, Svelte, Solid&hellip;</span>
                <span class="cl-protocol-arrow">→</span>
              </a>
            </li>
            <li>
              <a href="/docs/integrations/tanstack">
                <span class="cl-protocol-name">TanStack DB &amp; Query</span>
                <span class="cl-protocol-arrow">→</span>
              </a>
            </li>
          </ul>
        </div>
      </div>
    </EaSection>

    <!-- ───────────── §5 — Next steps / final CTA ───────────── -->
    <EaSection id="next-steps">
      <div class="cl-cta">
        <div class="cl-cta-eyebrow mono">
          <span class="dot"></span>
          Hosted &middot; usage-based &middot; built on open&nbsp;protocols
        </div>
        <h2 class="cl-cta-title">
          Start building on
          <span class="cl-cta-accent">Electric&nbsp;Cloud</span>.
        </h2>
        <p class="cl-cta-tagline">
          Sign up and start building with Electric Cloud&nbsp;today.
        </p>

        <div class="cl-cta-buttons">
          <VPButton
            tag="a"
            size="medium"
            theme="brand"
            text="Start building now »"
            href="https://dashboard.electric-sql.cloud/"
          />
          <VPButton
            tag="a"
            size="medium"
            theme="alt"
            text="See pricing"
            href="/pricing"
          />
        </div>
      </div>
    </EaSection>
  </div>
</template>

<style scoped>
.cl-home {
  overflow-x: hidden;
  max-width: 100vw;
}

/* ───────────────────────── Hero ───────────────────────── */
/* Mirrors the structure of the streams / sync homepage hero so the
   four landing pages (agents / streams / sync / cloud) feel like a
   matched set: centered name with gradient + brand-coloured
   underline, tagline, then a row of CTAs. */

.cl-hero {
  position: relative;
  padding: 128px 24px 112px;
  text-align: center;
  overflow: hidden;
  /* The hero now sits on a dark hex-viewer panel, so anchor a dark
     fallback in case the bg component hasn't laid out yet. */
  background: #0d1117;
}

.cl-hero-inner {
  position: relative;
  z-index: 1;
  max-width: 880px;
  margin: 0 auto;
  pointer-events: none;
}

.cl-hero-inner > * {
  pointer-events: auto;
}

.cl-hero-name {
  font-size: 64px;
  font-weight: 700;
  line-height: 1.2;
  background: none;
  -webkit-background-clip: border-box;
  background-clip: border-box;
  -webkit-text-fill-color: currentColor;
  color: #f3f7ff;
  margin: 0;
  padding-bottom: 4px;
}

.cl-hero-accent {
  color: var(--vp-c-brand-1);
  -webkit-text-fill-color: currentColor;
}

.cl-hero-tagline {
  font-family: var(--vp-font-family-base);
  font-size: 19px;
  /* The hero panel is always dark, so use a light tone regardless
     of the global theme. */
  color: rgba(231, 238, 248, 0.78);
  margin: 20px auto 0;
  max-width: 640px;
  line-height: 1.55;
  text-wrap: pretty;
}

.cl-hero-row {
  margin-top: 32px;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

@media (max-width: 768px) {
  .cl-hero {
    padding: 88px 20px 80px;
  }
  .cl-hero-name {
    font-size: 44px;
  }
  .cl-hero-tagline {
    font-size: 16px;
  }
}

@media (max-width: 480px) {
  .cl-hero {
    padding: 64px 16px 64px;
  }
  .cl-hero-name {
    font-size: 36px;
  }
}

/* ───────────────────── Product cards ───────────────────── */

.cl-product-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.cl-product-card {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 32px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  background: var(--vp-c-bg);
  text-decoration: none;
  color: inherit;
  transition:
    transform 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.cl-product-card:hover {
  transform: translateY(-2px);
  border-color: var(--vp-c-brand-2);
  box-shadow: 0 8px 32px -16px
    color-mix(in srgb, var(--vp-c-brand-1) 35%, transparent);
}

.cl-product-card-head {
  display: flex;
  align-items: center;
  gap: 14px;
}

.cl-product-icon {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
}

.cl-product-card h3 {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: var(--vp-c-text-1);
  margin: 0;
}

.cl-product-card p {
  font-size: 15px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  margin: 0;
  flex-grow: 1;
}

.cl-product-card p a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
  border-bottom: 1px solid
    color-mix(in srgb, var(--vp-c-brand-1) 35%, transparent);
}

.cl-product-card p a:hover {
  border-bottom-color: var(--vp-c-brand-1);
}

.cl-product-cta {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  letter-spacing: 0.01em;
}

@media (max-width: 768px) {
  .cl-product-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .cl-product-card {
    padding: 24px;
  }
}

/* ───────────────── Data delivery network ───────────────── */

.cl-ddn-prose {
  font-size: 17px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  max-width: 720px;
  margin: 0 0 40px;
}

.cl-ddn-prose a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
  border-bottom: 1px solid
    color-mix(in srgb, var(--vp-c-brand-1) 35%, transparent);
}

.cl-stat-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}

.cl-stat {
  padding: 24px 28px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg);
}

.cl-stat-value {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--vp-c-text-1);
  line-height: 1.1;
  margin-bottom: 6px;
}

.cl-stat-label {
  font-size: 14px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}

@media (max-width: 768px) {
  .cl-stat-row {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .cl-stat {
    padding: 20px;
  }
}

/* ─────────────────────── Protocols ─────────────────────── */

.cl-protocols-prose {
  font-size: 16px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  margin: 0 0 32px;
  max-width: 720px;
}

.cl-protocols-prose a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
  border-bottom: 1px solid
    color-mix(in srgb, var(--vp-c-brand-1) 35%, transparent);
}

.cl-protocols-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.cl-protocols-card {
  padding: 28px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg);
}

.cl-protocols-card h3 {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--vp-c-text-1);
  margin: 0 0 12px;
}

.cl-protocols-card > p {
  font-size: 15px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  margin: 0 0 16px;
}

.cl-protocols-card > p a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
  border-bottom: 1px solid
    color-mix(in srgb, var(--vp-c-brand-1) 35%, transparent);
}

.cl-protocol-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.cl-protocol-list li {
  border-top: 1px solid var(--vp-c-divider);
}

.cl-protocol-list li:first-child {
  border-top: none;
}

.cl-protocol-list a {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  text-decoration: none;
  color: var(--vp-c-text-1);
  font-weight: 500;
  font-size: 15px;
  transition: color 0.15s ease;
}

.cl-protocol-list a:hover {
  color: var(--vp-c-brand-1);
}

.cl-protocol-arrow {
  color: var(--vp-c-text-3);
  transition:
    transform 0.15s ease,
    color 0.15s ease;
}

.cl-protocol-list a:hover .cl-protocol-arrow {
  color: var(--vp-c-brand-1);
  transform: translateX(2px);
}

@media (max-width: 768px) {
  .cl-protocols-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .cl-protocols-card {
    padding: 22px;
  }
}

/* ────────────────────── Final CTA ────────────────────── */
/* Mirrors the `.ds-cta` panel pattern from streams-home: framed card
   with a subtle brand glow, eyebrow pill, gradient-accent title,
   tagline and a row of CTAs. */

.cl-cta {
  position: relative;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  padding: 56px 32px 48px;
  background: var(--ea-surface, var(--vp-c-bg));
  border: 1px solid var(--ea-divider, var(--vp-c-divider));
  border-radius: 12px;
  overflow: hidden;
  isolation: isolate;
}

.cl-cta::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse 70% 90% at 50% 0%,
    color-mix(in srgb, var(--vp-c-brand-1) 8%, transparent) 0%,
    transparent 55%
  );
  z-index: -1;
  opacity: 0.85;
}

.cl-cta-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ea-text-3, var(--vp-c-text-3));
  padding: 4px 10px;
  background: var(--ea-surface-alt, var(--vp-c-bg-alt));
  border: 1px solid var(--ea-divider, var(--vp-c-divider));
  border-radius: 999px;
  margin-bottom: 22px;
}

.cl-cta-eyebrow .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}

.cl-cta-title {
  font-size: 38px;
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.015em;
  color: var(--ea-text-1, var(--vp-c-text-1));
  margin: 0;
  max-width: 580px;
  text-wrap: balance;
}

.cl-cta-accent {
  background: var(--vp-home-hero-name-background);
  -webkit-background-clip: text;
  background-clip: text;
  color: var(--vp-home-hero-name-color);
}

.cl-cta-tagline {
  font-family: var(--vp-font-family-base);
  font-size: 16px;
  line-height: 1.6;
  color: var(--ea-text-2, var(--vp-c-text-2));
  margin: 14px auto 0;
  max-width: 460px;
}

.cl-cta-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 28px;
  justify-content: center;
}

@media (max-width: 768px) {
  .cl-cta {
    padding: 40px 20px 36px;
  }
  .cl-cta-title {
    font-size: 28px;
  }
}

.no-wrap {
  white-space: nowrap;
}

.mono {
  font-family: var(--vp-font-family-mono);
}
</style>
