<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

/* StreamBanner — the animated "users-and-agents-on-a-stream"
   banner used as a visual leitmotif on the homepage. Two ranks
   of small SVG silhouettes (users above, agents below) bracket
   a single horizontal sync stream painted on a canvas behind
   them. The canvas conventions match `StreamFlowBg` exactly:
   hairline 1px geometry, dashed [2,6] rail, tick marks every
   80px, comet-trail tokens, brand-teal palette.

   Notification branches are *triggered by tokens*, not by an
   independent timer: when a token traverses past an entity's x
   position it has a probability of fanning a short branch from
   the rail to that entity. Visually the stream itself looks
   like it's broadcasting notifications to nearby consumers as
   each message flows past. Initial state is pre-seeded so the
   banner reads as a busy collaboration channel from the very
   first frame, not an empty rail slowly filling up.

   The component is self-contained: own intersection observer
   (so the loop only runs while the banner is on-screen), own
   resize observer (so layout follows the parent), own
   reduced-motion fallback. It exposes no props — width is
   100% of the parent, height is fixed by the breakpoint rules
   in this file. Parents control the surrounding spacing. */

const bannerRef = ref<HTMLDivElement>()
const canvasRef = ref<HTMLCanvasElement>()
const userRefs = ref<HTMLElement[]>([])
const agentRefs = ref<HTMLElement[]>([])

/* ─── Entity layout ────────────────────────────────────────────
   Two dense ranks: ten users along the top, nine agents along
   the bottom offset by half a step so the two ranks visually
   interleave. Positions are inset within the entity column so
   the leftmost and rightmost silhouettes never sit on the gutter
   (which made them clip half-out-of-frame at viewport widths
   where the column reaches max-width). */
const userCount = 10
const agentCount = 9
const ENTITY_INSET = 3 /* % from each side */
const userPositions = Array.from(
  { length: userCount },
  (_, i) => ENTITY_INSET + ((100 - 2 * ENTITY_INSET) * i) / (userCount - 1)
)
const agentPositions = Array.from(
  { length: agentCount },
  (_, i) =>
    ENTITY_INSET + ((100 - 2 * ENTITY_INSET) * (i + 0.5)) / (userCount - 1)
)

/* ─── Canvas animation state ─────────────────────────────────── */
let dpr = 1
let cw = 0
let ch = 0
let raf = 0
let running = false
let last = 0

interface Delivery {
  /* x position on the canvas where the token will fan out a
     notification to this entity. */
  x: number
  type: 'user' | 'agent'
  idx: number
}

interface Token {
  x: number
  speed: number
  age: number
  trail: number
  /* Sorted ascending by `x`. As the token advances we shift
     deliveries off the front whenever its current x crosses
     each scheduled delivery. */
  deliveries: Delivery[]
}
const tokens: Token[] = []
let nextSpawn = 400

interface Branch {
  x: number
  endY: number
  life: number
  totalLife: number
  arrived: boolean
  pulse: number
  dir: 1 | -1
  hit: { type: 'user' | 'agent'; idx: number; pulsed: boolean }
}
const branches: Branch[] = []

const BRANCH_LIFE = 1100
const BRANCH_ARRIVE_AT = 200

/* Probability that a token will deliver a notification to any
   given entity as it passes that entity's x position. ~0.3 keeps
   the visual lively (a typical token will fan out to ~5–6 of the
   19 entities on its journey across) without overwhelming the
   eye with constant branching everywhere at once. */
const DELIVERY_PROB = 0.3

function pulseEntityEl(type: 'user' | 'agent', idx: number) {
  const arr = type === 'user' ? userRefs.value : agentRefs.value
  const el = arr[idx]
  if (!el) return
  el.classList.add('hit')
  window.setTimeout(() => el?.classList.remove('hit'), 500)
}

function entityCanvasPos(
  el: HTMLElement,
  canvasRect: DOMRect,
  side: 'top' | 'bottom'
): { x: number; y: number } {
  const r = el.getBoundingClientRect()
  return {
    x: r.left + r.width / 2 - canvasRect.left,
    y:
      side === 'top'
        ? r.bottom - canvasRect.top + 1
        : r.top - canvasRect.top - 1,
  }
}

