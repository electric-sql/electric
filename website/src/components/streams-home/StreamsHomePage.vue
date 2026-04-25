<script setup lang="ts">
import { computed, ref } from "vue"
import { VPButton } from "vitepress/theme"

import EaSection from "../agents-home/Section.vue"

import StreamFlowBg from "./StreamFlowBg.vue"
import AgentLoopFillDemo from "./AgentLoopFillDemo.vue"
import ConnectionDropDemo from "./ConnectionDropDemo.vue"
import QuickstartPlaybackDemo from "./QuickstartPlaybackDemo.vue"
import ThreePropertiesGrid from "./ThreePropertiesGrid.vue"
import OffsetReplayDemo from "./OffsetReplayDemo.vue"
import PolyglotLineup from "./PolyglotLineup.vue"
import LayersGrid from "./LayersGrid.vue"
import CollabSessionDemo from "./CollabSessionDemo.vue"
import IntegrationsGrid from "./IntegrationsGrid.vue"
import InstallPill from "../InstallPill.vue"
import MidPageStrap from "../MidPageStrap.vue"
import BottomCtaStrap from "../BottomCtaStrap.vue"
import CuratedBlogPosts from "../CuratedBlogPosts.vue"
import MarkdownContent from "../MarkdownContent.vue"
import MdExportExplicit from "../MdExportExplicit.vue"
import { useMarkdownExport } from "../../lib/useMarkdownExport"

/* Curated list of Streams-relevant blog posts that fill the panel
   below the 30-second tour. Order matters — first item appears
   top-left and so on. Slugs are the trailing path segment of the
   blog post filename (date prefix stripped). */
const streamsBlogPosts = [
  "fork-branching-for-durable-streams",
  "data-primitive-agent-loop",
  "ai-agents-as-crdt-peers-with-yjs",
  "stream-db",
]

const heroInnerRef = ref<HTMLElement>()

const installCommand = "npm i @durable-streams/client"

const isMarkdownExport = useMarkdownExport()

const liveDemos = [
  {
    title: "Durable AI Chat",
    description:
      "Multi-user, multi-agent AI chat with resumable sessions across tabs and devices.",
    href: "/streams/demos",
    thumbClass: "ds-demo-thumb-chat",
    glyph: "💬",
  },
  {
    title: "Background Jobs",
    description:
      "Real-time job dashboard built on State Protocol. Live progress events into StreamDB.",
    href: "/streams/demos",
    thumbClass: "ds-demo-thumb-jobs",
    glyph: "⚙",
  },
  {
    title: "Yjs Collab Editor",
    description:
      "Multi-user collaborative editor over Yjs CRDTs and Electric Streams. No WebSocket server needed.",
    href: "/streams/demos",
    thumbClass: "ds-demo-thumb-yjs",
    glyph: "✎",
  },
] as const

const liveDemosMarkdown = computed(() =>
  liveDemos.map((demo) => `- [${demo.title}](${demo.href}): ${demo.description}`).join("\n")
)

const stackExamples = [
  {
    id: "producer",
    filename: "producer.ts",
    language: "ts",
    code: `import { DurableStream, IdempotentProducer } from "@durable-streams/client"

const handle = await DurableStream.create({
  url: STREAM_URL,
  contentType: "application/json",
})

const producer = new IdempotentProducer(
  handle, "llm-relay-1", { autoClaim: true }
)

for await (const chunk of llm.stream(prompt))
  producer.append(chunk)

await producer.flush()`,
  },
  {
    id: "consumer",
    filename: "consumer.ts",
    language: "ts",
    code: `import { stream } from "@durable-streams/client"

const res = await stream<ChatMessage>({
  url: STREAM_URL,
  offset: lastSeen ?? "-1",
  live: "sse",
})

res.subscribeJson(async (batch) => {
  for (const msg of batch.items) render(msg)
  lastSeen = batch.nextOffset
})`,
  },
  {
    id: "curl",
    filename: "curl.sh",
    language: "sh",
    code: `curl -X POST $URL \\
  -H 'Content-Type: application/json' \\
  -d '{"event":"click"}'

curl -N "$URL?offset=-1&live=sse"`,
  },
] as const

const stackTab = ref<(typeof stackExamples)[number]["id"]>("producer")

const stackExamplesMarkdown = computed(() =>
  stackExamples
    .map(
      (example) => `### ${example.filename}

\`\`\`${example.language}
${example.code}
\`\`\``
    )
    .join("\n\n")
)

</script>

