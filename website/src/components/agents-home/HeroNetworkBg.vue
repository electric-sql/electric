<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue"

const props = withDefaults(
  defineProps<{
    excludeEl?: HTMLElement
    // When true, no random wakes or chained messages are auto-spawned;
    // the canvas still renders the static mesh, hover labels still
    // appear, and a user click still wakes a node + cascades. Used by
    // the homepage section graphics so the page doesn't feel busy.
    paused?: boolean
    // When true, the radial edge-fade that softens geometry near the
    // canvas borders is disabled, so the mesh fills the whole frame at
    // full intensity. Used by the homepage iso-stack hero where each
    // canvas already lives inside a crisp bordered card and the fade
    // would otherwise leave the corners empty.
    noEdgeFade?: boolean
    // Multiplier on the area-driven node count formula. 1
    // reproduces the live `(w*h)/12000` density (clamped 25–60);
    // 2 packs in twice as many points, 0.5 halves them.
    density?: number
    // Hard cap on the number of nodes regardless of density. The
    // live hero clamps at 60.
    maxNodes?: number
    // Multiplier on ambient wake/cascade cadence. 1 keeps the live
    // 800–2800 ms between auto-wakes; 2 doubles the rate, 0.5
    // halves it. 0 freezes ambient spawns (existing in-flight
    // messages still arrive and may chain).
    activity?: number
    // Probability of a chained cascade firing when a message
    // arrives at a node (0–1). The live hero ships with 0.5 — half
    // of arrivals trigger another hop.
    cascadeChance?: number
    // Multiplier on token flight speed. 1 reproduces the live
    // 1.0–1.7 progress/s range used across all three hero
    // canvases.
    tokenSpeed?: number
    // When true, clicking on empty canvas spawns a new agent at
    // the click position (subject to `spawnMaxDist` from existing
    // nodes). Clicks on existing nodes still wake + cascade as
    // normal. Off by default to preserve the live hero's
    // wake-only click behaviour.
    spawnOnClick?: boolean
    // Random ambient node-spawn rate, in nodes per second. 0 (the
    // default) disables ambient spawning. Honours `maxNodes` as
    // an upper bound, and `spawnMaxDist` as the locality
    // constraint. Useful for "growing" the mesh from a small
    // seed.
    spawnRate?: number
    // Random ambient node-die rate, in nodes per second. 0 (the
    // default) disables ambient deaths. Will happily reduce the
    // mesh to zero — combine with `spawnRate` for a steady-state
    // population, or use alone for "draining" recordings.
    dieRate?: number
    // Maximum distance (in CSS px) from any existing node at
    // which a new random / click-spawned node may be placed. 0
    // (the default) means no constraint — spawn anywhere on the
    // canvas. Set to e.g. 120 to grow a tightly-knit mesh
    // outwards from an initial seed.
    spawnMaxDist?: number
    // When true, every new node added (via click or random spawn)
    // gently pushes nearby existing nodes away to balance the
    // mesh. Movement is tweened over ~half a second so the
    // re-balance reads as a settling, not a jump. Off by default;
    // turn on for organic-growth recordings.
    repositionOnSpawn?: boolean
    // When true, the per-node `/{entityType}/{instanceId}` labels
    // are hidden at rest and only fade in for the hovered node
    // (via the existing tooltip). When false, every node renders
    // its label below the dot at all times. Default is `true` to
    // match the live homepage hero, which leaves the canvas quiet
    // until the user investigates. Has no effect when `hideLabels`
    // is set — that overrides everything.
    labelsOnHover?: boolean
    // When true, suppress *all* labels — both the always-on canvas
    // labels and the DOM hover tooltip. Useful for clean recordings
    // / brand stills where the mesh should read as pure geometry
    // with no text. Click-to-wake / hover-glow behaviour still
    // works; only the label text is hidden. Off by default.
    hideLabels?: boolean
    // Override the initial node count. -1 (the default) means use
    // the density formula `(w*h*density)/12000` clamped to 8..maxNodes.
    // 0 means start with an empty canvas (combine with `spawnOnClick`
    // and/or `spawnRate` to build the mesh from scratch). Any positive
    // integer is used directly as the seed count, still capped at
    // `maxNodes`.
    initialNodes?: number
  }>(),
  {
    density: 1,
    maxNodes: 60,
    activity: 1,
    cascadeChance: 0.5,
    tokenSpeed: 1,
    spawnOnClick: false,
    spawnRate: 0,
    dieRate: 0,
    spawnMaxDist: 0,
    repositionOnSpawn: false,
    labelsOnHover: true,
    hideLabels: false,
    initialNodes: -1,
  },
)

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
  // Tween targets — `x`/`y` ease toward `targetX`/`targetY` each
  // frame when `repositionOnSpawn` is on (or whenever a new node
  // perturbation has been queued). For nodes at rest, target ===
  // current position.
  targetX: number
  targetY: number
  awake: number
  // Birth / death tween clocks (ms). `birthT` accumulates from 0
  // on add and is capped at `BIRTH_DURATION`; the node renders
  // scaled and alpha-faded by `birthT/BIRTH_DURATION` until then.
  // `dyingT` is 0 while alive. Once non-zero the node is fading
  // out and the ring/dot shrink + fade together; once it crosses
  // `DEATH_DURATION` the node is spliced from the array (with
  // edges/messages remapped). Initial nodes from `createNodes`
  // start with `birthT === BIRTH_DURATION` so they render at full
  // size immediately on first paint.
  birthT: number
  dyingT: number
  entityType: string
  instanceId: string
}

