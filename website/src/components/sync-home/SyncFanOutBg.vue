<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue"

// Hero background that conveys the Electric Sync mental model:
//   a database table of rows, with SHAPES (where-clauses) carving
//   subsets out of it, each subset SYNCED to one or more CLIENTS.
//
// Visual conventions match Agents/Streams hero backgrounds:
//   - HTML canvas, hairline 1px geometry on a teal palette
//   - radial fade so the headline copy sits on a quiet centre
//   - text-rect exclusions so geometry never lands on the text
//   - hover tooltips + click-to-fire for tactile life

const props = defineProps<{
  excludeEl?: HTMLElement
  // When true, persistent shape and client labels are hidden until
  // their entity is hovered. The sync landing-page hero leaves this
  // off to keep its identifying labels always-on; the homepage opts
  // in so the framed scenes read as cleanly as the agents/streams
  // canvases (which never draw labels at rest).
  labelsOnHover?: boolean
  // When true, no random update tokens auto-spawn. Existing tokens
  // continue to flight, hover labels still work, and clicking a
  // shape or client still fires updates manually. Used by the
  // homepage section graphic to suppress ambient activity.
  paused?: boolean
  // When true, the radial edge-fade that softens shapes near the
  // canvas borders is disabled, so the grid fills the whole frame
  // at full intensity. Used by the homepage iso-stack hero where
  // the canvas already sits inside a crisp bordered card.
  noEdgeFade?: boolean
}>()

const canvas = ref<HTMLCanvasElement>()
const tooltip = ref<HTMLDivElement>()
let raf = 0
let running = false

const SHAPE_LIBRARY: { name: string; clause: string }[] = [
  { name: "open_tickets", clause: "where status = 'open'" },
  { name: "my_team", clause: "where team = $me" },
  { name: "recent", clause: "where updated > now() - 1d" },
  { name: "critical", clause: "where priority = 'P0'" },
  { name: "in_review", clause: "where status = 'review'" },
  { name: "by_owner", clause: "where owner_id = $me" },
  { name: "active_users", clause: "where active = true" },
]

interface Row {
  x: number
  y: number
  baseAlpha: number
  shapeIds: number[]
  flash: number
  rowId: string
}

interface Shape {
  id: number
  name: string
  clause: string
  rowIndices: number[]
  bbox: { left: number; top: number; right: number; bottom: number }
  clientIds: number[]
  labelSide: "above" | "below"
}

interface Client {
  id: number
  name: string
  x: number
  y: number
  pulse: number
  shapeIds: number[]
}

