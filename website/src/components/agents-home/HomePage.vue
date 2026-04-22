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
  navigator.clipboard.writeText("npx electric-ax agents quickstart")
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
        <h1 class="ea-hero-name">Electric&nbsp;<span class="ea-hero-accent">Agents</span></h1>
        <p class="ea-hero-text">
          The runtime for long-lived&nbsp;agents
        </p>
        <div class="ea-hero-install-row">
          <div class="ea-hero-install" @click="copyInstall">
            <span class="ea-hero-install-text"><span class="ea-hero-install-prompt">$</span> npx electric-ax agents quickstart</span>
            <span class="ea-hero-install-copy" :class="{ copied: installCopied }">
              <svg v-if="!installCopied" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
          </div>
        </div>

        <div class="ea-hero-row">
          <VPButton
            tag="a"
            size="medium"
            theme="brand"
            text="Quickstart"
            href="/docs/agents/quickstart"
          />
          <VPButton
            tag="a"
            size="medium"
            theme="alt"
            text="Docs"
            href="/docs/agents"
          />
        </div>
      </div>
    </section>

    <!-- Section 1b: Agents need to come online -->
    <Section id="come-online">
      <div class="ea-come-online">
        <div class="ea-come-online-text">
          <h2 class="ea-section-title">Bring the agent loop&nbsp;online</h2>
          <p class="ea-prose">
            Today's agents live on your laptop or behind a chat window.
            <strong>Real work happens inside business&nbsp;systems</strong> —
            triggered by webhooks, running 24/7 without&nbsp;supervision.
          </p>
          <p class="ea-prose">
            Electric Agents brings durable, composable, serverless agents
            to the infrastructure you already run. Built on
            <a href="https://durablestreams.com">Durable&nbsp;Streams</a>,
            every agent sleeps when idle, wakes on demand and
            survives&nbsp;restarts.
          </p>
        </div>
        <div class="ea-come-online-visual">
          <SystemMonitorDemo />
        </div>
      </div>
    </Section>

    <!-- Section 2: Inside the runtime -->
    <Section id="inside-runtime" :dark="true">
      <div class="ea-runtime">
        <div class="ea-runtime-diagram" aria-hidden="true">
          <div class="rt-box rt-box-app">
            <div class="stack-label">Framework</div>
            <div class="stack-examples">Lives in your app process</div>
            <div class="rt-code-card">
              <div class="code-file-header">agent.ts</div>
              <pre class="code-block"><code><span class="tk-kw">import</span> { <span class="tk-fn">defineEntity</span> } <span class="tk-kw">from</span> <span class="tk-str">"electric-agents"</span>