<template>
  <div class="ds-home">
    <!-- ───────────────── §1 — Hero ───────────────── -->
    <section class="ds-hero">
      <StreamFlowBg class="md-exclude" :exclude-el="heroInnerRef" />
      <div ref="heroInnerRef" class="ds-hero-inner">
        <h1 class="ds-hero-name">
          Electric&nbsp;<span class="ds-hero-accent">Streams</span>
        </h1>
        <p class="ds-hero-text">
          The data primitive for the agent&nbsp;loop
        </p>

        <div class="ds-hero-install-row">
          <!-- Accent the package name only: every other token (`npm`,
               `i`) renders muted and just `@durable-streams/client`
               picks up the brand colour. Reads lighter than the
               default positional 4-colour palette and points the eye
               at the actual product name in the command. -->
          <InstallPill
            :command="installCommand"
            tone="raised"
            accent="@durable-streams/client"
          />
        </div>

        <div class="ds-hero-row">
          <VPButton
            tag="a"
            size="medium"
            theme="brand"
            text="Quickstart"
            href="/docs/streams/quickstart"
          />
          <VPButton
            tag="a"
            size="medium"
            theme="alt"
            text="Docs"
            href="/docs/streams"
          />
        </div>
      </div>
    </section>

    <!-- ───────────────── §1.5 — The agent loop, on streams ───────────────── -->
    <EaSection id="agent-loop-primitive">
      <div class="ds-split ds-split--demo-2x">
        <div class="ds-split-text">
          <h2 class="ea-section-title">
            The agent loop is a stream of durable&nbsp;events
          </h2>
          <p class="ea-section-subtitle">
            Every prompt, tool call, and generation is appended at a known
            <strong>offset</strong> on a persistent, real-time stream.
            Replay from any offset, branch off, or fan out to humans,
            agents, and <a href="/agents">Electric&nbsp;Agents</a> —
            over plain&nbsp;HTTP.
          </p>
        </div>
        <div class="ds-split-demo md-exclude">
          <AgentLoopFillDemo />
        </div>
      </div>
    </EaSection>

    <!-- ───────────────── §1.6 — Many agents, one stream (dark) ─────────────────
         Pays off the new hero promise ("composable sync primitives for
         multi-agent systems"): once the agent loop is a stream (§1.5),
         any number of agents — and any number of humans — can attach
         to the same stream and coordinate on it without external
         infrastructure. Kept in this slot (right after §1.5) so the
         multi-agent angle lands inside the first two sections, before
         the page pivots to the general streaming pain. -->
    <EaSection id="multi-agent-coordination" :dark="true">
      <div class="ds-split ds-split--demo-2x">
        <div class="ds-split-demo md-exclude">
          <CollabSessionDemo />
        </div>
        <div class="ds-split-text">
          <h2 class="ea-section-title">
            Every stream is&nbsp;multiplayer
          </h2>
          <p class="ea-section-subtitle">
            Streams aren't single-consumer. Any number of agents — and
            humans — can attach to the same stream, see each other's
            events as they land, and pick up exactly where they left
            off. The shared stream is the coordination&nbsp;layer.
          </p>
          <p class="ds-detail-link">
            <a href="/blog/2026/01/12/durable-sessions-for-collaborative-ai">
              Read Durable Sessions for Collaborative&nbsp;AI →
            </a>
          </p>
        </div>
      </div>
    </EaSection>

    <!-- ───────────────── §3 — 30-second tour (promoted above §2) ─────────────────
         After two sections of AI-loop framing the reader needs a concrete
         "here's what a stream actually is" beat. Four curl commands —
         create / append / read / tail — answer that without any AI vocab.
         It also primes §2 below: once you've seen POST/GET work, the
         "but bare SSE breaks because…" pivot lands harder. -->
    <EaSection
      id="thirty-second-tour"
      title="The 30-second&nbsp;tour"
      subtitle="Four curl commands. Create a stream, append a message, read it back, then tail it&nbsp;live."
    >
      <QuickstartPlaybackDemo />
      <p class="ds-tour-footer">
        Run this yourself →
        <a href="/docs/streams/quickstart"><code>/docs/streams/quickstart</code></a>
      </p>
    </EaSection>

    <!--
      Mid-page CTA strap. Sits after the concrete tour and the curated
      blog panel below — once readers have seen what a stream IS, give
      them a single jump-off to the docs without making them scroll the
      whole page.

      `tone="surface"` (raised) is used here because both the section
      above (§3 thirty-second-tour) and the curated-blog section below
      are default/light, so the strap needs to read as a *lift* above
      them rather than a valley. The open-protocol strap further down
      sits between two `:dark="true"` sections and uses the default
      `tone="bg"` (deep) for the inverse effect.
    -->
    <MidPageStrap id="ship-streams" tone="surface">
      <template #eyebrow><span class="md-exclude">Ready to&nbsp;build</span></template>
      <template #title>
        Ship your first durable stream in&nbsp;minutes
      </template>
      <template #tagline>
        Install the client, create a stream, and start appending events.
        Subscribe live from anywhere on the&nbsp;network.
      </template>
      <template #actions>
        <VPButton
          tag="a"
          size="medium"
          theme="brand"
          text="Quickstart"
          href="/docs/streams/quickstart"
        />
        <VPButton
          tag="a"
          size="medium"
          theme="alt"
          text="Docs"
          href="/docs/streams/"
        />
      </template>
    </MidPageStrap>

    <!-- ───────────────── Curated blog posts ─────────────────
         Hand-picked selection of posts that go deeper on the topics
         introduced above. Source list lives in the script setup as
         `streamsBlogPosts` so it can be tuned without touching the
         template. -->
    <EaSection
      id="from-the-blog"
      title="From the&nbsp;blog"
      subtitle="Go deeper on Electric Streams, the Durable Streams protocol, and what teams are building on&nbsp;them."
    >
      <CuratedBlogPosts :posts="streamsBlogPosts" :limit="4" />
      <template #actions>
        <VPButton
          tag="a"
          size="medium"
          theme="brand"
          text="Electric Blog"
          href="/blog"
        />
        <VPButton
          tag="a"
          size="medium"
          theme="alt"
          text="Follow @ElectricSQL"
          href="https://x.com/ElectricSQL"
        />
      </template>
    </EaSection>

    <!-- ───────────────── §2 — Streaming needs to be durable ─────────────────
         Now the reader has seen what a stream IS (the tour above), so the
         pivot from "look how easy" to "but doing this with bare SSE
         breaks" carries weight. Dark background suits the heavier
         "problem zone" beat and keeps the alternation clean (light tour
         → dark pain → light properties below). -->
    <EaSection
      id="durable-pain"
      title="Streaming needs to be&nbsp;durable"
      subtitle="SSE drops on a refresh. Tokens get lost on flaky networks. Resuming means re-running the request and re-billing the&nbsp;LLM."
      :dark="true"
    >
      <p class="ea-prose ds-pain-intro">
        Real apps need streams that <strong>survive&nbsp;disconnects</strong>,
        <strong>persist&nbsp;across&nbsp;sessions</strong>, and let many users
        and agents read and write the same conversation. That's what an
        <strong>Electric&nbsp;Stream</strong>&nbsp;is.
      </p>
      <ConnectionDropDemo class="md-exclude" />
    </EaSection>

    <!-- ───────────────── §4 — Three properties ───────────────── -->
    <EaSection
      id="three-properties"
      title="Three properties that change&nbsp;everything"
      subtitle="Electric Streams is a protocol, not a SaaS. The protocol is the&nbsp;product."
    >
      <ThreePropertiesGrid />
    </EaSection>

    <!-- ───────────────── §5 — Replay from any offset ───────────────── -->
    <EaSection id="offset-replay" :dark="true">
      <div class="ds-split ds-split--demo-wide">
        <div class="ds-split-demo md-exclude">
          <OffsetReplayDemo />
        </div>
        <div class="ds-split-text">
          <h2 class="ea-section-title">Replay from any offset, exactly&nbsp;once</h2>
          <p class="ea-section-subtitle">
            Producers identify themselves with three headers. Servers de-dupe.
            Clients resume from the last offset they saw. No external
            coordination&nbsp;required.
          </p>
          <p class="ds-detail-link">
            <a href="/docs/streams/#producers">Read the protocol →</a>
          </p>
        </div>
      </div>
    </EaSection>

    <!-- ───────────────── §6 — Polyglot lineup ───────────────── -->
    <EaSection
      id="polyglot"
      title="It's just HTTP — works&nbsp;everywhere"
      subtitle="If your runtime can speak HTTP, it can read and write an Electric Stream. No SDK lock-in. No proprietary transport. No WebSocket&nbsp;infrastructure."
    >
      <PolyglotLineup />
    </EaSection>

    <!-- ───────────────── §7 — Layered protocol ───────────────── -->
    <EaSection
      id="layered-stack"
      :dark="true"
      title="One protocol, four&nbsp;layers"
      subtitle="Pick the layer you need. Bytes → JSON messages → typed CRUD events → reactive type-safe DB. Every layer above adds power; every layer below remains&nbsp;available."
    >
      <LayersGrid />
    </EaSection>

    <!--
      Open-protocol callout strap. Sits right after the four-layer
      diagram so readers reach for the protocol while it's still on
      screen. Marketing/product framing stays on this site; the
      protocol spec, conformance suite and reference implementations
      all live on durablestreams.com.
    -->
    <MidPageStrap id="open-protocol-strap">
      <template #eyebrow><span class="md-exclude">Open protocol · Apache&nbsp;2.0</span></template>
      <template #title>
        Built on the open Durable&nbsp;Streams protocol
      </template>
      <template #tagline>
        Electric Streams is one implementation. The protocol spec,
        conformance suite and reference clients live on
        <a href="https://durablestreams.com/" target="_blank" rel="noopener">durablestreams.com</a> —
        independent, fully&nbsp;open.
      </template>
      <template #actions>
        <VPButton
          tag="a"
          size="medium"
          theme="brand"
          text="durablestreams.com"
          href="https://durablestreams.com/"
        />
        <VPButton
          tag="a"
          size="medium"
          theme="alt"
          text="Read the spec"
          href="https://durablestreams.com/spec"
        />
      </template>
    </MidPageStrap>

    <!-- ───────────────── §11 — AI loop integrations ─────────────────
         Flipped to dark so the open-protocol strap above (deep --ea-bg)
         sits as a valley between two equally-toned dark sections —
         matches the rhythm used around `MidPageStrap` on the agents
         page. The full chain §11 → §14 below is flipped accordingly. -->
    <EaSection
      id="ai-loop"
      :dark="true"
      title="Built for the agent&nbsp;loop"
      subtitle="From token streams to multi-agent collaboration — Electric Streams plugs into the AI stack you already&nbsp;use."
    >
      <IntegrationsGrid />
    </EaSection>

    <!-- ───────────────── §12 — Your stack ───────────────── -->
    <EaSection
      id="your-stack"
      title="Your stack, not&nbsp;ours"
      subtitle="Self-host the server with one binary, or run it on Electric Cloud. Producers and consumers are anything that speaks&nbsp;HTTP."
    >
      <div class="ds-stack-layout">
        <div class="ds-stack-diagram md-exclude">
          <div class="stack-box producer-box">
            <div class="stack-label">Your producer</div>
            <div class="stack-examples">Anthropic · Express · FastAPI · cron</div>
          </div>
          <div class="stack-connector">
            <div class="stack-conn-line" />
            <span class="stack-conn-label">POST /v1/stream/&hellip;</span>
          </div>
          <div class="stack-box runtime-box">
            <div class="stack-label">Electric Streams</div>
            <div class="stack-examples">Electric Cloud · self-host</div>
          </div>
          <div class="stack-connector">
            <div class="stack-conn-line" />
            <span class="stack-conn-label">GET ?live=sse · ?offset=&hellip;</span>
          </div>
          <div class="stack-box consumer-box">
            <div class="stack-label">Your consumer</div>
            <div class="stack-examples">browser · agent · worker · iOS · Python</div>
          </div>
        </div>

        <div class="ds-stack-code">
          <MdExportExplicit v-if="isMarkdownExport">
            <MarkdownContent>{{ stackExamplesMarkdown }}</MarkdownContent>
          </MdExportExplicit>
          <template v-else>
            <div class="code-tabs md-exclude">
              <button
                v-for="example in stackExamples"
                :key="example.id"
                class="code-tab"
                :class="{ active: stackTab === example.id }"
                @click="stackTab = example.id"
              >{{ example.filename }}</button>
            </div>
            <pre v-show="stackTab === 'producer'" class="code-block tabbed"><code><span class="tk-kw">import</span> { <span class="tk-v">DurableStream</span>, <span class="tk-v">IdempotentProducer</span> } <span class="tk-kw">from</span> <span class="tk-str">"@durable-streams/client"</span>

<span class="tk-kw">const</span> <span class="tk-v">handle</span> = <span class="tk-kw">await</span> <span class="tk-v">DurableStream</span>.<span class="tk-fn">create</span>({
  <span class="tk-prop">url</span>: <span class="tk-v">STREAM_URL</span>,
  <span class="tk-prop">contentType</span>: <span class="tk-str">"application/json"</span>,
})

<span class="tk-kw">const</span> <span class="tk-v">producer</span> = <span class="tk-kw">new</span> <span class="tk-fn">IdempotentProducer</span>(
  <span class="tk-v">handle</span>, <span class="tk-str">"llm-relay-1"</span>, { <span class="tk-prop">autoClaim</span>: <span class="tk-kw">true</span> }
)

<span class="tk-kw">for await</span> (<span class="tk-kw">const</span> <span class="tk-v">chunk</span> <span class="tk-kw">of</span> <span class="tk-v">llm</span>.<span class="tk-fn">stream</span>(<span class="tk-v">prompt</span>))
  <span class="tk-v">producer</span>.<span class="tk-fn">append</span>(<span class="tk-v">chunk</span>)

<span class="tk-kw">await</span> <span class="tk-v">producer</span>.<span class="tk-fn">flush</span>()</code></pre>

            <pre v-show="stackTab === 'consumer'" class="code-block tabbed"><code><span class="tk-kw">import</span> { <span class="tk-v">stream</span> } <span class="tk-kw">from</span> <span class="tk-str">"@durable-streams/client"</span>

<span class="tk-kw">const</span> <span class="tk-v">res</span> = <span class="tk-kw">await</span> <span class="tk-fn">stream</span>&lt;<span class="tk-v">ChatMessage</span>&gt;({
  <span class="tk-prop">url</span>: <span class="tk-v">STREAM_URL</span>,
  <span class="tk-prop">offset</span>: <span class="tk-v">lastSeen</span> ?? <span class="tk-str">"-1"</span>,
  <span class="tk-prop">live</span>: <span class="tk-str">"sse"</span>,
})

<span class="tk-v">res</span>.<span class="tk-fn">subscribeJson</span>(<span class="tk-kw">async</span> (<span class="tk-v">batch</span>) <span class="tk-kw">=></span> {
  <span class="tk-kw">for</span> (<span class="tk-kw">const</span> <span class="tk-v">msg</span> <span class="tk-kw">of</span> <span class="tk-v">batch</span>.<span class="tk-v">items</span>) <span class="tk-fn">render</span>(<span class="tk-v">msg</span>)
  <span class="tk-v">lastSeen</span> = <span class="tk-v">batch</span>.<span class="tk-v">nextOffset</span>
})</code></pre>

            <pre v-show="stackTab === 'curl'" class="code-block tabbed"><code><span class="tk-prop">curl</span> -X POST <span class="tk-v">$URL</span> \
  -H <span class="tk-str">'Content-Type: application/json'</span> \
  -d <span class="tk-str">'{"event":"click"}'</span>

<span class="tk-prop">curl</span> -N <span class="tk-str">"$URL?offset=-1&amp;live=sse"</span></code></pre>
          </template>
        </div>
      </div>
    </EaSection>

    <!-- ───────────────── §13 — Your first stream ───────────────── -->
    <EaSection
      id="first-stream"
      title="Your first stream, end to&nbsp;end"
      subtitle="Create a stream. Append a message. Subscribe live. Three steps, one package, real&nbsp;APIs."
      :dark="true"
    >
      <div class="ds-first-stream">
        <div class="ea-annotated-code">
          <div class="ea-left-col">
            <div class="ea-code-panel">
              <div class="code-file-header">stream.ts</div>
              <pre class="code-block annotated"><code><span class="tk-kw">import</span> { <span class="tk-v">DurableStream</span>, <span class="tk-v">stream</span> } <span class="tk-kw">from</span> <span class="tk-str">"@durable-streams/client"</span><span class="ann-marker" data-n="1"></span>

<span class="tk-kw">const</span> <span class="tk-v">url</span> = <span class="tk-str">"https://streams.example.com/v1/stream/chat"</span>

<span class="tk-kw">const</span> <span class="tk-v">handle</span> = <span class="tk-kw">await</span> <span class="tk-v">DurableStream</span>.<span class="tk-fn">create</span>({<span class="ann-marker" data-n="2"></span>
  <span class="tk-v">url</span>,
  <span class="tk-prop">contentType</span>: <span class="tk-str">"application/json"</span>,<span class="ann-marker" data-n="3"></span>
})

<span class="tk-kw">await</span> <span class="tk-v">handle</span>.<span class="tk-fn">append</span>(<span class="tk-fn">JSON</span>.<span class="tk-fn">stringify</span>({<span class="ann-marker" data-n="4"></span>
  <span class="tk-prop">role</span>: <span class="tk-str">"user"</span>, <span class="tk-prop">text</span>: <span class="tk-str">"Hello"</span>
}))

<span class="tk-kw">const</span> <span class="tk-v">res</span> = <span class="tk-kw">await</span> <span class="tk-fn">stream</span>&lt;{ <span class="tk-prop">role</span>: <span class="tk-v">string</span>; <span class="tk-prop">text</span>: <span class="tk-v">string</span> }&gt;({
  <span class="tk-v">url</span>,
  <span class="tk-prop">offset</span>: <span class="tk-str">"-1"</span>,<span class="ann-marker" data-n="5"></span>
  <span class="tk-prop">live</span>: <span class="tk-str">"sse"</span>,<span class="ann-marker" data-n="6"></span>
})

<span class="tk-v">res</span>.<span class="tk-fn">subscribeJson</span>(<span class="tk-kw">async</span> (<span class="tk-v">batch</span>) <span class="tk-kw">=></span> {<span class="ann-marker" data-n="7"></span>
  <span class="tk-kw">for</span> (<span class="tk-kw">const</span> <span class="tk-v">msg</span> <span class="tk-kw">of</span> <span class="tk-v">batch</span>.<span class="tk-v">items</span>) <span class="tk-fn">console</span>.<span class="tk-fn">log</span>(<span class="tk-v">msg</span>)
})</code></pre>
            </div>
            <div class="ea-cli-panel">
              <div class="cli-header">Terminal</div>
              <div class="cli-body">
                <div class="cli-line"><span class="cli-prompt">$</span> npx tsx stream.ts</div>
                <div class="cli-output">✓ Created stream chat</div>
                <div class="cli-output">✓ Appended message</div>
                <div class="cli-output">→ { role: "user", text: "Hello" }</div>
                <div class="cli-output">→ { role: "assistant", text: "Hi there!" }</div>
                <div class="cli-output">→ ▍</div>
              </div>
            </div>
          </div>
          <div class="ea-right-col">
            <div class="ea-annotations">
              <div class="ea-ann-item">
                <span class="ea-ann-num">1</span>
                <div>
                  <strong>One package, two entry points</strong>
                  <p><code>DurableStream</code> for read/write handles. <code>stream()</code> for fetch-style consumption.</p>
                </div>
              </div>
              <div class="ea-ann-item">
                <span class="ea-ann-num">2</span>
                <div>
                  <strong><code>DurableStream.create</code> opens or creates</strong>
                  <p>Idempotent: returns the existing handle if the stream already exists.</p>
                </div>
              </div>
              <div class="ea-ann-item">
                <span class="ea-ann-num">3</span>
                <div>
                  <strong>Pick your content type</strong>
                  <p><code>application/json</code> enables <a href="/docs/streams/json-mode">JSON mode</a> — message boundaries are preserved.</p>
                </div>
              </div>
              <div class="ea-ann-item">
                <span class="ea-ann-num">4</span>
                <div>
                  <strong>Append messages</strong>
                  <p>Each <code>append</code> is a single <code>POST</code>. Wrap with <a href="/docs/streams/clients/typescript#exactly-once-writes"><code>IdempotentProducer</code></a> for exactly-once delivery and batching.</p>
                </div>
              </div>
              <div class="ea-ann-item">
                <span class="ea-ann-num">5</span>
                <div>
                  <strong>Resume from any offset</strong>
                  <p><code>"-1"</code> = beginning. Pass a saved offset to resume from exactly that point. <code>"now"</code> = skip the backlog.</p>
                </div>
              </div>
              <div class="ea-ann-item">
                <span class="ea-ann-num">6</span>
                <div>
                  <strong>Live, in real time</strong>
                  <p><code>"sse"</code> opens a long-lived Server-Sent Events stream. <code>"long-poll"</code> works in environments that can't hold a connection open.</p>
                </div>
              </div>
              <div class="ea-ann-item">
                <span class="ea-ann-num">7</span>
                <div>
                  <strong>Subscribe with batches</strong>
                  <p><code>subscribeJson</code> calls your handler with a <code>batch.items</code> array. The batch carries the next offset — save it to resume from later.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </EaSection>

    <!-- ───────────────── §14 — Live demos ───────────────── -->
    <EaSection
      id="live-demos"
      title="Live&nbsp;demos"
      subtitle="See Electric Streams in action. Every demo is open source — fork it, run it, learn from&nbsp;it."
    >
      <MdExportExplicit>
        <MarkdownContent>{{ liveDemosMarkdown }}</MarkdownContent>
      </MdExportExplicit>
      <div class="ds-demo-strip md-exclude">
        <a
          v-for="demo in liveDemos"
          :key="demo.title"
          :href="demo.href"
          class="ds-demo-card"
        >
          <div class="ds-demo-thumb" :class="demo.thumbClass">
            <span class="ds-demo-glyph">{{ demo.glyph }}</span>
          </div>
          <div class="ds-demo-body">
            <h3>{{ demo.title }}</h3>
            <p>{{ demo.description }}</p>
          </div>
        </a>
      </div>
      <template #actions>
        <VPButton
          tag="a"
          size="medium"
          theme="brand"
          text="All demos"
          href="/streams/demos"
        />
      </template>
    </EaSection>

    <!-- ───────────────── §15 — Get started ─────────────────
         Restyled from the boxed `.ds-cta` panel to the shared
         `<BottomCtaStrap>` so the page-close visual matches the
         agents page. Copy was tightened — eyebrow drops the
         protocol callout (now handled by the open-protocol strap
         mid-page) and the "Or sign up for Electric Cloud" foot
         was removed to keep one clear end-of-page action. -->
    <BottomCtaStrap id="get-started">
      <template #eyebrow>
        <span class="md-exclude">Apache&nbsp;2.0 · open&nbsp;source</span>
      </template>
      <template #title>
        Start streaming&nbsp;today
      </template>
      <template #tagline>
        Create a stream, append events, subscribe&nbsp;live.
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
          href="/docs/streams/quickstart"
        />
        <VPButton
          tag="a"
          size="medium"
          theme="alt"
          text="Docs"
          href="/docs/streams/"
        />
        <VPButton
          tag="a"
          size="medium"
          theme="alt"
          text="GitHub"
          href="https://github.com/electric-sql/durable-streams"
        />
      </template>
    </BottomCtaStrap>
  </div>
</template>

<style scoped>
.ds-home {
  overflow-x: hidden;
  max-width: 100vw;
}

/* ── §1 Hero ──────────────────────────────────────────────────────── */

.ds-hero {
  position: relative;
  /* Bottom padding bumped from 56 → 96 to give the hero (and the
     animated stream-flow background that paints behind it) more room
     to breathe before the first section takes over. Top stays at 72
     so the headline still anchors high on the viewport. */
  padding: 72px 24px 96px;
  text-align: center;
  overflow: hidden;
}

.ds-hero-inner {
  position: relative;
  z-index: 1;
  max-width: 860px;
  margin: 0 auto;
  pointer-events: none;
}
.ds-hero-inner * {
  pointer-events: auto;
}

.ds-hero-name {
  font-size: 56px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
  background: none;
  -webkit-background-clip: border-box;
  background-clip: border-box;
  -webkit-text-fill-color: currentColor;
  color: var(--ea-text-1);
  margin: 0;
  padding-bottom: 4px;
  text-wrap: balance;
}

.ds-hero-accent {
  color: var(--vp-c-brand-1);
  -webkit-text-fill-color: currentColor;
}

.ds-hero-text {
  font-size: 28px;
  font-weight: 500;
  color: var(--ea-text-1);
  margin: 16px auto 30px;
  max-width: 720px;
  line-height: 1.35;
  text-wrap: balance;
}

/* Two-row CTA stack: the install pill always sits on its own line
   above the action buttons so the copyable command reads as a
   distinct affordance rather than a peer of the buttons. */
.ds-hero-install-row {
  margin-top: 24px;
  display: flex;
  justify-content: center;
}

.ds-hero-row {
  margin-top: 14px;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

/* Hero install pill is rendered by the shared `<InstallPill>` component
   in `src/components/InstallPill.vue` — pill chrome, type sizes,
   syntax-highlighting palette and clipboard behaviour all live there. */

/* ── §2 Pain intro ─────────────────────────────────────────────── */

/* `.ds-pain-intro` — overrides on top of the shared `.ea-prose` rule
   defined in `.vitepress/theme/custom.css`. The `<p>` carries both
   classes (`<p class="ea-prose ds-pain-intro">`); only divergent
   properties live here. */
.ds-pain-intro {
  max-width: 760px;
  /* Pull the intro 24px closer to the section title on desktop —
     EaSection's header has a 40px bottom margin which feels too loose
     when the body starts with a single prose paragraph. The negative
     margin is reset to 0 at the mobile breakpoints below where the
     header bottom margin is already tighter (28px / 24px) and the
     pull-up would otherwise collapse the gap to ~0. */
  margin: -24px 0 28px;
  /* Slightly tighter line-height than the shared 1.7 so the single
     paragraph reads more like the section subtitle it follows. */
  line-height: 1.6;
}

/* ── §3 Tour footer ─────────────────────────────────────────────── */

.ds-tour-footer {
  margin-top: 24px;
  text-align: center;
  font-size: 13.5px;
  color: var(--ea-text-2);
}
.ds-tour-footer a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.ds-tour-footer a:hover {
  text-decoration: underline;
}
.ds-tour-footer code {
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  background: var(--ea-surface-alt);
  padding: 1px 5px;
  border-radius: 3px;
}

/* ── Generic split layout (§5, §7, §9) ──────────────────────────── */

.ds-split {
  display: flex;
  gap: 48px;
  align-items: flex-start;
}
.ds-split-demo {
  flex: 1;
  min-width: 0;
}
.ds-split-text {
  flex: 1;
  min-width: 0;
}
/* Variant: give the demo more horizontal room when the diagram needs
   wide aspect (used by §5 OffsetReplayDemo). */
.ds-split--demo-wide .ds-split-demo {
  flex: 1.6;
}
.ds-split--demo-wide .ds-split-text {
  flex: 1;
}
/* Variant: demo is moderately larger than the text column — keeps the
   diagram readable without dominating the row (used by §9 Durable Sessions). */
.ds-split--demo-2x .ds-split-demo {
  flex: 1.3;
}
.ds-split--demo-2x .ds-split-text {
  flex: 1;
}
.ds-split-text .ea-section-title {
  font-size: 28px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: var(--ea-text-1);
  margin: 0;
  text-wrap: balance;
}
.ds-split-text .ea-section-subtitle {
  font-size: 17px;
  line-height: 1.6;
  color: var(--ea-text-2);
  text-wrap: pretty;
  margin: 12px 0 0;
}
.ds-detail {
  font-size: 15px;
  line-height: 1.6;
  color: var(--ea-text-2);
  margin: 20px 0 0;
  opacity: 0.85;
}
.ds-detail code {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  background: var(--ea-surface-alt);
  padding: 1px 5px;
  border-radius: 3px;
  color: var(--ea-text-1);
}
.ds-detail-link {
  margin: 16px 0 0;
  font-size: 14px;
}
.ds-detail-link a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.ds-detail-link a:hover {
  text-decoration: underline;
}
.ds-detail-links {
  margin: 20px 0 0;
  font-size: 13.5px;
  color: var(--ea-text-2);
}
.ds-detail-links a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.ds-detail-links a:hover {
  text-decoration: underline;
}
.ds-detail-links .sep {
  margin: 0 6px;
  color: var(--ea-divider);
}

/* ── §12 Stack layout (lifted from EA but re-prefixed) ──────────── */

.ds-stack-layout {
  display: flex;
  gap: 40px;
  align-items: flex-start;
}
.ds-stack-diagram {
  flex: 0 0 280px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.ds-stack-diagram .stack-box {
  width: 100%;
  padding: 20px;
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  background: var(--ea-surface);
  text-align: center;
}
.ds-stack-diagram .stack-label {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--ea-text-1);
}
.ds-stack-diagram .stack-examples {
  font-size: 12px;
  color: var(--ea-text-2);
  margin-top: 4px;
}
.ds-stack-diagram .runtime-box {
  border-color: var(--vp-c-brand-1);
}
.ds-stack-diagram .runtime-box .stack-label {
  color: var(--vp-c-brand-1);
}
.ds-stack-diagram .consumer-box {
  border-style: dashed;
}
.ds-stack-diagram .stack-connector {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 0;
}
.ds-stack-diagram .stack-conn-line {
  width: 2px;
  height: 20px;
  background: var(--ea-divider);
}
.ds-stack-diagram .stack-conn-label {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--ea-text-2);
  margin-top: 2px;
}
.ds-stack-code {
  flex: 1;
  min-width: 0;
}

/* Code tabs (mirrored from EA, scoped to ds- to avoid leakage) */
.ds-stack-code .code-tabs {
  display: flex;
  background: var(--ea-surface-alt);
  border: 1px solid var(--ea-divider);
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  overflow: hidden;
}
.dark .ds-stack-code .code-tabs {
  background: var(--ea-surface);
}
.dark .ds-stack-code .code-tab.active {
  background: var(--ea-surface-alt);
}
.dark .ds-stack-code .code-block {
  background: var(--ea-surface-alt);
}
.ds-stack-code .code-tab {
  padding: 10px 16px;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--ea-text-2);
  background: transparent;
  border: none;
  border-right: 1px solid var(--ea-divider);
  cursor: pointer;
  transition: color 0.2s, background 0.2s;
}
.ds-stack-code .code-tab:last-child {
  border-right: none;
}
.ds-stack-code .code-tab:hover {
  color: var(--ea-text-1);
}
.ds-stack-code .code-tab.active {
  color: var(--ea-text-1);
  background: var(--ea-surface);
}
.ds-stack-code .code-block.tabbed {
  border-radius: 0 0 8px 8px;
}

