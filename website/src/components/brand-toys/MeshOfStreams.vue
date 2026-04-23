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

// Animated when ANY of the per-frame visual elements need to update.
// Previously this only checked message animation; once the wheels moved off
// SVG and onto canvas we also need rAF whenever the wheel rotor or the
// per-blade segment pulse is enabled, otherwise the canvas would paint a
// single static frame and never advance.
const animated = computed(() => {
  if (props.paused) return false
  if (
    props.animateMessages &&
    props.showMessages &&
    props.messageSpeed > 0
  )
    return true
  if (props.animateSegments && props.segmentPulse > 0) return true
  if (props.rotateWheels && props.wheelRotationSpeed > 0) return true
  return false
})

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

// One-shot Path2D cache for the wheel blade SVG paths. Compiling the path
// strings into Path2D objects up front lets us re-use them every frame
// across every wheel without re-parsing.
let bladePath2Ds: Path2D[] | null = null
function getBladePath2Ds(): Path2D[] {
  if (!bladePath2Ds) {
    bladePath2Ds = DURABLE_STREAMS_WHEEL_BLADES.map((d) => new Path2D(d))
  }
  return bladePath2Ds
}

const BLADE_INDEX_TO_CW_POS: number[] = (() => {
  const out: number[] = new Array(DURABLE_STREAMS_WHEEL_BLADES.length).fill(-1)
  for (let i = 0; i < DURABLE_STREAMS_ACTIVATION_ORDER.length; i++) {
    out[DURABLE_STREAMS_ACTIVATION_ORDER[i]] = i
  }
  return out
})()

// Given a wheel and a time, compute the activation "head" — the cw position
// at which a blade is currently at peak strength. Older positions fade out
// linearly over DURABLE_STREAMS_FADE_TAIL steps.
function wheelHeadAt(wheel: MeshWheel, timeSec: number): number {
  const cycle = DURABLE_STREAMS_ACTIVATION_ORDER.length
  const baseHead = (wheel.segmentOffset / (Math.PI * 2)) * cycle
  const pulseRate = Math.max(0.0001, props.segmentPulse * 2.2)
  const head =
    props.animateSegments && !props.paused
      ? baseHead + timeSec * pulseRate
      : baseHead
  return ((head % cycle) + cycle) % cycle
}

function wheelRotationAt(wheel: MeshWheel, timeSec: number): number {
  if (props.paused || !props.rotateWheels || props.wheelRotationSpeed <= 0) {
    return wheel.rotationOffset
  }
  return (
    wheel.rotationOffset +
    timeSec * wheel.rotationRate * props.wheelRotationSpeed
  )
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

function drawWheels(timeSec: number) {
  if (!ctx) return
  const blades = getBladePath2Ds()
  const cycle = DURABLE_STREAMS_ACTIVATION_ORDER.length
  const cutoff = cycle - DURABLE_STREAMS_FADE_TAIL
  // Pre-compute per-blade strength buckets so we only string-format two
  // alpha values per draw rather than per blade. With 14 wheels × 16
  // blades = 224 paths/frame the string allocations alone were measurable
  // in flame charts.
  const teal = "117, 251, 253"
  for (const wheel of scene.value.wheels) {
    const fade = radialFade(wheel.x, wheel.y)
    if (fade < 0.02) continue
    const head = wheelHeadAt(wheel, timeSec)
    const rotation = wheelRotationAt(wheel, timeSec)
    const scale = (wheel.r * 2) / DURABLE_STREAMS_WHEEL_VIEWBOX
    ctx!.save()
    ctx!.translate(wheel.x, wheel.y)
    ctx!.rotate(rotation)
    ctx!.scale(scale, scale)
    ctx!.translate(
      -DURABLE_STREAMS_WHEEL_VIEWBOX / 2,
      -DURABLE_STREAMS_WHEEL_VIEWBOX / 2
    )
    // Stroke width 0.6 in viewBox units matches the previous SVG styling
    // (CSS used `stroke-width: 0.6` against the same viewBox).
    ctx!.lineWidth = 0.6
    for (let bladeIndex = 0; bladeIndex < blades.length; bladeIndex++) {
      const cwPos = BLADE_INDEX_TO_CW_POS[bladeIndex]
      let strength = 0
      if (cwPos !== -1) {
        const age = (head - cwPos + cycle) % cycle
        if (age < cutoff) strength = 1
        else strength = Math.max(0, (cycle - age) / DURABLE_STREAMS_FADE_TAIL)
      }
      const fillAlpha = (0.07 + 0.88 * strength) * fade
      const strokeAlpha = (0.22 + 0.78 * strength) * fade
      ctx!.fillStyle = `rgba(${teal}, ${fillAlpha})`
      ctx!.strokeStyle = `rgba(${teal}, ${strokeAlpha})`
      ctx!.fill(blades[bladeIndex])
      ctx!.stroke(blades[bladeIndex])
    }
    ctx!.restore()
  }
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

  drawWheels(timeSec)

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
    // Wheels are drawn on canvas now, so changes to wheel-related props
    // also need to trigger a static redraw when the rAF loop isn't running.
    props.rotateWheels,
    props.wheelRotationSpeed,
    props.animateSegments,
    props.segmentPulse,
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
      v-if="showDebug"
      class="mesh-debug-layer"
      :viewBox="`0 0 ${scene.width} ${scene.height}`"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        :d="debugCellPath()"
        class="mesh-debug-grid"
        vector-effect="non-scaling-stroke"
      />
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
.mesh-debug-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.mesh-debug-layer {
  pointer-events: none;
}

.mesh-debug-grid {
  fill: none;
  stroke: rgba(255, 255, 255, 0.08);
  stroke-width: 1;
}
</style>
