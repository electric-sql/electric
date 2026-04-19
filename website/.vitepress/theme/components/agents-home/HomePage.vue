<script setup lang="ts">
import { ref } from "vue"
import { VPButton } from "vitepress/theme"
import Section from "./Section.vue"
import EntityStreamDemo from "./EntityStreamDemo.vue"
import CrashRecoveryDemo from "./CrashRecoveryDemo.vue"
import CoordinationDemo from "./CoordinationDemo.vue"
import AgentGridDemo from "./AgentGridDemo.vue"
import ContextCompositionDemo from "./ContextCompositionDemo.vue"
import HeroNetworkBg from "./HeroNetworkBg.vue"
import SystemMonitorDemo from "./SystemMonitorDemo.vue"

const stackTab = ref<"server" | "entities">("server")
const heroInnerRef = ref<HTMLElement>()

const installCopied = ref(false)
function copyInstall() {
  navigator.clipboard.writeText("npm i electric-agents")
  installCopied.value = true
  setTimeout(() => { installCopied.value = false }, 2000)
}
</script>

<template>
  <div class="ea-home">
    <!-- Section 1: Hero -->
    <section class="ea-hero">
      <HeroNetworkBg :exclude-el="heroInnerRef" />
      <div ref="heroInnerRef" class="ea-hero-inner">
        <h1 class="ea-hero-name">Electric <span class="ea-hero-underline">Agents</span></h1>
        <p class="ea-hero-text">
          Wire the agent loop into your online&nbsp;systems
        </p>
        <p class="ea-hero-tagline">
          Durable, composable, serverless agents — built on
          <a href="https://durablestreams.com" class="ea-hero-link">Durable&nbsp;Streams</a>,
          using your existing&nbsp;stack.
        </p>
        <div class="ea-hero-install" @click="copyInstall">
          <span class="ea-hero-install-text"><span class="ea-hero-install-prompt">$</span> npm i electric-agents</span>
          <span class="ea-hero-install-copy" :class="{ copied: installCopied }">
            <svg v-if="!installCopied" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
        </div>
      </div>
    </section>

    <!-- Section 1b: Agents need to come online -->
    <Section id="come-online" title="Agents need to come&nbsp;online">
      <div class="ea-come-online">
        <div class="ea-come-online-text">
          <p class="ea-prose">
            Today's agents live on your laptop or behind a chat window.
            But real work happens inside business systems — triggered by
            webhooks, pulling from queues, coordinating across services,
            running 24/7 without&nbsp;supervision.
          </p>
          <p class="ea-prose">
            To get there, agents need to be durable, addressable, and
            composable. They need to spawn sub-agents, survive restarts,
            and scale to zero when there's nothing to&nbsp;do.
          </p>
          <p class="ea-prose">
            <strong>Electric Agents brings the agent loop online.</strong>
            Every agent is backed by a durable stream. They sleep when idle,
            wake on demand, and plug straight into your existing&nbsp;infrastructure.
          </p>
        </div>
        <div class="ea-come-online-visual">
          <SystemMonitorDemo />
        </div>
      </div>
    </Section>

    <!-- Section 3: Entity + Stream -->
    <Section
      id="entity-stream"
      title="Every agent is an entity with a stream"
    >
      <div class="ea-entity-intro">
        <p>You define <strong>entity types</strong> — like <code>assistant</code> or <code>researcher</code> — then spawn instances on&nbsp;demand.</p>
        <p>Each instance is backed by its own <strong>durable stream</strong>: an append-only log that serves as the agent's memory, message inbox, and audit&nbsp;trail.</p>
      </div>
      <EntityStreamDemo />
    </Section>

    <!-- Section 4: Durable State -->
    <Section id="durable-state" :dark="true">
      <div class="ea-durable-layout">
        <div class="ea-durable-demo">
          <CrashRecoveryDemo />
        </div>
        <div class="ea-durable-text">
          <h2 class="ea-section-title">Durable state, not durable&nbsp;execution</h2>
          <p class="ea-section-subtitle">
            Your agent doesn't need to stay alive. It needs its state to survive.
            The stream is the source of truth.
          </p>
          <p class="ea-durable-detail">
            When a handler crashes or the process restarts, nothing is lost.
            The stream replays and the agent picks up exactly where it left off
            — no checkpointing, no snapshots, no coordination&nbsp;overhead.
          </p>
        </div>
      </div>
    </Section>

    <!-- Section 5: Coordination -->
    <Section
      id="coordination"
      title="Primitives for coordination"
      subtitle="Local agents compose through child processes. Electric Agents makes that pattern durable and&nbsp;serverless."
    >
      <CoordinationDemo />
    </Section>

    <!-- Section 6: Scale to Zero -->
    <Section id="scale-to-zero" :dark="true">
      <div class="ea-scale-layout">
        <div class="ea-scale-text">
          <h2 class="ea-section-title">Scale to zero. Wake on&nbsp;demand.</h2>
          <p class="ea-section-subtitle">
            Every entity costs nothing when idle. A thousand agents?
            You pay for the ones that are actually&nbsp;thinking.
          </p>
          <p class="ea-scale-detail">
            Entities sleep between invocations — no long-running processes,
            no idle VMs. When a message arrives, the handler wakes, replays
            from the stream, and picks up exactly where it left&nbsp;off.
          </p>
        </div>
        <div class="ea-scale-grid">
          <AgentGridDemo />
        </div>
      </div>
    </Section>

    <!-- Section 7: Context Composition -->
    <Section id="context">
      <div class="ea-context-layout">
        <div class="ea-context-demo">
          <ContextCompositionDemo />
        </div>
        <div class="ea-context-text">
          <h2 class="ea-section-title">Context composition — maximize cache&nbsp;hits</h2>
          <p class="ea-section-subtitle">
            Each context source declares how often it changes. The runtime orders them
            from most stable to most volatile, so the LLM can cache the prefix of
            every&nbsp;request.
          </p>
          <p class="ea-context-detail">
            Less re-processing, lower latency, lower cost.
          </p>
        </div>
      </div>
    </Section>

    <!-- Section 8: Your Stack -->
    <Section
      id="your-stack"
      title="Your stack, not ours"
      subtitle="Runs on your infrastructure. Express, Next.js, Hono, TanStack Start — agents are webhook handlers. No vendor&nbsp;lock-in."
      :dark="true"
    >
      <div class="ea-stack-layout">
        <div class="ea-stack-diagram">
          <div class="stack-box app-box">
            <div class="stack-label">Your App</div>
            <div class="stack-examples">Express · Next.js · Hono · Fastify</div>
          </div>
          <div class="stack-connector">
            <div class="stack-conn-line" />
            <span class="stack-conn-label">webhooks</span>
          </div>
          <div class="stack-box runtime-box">
            <div class="stack-label">Electric Agents Runtime</div>
            <div class="stack-examples">entities · handlers · context</div>
          </div>
          <div class="stack-connector">
            <div class="stack-conn-line" />
            <span class="stack-conn-label">HTTP streams</span>
          </div>
          <div class="stack-box streams-box">
            <div class="stack-label">Durable Streams</div>
            <div class="stack-examples">Electric Cloud or self-hosted</div>
          </div>
        </div>
        <div class="ea-stack-code">
          <div class="code-tabs">
            <button
              class="code-tab"
              :class="{ active: stackTab === 'server' }"
              @click="stackTab = 'server'"
            >server.ts</button>
            <button
              class="code-tab"
              :class="{ active: stackTab === 'entities' }"
              @click="stackTab = 'entities'"
            >entities.ts</button>
          </div>
          <pre v-show="stackTab === 'server'" class="code-block tabbed"><code><span class="tk-kw">import</span> { <span class="tk-v">createRuntimeHandler</span> } <span class="tk-kw">from</span> <span class="tk-str">"electric-agents"</span>
