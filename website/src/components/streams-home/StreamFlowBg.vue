<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue"

// Hero background that conveys the Durable Streams mental model:
//   parallel append-only logs with events streaming left → right,
//   anchored offsets visible as tick marks, occasional consumers
//   branching off to "tail" the stream.
//
// Visual conventions match the Agents/Sync hero backgrounds:
//   - hairline 1px geometry on a dark teal palette
//   - dense enough to read as "infrastructure", not noise
//   - radial fade so the headline copy sits on a quiet centre
//   - hover tooltips + click-to-burst for tactile life

const props = withDefaults(
  defineProps<{
    excludeEl?: HTMLElement
    // When true, no new comet tokens auto-spawn on rails. Existing
    // tokens still finish their travel, hover labels still appear,
    // and clicking still produces a burst. Used by the homepage
    // section graphics to dial back ambient activity.
    paused?: boolean
    // When true, the radial edge-fade that softens rails near the
    // canvas borders is disabled, so the rails fill the whole frame
    // at full intensity. Used by the homepage iso-stack hero where
    // the canvas already sits inside a crisp bordered card.
    noEdgeFade?: boolean
    // Multiplier on rail count. 1 reproduces the live `h/70`
    // formula (5–8 rails). 2 packs in twice as many; 0.5 halves.
    density?: number
    // Hard cap on the rail count regardless of density. The live
    // hero clamps at 8.
    maxRails?: number
    // Multiplier on ambient token spawn rate per rail. 1 keeps the
    // live 2.8–5.2 s spawn interval; 2 doubles the rate, 0.5 halves
    // it. 0 freezes ambient spawns.
    activity?: number
    // Multiplier on per-token rail speed. 1 reproduces the live
    // 55–110 px/s base range; raise for snappier comets.
    tokenSpeed?: number
    // Multiplier on branch (consumer fan-out) frequency. 1 keeps
    // the live 3–8 s interval per rail; raise for more branching.
    branchActivity?: number
  }>(),
  {
    density: 1,
    maxRails: 8,
    activity: 1,
    tokenSpeed: 1,
    branchActivity: 1,
  },
)

const canvas = ref<HTMLCanvasElement>()
const tooltip = ref<HTMLDivElement>()
let raf = 0
let running = false

const STREAM_NAMES = [
  "chat",
  "agent",
  "tokens",
  "events",
  "audit",
  "tasks",
  "ingest",
  "logs",
  "plan",
  "trace",
]

interface Rail {
  y: number
  // tokens travel left → right at this rail's y
  tokens: Token[]
  // ms until next spawn
  nextSpawn: number
  // base spawn interval (ms)
  spawnInterval: number
  // px/sec base speed for this rail
  speed: number
  // visible label for hover
  name: string
  // monotonically increasing offset counter for this rail
  offsetCounter: number
  // branches dropping off to consumers below (or above)
  branches: Branch[]
  // ms until next branch
  nextBranch: number
}

interface Token {
  x: number
  speed: number
  // 0..1 birth/death easing
  age: number
  // length of trailing comet tail in px
  trail: number
  // unique offset value carried by this token
  offset: number
}

interface Branch {
  startX: number
  consumerY: number
  life: number
  totalLife: number
  arrived: boolean
  pulse: number
  // direction: +1 below the rail, -1 above
  dir: number
}

interface ExcludeRect {
  left: number
  top: number
  right: number
  bottom: number
}

function hitsExclusion(
  x: number,
  y: number,
  zones: ExcludeRect[],
  margin: number
): boolean {
  for (const z of zones) {
    if (
      x >= z.left - margin &&
      x <= z.right + margin &&
      y >= z.top - margin &&
      y <= z.bottom + margin
    )
      return true
  }
  return false
}

function railVisible(
  y: number,
  zones: ExcludeRect[],
  margin: number
): { left: number; right: number } | null {
  // Returns null if the entire rail row is occluded by an exclusion;
  // otherwise returns the widest hit-window for hover.
  for (const z of zones) {
    if (y >= z.top - margin && y <= z.bottom + margin) {
      // partial hit — caller still iterates pixel-by-pixel
      return { left: z.left, right: z.right }
    }
  }
  return null
}

