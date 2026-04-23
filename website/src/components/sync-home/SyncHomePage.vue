<script setup lang="ts">
/* SyncHomePage — top-level /sync landing page.
   ────────────────────────────────────────────
   Educational overview of the composable sync stack. The deep-dive
   marketing for Postgres Sync itself lives on /sync/postgres-sync.

   Page outline:
     §1   Hero ............ "Composable sync primitives for multi-agent systems"
     §2   Compose ......... ComposeStackGrid showcasing the three primitives
     §3   Postgres Sync ... brief intro + link to /sync/postgres-sync
     §4   TanStack DB ..... brief intro + link to /sync/tanstack-db
     §5   PGlite .......... brief intro + link to /sync/pglite
     §6   Agent loop ...... "Sync is how humans stay in the agent loop"
     §7   Pillars ......... "The best way to build apps" — four-pillar grid
     §8   First sync ...... annotated end-to-end code example
     §9   Demos ........... featured reference demos
     §10  Blog ............ curated posts panel
     §11  CTA ............. shared BottomCtaStrap
*/

import { ref } from "vue"
import { VPButton } from "vitepress/theme"
import { defineClientComponent } from "vitepress"

import EaSection from "../agents-home/Section.vue"
import SyncFanOutBg from "./SyncFanOutBg.vue"
import ComposeStackGrid from "./ComposeStackGrid.vue"
import MultiClientPulseDemo from "./MultiClientPulseDemo.vue"
import InstallPill from "../InstallPill.vue"
import BottomCtaStrap from "../BottomCtaStrap.vue"
import CuratedBlogPosts from "../CuratedBlogPosts.vue"

// PGlite REPL is browser-only (WASM + DOM access at script-setup
// time), so lazy-load it on the client and render inside <ClientOnly>.
const PGliteReplDemo = defineClientComponent(() => {
  return import("./PGliteReplDemo.vue")
})

import { data as demoData } from "../../../data/demos.data.ts"

const featuredDemos = demoData.homepage_demos.slice(0, 3)

const installCommand = "npx @electric-sql/start my-electric-app"

const heroInnerRef = ref<HTMLElement>()

// Curated list of Sync-relevant blog posts that fill the panel before
// the bottom CTA. Slugs are the trailing path segment of the blog post
// filename (date prefix stripped).
const syncBlogPosts = [
  "data-primitive-agent-loop",
  "super-fast-apps-on-sync-with-tanstack-db",
  "tanstack-db-0.6-app-ready-with-persistence-and-includes",
  "local-first-with-your-existing-api",
]
</script>