function buildDeliveries(canvasRect: DOMRect, fromX: number): Delivery[] {
  const out: Delivery[] = []
  userRefs.value.forEach((el, idx) => {
    if (!el || Math.random() > DELIVERY_PROB) return
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2 - canvasRect.left
    if (x > fromX) out.push({ x, type: 'user', idx })
  })
  agentRefs.value.forEach((el, idx) => {
    if (!el || Math.random() > DELIVERY_PROB) return
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2 - canvasRect.left
    if (x > fromX) out.push({ x, type: 'agent', idx })
  })
  out.sort((a, b) => a.x - b.x)
  return out
}

function spawnBranchFor(
  canvasRect: DOMRect,
  d: Delivery,
  preLife = BRANCH_LIFE
): void {
  const arr = d.type === 'user' ? userRefs.value : agentRefs.value
  const el = arr[d.idx]
  if (!el) return
  const pos = entityCanvasPos(
    el,
    canvasRect,
    d.type === 'user' ? 'top' : 'bottom'
  )
  branches.push({
    x: d.x,
    endY: pos.y,
    life: preLife,
    totalLife: BRANCH_LIFE,
    arrived: false,
    pulse: 0,
    dir: d.type === 'user' ? -1 : 1,
    hit: { type: d.type, idx: d.idx, pulsed: false },
  })
}

let resizeObs: ResizeObserver | null = null
let intersectionObs: IntersectionObserver | null = null