<span class="tk-fn">defineEntity</span>(<span class="tk-str">"assistant"</span>, {
  <span class="tk-prop">state</span>: { … },
  <span class="tk-kw">async</span> <span class="tk-fn">handler</span>(<span class="tk-v">ctx</span>) {
    <span class="tk-v">ctx</span>.<span class="tk-fn">useAgent</span>({ … })
    <span class="tk-kw">await</span> <span class="tk-v">ctx</span>.<span class="tk-v">agent</span>.<span class="tk-fn">run</span>()
  },
})</code></pre>
            </div>
          </div>

          <div class="rt-conn">
            <div class="rt-conn-arrow" aria-hidden="true">
              <svg viewBox="0 0 56 12" xmlns="http://www.w3.org/2000/svg">
                <line x1="8" y1="6" x2="48" y2="6" stroke="currentColor" stroke-width="1" />
                <polyline points="12,2 8,6 12,10" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" />
                <polyline points="44,2 48,6 44,10" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </div>
            <ul class="rt-conn-labels mono">
              <li>wake</li>
              <li>register</li>
              <li>ack</li>
            </ul>
          </div>

          <div class="rt-box rt-box-server">
            <div class="stack-label">Server</div>
            <div class="stack-examples">lifecycle · routing · scheduler</div>
            <div class="rt-subsection">
              <div class="rt-sublabel mono">Agents</div>
              <div class="rt-instances">
                <div class="rt-instance"><span class="rt-dot live" />/assistant/r-1</div>
                <div class="rt-instance"><span class="rt-dot idle" />/assistant/r-2</div>
                <div class="rt-instance"><span class="rt-dot live" />/coder/refactor</div>
                <div class="rt-instance"><span class="rt-dot idle" />/researcher/x</div>
              </div>
            </div>
            <div class="rt-streams">
              <div class="rt-sublabel mono">Durable Streams</div>
              <div class="rt-streams-lines">
                <span class="rt-stream-line" />
                <span class="rt-stream-line" />
                <span class="rt-stream-line" />
              </div>
            </div>
          </div>
        </div>

        <div class="ea-runtime-text">
          <h2 class="ea-section-title">Inside the&nbsp;runtime</h2>
          <p class="ea-prose">Electric Agents is two pieces:</p>
          <ul class="ea-runtime-list">
            <li>
              A <strong>framework</strong> in your app, where you define
              entities and write handlers in plain TypeScript. Runs in
              your process, so your tools, models, and secrets
              stay&nbsp;yours.
            </li>
            <li>
              A <strong>server</strong> that runs, routes wakes, and
              persists every agent to its own durable stream. Owns the
              lifecycle, so your handlers don't need to stay alive
              between invocations.
            </li>
          </ul>
        </div>
      </div>
    </Section>

    <!-- Section 3: Entity + Stream -->
    <Section
      id="entity-stream"
      title="Every agent is an entity with a&nbsp;stream"
    >
      <div class="ea-entity-intro">
        <p>You define <strong>entity types</strong> — like <code>assistant</code> or <code>researcher</code> — then spawn instances on&nbsp;demand.</p>
        <p>Each instance is backed by its own <strong>durable stream</strong>: an append-only log that serves as the agent's memory, its inbox, and a complete audit trail of everything it&nbsp;did.</p>
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
            — no checkpointing, no snapshots, no&nbsp;coordination.
          </p>
        </div>
      </div>
    </Section>

    <!-- Section 5: Coordination -->
    <Section
      id="coordination"
      title="Primitives for&nbsp;coordination"
      subtitle="Local agents compose through child processes. Electric Agents makes that pattern durable, observable, and&nbsp;serverless."
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
            from the stream, and&nbsp;continues.
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
          <h2 class="ea-section-title">Cache-friendly context, by&nbsp;construction</h2>
          <p class="ea-section-subtitle">
            Each context source declares how often it changes. The runtime
            orders sources from most stable to most volatile, so the LLM can
            cache the shared prefix across every&nbsp;request.
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
      title="Your stack, not&nbsp;ours"
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
            <div class="stack-label">Electric Agents</div>
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
      <span class="tk-prop">tools</span>: [...<span class="tk-v">ctx</span>.<span class="tk-v">agentTools</span>],
    })
    <span class="tk-kw">await</span> <span class="tk-v">ctx</span>.<span class="tk-v">agent</span>.<span class="tk-fn">run</span>()
  },
})</code></pre>
        </div>
      </div>
    </Section>

    <!-- Section 8b: Three ways in -->
    <Section
      id="three-ways"
      title="Three ways&nbsp;in"
      subtitle="Once your handlers are registered, talk to the runtime however you&nbsp;prefer."
    >
      <div class="ea-ways">
        <div class="ea-way">
          <div class="ea-way-header">
            <span class="ea-way-eyebrow mono">CLI</span>
            <h3 class="ea-way-title">From the&nbsp;terminal</h3>
          </div>
          <p class="ea-way-prose">
            Spawn entities, send messages, list what's running, and tail an
            entity's stream live — with reasoning, tool calls, and text rendered
            inline.
          </p>
          <div class="ea-way-preview cli-preview">
            <div class="cli-header">Terminal</div>
            <div class="cli-body">
              <div class="cli-line"><span class="cli-prompt">$</span> electric-agents spawn /assistant/research-1</div>
              <div class="cli-output">✓ Spawned /assistant/research-1</div>
              <div class="cli-line"><span class="cli-prompt">$</span> electric-agents send /assistant/research-1 "summarise the docs"</div>
              <div class="cli-output">→ message delivered, entity woke</div>
              <div class="cli-line"><span class="cli-prompt">$</span> electric-agents observe /assistant/research-1</div>
              <div class="cli-output">← reasoning · tool_call(read_file) · text…</div>
            </div>
          </div>
        </div>

        <div class="ea-way">
          <div class="ea-way-header">
            <span class="ea-way-eyebrow mono">Desktop app</span>
            <h3 class="ea-way-title">Observe and&nbsp;chat</h3>
          </div>
          <p class="ea-way-prose">
            Browse running entities, watch their timelines update in real time,
            inspect tool calls, and send follow-up messages — all from a
            cross-platform desktop&nbsp;app.
          </p>
          <div class="ea-way-preview app-preview" role="img" aria-label="Desktop app preview">
            <div class="app-chrome">
              <span class="app-dot" />
              <span class="app-dot" />
              <span class="app-dot" />
            </div>
            <div class="app-body">
              <div class="app-sidebar">
                <div class="app-sidebar-row active"><span class="status-dot live" /> assistant/research-1</div>
                <div class="app-sidebar-row"><span class="status-dot idle" /> assistant/support-bot</div>
                <div class="app-sidebar-row"><span class="status-dot idle" /> researcher/r-2</div>
                <div class="app-sidebar-row"><span class="status-dot live" /> coder/refactor</div>
              </div>
              <div class="app-main">
                <div class="app-msg user">summarise the docs</div>
                <div class="app-msg agent">
                  <div class="app-msg-tool mono">↳ read_file("docs/intro.md")</div>
                  <div class="app-msg-text">The docs cover three primary surfaces…</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="ea-way">
          <div class="ea-way-header">
            <span class="ea-way-eyebrow mono">TypeScript</span>
            <h3 class="ea-way-title">From your&nbsp;app</h3>
          </div>
          <p class="ea-way-prose">
            Embed agent control directly in your code: spawn and send from any
            TypeScript service, and render an entity's live stream in React
            with the <code>useChat</code>&nbsp;hook.
          </p>
          <div class="ea-way-preview ts-preview">
            <div class="code-file-header">app.tsx</div>
            <pre class="code-block tabbed"><code><span class="tk-kw">import</span> { <span class="tk-v">createClient</span> } <span class="tk-kw">from</span> <span class="tk-str">"electric-agents"</span>
