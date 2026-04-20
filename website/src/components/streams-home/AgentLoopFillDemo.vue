<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from "vue"
import { useDemoVisibility } from "../../../.vitepress/theme/composables/useDemoVisibility"

/* AgentLoopFillDemo
   ─────────────────
   Lead visual for §1.5 "the agent loop is a stream of durable events".
   Renders the Durable Streams icon as a stack of 16 outline blades that
   "fill in" one-at-a-time as agent-loop events stream into the panel
   on the right (USER_MESSAGE / ASSISTANT_RESPONSE / TOOL_CALL /
   TOOL_RESULT). Once the wheel is full, the loop keeps producing
   events on top of a fully-lit logo. Visibility-gated via the shared
   IntersectionObserver composable so the timer only ticks while the
   demo is on screen. */

interface StreamEvent {
  id: number
  type: string
  time: string
}

/* The 16 paths of the Durable Streams icon, kept inline so this
   component is self-contained. Each entry is the `d` attribute string
   for one blade. Order matches the source SVG. */
const BLADES: string[] = [
  "M184.324 49.8734L184.858 49.8899C185.56 50.6324 186.5 53.1182 186.965 54.171C190.31 61.732 192.895 69.4054 195.338 77.3038C192.434 76.2208 188.439 75.1435 185.397 74.2354L164.799 68.2322C161.823 67.2068 157.741 66.1404 154.626 65.1894C151.479 60.0376 148.598 56.5435 144.633 51.9497C157.859 51.167 171.089 50.4749 184.324 49.8734Z",
  "M1.35234 80.6287C2.4758 81.4935 3.5916 82.4419 4.68838 83.346C14.3518 91.3142 24.1302 99.1942 33.6878 107.287C34.2233 110.686 34.9508 114.052 35.866 117.367C36.1832 118.48 37.7035 122.287 37.3529 123.021L36.8324 122.901C25.0549 118.504 11.6675 114.139 0.194518 109.402C0.202799 108.543 0.173357 107.587 0.131338 106.724C-0.300504 97.8849 0.39112 89.4038 1.35234 80.6287Z",
  "M1.66248 119.696L41.8443 131.33C43.6506 134.304 45.3292 136.807 47.5754 139.492C48.8848 141.056 50.3009 142.581 51.5359 144.183C50.8797 144.188 50.201 144.224 49.5435 144.249C40.9177 144.932 31.8725 145.11 23.2023 145.685C19.4984 145.931 15.6945 145.96 11.9952 146.295C8.1507 138.708 3.94285 128 1.66248 119.696Z",
  "M158.764 73.9789C170.054 77.5482 181.288 81.8604 192.439 85.8419C193.903 86.3648 195.377 86.9331 196.816 87.519C197.12 97.5641 197.217 105.451 195.722 115.54L191.213 111.971L190.67 111.524L171.732 96.5778C169.397 94.7255 164.771 91.3005 162.834 89.4491C161.791 82.784 160.691 80.1503 158.764 73.9789Z",
  "M144.251 144.633C144.586 145.266 146.234 181.168 146.295 184.142C140.287 187.542 127.257 192.248 120.604 194.076L118.865 194.506C119.507 192.283 120.229 190.054 120.934 187.848C124.474 176.773 127.52 165.471 131.157 154.432C136.582 151.008 139.328 148.826 144.251 144.633Z",
  "M76.807 1.67401L77.1807 1.66245L77.3038 1.85439C77.2084 2.85072 76.2109 5.54457 75.8585 6.61624C75.1531 8.76707 74.4746 10.9267 73.8229 13.0947C71.0088 22.3289 68.1592 32.9449 65.0745 41.9643C61.2853 44.3102 57.7378 46.8637 54.3491 49.7767C53.641 50.3854 52.989 50.9609 52.2503 51.5359L52.0392 51.4349L51.9791 50.7621C51.8723 46.5661 51.5196 42.0881 51.3048 37.8727C50.8966 29.1934 50.4196 20.5179 49.8734 11.8467C56.3338 8.55668 69.839 3.31496 76.807 1.67401Z",
  "M41.7317 18.2869C42.209 18.7737 46.1228 55.181 46.5485 58.8558C44.3322 61.3042 42.313 64.7544 40.7247 67.6714C39.8826 69.2182 39.2379 70.796 38.2826 72.3165C36.8552 69.6711 35.4671 67.0057 34.1192 64.3209C29.5944 55.4642 25.1482 46.5695 20.7806 37.6376C21.8782 36.275 23.5342 34.593 24.7643 33.2968C29.9205 27.7763 35.6019 22.7505 41.7317 18.2869Z",
  "M158.735 124.684C159.827 125.512 175.274 156.91 176.219 159.236C172.169 164.108 166.958 168.908 162.22 173.154C159.911 175.037 157.576 176.891 155.216 178.713C154.52 174.915 154.073 168.918 153.617 164.972L150.451 138.153C153.68 134.509 156.504 128.961 158.735 124.684Z",
  "M158.882 20.7806C159.422 20.9105 166.802 27.9414 167.7 28.842C171.477 32.63 175.521 36.9363 178.713 41.208C175.145 41.4588 170.953 41.9961 167.348 42.386L142.552 45.1439L137.032 45.7173C131.604 41.8225 128.581 40.7236 123.021 37.7031C127.241 35.9619 132.47 33.234 136.687 31.2282L158.882 20.7806Z",
  "M58.0128 150.456C58.4982 150.346 60.9951 152.342 61.6201 152.766C65.0558 155.102 68.7098 156.675 72.3165 158.625C69.2703 160.269 65.6811 161.955 62.5605 163.515L36.8185 176.219L34.0789 173.657C28.469 168.575 22.0089 161.522 17.4557 155.375C19.0867 155.068 21.5146 154.835 23.2236 154.629L33.6212 153.379C41.612 152.42 50.0422 151.24 58.0128 150.456Z",
  "M121.965 159.595L122.189 159.619C122.274 160.106 109.946 193.215 108.715 196.688C99.0789 197.259 92.346 197.107 82.5537 195.724L80.6287 195.442C83.4655 192.178 86.2406 188.56 88.9757 185.184C94.8727 177.877 100.819 170.611 106.813 163.387C112.696 162.237 116.155 161.384 121.965 159.595Z",
  "M94.9072 0.00924945C101.248 -0.0858023 109.213 0.560857 115.54 1.52916C110.288 8.20057 104.95 14.8027 99.5294 21.3343C96.4566 25.0523 93.2359 28.76 90.2408 32.516L89.44 33.4135C83.4376 34.6427 79.8321 35.5712 73.9789 37.4051C76.1855 32.4219 77.9547 26.8221 79.8887 21.7016C82.5791 14.5776 85.287 7.43249 87.8104 0.248107C90.1755 0.154589 92.5412 0.0751724 94.9072 0.00924945Z",
  "M163.697 98.0844C164.459 98.4631 168.912 102.818 169.832 103.676C177.553 110.877 185.224 118.134 192.844 125.448C190.61 131.975 187.624 138.721 184.616 144.897L181.427 151.283C178.843 146.894 176.206 141.791 173.696 137.283C169.458 129.822 165.311 122.306 161.257 114.735C161.872 111.607 162.44 109.041 162.881 105.839C163.249 103.163 163.371 100.673 163.697 98.0844Z",
  "M81.2273 161.257C84.6818 162.454 93.5709 163.486 97.2531 163.847C92.6014 168.655 87.7856 173.945 83.2563 178.871C78.9763 183.493 74.735 188.151 70.5328 192.844C68.4874 192.081 66.542 191.358 64.5387 190.492C58.1204 187.737 51.8391 184.67 45.7173 181.3C49.3328 179.547 53.6911 176.713 57.2682 174.678C65.0968 170.226 73.1916 165.276 81.2273 161.257Z",
  "M14.5158 45.7173C21.6858 57.7992 28.7617 69.9349 35.7426 82.1234C34.4232 88.4746 33.7487 92.5163 33.1695 98.9156L28.4622 94.6641C26.1697 92.4121 23.5057 90.3037 21.1652 88.1181C15.1258 82.478 8.43419 77.0148 2.49365 71.3404C5.99576 62.181 9.95996 54.3387 14.5158 45.7173Z",
  "M126.002 4.15613C126.586 4.28382 129.455 5.38944 130.083 5.65065C136.846 8.46568 144.969 11.9707 151.283 15.6455C148.382 17.0627 144.608 19.3187 141.761 20.9173C134.942 24.8051 128.098 28.6472 121.227 32.4426C119.213 33.5673 117.185 34.6674 115.144 35.7426C109.737 34.2641 104.453 33.7524 98.9156 33.1729C101.622 30.08 105.082 26.6011 107.931 23.5602L126.002 4.15613Z",
]

