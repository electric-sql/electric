<script setup>
/* WorksWithStack — three-column "your data / your stack / your app"
   composition. Code snippets are hand-rolled with the same tk-* token
   classes used by the landing-page demos (EntityStreamDemo et al), so
   the colour palette matches the rest of the site instead of defaulting
   to whatever shiki produces. */

import { computed } from 'vue'

import MarkdownContent from '../MarkdownContent.vue'
import MdExportExplicit from '../MdExportExplicit.vue'
import { useMarkdownExport } from '../../lib/useMarkdownExport'

const sseLines = [
  '<span class="tk-prop">data</span>: {<span class="tk-str">"type"</span>: <span class="tk-str">"text-delta"</span>, <span class="tk-str">"delta"</span>: <span class="tk-str">"Hi, "</span>}',
]

const tsxLines = [
  '<span class="tk-kw">const</span> <span class="tk-fn">Todos</span> = () =&gt; {',
  '  <span class="tk-kw">const</span> { data } = <span class="tk-fn">useLiveQuery</span>(query =&gt;',
  '    query',
  '      .<span class="tk-fn">from</span>({ <span class="tk-prop">todo</span>: <span class="tk-v">todoCollection</span> })',
  '      .<span class="tk-fn">where</span>(({ todo }) =&gt; <span class="tk-v">todo</span>.<span class="tk-prop">completed</span>)',
  '  )',
  '',
  '  <span class="tk-kw">return</span> &lt;<span class="tk-fn">List</span> <span class="tk-prop">todos</span>={data} /&gt;',
  '}',
]

const dataSources = [
  {
    title: 'Agent streams',
    href: '/agents',
    description: 'Durable, URL-addressable streams for long-lived agents.',
  },
  {
    title: 'Real-time streams',
    href: '/streams',
    description: 'Append-only streams over HTTP.',
  },
  {
    title: 'Database sync',
    href: '/sync',
    description: 'Sync from Postgres in real time.',
  },
]

const stackLayers = [
  {
    title: 'Auth',
    href: '/docs/sync/guides/auth',
    description: 'With your API.',
  },
  {
    title: 'Write',
    href: '/docs/sync/guides/writes',
    description: 'Through your backend.',
  },
  {
    title: 'Middleware',
    href: '/docs/sync/api/http',
    description: "It's just HTTP and JSON.",
  },
]

const stackMarkdown = computed(
  () => `### Your data

${dataSources
  .map((source) => `- [${source.title}](${source.href}) - ${source.description}`)
  .join('\n')}

\`\`\`json
data: {"type": "text-delta", "delta": "Hi, "}
\`\`\`

### Your stack

${stackLayers
  .map((layer) => `- [${layer.title}](${layer.href}) - ${layer.description}`)
  .join('\n')}

### Your app

- [TanStack DB](/sync/tanstack-db) - Live queries and optimistic mutations on top of Electric.

\`\`\`tsx
const Todos = () => {
  const { data } = useLiveQuery(query =>
    query
      .from({ todo: todoCollection })
      .where(({ todo }) => todo.completed)
  )

  return <List todos={data} />
}
\`\`\``
)

const isMarkdownExport = useMarkdownExport()
</script>

<template>
  <MdExportExplicit v-if="isMarkdownExport">
    <MarkdownContent>{{ stackMarkdown }}</MarkdownContent>
  </MdExportExplicit>
  <div v-else class="ww-stack">
    <!-- ── Column 1 — Your data ─────────────────────────────────── -->
    <div class="ww-col">
      <div class="ww-tag mono">01 · your data</div>
      <div class="ww-data-sources">
        <div class="ww-card ww-card-primary">
          <div class="ww-card-head">
            <img
              src="/img/home/sync-targets/agent.svg"
              class="ww-card-icon"
            />
            <a href="/agents" class="ww-card-label no-visual">Agent streams</a>
          </div>
          <div class="ww-card-code">
            <div class="ww-code">
              <div
                v-for="(line, i) in sseLines"
                :key="i"
                class="ww-code-line"
                v-html="line || '&#8203;'"
              />
            </div>
          </div>
        </div>
        <a href="/streams" class="ww-card ww-mini no-visual">
          <img
            src="/img/icons/durable-streams.svg"
            class="ww-card-icon"
          />
          <div class="ww-mini-text">
            <div class="ww-mini-title">Real-time streams</div>
            <div class="ww-mini-tagline mono">
              Append-only streams over HTTP
            </div>
          </div>
        </a>
        <a href="/sync" class="ww-card ww-mini no-visual">
          <img
            src="/img/icons/electric.svg"
            class="ww-card-icon"
          />
          <div class="ww-mini-text">
            <div class="ww-mini-title">Database sync</div>
            <div class="ww-mini-tagline mono">
              Sync from Postgres in real time
            </div>
          </div>
        </a>
      </div>
    </div>

    <!-- ── Column 2 — Your stack ────────────────────────────────── -->
    <div class="ww-col">
      <div class="ww-tag mono">02 · your stack</div>
      <div class="ww-layers">
        <a class="ww-layer no-visual" href="/docs/sync/guides/auth">
          <div class="ww-layer-icon">
            <img src="/img/icons/auth.svg" />
          </div>
          <div class="ww-layer-body">
            <h4>Auth</h4>
            <p>With your API</p>
          </div>
        </a>
        <a class="ww-layer no-visual" href="/docs/sync/guides/writes">
          <div class="ww-layer-icon">
            <img src="/img/icons/writes.svg" />
          </div>
          <div class="ww-layer-body">
            <h4>Write</h4>
            <p>Through your backend</p>
          </div>
        </a>
        <a class="ww-layer no-visual" href="/docs/sync/api/http">
          <div class="ww-layer-icon">
            <img src="/img/icons/deploy.png" />
          </div>
          <div class="ww-layer-body">
            <h4>Middleware</h4>
            <p>It's just HTTP &amp; JSON</p>
          </div>
        </a>
      </div>
    </div>

    <!-- ── Column 3 — Your app ──────────────────────────────────── -->
    <div class="ww-col">
      <div class="ww-tag mono">03 · your app</div>
      <div class="ww-card ww-card-full">
        <div class="ww-card-head">
          <img src="/img/icons/tanstack.svg" class="ww-card-icon" />
          <a
            href="/sync/tanstack-db"
            class="ww-card-label no-visual"
            style="margin-left: 2px"
            >TanStack DB</a
          >
        </div>
        <div class="ww-card-code">
          <div class="ww-code">
            <div
              v-for="(line, i) in tsxLines"
              :key="i"
              class="ww-code-line"
              v-html="line || '&#8203;'"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Stack grid ───────────────────────────────────────────────── */