<span class="tk-kw">import</span> { <span class="tk-v">registry</span> } <span class="tk-kw">from</span> <span class="tk-str">"./entities"</span>

<span class="tk-kw">const</span> <span class="tk-v">runtime</span> = <span class="tk-fn">createRuntimeHandler</span>({
  <span class="tk-prop">baseUrl</span>: <span class="tk-v">STREAMS_URL</span>,
  <span class="tk-prop">serveEndpoint</span>: <span class="tk-v">WEBHOOK_URL</span>,
  <span class="tk-prop">registry</span>,
})

<span class="tk-v">app</span>.<span class="tk-fn">post</span>(<span class="tk-str">"/webhook"</span>, (<span class="tk-v">req</span>, <span class="tk-v">res</span>) <span class="tk-kw">=></span> {
  <span class="tk-kw">await</span> <span class="tk-v">runtime</span>.<span class="tk-fn">onEnter</span>(<span class="tk-v">req</span>, <span class="tk-v">res</span>)
})

<span class="tk-v">app</span>.<span class="tk-fn">listen</span>(<span class="tk-v">PORT</span>, () <span class="tk-kw">=></span> <span class="tk-v">runtime</span>.<span class="tk-fn">registerTypes</span>())</code></pre>
          <pre v-show="stackTab === 'entities'" class="code-block tabbed"><code><span class="tk-kw">import</span> { <span class="tk-v">createEntityRegistry</span> } <span class="tk-kw">from</span> <span class="tk-str">"electric-agents"</span>