<template>
  <div class="sync-home">
    <!-- ───────────────────────── §1 — Hero ───────────────────────── -->
    <section class="sh-hero">
      <SyncFanOutBg :exclude-el="heroInnerRef" :labels-on-hover="true" />
      <div ref="heroInnerRef" class="sh-hero-inner">
        <h1 class="sh-hero-name">
          Electric&nbsp;<span class="sh-hero-accent">Sync</span>
        </h1>
        <p class="sh-hero-text">
          Composable sync primitives for multi-agent&nbsp;systems
        </p>

        <div class="sh-hero-install-row">
          <InstallPill :command="installCommand" tone="raised" />
        </div>

        <div class="sh-hero-row">
          <VPButton
            tag="a"
            size="medium"
            theme="brand"
            text="Quickstart"
            href="/docs/sync/quickstart"
          />
          <VPButton
            tag="a"
            size="medium"
            theme="alt"
            text="Docs"
            href="/docs/sync"
          />
        </div>
      </div>
    </section>

    <!-- ───────────── §2 — Compose your sync stack ───────────── -->
    <EaSection
      id="compose"
      title="Compose your sync&nbsp;stack"
      subtitle="Three composable primitives that work together &mdash; or independently &mdash; to keep state in sync from your database, through your network, into your apps and&nbsp;agents."
    >
      <ComposeStackGrid :order="['postgres-sync', 'tanstack-db', 'pglite']" />
    </EaSection>

    <!-- ───────────── §3 — Postgres Sync (dark) ───────────── -->
    <EaSection id="postgres-sync" :dark="true">
      <div class="sh-primitive sh-primitive-two-col">
        <div class="sh-primitive-prose">
          <div class="sh-primitive-head">
            <img src="/img/icons/electric.svg" alt="" class="sh-primitive-icon" />
            <h2 class="sh-primitive-title">Postgres&nbsp;Sync</h2>
          </div>
          <p class="ea-prose">
            <strong>Sync subsets of your Postgres into everything.</strong>
            A read-path sync engine that streams shapes from Postgres over plain
            HTTP. Cached at the edge, fanned out to millions of concurrent
            readers, with flat database&nbsp;load.
          </p>
          <p class="ea-prose">
            Define a shape on the server. Mount a collection on the client.
            Render a live query. Writes go through your existing&nbsp;backend.
          </p>
          <div class="sh-primitive-actions">
            <VPButton
              tag="a"
              size="medium"
              theme="brand"
              text="Explore Postgres Sync"
              href="/sync/postgres-sync"
            />
            <VPButton
              tag="a"
              size="medium"
              theme="alt"
              text="Docs"
              href="/docs/sync"
            />
          </div>
        </div>
        <div class="sh-primitive-visual">
          <MultiClientPulseDemo />
        </div>
      </div>
    </EaSection>

    <!-- ───────────── §4 — TanStack DB ───────────── -->
    <EaSection id="tanstack-db">
      <div class="sh-primitive sh-primitive-two-col sh-primitive-reversed">
        <div class="sh-primitive-prose">
          <div class="sh-primitive-head">
            <img src="/img/icons/tanstack.svg" alt="" class="sh-primitive-icon" />
            <h2 class="sh-primitive-title">TanStack&nbsp;DB</h2>
          </div>
          <p class="ea-prose">
            <strong>A reactive client store for building super-fast apps.</strong>
            Sub-millisecond reactivity, instant local writes, and live
            cross-collection queries powered by differential&nbsp;dataflow.
          </p>
          <p class="ea-prose">
            Loads data from any source &mdash; including
            <a href="/sync/postgres-sync">Postgres&nbsp;Sync</a> and
            <a href="/streams">Electric&nbsp;Streams</a> &mdash; with optimistic
            mutations that reconcile against your&nbsp;backend.
          </p>
          <div class="sh-primitive-actions">
            <VPButton
              tag="a"
              size="medium"
              theme="brand"
              text="Explore TanStack DB"
              href="/sync/tanstack-db"
            />
            <VPButton
              tag="a"
              size="medium"
              theme="alt"
              text="TanStack DB docs"
              href="https://tanstack.com/db"
            />
          </div>
        </div>
        <div class="sh-primitive-visual">
          <div class="sh-fs-panel">
            <div class="code-file-header mono">app/Todos.tsx</div>
            <pre class="code-block annotated"><code><span class="tk-kw">const</span> <span class="tk-v">todos</span> = <span class="tk-fn">createCollection</span>(
  <span class="tk-fn">electricCollectionOptions</span>({<span class="ann-marker" data-n="1"></span>
    <span class="tk-prop">shapeOptions</span>: { <span class="tk-prop">url</span>: <span class="tk-str">"/api/todos"</span> },
    <span class="tk-prop">getKey</span>: (<span class="tk-v">row</span>) <span class="tk-kw">=&gt;</span> <span class="tk-v">row</span>.<span class="tk-prop">id</span>,
  }),
)

