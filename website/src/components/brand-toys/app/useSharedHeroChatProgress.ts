/* useSharedHeroChatProgress — singleton chat-progress driver.
   ─────────────────────────────────────────────────────────────────
   The hero pairs a desktop mockup with a mobile mockup that need to
   animate in lockstep — same word stream, same beat, same pause —
   so the page reads as "one session, two devices". Each mockup
   lives inside its own shadow root with its own Vue app, so we
   can't share state via provide/inject. Instead, this module
   exposes a singleton progress ref that both apps import.

   How both apps share a ref:
   ─────────────────────────────────────────────────────────────────
   The shadow-root Vue apps live in the SAME JS context as the
   parent page. ES modules are cached per JS context, so when both
   the parent (which won't actually use this) and the inner shadow
   apps `import { heroChatProgress }` from this file, they get the
   same singleton ref. Vue's reactivity is global to the runtime —
   any effect that reads `heroChatProgress.value` is subscribed
   regardless of which app it belongs to. So when the driver
   advances the ref, all consumers across all shadow roots tick.

   Driver behaviour (mirrors `AppAgentResponse`'s internal RAF):
   ─────────────────────────────────────────────────────────────────
   - Progress advances at `cps` chars/sec across `totalLength`
     characters, where `totalLength` is the active fixture's
     agent-response length (so the desktop and mobile both finish
     at the same wall-clock instant).
   - On hitting 1, holds `HOLD_AFTER_COMPLETION_MS` then snaps
     back to 0 and restarts.
   - Driver only ticks while at least one consumer's trigger
     element is intersecting the viewport. When all consumers
     scroll out of view the loop pauses; it resumes from the same
     progress value when one comes back. This keeps the animation
     cheap when the hero is off-screen.
   - `prefers-reduced-motion: reduce` snaps to 1 and stops the
     loop entirely — a static screenshot for accessibility users.

   Public API:
     - `heroChatProgress` ref (read-only externally; consumers pass
       it as `progress` to AppAgentResponse to short-circuit the
       internal driver)
     - `useHeroChatProgress({ trigger, fixtureKey?, cps? })`
       composable that registers an IntersectionObserver on the
       given trigger element so the driver knows when to run. */

import { onBeforeUnmount, onMounted, ref, type Ref, watch } from 'vue'
import { CHAT_FIXTURES, type ChatFixtureKey } from './fixtures'

const HOLD_AFTER_COMPLETION_MS = 3000

/** Reactive 0..1 cursor that consumers feed into AppAgentResponse via
 * its `progress` prop. Driving the cursor externally short-circuits
 * the per-instance internal RAF in AppAgentResponse, so the desktop
 * and mobile mockups stay perfectly in sync. */
export const heroChatProgress: Ref<number> = ref(0)

let cps = 60
let totalLength = 1
let raf: number | null = null
let lastT = 0
let holdUntil = 0
let reducedMotion = false

const intersecting = new Set<symbol>()

function tick(t: number) {
  if (intersecting.size === 0 || reducedMotion) {
    raf = null
    lastT = 0
    return
  }
  if (lastT === 0) lastT = t
  const dt = (t - lastT) / 1000
  lastT = t

  if (heroChatProgress.value >= 1) {
    if (holdUntil === 0) holdUntil = t + HOLD_AFTER_COMPLETION_MS
    if (t >= holdUntil) {
      heroChatProgress.value = 0
      holdUntil = 0
    }
  } else {
    heroChatProgress.value = Math.min(
      1,
      heroChatProgress.value + (dt * cps) / totalLength
    )
  }
  raf = requestAnimationFrame(tick)
}

function ensureDriver() {
  if (reducedMotion) return
  if (raf === null && intersecting.size > 0) {
    lastT = 0
    raf = requestAnimationFrame(tick)
  }
}

/** Register an IntersectionObserver on `trigger`. While the trigger
 * is on-screen, the singleton driver runs; while it's off-screen, the
 * loop pauses (no CPU). Multiple consumers can register; the driver
 * runs as long as ANY of them is intersecting. */
export function useHeroChatProgress(opts: {
  trigger: () => HTMLElement | null
  fixtureKey?: ChatFixtureKey
  /** Chars-per-second target. Defaults to 60 — matches the original
   * AppAgentResponse default. Only the first registration wins to
   * keep the desktop / mobile rates identical. */
  cps?: number
}) {
  const id = Symbol(`hero-chat-consumer`)
  let observer: IntersectionObserver | null = null

  onMounted(() => {
    if (typeof window !== `undefined`) {
      reducedMotion =
        window.matchMedia?.(`(prefers-reduced-motion: reduce)`).matches ?? false
      if (reducedMotion) {
        heroChatProgress.value = 1
      }
    }

    /* The very first registration sets the timing constants. Later
       consumers sharing the same fixture won't budge them — keeping
       the driver in lockstep is the whole point. */
    const fixtureKey: ChatFixtureKey = opts.fixtureKey ?? `default`
    totalLength = Math.max(
      1,
      CHAT_FIXTURES[fixtureKey].agentResponseText.length
    )
    if (opts.cps !== undefined) cps = opts.cps

    const el = opts.trigger()
    if (!el || typeof IntersectionObserver === `undefined`) {
      /* Fallback for SSR / older browsers — assume always-on so the
         driver still ticks. */
      intersecting.add(id)
      ensureDriver()
      return
    }

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) intersecting.add(id)
          else intersecting.delete(id)
        }
        ensureDriver()
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
    intersecting.delete(id)
    if (intersecting.size === 0 && raf !== null) {
      cancelAnimationFrame(raf)
      raf = null
    }
  })

  return heroChatProgress
}

/* Re-exported so `watch` can be reflexively imported from this
   module if a consumer wants to hook into progress events without
   pulling Vue's index. */
export { watch }
