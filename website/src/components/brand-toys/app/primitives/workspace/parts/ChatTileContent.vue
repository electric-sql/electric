<script setup lang="ts">
/* ChatTileContent — composed chat-tile content.
   ─────────────────────────────────────────────────────────────────
   Drops the chat parts (bubble + agent response + composer) into an
   AppTileShell + AppTileHeader. This is the desktop "left tile" of the
   hero scene; the same composition is reused at smaller widths
   (sidebar collapsed, single-tile workspace) without changes.

   Layout:
     [AppTileHeader  /horton/code-refactor                        ⋯]
     [chat surface — scrolling column, chat-surface-width capped]
     [AppMessageInput — composer slab, lifted into the surface above]

   The chat surface uses a centred column capped at `--chat-surface-width`
   (set by AppTileShell's body via the shared chat-column geometry).
   At narrow container widths the column collapses to the full width.

   Animation pass-through:
     - `progress`, `paused`, `cps`, `state`, `hasCodeBlock`, `hasToolCall`
       are forwarded to AppAgentResponse — same RAF driver inside.
     - `density` swaps the surface vertical padding (comfortable=24px,
       compact=12px). Scenes flip this on small containers.

   Pure primitive — does NOT include `.app-mockup-root`. */

import AppAgentResponse from '../../chat/AppAgentResponse.vue'
import AppMessageBubble from '../../chat/AppMessageBubble.vue'
import AppMessageInput from '../../chat/AppMessageInput.vue'
import AppTimelineMarker from '../../chat/AppTimelineMarker.vue'
import AppTileHeader from '../AppTileHeader.vue'
import AppTileShell from '../AppTileShell.vue'
import { CHAT_FIXTURES, type ChatFixtureKey } from '../../../fixtures'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    title?: string
    sessionId?: string
    /** Forwarded to AppAgentResponse. */
    state?: 'idle' | 'thinking' | 'streaming' | 'completed'
    progress?: number | null
    paused?: boolean
    cps?: number
    hasCodeBlock?: boolean
    hasToolCall?: boolean
    /** Layout density. `compact` removes chat-surface vertical padding
     * for sub-700-px container widths. */
    density?: 'comfortable' | 'compact'
    /** Bump the header padding past macOS traffic lights — set true
     * on the leftmost tile when sidebar is hidden. */
    chromeInsetTarget?: boolean
    /** Show the close X in the header — true when this is the right
     * tile in a split layout. */
    showClose?: boolean
    /** Time string shown in the timeline's "spawned · …" marker. */
    spawnTime?: string
    /** Sandbox name shown in the timeline's "sandbox · …" marker. */
    sandboxLabel?: string
    /** User-message bubble sender (matches live `formatSender`
     * output, e.g. "system:dev-local"). */
    userSender?: string
    /** User-message bubble timestamp. */
    userTimestamp?: string
    /** Agent response done-row timestamp. */
    agentTimestamp?: string
    /** Which `CHAT_FIXTURES` variant to render. The user prompt
     * comes from the same fixture so prompt + response read as one
     * cohesive scenario. Defaults to `'default'` (the generic
     * createSession-refactor demo used by the hero). */
    fixtureKey?: ChatFixtureKey
  }>(),
  {
    title: 'Test Message Received',
    sessionId: 'horton/70cqMB5GnW',
    state: 'streaming',
    progress: null,
    paused: false,
    cps: 60,
    hasCodeBlock: true,
    hasToolCall: true,
    density: 'comfortable',
    chromeInsetTarget: false,
    showClose: false,
    spawnTime: '14:59',
    sandboxLabel: 'Local',
    userSender: 'system:dev-local',
    userTimestamp: '14:59',
    agentTimestamp: '14:59',
    fixtureKey: 'default',
  }
)

const fixture = computed(() => CHAT_FIXTURES[props.fixtureKey])
</script>

<template>
  <AppTileShell>
    <template #header>
      <AppTileHeader
        :title="title"
        :session-id="sessionId"
        status="running"
        runner-label="Electric Agents Desktop"
        sandbox-label="Local"
        active-view="chat"
        :views="['chat', 'state']"
        :chrome-inset-target="chromeInsetTarget"
        :show-close="showClose"
      />
    </template>

    <div class="chat-surface" :data-density="density">
      <div class="chat-column">
        <div class="timeline-markers">
          <AppTimelineMarker label="spawned" :value="spawnTime" />
          <AppTimelineMarker label="sandbox" :value="sandboxLabel" />
        </div>
        <AppMessageBubble
          :text="fixture.userPrompt"
          :sender="userSender"
          :timestamp="userTimestamp"
        />
        <AppAgentResponse
          :state="state"
          :progress="progress"
          :paused="paused"
          :cps="cps"
          :has-code-block="hasCodeBlock"
          :has-tool-call="hasToolCall"
          :timestamp="agentTimestamp"
          :fixture-key="fixtureKey"
        />
      </div>
    </div>
    <div class="composer-column">
      <div class="composer-inner">
        <AppMessageInput placeholder="Send a message..." />
      </div>
    </div>
  </AppTileShell>
</template>

<style scoped>
.chat-surface {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  /* Soft bottom-fade mask so the chat surface visually melts into the
     composer slab below — matches the live product. */
  -webkit-mask-image: linear-gradient(
    to bottom,
    black 0,
    black calc(100% - 32px),
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    black 0,
    black calc(100% - 32px),
    transparent 100%
  );
}

.chat-surface[data-density='comfortable'] {
  padding: 24px 16px 32px;
}
.chat-surface[data-density='compact'] {
  padding: 12px 12px 24px;
}

.chat-column {
  margin-inline: auto;
  width: min(var(--chat-surface-width), 100%);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Inline row of timeline markers — spawned · 14:59 + sandbox · Local
   side-by-side at the very top of the chat column. Mirrors the live
   timeline's row of `.statusPill` chips that anchor the column to a
   real-product timeline log entry. */
.timeline-markers {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

/* Composer column — same width math as the chat surface. The composer
   primitive itself sets a -16-px top margin so the slab visually sits
   ON TOP of the chat surface above. */
.composer-column {
  flex-shrink: 0;
  padding: 0 16px 16px;
}

.composer-inner {
  margin-inline: auto;
  width: min(var(--chat-surface-width), 100%);
}
</style>