/* Shared code-block chrome (mirrors EA but ds-prefixed scope) */
.ds-stack-code .code-block,
.ds-first-stream .code-block {
  margin: 0;
  padding: 16px 20px;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 0 0 8px 8px;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.7;
  color: var(--ea-text-2);
  overflow-x: auto;
  white-space: pre;
}

.ds-stack-code .code-block :deep(.tk-kw),
.ds-first-stream .code-block :deep(.tk-kw) {
  color: var(--vp-c-brand-1);
}
.ds-stack-code .code-block :deep(.tk-fn),
.ds-first-stream .code-block :deep(.tk-fn) {
  color: var(--ea-event-message);
}
.ds-stack-code .code-block :deep(.tk-str),
.ds-first-stream .code-block :deep(.tk-str) {
  color: var(--ea-event-tool-result);
}
.ds-stack-code .code-block :deep(.tk-prop),
.ds-first-stream .code-block :deep(.tk-prop) {
  color: var(--ea-event-tool-call);
}
.ds-stack-code .code-block :deep(.tk-v),
.ds-first-stream .code-block :deep(.tk-v) {
  color: var(--ea-text-1);
}

/* ── §13 First stream ──────────────────────────────────────────── */

.ds-first-stream .ea-annotated-code {
  display: flex;
  gap: 32px;
  align-items: flex-start;
}
.ds-first-stream .ea-left-col {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.ds-first-stream .ea-right-col {
  flex: 0 0 320px;
  padding-top: 44px;
}
.ds-first-stream .code-file-header {
  padding: 10px 16px;
  background: var(--ea-surface-alt);
  border: 1px solid var(--ea-divider);
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--ea-text-2);
}
.ds-first-stream .code-block.annotated {
  padding-left: 20px;
}
.ds-first-stream .ann-marker {
  display: none;
}
.ds-first-stream .ann-marker[data-n] {
  display: inline;
}
/* Outlined, brand-coloured numeric markers — matches the
   `Your first sync, end to end` annotation style on the Sync
   landing page (see `.code-block .ann-marker` in
   sync-home/SyncHomePage.vue). The outlined variant reads
   cleanly on both the code and CLI panels, so the previous
   per-panel inversion is no longer needed. */