interface Token {
  shapeId: number
  fromX: number
  fromY: number
  toX: number
  toY: number
  progress: number
  speed: number
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
  margin: number,
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

function rectHitsExclusion(
  bbox: { left: number; top: number; right: number; bottom: number },
  zones: ExcludeRect[],
  margin: number,
): boolean {
  for (const z of zones) {
    if (
      bbox.right + margin > z.left &&
      bbox.left - margin < z.right &&
      bbox.bottom + margin > z.top &&
      bbox.top - margin < z.bottom
    )
      return true
  }
  return false
}

function randomRowId(): string {
  const chars = "abcdef0123456789"
  let s = ""
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

onMounted(() => {
  const el = canvas.value
  const tt = tooltip.value
  if (!el || !tt) return
  const c = el.getContext("2d")
  if (!c) return

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches

  let dpr = 1
  let w = 0
  let h = 0
  let rows: Row[] = []
  let shapes: Shape[] = []
  let clients: Client[] = []
  let tokens: Token[] = []
  let exclusions: ExcludeRect[] = []
  let nextSpawn = 600 + Math.random() * 800
  let last = 0
  let hoveredShape = -1
  let hoveredClient = -1
  let hoveredRow = -1

  function getTextRects(element: Element): DOMRect[] {
    const rects: DOMRect[] = []
    const range = document.createRange()
    const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let textNode: Text | null
    while ((textNode = walk.nextNode() as Text | null)) {
      if (!textNode.textContent?.trim()) continue
      range.selectNodeContents(textNode)
      const nodeRects = range.getClientRects()
      for (let i = 0; i < nodeRects.length; i++) rects.push(nodeRects[i])
    }
    element
      .querySelectorAll("a, button, svg, img, input, .sh-hero-install")
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

  // ── Build the scene ────────────────────────────────────────────
  function buildRows() {
    rows = []
    // Jittered grid so the table reads as "data" not "decoration".
    const cellW = 46
    const cellH = 38
    const cols = Math.max(8, Math.floor(w / cellW))
    const rowsCount = Math.max(5, Math.floor(h / cellH))
    const padX = (w - cols * cellW) / 2
    const padY = (h - rowsCount * cellH) / 2
    for (let cy = 0; cy < rowsCount; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const x = padX + cx * cellW + cellW / 2
        const y = padY + cy * cellH + cellH / 2
        if (hitsExclusion(x, y, exclusions, 12)) continue
        if (x < 14 || x > w - 14 || y < 14 || y > h - 14) continue
        rows.push({
          x,
          y,
          baseAlpha: 0.5 + Math.random() * 0.4,
          shapeIds: [],
          flash: 0,
          rowId: randomRowId(),
        })
      }
    }
  }

  function rowsInRect(r: ExcludeRect): number[] {
    const out: number[] = []
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (
        row.x >= r.left &&
        row.x <= r.right &&
        row.y >= r.top &&
        row.y <= r.bottom
      )
        out.push(i)
    }
    return out
  }

  function tryPlaceShapeInRegion(
    region: ExcludeRect,
    minRows: number,
    maxRows: number,
    attempts = 50,
    allowOverlap = false,
  ): { rowIndices: number[]; bbox: ExcludeRect } | null {
    // Restrict candidate seeds to rows that already live inside this
    // region so the shape lands where we want it on the hero. When
    // `allowOverlap` is set we also accept rows that already belong
    // to another shape, so the second pass of `buildShapes` can lay
    // shapes on top of each other (the visual reads as overlapping
    // where-clauses sharing rows from the same table).
    const candidates: number[] = []
    for (let i = 0; i < rows.length; i++) {
      if (!allowOverlap && rows[i].shapeIds.length > 0) continue
      const r = rows[i]
      if (
        r.x >= region.left &&
        r.x <= region.right &&
        r.y >= region.top &&
        r.y <= region.bottom
      )
        candidates.push(i)
    }
    if (candidates.length < 3) return null

    for (let i = 0; i < attempts; i++) {
      const targetCount =
        minRows + Math.floor(Math.random() * (maxRows - minRows + 1))
      const seedIdx = candidates[Math.floor(Math.random() * candidates.length)]
      const seedRow = rows[seedIdx]
      if (!seedRow) continue
      const halfW = 48 + targetCount * 8 + Math.random() * 12
      const halfH = 28 + Math.floor(targetCount / 2) * 12 + Math.random() * 10
      const bbox = {
        left: Math.max(14, seedRow.x - halfW),
        top: Math.max(14, seedRow.y - halfH),
        right: Math.min(w - 14, seedRow.x + halfW),
        bottom: Math.min(h - 14, seedRow.y + halfH),
      }
      // Clamp bbox to region so shapes don't leak across the hero.
      bbox.left = Math.max(bbox.left, region.left - 8)
      bbox.top = Math.max(bbox.top, region.top - 8)
      bbox.right = Math.min(bbox.right, region.right + 8)
      bbox.bottom = Math.min(bbox.bottom, region.bottom + 8)
      if (rectHitsExclusion(bbox, exclusions, 14)) continue
      const inside = rowsInRect(bbox)
      // In the no-overlap pass we only count unowned rows toward the
      // shape's membership (so two shapes never claim the same row);
      // in the overlap pass any row inside the bbox counts, which is
      // what makes a second shape visually share rows with a first.
      const claimable = allowOverlap
        ? inside
        : inside.filter((idx) => rows[idx].shapeIds.length === 0)
      if (claimable.length < 3) continue

      let l = Infinity,
        t = Infinity,
        r = -Infinity,
        b = -Infinity
      for (const idx of claimable) {
        l = Math.min(l, rows[idx].x)
        t = Math.min(t, rows[idx].y)
        r = Math.max(r, rows[idx].x)
        b = Math.max(b, rows[idx].y)
      }
      const tightBbox = {
        left: l - 14,
        top: t - 12,
        right: r + 14,
        bottom: b + 12,
      }
      if (rectHitsExclusion(tightBbox, exclusions, 8)) continue
      return { rowIndices: claimable, bbox: tightBbox }
    }
    return null
  }

  function buildClients() {
    // Anchors well clear of the headline + button stack. Names are
    // assigned later from the shape each client ends up syncing.
    const anchors: { x: number; y: number }[] = [
      { x: w * 0.07, y: h * 0.1 },
      { x: w * 0.93, y: h * 0.1 },
      { x: w * 0.05, y: h * 0.88 },
      { x: w * 0.95, y: h * 0.88 },
      { x: w * 0.5, y: h * 0.96 },
    ]
    const valid = anchors.filter(
      (a) => !hitsExclusion(a.x, a.y, exclusions, 36),
    )
    // Five anchors when they all clear the headline — gives the second,
    // overlapping pass somewhere new to point its tokens.
    clients = valid.slice(0, Math.min(5, valid.length)).map((a, i) => ({
      id: i,
      name: "",
      x: a.x,
      y: a.y,
      pulse: 0,
      shapeIds: [],
    }))
  }

  function clientsByDistance(bbox: ExcludeRect): { id: number; dist: number }[] {
    const cx = (bbox.left + bbox.right) / 2
    const cy = (bbox.top + bbox.bottom) / 2
    return clients
      .map((cl) => ({
        id: cl.id,
        dist: Math.hypot(cl.x - cx, cl.y - cy),
      }))
      .sort((a, b) => a.dist - b.dist)
  }

  function nearestClientTo(bbox: ExcludeRect): number {
    const sorted = clientsByDistance(bbox)
    return sorted.length ? sorted[0].id : 0
  }

  function buildShapes() {
    shapes = []
    const lib = [...SHAPE_LIBRARY].sort(() => Math.random() - 0.5)

    // Even distribution: split the hero into a 2x2 quadrant grid and try
    // to place exactly one shape inside each quadrant. We carve a small
    // inner margin so quadrant edges don't touch each other.
    const margin = 18
    const midX = w / 2
    const midY = h / 2
    const quadrants: ExcludeRect[] = [
      { left: margin, top: margin, right: midX - margin / 2, bottom: midY - margin / 2 },
      { left: midX + margin / 2, top: margin, right: w - margin, bottom: midY - margin / 2 },
      { left: margin, top: midY + margin / 2, right: midX - margin / 2, bottom: h - margin },
      { left: midX + margin / 2, top: midY + margin / 2, right: w - margin, bottom: h - margin },
    ]
    // Shuffle the quadrant order so shape names rotate around the hero
    // on each mount instead of always starting top-left.
    const order = quadrants
      .map((q, i) => ({ q, i }))
      .sort(() => Math.random() - 0.5)

    let id = 0
    const placeShape = (
      placed: { rowIndices: number[]; bbox: ExcludeRect },
    ) => {
      const def = lib[id % lib.length]
      const clientId = nearestClientTo(placed.bbox)
      if (
        clients[clientId] &&
        Math.hypot(
          (placed.bbox.left + placed.bbox.right) / 2 - clients[clientId].x,
          (placed.bbox.top + placed.bbox.bottom) / 2 - clients[clientId].y,
        ) < 70
      ) {
        return false
      }
      const labelSide: "above" | "below" =
        placed.bbox.top - 18 > 4 &&
        !hitsExclusion(
          (placed.bbox.left + placed.bbox.right) / 2,
          placed.bbox.top - 14,
          exclusions,
          6,
        )
          ? "above"
          : "below"
      const shape: Shape = {
        id,
        name: def.name,
        clause: def.clause,
        rowIndices: placed.rowIndices,
        bbox: placed.bbox,
        clientIds: [clientId],
        labelSide,
      }
      shapes.push(shape)
      clients[clientId].shapeIds.push(id)
      // Each client takes the name of the shape it's syncing — the
      // subscriber is named after the subset it pulls from Postgres,
      // so the link is unambiguous on the page.
      clients[clientId].name = `/${def.name}`
      for (const ri of placed.rowIndices) {
        // A row may already belong to another shape (from the overlap
        // pass below); just append rather than replace.
        if (!rows[ri].shapeIds.includes(id)) rows[ri].shapeIds.push(id)
      }
      id++
      return true
    }

    // Pass 1 — one non-overlapping shape per quadrant. This gives the
    // hero its anchor structure, with each shape having its own slice
    // of the table and its own client to sync to.
    for (const { q } of order) {
      const placed = tryPlaceShapeInRegion(q, 3, 5)
      if (placed) placeShape(placed)
    }

    // Pass 2 — additional smaller shapes that ARE allowed to overlap
    // existing ones. This gives the canvas ~50% more activity (extra
    // shapes → extra spawn targets → more tokens flying around) and
    // visually conveys that multiple where-clauses can share rows
    // from the same table. We attempt one extra shape per quadrant
    // and stop when we've added two so the scene doesn't get noisy.
    let added = 0
    const extraOrder = quadrants
      .map((q, i) => ({ q, i }))
      .sort(() => Math.random() - 0.5)
    for (const { q } of extraOrder) {
      if (added >= 2) break
      const placed = tryPlaceShapeInRegion(q, 3, 4, 60, true)
      if (placed && placeShape(placed)) added++
    }
  }

  function doLayout() {
    // `clientWidth/clientHeight` ignores CSS transforms, so the
    // canvas always sizes itself to the parent's logical inner
    // box even when the parent is 3D-rotated (e.g. the homepage
    // iso composition stack). `getBoundingClientRect` would
    // otherwise return the projected screen bounds of the
    // rotated rect and leave the grid stretched across the
    // wrong coordinate space.
    const parent = el!.parentElement!
    dpr = window.devicePixelRatio || 1
    w = parent.clientWidth
    h = parent.clientHeight
    el!.width = w * dpr
    el!.height = h * dpr
    el!.style.width = w + "px"
    el!.style.height = h + "px"
    c!.setTransform(dpr, 0, 0, dpr, 0, 0)
    exclusions = measureExclusions()
    tokens = []
    hoveredShape = -1
    hoveredClient = -1
    hoveredRow = -1
    buildRows()
    buildClients()
    buildShapes()

    // When paused, seed tokens mid-flight so the canvas reads as a
    // snapshot of an active sync rather than an empty grid. Each
    // shape contributes one row → all of its clients with random
    // progress, and the source rows stay flash-lit because the
    // pause also halts flash decay.
    if (props.paused && shapes.length > 0) {
      for (const shape of shapes) {
        if (shape.rowIndices.length === 0) continue
        const rowIdx =
          shape.rowIndices[
            Math.floor(Math.random() * shape.rowIndices.length)
          ]
        const row = rows[rowIdx]
        if (!row) continue
        row.flash = 1
        for (const cid of shape.clientIds) {
          const client = clients[cid]
          if (!client) continue
          tokens.push({
            shapeId: shape.id,
            fromX: row.x,
            fromY: row.y,
            toX: client.x,
            toY: client.y,
            progress: 0.15 + Math.random() * 0.7,
            speed: 0.6,
          })
        }
      }
    }
  }

  function resize() {
    doLayout()
  }

  // Two RAF tick to ensure layout/text is settled before measuring.
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

  // ── Drawing ────────────────────────────────────────────────────
  function teal(dark: boolean, alpha: number): string {
    const g = dark ? 210 : 180
    const b = dark ? 190 : 160
    return `rgba(0,${g},${b},${alpha})`
  }

  function muted(dark: boolean, alpha: number): string {
    return dark
      ? `rgba(255,255,255,${alpha})`
      : `rgba(0,0,0,${alpha})`
  }

  function roundRect(
    ctx: CanvasRenderingContext2D,
    bbox: ExcludeRect,
    radius: number,
  ) {
    const { left: x0, top: y0, right: x1, bottom: y1 } = bbox
    const r = Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2)
    ctx.beginPath()
    ctx.moveTo(x0 + r, y0)
    ctx.lineTo(x1 - r, y0)
    ctx.quadraticCurveTo(x1, y0, x1, y0 + r)
    ctx.lineTo(x1, y1 - r)
    ctx.quadraticCurveTo(x1, y1, x1 - r, y1)
    ctx.lineTo(x0 + r, y1)
    ctx.quadraticCurveTo(x0, y1, x0, y1 - r)
    ctx.lineTo(x0, y0 + r)
    ctx.quadraticCurveTo(x0, y0, x0 + r, y0)
    ctx.closePath()
  }

  function drawRow(row: Row, dark: boolean, idx: number) {
    const inShape = row.shapeIds.length > 0
    const hovered = idx === hoveredRow
    // Rows in shapes stay present at the periphery (so subsets read as
    // clusters) but at a softer tone than before.
    const fade = inShape
      ? Math.max(0.55, radialFade(row.x, row.y))
      : radialFade(row.x, row.y)
    if (fade < 0.02) return
    const flashLevel = row.flash
    const baseAlpha = (inShape ? 0.55 : 0.34) * row.baseAlpha * fade
    const flashAlpha = flashLevel * 0.9 * fade

    if (flashLevel > 0.05) {
      const r = 11 + flashLevel * 9
      const g = c!.createRadialGradient(row.x, row.y, 0, row.x, row.y, r)
      g.addColorStop(0, teal(dark, 0.55 * flashAlpha))
      g.addColorStop(1, teal(dark, 0))
      c!.fillStyle = g
      c!.beginPath()
      c!.arc(row.x, row.y, r, 0, Math.PI * 2)
      c!.fill()
    }

    if (inShape) {
      c!.fillStyle = teal(dark, Math.max(baseAlpha, flashAlpha))
    } else {
      c!.fillStyle = muted(dark, baseAlpha * (dark ? 0.55 : 0.6))
    }
    c!.beginPath()
    c!.arc(row.x, row.y, hovered ? 2.6 : inShape ? 2.1 : 1.4, 0, Math.PI * 2)
    c!.fill()
  }

  function drawShape(shape: Shape, dark: boolean) {
    const cx = (shape.bbox.left + shape.bbox.right) / 2
    const cy = (shape.bbox.top + shape.bbox.bottom) / 2
    // Shapes are the anchor of the metaphor — keep them fully visible
    // even when they sit in the periphery of the radial fade.
    const hovered =
      hoveredShape === shape.id ||
      (hoveredClient >= 0 && clients[hoveredClient].shapeIds.includes(shape.id))
    const dim = hoveredShape >= 0 && hoveredShape !== shape.id

    // Soft fill so the subset reads as a region.
    c!.save()
    roundRect(c!, shape.bbox, 12)
    c!.fillStyle = teal(
      dark,
      hovered ? 0.09 : dim ? 0.015 : 0.035,
    )
    c!.fill()
    c!.lineWidth = hovered ? 1.2 : 1
    c!.setLineDash([3, 4])
    c!.strokeStyle = teal(
      dark,
      hovered ? 0.7 : dim ? 0.12 : 0.36,
    )
    c!.stroke()
    c!.restore()

    // Connector lines to each subscribed client.
    for (const cid of shape.clientIds) {
      const client = clients[cid]
      if (!client) continue
      const fadeMid = Math.max(
        0.45,
        radialFade((cx + client.x) / 2, (cy + client.y) / 2),
      )
      const a = (hovered ? 0.5 : dim ? 0.08 : 0.22) * fadeMid
      if (a < 0.03) continue
      // Anchor on the bbox edge nearest the client.
      const ax = Math.max(shape.bbox.left, Math.min(shape.bbox.right, client.x))
      const ay = Math.max(shape.bbox.top, Math.min(shape.bbox.bottom, client.y))
      c!.save()
      c!.strokeStyle = teal(dark, a)
      c!.lineWidth = 1
      c!.setLineDash([2, 5])
      c!.beginPath()
      c!.moveTo(ax, ay)
      c!.lineTo(client.x, client.y)
      c!.stroke()
      c!.restore()
    }

    // Label: name above or below the bbox; clause appears under it
    // on hover so the geometry stays calm at rest. When the parent
    // opts into `labelsOnHover` the name itself only renders while
    // hovered.
    const showName = !props.labelsOnHover || hovered
    if (showName) {
      const labelY =
        shape.labelSide === "above" ? shape.bbox.top - 8 : shape.bbox.bottom + 16
      c!.save()
      c!.font = `11px var(--vp-font-family-mono)`
      c!.textAlign = "center"
      c!.textBaseline = "alphabetic"
      c!.fillStyle = teal(
        dark,
        hovered ? 0.95 : dim ? 0.28 : 0.6,
      )
      c!.fillText(`shape:${shape.name}`, cx, labelY)
      if (hovered) {
        c!.font = `11px var(--vp-font-family-mono)`
        c!.fillStyle = muted(dark, 0.55)
        c!.fillText(
          shape.clause,
          cx,
          shape.labelSide === "above" ? labelY - 14 : labelY + 14,
        )
      }
      c!.restore()
    }
  }

  function drawClient(client: Client, dark: boolean) {
    // A client is only drawn once a shape has been bound to it — we
    // only want to render real subscribers, named after their shape.
    if (client.shapeIds.length === 0) return
    // Clients are anchored to the corners by design — keep them fully
    // visible regardless of the radial fade.
    const hovered =
      hoveredClient === client.id ||
      (hoveredShape >= 0 && shapes[hoveredShape]?.clientIds.includes(client.id))
    const dim = hoveredClient >= 0 && hoveredClient !== client.id
    const pulse = client.pulse
    const ringR = 8 + pulse * 6

    // Outer ring
    c!.save()
    c!.strokeStyle = teal(
      dark,
      hovered ? 0.95 : dim ? 0.22 : 0.5 + pulse * 0.3,
    )
    c!.lineWidth = 1.2
    c!.beginPath()
    c!.arc(client.x, client.y, ringR, 0, Math.PI * 2)
    c!.stroke()

    // Inner core
    c!.fillStyle = teal(
      dark,
      hovered ? 1 : dim ? 0.4 : 0.7 + pulse * 0.2,
    )
    c!.beginPath()
    c!.arc(client.x, client.y, 3, 0, Math.PI * 2)
    c!.fill()

    // Label — hidden at rest when `labelsOnHover` is set so the
    // homepage scenes stay quiet until the user investigates.
    if (!props.labelsOnHover || hovered) {
      c!.font = `11px var(--vp-font-family-mono)`
      c!.textAlign = "center"
      c!.textBaseline = "top"
      c!.fillStyle = teal(
        dark,
        hovered ? 0.95 : dim ? 0.32 : 0.65,
      )
      c!.fillText(client.name, client.x, client.y + ringR + 6)
    }
    c!.restore()
  }

  function drawToken(t: Token, dark: boolean) {
    const x = t.fromX + (t.toX - t.fromX) * t.progress
    const y = t.fromY + (t.toY - t.fromY) * t.progress
    const fade = radialFade(x, y)
    const lifeAlpha =
      t.progress < 0.12
        ? t.progress / 0.12
        : t.progress > 0.88
          ? (1 - t.progress) / 0.12
          : 1
    const a = lifeAlpha * fade
    if (a < 0.04) return

    // Comet tail
    const tailLen = 22
    const dx = t.toX - t.fromX
    const dy = t.toY - t.fromY
    const len = Math.hypot(dx, dy) || 1
    const tx = x - (dx / len) * tailLen
    const ty = y - (dy / len) * tailLen
    const grad = c!.createLinearGradient(tx, ty, x, y)
    grad.addColorStop(0, teal(dark, 0))
    grad.addColorStop(1, teal(dark, 0.7 * a))
    c!.strokeStyle = grad
    c!.lineWidth = 1.6
    c!.lineCap = "round"
    c!.beginPath()
    c!.moveTo(tx, ty)
    c!.lineTo(x, y)
    c!.stroke()

    // Head with halo
    const r = 9
    const halo = c!.createRadialGradient(x, y, 0, x, y, r)
    halo.addColorStop(0, teal(dark, 0.55 * a))
    halo.addColorStop(1, teal(dark, 0))
    c!.fillStyle = halo
    c!.beginPath()
    c!.arc(x, y, r, 0, Math.PI * 2)
    c!.fill()

    c!.fillStyle = teal(dark, a)
    c!.beginPath()
    c!.arc(x, y, 2.8, 0, Math.PI * 2)
    c!.fill()
  }

  function drawStatic() {
    const dark = isDark()
    c!.clearRect(0, 0, w, h)
    for (let i = 0; i < rows.length; i++) drawRow(rows[i], dark, i)
    for (const s of shapes) drawShape(s, dark)
    for (const cl of clients) drawClient(cl, dark)
  }

  // ── Spawning ───────────────────────────────────────────────────
  function spawnRandomUpdate() {
    if (shapes.length === 0) return
    const shape = shapes[Math.floor(Math.random() * shapes.length)]
    if (shape.rowIndices.length === 0) return
    const rowIdx =
      shape.rowIndices[Math.floor(Math.random() * shape.rowIndices.length)]
    fireRow(rowIdx, shape.id)
  }

  function fireRow(rowIdx: number, shapeIdHint?: number) {
    const row = rows[rowIdx]
    if (!row) return
    row.flash = 1
    const shapeIds =
      shapeIdHint !== undefined
        ? [shapeIdHint]
        : row.shapeIds.length
          ? row.shapeIds
          : []
    for (const sid of shapeIds) {
      const shape = shapes[sid]
      if (!shape) continue
      for (const cid of shape.clientIds) {
        const client = clients[cid]
        if (!client) continue
        tokens.push({
          shapeId: sid,
          fromX: row.x,
          fromY: row.y,
          toX: client.x,
          toY: client.y,
          progress: 0,
          speed: 0.6 + Math.random() * 0.5,
        })
      }
    }
  }

  // ── Main tick ──────────────────────────────────────────────────
  function tick(now: number) {
    if (!running) return
    const dt = Math.min(now - last, 60)
    last = now
    const dark = isDark()

    c!.clearRect(0, 0, w, h)

    // Decay row flashes. When paused we hold the seeded flashes so
    // the source rows keep glowing alongside their frozen tokens.
    if (!props.paused) {
      for (const row of rows) {
        if (row.flash > 0) row.flash = Math.max(0, row.flash - dt / 700)
      }
      for (const cl of clients) {
        if (cl.pulse > 0) cl.pulse = Math.max(0, cl.pulse - dt / 700)
      }
    }

    // Draw rows first (background dots), then shapes, then tokens, then clients on top.
    for (let i = 0; i < rows.length; i++) drawRow(rows[i], dark, i)
    for (const s of shapes) drawShape(s, dark)

    // Advance + draw tokens. When paused, each token holds its
    // seeded progress so the fan-outs read as a frozen mid-flight
    // snapshot.
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i]
      if (!props.paused) {
        t.progress += t.speed * (dt / 1000)
      }
      if (!props.paused && t.progress >= 1) {
        // Arrived — pulse the client.
        const shape = shapes[t.shapeId]
        if (shape) {
          for (const cid of shape.clientIds) {
            const targetClient = clients[cid]
            if (
              targetClient &&
              targetClient.x === t.toX &&
              targetClient.y === t.toY
            ) {
              targetClient.pulse = 1
            }
          }
        }
        tokens.splice(i, 1)
        continue
      }
      drawToken(t, dark)
    }