<span class="tk-kw">import</span> { <span class="tk-v">useChat</span> } <span class="tk-kw">from</span> <span class="tk-str">"electric-agents/react"</span>

<span class="tk-kw">const</span> <span class="tk-v">client</span> = <span class="tk-fn">createClient</span>({ <span class="tk-prop">baseUrl</span>: <span class="tk-v">RUNTIME_URL</span> })
<span class="tk-kw">await</span> <span class="tk-v">client</span>.<span class="tk-fn">spawn</span>(<span class="tk-str">"/assistant/research-1"</span>)

<span class="tk-kw">function</span> <span class="tk-fn">Chat</span>() {
  <span class="tk-kw">const</span> { <span class="tk-v">messages</span>, <span class="tk-v">send</span> } = <span class="tk-fn">useChat</span>(<span class="tk-str">"/assistant/research-1"</span>)
  <span class="tk-kw">return</span> &lt;<span class="tk-v">Timeline</span> <span class="tk-prop">messages</span>={<span class="tk-v">messages</span>} <span class="tk-prop">onSend</span>={<span class="tk-v">send</span>} /&gt;
}</code></pre>
          </div>
        </div>
      </div>
    </Section>

    <!-- Section 9: First Agent -->
    <Section
      id="first-agent"
      title="Your first agent, end to&nbsp;end"
      subtitle="Define an entity type. Write a handler.&nbsp;Deploy."
      :dark="true"
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
      <span class="tk-prop">tools</span>: [...<span class="tk-v">ctx</span>.<span class="tk-v">agentTools</span>],<span class="ann-marker" data-n="4"></span>
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
                <p><code>agentTools</code> provides <code>spawn</code>, <code>send</code> and <code>observe</code>. Add your own MCP tools, APIs, or whatever your handler needs.</p>
                </div>
              </div>
              <div class="ea-ann-item">
              <span class="ea-ann-num">5</span>
              <div>
                <strong>Run the agent loop</strong>
                  <p>Reads the stream, calls the LLM, appends events, then sleeps. Survives crashes by replaying from the stream.</p>
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
            text="Get started"
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

    <!-- Section 8: Get started CTA -->
    <Section id="get-started">
      <div class="ea-cta">
        <div class="ea-cta-eyebrow mono">
          <span class="dot"></span>
          Open source · Apache&nbsp;2.0 · built on Electric&nbsp;Streams
        </div>
        <h2 class="ea-cta-title">
          Bring your agents&nbsp;<span class="ea-cta-accent">online</span>.
        </h2>
        <p class="ea-cta-tagline">
          Install the SDK, define an entity, and ship a durable agent on top of
          your existing&nbsp;stack.
        </p>

        <button
          class="ea-cta-install"
          type="button"
          @click="copyInstall"
          :aria-label="installCopied ? 'Copied' : 'Copy install command'"
        >
          <span class="ea-cta-install-text">
            <span class="ea-cta-install-prompt">$</span>
            npx electric-ax agents quickstart
          </span>
          <span
            class="ea-cta-install-copy"
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

        <div class="ea-cta-buttons">
          <VPButton
            tag="a"
            size="medium"
            theme="brand"
            text="Quickstart"
            href="/docs/agents/quickstart"
          />
          <VPButton
            tag="a"
            size="medium"
            theme="alt"
            text="Read the Docs"
            href="/docs/agents/"
          />
          <VPButton
            tag="a"
            size="medium"
            theme="alt"
            text="GitHub"
            href="https://github.com/electric-sql/electric"
          />
        </div>

        <div class="ea-cta-foot mono">
          Or
          <a href="https://dashboard.electric-sql.cloud/">sign up for Electric Cloud</a>
          and skip the&nbsp;ops.
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
  /* Tightened from 100/80 to compensate for the second CTA row
     (install pill + action-button row) so the hero stays roughly the
     same overall height as before the split. */
  padding: 72px 24px 56px;
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