/* Pre-baked angle for each blade (degrees clockwise from 12 o'clock),
   computed from each path's first move-to coordinate. Used to drive
   the wheel rotation: after each tick we rotate so the just-activated
   blade lands at LEAD_ANGLE, which is the position pointing at the
   lead event card on the right. */
const BLADE_ANGLES: number[] = [
  60, 280, 258, 68, 135, 348, 325, 113, 38, 218, 159, 358, 90, 195, 302, 16,
]

/* Activation order: clockwise from 12 o'clock. Sorted ascending by
   `BLADE_ANGLES` (with 358 normalised to ~0). Activating blades in this
   order while rotating the wheel CCW by one segment per tick gives the
   "fills in toward the lead position" effect from the design refs. */
const ACTIVATION_ORDER: number[] = [
  11, 15, 8, 0, 3, 12, 7, 4, 10, 13, 9, 2, 1, 14, 6, 5,
]

/* Where on the wheel the "leading" (just-activated) blade should land,
   in degrees clockwise from 12 o'clock. ~18° puts the blade up near
   12 o'clock — high enough that the dog-leg connector down to the
   lead event card has a real vertical segment. */
const LEAD_ANGLE = 18

/* Realistic agent-loop sequence — the kind of trace a coding agent
   emits. Cycles indefinitely. */