<span class="tk-kw">export const</span> <span class="tk-v">registry</span> = <span class="tk-fn">createEntityRegistry</span>()

<span class="tk-v">registry</span>.<span class="tk-fn">define</span>(<span class="tk-str">"assistant"</span>, {
  <span class="tk-prop">description</span>: <span class="tk-str">"A general-purpose AI assistant"</span>,
  <span class="tk-kw">async</span> <span class="tk-fn">handler</span>(<span class="tk-v">ctx</span>) {
    <span class="tk-v">ctx</span>.<span class="tk-fn">useAgent</span>({
      <span class="tk-prop">systemPrompt</span>: <span class="tk-str">"You are a helpful assistant."</span>,
      <span class="tk-prop">model</span>: <span class="tk-str">"claude-sonnet-4-5-20250929"</span>,
      <span class="tk-prop">tools</span>: [...<span class="tk-v">ctx</span>.<span class="tk-v">darixTools</span>],
    })
    <span class="tk-kw">await</span> <span class="tk-v">ctx</span>.<span class="tk-v">agent</span>.<span class="tk-fn">run</span>()
  },
})</code></pre>
        </div>
      </div>
    </Section>

    <!-- Section 9: First Agent -->
    <Section
      id="first-agent"
      title="Your first agent in 10 lines"
      subtitle="Define an entity type. Write a handler. Deploy."
    >
      <div class="ea-first-agent">
        <div class="ea-annotated-code">
          <div class="ea-left-col">
            <div class="ea-code-panel">
              <div class="code-file-header">agent.ts</div>
              <pre class="code-block annotated"><code><span class="tk-kw">import</span> { <span class="tk-v">createEntityRegistry</span> } <span class="tk-kw">from</span> <span class="tk-str">"electric-agents"</span>

<span class="tk-kw">const</span> <span class="tk-v">registry</span> = <span class="tk-fn">createEntityRegistry</span>()<span class="ann-marker" data-n="1"></span>

