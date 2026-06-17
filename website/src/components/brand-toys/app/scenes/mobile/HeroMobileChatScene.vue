<script setup lang="ts">
/* HeroMobileChatScene — mobile companion to the desktop hero.
   ─────────────────────────────────────────────────────────────────
   Pairs with `HeroChatStateScene` (desktop) to tell the
   "same session, two devices" hero story. Mounts:

     1. AppPhoneFrame — outer phone bezel chrome (dynamic island,
        home indicator).
     2. AppMobileTitleBar — React-Native style nav bar at the top
        of the screen (chevron-back · centred title · kebab),
        a 1:1 port of `agents-mobile/src/components/Header.tsx` in
        `align="center"` mode.
     3. The same chat content the desktop renders — message
        bubble + agent response — using the SAME primitives so
        the timeline streams the same words at the same beat.
     4. The same composer (AppMessageInput) the desktop uses,
        without modification.

   Iphone-resolution rendering:
     A real iPhone Pro screen is ~390 CSS pixels wide. Rendering
     the title bar, bubbles, and composer at the phone wrapper's
     actual on-page width (≈ 250 px) makes them read as oversized
     compared to the real app. We avoid that by rendering the
     screen body at a FIXED intrinsic width of 400 px and then
     scaling it down to fit the wrapper using CSS container query
     units (`100cqw / 400px` resolves to the exact scale factor
     for whatever the screen's actual width is on the page).
     Result: the chrome reads at iPhone proportions regardless of
     the wrapper size.

   Time sync:
     We import `heroChatProgress` from `useSharedHeroChatProgress`
     and pass it into AppAgentResponse via the `progress` prop.
     The shared driver runs a singleton RAF loop that ticks both
     the desktop and the mobile mockups at the same instant. The
     IntersectionObserver registered here adds the mobile scene
     to the driver's wake set so the loop runs when EITHER device
     is on-screen.

   Pure scene — DOES include `.app-mockup-root` so it can be
   dropped into a page directly. Always renders dark mode. */

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppAgentResponse from '../../primitives/chat/AppAgentResponse.vue'
import AppMessageBubble from '../../primitives/chat/AppMessageBubble.vue'
import AppMessageInput from '../../primitives/chat/AppMessageInput.vue'
import AppTimelineMarker from '../../primitives/chat/AppTimelineMarker.vue'
import AppMobileTitleBar from '../../primitives/mobile/AppMobileTitleBar.vue'
import AppPhoneFrame from '../../primitives/mobile/AppPhoneFrame.vue'
import { CHAT_FIXTURES, type ChatFixtureKey } from '../../fixtures'
import {
  heroChatProgress,
  useHeroChatProgress,
} from '../../useSharedHeroChatProgress'

const props = withDefaults(
  defineProps<{
    title?: string
    fixtureKey?: ChatFixtureKey
    /** Time string for the timeline's "spawned · …" marker — keep
     * in sync with the desktop scene so both surfaces tell the
     * same story. */
    spawnTime?: string
    sandboxLabel?: string
    userSender?: string
    userTimestamp?: string
    agentTimestamp?: string
  }>(),
  {
    title: 'Test Message Received',
    fixtureKey: 'default',
    spawnTime: '14:59',
    sandboxLabel: 'Local',
    userSender: 'system:dev-local',
    userTimestamp: '14:59',
    agentTimestamp: '14:59',
  }
)

const fixture = computed(() => CHAT_FIXTURES[props.fixtureKey])

/* Auto-pin to the bottom as content streams — same trick the
   desktop ChatTileContent uses (ResizeObserver on the inner
   column, set scrollTop to scrollHeight on every height change).
   Without this the typewriter would keep painting words below
   the visible viewport once the column outgrows the surface. */
const surfaceEl = ref<HTMLElement | null>(null)
const columnEl = ref<HTMLElement | null>(null)
const sceneRoot = ref<HTMLElement | null>(null)

let resizeObserver: ResizeObserver | null = null
let firstObservation = true