const SEQUENCE: string[] = [
  "USER_MESSAGE",
  "ASSISTANT_RESPONSE",
  "TOOL_CALL",
  "TOOL_RESULT",
  "ASSISTANT_RESPONSE",
  "TOOL_CALL",
  "TOOL_RESULT",
  "ASSISTANT_RESPONSE",
  "USER_MESSAGE",
  "ASSISTANT_RESPONSE",
  "TOOL_CALL",
  "TOOL_RESULT",
  "TOOL_CALL",
  "TOOL_RESULT",
  "ASSISTANT_RESPONSE",
  "USER_MESSAGE",
]

const VISIBLE_EVENTS = 6
const TICK_MS = 1400
/* How many ticks the wheel sits "fully lit" before the loop wipes
   everything and starts again. Long enough to read as "complete",
   short enough that scrollers see the full fill animation again. */
const FULL_HOLD_TICKS = 4

const rootRef = ref<HTMLElement>()
const isVisible = useDemoVisibility(rootRef)

const events = ref<StreamEvent[]>([])
const filledCount = ref(0)
const wheelRotation = ref(0)
let nextEventId = 0
let seqIdx = 0
let timer: number | null = null
let postFullTicks = 0
/* In-component clock — keeps timestamps plausible without leaking the
   real wall clock into the page (which would force re-render on every
   tick during SSR hydration). */
let baseTime = Date.parse("2026-04-18T11:21:50Z")

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/* Bring `target` into the [-180, 180] window around `prev` so the CSS
   transition takes the visually-shortest rotation path between ticks
   (otherwise wraparound between e.g. -328° and +14° would spin the
   wheel almost all the way round). */
function shortestRotation(target: number, prev: number): number {
  let r = target
  while (r - prev > 180) r -= 360
  while (r - prev < -180) r += 360
  return r
}

