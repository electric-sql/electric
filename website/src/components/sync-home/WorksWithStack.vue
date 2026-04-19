<script setup>
import { onMounted, ref } from 'vue'

const sql = ref(undefined)
const tsx = ref(undefined)

onMounted(() => {
  if (typeof window !== 'undefined' && document.querySelector) {
    const sqlEl = document.getElementById('works-with-sql-template')
    const tsxEl = document.getElementById('works-with-tsx-template')
    if (sqlEl) sql.value = sqlEl.innerHTML
    if (tsxEl) tsx.value = tsxEl.innerHTML
  }
})
</script>

<template>
  <div class="ww-stack">
    <div class="ww-col ww-data-col">
      <div class="ww-data-sources">
        <div class="ww-data-source ww-data-source-primary">
          <div class="ww-data-source-header">
            <img src="/img/icons/electric.svg" class="ww-data-source-icon" />
            <a href="/sync" class="ww-data-source-label no-visual"
              >Database sync</a
            >
          </div>
          <div class="ww-data-source-code">
            <div v-if="sql !== undefined" v-html="sql"></div>
            <div v-else class="language-sql ww-placeholder" />
          </div>
        </div>
        <a href="/streams" class="ww-stream-card no-visual">
          <img
            src="/img/icons/durable-streams.svg"
            class="ww-data-source-icon"
          />
          <div class="ww-stream-text">
            <div class="ww-stream-title">Real-time streams</div>
            <div class="ww-stream-tagline">
              Append-only streams over HTTP
            </div>
          </div>
        </a>
      </div>
      <div class="ww-stack-label">Your data</div>
    </div>
    <div class="ww-col ww-stack-col">
      <div class="ww-layers">
        <a class="ww-layer no-visual" href="/docs/guides/auth">
          <div class="ww-layer-icon">
            <img src="/img/icons/auth.svg" />
          </div>
          <div class="ww-layer-body">
            <h4>Auth</h4>
            <p>With your API</p>
          </div>
        </a>
        <a class="ww-layer no-visual" href="/docs/guides/writes">
          <div class="ww-layer-icon">
            <img src="/img/icons/writes.svg" />
          </div>
          <div class="ww-layer-body">
            <h4>Write</h4>
            <p>Through your backend</p>
          </div>
        </a>
        <a class="ww-layer no-visual" href="/docs/api/http">
          <div class="ww-layer-icon">
            <img src="/img/icons/deploy.png" />
          </div>
          <div class="ww-layer-body">
            <h4>Middleware</h4>
            <p>It's just HTTP &amp; JSON</p>
          </div>
        </a>
      </div>
      <div class="ww-stack-label">Your stack</div>
    </div>
    <div class="ww-col ww-app-col">
      <div class="ww-data-source ww-data-source-full">
        <div class="ww-data-source-header">
          <img src="/img/icons/tanstack.svg" class="ww-data-source-icon" />
          <a
            href="/sync/tanstack-db"
            class="ww-data-source-label no-visual"
            style="margin-left: 2px"
            >TanStack DB</a
          >
        </div>
        <div class="ww-data-source-code">
          <div v-if="tsx !== undefined" v-html="tsx"></div>
          <div v-else class="language-tsx ww-placeholder" />
        </div>
      </div>
      <div class="ww-stack-label">Your app</div>
    </div>
  </div>
</template>

<style scoped>
.ww-stack {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 32px;
  overflow: hidden;
}

.ww-col {
  min-width: 0;
}

.ww-data-sources {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 264px;
}

.ww-data-source {
  border-radius: 8px;
  border: 1px solid var(--ea-divider);
  background: var(--ea-surface);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: border-color 0.2s;
}

.ww-data-source-primary {
  flex: 1;
  min-height: 0;
}

.ww-data-source-full {
  height: 264px;
}

.ww-data-source-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
}

.ww-data-source-icon {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  margin-right: -6px;
}

.ww-data-source-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--ea-text-1);
  line-height: 1.4;
}

.ww-data-source-code {
  flex: 1;
  background: var(--ea-surface);
  display: flex;
  align-items: center;
  border-top: 1px solid var(--ea-divider);
  min-width: 0;
  overflow: hidden;
}

.ww-data-source-code :deep(div[class*='language-']) {
  margin: 0 !important;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent !important;
  height: auto;
  width: 100%;
}

.ww-data-source-code :deep(div[class*='language-'] button),
.ww-data-source-code :deep(div[class*='language-'] .lang) {
  display: none;
}

.ww-data-source-code :deep(pre) {
  margin: 0;
  padding: 14px 16px;
  background: transparent !important;
}

.ww-data-source-code :deep(code) {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}

.ww-data-source-code :deep(p) {
  margin: 0;
}

.ww-placeholder {
  width: 100%;
  height: 100%;
}

.ww-stream-card {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  height: 96px;
  border-radius: 8px;
  border: 1px solid var(--ea-divider);
  background: var(--ea-surface);
  text-decoration: none;
  transition: border-color 0.2s;
}

.ww-stream-card:hover {
  border-color: var(--vp-c-brand-1);
}

.ww-stream-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.ww-stream-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ea-text-1);
  line-height: 1.4;
}

.ww-stream-tagline {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--ea-text-3);
  line-height: 1.4;
}

.ww-data-source-primary:hover,
.ww-data-source-full:hover {
  border-color: var(--vp-c-brand-1);
}

.ww-stack-label {
  color: var(--ea-text-3);
  font-family: var(--vp-font-family-mono);
  font-weight: 500;
  font-size: 12px;
  text-align: center;
  margin-top: 14px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.ww-layers {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 264px;
}

.ww-layer {
  flex: 1;
  padding: 14px 16px;
  border-radius: 8px;
  border: 1px solid var(--ea-divider);
  background: var(--ea-surface);
  display: flex;
  flex-direction: row;
  justify-content: flex-start;
  align-items: center;
  text-align: left;
  text-decoration: none;
  transition: border-color 0.2s;
}

.ww-layer:hover {
  border-color: var(--vp-c-brand-1);
}

.ww-layer-icon img {
  width: 28px;
  margin: 0 14px 0 6px;
}

.ww-layer-body h4 {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: var(--ea-text-1);
  line-height: 1.3;
}

.ww-layer-body p {
  color: var(--ea-text-3);
  font-weight: 450;
  font-size: 13px;
  line-height: 18px;
  margin: 2px 0 0 !important;
}

@media (max-width: 791px) {
  .ww-stack {
    grid-template-columns: 1fr;
    gap: 32px;
  }
  .ww-data-col {
    order: 0;
  }
  .ww-stack-col {
    order: 1;
  }
  .ww-app-col {
    order: 2;
  }
  .ww-data-sources,
  .ww-data-source-full,
  .ww-layers {
    max-width: 511px;
    margin-left: auto !important;
    margin-right: auto !important;
  }
}
</style>
