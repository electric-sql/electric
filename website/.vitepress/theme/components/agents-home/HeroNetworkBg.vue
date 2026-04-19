<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue"

const props = defineProps<{
  excludeEl?: HTMLElement
}>()

const canvas = ref<HTMLCanvasElement>()
const tooltip = ref<HTMLDivElement>()
let raf = 0
let running = false

const ENTITY_TYPES = [
  "assistant",
  "researcher",
  "writer",
  "reviewer",
  "planner",
  "indexer",
  "summarizer",
  "classifier",
  "monitor",
  "scheduler",
  "dispatcher",
  "validator",
  "encoder",
  "fetcher",
  "parser",
  "analyst",
]

interface Node {
  x: number
  y: number
  awake: number
  entityType: string
  instanceId: string
}

interface Message {
  from: number
  to: number
  progress: number
  speed: number
}

function randomId(): string {
  const chars = "abcdef0123456789"
  let s = ""
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

// Delaunay triangulation (Bowyer-Watson)
function delaunay(
  points: { x: number; y: number }[]
): [number, number][] {
  const n = points.length
  if (n < 2) return []

  const margin = 1000
  const st0 = { x: -margin, y: -margin }
  const st1 = { x: margin * 3, y: -margin }
  const st2 = { x: -margin, y: margin * 3 }
  const allPts = [...points, st0, st1, st2]
  const si0 = n, si1 = n + 1, si2 = n + 2

  let triangles: [number, number, number][] = [[si0, si1, si2]]

  function inCircumcircle(
    px: number, py: number,
    a: number, b: number, c: number
  ) {
    const ax = allPts[a].x - px, ay = allPts[a].y - py
    const bx = allPts[b].x - px, by = allPts[b].y - py
    const cx = allPts[c].x - px, cy = allPts[c].y - py
    return (
      (ax * ax + ay * ay) * (bx * cy - cx * by) -
      (bx * bx + by * by) * (ax * cy - cx * ay) +
      (cx * cx + cy * cy) * (ax * by - bx * ay) > 0
    )
  }

  for (let i = 0; i < n; i++) {
    const bad: [number, number, number][] = []
    for (const tri of triangles) {
      if (inCircumcircle(points[i].x, points[i].y, tri[0], tri[1], tri[2])) {
        bad.push(tri)
      }
    }
    const boundary: [number, number][] = []
    for (const tri of bad) {
      const sides: [number, number][] = [
        [tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]],
      ]
      for (const [a, b] of sides) {
        const shared = bad.some(
          (other) => other !== tri && other.includes(a) && other.includes(b)
        )
        if (!shared) boundary.push([a, b])
      }
    }
    triangles = triangles.filter((t) => !bad.includes(t))
    for (const [a, b] of boundary) {
      triangles.push([a, b, i])
    }
  }

  const edgeSet = new Set<string>()
  const edges: [number, number][] = []
  for (const [a, b, c] of triangles) {
    const verts = [a, b, c].filter((v) => v < n)
    for (let i = 0; i < verts.length; i++) {
      for (let j = i + 1; j < verts.length; j++) {
        const lo = Math.min(verts[i], verts[j])
        const hi = Math.max(verts[i], verts[j])
        const key = `${lo}-${hi}`
        if (!edgeSet.has(key)) {
          edgeSet.add(key)
          edges.push([lo, hi])
        }
      }
    }
  }
  return edges
}

interface ExcludeRect {
  left: number
  top: number
  right: number
  bottom: number
}

function hitsExclusion(
  x: number, y: number,
  zones: ExcludeRect[], margin: number
): boolean {
  for (const z of zones) {
    if (
      x >= z.left - margin &&
      x <= z.right + margin &&
      y >= z.top - margin &&
      y <= z.bottom + margin
    ) return true
  }
  return false
}