onMounted(() => {
  const el = canvas.value
  const tt = tooltip.value
  if (!el || !tt) return
  const ctx = el.getContext("2d")
  if (!ctx) return

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches

  let dpr = 1
  let w = 0
  let h = 0
  let rails: Rail[] = []
  let exclusions: ExcludeRect[] = []
  let last = 0
  let elapsed = 0
  let hoveredRail = -1
  let hoveredToken: { rail: number; idx: number } | null = null

  function getTextRects(element: Element): DOMRect[] {
    const rects: DOMRect[] = []
    const range = document.createRange()
    const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let textNode: Text | null
    while ((textNode = walk.nextNode() as Text | null)) {
      if (!textNode.textContent?.trim()) continue
      range.selectNodeContents(textNode)
      const nodeRects = range.getClientRects()
      for (let i = 0; i < nodeRects.length; i++) {
        rects.push(nodeRects[i])
      }
    }
    element
      .querySelectorAll("a, button, svg, img, input, .ds-hero-install")
      .forEach((child) => {
        const r = child.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) rects.push(r)
      })
    return rects
  }

  function measureExclusions(): ExcludeRect[] {
    const zones: ExcludeRect[] = []
    const excEl = props.excludeEl
    if (!excEl || !el!.parentElement) return zones
    const origin = el!.parentElement!.getBoundingClientRect()
    const rects = getTextRects(excEl)
    for (const r of rects) {
      if (r.width === 0 && r.height === 0) continue
      zones.push({
        left: r.left - origin.left,
        top: r.top - origin.top,
        right: r.right - origin.left,
        bottom: r.bottom - origin.top,
      })
    }
    return zones
  }

  function buildRails() {
    rails = []
    // Comfortably spaced, ~70px apart — fewer rails, more breathing
    // room. `density` scales the rail count produced by `h/70` (and
    // `maxRails` overrides the upper clamp). Floor at 2 so a tiny
    // canvas still has rails to draw.
    const densityMul = Math.max(0.1, props.density)
    const cap = Math.max(2, Math.floor(props.maxRails))
    const target = Math.max(2, Math.min(cap, Math.floor((h * densityMul) / 70)))
    const padTop = 32
    const padBottom = 40
    const usable = h - padTop - padBottom
    const shuffled = [...STREAM_NAMES].sort(() => Math.random() - 0.5)
    const speedMul = Math.max(0.05, props.tokenSpeed)
    const branchMul = Math.max(0.05, props.branchActivity)
    for (let i = 0; i < target; i++) {
      const y = padTop + (usable * (i + 0.5)) / target
      // Each rail has its own personality: faster ones spawn more often.
      const speed = (55 + Math.random() * 55) * speedMul
      const spawnInterval = 2800 + Math.random() * 2400
      const rail: Rail = {
        y,
        tokens: [],
        nextSpawn: 600 + Math.random() * spawnInterval,
        spawnInterval,
        speed,
        name: shuffled[i % shuffled.length],
        offsetCounter: Math.floor(Math.random() * 0xffff),
        branches: [],
        // Pre-divide by `branchMul` so a high branchActivity makes
        // the very first branch appear sooner too, not just future
        // ones.
        nextBranch: (2000 + Math.random() * 5000) / branchMul,
      }
      // Pre-seed 3–5 tokens at random positions across the rail so the
      // hero looks already-streaming rather than filling from the left.
      const seedCount = 3 + Math.floor(Math.random() * 3)
      for (let s = 0; s < seedCount; s++) {
        rail.tokens.push({
          x: Math.random() * w,
          speed: speed * (0.85 + Math.random() * 0.4),
          age: 1,
          trail: 16 + Math.random() * 18,
          offset: ++rail.offsetCounter,
        })
      }
      // When paused, also pre-seed a branch on most rails so the
      // frozen scene shows consumer fan-outs in flight, not just
      // straight rail tokens. Without this the paused image looks
      // emptier than the active one.
      if (props.paused && Math.random() < 0.7 && rail.tokens.length > 0) {
        const seed =
          rail.tokens[Math.floor(Math.random() * rail.tokens.length)]
        const dir = Math.random() < 0.5 ? 1 : -1
        const offset = 26 + Math.random() * 30
        const consumerY =
          dir === 1
            ? Math.min(h - 14, rail.y + offset)
            : Math.max(14, rail.y - offset)
        if (consumerY > 12 && consumerY < h - 12) {
          const totalLife = 1700
          // Random life remaining gives different stages of branch
          // travel (early travel → arrived w/ pulse).
          const elapsedFrac = 0.25 + Math.random() * 0.55
          const elapsed = totalLife * elapsedFrac
          const arrived = elapsed > 320
          rail.branches.push({
            startX: seed.x,
            consumerY,
            life: totalLife - elapsed,
            totalLife,
            arrived,
            pulse: arrived ? 250 + Math.random() * 350 : 0,
            dir,
          })
        }
      }
      rails.push(rail)
    }
  }

  function doLayout() {
    // `clientWidth/clientHeight` ignores CSS transforms, so the
    // canvas always sizes itself to the parent's logical inner
    // box even when the parent is 3D-rotated (e.g. the homepage
    // iso composition stack). `getBoundingClientRect` would
    // otherwise return the projected screen bounds of the
    // rotated rect and leave the rails stretched across the
    // wrong coordinate space.
    const parent = el!.parentElement!
    dpr = window.devicePixelRatio || 1
    w = parent.clientWidth
    h = parent.clientHeight
    el!.width = w * dpr
    el!.height = h * dpr
    el!.style.width = w + "px"
    el!.style.height = h + "px"
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    exclusions = measureExclusions()
    buildRails()
  }

  function resize() {
    doLayout()
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      doLayout()
      drawStatic()
      if (!reduced) {
        running = true
        last = performance.now()
        raf = requestAnimationFrame(tick)
      }
    })
  })

  window.addEventListener("resize", resize)

  const isDark = () => document.documentElement.classList.contains("dark")

  // Radial fade — strong centre, soft outer. Same shape as Agents/Sync,
  // so the headline is always sitting on a quiet pool.
  function radialFade(x: number, y: number): number {
    if (props.noEdgeFade) return 1
    const cx = w / 2
    const cy = h / 2
    const dx = Math.abs(x - cx) / (w / 2)
    const dy = Math.abs(y - cy) / (h / 2)
    const d = Math.max(dx, dy)
    if (d < 0.3) return 1
    return Math.max(0, 1 - (d - 0.3) / 0.7)
  }

  function railVisibleAt(rail: Rail, x: number): boolean {
    return !hitsExclusion(x, rail.y, exclusions, 10)
  }

  function drawRail(rail: Rail, dark: boolean, hovered: boolean) {
    const baseAlpha = hovered ? (dark ? 0.32 : 0.26) : dark ? 0.16 : 0.13
    const baseR = dark ? 0 : 0
    const baseG = dark ? 210 : 180
    const baseB = dark ? 190 : 160
    ctx!.save()
    ctx!.lineWidth = 1
    ctx!.setLineDash([2, 6])
    // Walk the rail; skip pixels inside exclusion zones.
    const stepPx = 4
    let segStart = 0
    let inside = false
    for (let x = 0; x < w; x += stepPx) {
      const hit = !railVisibleAt(rail, x)
      if (!hit && inside) {
        segStart = x
        inside = false
      } else if (hit && !inside) {
        if (x > segStart) {
          const midX = (segStart + x) / 2
          const fade = radialFade(midX, rail.y)
          ctx!.strokeStyle = `rgba(${baseR},${baseG},${baseB},${baseAlpha * fade})`
          ctx!.beginPath()
          ctx!.moveTo(segStart, rail.y)
          ctx!.lineTo(x, rail.y)
          ctx!.stroke()
        }
        inside = true
      }
    }
    if (!inside && segStart < w) {
      const midX = (segStart + w) / 2
      const fade = radialFade(midX, rail.y)
      ctx!.strokeStyle = `rgba(${baseR},${baseG},${baseB},${baseAlpha * fade})`
      ctx!.beginPath()
      ctx!.moveTo(segStart, rail.y)
      ctx!.lineTo(w, rail.y)
      ctx!.stroke()
    }
    ctx!.restore()

    // Offset tick marks every ~80px, anchored to a per-rail phase so they
    // don't all line up vertically (which would read as a grid).
    ctx!.save()
    const phase = (rail.y * 13.7) % 80
    for (let x = -phase; x < w; x += 80) {
      if (x < 0) continue
      if (!railVisibleAt(rail, x)) continue
      const fade = radialFade(x, rail.y)
      const a = (hovered ? 0.42 : 0.22) * fade
      if (a < 0.02) continue
      ctx!.strokeStyle = `rgba(${baseR},${baseG},${baseB},${a})`
      ctx!.lineWidth = 1
      ctx!.beginPath()
      ctx!.moveTo(x, rail.y - 2.5)
      ctx!.lineTo(x, rail.y + 2.5)
      ctx!.stroke()
    }
    ctx!.restore()
  }

  function drawToken(rail: Rail, token: Token, dark: boolean, hot: boolean) {
    if (!railVisibleAt(rail, token.x)) return
    const fade = radialFade(token.x, rail.y)
    const a = token.age * fade
    if (a < 0.02) return
    const baseR = 0
    const baseG = dark ? 210 : 180
    const baseB = dark ? 190 : 160

    // Comet tail — a short streak behind the token, fading toward the back.
    const tailLen = token.trail
    const grad = ctx!.createLinearGradient(
      token.x - tailLen,
      rail.y,
      token.x,
      rail.y
    )
    grad.addColorStop(0, `rgba(${baseR},${baseG},${baseB},0)`)
    grad.addColorStop(
      1,
      `rgba(${baseR},${baseG},${baseB},${(hot ? 0.8 : 0.55) * a})`
    )
    ctx!.strokeStyle = grad
    ctx!.lineWidth = hot ? 2 : 1.4
    ctx!.lineCap = "round"
    ctx!.beginPath()
    ctx!.moveTo(token.x - tailLen, rail.y)
    ctx!.lineTo(token.x, rail.y)
    ctx!.stroke()

    // Soft glow halo
    const gr = hot ? 14 : 10
    const glow = ctx!.createRadialGradient(token.x, rail.y, 0, token.x, rail.y, gr)
    glow.addColorStop(
      0,
      `rgba(${baseR},${baseG},${baseB},${(hot ? 0.65 : 0.45) * a})`
    )
    glow.addColorStop(1, `rgba(${baseR},${baseG},${baseB},0)`)
    ctx!.fillStyle = glow
    ctx!.beginPath()
    ctx!.arc(token.x, rail.y, gr, 0, Math.PI * 2)
    ctx!.fill()

    // Solid centre
    ctx!.fillStyle = `rgba(${baseR},${baseG},${baseB},${(hot ? 1 : 0.92) * a})`
    ctx!.beginPath()
    ctx!.arc(token.x, rail.y, hot ? 3.2 : 2.6, 0, Math.PI * 2)
    ctx!.fill()
  }

  function drawBranch(rail: Rail, branch: Branch, dark: boolean) {
    if (!railVisibleAt(rail, branch.startX)) return
    const lifeP = branch.life / branch.totalLife
    const fade = radialFade(branch.startX, rail.y) * lifeP
    if (fade < 0.02) return
    const baseG = dark ? 210 : 180
    const baseB = dark ? 190 : 160
    const dropY = branch.consumerY
    const startY = rail.y + branch.dir * 4
    const endY = dropY - branch.dir * 4

    ctx!.save()
    ctx!.strokeStyle = `rgba(0,${baseG},${baseB},${0.28 * fade})`
    ctx!.lineWidth = 1
    ctx!.setLineDash([1, 3])
    ctx!.beginPath()
    ctx!.moveTo(branch.startX, startY)
    ctx!.lineTo(branch.startX, endY)
    ctx!.stroke()
    ctx!.restore()

    // Consumer marker: open ring with a centre dot once "arrived".
    const pulse = branch.pulse > 0 ? branch.pulse / 600 : 0
    const r = 3.4 + pulse * 5
    const a = 0.55 * fade + pulse * 0.35
    ctx!.strokeStyle = `rgba(0,${baseG},${baseB},${a})`
    ctx!.lineWidth = 1
    ctx!.beginPath()
    ctx!.arc(branch.startX, dropY, r, 0, Math.PI * 2)
    ctx!.stroke()
    if (branch.arrived) {
      ctx!.fillStyle = `rgba(0,${baseG},${baseB},${0.65 * fade})`
      ctx!.beginPath()
      ctx!.arc(branch.startX, dropY, 1.7, 0, Math.PI * 2)
      ctx!.fill()
    }
  }

  function drawStatic() {
    ctx!.clearRect(0, 0, w, h)
    const dark = isDark()
    for (const rail of rails) drawRail(rail, dark, false)
    for (const rail of rails) {
      // sprinkle frozen tokens at fixed positions
      for (let i = 0; i < 3; i++) {
        const x = w * (0.18 + 0.32 * i + ((rail.y * 7) % 100) * 0.001)
        drawToken(rail, { x, speed: 0, age: 1, trail: 18, offset: 0 }, dark, false)
      }
    }
  }

  function tick(now: number) {
    if (!running) return
    const dt = Math.min(now - last, 60)
    last = now
    elapsed += dt
    const dark = isDark()

    ctx!.clearRect(0, 0, w, h)

    for (let ri = 0; ri < rails.length; ri++) {
      const rail = rails[ri]
      drawRail(rail, dark, hoveredRail === ri)
    }

    // `activity` and `branchActivity` scale dt accumulation toward
    // each rail's next spawn / branch — the rates scale linearly
    // without skewing the random jitter. 0 freezes the channel
    // (in-flight tokens / branches still finish).
    const activityMul = Math.max(0, props.activity)
    const branchActivityMul = Math.max(0, props.branchActivity)

    for (let ri = 0; ri < rails.length; ri++) {
      const rail = rails[ri]

      // Spawn
      if (activityMul > 0) rail.nextSpawn -= dt * activityMul
      if (!props.paused && activityMul > 0 && rail.nextSpawn <= 0) {
        rail.tokens.push({
          x: -16,
          speed: rail.speed * (0.85 + Math.random() * 0.4),
          age: 0,
          trail: 16 + Math.random() * 18,
          offset: ++rail.offsetCounter,
        })
        rail.nextSpawn = rail.spawnInterval * (0.65 + Math.random() * 0.7)
      }

      // Advance / age / cull. When paused we skip motion + cull so
      // the seeded tokens stay frozen wherever they were placed.
      for (let i = rail.tokens.length - 1; i >= 0; i--) {
        const t = rail.tokens[i]
        if (!props.paused) {
          t.x += t.speed * (dt / 1000)
          if (t.age < 1) t.age = Math.min(1, t.age + dt / 220)
          if (t.x > w - 24) t.age = Math.max(0, t.age - dt / 240)
        }
        if (!props.paused && (t.x > w + 30 || t.age <= 0)) {
          rail.tokens.splice(i, 1)
        } else {
          const hot =
            hoveredRail === ri ||
            (hoveredToken !== null &&
              hoveredToken.rail === ri &&
              hoveredToken.idx === i)
          drawToken(rail, t, dark, hot)
        }
      }

      // Branch life
      if (branchActivityMul > 0) rail.nextBranch -= dt * branchActivityMul
      if (
        !props.paused &&
        branchActivityMul > 0 &&
        rail.nextBranch <= 0 &&
        rail.tokens.length > 0
      ) {
        const seed = rail.tokens[Math.floor(Math.random() * rail.tokens.length)]
        const dir = Math.random() < 0.5 ? 1 : -1
        const offset = 26 + Math.random() * 30
        const consumerY =
          dir === 1
            ? Math.min(h - 14, rail.y + offset)
            : Math.max(14, rail.y - offset)
        if (consumerY > 12 && consumerY < h - 12) {
          rail.branches.push({
            startX: seed.x,
            consumerY,
            life: 1700,
            totalLife: 1700,
            arrived: false,
            pulse: 0,
            dir,
          })
        }
        rail.nextBranch = (3000 + Math.random() * 5000) / branchActivityMul
      }

      for (let i = rail.branches.length - 1; i >= 0; i--) {
        const b = rail.branches[i]
        if (!props.paused) {
          b.life -= dt
          if (b.life <= 0) {
            rail.branches.splice(i, 1)
            continue
          }
          if (!b.arrived && b.totalLife - b.life > 320) {
            b.arrived = true
            b.pulse = 600
          }
          if (b.pulse > 0) b.pulse = Math.max(0, b.pulse - dt)
        }
        drawBranch(rail, b, dark)
      }
    }

    raf = requestAnimationFrame(tick)
  }

  // ── Hover / click interactivity ──────────────────────────────

  function findRailAt(my: number): number {
    let best = -1
    let bestDist = 14
    for (let i = 0; i < rails.length; i++) {
      const d = Math.abs(rails[i].y - my)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    return best
  }

  function findTokenAt(mx: number, my: number): { rail: number; idx: number } | null {
    for (let ri = 0; ri < rails.length; ri++) {
      const r = rails[ri]
      if (Math.abs(r.y - my) > 10) continue
      for (let ti = 0; ti < r.tokens.length; ti++) {
        if (Math.abs(r.tokens[ti].x - mx) < 10) {
          return { rail: ri, idx: ti }
        }
      }
    }
    return null
  }

  function onMouseMove(e: MouseEvent) {
    const rect = el!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    if (hitsExclusion(mx, my, exclusions, 4)) {
      hoveredRail = -1
      hoveredToken = null
      tt!.style.opacity = "0"
      el!.style.cursor = ""
      return
    }

    const tk = findTokenAt(mx, my)
    if (tk) {
      hoveredToken = tk
      hoveredRail = tk.rail
      const r = rails[tk.rail]
      const t = r.tokens[tk.idx]
      tt!.textContent = `/${r.name} @ offset 0x${t.offset.toString(16).padStart(4, "0")}`
      tt!.style.opacity = "1"
      tt!.style.left = `${t.x}px`
      tt!.style.top = `${r.y - 22}px`
      el!.style.cursor = "pointer"
      return
    }

    const ri = findRailAt(my)
    if (ri >= 0) {
      hoveredRail = ri
      hoveredToken = null
      const r = rails[ri]
      tt!.textContent = `/${r.name}`
      tt!.style.opacity = "1"
      tt!.style.left = `${mx}px`
      tt!.style.top = `${r.y - 22}px`
      el!.style.cursor = "pointer"
    } else {
      hoveredRail = -1
      hoveredToken = null
      tt!.style.opacity = "0"
      el!.style.cursor = ""
    }
  }

  function onMouseLeave() {
    hoveredRail = -1
    hoveredToken = null
    tt!.style.opacity = "0"
    el!.style.cursor = ""
  }

  function onClick(e: MouseEvent) {
    const rect = el!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const ri = findRailAt(my)
    if (ri < 0) return
    const r = rails[ri]
    // Burst: spawn a tight cluster of tokens at the click x.
    const baseSpeed = r.speed * 1.15
    for (let i = 0; i < 4; i++) {
      r.tokens.push({
        x: Math.max(-8, mx - 18 - i * 8),
        speed: baseSpeed * (0.95 + Math.random() * 0.2),
        age: 0,
        trail: 22 + Math.random() * 14,
        offset: ++r.offsetCounter,
      })
    }
    // Also spawn a branch off the click point so the consumer marker
    // pulses immediately — tactile feedback for the click.
    const dir = my > r.y ? 1 : -1
    const consumerY =
      dir === 1
        ? Math.min(h - 14, r.y + 32)
        : Math.max(14, r.y - 32)
    r.branches.push({
      startX: mx,
      consumerY,
      life: 1700,
      totalLife: 1700,
      arrived: false,
      pulse: 0,
      dir,
    })
  }

  el.addEventListener("mousemove", onMouseMove)
  el.addEventListener("mouseleave", onMouseLeave)
  el.addEventListener("click", onClick)

  onUnmounted(() => {
    running = false
    cancelAnimationFrame(raf)
    window.removeEventListener("resize", resize)
    el.removeEventListener("mousemove", onMouseMove)
    el.removeEventListener("mouseleave", onMouseLeave)
    el.removeEventListener("click", onClick)
  })
})
</script>

<template>
  <div class="stream-flow-bg">
    <canvas ref="canvas" class="bg-canvas" aria-hidden="true" />
    <div ref="tooltip" class="bg-tooltip" />
  </div>
</template>

<style scoped>
.stream-flow-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
}
.bg-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: auto;
}
.bg-tooltip {
  position: absolute;
  pointer-events: none;
  transform: translateX(-50%);
  white-space: nowrap;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  line-height: 1;
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--ea-surface-alt);
  color: var(--ea-text-2);
  border: 1px solid var(--vp-c-divider);
  opacity: 0;
  transition: opacity 0.15s;
  z-index: 2;
}
</style>
