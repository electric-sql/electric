<script setup>
import { onMounted, ref } from 'vue'

import Card from '../Card.vue'
import Section from '../Section.vue'

const integrations = [
  {
    slug: 'neon',
    name: 'Neon',
  },
  {
    slug: 'supabase',
    name: 'Supabase',
  },
  {
    slug: 'vercel',
    name: 'Vercel',
  },
  {
    slug: 'tanstack',
    name: 'TanStack',
  },
  {
    slug: 'phoenix',
    name: 'Phoenix',
  },
  {
    slug: 'react',
    name: 'React',
  },
]

const actions = [
  {
    href: '/docs/quickstart',
    text: 'Quickstart',
    theme: 'brand',
  },
  // {
  //   href: '/docs/tutorial',
  //   text: 'Tutorial'
  // }
  {
    href: '/docs/intro',
    text: 'Docs',
  },
]

const sql = ref(undefined)
const sse = ref(undefined)
const tsx = ref(undefined)

onMounted(() => {
  if (typeof window !== 'undefined' && document.querySelector) {
    sql.value = document.getElementById('works-with-sql-template').innerHTML
    sse.value = document.getElementById('works-with-sse-template').innerHTML
    tsx.value = document.getElementById('works-with-tsx-template').innerHTML
  }
})
</script>

<style scoped>
.your-stack {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 32px;
  margin: 40px 0px 40px;
  overflow: hidden;
}

.your-stack :deep(div[class*='language-']) {
  margin: 0 !important;

  border-radius: 12px;
  border: 1px solid rgba(42, 44, 52, 0.5);
  background: var(--vp-c-bg-soft);
  height: 288px;
}

.your-stack :deep(div[class*='language-'] button),
.your-stack :deep(div[class*='language-'] .lang) {
  display: none;
}

.your-stack :deep(div[class*='language-'].placeholder) {
  width: 100%;
  height: 288px;
}

/*@media (max-width: 959px) {
    .your-stack {
      gap: 30px;
      grid-template-columns: 1fr 1fr;
    }
  }
  @media (max-width: 518px) {
    .your-stack {
      margin: 32px 24px 40px;
      gap: 24px;
      grid-template-columns: 1fr;
    }
  }*/

.stack-label {
  color: var(--vp-c-text-3);
  font-weight: 500;
  font-size: 15px;
  text-align: center;
  margin-top: 14px;
}

.data-sources {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 288px;
}

.data-source {
  flex: 1;
  border-radius: 12px;
  border: 1px solid rgba(42, 44, 52, 0.5);
  background: var(--vp-c-bg-soft);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.data-source-full {
  height: 288px;
}

.data-source-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
}

.data-source-icon {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  margin-right: -6px;
}

.data-source-label {
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  line-height: 1.4;
}

.data-source-code {
  flex: 1;
  background: var(--vp-c-bg);
  display: flex;
  align-items: center;
  border-top: 1px solid rgba(42, 44, 52, 0.3);
}

