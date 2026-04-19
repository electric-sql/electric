<script setup lang="ts">
import { ref } from "vue"
import { VPButton } from "vitepress/theme"

import EaSection from "../agents-home/Section.vue"
import SyncFanOutBg from "./SyncFanOutBg.vue"
import MultiClientPulseDemo from "./MultiClientPulseDemo.vue"
import ShapeCarveDemo from "./ShapeCarveDemo.vue"
import WritesLadder from "./WritesLadder.vue"
import WorksWithStack from "./WorksWithStack.vue"
import CloudStrip from "./CloudStrip.vue"
import ComposeStackGrid from "./ComposeStackGrid.vue"

import { data as demoData } from "../../../data/demos.data.ts"

const featuredDemos = demoData.homepage_demos.slice(0, 3)

const installCopied = ref(false)
function copyInstall() {
  navigator.clipboard?.writeText("npx @electric-sql/start my-app")
  installCopied.value = true
  setTimeout(() => {
    installCopied.value = false
  }, 1800)
}

const heroInnerRef = ref<HTMLElement>()

// Compact fan-out diagram geometry (viewBox is 200 wide, centred on x=100).
// Lines fan from the CDN pill out to a grid of client dots arranged in
// FANOUT_ROWS rows × FANOUT_COLS columns underneath.
// Compute evenly-distributed x positions in a 100-wide viewBox to match
// flex `justify-content: space-around` (centers at (i + 0.5) * 100/N).
const tickXs = (n: number) =>
  Array.from({ length: n }, (_, i) => ((i + 0.5) * 100) / n)

const FANOUT_COLS = 10
const FANOUT_ROWS = 3
// Horizontal spacing (in viewBox units ≈ on-screen px at this scale)
// between adjacent line *starts* on the CDN pill, so the lines fan from a
// short bar instead of a single point.
const FANOUT_START_GAP = 5
const fanoutMiniLines = Array.from({ length: FANOUT_COLS }, (_, i) => {
  const offset = i - (FANOUT_COLS - 1) / 2
  return {
    x1: 100 + offset * FANOUT_START_GAP,
    x2: 20 + (i * (200 - 40)) / (FANOUT_COLS - 1),
  }
})
const fanoutMiniDotCount = FANOUT_COLS * FANOUT_ROWS
</script>

