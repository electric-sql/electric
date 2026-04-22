<script setup lang="ts">
import { ref } from "vue"
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

const heroInnerRef = ref<HTMLElement>()

const installCopied = ref(false)
function copyInstall() {
  navigator.clipboard?.writeText("npm i @durable-streams/client")
  installCopied.value = true
  setTimeout(() => {
    installCopied.value = false
  }, 1800)
}

const stackTab = ref<"producer" | "consumer" | "curl">("producer")

</script>

<template>
  <div class="ds-home">
    <!-- ───────────────── §1 — Hero ───────────────── -->
    <section class="ds-hero">
      <StreamFlowBg :exclude-el="heroInnerRef" />
      <div ref="heroInnerRef" class="ds-hero-inner">
        <h1 class="ds-hero-name">
          Electric <span class="ds-hero-accent">Streams</span>
        </h1>
        <p class="ds-hero-text">
          The data primitive for the agent&nbsp;loop
        </p>

        <div class="ds-hero-row">
          <button
            class="ds-hero-install"
            type="button"
            @click="copyInstall"
            :aria-label="installCopied ? 'Copied' : 'Copy install command'"
          >
            <span class="ds-hero-install-text">
              <span class="ds-hero-install-prompt">$</span>
              npm i @durable-streams/client
            </span>
            <span
              class="ds-hero-install-copy"
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
            href="/docs/streams/quickstart"
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
        <div class="ds-split-demo">
          <AgentLoopFillDemo />
        </div>
      </div>
    </EaSection>

    <!-- ───────────────── §1.6 — Durable Sessions (moved up, dark) ─────────────────
         Continues the AI-loop story from §1.5: once the loop is a stream,
         many humans and agents can attach to the same one. Promoting this
         section keeps the AI angle front-loaded for the first three
         sections before we pivot to the general streaming pain. -->
    <EaSection id="durable-sessions" :dark="true">
      <div class="ds-split ds-split--demo-2x">
        <div class="ds-split-demo">
          <CollabSessionDemo />
        </div>
        <div class="ds-split-text">
          <h2 class="ea-section-title">
            Durable Sessions: multi-user,&nbsp;multi-agent
          </h2>
          <p class="ea-section-subtitle">
            One session URL. Many humans, many agents, many devices. Everyone
            shares the same durable stream and can rejoin from any point in
            the&nbsp;conversation.
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
      <ConnectionDropDemo />
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
        <div class="ds-split-demo">
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
            <a href="/docs/streams/concepts#producers">Read the protocol →</a>
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
      subtitle="Pick the layer you need. Bytes → JSON messages → typed CRUD events → reactive type-safe DB. Every layer above adds power; every layer below remains available."
    >
      <LayersGrid />
    </EaSection>

    <!-- ───────────────── §11 — AI loop integrations ───────────────── -->
    <EaSection
      id="ai-loop"
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
      :dark="true"
    >
      <div class="ds-stack-layout">
        <div class="ds-stack-diagram">
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
          <div class="code-tabs">
            <button
              class="code-tab"
              :class="{ active: stackTab === 'producer' }"
              @click="stackTab = 'producer'"
            >producer.ts</button>
            <button
              class="code-tab"
              :class="{ active: stackTab === 'consumer' }"
              @click="stackTab = 'consumer'"
            >consumer.ts</button>
            <button
              class="code-tab"
              :class="{ active: stackTab === 'curl' }"
              @click="stackTab = 'curl'"
            >curl.sh</button>
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
        </div>
      </div>
    </EaSection>

    <!-- ───────────────── §13 — Your first stream ───────────────── -->
    <EaSection
      id="first-stream"
      title="Your first stream, end to&nbsp;end"
      subtitle="Create a stream. Append a message. Subscribe live. Three steps, one package, real&nbsp;APIs."
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
      :dark="true"
    >
      <div class="ds-demo-strip">
        <a href="/streams/demos" class="ds-demo-card">
          <div class="ds-demo-thumb ds-demo-thumb-chat">
            <span class="ds-demo-glyph">💬</span>
          </div>
          <div class="ds-demo-body">
            <h3>Durable AI Chat</h3>
            <p>Multi-user, multi-agent AI chat with resumable sessions across tabs and devices.</p>
          </div>
        </a>
        <a href="/streams/demos" class="ds-demo-card">
          <div class="ds-demo-thumb ds-demo-thumb-jobs">
            <span class="ds-demo-glyph">⚙</span>
          </div>
          <div class="ds-demo-body">
            <h3>Background Jobs</h3>
            <p>Real-time job dashboard built on State Protocol. Live progress events into StreamDB.</p>
          </div>
        </a>
        <a href="/streams/demos" class="ds-demo-card">
          <div class="ds-demo-thumb ds-demo-thumb-yjs">
            <span class="ds-demo-glyph">✎</span>
          </div>
          <div class="ds-demo-body">
            <h3>Yjs Collab Editor</h3>
            <p>Multi-user collaborative editor over Yjs CRDTs and Electric Streams. No WebSocket server needed.</p>
          </div>
        </a>
      </div>
      <p class="ds-tour-footer">
        See all demos →
        <a href="/streams/demos"><code>/streams/demos</code></a>
      </p>
    </EaSection>

    <!-- ───────────────── §15 — Get started ───────────────── -->
    <EaSection id="get-started">
      <div class="ds-cta">
        <div class="ds-cta-eyebrow mono">
          <span class="dot"></span>
          Open protocol · Apache&nbsp;2.0 · just&nbsp;HTTP
        </div>
        <h2 class="ds-cta-title">
          Start streaming in&nbsp;<span class="ds-cta-accent">seconds</span>.
        </h2>
        <p class="ds-cta-tagline">
          Install the client, point it at any HTTP endpoint, and tail a durable
          stream from anywhere on the&nbsp;network.
        </p>

        <button
          class="ds-cta-install"
          type="button"
          @click="copyInstall"
          :aria-label="installCopied ? 'Copied' : 'Copy install command'"
        >
          <span class="ds-cta-install-text">
            <span class="ds-cta-install-prompt">$</span>
            npm i @durable-streams/client
          </span>
          <span
            class="ds-cta-install-copy"
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

        <div class="ds-cta-buttons">
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
            text="Read the Docs"
            href="/docs/streams/"
          />
          <VPButton
            tag="a"
            size="medium"
            theme="alt"
            text="GitHub"
            href="https://github.com/electric-sql/durable-streams"
          />
        </div>

        <div class="ds-cta-foot mono">
          Or
          <a href="https://dashboard.electric-sql.cloud/">sign up for Electric Cloud</a>
          and skip the&nbsp;ops.
        </div>
      </div>
    </EaSection>
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
  padding: 100px 24px 80px;
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
  line-height: 1.2;
  background: none;
  -webkit-background-clip: border-box;
  background-clip: border-box;
  -webkit-text-fill-color: currentColor;
  color: var(--ea-text-1);
  margin: 0;
  padding-bottom: 4px;
}