<span class="tk-kw">export function</span> <span class="tk-fn">Todos</span>() {
  <span class="tk-kw">const</span> { <span class="tk-v">data</span> } = <span class="tk-fn">useLiveQuery</span>((<span class="tk-v">q</span>) <span class="tk-kw">=&gt;</span><span class="ann-marker" data-n="2"></span>
    <span class="tk-v">q</span>.<span class="tk-fn">from</span>({ <span class="tk-prop">todo</span>: <span class="tk-v">todos</span> })
     .<span class="tk-fn">where</span>(({ <span class="tk-v">todo</span> }) <span class="tk-kw">=&gt;</span>
        <span class="tk-fn">eq</span>(<span class="tk-v">todo</span>.<span class="tk-prop">completed</span>, <span class="tk-kw">false</span>)),
  )
  <span class="tk-kw">return</span> &lt;<span class="tk-v">List</span> <span class="tk-prop">todos</span>={<span class="tk-v">data</span>} /&gt;
}</code></pre>
            <ol class="sh-inline-annos">
              <li>
                <span class="num">1</span>
                <div>
                  <strong>Electric collection.</strong>
                  Subscribes to a server-defined shape. Synced rows
                  live locally &mdash; persisted, reactive, and shared
                  across every component that queries them.
                </div>
              </li>
              <li>
                <span class="num">2</span>
                <div>
                  <strong>Live incremental reactivity.</strong>
                  Differential dataflow keeps the result set up to
                  date as rows arrive or change &mdash; sub-millisecond
                  updates, only the diff re-renders.
                </div>
              </li>
            </ol>
          </div>
        </div>
      </div>
    </EaSection>

    <!-- ───────────── §5 — PGlite (dark) ───────────── -->
    <EaSection id="pglite" :dark="true">
      <div class="sh-primitive sh-primitive-two-col">
        <div class="sh-primitive-prose">
          <div class="sh-primitive-head">
            <img src="/img/icons/pglite.product.svg" alt="" class="sh-primitive-icon" />
            <h2 class="sh-primitive-title">PGlite</h2>
          </div>
          <p class="ea-prose">
            <strong>Embeddable Postgres with reactivity and sync.</strong>
            A lightweight WASM build of Postgres &mdash; under 3MB gzipped &mdash;
            that runs in the browser, Node.js, Bun and Deno, with built-in live
            query and sync&nbsp;primitives.
          </p>
          <p class="ea-prose">
            Pair it with <a href="/sync/postgres-sync">Postgres&nbsp;Sync</a>
            to keep an embedded Postgres database in sync with your cloud
            Postgres &mdash; for fully local, offline-capable&nbsp;apps.
          </p>
          <div class="sh-primitive-actions">
            <VPButton
              tag="a"
              size="medium"
              theme="brand"
              text="Explore PGlite"
              href="/sync/pglite"
            />
            <VPButton
              tag="a"
              size="medium"
              theme="alt"
              text="PGlite.dev"
              href="https://pglite.dev"
            />
          </div>
        </div>
        <div class="sh-primitive-visual">
          <div class="sh-pglite-panel">
            <div class="sh-pglite-header mono">
              <span class="sh-pglite-dot" />
              <span class="sh-pglite-title">PGlite&nbsp;REPL</span>
              <span class="sh-pglite-meta">WASM Postgres · in this page</span>
            </div>
            <div class="sh-pglite-body">
              <ClientOnly>
                <PGliteReplDemo />
                <template #fallback>
                  <div class="sh-pglite-loading mono">Booting PGlite&hellip;</div>
                </template>
              </ClientOnly>
            </div>
          </div>
        </div>
      </div>
    </EaSection>

    <!-- ───────────── §6 — Sync is how humans stay in the agent loop ───────────── -->
    <EaSection id="agent-loop">
      <div class="sh-two-col sh-two-col-headed sh-two-col-mini-visual">
        <div class="sh-prose-col">
          <h2 class="sh-inline-title">
            Sync is how humans stay in the agent&nbsp;loop
          </h2>
          <p class="ea-prose">
            Agents work on shared data &mdash; and they change it while users
            are still looking at it. Without sync, your UI shows stale state,
            users have to refresh, and teams lose track of what each agent
            is doing.
          </p>
          <p class="ea-prose">
            With Electric, every user, device, and teammate sees agent changes
            in real time. The same shared state powers multi-tab,
            multi-device, multi-user, and multi-agent collaboration &mdash;
            out of the&nbsp;box.
          </p>
          <div class="sh-section-foot sh-section-foot-tight left">
            <a href="/blog/2026/04/08/data-primitive-agent-loop">
              Read: the data primitive for the agent loop &rarr;
            </a>
          </div>
        </div>
        <div class="sh-visual-col">
          <div class="sh-agent-loop-diagram-v" aria-hidden="true">
            <div class="vbus-col vbus-users">
              <span class="node node-client small">user</span>
              <span class="node node-device small">device</span>
              <span class="node node-client small">user</span>
              <span class="node node-device small">device</span>
              <span class="node node-client small">user</span>
              <span class="node node-device small">device</span>
            </div>
            <div class="vbus-rail">
              <span class="vbus-rail-label mono">shared<br />state</span>
            </div>
            <div class="vbus-col vbus-agents">
              <span class="node node-agent small">agent</span>
              <span class="node node-agent small">agent</span>
              <span class="node node-agent small">agent</span>
              <span class="node node-agent small">agent</span>
              <span class="node node-agent small">agent</span>
            </div>
          </div>
        </div>
      </div>
    </EaSection>

    <!-- ───────────── §7 — The best way to build apps (four pillars) ───────────── -->
    <EaSection
      id="pillars"
      title="The best way to build&nbsp;apps"
      subtitle="Sync makes your apps super-fast, with end-to-end reactivity, resilience, and built-in multi-user&nbsp;collaboration."
      :dark="true"
    >
      <div class="sh-pillars">
        <a
          v-for="(p, i) in [
            { id: 'reactivity', title: 'Super-fast reactivity', body: 'Build fast, modern apps like Figma and Linear. Sub-millisecond reactivity and instant local writes.', href: '/blog/2025/07/29/super-fast-apps-on-sync-with-tanstack-db' },
            { id: 'resilience', title: 'Resilient transport', body: 'Build apps that work reliably, even with patchy connectivity. Resilient transport that ensures data is never lost.', href: '/blog/2026/03/24/durable-transport-ai-sdks' },
            { id: 'collaboration', title: 'Real-time collaboration', body: 'Build multi-user, multi-agent apps that naturally support both real-time and asynchronous collaboration.', href: '/blog/2026/01/12/durable-sessions-for-collaborative-ai' },
            { id: 'durability', title: 'Durable state', body: 'Build multi-step agentic workflows that survive crashes and restarts. Agents and workers resume from the same durable state.', href: '/blog/2026/04/08/data-primitive-agent-loop' },
          ]"
          :key="p.id"
          :href="p.href"
          class="sh-pillar"
        >
          <div class="sh-pillar-num mono">{{ ['01', '02', '03', '04'][i] }}</div>
          <h4 class="sh-pillar-title">{{ p.title }}</h4>
          <p class="sh-pillar-body">{{ p.body }}</p>
          <span class="sh-pillar-link">Read more &rarr;</span>
        </a>
      </div>
    </EaSection>

    <!-- ───────────── §8 — Your first sync, end to end ───────────── -->
    <EaSection
      id="first-sync"
      title="Your first sync, end to&nbsp;end"
    >
      <template #eyebrow>
        Postgres&nbsp;Sync &nbsp;+&nbsp; TanStack&nbsp;DB
      </template>
      <template #subtitle>
        Compose <a href="/sync/postgres-sync">Postgres&nbsp;Sync</a> with
        <a href="/sync/tanstack-db">TanStack&nbsp;DB</a> to ship a real-time
        feature in three&nbsp;moves: define a shape on the server, mount a
        collection on the client, render a live&nbsp;query.
      </template>
      <div class="sh-first-sync">
        <div class="sh-first-sync-grid">
          <div class="sh-fs-col">
            <div class="sh-fs-panel">
              <div class="code-file-header mono">api/todos.ts &nbsp;<span class="muted">&mdash; server proxy</span></div>
              <pre class="code-block annotated"><code><span class="tk-kw">export const</span> <span class="tk-v">ServerRoute</span> = <span class="tk-fn">createServerFileRoute</span>(<span class="tk-str">"/api/todos"</span>).<span class="tk-fn">methods</span>({
  <span class="tk-prop">GET</span>: <span class="tk-kw">async</span> ({ <span class="tk-v">request</span> }) <span class="tk-kw">=&gt;</span> {
    <span class="tk-kw">const</span> <span class="tk-v">url</span> = <span class="tk-kw">new</span> <span class="tk-v">URL</span>(<span class="tk-v">request</span>.<span class="tk-prop">url</span>)
    <span class="tk-kw">const</span> <span class="tk-v">origin</span> = <span class="tk-kw">new</span> <span class="tk-v">URL</span>(<span class="tk-str">"https://api.electric-sql.cloud/v1/shape"</span>)<span class="ann-marker" data-n="1"></span>
    <span class="tk-v">url</span>.<span class="tk-prop">searchParams</span>.<span class="tk-fn">forEach</span>((<span class="tk-v">v</span>, <span class="tk-v">k</span>) <span class="tk-kw">=&gt;</span>
      <span class="tk-v">ELECTRIC_PROTOCOL_QUERY_PARAMS</span>.<span class="tk-fn">includes</span>(<span class="tk-v">k</span>) &amp;&amp;
        <span class="tk-v">origin</span>.<span class="tk-prop">searchParams</span>.<span class="tk-fn">set</span>(<span class="tk-v">k</span>, <span class="tk-v">v</span>))

    <span class="tk-v">origin</span>.<span class="tk-prop">searchParams</span>.<span class="tk-fn">set</span>(<span class="tk-str">"table"</span>, <span class="tk-str">"todos"</span>)<span class="ann-marker" data-n="2"></span>
    <span class="tk-v">origin</span>.<span class="tk-prop">searchParams</span>.<span class="tk-fn">set</span>(<span class="tk-str">"where"</span>, <span class="tk-str">"user_id = $1"</span>)
    <span class="tk-v">origin</span>.<span class="tk-prop">searchParams</span>.<span class="tk-fn">set</span>(<span class="tk-str">"params"</span>, <span class="tk-v">JSON</span>.<span class="tk-fn">stringify</span>([<span class="tk-v">user</span>.<span class="tk-prop">id</span>]))<span class="ann-marker" data-n="3"></span>

    <span class="tk-kw">return</span> <span class="tk-fn">fetch</span>(<span class="tk-v">origin</span>)<span class="ann-marker" data-n="4"></span>
  },
})</code></pre>
            </div>

            <div class="sh-fs-panel">
              <div class="code-file-header mono">app/Todos.tsx &nbsp;<span class="muted">&mdash; client</span></div>
              <pre class="code-block annotated"><code><span class="tk-kw">export const</span> <span class="tk-v">todoCollection</span> = <span class="tk-fn">createCollection</span>(
  <span class="tk-fn">electricCollectionOptions</span>({<span class="ann-marker" data-n="5"></span>
    <span class="tk-prop">id</span>: <span class="tk-str">"todos"</span>,
    <span class="tk-prop">shapeOptions</span>: { <span class="tk-prop">url</span>: <span class="tk-str">"/api/todos"</span> },
    <span class="tk-prop">getKey</span>: (<span class="tk-v">row</span>) <span class="tk-kw">=&gt;</span> <span class="tk-v">row</span>.<span class="tk-prop">id</span>,
  }),
)