.data-source-code code {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.data-source-code :deep(div[class*='language-']) {
  margin: 0 !important;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent !important;
  height: auto;
}

.data-source-code :deep(pre) {
  margin: 0;
  padding: 14px 16px;
  background: transparent !important;
}

.data-source-code :deep(code) {
  font-size: 12px;
}

.data-source-code :deep(p) {
  margin: 0;
}

.layers {
  text-align: center;
}
.layer {
  padding: 17px;
  margin-bottom: 15px;
  border-radius: 12px;
  border: 1px solid rgba(42, 44, 52, 0.5);
  background: var(--vp-c-bg-soft);

  display: flex;
  flex-direction: row;
  justify-content: flex-start;
  align-items: center;
  text-align: left;
}
.layer:last-child {
  margin-bottom: 0;
}

.layer .icon img {
  width: 32px;
  margin: 0 16px 0 12px;
}
.layer .body {
}
.layer h4 {
  font-size: 15px;
  font-weight: 550;
  margin: 0;
  color: var(--vp-c-text-1);
  margin-top: 1px;
}
.layer p {
  color: var(--vp-c-text-3);
  font-weight: 450;
  font-size: 13px;
  line-height: 20px;
  margin: 3px auto 2px !important;
  max-width: 270px;
}

@media (min-width: 960px) and (max-width: 1099px) {
  .your-stack :deep(div[class*='language-']) {
    font-size: 14px;
  }
}

@media (max-width: 959px) {
  .your-stack {
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }
  .layers {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 24px;
  }
  .layer,
  .layer:last-child {
    margin-bottom: 0px;
  }

  .your-stack :deep(div[class*='language-']) {
    max-width: 512px;
    margin-left: auto !important;
    margin-right: auto !important;
  }

  .your-data-col {
    order: 0;
  }
  .your-stack-col {
    order: 2;
    grid-column: 1 / span 2;
  }
  .your-app-col {
    order: 1;
  }

  .stack-label {
    color: var(--vp-c-text-3);
    font-weight: 500;
    font-size: 14px;
    text-align: center;
    margin-top: 12px;
    margin-bottom: 4px;
  }
}
@media (max-width: 869px) {
  .layers {
    gap: 16px;
  }
  .layer .icon img {
    width: 28px;
    margin: 0 14px 0 8px;
  }
}
@media (max-width: 791px) {
  .your-stack {
    grid-template-columns: 1fr;
    gap: 32px;
  }
  .your-data-col {
    order: 0;
  }
  .your-stack-col {
    order: 1;
    grid-column: 1;
  }
  .your-app-col {
    order: 2;
  }
  .data-sources {
    gap: 20px;
  }

  .layers,
  .your-stack :deep(div[class*='language-']),
  .data-sources,
  .data-source-full {
    max-width: 511px;
    margin-left: auto !important;
    margin-right: auto !important;
  }
  .layers {
    display: grid;
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .data-sources {
    height: auto;
  }
}
@media (max-width: 639px) {
  .layers,
  .your-stack :deep(div[class*='language-']),
  .data-sources,
  .data-source-full {
    /*max-width: 384px;*/
  }
}
@media (max-width: 518px) {
  .layers,
  .your-stack :deep(div[class*='language-']),
  .data-sources,
  .data-source-full {
    /*max-width: 320px;*/
  }
  .data-source-code code {
    font-size: 11px;
  }
}

.integrations {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 24px;
}
.integration-icon {
  width: 64px;
  margin: 0 auto;
}
.integration-label {
  padding: 12px 0 14px;
  text-align: center;
  color: var(--vp-c-text-3);
  font-weight: 500;
  font-size: 14px;
}
.integrations :deep(.card .body) {
  padding: 28px;
}
@media (max-width: 869px) {
  .integrations {
    gap: 20px;
  }
  .integrations :deep(.card .body) {
    padding: 24px;
  }
}
@media (max-width: 791px) {
  .integrations {
    gap: 18px;
  }
  .integrations :deep(.card .body) {
    padding: 18px;
  }
}
@media (max-width: 699px) {
  .integrations :deep(.card .body) {
    padding: 17px;
  }
}
@media (max-width: 599px) {
  .integrations {
    gap: 20px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .integrations :deep(.card .body) {
    padding: 18px;
  }
}
</style>

<template>
  <Section :actions="actions" :wideSectionHead="false">
    <template #title>Works with your&nbsp;stack</template>
    <template #override-tagline>
      <p>
        Any web framework and client that
        <span class="no-wrap">speaks HTTP and JSON</span>
      </p>
    </template>
    <div class="your-stack">
      <div class="col your-data-col">
        <div class="data-sources">
          <div class="data-source">
            <div class="data-source-header">
              <img
                src="/img/icons/electric.svg"
                class="data-source-icon"
              />
              <a href="/products/postgres-sync" class="data-source-label no-visual"
                >Database sync</a
              >
            </div>
            <div class="data-source-code">
              <div v-if="sql !== undefined" v-html="sql"></div>
            </div>
          </div>
          <div class="data-source">
            <div class="data-source-header">
              <img
                src="/img/icons/durable-streams.svg"
                class="data-source-icon"
              />
              <a href="/products/durable-streams" class="data-source-label no-visual"
                >Real-time streams</a
              >
            </div>
            <div class="data-source-code">
              <div v-if="sse !== undefined" v-html="sse"></div>
            </div>
          </div>
        </div>
        <div class="stack-label">Your data</div>
      </div>
      <div class="col your-stack-col">
        <div class="layers">
          <a class="layer no-visual" href="/docs/guides/auth">
            <div class="icon">
              <img src="/img/icons/auth.svg" />
            </div>
            <div class="body">
              <h4>Auth</h4>
              <p>With your API</p>
            </div>
          </a>
          <a class="layer no-visual" href="/docs/guides/writes">
            <div class="icon">
              <img src="/img/icons/writes.svg" />
            </div>
            <div class="body">
              <h4>Write</h4>
              <p>Through your backend</p>
            </div>
          </a>
          <a class="layer no-visual" href="/docs/api/http">
            <div class="icon">
              <img src="/img/icons/deploy.png" />
            </div>
            <div class="body">
              <h4>Middleware</h4>
              <p>
                It's
                <span class="hidden-xl"> all</span>
                just
                <span class="no-wrap">
                  HTTP
                  <span class="inline-xl">&amp;</span>
                  <span class="hidden-xl">and</span>
                  JSON</span
                >
              </p>
            </div>
          </a>
        </div>
        <div class="stack-label">Your stack</div>
      </div>
      <div class="col your-app-col">
        <div class="data-source data-source-full">
          <div class="data-source-header">
            <img
              src="/img/icons/tanstack.svg"
              class="data-source-icon"
            />
            <a href="/products/tanstack-db" class="data-source-label no-visual" style="margin-left: 2px">Live data</a>
          </div>
          <div class="data-source-code" id="works-with-tsx">
            <div v-if="tsx !== undefined" v-html="tsx"></div>
            <div v-else class="language-tsx placeholder" />
          </div>
        </div>
        <div class="stack-label">Your app</div>
      </div>
    </div>
    <!--
    <template #outline>
      So you can adopt sync incrementally, one route at a time<span
        class="hidden-lg"
        >, into both greenfield and brownfield applications</span
      >.
    </template>
    <template #outbody>
      <div class="integrations">
        <a
          v-for="{ slug, name } in integrations"
          :href="`/docs/integrations/${slug}`"
          :key="slug"
          class="no-visual"
        >
          <Card>
            <img
              class="integration-icon"
              :src="`/img/integrations/${slug}.svg`"
            />
          </Card>
          <div class="integration-label">
            {{ name }}
          </div>
        </a>
      </div>
    </template>
    -->
  </Section>
</template>
