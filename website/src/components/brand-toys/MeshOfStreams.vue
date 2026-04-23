<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"

import {
  DURABLE_STREAMS_ACTIVATION_ORDER,
  DURABLE_STREAMS_FADE_TAIL,
  DURABLE_STREAMS_WHEEL_BLADES,
  DURABLE_STREAMS_WHEEL_VIEWBOX,
} from "../streams-home/durableStreamsWheel"
import {
  createMeshScene,
  hashSeed,
  mulberry32,
  sampleAlongTrack,
  type MeshWheel,
} from "./meshOfStreams"

const props = withDefaults(
  defineProps<{
    seed?: string
    layout?: "wide" | "square" | "dense" | "sparse"
    wheelCount?: number
    connectionDensity?: number
    gridSize?: number
    routePadding?: number
    trackWidth?: number
    cornerRadius?: number
    glow?: boolean
    noEdgeFade?: boolean
    animateMessages?: boolean
    showMessages?: boolean
    messageCount?: number
    messageSpeed?: number
    messageScale?: number
    rotateWheels?: boolean
    wheelRotationSpeed?: number
    animateSegments?: boolean
    segmentPulse?: number
    paused?: boolean
    showDebug?: boolean
  }>(),
  {
    seed: "mesh-of-streams",
    layout: "wide",
    wheelCount: 14,
    connectionDensity: 0.78,
    gridSize: 24,
    routePadding: 0,
    trackWidth: 1,
    cornerRadius: 12,
    glow: true,
    noEdgeFade: false,
    animateMessages: true,
    showMessages: true,
    messageCount: 38,
    messageSpeed: 1,
    messageScale: 1,
    rotateWheels: true,
    wheelRotationSpeed: 1,
    animateSegments: true,
    segmentPulse: 1,
    paused: false,
    showDebug: false,
  }
)

interface MessageSeed {
  id: string
  trackId: string
  baseFraction: number
  speedPx: number
  radius: number
  reverse: boolean
}

const root = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const size = ref({ w: 1600, h: 900 })
const nowMs = ref(0)

let resizeObserver: ResizeObserver | null = null
let frame = 0
let running = false
let ctx: CanvasRenderingContext2D | null = null

const scene = computed(() =>
  createMeshScene({
    width: size.value.w,
    height: size.value.h,
    seed: props.seed,
    wheelCount: props.wheelCount,
    layout: props.layout,
    connectionDensity: props.connectionDensity,
    gridSize: props.gridSize,
    routePadding: props.routePadding,
    cornerRadius: props.cornerRadius,
  })
)

const animated = computed(
  () =>
    !props.paused &&
    props.showMessages &&
    props.animateMessages &&
    props.messageSpeed > 0
)

function syncSize() {
  const el = root.value
  if (!el) return
  const nextW = Math.max(240, Math.round(el.clientWidth))
  const nextH = Math.max(240, Math.round(el.clientHeight))
  if (nextW !== size.value.w || nextH !== size.value.h) {
    size.value = { w: nextW, h: nextH }
  }
}

