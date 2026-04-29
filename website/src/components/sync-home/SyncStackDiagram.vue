<script setup lang="ts">
// Static diagram (no entry animation) showing the full Electric Sync
// dataflow: read path on the left through Electric, write path on the
// right through your own server API. Designed to sit directly on the
// section background — no outer wrapper card.
</script>

<template>
  <div class="ssd" aria-hidden="true">
    <!-- Tier 1: Your app — three swappable client chips -->
    <div class="ssd-tier ssd-app">
      <div class="ssd-tier-head">
        <span class="ssd-tier-label mono">Your&nbsp;app</span>
      </div>
      <div class="ssd-clients">
        <div class="ssd-client">
          <img
            class="ssd-client-icon"
            src="/img/icons/tanstack.svg"
            alt=""
            aria-hidden="true"
          />
          <span class="ssd-client-text">
            <span class="ssd-client-name">TanStack&nbsp;DB</span>
            <span class="ssd-client-meta mono">live&nbsp;queries</span>
          </span>
        </div>
        <div class="ssd-client">
          <img
            class="ssd-client-icon"
            src="/img/icons/pglite.svg"
            alt=""
            aria-hidden="true"
          />
          <span class="ssd-client-text">
            <span class="ssd-client-name">PGlite</span>
            <span class="ssd-client-meta mono">embedded&nbsp;pg</span>
          </span>
        </div>
        <div class="ssd-client">
          <!-- Inline TypeScript brand mark (no asset in /img/icons). -->
          <svg class="ssd-client-icon" viewBox="0 0 24 24" aria-hidden="true">
            <rect width="24" height="24" rx="3" fill="#3178c6" />
            <text
              x="12"
              y="17"
              text-anchor="middle"
              font-size="10"
              font-weight="700"
              font-family="system-ui, -apple-system, Segoe UI, sans-serif"
              fill="#fff"
              letter-spacing="0.5"
            >
              TS
            </text>
          </svg>
          <span class="ssd-client-text">
            <span class="ssd-client-name mono">@electric-sql/client</span>
            <span class="ssd-client-meta mono">low&nbsp;level</span>
          </span>
        </div>
      </div>
    </div>

    <!-- Arrow row 1 (between app and middle tier) — centered on each
         middle-tier box below. -->
    <div class="ssd-arrow ssd-arrow-up" data-pos="left-top">
      <svg class="ssd-arrow-svg" viewBox="0 0 12 18">
        <line x1="6" y1="17" x2="6" y2="4" />
        <polyline points="2,7 6,2 10,7" />
      </svg>
      <span class="ssd-arrow-label mono">HTTP&nbsp;· shapes</span>
    </div>
    <div class="ssd-arrow ssd-arrow-down" data-pos="right-top">
      <svg class="ssd-arrow-svg" viewBox="0 0 12 18">
        <line x1="6" y1="1" x2="6" y2="14" />
        <polyline points="2,11 6,16 10,11" />
      </svg>
      <span class="ssd-arrow-label mono">writes</span>
    </div>

    <!-- Tier 2 left: Electric sync engine -->
    <div class="ssd-tier ssd-engine">
      <div class="ssd-engine-name">Electric sync&nbsp;engine</div>
      <div class="ssd-tier-meta mono">open&nbsp;source · CDN-cached</div>
    </div>
    <!-- Tier 2 right: Your server API -->
    <div class="ssd-tier ssd-api">
      <div class="ssd-api-name">Your server&nbsp;API</div>
      <div class="ssd-tier-meta mono">writes &amp; business&nbsp;logic</div>
    </div>

    <!-- Arrow row 2 (between middle tier and Postgres) -->
    <div class="ssd-arrow ssd-arrow-up" data-pos="left-bottom">
      <svg class="ssd-arrow-svg" viewBox="0 0 12 18">
        <line x1="6" y1="17" x2="6" y2="4" />
        <polyline points="2,7 6,2 10,7" />
      </svg>
      <span class="ssd-arrow-label mono">logical&nbsp;replication</span>
    </div>
    <div class="ssd-arrow ssd-arrow-down" data-pos="right-bottom">
      <svg class="ssd-arrow-svg" viewBox="0 0 12 18">
        <line x1="6" y1="1" x2="6" y2="14" />
        <polyline points="2,11 6,16 10,11" />
      </svg>
      <span class="ssd-arrow-label mono">SQL</span>
    </div>

    <!-- Tier 3: Your Postgres (full width) -->
    <div class="ssd-tier ssd-pg">
      <div class="ssd-pg-name">Your&nbsp;Postgres</div>
      <div class="ssd-tier-meta mono">any&nbsp;host · any&nbsp;version</div>
    </div>
  </div>
</template>

<style scoped>
.ssd {
  --brand: var(--vp-c-brand-1);
  --read: var(--vp-c-brand-1);
  --write: var(--ea-text-3);

  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-areas:
    'app    app'
    'arrU1  arrD1'
    'eng    api'
    'arrU2  arrD2'
    'pg     pg';
  column-gap: 14px;
  row-gap: 0;

  width: 100%;
  max-width: 560px;
  margin-left: auto;
  margin-right: auto;
}