<template>
  <div class="sync-home">
    <!-- ───────────────────────── Section 1: Hero ───────────────────────── -->
    <section class="sh-hero">
      <SyncFanOutBg :exclude-el="heroInnerRef" />
      <div ref="heroInnerRef" class="sh-hero-inner">
        <h1 class="sh-hero-name">
          Electric <span class="sh-hero-underline">Sync</span>
        </h1>
        <p class="sh-hero-text">
          Sync subsets of your Postgres into everything.
        </p>
        <p class="sh-hero-tagline">
          A read-path sync engine for fast, collaborative apps and live agents.<br />
          Fanned out over CDN, written through your existing&nbsp;backend.
        </p>

        <div class="sh-hero-row">
          <button
            class="sh-hero-install"
            type="button"
            @click="copyInstall"
            :aria-label="installCopied ? 'Copied' : 'Copy install command'"
          >
            <span class="sh-hero-install-text">
              <span class="sh-hero-install-prompt">$</span>
              npx @electric-sql/start my-app
            </span>
            <span
              class="sh-hero-install-copy"
              :class="{ copied: installCopied }"
              aria-hidden="true"
            >
              <svg
                v-if="!installCopied"
                xmlns="http://www.w3.org/2000/svg"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
              <svg
                v-else
                xmlns="http://www.w3.org/2000/svg"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          </button>

          <VPButton
            tag="a"
            size="medium"
            theme="brand"
            text="Quickstart"
            href="/docs/quickstart"
          />
        </div>
      </div>
    </section>

    <!-- ───────────── Section 2: Online together (the problem) ───────────── -->
    <EaSection id="online-together">
      <div class="sh-two-col sh-two-col-headed">
        <div class="sh-prose-col">
          <h2 class="sh-inline-title">Apps that come online&nbsp;together</h2>
          <p class="ea-prose">
            Modern products are real-time, multi-user, multi-device, and increasingly 
            <strong>multi-agent</strong>. The same record needs to land in a
            web dashboard, a mobile feed, and the context window of an agent
            that's mid-flight.
          </p>
          <p class="ea-prose">
            <strong>Sync is the primitive that fixes it.</strong>
            One source of truth in Postgres. The same live changelog delivered
            to every reader, with the same guarantees.
          </p>
        </div>
        <div class="sh-visual-col">
          <MultiClientPulseDemo />
        </div>
      </div>
    </EaSection>

    <!-- ─────────────── Section 3: Shape — the unit of sync ─────────────── -->
    <EaSection
      id="shape"
      title="Define a Shape — sync just what you&nbsp;need"
      subtitle="A Shape is a SQL query against your Postgres. Electric carves out the matching rows and keeps them live for every client that subscribes."
      :dark="true"
    >
      <ShapeCarveDemo />
      <div class="sh-section-foot">
        <a href="/docs/guides/shapes">Read the Shapes guide →</a>
      </div>
    </EaSection>

    <!-- ──────────────── Section 4: Fan-out at the edge ──────────────── -->
    <EaSection id="fan-out">
      <div class="sh-two-col sh-two-col-headed sh-two-col-mini-visual">
        <div class="sh-prose-col">
          <h2 class="sh-inline-title">
            One shape, every client — fanned out at the&nbsp;edge
          </h2>
          <p class="ea-prose">
            Shapes stream over plain HTTP. CDNs cache them. Millions of clients
            can read the same shape without touching your&nbsp;database.
          </p>
          <div class="sh-fanout-stats">
            <div class="stat">
              <div class="stat-num">1M+</div>
              <div class="stat-label mono">readers per&nbsp;shape</div>
            </div>
            <div class="stat">
              <div class="stat-num">99%</div>
              <div class="stat-label mono">cache hit&nbsp;rate</div>
            </div>
            <div class="stat">
              <div class="stat-num">∞</div>
              <div class="stat-label mono">db load flat</div>
            </div>
          </div>
          <div class="sh-section-foot sh-section-foot-tight">
            <a href="/docs/api/http">HTTP API reference →</a>
          </div>
        </div>
        <div class="sh-visual-col">
          <div class="sh-fanout-mini" aria-hidden="true">
            <div class="fan-mini-row">
              <div class="fan-node fan-pg">
                <span class="fan-node-label">Postgres</span>
              </div>
            </div>
            <svg class="fan-mini-rail" viewBox="0 0 200 28" preserveAspectRatio="none">
              <line x1="100" y1="0" x2="100" y2="28" />
            </svg>
            <div class="fan-mini-row">
              <div class="fan-node fan-electric">
                <span class="fan-node-label">Electric + CDN</span>
                <span class="fan-node-meta mono">cached&nbsp;HTTP</span>
              </div>
            </div>
            <svg class="fan-mini-fan" viewBox="0 0 200 44" preserveAspectRatio="none">
              <line v-for="(l, i) in fanoutMiniLines" :key="i"
                :x1="l.x1" y1="0" :x2="l.x2" y2="44" />
            </svg>
            <div class="fan-mini-clients">
              <span v-for="i in fanoutMiniDotCount" :key="i" class="fan-mini-dot" />
            </div>
          </div>
        </div>
      </div>
    </EaSection>

    <!-- ──────────── Section 5: Bring your own writes ──────────── -->
    <EaSection
      id="writes"
      title="Bring your own&nbsp;writes"
      subtitle="Electric handles the read path. Writes go through your existing backend — pick how much sync you want on top."
      :dark="true"
    >
      <WritesLadder />
      <div class="sh-section-foot">
        <a href="/docs/guides/writes">Writes guide →</a>
      </div>
    </EaSection>

    <!-- ──────────── Section 6: Sync for AI agent apps ──────────── -->
    <EaSection id="agent-loop">
      <div class="sh-two-col sh-two-col-headed sh-two-col-mini-visual">
        <div class="sh-prose-col">
          <div class="sh-paradigm-label good">
            <span class="dot dot-good"></span>
            <span class="mono">human-in-the-loop · agent-in-the-loop</span>
          </div>
          <h2 class="sh-inline-title">
            Sync is how humans stay in the AI&nbsp;loop
          </h2>
          <p class="ea-prose">
            AI agents work on shared data — and they change it while users are
            still looking at it. Without sync, your UI shows stale state, users
            have to refresh, and teams fall out of step on what every agent is
            doing.
          </p>
          <p class="ea-prose">
            With Electric, every user, device and teammate sees the changes
            agents are making, in real time. The same shared state powers
            multi-tab, multi-device, multi-user and multi-agent collaboration —
            out of the&nbsp;box.
          </p>
          <div class="sh-section-foot sh-section-foot-tight">
            <a href="/blog/2026/04/08/data-primitive-agent-loop">
              Read: the data primitive for the agent loop →
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

    <!-- ──────────── Section 7: Scales with Postgres ──────────── -->
    <EaSection
      id="scales"
      :dark="true"
    >
      <div class="sh-scale-layout">
        <div class="sh-scale-text">
          <h2 class="sh-inline-title">Scales with your&nbsp;Postgres</h2>
          <p class="sh-scale-lead">
            One Electric instance can fan out a single shape to a million
            concurrent readers without adding load to your database.
          </p>
          <p class="sh-scale-detail">
            The shape log is computed once, written to disk, and served from a
            CDN. Compute scales horizontally, storage scales out, and your
            Postgres only does what Postgres is&nbsp;good&nbsp;at.
          </p>
          <div class="sh-section-foot left">
            <a href="/docs/reference/benchmarks">See the benchmarks →</a>
          </div>
        </div>
        <div class="sh-scale-chart">
          <div class="chart-card">
            <div class="chart-row">
              <span class="chart-label mono">10k clients</span>
              <div class="chart-bar"><span class="bar-fill" style="--w: 8%"></span></div>
              <span class="chart-val mono">~3% CPU</span>
            </div>
            <div class="chart-row">
              <span class="chart-label mono">100k clients</span>
              <div class="chart-bar"><span class="bar-fill" style="--w: 18%"></span></div>
              <span class="chart-val mono">~7% CPU</span>
            </div>
            <div class="chart-row">
              <span class="chart-label mono">1M clients</span>
              <div class="chart-bar"><span class="bar-fill" style="--w: 42%"></span></div>
              <span class="chart-val mono">~14% CPU</span>
            </div>
            <div class="chart-row">
              <span class="chart-label mono">database</span>
              <div class="chart-bar"><span class="bar-fill flat" style="--w: 4%"></span></div>
              <span class="chart-val mono">flat</span>
            </div>
            <div class="chart-foot mono">
              single Electric instance · 1 shape · sustained read fan-out
            </div>
          </div>
        </div>
      </div>
    </EaSection>

    <!-- ──────────── Section 8: Four pillars (BestWayToBuild re-skin) ──────────── -->
    <EaSection
      id="pillars"
      title="The best way to build&nbsp;apps"
      subtitle="Sync makes your apps super-fast, with end-to-end reactivity, resilience, and built-in multi-user collaboration."
    >
      <div class="sh-pillars">
        <a
          v-for="p in [
            { id: 'reactivity', title: 'Super-fast reactivity', body: 'Build fast, modern apps like Figma and Linear. Sub-millisecond reactivity and instant local writes.', href: '/blog/2025/07/29/super-fast-apps-on-sync-with-tanstack-db' },
            { id: 'resilience', title: 'Resilient transport', body: 'Build apps that work reliably, even with patchy connectivity. Resilient transport that ensures data is never lost.', href: '/blog/2026/03/24/durable-transport-ai-sdks' },
            { id: 'collaboration', title: 'Real-time collaboration', body: 'Build multi-user, multi-agent apps that naturally support both real-time and asynchronous collaboration.', href: '/blog/2026/01/12/durable-sessions-for-collaborative-ai' },
            { id: 'durability', title: 'Durable state', body: 'Build multi-step agentic workflows that resume after failures. Agents and workers sync and resume from durable state.', href: '/blog/2026/04/08/data-primitive-agent-loop' },
          ]"
          :key="p.id"
          :href="p.href"
          class="sh-pillar"
        >
          <div class="sh-pillar-num mono">{{ ['01', '02', '03', '04'][[ 'reactivity', 'resilience', 'collaboration', 'durability' ].indexOf(p.id)] }}</div>
          <h4 class="sh-pillar-title">{{ p.title }}</h4>
          <p class="sh-pillar-body">{{ p.body }}</p>
          <span class="sh-pillar-link">Read more →</span>
        </a>
      </div>
    </EaSection>

    <!-- ──────────── Section 9: Works with your stack ──────────── -->
    <EaSection
      id="works-with"
      title="Works with your&nbsp;stack"
      subtitle="Any web framework. Any host. It's just HTTP and JSON — adopt sync incrementally, one route at a time."
      :dark="true"
    >
      <WorksWithStack />
      <div class="sh-section-foot">
        <a href="/docs/intro">See the integrations →</a>
      </div>
    </EaSection>

    <!-- ──────────── Section 10: Cloud strip ──────────── -->
    <EaSection
      id="cloud"
      title="Managed cloud, open&nbsp;source"
      subtitle="Vendor agnostic, infra agnostic. Run yourself or skip the ops with Electric Cloud."
    >
      <CloudStrip />
    </EaSection>

    <!-- ──────────── Section 11: First sync ──────────── -->
    <EaSection
      id="first-sync"
      title="Your first sync in 10 lines"
      subtitle="Define a shape on the server. Mount a collection on the client. Render a live query."
      :dark="true"
    >
      <div class="sh-first-sync">
        <div class="sh-first-sync-grid">
          <div class="sh-fs-col">
            <div class="sh-fs-panel">
              <div class="code-file-header mono">api/todos.ts &nbsp;<span class="muted">— server proxy</span></div>
              <pre class="code-block annotated"><code><span class="tk-kw">export const</span> <span class="tk-v">ServerRoute</span> = <span class="tk-fn">createServerFileRoute</span>(<span class="tk-str">"/api/todos"</span>).<span class="tk-fn">methods</span>({
  <span class="tk-prop">GET</span>: <span class="tk-kw">async</span> ({ <span class="tk-v">request</span> }) <span class="tk-kw">=></span> {
    <span class="tk-kw">const</span> <span class="tk-v">url</span> = <span class="tk-kw">new</span> <span class="tk-v">URL</span>(<span class="tk-v">request</span>.<span class="tk-prop">url</span>)
    <span class="tk-kw">const</span> <span class="tk-v">origin</span> = <span class="tk-kw">new</span> <span class="tk-v">URL</span>(<span class="tk-str">"https://api.electric-sql.cloud/v1/shape"</span>)<span class="ann-marker" data-n="1"></span>
    <span class="tk-v">url</span>.<span class="tk-prop">searchParams</span>.<span class="tk-fn">forEach</span>((<span class="tk-v">v</span>, <span class="tk-v">k</span>) <span class="tk-kw">=></span>
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
              <div class="code-file-header mono">app/Todos.tsx &nbsp;<span class="muted">— client</span></div>
              <pre class="code-block annotated"><code><span class="tk-kw">export const</span> <span class="tk-v">todoCollection</span> = <span class="tk-fn">createCollection</span>(
  <span class="tk-fn">electricCollectionOptions</span>({<span class="ann-marker" data-n="5"></span>
    <span class="tk-prop">id</span>: <span class="tk-str">"todos"</span>,
    <span class="tk-prop">shapeOptions</span>: { <span class="tk-prop">url</span>: <span class="tk-str">"/api/todos"</span> },
    <span class="tk-prop">getKey</span>: (<span class="tk-v">row</span>) <span class="tk-kw">=></span> <span class="tk-v">row</span>.<span class="tk-prop">id</span>,
  }),
)

<span class="tk-kw">export function</span> <span class="tk-fn">Todos</span>() {
  <span class="tk-kw">const</span> { <span class="tk-v">data</span> } = <span class="tk-fn">useLiveQuery</span>((<span class="tk-v">q</span>) <span class="tk-kw">=></span><span class="ann-marker" data-n="6"></span>
    <span class="tk-v">q</span>.<span class="tk-fn">from</span>({ <span class="tk-prop">todo</span>: <span class="tk-v">todoCollection</span> })
     .<span class="tk-fn">where</span>(({ <span class="tk-v">todo</span> }) <span class="tk-kw">=></span> <span class="tk-v">eq</span>(<span class="tk-v">todo</span>.<span class="tk-prop">completed</span>, <span class="tk-kw">false</span>)),
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
                  <p>Bind the <code>where</code> clause to the authenticated user — every client gets its own slice.</p>
                </div>
              </li>
              <li class="sh-fs-anno">
                <span class="num">4</span>
                <div>
                  <strong>Just an HTTP fetch.</strong>
                  <p>Streams over plain HTTP. Cache it, log it, rate-limit it — your usual middleware works.</p>
                </div>
              </li>
              <li class="sh-fs-anno">
                <span class="num">5</span>
                <div>
                  <strong>Mount a collection.</strong>
                  <p>An Electric collection in TanStack DB — local, reactive, persisted.</p>
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
          <VPButton tag="a" size="medium" theme="brand" text="Quickstart" href="/docs/quickstart" />
          <VPButton tag="a" size="medium" theme="alt" text="Read the Docs" href="/docs/intro" />
        </div>
      </div>
    </EaSection>

    <!-- ──────────── Section 12: Demos ──────────── -->
    <EaSection
      id="demos"
      title="Demos"
      subtitle="Reference apps you can clone, run locally, and learn from."
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
      <div class="sh-section-foot">
        <a href="/demos">See all demos →</a>
      </div>
    </EaSection>

    <!-- ──────────── Section 13: Compose your stack ──────────── -->
    <EaSection
      id="compose"
      title="Compose your sync&nbsp;stack"
      subtitle="Sync is one piece. Pair it with a reactive client store, an embedded database, or a durable stream — pick what fits the work."
      :dark="true"
    >
      <ComposeStackGrid />
    </EaSection>

    <!-- ──────────── Section 14: Get started ──────────── -->
    <EaSection id="get-started">
      <div class="sh-cta">
        <div class="sh-cta-eyebrow mono">
          <span class="dot"></span>
          Open source · Apache&nbsp;2.0 · ★&nbsp;9.5k
        </div>
        <h2 class="sh-cta-title">
          Start syncing in&nbsp;<span class="sh-cta-accent">minutes</span>.
        </h2>
        <p class="sh-cta-tagline">
          Spin up the starter, point it at Postgres, and ship a real-time app
          on top of your existing&nbsp;stack.
        </p>

        <button
          class="sh-cta-install"
          type="button"
          @click="copyInstall"
          :aria-label="installCopied ? 'Copied' : 'Copy install command'"
        >
          <span class="sh-cta-install-text">
            <span class="sh-cta-install-prompt">$</span>
            npx @electric-sql/start my-app
          </span>
          <span
            class="sh-cta-install-copy"
            :class="{ copied: installCopied }"
            aria-hidden="true"
          >
            <svg
              v-if="!installCopied"
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
            <svg
              v-else
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
        </button>

        <div class="sh-cta-buttons">
          <VPButton
            tag="a"
            size="medium"
            theme="brand"
            text="Quickstart"
            href="/docs/quickstart"
          />
          <VPButton
            tag="a"
            size="medium"
            theme="alt"
            text="Read the Docs"
            href="/docs/intro"
          />
          <VPButton
            tag="a"
            size="medium"
            theme="alt"
            text="GitHub"
            href="https://github.com/electric-sql/electric"
          />
        </div>

        <div class="sh-cta-foot mono">
          Or
          <a href="https://dashboard.electric-sql.cloud/">sign up to Electric Cloud</a>
          and skip the&nbsp;ops.
        </div>
      </div>
    </EaSection>
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
  padding: 96px 24px 80px;
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
  font-size: 64px;
  font-weight: 800;
  line-height: 1.1;
  background: var(--vp-home-hero-name-background);
  -webkit-background-clip: text;
  background-clip: text;
  color: var(--vp-home-hero-name-color);
  margin: 0;
}

.sh-hero-underline {
  text-decoration: underline;
  text-decoration-color: var(--vp-c-brand-1);
  text-underline-offset: 0.1em;
  text-decoration-thickness: 0.135em;
}

.sh-hero-text {
  font-size: 24px;
  font-weight: 500;
  color: var(--ea-text-1);
  margin: 18px 0 0;
  line-height: 1.35;
}

.sh-hero-tagline {
  font-family: var(--vp-font-family-base);
  font-size: 17px;
  color: var(--ea-text-2);
  margin: 14px auto 0;
  max-width: 620px;
  line-height: 1.6;
}

.sh-hero-row {
  margin-top: 32px;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.sh-hero-install {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 9px 14px;
  background: var(--ea-surface-alt);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s;
  user-select: none;
  font: inherit;
}
.sh-hero-install:hover {
  border-color: var(--vp-c-brand-1);
}
.sh-hero-install-text {
  font-family: var(--vp-font-family-mono);
  font-size: 13.5px;
  color: var(--ea-text-1);
  letter-spacing: -0.01em;
}
.sh-hero-install-prompt {
  color: var(--ea-text-3);
  margin-right: 4px;
}
.sh-hero-install-copy {
  color: var(--ea-text-3);
  display: flex;
  transition: color 0.2s;
}
.sh-hero-install-copy.copied {
  color: var(--vp-c-brand-1);
}

/* ── Two-col prose+visual layout ────────────────────────────────── */

.sh-two-col {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) 1.4fr;
  gap: 48px;
  align-items: start;
}

/* Variant where the visual is a small accent rather than the main subject:
   text takes ~2/3, visual ~1/3. The prose column is wider here, so let
   the paragraphs fill the column instead of being clamped by the default
   .ea-prose max-width (which is tuned for the narrower 1.4fr column). */
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

/* When a two-col block hosts the section heading inline (so the visual
   sits next to the heading rather than below it). */
.sh-inline-title {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--ea-text-1);
  margin: 0 0 20px;
  text-wrap: pretty;
}

@media (max-width: 768px) {
  .sh-inline-title {
    font-size: 22px;
    margin-bottom: 16px;
  }
}
@media (max-width: 480px) {
  .sh-inline-title {
    font-size: 20px;
    margin-bottom: 14px;
  }
}

.ea-prose {
  font-family: var(--vp-font-family-base);
  font-size: 17px;
  line-height: 1.7;
  text-wrap: pretty;
  color: var(--ea-text-1);
  margin: 0 0 16px;
  max-width: 540px;
}
.ea-prose:last-child { margin-bottom: 0; }
.ea-prose strong { color: var(--ea-text-1); font-weight: 600; }

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

/* ── Section 4: fan-out (compact two-col) ──────────────────────── */

.fan-node {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 14px;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
}
.fan-node-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ea-text-1);
  line-height: 1.2;
}
.fan-node-meta {
  font-size: 10px;
  color: var(--ea-text-3);
  letter-spacing: 0.02em;
}
.fan-pg .fan-node-label { color: #336791; }
.fan-electric .fan-node-label { color: var(--vp-c-brand-1); }

.sh-fanout-mini {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  padding: 22px 14px 22px;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
}

.fan-mini-row {
  display: flex;
  justify-content: center;
}

.fan-mini-rail,
.fan-mini-fan {
  width: 100%;
  display: block;
  stroke: var(--ea-divider);
  stroke-width: 1;
  fill: none;
}
.fan-mini-rail { height: 16px; }
.fan-mini-fan { height: 48px; margin-top: 4px; }
.fan-mini-rail line,
.fan-mini-fan line {
  stroke: var(--ea-divider);
  stroke-width: 1;
}

.fan-mini-clients {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  column-gap: 5px;
  row-gap: 18px;
  justify-items: center;
  padding: 6px 6px 2px;
  margin-top: 0;
}
.fan-mini-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  opacity: 0.7;
}

.sh-fanout-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--ea-divider);
}
.stat { text-align: left; }
.stat:first-child { padding-left: 0; }
.stat-num {
  font-size: 26px;
  font-weight: 700;
  color: var(--ea-text-1);
  letter-spacing: -0.02em;
  line-height: 1;
}
.stat-label {
  margin-top: 6px;
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ea-text-3);
}

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

