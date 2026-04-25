<script setup lang="ts">
import { ref } from "vue"
import { VPButton } from "vitepress/theme"

import EaSection from "../agents-home/Section.vue"
import BottomCtaStrap from "../BottomCtaStrap.vue"
import MeshOfStreams from "../brand-toys/MeshOfStreams.vue"

const heroInnerRef = ref<HTMLElement>()
</script>

<template>
  <div class="cl-home">
    <!-- ─────────────────── §1 — Hero ─────────────────── -->
    <section class="cl-hero">
      <!-- Procedural "mesh of streams" backdrop. Mirrors the streams hero
           pattern: pass `excludeEl` so the headline / tagline / CTA row
           punches a soft hole in the rails so the copy is always
           readable. The mesh is decorative, so we set `pointer-events:
           none` on the wrapper via the `cl-hero-mesh` class. -->
      <MeshOfStreams
        class="cl-hero-mesh"
        seed="cloud-hero"
        layout="wide"
        :wheel-count="14"
        :connection-density="0.85"
        :grid-size="24"
        :corner-radius="14"
        :track-width="1"
        :intensity="0.55"
        edge-connections
        :exclude-el="heroInnerRef"
        :exclude-margin="28"
        :exclude-feather="44"
      />
      <div ref="heroInnerRef" class="cl-hero-inner">
        <h1 class="cl-hero-name">
          Electric&nbsp;<span class="cl-hero-accent">Cloud</span>
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
            text="Start building now"
            href="https://dashboard.electric-sql.cloud/"
          />
          <VPButton
            tag="a"
            size="medium"
            theme="alt"
            text="Docs"
            href="/cloud/usage"
          />
          <VPButton
            tag="a"
            size="medium"
            theme="alt"
            text="Pricing"
            href="/pricing"
          />
        </div>
      </div>
    </section>

    <!-- ─────────── §2 — Scalable data infrastructure ─────────── -->
    <EaSection
      id="scalable-infrastructure"
      title="Scalable data&nbsp;infrastructure"
      subtitle="Electric Cloud is a reactive data platform for multi-user, multi-agent systems. It provides turnkey, fully-managed hosting of Electric&nbsp;Streams and Electric&nbsp;Sync."
    >
      <div class="cl-product-grid">
        <a class="cl-product-card" href="/streams">
          <div class="cl-product-card-head">
            <img
              src="/img/icons/durable-streams.svg"
              alt=""
              class="cl-product-icon"
            />
            <h3>Electric&nbsp;Streams</h3>
          </div>
          <p>
            We host
            <a href="/streams" @click.stop>Electric&nbsp;Streams</a>
            &mdash; a fully-managed implementation of the open
            <a href="https://durablestreams.com/" @click.stop>Durable&nbsp;Streams</a>
            protocol &mdash; with
            <a href="#protocols" @click.stop>multiple transports</a>,
            from raw binary streams, to JSON mode, to protocol-specific
            adapters and user-defined sync protocols.
            See the
            <a
              href="/blog/2026/01/22/announcing-hosted-durable-streams"
              @click.stop
            >announcement blog post here</a>.
          </p>
          <span class="cl-product-cta">Explore Electric Streams →</span>
        </a>

        <a class="cl-product-card" href="/sync">
          <div class="cl-product-card-head">
            <img src="/img/icons/electric.svg" alt="" class="cl-product-icon" />
            <h3>Electric&nbsp;Sync</h3>
          </div>
          <p>
            We provision, run and operate the
            <a href="/sync" @click.stop>Electric&nbsp;Sync</a>
            engine for you. It connects to your Postgres, consumes changes
            over logical replication and provides a service endpoint for
            <a href="/docs/sync/guides/shapes" @click.stop>syncing shapes</a>
            into your client.
          </p>
          <span class="cl-product-cta">Explore Electric Sync →</span>
        </a>
      </div>
    </EaSection>

    <!-- ─────────── §3 — Data delivery network ─────────── -->
    <EaSection
      id="data-delivery-network"
      :dark="true"
      title="Data delivery&nbsp;network"
      subtitle="Electric syncs data over HTTP via CDN infrastructure. Electric Cloud leverages this to provide a global Data Delivery&nbsp;Network."
    >
      <p class="cl-ddn-prose">
        This allows you to scale out real-time data to
        <a href="/docs/sync/reference/benchmarks#cloud">millions of concurrent users</a>.
        With fast load times, low latency, and consistently low resource use.
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
      subtitle="Electric Cloud supports multiple sync protocols. Both Electric&nbsp;Streams and Electric&nbsp;Sync run over plain&nbsp;HTTP, which lets them integrate with CDN infrastructure for global, cached&nbsp;delivery."
    >
      <p class="cl-protocols-prose">
        See the
        <a href="/docs/sync/api/http">HTTP API reference</a>
        for Electric&nbsp;Sync, and the
        <a href="/docs/streams/">Electric&nbsp;Streams docs</a>
        for the streaming&nbsp;API.
      </p>

      <div class="cl-protocols-grid">
        <div class="cl-protocols-card">
          <h3>Clients</h3>
          <p>Official clients for both Electric&nbsp;Streams and Electric&nbsp;Sync:</p>
          <ul class="cl-protocol-list">
            <li>
              <a href="/docs/streams/clients/typescript">
                <span class="cl-protocol-name">Streams &mdash; TypeScript client</span>
                <span class="cl-protocol-arrow">→</span>
              </a>
            </li>
            <li>
              <a href="/docs/streams/clients/python">
                <span class="cl-protocol-name">Streams &mdash; Python client</span>
                <span class="cl-protocol-arrow">→</span>
              </a>
            </li>
            <li>
              <a href="/docs/sync/api/clients/typescript">
                <span class="cl-protocol-name">Sync &mdash; TypeScript client</span>
                <span class="cl-protocol-arrow">→</span>
              </a>
            </li>
            <li>
              <a href="/docs/sync/api/clients/elixir">
                <span class="cl-protocol-name">Sync &mdash; Elixir client</span>
                <span class="cl-protocol-arrow">→</span>
              </a>
            </li>
          </ul>
        </div>

        <div class="cl-protocols-card">
          <h3>Integrations</h3>
          <p>
            Framework and platform integrations across both products:
          </p>
          <ul class="cl-protocol-list">
            <li>
              <a href="/docs/sync/integrations/react">
                <span class="cl-protocol-name">React, Vue, Svelte, Solid&hellip;</span>
                <span class="cl-protocol-arrow">→</span>
              </a>
            </li>
            <li>
              <a href="/docs/sync/integrations/tanstack">
                <span class="cl-protocol-name">TanStack DB &amp; Query</span>
                <span class="cl-protocol-arrow">→</span>
              </a>
            </li>
            <li>
              <a href="/docs/streams/integrations/tanstack-ai">
                <span class="cl-protocol-name">TanStack AI</span>
                <span class="cl-protocol-arrow">→</span>
              </a>
            </li>
            <li>
              <a href="/docs/streams/integrations/vercel-ai-sdk">
                <span class="cl-protocol-name">Vercel AI SDK</span>
                <span class="cl-protocol-arrow">→</span>
              </a>
            </li>
          </ul>
        </div>
      </div>
    </EaSection>

    <!-- ───────────── §5 — Next steps / final CTA ─────────────
         Restyled from the boxed `.cl-cta` panel to the shared
         `<BottomCtaStrap>` so the page-close visual matches the
         agents / streams / sync landing pages. -->
    <BottomCtaStrap id="get-started">
      <template #eyebrow>
        Hosted &middot; usage-based &middot; built on open&nbsp;protocols
      </template>
      <template #title>
        Start building on&nbsp;Electric&nbsp;Cloud
      </template>
      <template #tagline>
        Hosted Electric&nbsp;Streams and Electric&nbsp;Sync, with&nbsp;a&nbsp;generous&nbsp;free&nbsp;tier.
      </template>
      <template #actions>
        <VPButton
          tag="a"
          size="medium"
          theme="brand"
          text="Start building now"
          href="https://dashboard.electric-sql.cloud/"
        />
        <VPButton
          tag="a"
          size="medium"
          theme="alt"
          text="Docs"
          href="/cloud/usage"
        />
        <VPButton
          tag="a"
          size="medium"
          theme="alt"
          text="Pricing"
          href="/pricing"
        />
      </template>
    </BottomCtaStrap>
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
  /* Matches the trimmed agents / streams / sync product heroes
     (72/56) so the four landing pages share the same vertical rhythm. */
  padding: 72px 24px 56px;
  text-align: center;
  overflow: hidden;
  /* No bg colour — the hero inherits the page surface (light or dark
     theme) so the four product pages share the same look. The mesh
     paints transparent except for the brand-teal tracks / wheels and
     fades to the page bg via the canvas's built-in radial mask. */
  /* Floor the height so the mesh has room to read as a network of
     wheels, not just a thin band of tracks. The hero text + CTAs
     normally measure ~280px tall; bumping the floor to 460px gives
     the mesh ~180px of breathing room above and below. Caps on
     narrower viewports below. */
  min-height: 460px;
}