<span class="tk-v">registry</span>.<span class="tk-fn">define</span>(<span class="tk-str">"assistant"</span>, {<span class="ann-marker" data-n="2"></span>
  <span class="tk-prop">description</span>: <span class="tk-str">"A helpful AI assistant"</span>,

  <span class="tk-kw">async</span> <span class="tk-fn">handler</span>(<span class="tk-v">ctx</span>) {<span class="ann-marker" data-n="3"></span>
    <span class="tk-v">ctx</span>.<span class="tk-fn">useAgent</span>({
      <span class="tk-prop">model</span>: <span class="tk-str">"claude-sonnet-4-5-20250929"</span>,
      <span class="tk-prop">systemPrompt</span>: <span class="tk-str">"You are a helpful assistant."</span>,
      <span class="tk-prop">tools</span>: [...<span class="tk-v">ctx</span>.<span class="tk-v">darixTools</span>],<span class="ann-marker" data-n="4"></span>
    })

    <span class="tk-kw">await</span> <span class="tk-v">ctx</span>.<span class="tk-v">agent</span>.<span class="tk-fn">run</span>()<span class="ann-marker" data-n="5"></span>
  },
})</code></pre>
            </div>
            <div class="ea-cli-panel">
              <div class="cli-header">Terminal</div>
              <div class="cli-body">
                <div class="cli-line"><span class="cli-prompt">$</span> electric-agents spawn assistant my-agent<span class="ann-marker" data-n="6"></span></div>
                <div class="cli-output">✓ Spawned /assistant/my-agent</div>
                <div class="cli-line"><span class="cli-prompt">$</span> electric-agents send /assistant/my-agent "..."<span class="ann-marker" data-n="7"></span></div>
                <div class="cli-output">✓ Message sent — entity woke, handling...</div>
                <div class="cli-line"><span class="cli-prompt">$</span> electric-agents observe /assistant/my-agent<span class="ann-marker" data-n="8"></span></div>
                <div class="cli-output">← text: "The capital of France is Paris."</div>
              </div>
            </div>
          </div>
          <div class="ea-right-col">
            <div class="ea-annotations">
              <div class="ea-ann-item">
              <span class="ea-ann-num">1</span>
              <div>
                <strong>Create a registry</strong>
                  <p>The registry holds your entity definitions and wires them to durable streams.</p>
                </div>
              </div>
              <div class="ea-ann-item">
              <span class="ea-ann-num">2</span>
              <div>
                <strong>Name your entity type</strong>
                  <p>Instances are spawned as <code>/assistant/my-agent</code>, <code>/assistant/support-bot</code>, etc.</p>
                </div>
              </div>
              <div class="ea-ann-item">
              <span class="ea-ann-num">3</span>
              <div>
                <strong>Write a handler</strong>
                  <p><code>ctx</code> gives you the stream, tools, and coordination primitives.</p>
                </div>
              </div>
              <div class="ea-ann-item">
              <span class="ea-ann-num">4</span>
              <div>
                <strong>Bring your own tools</strong>
                <p><code>darixTools</code> provides <code>spawn</code>, <code>send</code>, <code>observe</code>. Add your own MCP tools, APIs, anything.</p>
                </div>
              </div>
              <div class="ea-ann-item">
              <span class="ea-ann-num">5</span>
              <div>
                <strong>Run the agent loop</strong>
                  <p>Reads the stream, calls the LLM, appends events, sleeps. Crashes replay automatically.</p>
                </div>
              </div>
              <div class="ea-ann-item">
              <span class="ea-ann-num">6</span>
              <div>
                <strong>Spawn an instance</strong>
                  <p>Creates a new entity of the given type with a unique ID. Its durable stream starts here.</p>
                </div>
              </div>
              <div class="ea-ann-item">
              <span class="ea-ann-num">7</span>
              <div>
                <strong>Send a message</strong>
                  <p>Delivers a message to the entity's stream, waking it to run its handler.</p>
                </div>
              </div>
              <div class="ea-ann-item">
              <span class="ea-ann-num">8</span>
              <div>
                <strong>Observe in real time</strong>
                  <p>Stream events as they're appended — see the agent think, call tools, and respond.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="ea-first-agent-cta">
          <VPButton
            tag="a"
            size="medium"
            theme="brand"
            text="Get Started"
            href="/docs/agents/quickstart"
          />
          <VPButton
            tag="a"
            size="medium"
            theme="alt"
            text="Read the Docs"
            href="/docs/agents/"
          />
        </div>
      </div>
    </Section>

  </div>
</template>

<style scoped>
.ea-home {
  overflow-x: hidden;
  max-width: 100vw;
}

/* ── Hero ──────────────────────────────────────────────────────────── */

.ea-hero {
  position: relative;
  padding: 100px 24px 80px;
  text-align: center;
  overflow: hidden;
}

.ea-hero-inner {
  position: relative;
  z-index: 1;
  max-width: 860px;
  margin: 0 auto;
  pointer-events: none;
}
.ea-hero-inner * {
  pointer-events: auto;
}