function ensureCanvasSize() {
  const el = canvas.value
  if (!el || !ctx) return
  const dpr = window.devicePixelRatio || 1
  const targetW = Math.max(1, Math.round(size.value.w * dpr))
  const targetH = Math.max(1, Math.round(size.value.h * dpr))
  if (el.width !== targetW || el.height !== targetH) {
    el.width = targetW
    el.height = targetH
    el.style.width = `${size.value.w}px`
    el.style.height = `${size.value.h}px`
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function stopLoop() {
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  running = false
}

function startLoop() {
  if (running) return
  running = true
  const tick = (ts: number) => {
    nowMs.value = ts
    drawCanvas(ts / 1000)
    frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
}

watch(
  animated,
  (value) => {
    if (value) startLoop()
    else stopLoop()
  },
  { immediate: true }
)

onMounted(() => {
  syncSize()
  if (canvas.value) ctx = canvas.value.getContext("2d")
  ensureCanvasSize()
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => syncSize())
    if (root.value) resizeObserver.observe(root.value)
  }
  window.addEventListener("resize", syncSize)
  drawCanvas(sceneTime.value)
})

onBeforeUnmount(() => {
  stopLoop()
  resizeObserver?.disconnect()
  window.removeEventListener("resize", syncSize)
})

const sceneTime = computed(() => (props.paused ? 0 : nowMs.value / 1000))

const trackMap = computed(() => {
  const map = new Map<string, (typeof scene.value.tracks)[number]>()
  for (const track of scene.value.tracks) map.set(track.id, track)
  return map
})

const messageSeeds = computed<MessageSeed[]>(() => {
  const tracks = scene.value.tracks
  if (!tracks.length || !props.showMessages || props.messageCount <= 0) return []
  const random = mulberry32(hashSeed(`${props.seed}:messages`))
  const out: MessageSeed[] = []
  const target = Math.max(0, Math.round(props.messageCount))
  for (let i = 0; i < target; i++) {
    const track = tracks[Math.floor(random() * tracks.length)]
    out.push({
      id: `message-${i}`,
      trackId: track.id,
      baseFraction: random(),
      speedPx: (44 + random() * 78) * props.messageSpeed,
      radius: (1.8 + random() * 1.35) * props.messageScale,
      reverse: random() < 0.12,
    })
  }
  return out
})

const portDots = computed(() =>
  scene.value.tracks.flatMap((track) => {
    if (track.points.length < 2) return []
    return [
      { id: `${track.id}-start`, point: track.points[0] },
      { id: `${track.id}-end`, point: track.points[track.points.length - 1] },
    ]
  })
)

function wheelScale(wheel: MeshWheel): number {
  return (wheel.r * 2) / DURABLE_STREAMS_WHEEL_VIEWBOX
}

function bladeStrengthAtPhase(wheel: MeshWheel, bladeIndex: number): number {
  const cwPos = DURABLE_STREAMS_ACTIVATION_ORDER.indexOf(bladeIndex)
  if (cwPos === -1) return 0
  const cycle = DURABLE_STREAMS_ACTIVATION_ORDER.length
  const head = ((wheel.segmentOffset / (Math.PI * 2)) * cycle) % cycle
  const age = (head - cwPos + cycle) % cycle
  const cutoff = cycle - DURABLE_STREAMS_FADE_TAIL
  if (age < cutoff) return 1
  return Math.max(0, (cycle - age) / DURABLE_STREAMS_FADE_TAIL)
}

function wheelAnimationStyle(wheel: MeshWheel) {
  const rotationTurns = wheel.rotationOffset / (Math.PI * 2)
  const effectiveRate = Math.abs(wheel.rotationRate * props.wheelRotationSpeed)
  const rotationDuration = effectiveRate > 0.0001 ? (Math.PI * 2) / effectiveRate : 9999
  const pulseRate = Math.max(0.0001, props.segmentPulse * 2.2)
  const pulseDuration = DURABLE_STREAMS_ACTIVATION_ORDER.length / pulseRate
  return {
    "--mesh-wheel-rotation-offset": `${rotationTurns}turn`,
    "--mesh-wheel-rotation-duration": `${rotationDuration}s`,
    "--mesh-wheel-rotation-direction": wheel.rotationRate >= 0 ? "normal" : "reverse",
    "--mesh-wheel-phase-delay": `${-(rotationTurns * rotationDuration)}s`,
    "--mesh-blade-cycle-duration": `${pulseDuration}s`,
    "--mesh-blade-phase-delay": `${-((wheel.segmentOffset / (Math.PI * 2)) * pulseDuration)}s`,
    "--mesh-wheel-animation-play-state": props.paused ? "paused" : "running",
  }
}

function bladeStyle(wheel: MeshWheel, bladeIndex: number) {
  const cwPos = DURABLE_STREAMS_ACTIVATION_ORDER.indexOf(bladeIndex)
  const pulseRate = Math.max(0.0001, props.segmentPulse * 2.2)
  const stepDuration = 1 / pulseRate
  return {
    "--mesh-blade-strength": String(bladeStrengthAtPhase(wheel, bladeIndex)),
    "--mesh-blade-delay": `${-(cwPos >= 0 ? cwPos * stepDuration : 0)}s`,
  }
}

function radialFade(x: number, y: number): number {
  if (props.noEdgeFade) return 1
  const cx = size.value.w / 2
  const cy = size.value.h / 2
  const dx = Math.abs(x - cx) / (size.value.w / 2)
  const dy = Math.abs(y - cy) / (size.value.h / 2)
  const d = Math.max(dx, dy)
  if (d < 0.3) return 1
  return Math.max(0, 1 - (d - 0.3) / 0.7)
}

interface CornerArcInfo {
  radius: number
  center?: { x: number; y: number }
}

function traceLineArcPath(
  target: CanvasRenderingContext2D,
  points: readonly { x: number; y: number }[],
  corners: readonly CornerArcInfo[] | undefined,
  fallbackRadius: number
) {
  if (points.length === 0) return
  target.beginPath()
  target.moveTo(points[0].x, points[0].y)
  if (points.length === 1) return
  if (points.length === 2) {
    target.lineTo(points[1].x, points[1].y)
    return
  }
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    const next = points[i + 1]
    const inDx = cur.x - prev.x
    const inDy = cur.y - prev.y
    const outDx = next.x - cur.x
    const outDy = next.y - cur.y
    const inLen = Math.hypot(inDx, inDy)
    const outLen = Math.hypot(outDx, outDy)
    if (inLen < 0.001 || outLen < 0.001) {
      target.lineTo(cur.x, cur.y)
      continue
    }
    const corner = corners?.[i]
    const requested =
      corner && corner.radius > 0 ? corner.radius : fallbackRadius
    const cross = inDx * outDy - inDy * outDx
    if (Math.abs(cross) < 0.001 || requested <= 0.001) {
      target.lineTo(cur.x, cur.y)
      continue
    }
    if (corner && corner.center) {
      // Wheel-hug arc: use the supplied center and radius. Draw from the
      // tangent point on the inbound segment around to the tangent point on
      // the outbound segment.
      const cx = corner.center.x
      const cy = corner.center.y
      const inUx = inDx / inLen
      const inUy = inDy / inLen
      const outUx = outDx / outLen
      const outUy = outDy / outLen
      // Project center onto the inbound line (from prev to cur) to find the
      // closest point; the tangent point lies along the perpendicular at
      // distance `radius` from the line, clamped to the segment.
      const t1 = (cx - prev.x) * inUx + (cy - prev.y) * inUy
      const tangentInX = prev.x + inUx * t1
      const tangentInY = prev.y + inUy * t1
      const t2 = (cx - cur.x) * outUx + (cy - cur.y) * outUy
      const tangentOutX = cur.x + outUx * t2
      const tangentOutY = cur.y + outUy * t2
      target.lineTo(tangentInX, tangentInY)
      const startAngle = Math.atan2(tangentInY - cy, tangentInX - cx)
      const endAngle = Math.atan2(tangentOutY - cy, tangentOutX - cx)
      // Direction: cross > 0 means we turn left (counterclockwise in screen
      // y-down means actual canvas-arc anticlockwise = true).
      target.arc(cx, cy, corner.radius, startAngle, endAngle, cross > 0)
      target.lineTo(next.x, next.y)
      continue
    }
    // Standard rounded corner — let canvas auto-derive the arc center from
    // the two tangent segments and the requested radius. For parallel offset
    // lanes that share the same angle bisector at this corner, varying the
    // radius produces concentric arcs around the corridor's pivot.
    const r = Math.max(0.5, Math.min(requested, inLen / 2, outLen / 2))
    target.arcTo(cur.x, cur.y, next.x, next.y, r)
  }
  const last = points[points.length - 1]
  target.lineTo(last.x, last.y)
}