.ds-hero-accent {
  color: var(--vp-c-brand-1);
  -webkit-text-fill-color: currentColor;
}

.ds-hero-text {
  font-size: 28px;
  font-weight: 500;
  color: var(--ea-text-1);
  margin: 24px auto 0;
  max-width: 720px;
  line-height: 1.35;
  text-wrap: balance;
}

.ds-hero-row {
  margin-top: 32px;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.ds-hero-install {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--ea-surface-alt);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s;
  user-select: none;
  font: inherit;
}
.ds-hero-install:hover {
  border-color: var(--vp-c-brand-1);
}
.ds-hero-install-text {
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  color: var(--ea-text-1);
  letter-spacing: -0.01em;
}
.ds-hero-install-prompt {
  color: var(--ea-text-2);
  margin-right: 6px;
}
.ds-hero-install-copy {
  color: var(--ea-text-2);
  display: flex;
  transition: color 0.2s;
}
.ds-hero-install-copy.copied {
  color: var(--vp-c-brand-1);
}

/* ── §2 Pain intro ─────────────────────────────────────────────── */

.ds-pain-intro {
  max-width: 760px;
  margin: -24px 0 28px;
  font-size: 17px;
  line-height: 1.6;
  color: var(--ea-text-2);
  text-wrap: pretty;
}
.ds-pain-intro strong {
  color: var(--ea-text-1);
  font-weight: 600;
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
  font-weight: 700;
  line-height: 1.3;
  color: var(--ea-text-1);
  margin: 0;
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
.ds-first-stream .ann-marker[data-n]::after {
  content: attr(data-n);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--ea-text-1);
  color: var(--ea-surface);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  margin-left: 12px;
  vertical-align: middle;
}
:root:not(.dark) .ds-first-stream .ea-cli-panel .ann-marker[data-n]::after {
  background: var(--ea-surface);
  color: var(--ea-text-1);
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
  background: var(--ea-text-1);
  color: var(--ea-surface);
  font-size: 13px;
  font-weight: 700;
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
  font-weight: 700;
  margin: 0 0 6px;
  color: var(--ea-text-1);
}
.ds-demo-body p {
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--ea-text-2);
  margin: 0;
}