.ea-hero-name {
  font-size: 56px;
  font-weight: 800;
  line-height: 1.2;
  background: var(--vp-home-hero-name-background);
  -webkit-background-clip: text;
  background-clip: text;
  color: var(--vp-home-hero-name-color);
  margin: 0;
  padding-bottom: 4px;
}

.ea-hero-underline {
  text-decoration: underline;
  text-decoration-color: var(--vp-c-brand-1);
  text-underline-offset: 0.1em;
  text-decoration-thickness: 0.135em;
}

.ea-hero-text {
  font-size: 22px;
  font-weight: 500;
  color: var(--ea-text-1);
  margin: 20px 0 0;
  line-height: 1.4;
}

.ea-hero-tagline {
  font-family: var(--vp-font-family-base);
  font-size: 17px;
  color: var(--ea-text-2);
  margin: 12px auto 0;
  max-width: 540px;
  line-height: 1.6;
}

.ea-hero-link {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: color-mix(in srgb, var(--vp-c-brand-1) 40%, transparent);
  transition: text-decoration-color 0.2s;
}

.ea-hero-link:hover {
  text-decoration-color: var(--vp-c-brand-1);
}

.ea-hero-install {
  margin-top: 32px;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  margin-top: 28px;
  padding: 10px 16px;
  background: var(--ea-surface-alt);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s;
  user-select: none;
}
.ea-hero-install:hover {
  border-color: var(--vp-c-brand-1);
}
.ea-hero-install-text {
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  color: var(--ea-text-1);
  letter-spacing: -0.01em;
}
.ea-hero-install-prompt {
  color: var(--ea-text-2);
  margin-right: 6px;
}
.ea-hero-install-copy {
  color: var(--ea-text-2);
  display: flex;
  transition: color 0.2s;
}
.ea-hero-install-copy.copied {
  color: var(--vp-c-brand-1);
}

.ea-hero-credibility {
  font-family: var(--vp-font-family-base);
  font-size: 14px;
  color: var(--ea-text-2);
  margin-top: 28px;
}

.ea-hero-credibility a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.ea-hero-credibility a:hover {
  text-decoration: underline;
}

.ea-problem-prose .ea-section-title {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--ea-text-1);
  margin: 0 0 24px;
}

/* ── Prose ──────────────────────────────────────────────────────────── */

.ea-prose {
  font-family: var(--vp-font-family-base);
  font-size: 17px;
  line-height: 1.7;
  text-wrap: pretty;
  color: var(--ea-text-1);
  margin: 0 0 16px;
  max-width: 640px;
}

.ea-entity-intro {
  max-width: 640px;
  margin-top: -24px;
  margin-bottom: 32px;
}

.ea-entity-intro p {
  font-family: var(--vp-font-family-base);
  font-size: 17px;
  text-wrap: pretty;
  line-height: 1.7;
  color: var(--ea-text-2);
  margin: 0 0 8px;
}

.ea-entity-intro p:last-child {
  margin-bottom: 0;
}

.ea-entity-intro strong {
  color: var(--ea-text-1);
}

.ea-entity-intro code {
  font-family: var(--vp-font-family-mono);
  font-size: 15px;
  background: var(--ea-surface-alt);
  padding: 2px 6px;
  border-radius: 4px;
}

/* ── Problem compare ─────────────────────────────────────────────── */

.ea-problem {
  display: flex;
  gap: 56px;
  align-items: flex-start;
}

.ea-problem-prose {
  flex: 1;
  min-width: 0;
}

.ea-problem-prose .ea-prose:last-child {
  margin-bottom: 0;
}

.ea-problem-compare {
  flex: 0 0 560px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
}

.ea-compare-top {
  display: flex;
  gap: 12px;
  align-items: stretch;
}

.ea-compare-top > .ea-problem-card {
  flex: 1 1 0;
  min-width: 0;
}

.ea-compare-plus {
  display: flex;
  align-items: center;
  font-size: 20px;
  font-weight: 300;
  color: var(--ea-text-2);
  padding: 0 4px;
}

.ea-compare-arrow {
  display: flex;
  justify-content: center;
  align-self: center;
  color: var(--vp-c-brand-1);
  padding: 8px 0;
}