.ds-first-stream .ann-marker[data-n]::after {
  content: attr(data-n);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: transparent;
  border: 1px solid var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  margin-left: 12px;
  vertical-align: middle;
}
.ds-first-stream .ea-annotations {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.ds-first-stream .ea-ann-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.ds-first-stream .ea-ann-num {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: transparent;
  border: 1px solid var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  margin-top: 1px;
}
.ds-first-stream .ea-ann-item strong {
  display: block;
  font-size: 13.5px;
  color: var(--ea-text-1);
  margin-bottom: 3px;
}
.ds-first-stream .ea-ann-item p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ea-text-2);
}
.ds-first-stream .ea-ann-item code {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  background: var(--ea-surface-alt);
  padding: 1px 5px;
  border-radius: 3px;
}
.ds-first-stream .ea-ann-item a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.ds-first-stream .ea-ann-item a:hover {
  text-decoration: underline;
}
.ds-first-stream .ea-cli-panel {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--ea-divider);
}
.ds-first-stream .cli-header {
  padding: 10px 16px;
  background: var(--ea-surface);
  border-bottom: 1px solid var(--ea-divider);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--ea-text-2);
}
.ds-first-stream .cli-body {
  padding: 16px 20px;
  background: var(--ea-bg);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.8;
}
.ds-first-stream .cli-line {
  color: var(--ea-text-1);
}
.ds-first-stream .cli-prompt {
  color: var(--vp-c-brand-1);
  margin-right: 8px;
}
.ds-first-stream .cli-output {
  color: var(--ea-text-2);
  padding-left: 20px;
}
/* ── §14 Demo strip (placeholder cards) ───────────────────────── */