onMounted(() => {
  if (!bannerRef.value || !canvasRef.value) return
  const ctx = canvasRef.value.getContext('2d')
  if (!ctx) return

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function isDark() {
    return (
      typeof document !== 'undefined' &&
      document.documentElement.classList.contains('dark')
    )
  }

  /* Brand teal — same palette family as `StreamFlowBg`. */
  function railColor(alpha: number): string {
    const dark = isDark()
    const g = dark ? 210 : 180
    const b = dark ? 190 : 160
    return `rgba(0,${g},${b},${alpha})`
  }

  function layout() {
    if (!bannerRef.value || !canvasRef.value) return
    dpr = window.devicePixelRatio || 1
    cw = bannerRef.value.clientWidth
    ch = bannerRef.value.clientHeight
    canvasRef.value.width = Math.max(1, Math.floor(cw * dpr))
    canvasRef.value.height = Math.max(1, Math.floor(ch * dpr))
    canvasRef.value.style.width = cw + 'px'
    canvasRef.value.style.height = ch + 'px'
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function drawRail() {
    if (cw <= 0 || ch <= 0) return
    const y = ch / 2
    /* Hairline dashed rail full-width. */
    ctx!.save()
    ctx!.lineWidth = 1
    ctx!.setLineDash([2, 6])
    ctx!.strokeStyle = railColor(0.18)
    ctx!.beginPath()
    ctx!.moveTo(0, y)
    ctx!.lineTo(cw, y)
    ctx!.stroke()
    ctx!.restore()

    /* Tick marks every 80px, phase-shifted from the rail's y so
       they don't grid-align between rails (here only one rail,
       but we keep the same convention for visual cohesion). */
    ctx!.save()
    ctx!.lineWidth = 1
    const phase = (y * 13.7) % 80
    for (let x = -phase; x < cw; x += 80) {
      if (x < 0) continue
      ctx!.strokeStyle = railColor(0.22)
      ctx!.beginPath()
      ctx!.moveTo(x, y - 2.5)
      ctx!.lineTo(x, y + 2.5)
      ctx!.stroke()
    }
    ctx!.restore()
  }

  function drawToken(t: Token) {
    const y = ch / 2
    const a = t.age
    if (a < 0.02) return

    /* Comet tail — gradient stroke that fades into the rail
       behind the token's leading edge. */
    const grad = ctx!.createLinearGradient(t.x - t.trail, y, t.x, y)
    grad.addColorStop(0, railColor(0))
    grad.addColorStop(1, railColor(0.55 * a))
    ctx!.strokeStyle = grad
    ctx!.lineWidth = 1.4
    ctx!.lineCap = 'round'
    ctx!.beginPath()
    ctx!.moveTo(t.x - t.trail, y)
    ctx!.lineTo(t.x, y)
    ctx!.stroke()

    /* Soft glow halo around the leading edge. */
    const gr = 10
    const glow = ctx!.createRadialGradient(t.x, y, 0, t.x, y, gr)
    glow.addColorStop(0, railColor(0.45 * a))
    glow.addColorStop(1, railColor(0))
    ctx!.fillStyle = glow
    ctx!.beginPath()
    ctx!.arc(t.x, y, gr, 0, Math.PI * 2)
    ctx!.fill()

    /* Solid centre dot. */
    ctx!.fillStyle = railColor(0.92 * a)
    ctx!.beginPath()
    ctx!.arc(t.x, y, 2.6, 0, Math.PI * 2)
    ctx!.fill()
  }

  function drawBranch(b: Branch) {
    const lifeP = b.life / b.totalLife
    if (lifeP < 0.02) return
    const a = lifeP

    /* The branch line draws progressively from the rail toward
       the entity over the first ~18% of its lifespan, then sits
       full-length until it fades. */
    const railY = ch / 2
    const startY = railY + b.dir * 4
    const endY = b.endY
    const elapsedFrac = 1 - lifeP
    const drawFrac = Math.min(1, elapsedFrac / 0.18)
    const currentEndY = startY + (endY - startY) * drawFrac

    ctx!.save()
    ctx!.strokeStyle = railColor(0.32 * a)
    ctx!.lineWidth = 1
    ctx!.setLineDash([1, 3])
    ctx!.beginPath()
    ctx!.moveTo(b.x, startY)
    ctx!.lineTo(b.x, currentEndY)
    ctx!.stroke()
    ctx!.restore()

    /* Consumer marker — open ring with a centre dot once the
       branch has "arrived" at the entity (BRANCH_ARRIVE_AT ms of
       life is travel; the rest is settled / pulsing). */
    if (b.arrived) {
      const pulse = b.pulse > 0 ? b.pulse / 500 : 0
      const r = 3 + pulse * 4
      ctx!.strokeStyle = railColor(0.55 * a + pulse * 0.35)
      ctx!.lineWidth = 1
      ctx!.beginPath()
      ctx!.arc(b.x, endY, r, 0, Math.PI * 2)
      ctx!.stroke()
      ctx!.fillStyle = railColor(0.7 * a)
      ctx!.beginPath()
      ctx!.arc(b.x, endY, 1.6, 0, Math.PI * 2)
      ctx!.fill()
    }
  }

  function spawnToken(canvasRect: DOMRect, x = -16, age = 0): Token {
    const t: Token = {
      x,
      speed: 100 + Math.random() * 75,
      age,
      trail: 16 + Math.random() * 18,
      deliveries: buildDeliveries(canvasRect, x),
    }
    tokens.push(t)
    return t
  }

  function processDeliveries(canvasRect: DOMRect, t: Token) {
    while (t.deliveries.length > 0 && t.x >= t.deliveries[0].x) {
      const d = t.deliveries.shift()!
      /* Only fire once the token is actually visible; otherwise
         a token spawning offscreen-left could fire branches with
         an invisible source. */
      if (t.age >= 0.4) spawnBranchFor(canvasRect, d)
    }
  }

  function tick(now: number) {
    if (!running || !canvasRef.value) return
    const dt = Math.min(now - last, 60)
    last = now
    const canvasRect = canvasRef.value.getBoundingClientRect()

    ctx!.clearRect(0, 0, cw, ch)
    drawRail()

    /* ── Tokens (always streaming along the rail) ───────────── */
    nextSpawn -= dt
    if (nextSpawn <= 0) {
      spawnToken(canvasRect)
      nextSpawn = 700 + Math.random() * 900
    }
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i]
      t.x += t.speed * (dt / 1000)
      if (t.age < 1) t.age = Math.min(1, t.age + dt / 180)
      if (t.x > cw - 24) t.age = Math.max(0, t.age - dt / 200)
      processDeliveries(canvasRect, t)
      if (t.x > cw + 30 || t.age <= 0) {
        tokens.splice(i, 1)
      } else {
        drawToken(t)
      }
    }

    /* ── Branches (lifecycle tick + draw) ────────────────────── */
    for (let i = branches.length - 1; i >= 0; i--) {
      const b = branches[i]
      b.life -= dt
      if (b.life <= 0) {
        branches.splice(i, 1)
        continue
      }
      if (!b.arrived && b.totalLife - b.life > BRANCH_ARRIVE_AT) {
        b.arrived = true
        b.pulse = 500
        if (!b.hit.pulsed) {
          b.hit.pulsed = true
          pulseEntityEl(b.hit.type, b.hit.idx)
        }
      }
      if (b.pulse > 0) b.pulse = Math.max(0, b.pulse - dt)
      drawBranch(b)
    }

    raf = requestAnimationFrame(tick)
  }

  function seedInProgress() {
    /* Pre-populate tokens spread across the rail with full
       opacity, plus a handful of branches mid-lifecycle, so the
       first frame already looks like a busy collaboration
       channel rather than an empty rail slowly filling up.

       Each seed token still gets a fresh delivery list (filtered
       to entities ahead of its current x) so it will continue to
       fan out notifications on its remaining journey. */
    if (!canvasRef.value) return
    const canvasRect = canvasRef.value.getBoundingClientRect()
    const seedTokenXs = [0.14, 0.34, 0.55, 0.74, 0.9]
    seedTokenXs.forEach((frac) => {
      const x = cw * frac + (Math.random() - 0.5) * 24
      spawnToken(canvasRect, x, 1)
    })

    const allEntities: Delivery[] = []
    userRefs.value.forEach((el, idx) => {
      if (!el) return
      const r = el.getBoundingClientRect()
      allEntities.push({
        x: r.left + r.width / 2 - canvasRect.left,
        type: 'user',
        idx,
      })
    })
    agentRefs.value.forEach((el, idx) => {
      if (!el) return
      const r = el.getBoundingClientRect()
      allEntities.push({
        x: r.left + r.width / 2 - canvasRect.left,
        type: 'agent',
        idx,
      })
    })
    /* A few in-flight branches (already past their arrival
       point) so the silhouettes are demonstrably "receiving" on
       first paint. */
    const seedBranchCount = 4
    for (let i = 0; i < seedBranchCount; i++) {
      const d = allEntities[Math.floor(Math.random() * allEntities.length)]
      if (!d) continue
      const arrivedFor = 100 + Math.random() * 600
      const life = Math.max(50, BRANCH_LIFE - BRANCH_ARRIVE_AT - arrivedFor)
      const b: Branch = {
        x: d.x,
        endY: 0,
        life,
        totalLife: BRANCH_LIFE,
        arrived: true,
        pulse: 0,
        dir: d.type === 'user' ? -1 : 1,
        hit: { type: d.type, idx: d.idx, pulsed: true },
      }
      const arr = d.type === 'user' ? userRefs.value : agentRefs.value
      const el = arr[d.idx]
      if (el) {
        const pos = entityCanvasPos(
          el,
          canvasRect,
          d.type === 'user' ? 'top' : 'bottom'
        )
        b.endY = pos.y
        branches.push(b)
      }
    }
  }

  function start() {
    if (running) return
    running = true
    last = performance.now()
    /* Seed only on the very first start (when the arrays are
       empty); subsequent re-starts (e.g. on intersection
       re-entry) keep whatever's left mid-flight. */
    if (tokens.length === 0 && branches.length === 0) {
      seedInProgress()
    }
    raf = requestAnimationFrame(tick)
  }
  function stop() {
    running = false
    cancelAnimationFrame(raf)
  }

  function drawStaticFrame() {
    /* Single static paint for `prefers-reduced-motion` and any
       transient pre-animation frame. Rail + a sprinkling of
       frozen tokens at evenly distributed positions so the
       reduced-motion view still reads as a stream. */
    layout()
    ctx!.clearRect(0, 0, cw, ch)
    drawRail()
    const seedCount = 5
    for (let i = 0; i < seedCount; i++) {
      const x = cw * (0.12 + 0.18 * i)
      drawToken({ x, speed: 0, age: 1, trail: 18, deliveries: [] })
    }
  }

  layout()

  if (reduced) {
    drawStaticFrame()
    resizeObs = new ResizeObserver(() => drawStaticFrame())
    resizeObs.observe(bannerRef.value)
    return
  }

  resizeObs = new ResizeObserver(() => layout())
  resizeObs.observe(bannerRef.value)

  /* Only burn cycles while the banner is on-screen — leaving an
     animation loop running while the user is looking elsewhere
     on a long page is wasteful. */
  intersectionObs = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) start()
      else stop()
    },
    { threshold: 0 }
  )
  intersectionObs.observe(bannerRef.value)
})