    for (const cl of clients) drawClient(cl, dark)

    // Spawn cadence — tightened by ~40% from the original 700–2100ms
    // window so the extra shapes the scene now hosts get a steady
    // stream of in-flight tokens instead of feeling sparse.
    nextSpawn -= dt
    if (!props.paused && nextSpawn <= 0) {
      spawnRandomUpdate()
      nextSpawn = 420 + Math.random() * 850
    }

    raf = requestAnimationFrame(tick)
  }

  // ── Hover / click ──────────────────────────────────────────────
  function findRowAt(mx: number, my: number): number {
    let best = -1
    let bestD = 12
    for (let i = 0; i < rows.length; i++) {
      const d = Math.hypot(rows[i].x - mx, rows[i].y - my)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }

  function findClientAt(mx: number, my: number): number {
    for (let i = 0; i < clients.length; i++) {
      if (clients[i].shapeIds.length === 0) continue
      if (Math.hypot(clients[i].x - mx, clients[i].y - my) < 16) return i
    }
    return -1
  }

  function findShapeAt(mx: number, my: number): number {
    for (let i = 0; i < shapes.length; i++) {
      const b = shapes[i].bbox
      if (mx >= b.left && mx <= b.right && my >= b.top && my <= b.bottom) return i
    }
    return -1
  }

  function setTooltip(text: string, x: number, y: number) {
    tt!.textContent = text
    tt!.style.opacity = "1"
    tt!.style.left = `${x}px`
    tt!.style.top = `${y}px`
    el!.style.cursor = "pointer"
  }

  function clearTooltip() {
    hoveredRow = -1
    hoveredShape = -1
    hoveredClient = -1
    tt!.style.opacity = "0"
    el!.style.cursor = ""
  }

  function onMouseMove(e: MouseEvent) {
    const rect = el!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    if (hitsExclusion(mx, my, exclusions, 4)) {
      clearTooltip()
      return
    }

    // Priority: client > row > shape (clients are smallest hit targets)
    const cIdx = findClientAt(mx, my)
    if (cIdx >= 0) {
      const client = clients[cIdx]
      hoveredClient = cIdx
      hoveredRow = -1
      hoveredShape = -1
      const subs = client.shapeIds
        .map((sid) => `shape:${shapes[sid].name}`)
        .join(", ")
      setTooltip(
        `${client.name} · ${subs || "—"}`,
        client.x,
        client.y - 26,
      )
      return
    }

    const rIdx = findRowAt(mx, my)
    if (rIdx >= 0) {
      const row = rows[rIdx]
      hoveredRow = rIdx
      hoveredShape = -1
      hoveredClient = -1
      const inShapes = row.shapeIds
        .map((sid) => `shape:${shapes[sid].name}`)
        .join(", ")
      setTooltip(
        `row:${row.rowId}  ${inShapes ? "·  " + inShapes : "·  not in any shape"}`,
        row.x,
        row.y - 18,
      )
      return
    }

    const sIdx = findShapeAt(mx, my)
    if (sIdx >= 0) {
      const shape = shapes[sIdx]
      hoveredShape = sIdx
      hoveredRow = -1
      hoveredClient = -1
      const cx = (shape.bbox.left + shape.bbox.right) / 2
      setTooltip(
        `shape:${shape.name}  ${shape.clause}`,
        cx,
        shape.bbox.top - 8,
      )
      return
    }

    clearTooltip()
  }

  function onMouseLeave() {
    clearTooltip()
  }

  function onClick(e: MouseEvent) {
    const rect = el!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    const cIdx = findClientAt(mx, my)
    if (cIdx >= 0) {
      // Fire a row from each subscribed shape.
      for (const sid of clients[cIdx].shapeIds) {
        const shape = shapes[sid]
        if (!shape || shape.rowIndices.length === 0) continue
        const ri =
          shape.rowIndices[Math.floor(Math.random() * shape.rowIndices.length)]
        fireRow(ri, sid)
      }
      return
    }

    const rIdx = findRowAt(mx, my)
    if (rIdx >= 0) {
      fireRow(rIdx)
      return
    }

    const sIdx = findShapeAt(mx, my)
    if (sIdx >= 0) {
      const shape = shapes[sIdx]
      if (shape.rowIndices.length === 0) return
      const ri =
        shape.rowIndices[Math.floor(Math.random() * shape.rowIndices.length)]
      fireRow(ri, sIdx)
    }
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
  <div class="sync-shapes-bg">
    <canvas ref="canvas" class="bg-canvas" aria-hidden="true" />
    <div ref="tooltip" class="bg-tooltip" />
  </div>
</template>

<style scoped>
.sync-shapes-bg {
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