/* Vertical bus: users (left) ──── shared-state rail ──── agents (right).
   Tick lines are CSS pseudo-elements on each node so they're guaranteed
   to attach to the node's vertical centre regardless of column heights. */
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

/* Tick from each user node's right edge to the rail. */
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
/* Tick from the rail to each agent node's left edge. */
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

/* Short vertical ticks connecting each row of nodes to the bus. */
.bus-tick {
  width: 100%;
  height: 12px;
  display: block;
  fill: none;
}
.bus-tick line {
  stroke: color-mix(in srgb, var(--vp-c-brand-1) 35%, var(--ea-divider));
  stroke-width: 0.75;
}

/* The shared-state "bus" rail spans the full sketch width. */
.bus {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  background: color-mix(in srgb, var(--vp-c-brand-1) 8%, var(--ea-surface));
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 35%, var(--ea-divider));
  border-radius: 4px;
}
.bus-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--vp-c-brand-1);
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
.node-pg { color: #336791; }
.node-agent { color: var(--vp-c-brand-1); }
.node-device {
  color: var(--ea-text-2);
  border-style: dashed;
}
.arrow { color: var(--ea-text-3); }

/* ── Scale section ──────────────────────────────────────────────── */

.sh-scale-layout {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  gap: 48px;
  align-items: center;
}
.sh-scale-lead {
  margin: 0 0 16px;
  font-family: var(--vp-font-family-base);
  font-size: 17px;
  line-height: 1.6;
  color: var(--ea-text-2);
  text-wrap: pretty;
}
.sh-scale-detail {
  margin: 0;
  font-family: var(--vp-font-family-base);
  font-size: 15.5px;
  line-height: 1.7;
  color: var(--ea-text-2);
}

.chart-card {
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  padding: 24px;
}
.chart-row {
  display: grid;
  grid-template-columns: 88px 1fr 80px;
  gap: 12px;
  align-items: center;
  margin-bottom: 14px;
}
.chart-row:last-of-type { margin-bottom: 0; }
.chart-label, .chart-val {
  font-size: 12px;
  color: var(--ea-text-3);
  letter-spacing: 0.02em;
}
.chart-val { text-align: right; color: var(--ea-text-1); }
.chart-bar {
  height: 8px;
  background: var(--ea-surface-alt);
  border-radius: 4px;
  overflow: hidden;
  position: relative;
}
.bar-fill {
  display: block;
  height: 100%;
  width: var(--w);
  background: var(--vp-c-brand-1);
  border-radius: 4px;
  animation: bar-grow 1s ease-out;
}
.bar-fill.flat {
  background: var(--ea-text-3);
}
@keyframes bar-grow {
  from { width: 0; }
  to { width: var(--w); }
}
.chart-foot {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px dashed var(--ea-divider);
  font-size: 11px;
  color: var(--ea-text-3);
  letter-spacing: 0.02em;
}

/* ── Pillars ────────────────────────────────────────────────────── */

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

/* ── Get started CTA ────────────────────────────────────────────── */

.sh-cta {
  position: relative;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  padding: 56px 32px 48px;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 12px;
  overflow: hidden;
  isolation: isolate;
}
.sh-cta::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(
      ellipse 70% 90% at 50% 0%,
      color-mix(in srgb, var(--vp-c-brand-1) 6%, transparent) 0%,
      transparent 55%
    );
  z-index: -1;
  opacity: 0.7;
}