// How long a node takes to scale + fade in on spawn, and to shrink
// + fade out on death. Tuned to feel snappy but visible at 60fps —
// short enough that a steady spawn/die rate doesn't accumulate a
// long tail of half-rendered ghosts, long enough to read as motion
// rather than a pop.
const BIRTH_DURATION = 350
const DEATH_DURATION = 450

function lifeFactor(n: Node): number {
  const born = Math.min(1, n.birthT / BIRTH_DURATION)
  const dying = n.dyingT > 0 ? Math.max(0, 1 - n.dyingT / DEATH_DURATION) : 1
  return born * dying
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
  w: number, h: number, exclusions: ExcludeRect[],
  density: number, maxNodes: number, initialNodes: number,
): Node[] {
  const nodes: Node[] = []
  // When the caller passes a non-negative `initialNodes`, honour it
  // directly (still clamped to `maxNodes`). 0 is allowed and yields
  // an empty canvas — used to grow the mesh from scratch via
  // spawnOnClick / spawnRate. The default sentinel `-1` means
  // "use the live hero formula" — `(w*h)/12000` clamped 8..maxNodes,
  // with `density` scaling the area divisor.
  const cap = Math.max(8, Math.floor(maxNodes))
  let count: number
  if (initialNodes >= 0) {
    count = Math.min(cap, Math.floor(initialNodes))
  } else {
    const d = Math.max(0.1, density)
    count = Math.min(cap, Math.max(8, Math.floor((w * h * d) / 12000)))
  }
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
        x, y, targetX: x, targetY: y, awake: 0,
        // Initial layout pre-populates the mesh; treat all nodes
        // as fully born so the canvas is rendered at full intensity
        // on first paint, not fading in.
        birthT: BIRTH_DURATION,
        dyingT: 0,
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
  // Lookup mirror of `edges` keyed by `min(a,b) * EDGE_KEY_STRIDE + max(a,b)`.
  // Used to skip in-flight messages whose path is no longer a real
  // edge — re-triangulation on spawn/death can rewrite the mesh
  // entirely, leaving a token traversing thin air. `EDGE_KEY_STRIDE`
  // just needs to exceed the largest plausible node index.
  const EDGE_KEY_STRIDE = 100000
  let edgeSet = new Set<number>()
  function edgeKey(a: number, b: number): number {
    return a < b ? a * EDGE_KEY_STRIDE + b : b * EDGE_KEY_STRIDE + a
  }
  function rebuildEdgeSet() {
    edgeSet = new Set<number>()
    for (const [a, b] of edges) edgeSet.add(edgeKey(a, b))
  }
  function hasEdge(a: number, b: number): boolean {
    return edgeSet.has(edgeKey(a, b))
  }
  let messages: Message[] = []
  let nextSend = 400 + Math.random() * 800
  // Fractional accumulators for ambient node spawn / death. We
  // accumulate `rate * dt/1000` each frame and trigger one event
  // per integer crossed — this lets sub-1/s rates work cleanly
  // (e.g. spawnRate 0.5 fires roughly every 2 s) while still
  // handling burst rates of several events per frame.
  let spawnAcc = 0
  let dieAcc = 0
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
    // Use `clientWidth/clientHeight` rather than
    // `getBoundingClientRect` so we get the parent's *logical*
    // (untransformed) inner size. `getBoundingClientRect` returns
    // the projected axis-aligned bounds, which on the homepage
    // hero — where each layer is 3D-rotated for the iso stack —
    // is much wider than the layer itself, leaving the drawn
    // mesh stretched across only part of the visible plane.
    const parent = el!.parentElement!
    dpr = window.devicePixelRatio || 1
    w = parent.clientWidth
    h = parent.clientHeight
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
    nodes = createNodes(
      w, h, exclusions, props.density, props.maxNodes, props.initialNodes,
    )
    const raw = delaunay(nodes)
    edges = pruneEdges(raw, nodes, 200)
    rebuildEdgeSet()
    messages = []
    hoveredNode = -1

    // When paused, seed the scene with a "snapshot mid-activity" —
    // several edges with messages frozen at random progress, plus
    // both endpoints marked awake. Without this the paused mesh
    // looks dormant; with it the canvas reads as a paused trace of
    // a busy network.
    if (props.paused && edges.length > 0) {
      const target = Math.min(8, Math.max(4, Math.floor(edges.length / 18)))
      const shuffled = edges
        .map((e, i) => ({ e, i, k: Math.random() }))
        .sort((a, b) => a.k - b.k)
      for (let s = 0; s < target; s++) {
        const [a, b] = shuffled[s].e
        // Skip edges that fall in the heavily faded outer band so
        // the seeded comets read clearly.
        const mx = (nodes[a].x + nodes[b].x) / 2
        const my = (nodes[a].y + nodes[b].y) / 2
        if (edgeFade(mx, my) < 0.25) continue
        const forward = Math.random() < 0.5
        messages.push({
          from: forward ? a : b,
          to: forward ? b : a,
          progress: 0.18 + Math.random() * 0.64,
          speed: 1,
        })
        nodes[a].awake = Math.max(nodes[a].awake, 0.55 + Math.random() * 0.3)
        nodes[b].awake = Math.max(nodes[b].awake, 0.45 + Math.random() * 0.3)
      }
    }
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
    if (props.noEdgeFade) return 1
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
      // Dying nodes shouldn't grab clicks or tooltips — they're
      // visibly fading out and treating them as targets confuses
      // the spawn-on-click flow (the click would wake them rather
      // than spawning a new node where the user clicked).
      if (!isAlive(nodes[i])) continue
      const d = Math.hypot(nodes[i].x - mx, nodes[i].y - my)
      if (d < closestDist) {
        closestDist = d
        closest = i
      }
    }
    return closest
  }

  // Token motion: identical to `SyncFanOutBg` — the same `speed`
  // distribution (1.0 + r*0.7 progress/s), the same dt/1000 integrator,
  // and the same fade-in/out window in `drawToken`. With matching
  // motion law each token covers its from→to edge in the same fraction
  // of a second on both canvases, so the in-flight tokens animate "in
  // the same way". The visible pixel velocity will differ where edges
  // are physically shorter, but the motion law itself is the match.
  function tokenSpeed(): number {
    return (1.0 + Math.random() * 0.7) * Math.max(0.05, props.tokenSpeed)
  }

  function wakeAndSend(idx: number) {
    nodes[idx].awake = 1
    const neighbors = getNeighbors(idx, edges).filter((n) => isAlive(nodes[n]))
    if (neighbors.length > 0) {
      const howMany = Math.min(neighbors.length, 1 + Math.floor(Math.random() * 3))
      const shuffled = neighbors.sort(() => Math.random() - 0.5)
      for (let k = 0; k < howMany; k++) {
        const target = shuffled[k]
        const delay = 50 + Math.random() * 200
        setTimeout(() => {
          if (!running) return
          // Topology may have changed during the delay — re-check
          // before queuing the message so we don't render a token
          // hopping between nodes that no longer share an edge.
          if (idx >= nodes.length || target >= nodes.length) return
          if (!isAlive(nodes[idx]) || !isAlive(nodes[target])) return
          if (!hasEdge(idx, target)) return
          messages.push({
            from: idx,
            to: target,
            progress: 0,
            speed: tokenSpeed(),
          })
        }, delay)
      }
    }
  }

  // Re-triangulate edges for the current `nodes` array. Called after
  // any add or remove so the mesh stays a Delaunay graph (or close
  // to one — node tweens will momentarily put the geometry slightly
  // out of date until they settle, which we accept as part of the
  // organic-growth feel).
  function rebuildEdges() {
    if (nodes.length < 2) {
      edges = []
      rebuildEdgeSet()
      return
    }
    const pts = nodes.map((n) => ({ x: n.x, y: n.y }))
    const raw = delaunay(pts)
    edges = pruneEdges(raw, nodes, 200)
    rebuildEdgeSet()
  }

  // Pick a candidate spawn position respecting:
  //   - canvas padding
  //   - exclusion zones (text rects)
  //   - minimum distance from existing nodes (so spawns don't pile up)
  //   - `spawnMaxDist` (when >0): position must be within that
  //     distance of at least one existing node.
  // Returns `null` if no valid position was found in 80 tries —
  // caller should treat this as a no-op rather than retrying
  // forever.
  function pickRandomSpawnPos(): { x: number; y: number } | null {
    const padding = 30
    const minDist = 50
    const maxDist = props.spawnMaxDist > 0 ? props.spawnMaxDist : Infinity
    // Only use alive nodes as spawn anchors / collision targets.
    // A dying node is visibly fading out and shouldn't be treated
    // as occupying its slot for the purpose of growing the mesh.
    const alive = nodes.filter(isAlive)
    for (let tries = 0; tries < 80; tries++) {
      let cx: number
      let cy: number
      if (alive.length > 0 && maxDist !== Infinity) {
        // Sample within a ring around a random existing node so the
        // mesh grows outward locally rather than scattering.
        const seed = alive[Math.floor(Math.random() * alive.length)]
        const angle = Math.random() * Math.PI * 2
        const r = minDist + Math.random() * Math.max(1, maxDist - minDist)
        cx = seed.x + Math.cos(angle) * r
        cy = seed.y + Math.sin(angle) * r
      } else {
        cx = padding + Math.random() * (w - padding * 2)
        cy = padding + Math.random() * (h - padding * 2)
      }
      if (cx < padding || cx > w - padding) continue
      if (cy < padding || cy > h - padding) continue
      if (hitsExclusion(cx, cy, debugExclusions, 4)) continue
      if (alive.some((n) => Math.hypot(n.x - cx, n.y - cy) < minDist)) continue
      return { x: cx, y: cy }
    }
    return null
  }

  // Add a node at (x, y) and (optionally) push existing neighbours
  // outward along the line from the new node, animated toward
  // `targetX`/`targetY` over the next ~half second by the tween in
  // `tick`. Honours `maxNodes` as the upper bound. Returns the new
  // node's index, or -1 if we declined to spawn (cap reached).
  function addNodeAt(x: number, y: number): number {
    const cap = Math.max(8, Math.floor(props.maxNodes))
    if (nodes.length >= cap) return -1
    if (props.repositionOnSpawn) {
      const repulse = 22 // max push, px
      const range = 90 // ignore nodes farther than this
      for (const n of nodes) {
        const dx = n.x - x
        const dy = n.y - y
        const d = Math.hypot(dx, dy) || 0.01
        if (d > range) continue
        const push = repulse * (1 - d / range)
        n.targetX = Math.max(20, Math.min(w - 20, n.x + (dx / d) * push))
        n.targetY = Math.max(20, Math.min(h - 20, n.y + (dy / d) * push))
      }
    }
    const types = ENTITY_TYPES
    const node: Node = {
      x,
      y,
      targetX: x,
      targetY: y,
      // Spawn awake so the new node pulses immediately on top of
      // the birth scale-in — gives the user feedback that their
      // click landed and produces a satisfying pop.
      awake: 1,
      birthT: 0,
      dyingT: 0,
      entityType: types[Math.floor(Math.random() * types.length)],
      instanceId: randomId(),
    }
    nodes.push(node)
    const newIdx = nodes.length - 1
    rebuildEdges()
    announceSpawn(newIdx)
    return newIdx
  }

  // Send a burst of messages from a freshly-spawned node to (most
  // of) its newly-connected neighbours. Reads as the agent
  // "announcing itself" to the network — gives the spawn a
  // visible ripple in addition to the birth-tween pop. Per-edge
  // Bernoulli at 0.7 means small neighbourhoods reliably fire one
  // or two messages while large ones don't fan out into a wall of
  // simultaneous tokens. Delays are jittered (80–360 ms) so the
  // messages stagger visually rather than all leaving at frame 0.
  function announceSpawn(idx: number) {
    if (idx < 0 || idx >= nodes.length) return
    const neighbors = getNeighbors(idx, edges).filter((n) => isAlive(nodes[n]))
    if (neighbors.length === 0) return
    for (const target of neighbors) {
      if (Math.random() > 0.7) continue
      const delay = 80 + Math.random() * 280
      setTimeout(() => {
        if (!running) return
        // Re-validate — the topology may have changed during the
        // delay (a neighbour died, or a re-triangulation dropped
        // the edge). Same guard pattern as wakeAndSend / cascade.
        if (idx >= nodes.length || target >= nodes.length) return
        if (!isAlive(nodes[idx]) || !isAlive(nodes[target])) return
        if (!hasEdge(idx, target)) return
        messages.push({
          from: idx,
          to: target,
          progress: 0,
          speed: tokenSpeed(),
        })
      }, delay)
    }
  }

  // Mark a node as dying. The actual splice + edge/message
  // remapping happens in `tick` once the node's `dyingT` clock
  // crosses `DEATH_DURATION` — this gives the user a visible
  // shrink + fade rather than the node vanishing instantly. While
  // a node is dying it stays in the `nodes` array (so existing
  // edges still anchor to it during the fade), but is filtered
  // out of click / hover hits, random spawn pickers, and cascade
  // targets via `isAlive`.
  function markNodeDying(idx: number) {
    if (idx < 0 || idx >= nodes.length) return
    if (nodes[idx].dyingT === 0) {
      nodes[idx].dyingT = 0.001
      // Suppress any awake glow so the death tween is clearly a
      // shrink + fade (not a still-pulsing blob).
      nodes[idx].awake = 0
    }
  }

  function isAlive(n: Node): boolean {
    return n.dyingT === 0
  }

  // Hard removal — runs from `tick` once the death animation
  // completes. Edges and in-flight messages have any reference to
  // `idx` dropped, and every higher index is decremented by one
  // since `splice` shifts the array above the removed slot.
  function purgeNodeAtIdx(idx: number) {
    if (idx < 0 || idx >= nodes.length) return
    edges = edges
      .filter(([a, b]) => a !== idx && b !== idx)
      .map(([a, b]) => [
        a > idx ? a - 1 : a,
        b > idx ? b - 1 : b,
      ] as [number, number])
    messages = messages
      .filter((m) => m.from !== idx && m.to !== idx)
      .map((m) => ({
        ...m,
        from: m.from > idx ? m.from - 1 : m.from,
        to: m.to > idx ? m.to - 1 : m.to,
      }))
    nodes.splice(idx, 1)
    rebuildEdgeSet()
    if (hoveredNode === idx) hoveredNode = -1
    else if (hoveredNode > idx) hoveredNode--
  }

  function onMouseMove(e: MouseEvent) {
    const rect = el!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const idx = findNodeAt(mx, my)
    hoveredNode = idx

    if (idx >= 0) {
      // Cursor stays "pointer" so click-to-wake / spawn-on-click
      // still feel interactive even when labels are off.
      el!.style.cursor = "pointer"
      if (props.hideLabels) {
        tt!.style.opacity = "0"
      } else {
        const node = nodes[idx]
        const state = node.awake > 0.1 ? "active" : "idle"
        tt!.textContent = `/${node.entityType}/${node.instanceId}  ·  ${state}`
        tt!.style.opacity = "1"
        tt!.style.left = `${node.x}px`
        tt!.style.top = `${node.y - 28}px`
      }
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
      return
    }
    // Empty-canvas click: optionally spawn a new agent here.
    // Suppress when the click lands on text, when spawn-on-click is
    // off, or when `spawnMaxDist` says this point is too far from
    // any existing node.
    if (!props.spawnOnClick) return
    if (hitsExclusion(mx, my, debugExclusions, 4)) return
    if (props.spawnMaxDist > 0 && nodes.length > 0) {
      let nearest = Infinity
      for (const n of nodes) {
        const d = Math.hypot(n.x - mx, n.y - my)
        if (d < nearest) nearest = d
      }
      if (nearest > props.spawnMaxDist) return
    }
    addNodeAt(mx, my)
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
      // Edge lifetime is gated by the weakest endpoint — a line
      // with one dying endpoint should fade out together with that
      // node, not linger as a half-anchored segment.
      const lifeEdge = Math.min(lifeFactor(na), lifeFactor(nb))
      if (lifeEdge <= 0.001) continue
      const awakeLevel = Math.max(na.awake, nb.awake)
      const isHoverEdge = hoveredNode === a || hoveredNode === b

      let alpha: number
      if (awakeLevel > 0.05) {
        alpha = (dark ? 0.1 : 0.08) + awakeLevel * (dark ? 0.2 : 0.14)
      } else {
        alpha = dark ? 0.08 : 0.06
      }
      if (isHoverEdge) alpha = Math.max(alpha, dark ? 0.2 : 0.15)
      alpha *= fade * lifeEdge

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
    // Same glowing-comet style as the sync fan-out (`SyncFanOutBg`) and
    // streams flow (`StreamFlowBg`) — a short trailing gradient, a soft
    // radial halo, and a bright head — so the in-flight tokens read as
    // a single visual language across all three product canvases on the
    // homepage iso stack.
    const teal = (a: number) =>
      dark ? `rgba(0,210,190,${a})` : `rgba(0,180,160,${a})`
    for (const msg of messages) {
      // Defensive: a node can be removed by the die-rate accumulator
      // (or a resize) between when a `setTimeout`-deferred cascade
      // captured its target index and when the message reaches the
      // draw loop. Skip messages whose endpoints no longer exist
      // rather than crashing on `nodes[N]` returning undefined.
      if (msg.from >= nodes.length || msg.to >= nodes.length) continue
      // Re-triangulation on spawn/death can rewrite the mesh, so a
      // message that was created along a valid edge may now be
      // travelling between two nodes with no line between them.
      // Skip it rather than render a token in empty space.
      if (!hasEdge(msg.from, msg.to)) continue
      const from = nodes[msg.from]
      const to = nodes[msg.to]
      const x = from.x + (to.x - from.x) * msg.progress
      const y = from.y + (to.y - from.y) * msg.progress
      const fade = edgeFade(x, y)
      const lifeAlpha =
        msg.progress < 0.12
          ? msg.progress / 0.12
          : msg.progress > 0.88
            ? (1 - msg.progress) / 0.12
            : 1
      const a = lifeAlpha * fade
      if (a < 0.04) continue

      // Comet tail
      const tailLen = 22
      const dx = to.x - from.x
      const dy = to.y - from.y
      const len = Math.hypot(dx, dy) || 1
      const tx = x - (dx / len) * tailLen
      const ty = y - (dy / len) * tailLen
      const grad = c!.createLinearGradient(tx, ty, x, y)
      grad.addColorStop(0, teal(0))
      grad.addColorStop(1, teal(0.7 * a))
      c!.strokeStyle = grad
      c!.lineWidth = 1.6
      c!.lineCap = "round"
      c!.beginPath()
      c!.moveTo(tx, ty)
      c!.lineTo(x, y)
      c!.stroke()

      // Soft halo around the head
      const r = 9
      const halo = c!.createRadialGradient(x, y, 0, x, y, r)
      halo.addColorStop(0, teal(0.55 * a))
      halo.addColorStop(1, teal(0))
      c!.fillStyle = halo
      c!.beginPath()
      c!.arc(x, y, r, 0, Math.PI * 2)
      c!.fill()

      // Bright head
      c!.fillStyle = teal(a)
      c!.beginPath()
      c!.arc(x, y, 2.8, 0, Math.PI * 2)
      c!.fill()
    }

    // --- Draw nodes ---
    for (let ni = 0; ni < nodes.length; ni++) {
      const node = nodes[ni]
      const a = node.awake
      const fade = edgeFade(node.x, node.y)
      if (fade < 0.01) continue

      // Birth/death tween — scales radius and alpha together, with
      // a slight overshoot on birth (an exponential ease-out
      // pushes past 1 briefly before settling) so spawns "pop"
      // rather than just inflate. `lifeFactor` is 0..1, multiplies
      // alpha. `scale` adds the small overshoot bump on top.
      const life = lifeFactor(node)
      if (life <= 0.001) continue
      let scale = life
      if (node.birthT < BIRTH_DURATION && node.dyingT === 0) {
        // 0..1 birth progress, ease-out cubic with a 1.18 peak —
        // the ring/dot briefly overshoots their final radius and
        // settle, which reads as a satisfying pop.
        const t = node.birthT / BIRTH_DURATION
        const ease = 1 - Math.pow(1 - t, 3)
        const overshoot = Math.sin(t * Math.PI) * 0.18
        scale = ease + overshoot
      }

      const isHovered = hoveredNode === ni
      const isActive = a > 0.1

      if (isActive || isHovered) {
        const level = isHovered ? Math.max(a, 0.5) : a

        // Active glow ring
        const ga = level * 0.4 * fade * life
        c!.strokeStyle = dark
          ? `rgba(0,210,190,${ga})`
          : `rgba(0,180,160,${ga})`
        c!.lineWidth = 1.5
        c!.beginPath()
        c!.arc(node.x, node.y, (7 + level * 4) * scale, 0, Math.PI * 2)
        c!.stroke()

        // Active filled circle
        const fa = (0.45 + level * 0.5) * fade * life
        c!.fillStyle = dark
          ? `rgba(0,210,190,${fa})`
          : `rgba(0,180,160,${fa})`
        c!.beginPath()
        c!.arc(node.x, node.y, 4 * scale, 0, Math.PI * 2)
        c!.fill()
      } else {
        // Idle: smaller, muted dot
        const ia = (dark ? 0.18 : 0.12) * fade * life
        c!.fillStyle = dark
          ? `rgba(255,255,255,${ia})`
          : `rgba(0,0,0,${ia})`
        c!.beginPath()
        c!.arc(node.x, node.y, 2.5 * scale, 0, Math.PI * 2)
        c!.fill()
      }
    }

    // --- Draw always-on labels ---
    // When `labelsOnHover` is false we render the same
    // `/{entityType}/{instanceId}` text the hover tooltip shows,
    // permanently anchored under each node. Same teal palette as
    // SyncFanOutBg / StreamFlowBg so the three hero canvases share
    // a visual language. Hovered nodes still get the DOM tooltip
    // (it's higher contrast and won't collide with neighbouring
    // labels), so we skip drawing the canvas label for the hovered
    // node to avoid double-stacking the same string.
    if (!props.labelsOnHover && !props.hideLabels) {
      c!.font = `11px var(--vp-font-family-mono)`
      c!.textAlign = "center"
      c!.textBaseline = "top"
      for (let ni = 0; ni < nodes.length; ni++) {
        if (ni === hoveredNode) continue
        const node = nodes[ni]
        const fade = edgeFade(node.x, node.y)
        if (fade < 0.01) continue
        const life = lifeFactor(node)
        if (life <= 0.001) continue
        const isActive = node.awake > 0.1
        const baseAlpha = isActive ? 0.7 : dark ? 0.42 : 0.5
        const a = baseAlpha * fade * life
        if (a < 0.04) continue
        c!.fillStyle = dark
          ? `rgba(0,210,190,${a})`
          : `rgba(0,180,160,${a})`
        c!.fillText(
          `/${node.entityType}/${node.instanceId}`,
          node.x,
          node.y + 10,
        )
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
    // When paused, awake levels and in-flight messages are held
    // wherever they were seeded so the scene reads as a paused
    // snapshot rather than slowly decaying to nothing.
    //
    // Position tweens (`targetX`/`targetY`) also advance only when
    // unpaused: we ease toward the target on an exponential curve
    // with a ~half-second half-life so node nudges from a recent
    // spawn settle organically without overshooting. Edges are
    // re-triangulated only on add/remove (not every frame) — so
    // mid-tween the existing edges trail their endpoints slightly,
    // which reads as the mesh "flexing" rather than snapping.
    if (!props.paused) {
      const easeRate = 1 - Math.pow(0.001, dt / 500)
      for (const node of nodes) {
        node.awake = Math.max(0, node.awake - dt * 0.00025)
        const dxT = node.targetX - node.x
        const dyT = node.targetY - node.y
        if (Math.abs(dxT) > 0.05 || Math.abs(dyT) > 0.05) {
          node.x += dxT * easeRate
          node.y += dyT * easeRate
        }
      }
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      // Drop messages whose endpoints have gone away (see comment
      // in the draw loop above). This both stops the dangling token
      // from rendering and prevents the arrival branch below from
      // dereferencing a missing node.
      if (
        messages[i].from >= nodes.length ||
        messages[i].to >= nodes.length
      ) {
        messages.splice(i, 1)
        continue
      }
      // Same orphan check as the draw loop — re-triangulation can
      // strand a message between two nodes that are no longer
      // edge-connected. Drop it so it doesn't "arrive" and seed a
      // cascade through the gap.
      if (!hasEdge(messages[i].from, messages[i].to)) {
        messages.splice(i, 1)
        continue
      }
      if (!props.paused) {
        messages[i].progress += messages[i].speed * dt * 0.001
      }
      if (!props.paused && messages[i].progress >= 1) {
        const arrivedAt = messages[i].to
        const arrivedFrom = messages[i].from
        nodes[arrivedAt].awake = Math.min(1, nodes[arrivedAt].awake + 0.85)
        messages.splice(i, 1)

        if (Math.random() < Math.max(0, Math.min(1, props.cascadeChance))) {
          const neighbors = getNeighbors(arrivedAt, edges).filter(
            (n) => n !== arrivedFrom && isAlive(nodes[n])
          )
          if (neighbors.length > 0) {
            const count = Math.random() < 0.2 ? 2 : 1
            const shuffled = neighbors.sort(() => Math.random() - 0.5)
            for (let k = 0; k < Math.min(count, shuffled.length); k++) {
              const next = shuffled[k]
              const delay = 150 + Math.random() * 350
              setTimeout(() => {
                if (!running) return
                // Topology may have changed during the delay (a
                // node spawned/died and re-triangulated the mesh).
                // Only push the cascade message if both endpoints
                // still exist, are alive, and are still connected.
                if (arrivedAt >= nodes.length || next >= nodes.length) return
                if (!isAlive(nodes[arrivedAt]) || !isAlive(nodes[next])) return
                if (!hasEdge(arrivedAt, next)) return
                messages.push({
                  from: arrivedAt,
                  to: next,
                  progress: 0,
                  speed: tokenSpeed(),
                })
              }, delay)
            }
          }
        }
      }
    }

    // --- Ambient node spawn / death ---
    // Driven by `spawnRate` / `dieRate` (nodes per second). Both
    // accumulators tick only when unpaused. Spawn honours
    // `maxNodes` and `spawnMaxDist`; die marks a random alive
    // victim, which then plays the shrink + fade tween before the
    // actual array splice happens further down (see "Birth / death
    // tween advance" below).
    if (!props.paused) {
      const spawnRate = Math.max(0, props.spawnRate)
      const dieRate = Math.max(0, props.dieRate)
      if (spawnRate > 0) {
        spawnAcc += spawnRate * (dt / 1000)
        const cap = Math.max(8, Math.floor(props.maxNodes))
        // Cap how many we'll attempt per frame so a huge rate
        // bump can't lock the main thread on a single tick.
        let attempts = 0
        while (spawnAcc >= 1 && attempts < 8 && nodes.length < cap) {
          spawnAcc -= 1
          attempts++
          const pos = pickRandomSpawnPos()
          if (pos) addNodeAt(pos.x, pos.y)
        }
        if (spawnAcc > 1) spawnAcc = 1 // don't bank up rate while at cap
      } else {
        spawnAcc = 0
      }
      if (dieRate > 0) {
        dieAcc += dieRate * (dt / 1000)
        // Only pick from alive nodes — re-killing a fading node
        // would do nothing (markNodeDying is idempotent) and would
        // burn an accumulator tick on a no-op.
        const aliveIdxs: number[] = []
        for (let i = 0; i < nodes.length; i++) {
          if (isAlive(nodes[i])) aliveIdxs.push(i)
        }
        let attempts = 0
        while (dieAcc >= 1 && attempts < 8 && aliveIdxs.length > 0) {
          dieAcc -= 1
          attempts++
          const pickPos = Math.floor(Math.random() * aliveIdxs.length)
          markNodeDying(aliveIdxs[pickPos])
          aliveIdxs.splice(pickPos, 1)
        }
        if (dieAcc > 1) dieAcc = 1
      } else {
        dieAcc = 0
      }
    }

    // --- Birth / death tween advance ---
    // Always advance birth/death clocks (even when paused) so a
    // pause doesn't strand half-faded ghosts on screen — the death
    // animation should always finish promptly. Once a node's
    // `dyingT` exceeds DEATH_DURATION we splice it out, which also
    // rebuilds the edge mesh so the surrounding triangles re-knit
    // around the gap.
    let purgedAny = false
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]
      if (n.birthT < BIRTH_DURATION) {
        n.birthT = Math.min(BIRTH_DURATION, n.birthT + dt)
      }
      if (n.dyingT > 0) {
        n.dyingT += dt
        if (n.dyingT >= DEATH_DURATION) {
          purgeNodeAtIdx(i)
          purgedAny = true
        }
      }
    }
    if (purgedAny) rebuildEdges()

    // --- Spawn random wakes & messages ---
    // `activity` scales the dt accumulation toward the next ambient
    // wake, so rate scales linearly without skewing the random
    // jitter window. 0 freezes ambient spawns (in-flight messages
    // still arrive and may chain via `cascadeChance`).
    const activity = Math.max(0, props.activity)
    if (activity > 0) nextSend -= dt * activity
    if (!props.paused && activity > 0 && nextSend <= 0 && nodes.length > 0) {
      nextSend = 800 + Math.random() * 2000
      // Pick from alive nodes only — waking a fading node would
      // make it briefly flash back up before its death tween wins,
      // which reads as a glitch.
      const aliveStarts: number[] = []
      for (let i = 0; i < nodes.length; i++) {
        if (isAlive(nodes[i])) aliveStarts.push(i)
      }
      if (aliveStarts.length > 0) {
        const startNode =
          aliveStarts[Math.floor(Math.random() * aliveStarts.length)]
        nodes[startNode].awake = Math.min(1, nodes[startNode].awake + 0.95)
        const neighbors = getNeighbors(startNode, edges).filter(
          (n) => isAlive(nodes[n])
        )
        if (neighbors.length > 0) {
          const howMany = Math.random() < 0.3 ? 2 : 1
          const shuffled = neighbors.sort(() => Math.random() - 0.5)
          for (let k = 0; k < Math.min(howMany, shuffled.length); k++) {
            const target = shuffled[k]
            setTimeout(() => {
              if (!running) return
              // Same topology check as cascades — the mesh may
              // have re-triangulated during the launch delay.
              if (startNode >= nodes.length || target >= nodes.length) return
              if (!isAlive(nodes[startNode]) || !isAlive(nodes[target])) return
              if (!hasEdge(startNode, target)) return
              messages.push({
                from: startNode,
                to: target,
                progress: 0,
                speed: tokenSpeed(),
              })
            }, 200 + Math.random() * 400)
          }
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