onMounted(() => {
  if (!surfaceEl.value || !columnEl.value) return
  if (typeof ResizeObserver === 'undefined') return

  resizeObserver = new ResizeObserver(() => {
    if (firstObservation) {
      firstObservation = false
      return
    }
    const surface = surfaceEl.value
    if (!surface) return
    surface.scrollTop = surface.scrollHeight
  })
  resizeObserver.observe(columnEl.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

/* Register this scene with the shared progress driver. While the
   scene root is on-screen, the singleton RAF runs; while it's
   off-screen the loop pauses (cheaper offscreen). The driver is
   shared with the desktop scene so both tick together. */
useHeroChatProgress({
  trigger: () => sceneRoot.value,
  fixtureKey: props.fixtureKey,
})
</script>

<template>
  <div
    ref="sceneRoot"
    class="hero-mobile-scene app-mockup-root"
    data-theme="dark"
  >
    <AppPhoneFrame device-label="Electric Agents · iOS preview">
      <div class="screen-scaler">
        <div class="screen-body">
          <div class="screen-safe-top" />
          <AppMobileTitleBar :title="title" />
          <div ref="surfaceEl" class="chat-surface">
            <div ref="columnEl" class="chat-column">
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
                state="streaming"
                :progress="heroChatProgress"
                :timestamp="agentTimestamp"
                :fixture-key="fixtureKey"
              />
            </div>
          </div>
          <div class="composer-column">
            <AppMessageInput placeholder="Send a message..." />
          </div>
        </div>
      </div>
    </AppPhoneFrame>
  </div>
</template>

<style scoped>
.hero-mobile-scene {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: stretch;
  justify-content: center;
  font-family: var(--ds-font-body);
}

/* ───────── iPhone-resolution scaler ─────────
   Render the screen body at a FIXED 400-px intrinsic width — the
   approximate CSS width of an iPhone Pro — and visually scale it
   down to fit the actual phone-screen footprint via container
   query units. `100cqw / 400px` resolves to (screenWidthPx / 400)
   = the exact scale factor; transform-origin is top-left so the
   visible top-left corner stays anchored to the screen's top-left
   regardless of the wrapper size. */
.screen-scaler {
  width: 100%;
  height: 100%;
  container-type: inline-size;
  container-name: phone-screen;
  overflow: hidden;
}

.screen-body {
  width: 400px;
  /* Same aspect as the screen interior so the inner box's height
     matches the wrapper's after the visual scale is applied. iPhone
     Pro's screen aspect ≈ 9/19.5; multiplied by the 400-px width
     this comes out to ~866.67 px tall. */
  height: calc(400px * 19.5 / 9);
  transform-origin: top left;
  /* `100cqw / 400px` resolves to a unitless scale = (cqw / 400px). */
  transform: scale(calc(100cqw / 400px));
  display: flex;
  flex-direction: column;
  background: var(--ds-bg);
}

/* iPhone safe-area top inset — clears the dynamic island so the
   title bar starts BELOW it. Sized in the 400-px intrinsic
   coordinate space so that, after the screen-scaler's downscale,
   the visible inset matches the position of `AppPhoneFrame`'s
   island (top: 2.4 % of the phone height). */
.screen-safe-top {
  flex-shrink: 0;
  height: 40px;
}

.chat-surface {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
  /* Soft bottom-fade mask so the chat surface visually melts into
     the composer slab below — same treatment as the desktop. */
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
  padding: 16px 16px 32px;
}

.chat-surface::-webkit-scrollbar {
  display: none;
}

.chat-column {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
}

.timeline-markers {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.composer-column {
  flex-shrink: 0;
  /* Bottom padding clears the phone's home indicator (positioned
     at ~2.4 % from the bottom of the device). Sized in the inner
     400-px intrinsic coordinate space — after the screen-scaler
     downscale, this lifts the composer ~14 px above the home pill. */
  padding: 0 16px 22px;
}

/* The chat-surface-width cap on bubbles + agent response is
   keyed to the desktop's wider tile; on mobile we fill the
   available width. */
.chat-surface :deep(.bubble-root),
.chat-surface :deep(.agent-response-root) {
  width: 100%;
  max-width: 100%;
}
</style>