onUnmounted(() => {
  if (resizeObs) resizeObs.disconnect()
  if (intersectionObs) intersectionObs.disconnect()
  running = false
  cancelAnimationFrame(raf)
})
</script>

<template>
  <div ref="bannerRef" class="stream-banner md-exclude" aria-hidden="true">
    <canvas ref="canvasRef" class="stream-banner-canvas" />
    <div class="stream-banner-entities">
      <div
        v-for="(pos, i) in userPositions"
        :key="`u-${i}`"
        ref="userRefs"
        class="entity entity-user"
        :style="{ left: `${pos}%` }"
      >
        <svg viewBox="0 0 18 16" width="18" height="16">
          <circle cx="9" cy="5" r="3.4" />
          <path d="M 3 16 Q 9 9 15 16" />
        </svg>
      </div>
      <div
        v-for="(pos, i) in agentPositions"
        :key="`a-${i}`"
        ref="agentRefs"
        class="entity entity-agent"
        :style="{ left: `${pos}%` }"
      >
        <svg viewBox="0 0 18 12" width="18" height="12">
          <rect x="2" y="1" width="14" height="10" rx="2.5" />
          <circle class="agent-eye" cx="6.5" cy="6" r="1.1" />
          <circle class="agent-eye" cx="11.5" cy="6" r="1.1" />
        </svg>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Banner height is sized to fit the silhouettes + a tight ~20px
   branch on either side of the centred rail, with effectively no
   dead space above/below the entities. The math at the desktop
   size: SVGs are 16px (user) and 12px (agent) tall, the rail
   sits at h/2 = 40px, the entities are inset 2px from the
   top/bottom edges, leaving branches of ~20px (user) and ~26px
   (agent). The narrower breakpoints scale the banner down
   proportionally while keeping the same 2px outer inset. */
