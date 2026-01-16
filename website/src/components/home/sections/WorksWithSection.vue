<script setup>
import { onMounted, ref } from 'vue'

import Card from '../Card.vue'
import Section from '../Section.vue'

const integrations = [
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
  {
    slug: 'next',
    name: 'Next.js',
  },
  {
    slug: 'neon',
    name: 'Neon',
  },
  {
    slug: 'supabase',
    name: 'Supabase',
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
const tsx = ref(undefined)

onMounted(() => {
  if (typeof window !== 'undefined' && document.querySelector) {
    sql.value = document.getElementById('works-with-sql-template').innerHTML
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

  .your-database-col {
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
  .your-database-col {
    order: 0;
  }
  .your-stack-col {
    order: 1;
    grid-column: 1;
  }
  .your-app-col {
    order: 2;
  }
  .layers,
  .your-stack :deep(div[class*='language-']) {
    max-width: 448px;
    margin-left: auto !important;
    margin-right: auto !important;
  }
  .layers {
    display: grid;
    grid-template-columns: 1fr;
    gap: 24px;
  }
}
@media (max-width: 639px) {
  .layers,
  .your-stack :deep(div[class*='language-']) {
    max-width: 384px;
  }
}
@media (max-width: 518px) {
  .layers,
  .your-stack :deep(div[class*='language-']) {
    max-width: 320px;
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
    <template #title> That work with your&nbsp;stack </template>
    <template #override-tagline>
      <p>
        Our products work with
        <a href="/docs/guides/deployment#_1-running-postgres">
          <span class="inline-sm">any </span>Postgres</a
        >,
        <a href="/docs/integrations">
          <span class="inline-sm">any </span>web framework</a
        >
        and
        <a href="/docs/guides/client-development">
          <span class="inline-sm">any </span>client</a
        >
        <span class="hidden-sm">that speaks HTTP</span>.
        <span class="no-wrap-sm"> Use</span>
        <a href="/products/postgres-sync">Postgres Sync</a>
        with
        <a href="/products/tanstack-db">TanStack DB</a>
        for local-first apps.
        <span class="hidden-sm">Add</span>
        <a href="/products/durable-streams">Durable Streams</a>
        for resilient AI.
        <span class="hidden-sm">Run</span>
        <a href="/products/pglite">PGlite</a>
        anywhere.
      </p>
    </template>
    <div class="your-stack">
      <div class="col your-database-col">
        <div id="works-with-sql">
          <div v-if="sql" v-html="sql"></div>
          <div v-else class="language-sql placeholder" />
        </div>
        <div class="stack-label">Your database</div>
      </div>
      <div class="col your-stack-col">
        <div class="layers">
          <a class="layer no-visual" href="/docs/guides/auth">
            <div class="icon">
              <img src="/img/icons/auth.svg" />
            </div>
            <div class="body">
              <h4>Auth</h4>
              <p>Control data&nbsp;access</p>
            </div>
          </a>
          <a class="layer no-visual" href="/docs/guides/writes">
            <div class="icon">
              <img src="/img/icons/writes.svg" />
            </div>
            <div class="body">
              <h4>Writes</h4>
              <p>Handle writes</p>
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
        <div id="works-with-tsx">
          <div v-if="tsx !== undefined" v-html="tsx"></div>
          <div v-else class="language-tsx placeholder" />
        </div>
        <div class="stack-label">Your app</div>
      </div>
    </div>
    <template #outline>
      Adopt sync incrementally, one component at a time<span
        class="hidden-lg"
        >, into greenfield and brownfield apps alike</span
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
  </Section>
</template>