.ea-problem-card {
  padding: 16px 20px;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
}

.ea-problem-card.muted {
  opacity: 0.75;
}

.ea-problem-card h3 {
  font-size: 14px;
  font-weight: 700;
  color: var(--ea-text-1);
  margin: 0 0 2px;
}

.ea-problem-examples {
  font-size: 11px;
  color: var(--ea-text-2);
  margin: 0 0 10px;
}

.ea-problem-card.solution {
  border-color: var(--vp-c-brand-1);
  background: color-mix(in srgb, var(--vp-c-brand-1) 6%, var(--ea-surface));
  width: 100%;
}

.ea-problem-card.solution h3 {
  color: var(--vp-c-brand-1);
  font-size: 16px;
}

.ea-problem-card.solution .ea-problem-examples {
  font-size: 12px;
}

.ea-check-list.solution-list {
  columns: 2;
  column-gap: 24px;
}

.ea-check-list.solution-list li {
  break-inside: avoid;
}

/* Check list */
.ea-check-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.ea-check-list li {
  font-size: 13px;
  line-height: 1.8;
  color: var(--ea-text-1);
  padding-left: 22px;
  position: relative;
}

.ea-check-list li.yes::before {
  content: "✓";
  position: absolute;
  left: 0;
  color: var(--ea-event-tool-result);
  font-weight: 600;
}

.ea-check-list li.no::before {
  content: "✗";
  position: absolute;
  left: 0;
  color: var(--ea-event-error);
  font-weight: 600;
}

/* ── Section 4: Durable State ─────────────────────────────────────── */

.ea-durable-layout {
  display: flex;
  gap: 48px;
  align-items: flex-start;
}

.ea-durable-demo {
  flex: 1;
  min-width: 0;
}

.ea-durable-text {
  flex: 1;
  min-width: 0;
}

.ea-durable-text .ea-section-title {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--ea-text-1);
  margin: 0;
}

.ea-durable-text .ea-section-subtitle {
  font-size: 17px;
  line-height: 1.6;
  color: var(--ea-text-2);
  text-wrap: pretty;
  margin: 12px 0 0;
}

.ea-durable-detail {
  font-size: 15px;
  line-height: 1.6;
  color: var(--ea-text-2);
  margin: 20px 0 0;
  opacity: 0.8;
}

/* ── Section 6: Scale to Zero ─────────────────────────────────────── */

.ea-scale-layout {
  display: flex;
  gap: 48px;
  align-items: flex-start;
}

.ea-scale-text {
  flex: 1;
  min-width: 0;
}

.ea-scale-text .ea-section-title {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--ea-text-1);
  margin: 0;
}

.ea-scale-text .ea-section-subtitle {
  font-size: 17px;
  line-height: 1.6;
  color: var(--ea-text-2);
  text-wrap: pretty;
  margin: 12px 0 0;
}

.ea-scale-detail {
  font-size: 15px;
  line-height: 1.6;
  color: var(--ea-text-2);
  margin: 20px 0 0;
  opacity: 0.8;
}

.ea-scale-grid {
  flex: 0 0 auto;
  padding-top: 6px;
}

/* ── Section 7: Context Composition ──────────────────────────────── */

.ea-context-layout {
  display: flex;
  gap: 48px;
  align-items: flex-start;
}

.ea-context-text {
  flex: 1;
  min-width: 0;
}

.ea-context-text .ea-section-title {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--ea-text-1);
  margin: 0;
}

.ea-context-text .ea-section-subtitle {
  font-size: 17px;
  line-height: 1.6;
  color: var(--ea-text-2);
  text-wrap: pretty;
  margin: 12px 0 0;
}

.ea-context-detail {
  font-size: 15px;
  line-height: 1.6;
  color: var(--ea-text-2);
  margin: 20px 0 0;
  opacity: 0.8;
}

.ea-context-demo {
  flex: 1;
  min-width: 0;
  max-width: 50%;
}

/* ── Section 8: Stack ─────────────────────────────────────────────── */

.ea-stack-layout {
  display: flex;
  gap: 40px;
  align-items: flex-start;
}