.sh-cta-eyebrow {
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
.sh-cta-eyebrow .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}

.sh-cta-title {
  font-size: 38px;
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.015em;
  color: var(--ea-text-1);
  margin: 0;
  max-width: 560px;
}
.sh-cta-accent {
  background: var(--vp-home-hero-name-background);
  -webkit-background-clip: text;
  background-clip: text;
  color: var(--vp-home-hero-name-color);
}

.sh-cta-tagline {
  font-family: var(--vp-font-family-base);
  font-size: 16px;
  line-height: 1.6;
  color: var(--ea-text-2);
  margin: 14px auto 0;
  max-width: 460px;
}

.sh-cta-install {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  margin-top: 28px;
  background: var(--ea-bg);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s;
  user-select: none;
  font: inherit;
}
.sh-cta-install:hover { border-color: var(--vp-c-brand-1); }
.sh-cta-install-text {
  font-family: var(--vp-font-family-mono);
  font-size: 13.5px;
  color: var(--ea-text-1);
  letter-spacing: -0.01em;
}
.sh-cta-install-prompt {
  color: var(--ea-text-3);
  margin-right: 4px;
}
.sh-cta-install-copy {
  color: var(--ea-text-3);
  display: flex;
  transition: color 0.2s;
}
.sh-cta-install-copy.copied { color: var(--vp-c-brand-1); }