<span class="tk-kw">export function</span> <span class="tk-fn">Todos</span>() {
  <span class="tk-kw">const</span> { <span class="tk-v">data</span> } = <span class="tk-fn">useLiveQuery</span>((<span class="tk-v">q</span>) <span class="tk-kw">=&gt;</span><span class="ann-marker" data-n="6"></span>
    <span class="tk-v">q</span>.<span class="tk-fn">from</span>({ <span class="tk-prop">todo</span>: <span class="tk-v">todoCollection</span> })
     .<span class="tk-fn">where</span>(({ <span class="tk-v">todo</span> }) <span class="tk-kw">=&gt;</span> <span class="tk-v">eq</span>(<span class="tk-v">todo</span>.<span class="tk-prop">completed</span>, <span class="tk-kw">false</span>)),
  )
  <span class="tk-kw">return</span> &lt;<span class="tk-v">List</span> <span class="tk-prop">todos</span>={<span class="tk-v">data</span>} /&gt;
}</code></pre>
            </div>
          </div>
          <div class="sh-fs-col">
            <ol class="sh-fs-annos">
              <li class="sh-fs-anno">
                <span class="num">1</span>
                <div>
                  <strong>Server-side proxy.</strong>
                  <p>Forward the request to your Electric instance. Keep the source secret on the server.</p>
                </div>
              </li>
              <li class="sh-fs-anno">
                <span class="num">2</span>
                <div>
                  <strong>Pin the table.</strong>
                  <p>The shape is defined server-side, not by the client. The client can't ask for tables it shouldn't see.</p>
                </div>
              </li>
              <li class="sh-fs-anno">
                <span class="num">3</span>
                <div>
                  <strong>Tenant isolation.</strong>
                  <p>Bind the <code>where</code> clause to the authenticated user &mdash; every client gets its own slice.</p>
                </div>
              </li>
              <li class="sh-fs-anno">
                <span class="num">4</span>
                <div>
                  <strong>It's just HTTP.</strong>
                  <p>Shapes stream over plain HTTP. Cache, log and rate-limit them with the middleware you already use.</p>
                </div>
              </li>
              <li class="sh-fs-anno">
                <span class="num">5</span>
                <div>
                  <strong>Mount a collection.</strong>
                  <p>An Electric collection in TanStack DB &mdash; local, reactive, persisted.</p>
                </div>
              </li>
              <li class="sh-fs-anno">
                <span class="num">6</span>
                <div>
                  <strong>Render a live query.</strong>
                  <p>Sub-millisecond reactivity over the local data. Updates flow in as the shape changes.</p>
                </div>
              </li>
            </ol>
          </div>
        </div>

        <div class="sh-fs-cta">
          <VPButton tag="a" size="medium" theme="brand" text="Quickstart" href="/docs/sync/quickstart" />
          <VPButton tag="a" size="medium" theme="alt" text="Read the Docs" href="/docs/sync" />
        </div>
      </div>
    </EaSection>

    <!-- ───────────── §9 — Demos ───────────── -->
    <EaSection
      id="demos"
      title="Demos"
      subtitle="Reference apps you can clone, run locally, and learn&nbsp;from."
      :dark="true"
    >
      <div class="sh-demos">
        <a
          v-for="demo in featuredDemos"
          :key="demo.link"
          class="sh-demo"
          :href="demo.link"
        >
          <div class="sh-demo-frame">
            <img :src="demo.listing_image || demo.image" :alt="demo.title" />
          </div>
          <div class="sh-demo-meta">
            <h4 class="sh-demo-title">{{ demo.title }}</h4>
            <p class="sh-demo-body">{{ demo.description }}</p>
          </div>
        </a>
      </div>
    </EaSection>

    <!-- ───────────── §10 — Blog ───────────── -->
    <EaSection
      id="blog"
      title="From the&nbsp;blog"
      subtitle="Deep dives into sync engine architecture, the agent loop, and building real apps on the&nbsp;stack."
    >
      <CuratedBlogPosts :posts="syncBlogPosts" :limit="4" />
      <template #actions>
        <VPButton
          tag="a"
          size="medium"
          theme="alt"
          text="Electric Blog"
          href="/blog"
        />
      </template>
    </EaSection>

    <!-- ───────────── §7 — Bottom CTA ───────────── -->
    <BottomCtaStrap id="get-started">
      <template #eyebrow>
        Open source &middot; Apache&nbsp;2.0 &middot; ★&nbsp;9.5k
      </template>
      <template #title>
        Start syncing in&nbsp;<span class="bottom-cta-accent">minutes</span>.
      </template>
      <template #tagline>
        Spin up the starter, point it at Postgres, and ship a real-time app
        on top of your existing&nbsp;stack.
      </template>
      <template #install>
        <InstallPill :command="installCommand" tone="sunken" />
      </template>
      <template #actions>
        <VPButton
          tag="a"
          size="medium"
          theme="brand"
          text="Quickstart"
          href="/docs/sync/quickstart"
        />
        <VPButton
          tag="a"
          size="medium"
          theme="alt"
          text="Docs"
          href="/docs/sync"
        />
        <VPButton
          tag="a"
          size="medium"
          theme="alt"
          text="GitHub"
          href="https://github.com/electric-sql/electric"
        />
      </template>
    </BottomCtaStrap>
  </div>