.ea-stack-diagram {
  flex: 0 0 280px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stack-box {
  width: 100%;
  padding: 20px;
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  background: var(--ea-surface);
  text-align: center;
}

.stack-label {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--ea-text-1);
}

.stack-examples {
  font-size: 12px;
  color: var(--ea-text-2);
  margin-top: 4px;
}

.runtime-box {
  border-color: var(--vp-c-brand-1);
}

.runtime-box .stack-label {
  color: var(--vp-c-brand-1);
}

.streams-box {
  border-style: dashed;
}

.stack-connector {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 0;
}

.stack-conn-line {
  width: 2px;
  height: 20px;
  background: var(--ea-divider);
}

.stack-conn-label {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--ea-text-2);
  margin-top: 2px;
}

.ea-stack-code {
  flex: 1;
  min-width: 0;
}

/* ── Code tabs ────────────────────────────────────────────────────── */

.code-tabs {
  display: flex;
  background: var(--ea-surface-alt);
  border: 1px solid var(--ea-divider);
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  overflow: hidden;
}

/* Dark mode: invert chrome — header bar sits *above* the code body. */
.dark .code-tabs,
.dark .code-file-header {
  background: var(--ea-surface);
}
.dark .code-tab.active {
  background: var(--ea-surface-alt);
}
.dark .code-block {
  background: var(--ea-surface-alt);
}