.sh-cta-buttons {
  display: flex;
  gap: 10px;
  margin-top: 20px;
  flex-wrap: wrap;
  justify-content: center;
}

.sh-cta-foot {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px dashed var(--ea-divider);
  width: 100%;
  max-width: 480px;
  font-size: 12px;
  color: var(--ea-text-3);
  letter-spacing: 0.02em;
}
.sh-cta-foot a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.sh-cta-foot a:hover { text-decoration: underline; }

/* ── Responsive ─────────────────────────────────────────────────── */

@media (max-width: 960px) {
  .sh-two-col,
  .sh-scale-layout,
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
  .sh-fanout-stats {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .fan-mid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .fan-clients {
    grid-template-columns: repeat(4, 1fr);
  }
}

@media (max-width: 640px) {
  .sh-hero {
    padding: 64px 16px 56px;
  }
  .sh-hero-name { font-size: 44px; }
  .sh-hero-text { font-size: 19px; }
  .sh-hero-tagline { font-size: 16px; }
  .sh-demos {
    grid-template-columns: 1fr;
  }
  .fan-clients {
    grid-template-columns: repeat(3, 1fr);
  }
  .sh-cta {
    padding: 40px 20px 36px;
  }
  .sh-cta-title { font-size: 28px; }
  .sh-cta-buttons { flex-direction: column; align-self: stretch; max-width: 280px; margin-left: auto; margin-right: auto; }
}
</style>