</template>

<style scoped>
.sync-home {
  overflow-x: hidden;
  max-width: 100vw;
}

/* ── Hero ───────────────────────────────────────────────────────── */

.sh-hero {
  position: relative;
  padding: 80px 24px 72px;
  text-align: center;
  overflow: hidden;
}

.sh-hero-inner {
  position: relative;
  z-index: 1;
  max-width: 880px;
  margin: 0 auto;
  pointer-events: none;
}
.sh-hero-inner > * {
  pointer-events: auto;
}

.sh-hero-name {
  font-size: 56px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: var(--ea-text-1);
  margin: 0;
  padding-bottom: 4px;
  text-wrap: balance;
}

.sh-hero-accent {
  color: var(--vp-c-brand-1);
}

.sh-hero-text {
  font-size: 28px;
  font-weight: 500;
  color: var(--ea-text-1);
  margin: 16px auto 32px;
  max-width: 720px;
  line-height: 1.35;
  text-wrap: balance;
}

/* Two-row CTA stack mirroring the Agents hero: the copyable install
   pill always sits on its own line above the Quickstart / Docs
   buttons so it reads as a distinct, scannable affordance rather
   than a peer of the buttons. */
.sh-hero-install-row {
  margin-top: 24px;
  display: flex;
  justify-content: center;
}