.ea-hero-accent {
  color: var(--vp-c-brand-1);
  -webkit-text-fill-color: currentColor;
}

.ea-hero-text {
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
.ea-hero-install-row {
  margin-top: 24px;
  display: flex;
  justify-content: center;
}

.ea-hero-row {
  margin-top: 14px;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.ea-hero-install {
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

/* Mobile: tighten hero padding and scale headline / tagline so the
   hero matches the streams / sync responsive rhythm. Without these the
   56px name overflows narrow viewports and the 100px top padding
   crowds the navbar on phones. */
@media (max-width: 768px) {
  .ea-hero {
    /* Bumped horizontal padding from 20 → 24 for more breathing room
       from the viewport edge on tablets / large phones. */
    padding: 56px 24px 40px;
  }
  .ea-hero-name {
    font-size: 36px;
  }
  .ea-hero-text {
    font-size: 22px;
  }
  .ea-hero-install {
    padding: 8px 14px;
    gap: 10px;
  }
  .ea-hero-install-text {
    font-size: 13px;
  }
}

@media (max-width: 480px) {
  .ea-hero {
    /* Bumped horizontal padding from 16 → 20 for breathing room. */
    padding: 44px 20px 32px;
  }
  .ea-hero-name {
    font-size: 28px;
  }
  .ea-hero-text {
    font-size: 19px;
  }
  .ea-hero-install-text {
    font-size: 12px;
  }
  /* Stack the action buttons full-width on the smallest screens so
     they don't wrap awkwardly underneath the install pill. */
  .ea-hero-row {
    flex-direction: column;
    align-items: stretch;
    max-width: 280px;
    margin-left: auto;
    margin-right: auto;
  }
}

.ea-problem-prose .ea-section-title {
  font-size: 28px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: var(--ea-text-1);
  margin: 0 0 24px;
  text-wrap: balance;
}

/* ── Prose ──────────────────────────────────────────────────────────── */
/* `.ea-prose` core typography (font, size, color, margin, max-width,
   mobile cascade, link styling) is defined globally in
   `.vitepress/theme/custom.css` under "Landing-page shared text styles"
   so the rules don't drift between Agents / Streams / Sync. Only
   page-specific overrides should live here. */

.ea-entity-intro {
  max-width: 640px;
  /* Pull the intro copy 24px closer to the section title on desktop —
     Section.vue's header has a 40px bottom margin which feels too loose
     when the body is short prose rather than a sub-heading + diagram.
     This is reset to 0 at the mobile breakpoints below where the header
     bottom margin is already tighter (28px / 24px) and any negative
     margin would collapse the gap to ~0. */
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
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: var(--ea-text-1);
  margin: 0;
  text-wrap: balance;
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
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: var(--ea-text-1);
  margin: 0;
  text-wrap: balance;
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
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: var(--ea-text-1);
  margin: 0;
  text-wrap: balance;
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

/* --- Get started CTA --- */
.ea-cta {
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
.ea-cta::before {
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
.ea-cta-eyebrow {
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
.ea-cta-eyebrow .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}
.ea-cta-title {
  font-size: 38px;
  /* Matches the 700 weight of the hero name so the CTA doesn't out-bold
     the page's H1. Was 800 which inverted the hierarchy. */
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.015em;
  color: var(--ea-text-1);
  margin: 0;
  max-width: 560px;
  text-wrap: balance;
}
.ea-cta-accent {
  background: var(--vp-home-hero-name-background);
  -webkit-background-clip: text;
  background-clip: text;
  color: var(--vp-home-hero-name-color);
}
.ea-cta-tagline {
  font-family: var(--vp-font-family-base);
  font-size: 16px;
  line-height: 1.6;
  color: var(--ea-text-2);
  margin: 14px auto 0;
  max-width: 460px;
}
.ea-cta-install {
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
.ea-cta-install:hover {
  border-color: var(--vp-c-brand-1);
}
.ea-cta-install-text {
  font-family: var(--vp-font-family-mono);
  font-size: 13.5px;
  color: var(--ea-text-1);
  letter-spacing: -0.01em;
}
.ea-cta-install-prompt {
  color: var(--ea-text-3);
  margin-right: 4px;
}
.ea-cta-install-copy {
  color: var(--ea-text-3);
  display: flex;
  transition: color 0.2s;
}
.ea-cta-install-copy.copied {
  color: var(--vp-c-brand-1);
}
.ea-cta-buttons {
  display: flex;
  gap: 10px;
  margin-top: 20px;
  flex-wrap: wrap;
  justify-content: center;
}
.ea-cta-foot {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px dashed var(--ea-divider);
  width: 100%;
  max-width: 480px;
  font-size: 12px;
  color: var(--ea-text-3);
  letter-spacing: 0.02em;
}
.ea-cta-foot a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.ea-cta-foot a:hover {
  text-decoration: underline;
}
@media (max-width: 480px) {
  .ea-cta {
    padding: 40px 20px 32px;
  }
  .ea-cta-title {
    font-size: 28px;
  }
  .ea-cta-buttons {
    flex-direction: column;
    align-self: stretch;
    max-width: 280px;
    margin-left: auto;
    margin-right: auto;
  }
}

/* --- Agents need to come online --- */
.ea-come-online {
  display: flex;
  gap: 56px;
  align-items: flex-start;
}
.ea-come-online-text {
  flex: 1;
  min-width: 0;
}
.ea-come-online-text .ea-section-title {
  font-size: 28px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: var(--ea-text-1);
  margin: 0 0 20px;
  text-wrap: balance;
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

/* --- Inside the runtime --- */
.ea-runtime {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 56px;
  align-items: flex-start;
}

.ea-runtime-text {
  min-width: 0;
}
.ea-runtime-text .ea-section-title {
  font-size: 28px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: var(--ea-text-1);
  margin: 0 0 20px;
  text-wrap: balance;
}
.ea-runtime-text .ea-prose + .ea-prose {
  margin-top: 14px;
}
.ea-runtime-list {
  list-style: none;
  margin: 10px 0 18px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ea-runtime-list li {
  position: relative;
  padding-left: 16px;
  color: var(--ea-text-2);
  font-size: 15px;
  line-height: 1.6;
}
.ea-runtime-list li::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0.65em;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}
.ea-runtime-list li strong {
  color: var(--ea-text-1);
}

/* Diagram: two boxes either side of a connector — same vocab as .stack-box */
.ea-runtime-diagram {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: stretch;
  min-width: 0;
}

.rt-box {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  background: var(--ea-surface);
  text-align: center;
  min-width: 0;
}

.rt-box .stack-label {
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--ea-text-1);
}
.rt-box .stack-examples {
  font-size: 12px;
  color: var(--ea-text-2);
  margin-top: -8px;
}

/* Code card inside the framework box */
.rt-code-card {
  text-align: left;
}
.rt-code-card .code-file-header {
  border-radius: 8px 8px 0 0;
}
.rt-code-card .code-block {
  font-size: 12.5px;
  line-height: 1.6;
  padding: 12px 14px;
  border-radius: 0 0 8px 8px;
}

/* Connector between boxes — bidirectional arrow with stacked labels */
.rt-conn {
  align-self: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
}
.rt-conn-arrow {
  color: var(--ea-text-3);
  line-height: 0;
}
.rt-conn-arrow svg {
  width: 56px;
  height: 12px;
  display: block;
}
.rt-conn-labels {
  list-style: none;
  margin: 0;
  padding: 0;
  text-align: center;
  font-size: 10.5px;
  line-height: 1.5;
  letter-spacing: 0.04em;
  color: var(--ea-text-3);
}
.rt-conn-labels li {
  margin: 0;
}

/* Server box internals */
.rt-subsection {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
}
.rt-sublabel {
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ea-text-3);
}
.rt-instances {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 8px;
  text-align: left;
}
.rt-instance {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  color: var(--ea-text-2);
  background: var(--ea-bg);
  border: 1px solid var(--ea-divider);
  border-radius: 6px;
}
.rt-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.rt-dot.live {
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--vp-c-brand-1) 18%, transparent);
}
.rt-dot.idle {
  background: var(--ea-text-3);
  opacity: 0.5;
}

.rt-streams {
  margin-top: auto;
  padding: 10px 12px;
  border: 1px solid var(--ea-divider);
  border-radius: 6px;
  background: var(--ea-bg);
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
}
.rt-streams .rt-sublabel {
  white-space: nowrap;
}
.rt-streams-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.rt-stream-line {
  display: block;
  height: 2px;
  border-radius: 2px;
  background: var(--ea-divider);
  opacity: 0.7;
}
.rt-stream-line:nth-child(2) { width: 86%; opacity: 0.5; }
.rt-stream-line:nth-child(3) { width: 92%; opacity: 0.4; }

@media (max-width: 1024px) {
  .ea-runtime {
    grid-template-columns: 1fr;
    gap: 36px;
  }
}
@media (max-width: 700px) {
  .ea-runtime-diagram {
    grid-template-columns: 1fr;
  }
  .rt-conn {
    justify-self: center;
    flex-direction: row;
    align-items: center;
    padding: 18px 0;
    gap: 14px;
  }
  .rt-conn-arrow {
    position: relative;
    width: 16px;
    height: 64px;
  }
  .rt-conn-arrow svg {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 64px;
    height: 16px;
    transform: translate(-50%, -50%) rotate(90deg);
  }
  .rt-conn-labels {
    text-align: left;
  }
}
@media (max-width: 480px) {
  .rt-instances {
    grid-template-columns: 1fr;
  }
}

/* --- Three ways in --- */
.ea-ways {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
}
.ea-way {
  display: flex;
  flex-direction: column;
  padding: 24px;
  border: 1px solid var(--ea-divider);
  border-radius: 12px;
  background: var(--ea-surface);
  min-width: 0;
}
.ea-way-preview {
  min-width: 0;
}
.ea-way-preview > * {
  min-width: 0;
}
.ea-way-header {
  margin-bottom: 12px;
}
.ea-way-eyebrow {
  display: inline-block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--vp-c-brand-1);
  margin-bottom: 6px;
}
.ea-way-title {
  font-size: 18px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--ea-text-1);
  margin: 0;
}
.ea-way-prose {
  font-size: 14.5px;
  line-height: 1.55;
  color: var(--ea-text-2);
  margin: 0 0 18px;
}
.ea-way-prose code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.9em;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--ea-surface-alt);
  color: var(--ea-text-1);
}
.ea-way-preview {
  margin-top: auto;
  border: 1px solid var(--ea-divider);
  border-radius: 8px;
  overflow: hidden;
  background: var(--ea-surface-alt);
  flex: 1 0 240px;
  display: flex;
  flex-direction: column;
}