function createNodes(
  w: number, h: number, exclusions: ExcludeRect[]
): Node[] {
  const nodes: Node[] = []
  const count = Math.min(60, Math.max(25, Math.floor((w * h) / 12000)))
  const padding = 30
  const minDist = 50
  const excludeMargin = 4
  const shuffledTypes = [...ENTITY_TYPES].sort(() => Math.random() - 0.5)

  for (let i = 0; i < count; i++) {
    let x: number, y: number
    let tries = 0
    do {
      x = padding + Math.random() * (w - padding * 2)
      y = padding + Math.random() * (h - padding * 2)
      tries++
    } while (
      tries < 120 &&
      (nodes.some((n) => Math.hypot(n.x - x, n.y - y) < minDist) ||
       hitsExclusion(x, y, exclusions, excludeMargin))
    )
    if (!hitsExclusion(x, y, exclusions, excludeMargin)) {
      nodes.push({
        x, y, awake: 0,
        entityType: shuffledTypes[i % shuffledTypes.length],
        instanceId: randomId(),
      })
    }
  }
  return nodes
}

function pruneEdges(
  edges: [number, number][], nodes: Node[], maxLen: number
): [number, number][] {
  return edges.filter(([a, b]) => {
    const d = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y)
    return d < maxLen
  })
}

function getNeighbors(idx: number, edges: [number, number][]): number[] {
  const out: number[] = []
  for (const [a, b] of edges) {
    if (a === idx) out.push(b)
    else if (b === idx) out.push(a)
  }
  return out
}