.ww-stack {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  overflow: hidden;
  align-items: stretch;
}

.ww-col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Column body fills the grid row, so columns line up at the height of
   the tallest panel (the TanStack DB code block in column 3). */
.ww-col > .ww-tag + * {
  flex: 1;
  min-height: 0;
}

/* ── Column tag ───────────────────────────────────────────────── */

.ww-tag {
  font-size: 11px;
  color: var(--vp-c-brand-1);
  letter-spacing: 0.04em;
  text-transform: lowercase;
  padding: 0 4px;
}

/* ── Card primitive ───────────────────────────────────────────── */

.ww-card {
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  border: 1px solid var(--ea-divider);
  background: var(--ea-surface);
  overflow: hidden;
  transition: border-color 0.2s ease, transform 0.2s ease;
}

.ww-card:hover {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 40%, var(--ea-divider));
  transform: translateY(-2px);
}

.ww-card-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
}

.ww-card-icon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  margin-right: -4px;
}

.ww-card-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--ea-text-1);
  line-height: 1.4;
  text-decoration: none;
}

/* ── Code panel inside cards ──────────────────────────────────── */

.ww-card-code {
  flex: 1;
  background: var(--ea-surface-alt);
  border-top: 1px solid var(--ea-divider);
  display: flex;
  flex-direction: column;
  justify-content: center;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

/* Column 3's TSX snippet is taller; top-align it so longer code reads
   naturally instead of clipping. Column 1's one-liner stays centred. */
.ww-card-full .ww-card-code {
  justify-content: flex-start;
}

.ww-code {
  padding: 10px 14px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  line-height: 1.5;
  color: var(--ea-text-1);
  white-space: pre;
  overflow: hidden;
  width: 100%;
  box-sizing: border-box;
}

.ww-code-line {
  min-height: 1.5em;
}

/* Match the landing-page demo palette (see EntityStreamDemo). */
.ww-code :deep(.tk-kw)   { color: var(--vp-c-brand-1); }
.ww-code :deep(.tk-fn)   { color: var(--ea-event-message); }
.ww-code :deep(.tk-str)  { color: var(--ea-event-tool-result); }
.ww-code :deep(.tk-prop) { color: var(--ea-event-tool-call); }
.ww-code :deep(.tk-v)    { color: var(--ea-text-1); }

/* ── Column 1 — data sources stack ────────────────────────────── */

.ww-data-sources {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ww-card-primary {
  flex: 1;
  min-height: 0;
}

/* ── Mini cards (Real-time streams, Agent streams) ────────────── */

.ww-mini {
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  flex-shrink: 0;
}

.ww-mini-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ww-mini-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ea-text-1);
  line-height: 1.3;
}

.ww-mini-tagline {
  font-size: 11px;
  color: var(--ea-text-3);
  line-height: 1.35;
  letter-spacing: 0.01em;
}

/* ── Column 2 — middleware layers ─────────────────────────────── */

.ww-layers {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ww-layer {
  flex: 1;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--ea-divider);
  background: var(--ea-surface);
  display: flex;
  flex-direction: row;
  justify-content: flex-start;
  align-items: center;
  text-align: left;
  text-decoration: none;
  transition: border-color 0.2s ease, transform 0.2s ease;
}

.ww-layer:hover {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 40%, var(--ea-divider));
  transform: translateY(-2px);
}

.ww-layer-icon img {
  width: 24px;
  margin: 0 14px 0 4px;
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

/* ── Column 3 — full-height app card (TSX snippet sets row height) ─ */

.ww-card-full {
  flex: 1;
}

/* ── Responsive ───────────────────────────────────────────────── */

@media (max-width: 791px) {
  .ww-stack {
    grid-template-columns: 1fr;
    gap: 28px;
  }
  .ww-col {
    max-width: 511px;
    margin-left: auto;
    margin-right: auto;
    width: 100%;
  }
}
</style>