/* CLI preview (reuses existing .cli-* tokens) */
.ea-way .cli-preview {
  background: transparent;
}
.ea-way .cli-body {
  font-size: 12px;
  padding: 12px 14px;
  flex: 1;
}
.ea-way .cli-line,
.ea-way .cli-output {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Desktop app mock */
.app-chrome {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: var(--ea-surface);
  border-bottom: 1px solid var(--ea-divider);
}
.dark .app-chrome {
  background: var(--ea-surface-alt);
}
.app-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--ea-divider);
}
.app-body {
  display: grid;
  grid-template-columns: 130px 1fr;
  flex: 1;
  min-height: 0;
}
.app-sidebar {
  border-right: 1px solid var(--ea-divider);
  padding: 10px 8px;
  background: var(--ea-surface);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dark .app-sidebar {
  background: var(--ea-surface-alt);
}
.app-sidebar-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--ea-text-2);
  padding: 4px 6px;
  border-radius: 4px;
  font-family: var(--vp-font-family-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.app-sidebar-row.active {
  background: color-mix(in srgb, var(--vp-c-brand-1) 12%, transparent);
  color: var(--ea-text-1);
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.status-dot.live {
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--vp-c-brand-1) 22%, transparent);
}
.status-dot.idle {
  background: var(--ea-text-3);
  opacity: 0.55;
}
.app-main {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--ea-surface);
  min-width: 0;
  overflow: hidden;
}
.dark .app-main {
  background: var(--ea-bg);
}
.app-msg {
  font-size: 10.5px;
  line-height: 1.5;
  padding: 6px 9px;
  border-radius: 6px;
  border: 1px solid var(--ea-divider);
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
}
.app-msg.user {
  align-self: flex-end;
  max-width: 80%;
  background: color-mix(in srgb, var(--vp-c-brand-1) 8%, transparent);
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 25%, transparent);
  color: var(--ea-text-1);
}
.app-msg.agent {
  background: var(--ea-surface-alt);
  color: var(--ea-text-1);
}
.app-msg-tool,
.app-msg-text,
.app-msg.user {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.app-msg-tool {
  font-size: 9.5px;
  color: var(--ea-text-3);
  margin-bottom: 3px;
}
.app-msg-text {
  color: var(--ea-text-2);
}

/* TypeScript code preview (reuses .code-* tokens) */
.ts-preview .code-block {
  border-radius: 0;
  border: none;
  font-size: 11.5px;
  line-height: 1.55;
  padding: 12px 14px;
  margin: 0;
  flex: 1;
}
.ts-preview .code-file-header {
  border-radius: 0;
  border: none;
  border-bottom: 1px solid var(--ea-divider);
}

@media (max-width: 900px) {
  .ea-ways {
    grid-template-columns: 1fr;
    gap: 20px;
  }
}
@media (max-width: 480px) {
  .ea-way {
    padding: 20px;
  }
}

/* ── Responsive ────────────────────────────────────────────────────── */

@media (max-width: 768px) {
  /* NOTE: hero padding / type sizes for this breakpoint live in the
     earlier `.ea-hero` media query block alongside the hero CSS so
     all hero rules are kept together. Do not duplicate them here. */
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
    /* Reset the desktop -24px pull-up: at this breakpoint Section.vue's
       header bottom margin is already only 28px so the negative margin
       would collapse the gap below the title to ~4px. */
    margin-top: 0;
  }
  .ea-prose {
    /* Page-specific override: fill the column on mobile (the desktop
       max-width: 640px in the global rule constrains it on tablet+). */
    max-width: 100%;
  }
  /* The entity-intro paragraphs ("Every agent is an entity with a
     stream") are styled separately from .ea-prose; step them down to
     match for visual consistency. */
  .ea-entity-intro p {
    font-size: 15px;
  }
  /* All per-section section-title overrides drop to 22px in lockstep
     with the shared `.ea-section-title` rule in Section.vue. Keep this
     selector list in sync if a new `.ea-{name}-text .ea-section-title`
     override is added above. */
  .ea-problem-prose .ea-section-title,
  .ea-durable-text .ea-section-title,
  .ea-scale-text .ea-section-title,
  .ea-context-text .ea-section-title,
  .ea-come-online-text .ea-section-title,
  .ea-runtime-text .ea-section-title {
    font-size: 22px;
  }
  /* Per-section subtitle overrides — these are inline
     `<p class="ea-section-subtitle">` paragraphs that live in HomePage's
     own scoped style block, so the cascade in Section.vue doesn't reach
     them. Mirror Section.vue's mobile subtitle size (15px) so they
     scale in lockstep with the section titles above. */
  .ea-durable-text .ea-section-subtitle,
  .ea-scale-text .ea-section-subtitle,
  .ea-context-text .ea-section-subtitle {
    font-size: 15px;
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
  /* NOTE: hero padding / type sizes for this breakpoint live in the
     earlier `.ea-hero` media query block alongside the hero CSS so
     all hero rules are kept together. Do not duplicate them here. */
  .ea-hero-credibility {
    font-size: 12px;
  }
  /* All per-section section-title overrides drop to 20px in lockstep
     with the shared `.ea-section-title` rule in Section.vue. Keep this
     selector list in sync with the 768px rule above. */
  .ea-problem-prose .ea-section-title,
  .ea-durable-text .ea-section-title,
  .ea-scale-text .ea-section-title,
  .ea-context-text .ea-section-title,
  .ea-come-online-text .ea-section-title,
  .ea-runtime-text .ea-section-title {
    font-size: 20px;
  }
  /* Continue stepping the per-section subtitles down in lockstep with
     Section.vue's `.ea-section-subtitle` (14px at 480px). */
  .ea-durable-text .ea-section-subtitle,
  .ea-scale-text .ea-section-subtitle,
  .ea-context-text .ea-section-subtitle {
    font-size: 14px;
  }
  /* The entity-intro paragraphs ("Every agent is an entity with a
     stream") are styled separately from .ea-prose; step them down to
     match for visual consistency at the smallest breakpoint. */
  .ea-entity-intro p {
    font-size: 14px;
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