.sh-hero-row {
  margin-top: 14px;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

/* ── Primitive sections ─────────────────────────────────────────── */

.sh-primitive {
  max-width: 760px;
  margin: 0 auto;
}

/* Two-col variant: prose on one side, visual (demo or code) on the other.
   We let the EaSection's inner provide the outer max-width so the layout
   can breathe wider than the single-col 760px. */
.sh-primitive-two-col {
  max-width: none;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
  gap: 56px;
  align-items: center;
}

.sh-primitive-reversed .sh-primitive-prose { order: 2; }
.sh-primitive-reversed .sh-primitive-visual { order: 1; }

.sh-primitive-prose,
.sh-primitive-visual {
  min-width: 0;
}

.sh-primitive-two-col .ea-prose {
  max-width: none;
}

.sh-primitive-head {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}

.sh-primitive-icon {
  width: 44px;
  height: 44px;
  display: block;
  object-fit: contain;
  flex-shrink: 0;
}

.sh-primitive-title {
  margin: 0;
  font-size: 32px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.015em;
  color: var(--ea-text-1);
}

.sh-primitive-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 24px;
}

/* Collapse two-col primitives to a single column on tablet/mobile.
   Visual stacks below prose regardless of source order. */
@media (max-width: 960px) {
  .sh-primitive-two-col {
    grid-template-columns: minmax(0, 1fr);
    gap: 36px;
  }
  .sh-primitive-reversed .sh-primitive-prose,
  .sh-primitive-reversed .sh-primitive-visual {
    order: initial;
  }
}

/* ── Two-col prose+visual layout (used by agent-loop section) ───── */

.sh-two-col {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) 1.4fr;
  gap: 48px;
  align-items: start;
}

.sh-two-col-mini-visual {
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
}
.sh-two-col-mini-visual .ea-prose {
  max-width: none;
}

.sh-prose-col,
.sh-visual-col {
  min-width: 0;
}

.sh-inline-title {
  font-size: 28px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: var(--ea-text-1);
  margin: 0 0 20px;
  text-wrap: balance;
}

.sh-section-foot {
  margin-top: 24px;
  font-family: var(--vp-font-family-base);
  font-size: 14px;
  text-align: right;
}
.sh-section-foot.left { text-align: left; }
.sh-section-foot a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.sh-section-foot a:hover { text-decoration: underline; }
.sh-section-foot-tight { margin-top: 16px; }

/* ── Agent loop section (humans + agents on a shared bus) ──────── */

.sh-paradigm-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 18px;
  font-size: 11.5px;
  letter-spacing: 0.04em;
  color: var(--ea-text-3);
}
.sh-paradigm-label .dot {
  width: 7px; height: 7px; border-radius: 50%;
}
.dot-good { background: var(--vp-c-brand-1); }