.ds-demo-strip {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
.ds-demo-card {
  display: flex;
  flex-direction: column;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 10px;
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.2s, transform 0.2s;
}
.ds-demo-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}
.ds-demo-thumb {
  height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ea-surface-alt);
  border-bottom: 1px solid var(--ea-divider);
  position: relative;
  overflow: hidden;
}
.ds-demo-thumb::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    repeating-linear-gradient(
      45deg,
      transparent 0,
      transparent 10px,
      color-mix(in srgb, var(--vp-c-brand-1) 4%, transparent) 10px,
      color-mix(in srgb, var(--vp-c-brand-1) 4%, transparent) 11px
    );
}
.ds-demo-glyph {
  font-size: 56px;
  position: relative;
  filter: grayscale(0.2);
  opacity: 0.85;
}
.ds-demo-body {
  padding: 18px 20px 22px;
}
.ds-demo-body h3 {
  font-size: 16px;
  /* Card title — kept at 600 (one step below section h2). */
  font-weight: 600;
  margin: 0 0 6px;
  color: var(--ea-text-1);
}
.ds-demo-body p {
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--ea-text-2);
  margin: 0;
}

/* §15 bottom CTA is now rendered by the shared `<BottomCtaStrap>`
   component (see `src/components/BottomCtaStrap.vue`). All visual
   styles for that strap live with the component — nothing extra is
   needed here. */