function tick(): void {
  /* Reset frame: once the wheel has been fully lit for a few ticks we
     wipe events + blade state and let the cycle start again. The wheel
     rotation is intentionally NOT reset — keeping its current value
     makes the next activation step a small, continuous CCW move from
     wherever it is, which reads way better than snapping to 0. */
  if (filledCount.value === BLADES.length && postFullTicks >= FULL_HOLD_TICKS) {
    events.value = []
    filledCount.value = 0
    postFullTicks = 0
    seqIdx = 0
    return
  }

  baseTime += 1700 + Math.floor(Math.random() * 1300)
  const d = new Date(baseTime)
  const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
  const type = SEQUENCE[seqIdx % SEQUENCE.length]
  seqIdx++
  events.value = [
    { id: ++nextEventId, type, time },
    ...events.value,
  ].slice(0, VISIBLE_EVENTS)

  if (filledCount.value < BLADES.length) {
    filledCount.value++
    /* Rotate the wheel so the blade we just activated ends up at
       LEAD_ANGLE (the spot pointing at the lead event card). */
    const lastIdx = ACTIVATION_ORDER[filledCount.value - 1]
    const target = LEAD_ANGLE - BLADE_ANGLES[lastIdx]
    wheelRotation.value = shortestRotation(target, wheelRotation.value)
  } else {
    /* Wheel is full — keep nudging it round one segment per tick so
       the loop still feels alive while we hold before resetting. */
    wheelRotation.value -= 360 / BLADES.length
    postFullTicks++
  }
}

function start(): void {
  if (timer) return
  if (events.value.length === 0) tick()
  timer = window.setInterval(tick, TICK_MS)
}
function stop(): void {
  if (timer) {
    window.clearInterval(timer)
    timer = null
  }
}

watch(isVisible, (active) => {
  if (active) start()
  else stop()
})

onBeforeUnmount(stop)

const activeBlades = computed(() => {
  const set = new Set<number>()
  for (let i = 0; i < filledCount.value; i++) set.add(ACTIVATION_ORDER[i])
  return set
})
</script>

<template>
  <div ref="rootRef" class="alf" aria-hidden="true">
    <div class="alf-stage">
      <div class="alf-wheel-wrap">
        <svg
          class="alf-wheel"
          viewBox="0 0 197 197"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="Durable Streams logo filling in as events arrive"
        >
          <g
            class="alf-blades"
            :style="{ transform: `rotate(${wheelRotation}deg)` }"
          >
            <path
              v-for="(d, i) in BLADES"
              :key="i"
              :d="d"
              :class="['alf-blade', { 'alf-blade--on': activeBlades.has(i) }]"
            />
          </g>
        </svg>
      </div>

      <div class="alf-events">
        <!-- Dog-leg connector from the active blade down into the lead
             event card. Sits in the gap (right:100%) and reaches back
             into the wheel column via its width, so it visually anchors
             to the bright blade tip at LEAD_ANGLE. Hidden during the
             reset frame so it doesn't dangle when there are no events. -->
        <svg
          v-show="events.length > 0"
          class="alf-connector"
          viewBox="0 0 120 32"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M 0 6 H 60 V 24 H 120" />
        </svg>

        <transition-group name="alf-event">
          <div
            v-for="(ev, i) in events"
            :key="ev.id"
            :class="['alf-event', { 'alf-event--lead': i === 0 }]"
            :style="{ '--alf-row': String(i) }"
          >
            <div class="alf-event-row">
              <span class="alf-event-type">{{ ev.type }}</span>
              <span class="alf-event-time">{{ ev.time }}</span>
            </div>
            <div class="alf-event-rule" />
          </div>
        </transition-group>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The demo lives inside an EaSection on /streams, so it inherits the
   page's surface and text tokens. The only "branded" colour we reach
   for is --durable-streams-color which is what the rest of the page
   already uses for the cyan accent. */

.alf {
  width: 100%;
  display: flex;
  justify-content: center;
}

.alf-stage {
  width: 100%;
  max-width: 720px;
  display: grid;
  grid-template-columns: minmax(0, 260px) minmax(0, 1fr);
  gap: 36px;
  /* Top-align so the wheel's upper-right rim (where the active blade
     lands after rotation) sits next to the lead event card. */
  align-items: start;
}

/* --- Wheel --- */