.sh-agent-loop-diagram-v {
  --tick-len: 22px;
  --tick-color: color-mix(in srgb, var(--vp-c-brand-1) 35%, var(--ea-divider));
  display: grid;
  grid-template-columns: auto auto auto;
  justify-content: center;
  column-gap: var(--tick-len);
  align-items: stretch;
  padding: 22px 18px;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  min-height: 280px;
  font-family: var(--vp-font-family-mono);
}

.vbus-col {
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  gap: 4px;
}
.vbus-users { align-items: flex-end; }
.vbus-agents { align-items: flex-start; }

.sh-agent-loop-diagram-v .node.small {
  padding: 3px 8px;
  font-size: 11px;
  position: relative;
  white-space: nowrap;
  min-width: 62px;
  text-align: center;
  box-sizing: border-box;
}

.vbus-users .node::after {
  content: "";
  position: absolute;
  left: 100%;
  top: 50%;
  width: var(--tick-len);
  height: 1px;
  background: var(--tick-color);
  pointer-events: none;
}
.vbus-agents .node::before {
  content: "";
  position: absolute;
  right: 100%;
  top: 50%;
  width: var(--tick-len);
  height: 1px;
  background: var(--tick-color);
  pointer-events: none;
}

.vbus-rail {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  background: color-mix(in srgb, var(--vp-c-brand-1) 8%, var(--ea-surface));
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 35%, var(--ea-divider));
  border-radius: 4px;
}
.vbus-rail-label {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--vp-c-brand-1);
  text-align: center;
  line-height: 1.25;
}

.node {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 4px;
  font-size: 11px;
  color: var(--ea-text-1);
}
.node.small { padding: 1px 6px; font-size: 10.5px; }
.node-agent { color: var(--vp-c-brand-1); }
.node-device {
  color: var(--ea-text-2);
  border-style: dashed;
}

/* ── Pillars (best way to build apps) ───────────────────────────── */

.sh-pillars {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}
.sh-pillar {
  display: flex;
  flex-direction: column;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  padding: 28px;
  text-decoration: none;
  transition: border-color 0.2s;
}
.sh-pillar:hover { border-color: var(--vp-c-brand-1); }
.sh-pillar-num {
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--ea-text-3);
  text-transform: uppercase;
}
.sh-pillar-title {
  margin: 10px 0 12px;
  font-size: 20px;
  font-weight: 600;
  color: var(--ea-text-1);
  line-height: 1.3;
}
.sh-pillar-body {
  margin: 0 0 14px;
  font-size: 15px;
  line-height: 1.6;
  color: var(--ea-text-2);
  flex: 1;
}
.sh-pillar-link {
  font-size: 13px;
  color: var(--vp-c-brand-1);
  font-weight: 500;
}

/* ── First sync (annotated code) ────────────────────────────────── */

.sh-first-sync {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.sh-first-sync-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(260px, 1fr);
  gap: 28px;
  align-items: start;
}
.sh-fs-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.sh-fs-panel {
  background: var(--ea-bg);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  overflow: hidden;
}

/* Code panels used as the visual next to a primitive's prose: nudge type
   up slightly and add a touch more breathing room so they hold the
   right-hand column with similar visual weight to the demo. */
.sh-primitive-visual .sh-fs-panel { width: 100%; }
.sh-primitive-visual .code-block.annotated {
  font-size: 13.5px;
  padding: 18px 20px;
  line-height: 1.65;
}
.sh-primitive-visual .code-file-header {
  font-size: 12px;
  padding: 12px 18px;
}

/* Compact annotation strip rendered below a code panel inside a
   primitive-visual column. Same numbered-circle motif as
   .sh-fs-anno but tighter for the narrower column. */
.sh-inline-annos {
  list-style: none;
  margin: 0;
  padding: 14px 18px 16px;
  border-top: 1px solid var(--ea-divider);
  background: var(--ea-surface-alt);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sh-inline-annos li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--ea-text-2);
}
.sh-inline-annos .num {
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  font-family: var(--vp-font-family-base);
  font-size: 11px;
  font-weight: 600;
  text-align: center;
  line-height: 18px;
  margin-top: 1px;
}
.sh-inline-annos strong {
  font-weight: 600;
  color: var(--ea-text-1);
  margin-right: 4px;
}

/* PGlite REPL panel — wraps the live <pglite-repl> web component
   with a small terminal-style header so it visually pairs with the
   .sh-fs-panel code panels used by the other primitives. */