.ssd-app {
  grid-area: app;
}
.ssd-engine {
  grid-area: eng;
}
.ssd-api {
  grid-area: api;
}
.ssd-pg {
  grid-area: pg;
}
.ssd-arrow[data-pos='left-top'] {
  grid-area: arrU1;
}
.ssd-arrow[data-pos='right-top'] {
  grid-area: arrD1;
}
.ssd-arrow[data-pos='left-bottom'] {
  grid-area: arrU2;
}
.ssd-arrow[data-pos='right-bottom'] {
  grid-area: arrD2;
}

/* Tiers ────────────────────────────────────────────────────────── */

.ssd-tier {
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  background: var(--ea-surface-alt);
  padding: 7px 12px 6px;
  text-align: center;
}

.ssd-tier-head {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  margin-bottom: 6px;
}
.ssd-tier-label {
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ea-text-3);
}
.ssd-tier-meta {
  margin-top: 0;
  font-size: 10.5px;
  color: var(--ea-text-3);
  letter-spacing: 0.02em;
  line-height: 1.3;
}

/* App tier ─────────────────────────────────────────────────────── */

.ssd-app {
  text-align: left;
  padding: 7px 8px 6px;
}
.ssd-clients {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.ssd-client {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 7px;
  padding: 6px 7px;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 6px;
  text-align: left;
  min-width: 0;
}
.ssd-client-icon {
  width: 18px;
  height: 18px;
  display: block;
  flex-shrink: 0;
}
.ssd-client-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0;
  min-width: 0;
  flex: 1 1 auto;
}
.ssd-client-name {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ea-text-1);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.ssd-client-name.mono {
  font-size: 10.5px;
}
.ssd-client-meta {
  font-size: 9.5px;
  color: var(--ea-text-3);
  letter-spacing: 0.02em;
  line-height: 1.3;
}

/* Engine tier ──────────────────────────────────────────────────── */

.ssd-engine {
  background: color-mix(in srgb, var(--brand) 6%, var(--ea-surface));
  border-color: color-mix(in srgb, var(--brand) 25%, var(--ea-divider));
}
.ssd-engine-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--brand);
  line-height: 1.25;
  margin-bottom: 1px;
}

/* Server API tier ──────────────────────────────────────────────── */

.ssd-api-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--ea-text-1);
  line-height: 1.25;
  margin-bottom: 1px;
}

/* Postgres tier ────────────────────────────────────────────────── */

.ssd-pg-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--ea-text-1);
  line-height: 1.25;
  margin-bottom: 1px;
}

/* Arrows — centered horizontally above their target box, label
   stacked underneath the arrow. ─────────────────────────────── */

.ssd-arrow {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 4px 0;
  min-height: 38px;
}

.ssd-arrow-svg {
  width: 12px;
  height: 18px;
  display: block;
  fill: none;
  stroke-width: 1.25;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex-shrink: 0;
}
.ssd-arrow-up .ssd-arrow-svg {
  stroke: var(--read);
}
.ssd-arrow-down .ssd-arrow-svg {
  stroke: var(--write);
}

.ssd-arrow-label {
  font-size: 10px;
  color: var(--ea-text-3);
  white-space: nowrap;
  letter-spacing: 0.02em;
}

/* Narrow viewports ────────────────────────────────────────────── */

@media (max-width: 720px) {
  .ssd {
    column-gap: 10px;
  }
  .ssd-arrow {
    min-height: 34px;
  }
  .ssd-arrow-svg {
    height: 16px;
  }
  .ssd-arrow-label {
    font-size: 9.5px;
  }
  .ssd-engine-name,
  .ssd-api-name,
  .ssd-pg-name {
    font-size: 12px;
  }
  .ssd-client {
    gap: 6px;
    padding: 5px 6px;
  }
  .ssd-client-name {
    font-size: 11px;
  }
  .ssd-client-name.mono {
    font-size: 10px;
  }
  .ssd-client-meta {
    font-size: 9px;
  }
  .ssd-client-icon {
    width: 16px;
    height: 16px;
  }
}

/* On phones, keep the parallel structure but compress aggressively
   so the @electric-sql/client chip doesn't blow out the row. The
   icon-beside-text layout is preserved — when space is really tight
   the long mono name is allowed to wrap onto two lines. */
@media (max-width: 480px) {
  .ssd {
    column-gap: 6px;
  }
  .ssd-tier {
    padding: 6px 6px 5px;
  }
  .ssd-clients {
    gap: 4px;
  }
  .ssd-client {
    padding: 5px 4px;
    gap: 5px;
  }
  .ssd-client-name {
    font-size: 10px;
  }
  .ssd-client-name.mono {
    font-size: 9px;
    white-space: normal;
    word-break: break-word;
  }
  .ssd-client-meta {
    font-size: 8.5px;
  }
  .ssd-client-icon {
    width: 14px;
    height: 14px;
  }
  .ssd-arrow {
    min-height: 30px;
    padding: 3px 0;
  }
  .ssd-arrow-svg {
    height: 14px;
    width: 10px;
  }
  .ssd-arrow-label {
    font-size: 9px;
  }
  .ssd-engine-name,
  .ssd-api-name,
  .ssd-pg-name {
    font-size: 11px;
  }
}
</style>