.alf-wheel-wrap {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

.alf-wheel {
  width: 100%;
  height: auto;
  aspect-ratio: 1 / 1;
  display: block;
}

/* The blades live inside this group so we can spin them as a single
   unit. Rotation comes in via inline style; the transition smooths the
   step between activations. */
.alf-blades {
  transform-box: fill-box;
  transform-origin: 50% 50%;
  transition: transform 0.85s cubic-bezier(0.4, 0, 0.2, 1);
}

.alf-blade {
  fill: var(--durable-streams-color);
  fill-opacity: 0.07;
  stroke: var(--durable-streams-color);
  stroke-opacity: 0.22;
  stroke-width: 0.6;
  transition:
    fill-opacity 0.55s ease,
    stroke-opacity 0.55s ease,
    filter 0.55s ease;
}
.alf-blade--on {
  fill-opacity: 0.85;
  stroke-opacity: 0.95;
  filter: drop-shadow(0 0 4px rgba(117, 251, 253, 0.35));
}

/* --- Event stack --- */

.alf-events {
  position: relative;
  z-index: 2; /* sit above the wheel so the connector reads cleanly */
  display: flex;
  flex-direction: column;
  gap: 10px;
  /* Reserve enough vertical space for VISIBLE_EVENTS cards plus their
     gaps so the box doesn't grow as new events stream in. Card height
     ≈ 47.5px, gap 10px, count = 6. */
  min-height: 340px;
}

/* Dog-leg connector. Sits in the gap between wheel and events,
   anchored to the events column's left edge via right:100%. The width
   reaches back into the wheel column so the path's start visually
   meets the bright leading blade tip at LEAD_ANGLE. */
.alf-connector {
  position: absolute;
  top: 0;
  right: 100%;
  width: 120px;
  height: 32px;
  pointer-events: none;
  fill: none;
  stroke: var(--durable-streams-color);
  stroke-width: 1.5;
  stroke-linecap: square;
  stroke-linejoin: miter;
  opacity: 0.85;
  transition: opacity 0.45s ease;
}

.alf-event {
  position: relative;
  background: var(--ea-surface);
  border: 1px solid var(--ea-divider);
  border-radius: 6px;
  padding: 10px 14px 12px;
  /* Older rows fade slightly so the lead event stays the focal point.
     `--alf-row` is set per-card from the v-for index. */
  opacity: calc(1 - var(--alf-row, 0) * 0.12);
  transition:
    opacity 0.45s ease,
    transform 0.45s ease,
    border-color 0.45s ease,
    background 0.45s ease;
}
.alf-event--lead {
  border-color: var(--durable-streams-color);
  box-shadow: 0 0 0 1px rgba(117, 251, 253, 0.18);
}

.alf-event-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.alf-event-type {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  letter-spacing: 0.06em;
  color: var(--ea-text-1);
}
.alf-event-time {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--ea-text-3);
}

.alf-event-rule {
  height: 1.5px;
  margin-top: 8px;
  background: var(--durable-streams-color);
  opacity: 0.85;
  transform-origin: left;
  animation: alf-rule-grow 1.1s ease-out forwards;
}
.alf-event:not(.alf-event--lead) .alf-event-rule {
  opacity: 0.4;
}

@keyframes alf-rule-grow {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

/* TransitionGroup classes — events slide in from above, fade out at
   the bottom of the stack, and visibly slide down as new ones land.
   Leaving cards are taken out of flow (position: absolute, anchored
   to the container's bottom edge) so the stack never briefly grows
   to 7 cards while the trailing one is still animating out. */
.alf-event-enter-from {
  opacity: 0;
  transform: translateY(-12px);
}
.alf-event-enter-active,
.alf-event-leave-active {
  transition:
    opacity 0.4s ease,
    transform 0.4s ease;
}
.alf-event-leave-active {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
}
.alf-event-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
.alf-event-move {
  transition: transform 0.45s ease;
}

/* --- Responsive --- */

@media (max-width: 768px) {
  .alf-stage {
    grid-template-columns: minmax(0, 180px) minmax(0, 1fr);
    gap: 20px;
    max-width: 520px;
  }
  .alf-events {
    min-height: 300px;
  }
  .alf-event {
    padding: 8px 12px 10px;
  }
  .alf-event-type {
    font-size: 11px;
  }
  .alf-event-time {
    font-size: 10px;
  }
  .alf-connector {
    width: 90px;
  }
}

@media (max-width: 520px) {
  .alf-stage {
    grid-template-columns: minmax(0, 120px) minmax(0, 1fr);
    gap: 14px;
  }
  .alf-events {
    min-height: 280px;
  }
  .alf-connector {
    width: 64px;
  }
}
</style>