onMounted(() => {
  const el = canvas.value
  const tt = tooltip.value
  if (!el || !tt) return
  const c = el.getContext("2d")
  if (!c) return

  const DEBUG = false

  let dpr = 1
  let w = 0
  let h = 0
  let nodes: Node[] = []
  let edges: [number, number][] = []
  let messages: Message[] = []
  let nextSend = 400 + Math.random() * 800
  let hoveredNode = -1
  let debugExclusions: ExcludeRect[] = []

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
    // Also measure any inline elements like buttons, inputs, SVGs
    element.querySelectorAll("a, button, svg, img, input, .ea-hero-install").forEach((child) => {
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

  function doLayout() {
    const rect = el!.parentElement!.getBoundingClientRect()
    dpr = window.devicePixelRatio || 1
    w = rect.width
    h = rect.height
    el!.width = w * dpr
    el!.height = h * dpr
    el!.style.width = w + "px"
    el!.style.height = h + "px"
    c!.setTransform(dpr, 0, 0, dpr, 0, 0)
    const exclusions = measureExclusions()
    debugExclusions = exclusions
    if (DEBUG) {
      console.log('Hero exclusion zones:', exclusions.length, exclusions, 'canvas size:', w, h)
    }
    nodes = createNodes(w, h, exclusions)
    const raw = delaunay(nodes)
    edges = pruneEdges(raw, nodes, 200)
    messages = []
    hoveredNode = -1
  }

  function resize() {
    doLayout()
  }

  // Delay initial layout to ensure the parent ref and DOM are ready
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      doLayout()
    })
  })
  window.addEventListener("resize", resize)

  const isDark = () =>
    document.documentElement.classList.contains("dark")

  function edgeFade(x: number, y: number): number {
    const cx = w / 2
    const cy = h / 2
    const dx = Math.abs(x - cx) / (w / 2)
    const dy = Math.abs(y - cy) / (h / 2)
    const d = Math.max(dx, dy)
    if (d < 0.25) return 1
    return Math.max(0, 1 - (d - 0.25) / 0.75)
  }

  function findNodeAt(mx: number, my: number): number {
    const hitRadius = 18
    let closest = -1
    let closestDist = hitRadius
    for (let i = 0; i < nodes.length; i++) {
      const d = Math.hypot(nodes[i].x - mx, nodes[i].y - my)
      if (d < closestDist) {
        closestDist = d
        closest = i
      }
    }
    return closest
  }

  function wakeAndSend(idx: number) {
    nodes[idx].awake = 1
    const neighbors = getNeighbors(idx, edges)
    if (neighbors.length > 0) {
      const howMany = Math.min(neighbors.length, 1 + Math.floor(Math.random() * 3))
      const shuffled = neighbors.sort(() => Math.random() - 0.5)
      for (let k = 0; k < howMany; k++) {
        const target = shuffled[k]
        const delay = 50 + Math.random() * 200
        setTimeout(() => {
          if (!running) return
          messages.push({
            from: idx,
            to: target,
            progress: 0,
            speed: 1.0 + Math.random() * 1.2,
          })
        }, delay)
      }
    }
  }

  function onMouseMove(e: MouseEvent) {
    const rect = el!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const idx = findNodeAt(mx, my)
    hoveredNode = idx

    if (idx >= 0) {
      const node = nodes[idx]
      const state = node.awake > 0.1 ? "active" : "idle"
      tt!.textContent = `/${node.entityType}/${node.instanceId}  ·  ${state}`
      tt!.style.opacity = "1"
      tt!.style.left = `${node.x}px`
      tt!.style.top = `${node.y - 28}px`
      el!.style.cursor = "pointer"
    } else {
      tt!.style.opacity = "0"
      el!.style.cursor = ""
    }
  }

  function onMouseLeave() {
    hoveredNode = -1
    tt!.style.opacity = "0"
    el!.style.cursor = ""
  }

  function onClick(e: MouseEvent) {
    const rect = el!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const idx = findNodeAt(mx, my)
    if (idx >= 0) {
      wakeAndSend(idx)
    }
  }

  el.addEventListener("mousemove", onMouseMove)
  el.addEventListener("mouseleave", onMouseLeave)
  el.addEventListener("click", onClick)

  running = true
  let lastTime = performance.now()

  function tick(now: number) {
    if (!running) return
    const dt = Math.min(now - lastTime, 50)
    lastTime = now
    const dark = isDark()

    c!.clearRect(0, 0, w, h)

    // --- Draw edges ---
    c!.lineWidth = 1
    for (const [a, b] of edges) {
      const na = nodes[a]
      const nb = nodes[b]
      const mx = (na.x + nb.x) / 2
      const my = (na.y + nb.y) / 2
      const fade = edgeFade(mx, my)
      const awakeLevel = Math.max(na.awake, nb.awake)
      const isHoverEdge = hoveredNode === a || hoveredNode === b

      let alpha: number
      if (awakeLevel > 0.05) {
        alpha = (dark ? 0.1 : 0.08) + awakeLevel * (dark ? 0.2 : 0.14)
      } else {
        alpha = dark ? 0.08 : 0.06
      }
      if (isHoverEdge) alpha = Math.max(alpha, dark ? 0.2 : 0.15)
      alpha *= fade

      if (alpha < 0.005) continue

      if (awakeLevel > 0.05 || isHoverEdge) {
        c!.strokeStyle = dark
          ? `rgba(0,210,190,${alpha})`
          : `rgba(0,180,160,${alpha})`
      } else {
        c!.strokeStyle = dark
          ? `rgba(255,255,255,${alpha})`
          : `rgba(0,0,0,${alpha})`
      }
      c!.beginPath()
      c!.moveTo(na.x, na.y)
      c!.lineTo(nb.x, nb.y)
      c!.stroke()
    }

    // --- Draw messages ---
    for (const msg of messages) {
      const from = nodes[msg.from]
      const to = nodes[msg.to]
      const x = from.x + (to.x - from.x) * msg.progress
      const y = from.y + (to.y - from.y) * msg.progress
      const fade = edgeFade(x, y)
      const pa =
        (msg.progress < 0.1
          ? msg.progress / 0.1
          : msg.progress > 0.9
            ? (1 - msg.progress) / 0.1
            : 1) * fade

      if (pa < 0.01) continue

      const ma = dark ? 0.8 * pa : 0.7 * pa
      c!.fillStyle = dark
        ? `rgba(0,210,190,${ma})`
        : `rgba(0,180,160,${ma})`
      c!.beginPath()
      c!.arc(x, y, 3, 0, Math.PI * 2)
      c!.fill()
    }

    // --- Draw nodes ---
    for (let ni = 0; ni < nodes.length; ni++) {
      const node = nodes[ni]
      const a = node.awake
      const fade = edgeFade(node.x, node.y)
      if (fade < 0.01) continue

      const isHovered = hoveredNode === ni
      const isActive = a > 0.1

      if (isActive || isHovered) {
        const level = isHovered ? Math.max(a, 0.5) : a

        // Active glow ring
        const ga = level * 0.4 * fade
        c!.strokeStyle = dark
          ? `rgba(0,210,190,${ga})`
          : `rgba(0,180,160,${ga})`
        c!.lineWidth = 1.5
        c!.beginPath()
        c!.arc(node.x, node.y, 7 + level * 4, 0, Math.PI * 2)
        c!.stroke()

        // Active filled circle
        const fa = (0.45 + level * 0.5) * fade
        c!.fillStyle = dark
          ? `rgba(0,210,190,${fa})`
          : `rgba(0,180,160,${fa})`
        c!.beginPath()
        c!.arc(node.x, node.y, 4, 0, Math.PI * 2)
        c!.fill()
      } else {
        // Idle: smaller, muted dot
        const ia = (dark ? 0.18 : 0.12) * fade
        c!.fillStyle = dark
          ? `rgba(255,255,255,${ia})`
          : `rgba(0,0,0,${ia})`
        c!.beginPath()
        c!.arc(node.x, node.y, 2.5, 0, Math.PI * 2)
        c!.fill()
      }
    }

    // --- Debug: draw exclusion zones ---
    if (DEBUG && debugExclusions.length > 0) {
      const margin = 4
      c!.strokeStyle = "rgba(255,0,0,0.5)"
      c!.lineWidth = 1
      c!.setLineDash([4, 4])
      for (const z of debugExclusions) {
        c!.strokeRect(
          z.left - margin,
          z.top - margin,
          z.right - z.left + margin * 2,
          z.bottom - z.top + margin * 2
        )
      }
      c!.fillStyle = "rgba(255,0,0,0.05)"
      for (const z of debugExclusions) {
        c!.fillRect(
          z.left - margin,
          z.top - margin,
          z.right - z.left + margin * 2,
          z.bottom - z.top + margin * 2
        )
      }
      c!.setLineDash([])
    }

    // --- Update state ---
    for (const node of nodes) {
      node.awake = Math.max(0, node.awake - dt * 0.00025)
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      messages[i].progress += messages[i].speed * dt * 0.001
      if (messages[i].progress >= 1) {
        const arrivedAt = messages[i].to
        const arrivedFrom = messages[i].from
        nodes[arrivedAt].awake = Math.min(1, nodes[arrivedAt].awake + 0.85)
        messages.splice(i, 1)

        if (Math.random() < 0.5) {
          const neighbors = getNeighbors(arrivedAt, edges).filter(
            (n) => n !== arrivedFrom
          )
          if (neighbors.length > 0) {
            const count = Math.random() < 0.2 ? 2 : 1
            const shuffled = neighbors.sort(() => Math.random() - 0.5)
            for (let k = 0; k < Math.min(count, shuffled.length); k++) {
              const next = shuffled[k]
              const delay = 150 + Math.random() * 350
              setTimeout(() => {
                if (!running) return
                messages.push({
                  from: arrivedAt,
                  to: next,
                  progress: 0,
                  speed: 1.2 + Math.random() * 1.0,
                })
              }, delay)
            }
          }
        }
      }
    }

    // --- Spawn random wakes & messages ---
    nextSend -= dt
    if (nextSend <= 0) {
      nextSend = 800 + Math.random() * 2000
      const startNode = Math.floor(Math.random() * nodes.length)
      nodes[startNode].awake = Math.min(1, nodes[startNode].awake + 0.95)
      const neighbors = getNeighbors(startNode, edges)
      if (neighbors.length > 0) {
        const howMany = Math.random() < 0.3 ? 2 : 1
        const shuffled = neighbors.sort(() => Math.random() - 0.5)
        for (let k = 0; k < Math.min(howMany, shuffled.length); k++) {
          const target = shuffled[k]
          setTimeout(() => {
            if (!running) return
            messages.push({
              from: startNode,
              to: target,
              progress: 0,
              speed: 1.0 + Math.random() * 1.2,
            })
          }, 200 + Math.random() * 400)
        }
      }
    }

    raf = requestAnimationFrame(tick)
  }

  raf = requestAnimationFrame(tick)

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
  <div class="hero-network-wrap">
    <canvas ref="canvas" class="hero-network-canvas" />
    <div ref="tooltip" class="hero-network-tooltip" />
  </div>
</template>

<style scoped>
.hero-network-wrap {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
}

.hero-network-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: auto;
}

.hero-network-tooltip {
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