.code-tab {
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

.code-tab:last-child {
  border-right: none;
}

.code-tab:hover {
  color: var(--ea-text-1);
}

.code-tab.active {
  color: var(--ea-text-1);
  background: var(--ea-surface);
}

.code-block.tabbed {
  border-radius: 0 0 8px 8px;
}

/* ── Shared code blocks ───────────────────────────────────────────── */

.code-file-header {
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

.code-block {
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

.code-block :deep(.tk-kw) {
  color: var(--vp-c-brand-1);
}
.code-block :deep(.tk-fn) {
  color: var(--ea-event-message);
}
.code-block :deep(.tk-str) {
  color: var(--ea-event-tool-result);
}
.code-block :deep(.tk-prop) {
  color: var(--ea-event-tool-call);
}
.code-block :deep(.tk-v) {
  color: var(--ea-text-1);
}

/* ── Section 9: First Agent ───────────────────────────────────────── */

.ea-annotated-code {
  display: flex;
  gap: 32px;
  align-items: flex-start;
}

.ea-left-col {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ea-right-col {
  flex: 0 0 320px;
  padding-top: 44px;
}

.code-block.annotated {
  padding-left: 20px;
}

.ann-marker {
  display: none;
}

.ann-marker[data-n]::after {
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

.ann-marker[data-n] {
  display: inline;
}

:root:not(.dark) .ea-cli-panel .ann-marker[data-n]::after {
  background: var(--ea-surface);
  color: var(--ea-text-1);
}

.ea-annotations {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ea-ann-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.ea-ann-num {
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

.ea-ann-item strong {
  display: block;
  font-size: 13.5px;
  color: var(--ea-text-1);
  margin-bottom: 3px;
}

.ea-ann-item p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--ea-text-2);
}

.ea-ann-item code {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  background: var(--ea-surface-alt);
  padding: 1px 5px;
  border-radius: 3px;
}

.ea-cli-panel {
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--ea-divider);
  margin-bottom: 0;
}

.cli-header {
  padding: 10px 16px;
  background: var(--ea-surface);
  border-bottom: 1px solid var(--ea-divider);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--ea-text-2);
}

.cli-body {
  padding: 16px 20px;
  background: var(--ea-bg);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.8;
}

.cli-line {
  color: var(--ea-text-1);
}

.cli-prompt {
  color: var(--vp-c-brand-1);
  margin-right: 8px;
}

.cli-output {
  color: var(--ea-text-2);
  padding-left: 20px;
  margin-bottom: 8px;
}

.cli-output:last-child {
  margin-bottom: 0;
}

.ea-first-agent-cta {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 40px;
}

/* --- Agents need to come online --- */
:deep(#come-online .ea-section-header) {
  margin-bottom: 12px;
}
.ea-come-online {
  display: flex;
  gap: 56px;
  align-items: flex-start;
}
.ea-come-online-text {
  flex: 1;
  min-width: 0;
  padding-top: 12px;
}
.ea-come-online-visual {
  flex: 1;
  min-width: 0;
  max-width: 520px;
}
@media (max-width: 768px) {
  .ea-come-online {
    flex-direction: column;
    gap: 28px;
  }
  .ea-come-online-visual {
    width: 100%;
    max-width: 100%;
  }
}

/* ── Responsive ────────────────────────────────────────────────────── */

@media (max-width: 768px) {
  .ea-hero {
    padding: 72px 20px 56px;
  }
  .ea-hero-name {
    font-size: 36px;
  }
  .ea-hero-text {
    font-size: 18px;
  }
  .ea-hero-tagline {
    font-size: 15px;
  }
  .ea-hero-install {
    padding: 8px 14px;
    gap: 10px;
  }
  .ea-hero-install-text {
    font-size: 13px;
  }
  .ea-problem {
    flex-direction: column;
    gap: 32px;
  }
  .ea-problem-compare {
    flex: none;
    width: 100%;
  }
  .ea-compare-top {
    flex-direction: column;
    gap: 8px;
  }
  .ea-compare-plus {
    justify-content: center;
  }
  .ea-check-list.solution-list {
    columns: 1;
  }
  .ea-durable-layout {
    flex-direction: column;
    gap: 32px;
  }
  .ea-durable-demo {
    width: 100%;
    flex: none;
  }
  .ea-context-layout {
    flex-direction: column;
    gap: 24px;
  }
  .ea-context-text {
    flex: none;
    width: 100%;
  }
  .ea-context-demo {
    max-width: 100%;
    width: 100%;
  }
  .ea-scale-layout {
    flex-direction: column;
    gap: 32px;
  }
  .ea-scale-grid {
    width: 100%;
    display: flex;
    justify-content: center;
  }
  .ea-stack-layout {
    flex-direction: column;
  }
  .ea-stack-diagram {
    flex: none;
    width: 100%;
  }
  .ea-stack-code {
    width: 100%;
  }
  .ea-annotated-code {
    flex-direction: column;
  }
  .ea-left-col,
  .ea-right-col {
    flex: none;
    width: 100%;
    padding-top: 0;
  }
  .ea-entity-intro {
    max-width: 100%;
  }
  .ea-prose {
    max-width: 100%;
  }
  .ea-problem-prose .ea-section-title {
    font-size: 22px;
  }
  .ea-durable-text .ea-section-title,
  .ea-scale-text .ea-section-title {
    font-size: 22px;
  }
  .code-block {
    font-size: 12px;
    padding: 12px 14px;
  }
  .cli-body {
    font-size: 12px;
    padding: 12px 14px;
  }
  .cli-output {
    padding-left: 16px;
  }
  .ea-first-agent-cta {
    flex-direction: column;
    align-items: center;
  }
}

@media (max-width: 480px) {
  .ea-hero {
    padding: 56px 16px 40px;
  }
  .ea-hero-name {
    font-size: 28px;
  }
  .ea-hero-text {
    font-size: 16px;
  }
  .ea-hero-tagline {
    font-size: 14px;
  }
  .ea-hero-credibility {
    font-size: 12px;
  }
  .ea-hero-install-text {
    font-size: 12px;
  }
  .code-block {
    font-size: 11px;
    padding: 10px 12px;
    line-height: 1.6;
  }
  .cli-body {
    font-size: 11px;
    padding: 10px 12px;
  }
  .code-file-header,
  .code-tab,
  .cli-header {
    font-size: 11px;
    padding: 8px 12px;
  }
  .ann-marker[data-n]::after {
    width: 16px;
    height: 16px;
    font-size: 9px;
    margin-left: 6px;
  }
  .ea-ann-num {
    width: 20px;
    height: 20px;
    font-size: 11px;
  }
  .ea-ann-item strong {
    font-size: 12px;
  }
  .ea-ann-item p {
    font-size: 12px;
  }
}
</style>