.stream-banner {
  position: relative;
  width: 100%;
  height: 80px;
}
.stream-banner-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.stream-banner-entities {
  position: relative;
  height: 100%;
  max-width: 1152px;
  margin: 0 auto;
  padding: 0 24px;
  pointer-events: none;
}
.entity {
  position: absolute;
  transform: translateX(-50%);
  color: color-mix(in srgb, var(--vp-c-brand-1) 55%, var(--ea-text-2));
  transition:
    color 0.35s ease-out,
    transform 0.22s ease-out;
}
.entity.hit {
  color: var(--vp-c-brand-1);
  transform: translateX(-50%) scale(1.2);
}
.entity svg {
  display: block;
}
/* Entities sit ~2px off the banner's outer edges so the
   silhouettes are flush with the canvas without literally
   touching the seam. The distance from each silhouette to the
   centred rail (= branch length) falls out of `banner.height /
   2 - inset - svgHeight`, which the banner-height rule above
   tunes for a ~20px branch on either side. */
.entity-user {
  top: 2px;
}
.entity-user svg circle,
.entity-user svg path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.entity-agent {
  bottom: 2px;
}
/* The rail never passes behind a silhouette in this tight
   geometry (entities are well clear of the centre), so the
   agent rect carries no fill — it sits as a pure outline
   against whatever background the parent provides. This keeps
   the banner background-agnostic so it can be dropped on any
   surface (sidebar bg, brand-tinted gradient, …) without
   hand-tuning a fill colour to match. */
.entity-agent svg rect {
  fill: none;
  stroke: currentColor;
  stroke-width: 1;
}
.entity-agent .agent-eye {
  fill: currentColor;
  stroke: none;
}

@media (max-width: 768px) {
  .stream-banner {
    height: 72px;
  }
}
@media (max-width: 480px) {
  .stream-banner {
    height: 64px;
  }
  .entity-user svg,
  .entity-agent svg {
    transform: scale(0.85);
  }
}
</style>