.cl-hero-mesh {
  position: absolute;
  inset: 0;
  z-index: 0;
  /* Decorative — never intercept clicks meant for the CTAs above. */
  pointer-events: none;
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
  /* Standardized to 56px to match agents / streams / sync hero names. */
  font-size: 56px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
  background: none;
  -webkit-background-clip: border-box;
  background-clip: border-box;
  -webkit-text-fill-color: currentColor;
  /* Inherit the page text colour so the headline reads correctly on
     both the light and dark themes (was hard-coded #f3f7ff back when
     the hero forced a dark bg). */
  color: var(--vp-c-text-1);
  margin: 0;
  padding-bottom: 4px;
  text-wrap: balance;
}

.cl-hero-accent {
  color: var(--vp-c-brand-1);
  -webkit-text-fill-color: currentColor;
}

.cl-hero-tagline {
  font-family: var(--vp-font-family-base);
  /* Slightly smaller than the 28px tagline on the other product heroes
     because the cloud tagline is a longer descriptive sentence rather
     than a snappy strapline. 22px keeps the H1 → tagline hierarchy
     consistent across the matched set. */
  font-size: 22px;
  font-weight: 500;
  /* Inherit the muted page text colour (was hard-coded light back
     when the hero forced a dark bg). */
  color: var(--vp-c-text-2);
  margin: 24px auto 0;
  max-width: 720px;
  line-height: 1.4;
  text-wrap: balance;
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
    /* Bumped horizontal padding from 20 → 24 for more breathing room
       from the viewport edge on tablets / large phones. */
    padding: 56px 24px 40px;
    min-height: 380px;
  }
  .cl-hero-name {
    font-size: 36px;
  }
  .cl-hero-tagline {
    font-size: 18px;
  }
}

@media (max-width: 480px) {
  .cl-hero {
    /* Bumped horizontal padding from 16 → 20 for breathing room. */
    padding: 44px 20px 32px;
    min-height: 320px;
  }
  .cl-hero-name {
    font-size: 28px;
  }
  .cl-hero-tagline {
    font-size: 16px;
  }
  /* Stack the three CTAs full-width on the smallest screens so the
     primary / Docs / pricing trio doesn't wrap awkwardly. */
  .cl-hero-row {
    flex-direction: column;
    align-items: stretch;
    max-width: 280px;
    margin-left: auto;
    margin-right: auto;
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
  /* Card title — kept at 600 (one step below section h2). */
  font-weight: 600;
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
  /* Card title — kept at 600 (one step below section h2). */
  font-weight: 600;
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

/* §5 bottom CTA is now rendered by the shared `<BottomCtaStrap>`
   component (see `src/components/BottomCtaStrap.vue`). All visual
   styles for that strap live with the component — nothing extra is
   needed here. */

.no-wrap {
  white-space: nowrap;
}
</style>
