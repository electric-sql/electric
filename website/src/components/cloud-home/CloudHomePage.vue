<script setup lang="ts">
import { VPButton } from "vitepress/theme"

import EaSection from "../agents-home/Section.vue"
import BottomCtaStrap from "../BottomCtaStrap.vue"
import CloudHero from "./CloudHero.vue"
import { useMarkdownExport } from "../../lib/useMarkdownExport"

const isMarkdownExport = useMarkdownExport()
</script>

<template>
  <div class="cl-home">
    <!-- ─────────────────── §1 — Hero ─────────────────── -->
    <CloudHero />

    <!-- ─────────── §2 — Scalable data infrastructure ─────────── -->
    <EaSection
      id="scalable-infrastructure"
      title="Scalable data&nbsp;infrastructure"
      subtitle="Electric Cloud is a reactive data platform for multi-user, multi-agent systems. It provides turnkey, fully-managed hosting of Electric&nbsp;Streams and Electric&nbsp;Sync."
    >
      <div class="cl-product-grid">
        <component
          :is="isMarkdownExport ? 'div' : 'a'"
          class="cl-product-card"
          :href="isMarkdownExport ? undefined : '/streams'"
        >
          <div class="cl-product-card-head">
            <img
              src="/img/icons/durable-streams.svg"
              alt=""
              class="cl-product-icon md-exclude"
            />
            <h3>Electric&nbsp;Streams</h3>
          </div>
          <p>
            We host
            <a href="/streams/" @click.stop>Electric&nbsp;Streams</a>
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
          <component
            :is="isMarkdownExport ? 'a' : 'span'"
            class="cl-product-cta"
            :href="isMarkdownExport ? '/streams' : undefined"
          >
            Explore Electric Streams<span class="md-exclude"> →</span>
          </component>
        </component>

        <component
          :is="isMarkdownExport ? 'div' : 'a'"
          class="cl-product-card"
          :href="isMarkdownExport ? undefined : '/sync'"
        >
          <div class="cl-product-card-head">
            <img src="/img/icons/electric.svg" alt="" class="cl-product-icon md-exclude" />
            <h3>Electric&nbsp;Sync</h3>
          </div>
          <p>
            We provision, run and operate the
            <a href="/sync/" @click.stop>Electric&nbsp;Sync</a>
            engine for you. It connects to your Postgres, consumes changes
            over logical replication and provides a service endpoint for
            <a href="/docs/sync/guides/shapes" @click.stop>syncing shapes</a>
            into your client.
          </p>
          <component
            :is="isMarkdownExport ? 'a' : 'span'"
            class="cl-product-cta"
            :href="isMarkdownExport ? '/sync' : undefined"
          >
            Explore Electric Sync<span class="md-exclude"> →</span>
          </component>
        </component>
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

      <ul v-if="isMarkdownExport" class="cl-stat-list-md">
        <li><strong>Millions.</strong> of concurrent users per shape.</li>
        <li><strong>Global.</strong> CDN delivery, edge cached.</li>
        <li><strong>HTTP.</strong> Just standard, cacheable HTTP.</li>
      </ul>
      <div v-else class="cl-stat-row">
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
                <span class="cl-protocol-arrow md-exclude">→</span>
              </a>
            </li>
            <li>
              <a href="/docs/streams/clients/python">
                <span class="cl-protocol-name">Streams &mdash; Python client</span>
                <span class="cl-protocol-arrow md-exclude">→</span>
              </a>
            </li>
            <li>
              <a href="/docs/sync/api/clients/typescript">
                <span class="cl-protocol-name">Sync &mdash; TypeScript client</span>
                <span class="cl-protocol-arrow md-exclude">→</span>
              </a>
            </li>
            <li>
              <a href="/docs/sync/api/clients/elixir">
                <span class="cl-protocol-name">Sync &mdash; Elixir client</span>
                <span class="cl-protocol-arrow md-exclude">→</span>
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
                <span class="cl-protocol-arrow md-exclude">→</span>
              </a>
            </li>
            <li>
              <a href="/docs/sync/integrations/tanstack">
                <span class="cl-protocol-name">TanStack DB &amp; Query</span>
                <span class="cl-protocol-arrow md-exclude">→</span>
              </a>
            </li>
            <li>
              <a href="/docs/streams/integrations/tanstack-ai">
                <span class="cl-protocol-name">TanStack AI</span>
                <span class="cl-protocol-arrow md-exclude">→</span>
              </a>
            </li>
            <li>
              <a href="/docs/streams/integrations/vercel-ai-sdk">
                <span class="cl-protocol-name">Vercel AI SDK</span>
                <span class="cl-protocol-arrow md-exclude">→</span>
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
        <span v-if="!isMarkdownExport">
          Hosted &middot; usage-based &middot; built on open&nbsp;protocols
        </span>
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

/* §1 hero is now rendered by `<CloudHero>` (extracted into
   `./CloudHero.vue` so the same hero block can be re-used on the
   `/og/cloud` social-image route). All hero-specific styles live
   with the component. */

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
</style>