/* ── §15 Get started ──────────────────────────────────────────── */

.ds-cta {
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
.ds-cta::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse 70% 90% at 50% 0%,
    color-mix(in srgb, var(--vp-c-brand-1) 6%, transparent) 0%,
    transparent 55%
  );
  z-index: -1;
  opacity: 0.7;
}

.ds-cta-eyebrow {
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
.ds-cta-eyebrow .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}

.ds-cta-title {
  font-size: 38px;
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.015em;
  color: var(--ea-text-1);
  margin: 0;
  max-width: 560px;
}
.ds-cta-accent {
  background: var(--vp-home-hero-name-background);
  -webkit-background-clip: text;
  background-clip: text;
  color: var(--vp-home-hero-name-color);
}

.ds-cta-tagline {
  font-family: var(--vp-font-family-base);
  font-size: 16px;
  line-height: 1.6;
  color: var(--ea-text-2);
  margin: 14px auto 0;
  max-width: 460px;
}

.ds-cta-install {
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
.ds-cta-install:hover {
  border-color: var(--vp-c-brand-1);
}
.ds-cta-install-text {
  font-family: var(--vp-font-family-mono);
  font-size: 13.5px;
  color: var(--ea-text-1);
  letter-spacing: -0.01em;
}
.ds-cta-install-prompt {
  color: var(--ea-text-3);
  margin-right: 4px;
}
.ds-cta-install-copy {
  color: var(--ea-text-3);
  display: flex;
  transition: color 0.2s;
}
.ds-cta-install-copy.copied {
  color: var(--vp-c-brand-1);
}

.ds-cta-buttons {
  display: flex;
  gap: 10px;
  margin-top: 20px;
  flex-wrap: wrap;
  justify-content: center;
}

.ds-cta-foot {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px dashed var(--ea-divider);
  width: 100%;
  max-width: 480px;
  font-size: 12px;
  color: var(--ea-text-3);
  letter-spacing: 0.02em;
}
.ds-cta-foot a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.ds-cta-foot a:hover {
  text-decoration: underline;
}

@media (max-width: 480px) {
  .ds-cta {
    padding: 40px 20px 32px;
  }
  .ds-cta-title {
    font-size: 28px;
  }
  .ds-cta-buttons {
    flex-direction: column;
    align-self: stretch;
    max-width: 280px;
    margin-left: auto;
    margin-right: auto;
  }
}

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
    padding: 72px 20px 56px;
  }
  .ds-hero-name {
    font-size: 36px;
  }
  .ds-hero-text {
    font-size: 22px;
  }
  .ds-hero-install {
    padding: 8px 14px;
    gap: 10px;
  }
  .ds-hero-install-text {
    font-size: 13px;
  }
  .ds-split-text .ea-section-title {
    font-size: 22px;
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
    padding: 56px 16px 40px;
  }
  .ds-hero-name {
    font-size: 28px;
  }
  .ds-hero-text {
    font-size: 19px;
  }
  .ds-hero-install-text {
    font-size: 12px;
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