function drawGlowDot(
  x: number,
  y: number,
  radius: number,
  alpha: number
) {
  if (!ctx || alpha <= 0.01) return
  const fade = radialFade(x, y)
  const a = alpha * fade
  if (a <= 0.01) return
  if (props.glow) {
    const glowR = radius * 4.4
    const glow = ctx.createRadialGradient(x, y, 0, x, y, glowR)
    glow.addColorStop(0, `rgba(117, 251, 253, ${a * 0.46})`)
    glow.addColorStop(1, `rgba(117, 251, 253, 0)`)
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(x, y, glowR, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = `rgba(117, 251, 253, ${a})`
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
}

function drawCanvas(timeSec: number) {
  if (!ctx) return
  ensureCanvasSize()
  ctx.clearRect(0, 0, size.value.w, size.value.h)

  for (const track of scene.value.tracks) {
    const mid = sampleAlongTrack(track, 0.5)
    const fade = radialFade(mid.x, mid.y)
    if (fade < 0.02) continue

    traceLineArcPath(ctx, track.points, track.corners, props.cornerRadius)
    ctx.lineCap = "round"
    ctx.lineJoin = "round"
    ctx.strokeStyle = `rgba(117, 251, 253, ${0.12 * fade})`
    ctx.lineWidth = props.trackWidth + 1.15
    ctx.stroke()

    traceLineArcPath(ctx, track.points, track.corners, props.cornerRadius)
    ctx.strokeStyle = `rgba(117, 251, 253, ${0.58 * fade})`
    ctx.lineWidth = props.trackWidth
    ctx.stroke()
  }

  for (const dot of portDots.value) {
    drawGlowDot(dot.point.x, dot.point.y, props.trackWidth * 0.9, 0.7)
  }

  if (props.showMessages) {
    const tailOffsets = [0, 5, 10, 16]
    const tailOpacities = [1, 0.45, 0.2, 0.08]
    for (const seed of messageSeeds.value) {
      const track = trackMap.value.get(seed.trackId)
      if (!track || track.length <= 0) continue
      const direction = seed.reverse ? -1 : 1
      const travel =
        props.animateMessages && !props.paused
          ? (timeSec * seed.speedPx * direction) / track.length
          : 0
      for (let i = tailOffsets.length - 1; i >= 0; i--) {
        const point = sampleAlongTrack(
          track,
          seed.baseFraction + travel - (tailOffsets[i] / track.length) * direction
        )
        drawGlowDot(
          point.x,
          point.y,
          seed.radius * (i === 0 ? 1 : 1 - i * 0.13),
          tailOpacities[i]
        )
      }
    }
  }
}

watch(
  () => [
    scene.value,
    props.trackWidth,
    props.cornerRadius,
    props.glow,
    props.showMessages,
    props.animateMessages,
    props.messageCount,
    props.messageSpeed,
    props.messageScale,
    props.noEdgeFade,
  ],
  () => {
    if (!running) drawCanvas(sceneTime.value)
  },
  { deep: true }
)

function debugCellPath() {
  const step = Math.max(12, props.gridSize)
  const lines: string[] = []
  for (let x = step; x < size.value.w; x += step) {
    lines.push(`M ${x} 0 L ${x} ${size.value.h}`)
  }
  for (let y = step; y < size.value.h; y += step) {
    lines.push(`M 0 ${y} L ${size.value.w} ${y}`)
  }
  return lines.join(" ")
}
</script>

<template>
  <div
    ref="root"
    class="mesh-streams"
    :class="{ 'mesh-streams--edge-fade': !noEdgeFade }"
  >
    <canvas ref="canvas" class="mesh-canvas" />
    <svg
      class="mesh-wheel-layer"
      :viewBox="`0 0 ${scene.width} ${scene.height}`"
      preserveAspectRatio="none"
      aria-label="Mesh of streams"
      role="img"
    >
      <path
        v-if="showDebug"
        :d="debugCellPath()"
        class="mesh-debug-grid"
        vector-effect="non-scaling-stroke"
      />

      <g class="mesh-wheels">
        <g
          v-for="wheel in scene.wheels"
          :key="wheel.id"
          :style="wheelAnimationStyle(wheel)"
          :transform="[
            `translate(${wheel.x} ${wheel.y})`,
            `scale(${wheelScale(wheel)})`,
            `translate(${-DURABLE_STREAMS_WHEEL_VIEWBOX / 2} ${-DURABLE_STREAMS_WHEEL_VIEWBOX / 2})`,
          ].join(' ')"
          class="mesh-wheel"
        >
          <g
            class="mesh-wheel-rotor"
            :class="{ 'mesh-wheel-rotor--animated': rotateWheels && wheelRotationSpeed > 0 }"
          >
            <path
              v-for="(blade, index) in DURABLE_STREAMS_WHEEL_BLADES"
              :key="`${wheel.id}-blade-${index}`"
              :d="blade"
              class="mesh-blade"
              :class="{
                'mesh-blade--on': bladeStrengthAtPhase(wheel, index) > 0.01,
                'mesh-blade--animated': animateSegments && segmentPulse > 0,
              }"
              :style="bladeStyle(wheel, index)"
            />
          </g>
        </g>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.mesh-streams {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.mesh-streams--edge-fade {
  -webkit-mask-image: radial-gradient(
    ellipse 72% 64% at 50% 50%,
    rgba(255, 255, 255, 1) 0 38%,
    rgba(255, 255, 255, 0.92) 55%,
    rgba(255, 255, 255, 0.52) 78%,
    transparent 100%
  );
  mask-image: radial-gradient(
    ellipse 72% 64% at 50% 50%,
    rgba(255, 255, 255, 1) 0 38%,
    rgba(255, 255, 255, 0.92) 55%,
    rgba(255, 255, 255, 0.52) 78%,
    transparent 100%
  );
}

.mesh-canvas,
.mesh-wheel-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.mesh-wheel-layer {
  pointer-events: none;
}

.mesh-wheel-rotor {
  transform-box: fill-box;
  transform-origin: 50% 50%;
  transform: rotate(var(--mesh-wheel-rotation-offset, 0turn));
}

.mesh-wheel-rotor--animated {
  animation-name: mesh-wheel-spin;
  animation-duration: var(--mesh-wheel-rotation-duration, 24s);
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  animation-direction: var(--mesh-wheel-rotation-direction, normal);
  animation-delay: var(--mesh-wheel-phase-delay, 0s);
  animation-play-state: var(--mesh-wheel-animation-play-state, running);
}

.mesh-blade {
  fill: rgba(117, 251, 253, 0.07);
  stroke: rgba(117, 251, 253, 0.22);
  stroke-width: 0.6;
  fill-opacity: 0.07;
  stroke-opacity: 0.22;
  transition:
    fill-opacity 0.4s ease,
    stroke-opacity 0.4s ease,
    filter 0.4s ease;
}

.mesh-blade--on {
  fill-opacity: calc(0.84 * var(--mesh-blade-strength, 1));
  stroke-opacity: calc(0.95 * var(--mesh-blade-strength, 1));
  filter: drop-shadow(
    0 0 4px rgba(117, 251, 253, calc(0.35 * var(--mesh-blade-strength, 1)))
  );
}

.mesh-blade--animated {
  animation-name: mesh-blade-cycle;
  animation-duration: var(--mesh-blade-cycle-duration, 7.2s);
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  animation-delay: calc(
    var(--mesh-blade-phase-delay, 0s) + var(--mesh-blade-delay, 0s)
  );
  animation-play-state: var(--mesh-wheel-animation-play-state, running);
}

.mesh-debug-grid {
  fill: none;
  stroke: rgba(255, 255, 255, 0.08);
  stroke-width: 1;
}

@keyframes mesh-wheel-spin {
  from {
    transform: rotate(var(--mesh-wheel-rotation-offset, 0turn));
  }
  to {
    transform: rotate(calc(var(--mesh-wheel-rotation-offset, 0turn) + 1turn));
  }
}

@keyframes mesh-blade-cycle {
  0%,
  74.999% {
    fill-opacity: 0.84;
    stroke-opacity: 0.95;
    filter: drop-shadow(0 0 4px rgba(117, 251, 253, 0.35));
  }
  81.25% {
    fill-opacity: 0.63;
    stroke-opacity: 0.74;
    filter: drop-shadow(0 0 4px rgba(117, 251, 253, 0.24));
  }
  87.5% {
    fill-opacity: 0.42;
    stroke-opacity: 0.52;
    filter: drop-shadow(0 0 3px rgba(117, 251, 253, 0.14));
  }
  93.75% {
    fill-opacity: 0.21;
    stroke-opacity: 0.29;
    filter: drop-shadow(0 0 2px rgba(117, 251, 253, 0.07));
  }
  100% {
    fill-opacity: 0.07;
    stroke-opacity: 0.22;
    filter: none;
  }
}
</style>