/* ── Responsive ────────────────────────────────────────────────── */

@media (max-width: 960px) {
  .ds-split {
    flex-direction: column;
    align-items: stretch;
    gap: 32px;
  }
  .ds-split-demo,
  .ds-split-text {
    width: 100%;
  }
  .ds-split-reverse {
    flex-direction: column;
  }
  .ds-stack-layout {
    flex-direction: column;
  }
  .ds-stack-diagram {
    flex: none;
    width: 100%;
  }
  .ds-stack-code {
    width: 100%;
  }
  .ds-first-stream .ea-annotated-code {
    flex-direction: column;
  }
  .ds-first-stream .ea-left-col,
  .ds-first-stream .ea-right-col {
    flex: none;
    width: 100%;
    padding-top: 0;
  }
  .ds-demo-strip {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .ds-hero {
    /* Bumped horizontal padding from 20 → 24 for more breathing room
       from the viewport edge on tablets / large phones. Bottom
       padding scales with the desktop bump (40 → 64) so the hero
       still has air below the CTAs at this breakpoint. */
    padding: 56px 24px 64px;
  }
  .ds-hero-name {
    font-size: 36px;
  }
  .ds-hero-text {
    font-size: 22px;
  }
  .ds-split-text .ea-section-title {
    font-size: 22px;
  }
  /* These are inline `<p class="ea-section-subtitle">` paragraphs (not
     rendered through EaSection's slot), so the cascade in Section.vue's
     scoped style block doesn't reach them. Mirror Section.vue's mobile
     subtitle size (15px) so the subtitle scales in lockstep with the
     section title above it. */
  .ds-split-text .ea-section-subtitle {
    font-size: 15px;
  }
  /* Reset the desktop -24px pull-up: EaSection's header bottom margin
     is already only 28px at this breakpoint so the negative top margin
     would collapse the gap below the title to ~4px. Font-size is
     handled by the shared `.ea-prose` mobile cascade in custom.css. */
  .ds-pain-intro {
    margin-top: 0;
  }
  .ds-stack-code .code-block,
  .ds-first-stream .code-block {
    font-size: 12px;
    padding: 12px 14px;
  }
  .ds-first-stream .cli-body {
    font-size: 12px;
    padding: 12px 14px;
  }
}

@media (max-width: 480px) {
  .ds-hero {
    /* Bumped horizontal padding from 16 → 20 for breathing room.
       Bottom padding scales with the desktop bump (32 → 52). */
    padding: 44px 20px 52px;
  }
  .ds-hero-name {
    font-size: 28px;
  }
  .ds-hero-text {
    font-size: 19px;
  }
  /* Drop the section title override in lockstep with the shared
     `.ea-section-title` rule in Section.vue (20px at 480px) so the
     `.ds-split-text` heading matches every other section title on
     the page at this breakpoint. */
  .ds-split-text .ea-section-title {
    font-size: 20px;
  }
  /* Continue stepping the inline subtitle down in lockstep with
     Section.vue's `.ea-section-subtitle` (14px at 480px). */
  .ds-split-text .ea-section-subtitle {
    font-size: 14px;
  }
  /* `.ds-pain-intro` font-size at 480px is handled by the shared
     `.ea-prose` mobile cascade in custom.css. */
  /* Stack the action buttons full-width on the smallest screens so
     they don't wrap awkwardly underneath the install pill. */
  .ds-hero-row {
    flex-direction: column;
    align-items: stretch;
    max-width: 280px;
    margin-left: auto;
    margin-right: auto;
  }
  .ds-stack-code .code-block,
  .ds-first-stream .code-block {
    font-size: 11px;
    padding: 10px 12px;
    line-height: 1.6;
  }
  .ds-first-stream .cli-body {
    font-size: 11px;
    padding: 10px 12px;
  }
  .ds-first-stream .code-file-header,
  .ds-stack-code .code-tab,
  .ds-first-stream .cli-header {
    font-size: 11px;
    padding: 8px 12px;
  }
  .ds-first-stream .ann-marker[data-n]::after {
    width: 16px;
    height: 16px;
    font-size: 9px;
    margin-left: 6px;
  }
  .ds-first-stream .ea-ann-num {
    width: 20px;
    height: 20px;
    font-size: 11px;
  }
}
</style>
