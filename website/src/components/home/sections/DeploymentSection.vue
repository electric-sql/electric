<script setup>
import EaSection from '../../agents-home/Section.vue'

/* DeploymentSection — "Managed cloud or self&#8209;host".

   Lifted to match the landing-page CTA panels (cloud-home / sync-home /
   streams-home / agents-home) using --ea- tokens, an eyebrow chip with
   the brand dot, gradient-accent title, and a single source of "go do
   something" CTAs.

   Folds in what GetStartedStrap used to do at the bottom of the page —
   the secondary cards now carry the Quickstart / Docs / GitHub buttons
   so we don't repeat the same call to action twice further down. */

const cloudUrl = '/cloud'
</script>

<template>
  <EaSection id="deployment">
    <template #title>
      Managed cloud or&nbsp;self&#8209;hosted
    </template>
    <template #subtitle>
      Vendor agnostic, infra agnostic. Sign up for
      <a :href="cloudUrl">Electric&nbsp;Cloud</a> or self-host the
      <span class="no-wrap">Apache&nbsp;2.0</span>,
      <a href="https://github.com/electric-sql/electric">open&#8209;source</a>
      sync engine.
    </template>

    <div class="dp-grid">
      <a class="dp-cloud no-visual" :href="cloudUrl">
        <div class="dp-cloud-eyebrow mono">
          <span class="dot"></span>
          Hosted &middot; usage-based &middot; turnkey
        </div>
        <div class="dp-cloud-body">
          <div class="dp-cloud-icon">
            <img src="/img/icons/ddn.svg" alt="Electric Cloud" />
          </div>
          <div class="dp-cloud-text">
            <h3>
              Start building on Electric&nbsp;Cloud
            </h3>
            <p>
              <span class="hidden-sm">Scalable, turnkey</span>
              <span class="inline-sm">Scalable</span>
              hosting with
              <span class="no-wrap">usage-based pricing</span>.
            </p>
          </div>
        </div>
        <div class="dp-cloud-actions">
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
      </a>

      <div class="dp-secondary-grid">
        <a class="dp-card no-visual" href="/docs/quickstart">
          <div class="dp-card-head">
            <img src="/img/icons/coding.svg" class="dp-card-icon" />
            <h4>Local development</h4>
          </div>
          <p>
            Spin up the starter, point it at Postgres and ship a real-time
            app on top of your existing&nbsp;stack.
          </p>
          <div class="dp-card-foot mono">
            <span>Quickstart</span>
            <span class="dp-card-sep">·</span>
            <a href="/docs/intro" class="dp-card-link" @click.stop>Docs →</a>
          </div>
        </a>

        <a
          class="dp-card no-visual"
          href="https://github.com/electric-sql/electric"
        >
          <div class="dp-card-head">
            <img src="/img/icons/github.light.svg" class="dp-card-icon" />
            <h4>Open source</h4>
          </div>
          <p>
            Apache&nbsp;2.0 license, thriving community and millions of
            <span class="no-wrap">downloads a week</span>.
          </p>
          <div class="dp-card-foot mono">
            <span>GitHub</span>
            <span class="dp-card-sep">·</span>
            <a href="/about/community" class="dp-card-link" @click.stop
              >Community →</a
            >
          </div>
        </a>
      </div>
    </div>
  </EaSection>
</template>

<style scoped>
.dp-grid {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* ── Primary cloud panel ──────────────────────────────────────── */

.dp-cloud {
  position: relative;
  display: block;
  padding: 40px 32px 48px;
  border-radius: 12px;
  border: 1px solid var(--ea-divider);
  background:
    linear-gradient(to right, var(--ea-surface) 45%, transparent 85%),
    linear-gradient(var(--ec-overlay-medium), var(--ec-overlay-medium)),
    url('/img/home/dashboard-stream.jpg') right top / auto 109% no-repeat,
    var(--ea-surface);
  overflow: hidden;
  isolation: isolate;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.2s ease, transform 0.2s ease;
}

.dp-cloud:hover {
  border-color: var(--vp-c-brand-2);
  transform: translateY(-1px);
}

.dp-cloud-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ea-text-3);
  padding: 4px 10px;
  background: var(--ea-surface-alt);
  border: 1px solid var(--ea-divider);
  border-radius: 999px;
  margin-bottom: 22px;
}

.dp-cloud-eyebrow .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}

.dp-cloud-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  gap: 18px;
}

.dp-cloud-icon img {
  width: 56px;
}

.dp-cloud-text h3 {
  margin: 0 0 10px 0;
  font-size: 28px;
  /* Card title — 600 (down from 800) so it sits a step below the
     section h2 weight without inverting the hierarchy. */
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: var(--ea-text-1);
  max-width: 480px;
  text-wrap: balance;
}

.dp-cloud-text p {
  margin: 0;
  max-width: 480px;
  color: var(--ea-text-2);
  font-weight: 500;
  font-size: 15px;
  line-height: 1.6;
}

.dp-cloud-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
}

/* ── Secondary cards ──────────────────────────────────────────── */

.dp-secondary-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

.dp-card {
  display: flex;
  flex-direction: column;
  padding: 22px 24px;
  border-radius: 10px;
  border: 1px solid var(--ea-divider);
  background: var(--ea-surface);
  text-decoration: none;
  color: inherit;
  transition: border-color 0.2s ease, transform 0.2s ease;
}

.dp-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}

.dp-card-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.dp-card-icon {
  width: 28px;
  height: 28px;
}

.dp-card h4 {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
  color: var(--ea-text-1);
  line-height: 1.3;
}

.dp-card p {
  font-size: 14px;
  line-height: 1.6;
  color: var(--ea-text-2);
  margin: 0 0 16px;
  flex: 1;
}

.dp-card-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--vp-c-brand-1);
  font-weight: 500;
  letter-spacing: 0.02em;
}

.dp-card-sep {
  color: var(--ea-text-3);
}

.dp-card-link {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.dp-card-link:hover {
  text-decoration: underline;
}

/* ── Responsive ───────────────────────────────────────────────── */

@media (min-width: 1280px) {
  .dp-cloud {
    padding: 48px 32px 52px;
  }
}

@media (min-width: 1024px) and (max-width: 1279px) {
  .dp-cloud {
    padding: 44px 32px 50px;
  }
}

@media (max-width: 768px) {
  .dp-cloud {
    padding: 36px 28px 42px;
    background:
      linear-gradient(to right, var(--ea-surface) 40%, transparent 85%),
      linear-gradient(var(--ec-overlay-medium), var(--ec-overlay-medium)),
      url('/img/home/dashboard-stream.jpg') right top / auto 109% no-repeat,
      var(--ea-surface);
  }
  .dp-cloud-icon img {
    width: 48px;
  }
  .dp-cloud-text h3 {
    font-size: 24px;
  }
  .dp-secondary-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 518px) {
  .dp-cloud {
    padding: 28px 22px 36px;
    background:
      linear-gradient(to right, var(--ea-surface) 40%, transparent 85%),
      linear-gradient(var(--ec-overlay-strong), var(--ec-overlay-strong)),
      url('/img/home/dashboard-stream.jpg') right top / auto 109% no-repeat,
      var(--ea-surface);
  }
}
</style>