.sh-pglite-panel {
  width: 100%;
  display: flex;
  flex-direction: column;
  background: var(--vp-code-block-bg, #161618);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  overflow: hidden;
}
.sh-pglite-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: color-mix(in srgb, #fff 4%, var(--vp-code-block-bg, #161618));
  border-bottom: 1px solid color-mix(in srgb, #fff 6%, transparent);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
}
.sh-pglite-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--vp-c-brand-1) 25%, transparent);
}
.sh-pglite-title {
  font-weight: 600;
  letter-spacing: 0.02em;
}
.sh-pglite-meta {
  margin-left: auto;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.02em;
}
.sh-pglite-body {
  display: flex;
  align-items: stretch;
  height: 360px;
}
.sh-pglite-body > * {
  width: 100%;
  height: 100%;
}
.sh-pglite-loading {
  width: 100%;
  height: 360px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.55);
  background: var(--vp-code-block-bg, #161618);
}
.code-file-header {
  font-size: 11.5px;
  color: var(--ea-text-2);
  padding: 10px 14px;
  border-bottom: 1px solid var(--ea-divider);
  background: var(--ea-surface-alt);
}
.code-file-header .muted { color: var(--ea-text-3); }

.code-block.annotated {
  margin: 0;
  padding: 14px 16px;
  background: transparent;
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--ea-text-1);
  overflow-x: auto;
}
.code-block .tk-kw { color: #d73a49; }
.dark .code-block .tk-kw { color: #ff7b72; }
.code-block .tk-str { color: #032f62; }
.dark .code-block .tk-str { color: #a5d6ff; }
.code-block .tk-fn { color: #6f42c1; }
.dark .code-block .tk-fn { color: #d2a8ff; }
.code-block .tk-prop { color: #005cc5; }
.dark .code-block .tk-prop { color: #79c0ff; }
.code-block .tk-v { color: var(--ea-text-1); }
.code-block .ann-marker {
  display: inline-block;
  width: 18px;
  height: 18px;
  margin-left: 6px;
  vertical-align: middle;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 50%;
  text-align: center;
  font-size: 10.5px;
  line-height: 16px;
  color: var(--vp-c-brand-1);
  font-family: var(--vp-font-family-base);
  font-weight: 600;
}
.code-block .ann-marker::before {
  content: attr(data-n);
}

.sh-fs-annos {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.sh-fs-anno {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.sh-fs-anno .num {
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  font-size: 12px;
  font-weight: 600;
  text-align: center;
  line-height: 22px;
}
.sh-fs-anno strong {
  font-size: 14px;
  font-weight: 600;
  color: var(--ea-text-1);
  display: block;
  line-height: 1.3;
}
.sh-fs-anno p {
  margin: 4px 0 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--ea-text-2);
}
.sh-fs-anno code {
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  background: var(--ea-surface-alt);
  padding: 1px 5px;
  border-radius: 3px;
}

.sh-fs-cta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 8px;
}

/* ── Demos ──────────────────────────────────────────────────────── */

.sh-demos {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
.sh-demo {
  display: flex;
  flex-direction: column;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  text-decoration: none;
  overflow: hidden;
  transition: border-color 0.2s;
}
.sh-demo:hover { border-color: var(--vp-c-brand-1); }

.sh-demo-frame {
  aspect-ratio: 16 / 9;
  background: var(--ea-surface-alt);
  border-bottom: 1px solid var(--ea-divider);
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.sh-demo-frame img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.sh-demo-meta {
  padding: 18px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sh-demo-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--ea-text-1);
  line-height: 1.3;
}
.sh-demo-body {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  color: var(--ea-text-2);
}

/* ── Responsive ─────────────────────────────────────────────────── */

@media (max-width: 960px) {
  .sh-two-col,
  .sh-two-col-mini-visual,
  .sh-first-sync-grid {
    grid-template-columns: 1fr;
    gap: 32px;
  }
  .sh-pillars {
    grid-template-columns: 1fr;
  }
  .sh-demos {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 768px) {
  .sh-hero {
    padding: 56px 24px 48px;
  }
  .sh-hero-name { font-size: 36px; }
  .sh-hero-text { font-size: 22px; }

  .sh-primitive-icon {
    width: 36px;
    height: 36px;
  }
  .sh-primitive-title {
    font-size: 26px;
  }

  .sh-inline-title {
    font-size: 22px;
    margin-bottom: 16px;
  }
  .sh-demos {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 480px) {
  .sh-hero {
    padding: 44px 20px 36px;
  }
  .sh-hero-name { font-size: 28px; }
  .sh-hero-text { font-size: 19px; }

  .sh-hero-row {
    flex-direction: column;
    align-items: stretch;
    max-width: 280px;
    margin-left: auto;
    margin-right: auto;
  }

  .sh-primitive-head {
    gap: 12px;
    margin-bottom: 16px;
  }
  .sh-primitive-title {
    font-size: 22px;
  }

  .sh-inline-title {
    font-size: 20px;
    margin-bottom: 14px;
  }
}
</style>
