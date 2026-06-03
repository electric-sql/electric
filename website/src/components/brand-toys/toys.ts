/* Brand Toys — registry of every showable component.
   ────────────────────────────────────────────────────
   Internal catalogue (no public nav entry) of the marketing-site
   animations and widgets. The Brand Toys page loads each one inside
   a resizable recording stage with a right-side controls drawer so
   we can capture clean screen recordings at known sizes.

   A "toy" is any visual component worth isolating for recording. The
   registry entry says how to load it, what controls it exposes, and
   how it should be framed. The controls schema is rendered generically
   by `ControlPanel.vue` — adding a new toy is (almost always) just a
   new entry here. */

export type ControlType =
  | `boolean`
  | `select`
  | `multiselect`
  | `number`
  | `string`

export interface ControlDef {
  /** Prop name on the target component. */
  name: string
  type: ControlType
  /** Default value. If omitted, the component's own default wins. */
  default?: unknown
  /** For select / multiselect. */
  options?: readonly string[]
  /** For number. */
  min?: number
  max?: number
  step?: number
  /** Display label (defaults to `name`). */
  label?: string
  /** Optional tooltip text. */
  description?: string
  /**
   * When true, changing this control's value triggers a debounced
   * remount of the toy. Use for "structural" props that the
   * underlying component only reads at mount / layout time (e.g.
   * grid cell density, node count caps), where a live re-render
   * would otherwise leave the canvas using the old value until the
   * user clicks "Remount" or resizes the stage.
   */
  remountOnChange?: boolean
}

export type ToyGroup =
  | `hero`
  | `sync`
  | `agents`
  | `streams`
  | `cloud`
  | `home`
  | `app`
  | `misc`

export interface ToyDef {
  /** URL slug — stable identifier used in the query string. */
  id: string
  /** Display name in the index and page header. */
  label: string
  /** Grouping chip in the index filter bar. */
  group: ToyGroup
  /** One-line description shown on the index card. */
  description?: string
  /** Dynamic import of the Vue component. */
  component: () => Promise<unknown>
  /** Schema describing props the panel should expose as controls. */
  controls?: readonly ControlDef[]
  /** Props that are always passed but not exposed in the UI. */
  staticProps?: Record<string, unknown>
  /** Initial stage dimensions (CSS px). Defaults to 1280×720. */
  defaultSize?: { w: number; h: number }
  /** When true, the toy fills the stage (100% w/h). Hero/background scenes. */
  fullBleed?: boolean
  /**
   * When true, wrap in `<ClientOnly>` — for components that touch
   * WASM or the DOM at script-setup time (e.g. PGlite REPL).
   */
  clientOnly?: boolean
  /** Suggested stage background for legibility. */
  background?:
    | `dark`
    | `surface`
    | `elv`
    | `light`
    | `transparent`
    | `black`
    | `white`
  /**
   * Source file path for the "view source" link on the index card.
   * Relative to repo root.
   */
  source: string
  /**
   * `true` if the toy moves on its own (canvas / RAF / interval / pulse).
   * `false` for static diagrams, grids, straps, and logo strips.
   * Defaults to `true` if omitted — most toys here animate.
   */
  animated?: boolean
}

/** True unless the toy explicitly opts out via `animated: false`. */
export function isAnimated(toy: ToyDef): boolean {
  return toy.animated !== false
}

// Short-hand for the common `paused: boolean` control that most demos
// in this repo accept to freeze their animation loop.
const PAUSED: ControlDef = {
  name: `paused`,
  type: `boolean`,
  default: false,
  description: `Freeze animation on a static snapshot.`,
}
const NO_EDGE_FADE: ControlDef = {
  name: `noEdgeFade`,
  type: `boolean`,
  default: false,
  description: `Disable the radial edge-fade so the canvas fills the whole frame.`,
}

export const TOYS: readonly ToyDef[] = [
  // ─────────────────────────── HERO BACKGROUNDS ───────────────────────────
  {
    id: `sync-fan-out-bg`,
    label: `Sync — fan-out background`,
    group: `hero`,
    description: `The composable sync-primitives hero canvas. Shapes fan out to clients.`,
    component: () =>
      import(`../sync-home/SyncFanOutBg.vue`).then((m) => m.default),
    // Defaults below mirror the live `/sync` landing-page hero
    // (`<SyncFanOutBg :labels-on-hover="true" />`). All density /
    // activity / speed / overlap dials default to 1 / 2, which is
    // exactly the behaviour shipped in the component when no
    // explicit prop is passed.
    controls: [
      PAUSED,
      {
        name: `labelsOnHover`,
        type: `boolean`,
        default: true,
        description: `Hide entity labels until hovered (matches live /sync hero).`,
      },
      NO_EDGE_FADE,
      {
        name: `density`,
        type: `number`,
        default: 1,
        min: 0.25,
        max: 6,
        step: 0.1,
        label: `Row density`,
        description: `Multiplier on table grid density. 1 = live hero (46×38 cell). Higher packs more rows in.`,
        remountOnChange: true,
      },
      {
        name: `activity`,
        type: `number`,
        default: 1,
        min: 0,
        max: 10,
        step: 0.1,
        label: `Activity`,
        description: `Multiplier on auto-spawn rate. 1 = live cadence; 0 freezes ambient spawns (in-flight tokens still arrive).`,
      },
      {
        name: `tokenSpeed`,
        type: `number`,
        default: 1,
        min: 0.1,
        max: 10,
        step: 0.1,
        label: `Token speed`,
        description: `Multiplier on per-token flight speed.`,
      },
      {
        name: `overlapShapes`,
        type: `number`,
        default: 2,
        min: 0,
        max: 12,
        step: 1,
        label: `Overlap shapes`,
        description: `Extra shapes added on top of the 1-per-quadrant base layer.`,
        remountOnChange: true,
      },
      {
        name: `spawnRate`,
        type: `number`,
        default: 0,
        min: 0,
        max: 2,
        step: 0.05,
        label: `Spawn rate (shapes/s)`,
        description: `Random ambient shape-spawn rate. 0 = off. Honours the in-component MAX_SHAPES (8) cap and quadrant placement rules. Live /sync hero ships at 0.15.`,
      },
      {
        name: `dieRate`,
        type: `number`,
        default: 0,
        min: 0,
        max: 2,
        step: 0.05,
        label: `Die rate (shapes/s)`,
        description: `Random ambient shape-die rate. 0 = off. Picks an alive shape and tweens it out before unbinding rows + client. MIN_LIVE_SHAPES (3) acts as a soft floor so the canvas never empties.`,
      },
    ],
    fullBleed: true,
    background: `dark`,
    defaultSize: { w: 1280, h: 720 },
    source: `src/components/sync-home/SyncFanOutBg.vue`,
  },
  {
    id: `agents-hero-network-bg`,
    label: `Agents — hero network background`,
    group: `hero`,
    description: `Wakeful agent-mesh hero canvas — nodes wake and cascade messages.`,
    component: () =>
      import(`../agents-home/HeroNetworkBg.vue`).then((m) => m.default),
    // Defaults below mirror the live `/agents` landing-page hero
    // (`<HeroNetworkBg />` — no explicit props). Density 1 / max 60
    // reproduces the `(w*h)/12000` clamped-25-60 formula; activity
    // 1 / cascadeChance 0.5 / tokenSpeed 1 are the in-component
    // constants that ship today.
    controls: [
      PAUSED,
      NO_EDGE_FADE,
      {
        name: `density`,
        type: `number`,
        default: 1,
        min: 0.1,
        max: 10,
        step: 0.1,
        label: `Node density`,
        description: `Multiplier on nodes-per-area. 1 = live hero ((w·h)/12000 clamped 25–60).`,
        remountOnChange: true,
      },
      {
        name: `maxNodes`,
        type: `number`,
        default: 60,
        min: 10,
        max: 500,
        step: 5,
        label: `Max nodes`,
        description: `Upper cap on node count. Live hero clamps at 60.`,
        remountOnChange: true,
      },
      {
        name: `activity`,
        type: `number`,
        default: 1,
        min: 0,
        max: 10,
        step: 0.1,
        label: `Activity`,
        description: `Multiplier on ambient wake rate. 1 = live cadence; 0 freezes spawns.`,
      },
      {
        name: `cascadeChance`,
        type: `number`,
        default: 0.5,
        min: 0,
        max: 1,
        step: 0.05,
        label: `Cascade chance`,
        description: `Probability a chained hop fires when a message arrives. 0.5 = live default. (Capped at 1 — it's a probability.)`,
      },
      {
        name: `tokenSpeed`,
        type: `number`,
        default: 1,
        min: 0.1,
        max: 10,
        step: 0.1,
        label: `Token speed`,
        description: `Multiplier on per-message flight speed.`,
      },
      {
        name: `spawnOnClick`,
        type: `boolean`,
        default: false,
        label: `Spawn on click`,
        description: `Click on empty canvas to add a new agent at that point (auto-connected to nearby nodes).`,
      },
      {
        name: `spawnRate`,
        type: `number`,
        default: 0,
        min: 0,
        max: 5,
        step: 0.1,
        label: `Spawn rate (n/s)`,
        description: `Random ambient node-spawn rate. 0 = off. Honours max nodes and spawn max dist.`,
      },
      {
        name: `dieRate`,
        type: `number`,
        default: 0,
        min: 0,
        max: 5,
        step: 0.1,
        label: `Die rate (n/s)`,
        description: `Random ambient node-die rate. 0 = off. Will reduce the mesh to zero if left running alone.`,
      },
      {
        name: `spawnMaxDist`,
        type: `number`,
        default: 0,
        min: 0,
        max: 800,
        step: 5,
        label: `Spawn max dist (px)`,
        description: `Max distance from any existing node where new spawns may land. 0 = anywhere; smaller values grow the mesh outward from a seed.`,
      },
      {
        name: `repositionOnSpawn`,
        type: `boolean`,
        default: false,
        label: `Reposition on spawn`,
        description: `Each new node gently nudges nearby existing nodes outward (animated) to balance the mesh.`,
      },
      {
        name: `labelsOnHover`,
        type: `boolean`,
        // Live homepage hero (`<HeroNetworkBg />`) ships without
        // any always-on labels — only the DOM tooltip on hover —
        // so default true to match.
        default: true,
        label: `Labels on hover only`,
        description: `When on, per-node /entity/id labels are hidden until hover. When off, every node renders its label permanently.`,
      },
      {
        name: `hideLabels`,
        type: `boolean`,
        default: false,
        label: `Hide all labels`,
        description: `Suppress every label — both the always-on canvas labels and the DOM hover tooltip. Use for clean recordings where the mesh should read as pure geometry. Overrides "Labels on hover only".`,
      },
      {
        name: `initialNodes`,
        type: `number`,
        // -1 = use the density formula (live hero behaviour). 0 =
        // start empty (combine with spawnOnClick / spawnRate to
        // grow from scratch). Positive = exact seed count.
        default: -1,
        min: -1,
        max: 500,
        step: 1,
        label: `Initial nodes`,
        description: `Override the starting node count. -1 = use density formula; 0 = start empty (then grow via spawn-on-click or spawn rate); >0 = exact seed count (capped at max nodes).`,
        remountOnChange: true,
      },
    ],
    fullBleed: true,
    background: `dark`,
    defaultSize: { w: 1280, h: 720 },
    source: `src/components/agents-home/HeroNetworkBg.vue`,
  },
  {
    id: `streams-flow-bg`,
    label: `Streams — flow background`,
    group: `hero`,
    description: `Durable-streams hero rails with comet tokens.`,
    component: () =>
      import(`../streams-home/StreamFlowBg.vue`).then((m) => m.default),
    // Defaults below mirror the live `/streams` landing-page hero
    // (`<StreamFlowBg />` — no explicit props). Density 1 / max 8
    // reproduces the `h/70` clamped-5-8 formula; activity / speed /
    // branchActivity 1 are the in-component constants.
    controls: [
      PAUSED,
      NO_EDGE_FADE,
      {
        name: `density`,
        type: `number`,
        default: 1,
        min: 0.1,
        max: 8,
        step: 0.1,
        label: `Rail density`,
        description: `Multiplier on rails-per-height. 1 = live hero (h/70 clamped 5–8).`,
        remountOnChange: true,
      },
      {
        name: `maxRails`,
        type: `number`,
        default: 8,
        min: 2,
        max: 60,
        step: 1,
        label: `Max rails`,
        description: `Upper cap on rail count. Live hero clamps at 8.`,
        remountOnChange: true,
      },
      {
        name: `activity`,
        type: `number`,
        default: 1,
        min: 0,
        max: 10,
        step: 0.1,
        label: `Activity`,
        description: `Multiplier on per-rail spawn rate. 1 = live cadence; 0 freezes ambient spawns.`,
      },
      {
        name: `tokenSpeed`,
        type: `number`,
        default: 1,
        min: 0.1,
        max: 10,
        step: 0.1,
        label: `Token speed`,
        description: `Multiplier on per-token rail speed.`,
      },
      {
        name: `branchActivity`,
        type: `number`,
        default: 1,
        min: 0,
        max: 10,
        step: 0.1,
        label: `Branch activity`,
        description: `Multiplier on consumer-branch spawn rate. 1 = live cadence.`,
      },
    ],
    fullBleed: true,
    background: `dark`,
    defaultSize: { w: 1280, h: 720 },
    source: `src/components/streams-home/StreamFlowBg.vue`,
  },
  {
    id: `home-iso-bg`,
    label: `Home — isometric stack background`,
    group: `hero`,
    description: `Iso 3D hero for the root homepage. Pick a crop to frame sync / streams / agents.`,
    component: () => import(`../home/HomeIsoBg.vue`).then((m) => m.default),
    controls: [
      {
        name: `crop`,
        type: `select`,
        default: `world`,
        options: [
          `world`,
          `coordination-floor`,
          `substrate-cutaway`,
          `mirrored-surfaces`,
        ],
      },
      {
        name: `interactive`,
        type: `boolean`,
        default: true,
      },
      {
        name: `autoStart`,
        type: `boolean`,
        default: true,
      },
      {
        name: `filter`,
        type: `select`,
        default: `none`,
        options: [`none`, `sync`, `streams`, `agents`],
        description: `Highlight a single substrate (or 'none' to show all).`,
      },
      {
        name: `zoom`,
        type: `number`,
        default: 1,
        min: 0.5,
        max: 3,
        step: 0.05,
      },
      {
        name: `feather`,
        type: `boolean`,
        default: false,
      },
    ],
    fullBleed: true,
    background: `dark`,
    defaultSize: { w: 1280, h: 720 },
    source: `src/components/home/HomeIsoBg.vue`,
  },
  {
    id: `home-composition-hero`,
    label: `Home — 3D composition hero`,
    group: `hero`,
    description: `Three iso-stacked planes: sync / streams / agents layered.`,
    component: () =>
      import(`../home/HomeCompositionHero.vue`).then((m) => m.default),
    controls: [
      {
        name: `labelOrientation`,
        type: `select`,
        default: `standing`,
        options: [`flat`, `standing`],
        description: `Lay the per-layer labels flat on each card, or stand them up perpendicular at the front edge.`,
      },
    ],
    fullBleed: true,
    background: `dark`,
    defaultSize: { w: 1600, h: 900 },
    source: `src/components/home/HomeCompositionHero.vue`,
  },
  {
    id: `home-hero`,
    label: `Home — full hero (text + scene)`,
    group: `hero`,
    description: `The root homepage hero block including heading and CTAs.`,
    component: () => import(`../home/HomeHero.vue`).then((m) => m.default),
    fullBleed: true,
    background: `dark`,
    defaultSize: { w: 1280, h: 720 },
    source: `src/components/home/HomeHero.vue`,
  },

  // ─────────────────────────── SYNC DEMOS ───────────────────────────
  {
    id: `multi-client-pulse`,
    label: `Sync — multi-client pulse`,
    group: `sync`,
    description: `One shape, three live readers. Pulses fan from Postgres into web / mobile / agent cards.`,
    component: () =>
      import(`../sync-home/MultiClientPulseDemo.vue`).then((m) => m.default),
    controls: [PAUSED],
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/sync-home/MultiClientPulseDemo.vue`,
  },
  {
    id: `pglite-repl`,
    label: `Sync — PGlite REPL`,
    group: `sync`,
    description: `Embedded PGlite Postgres running in the browser.`,
    component: () =>
      import(`../sync-home/PGliteReplDemo.vue`).then((m) => m.default),
    clientOnly: true,
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/sync-home/PGliteReplDemo.vue`,
  },
  {
    id: `query-lens`,
    label: `Sync — query lens`,
    group: `sync`,
    description: `Live-query lens visual — TanStack DB query over shapes.`,
    component: () =>
      import(`../sync-home/QueryLensDemo.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/sync-home/QueryLensDemo.vue`,
  },
  {
    id: `shape-carve`,
    label: `Sync — shape carve`,
    group: `sync`,
    description: `Carving a shape out of a Postgres table.`,
    component: () =>
      import(`../sync-home/ShapeCarveDemo.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/sync-home/ShapeCarveDemo.vue`,
  },
  {
    id: `writes-ladder`,
    label: `Sync — writes ladder`,
    group: `sync`,
    description: `Optimistic-write ladder: UI → API → Postgres → Electric.`,
    component: () =>
      import(`../sync-home/WritesLadder.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/sync-home/WritesLadder.vue`,
  },
  {
    id: `sync-stack-diagram`,
    label: `Sync — stack diagram`,
    group: `sync`,
    description: `Stacked-layer diagram of the sync stack.`,
    component: () =>
      import(`../sync-home/SyncStackDiagram.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/sync-home/SyncStackDiagram.vue`,
    animated: false,
  },
  {
    id: `compose-stack-grid`,
    label: `Sync — compose-stack grid`,
    group: `sync`,
    description: `Three-card grid introducing Postgres Sync / TanStack DB / PGlite.`,
    component: () =>
      import(`../sync-home/ComposeStackGrid.vue`).then((m) => m.default),
    controls: [
      {
        name: `order`,
        type: `multiselect`,
        default: [`postgres-sync`, `tanstack-db`, `pglite`],
        options: [`postgres-sync`, `tanstack-db`, `pglite`, `durable-streams`],
        description: `Slugs to render, in order.`,
      },
    ],
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/sync-home/ComposeStackGrid.vue`,
    animated: false,
  },
  // ─────────────────────────── AGENTS DEMOS ───────────────────────────
  {
    id: `agent-grid`,
    label: `Agents — grid`,
    group: `agents`,
    description: `Grid of agent entities pulsing with wake events.`,
    component: () =>
      import(`../agents-home/AgentGridDemo.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/agents-home/AgentGridDemo.vue`,
  },
  {
    id: `context-composition`,
    label: `Agents — context composition`,
    group: `agents`,
    description: `Context composition from tool outputs + state.`,
    component: () =>
      import(`../agents-home/ContextCompositionDemo.vue`).then(
        (m) => m.default
      ),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/agents-home/ContextCompositionDemo.vue`,
  },
  {
    id: `coordination`,
    label: `Agents — coordination`,
    group: `agents`,
    description: `Multi-entity coordination over a shared stream.`,
    component: () =>
      import(`../agents-home/CoordinationDemo.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/agents-home/CoordinationDemo.vue`,
  },
  {
    id: `crash-recovery`,
    label: `Agents — crash recovery`,
    group: `agents`,
    description: `Entity crashes, restarts, resumes from stream offset.`,
    component: () =>
      import(`../agents-home/CrashRecoveryDemo.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/agents-home/CrashRecoveryDemo.vue`,
  },
  {
    id: `entity-stream`,
    label: `Agents — entity stream`,
    group: `agents`,
    description: `Live entity stream viewer.`,
    component: () =>
      import(`../agents-home/EntityStreamDemo.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/agents-home/EntityStreamDemo.vue`,
  },
  {
    id: `system-monitor`,
    label: `Agents — system monitor`,
    group: `agents`,
    description: `Top-style live monitor of running sub-agents.`,
    component: () =>
      import(`../agents-home/SystemMonitorDemo.vue`).then((m) => m.default),
    controls: [PAUSED],
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/agents-home/SystemMonitorDemo.vue`,
  },
  {
    id: `entity-overview`,
    label: `Agents — entity overview diagram`,
    group: `agents`,
    description: `Static diagram — entity definition & runtime.`,
    component: () =>
      import(`../agents-home/EntityOverviewDiagram.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/agents-home/EntityOverviewDiagram.vue`,
    animated: false,
  },
  {
    id: `entity-node`,
    label: `Agents — entity node`,
    group: `agents`,
    description: `Single pillbox node — name + status indicator.`,
    component: () =>
      import(`../agents-home/EntityNode.vue`).then((m) => m.default),
    controls: [
      { name: `name`, type: `string`, default: `/assistant/r-1` },
      {
        name: `status`,
        type: `select`,
        default: `active`,
        options: [`active`, `sleeping`, `idle`, `crashed`, `busy`],
      },
      { name: `compact`, type: `boolean`, default: false },
    ],
    defaultSize: { w: 480, h: 200 },
    background: `dark`,
    source: `src/components/agents-home/EntityNode.vue`,
    animated: false,
  },
  {
    id: `message-line`,
    label: `Agents — message line`,
    group: `agents`,
    description: `Animated directional arrow with a travelling dot.`,
    component: () =>
      import(`../agents-home/MessageLine.vue`).then((m) => m.default),
    controls: [
      { name: `active`, type: `boolean`, default: true },
      {
        name: `direction`,
        type: `select`,
        default: `right`,
        options: [`down`, `up`, `right`, `left`],
      },
      { name: `dashed`, type: `boolean`, default: false },
      { name: `label`, type: `string`, default: `wake` },
    ],
    defaultSize: { w: 600, h: 200 },
    background: `dark`,
    source: `src/components/agents-home/MessageLine.vue`,
  },

  // ─────────────────────────── STREAMS DEMOS ───────────────────────────
  {
    id: `mesh-of-streams`,
    label: `Streams — mesh of streams`,
    group: `streams`,
    description: `Procedural wheel-and-track mesh with optional message flow and wheel motion.`,
    component: () => import(`./MeshOfStreams.vue`).then((m) => m.default),
    controls: [
      { name: `seed`, type: `string`, default: `mesh-of-streams` },
      {
        name: `layout`,
        type: `select`,
        default: `wide`,
        options: [`wide`, `square`, `dense`, `sparse`],
      },
      {
        name: `wheelCount`,
        type: `number`,
        default: 14,
        min: 4,
        max: 18,
        step: 1,
      },
      {
        name: `connectionDensity`,
        type: `number`,
        default: 0.78,
        min: 0,
        max: 1,
        step: 0.05,
        label: `Extra connections`,
      },
      {
        name: `gridSize`,
        type: `number`,
        default: 24,
        min: 18,
        max: 60,
        step: 1,
        label: `Route grid`,
      },
      {
        name: `routePadding`,
        type: `number`,
        default: 0,
        min: 0,
        max: 3,
        step: 1,
        label: `Track padding`,
      },
      {
        name: `edgeConnections`,
        type: `boolean`,
        default: false,
        label: `Off-canvas connections`,
      },
      {
        name: `trackWidth`,
        type: `number`,
        default: 1,
        min: 1,
        max: 4,
        step: 0.25,
      },
      {
        name: `cornerRadius`,
        type: `number`,
        default: 12,
        min: 0,
        max: 40,
        step: 1,
        label: `Corner radius`,
      },
      { name: `glow`, type: `boolean`, default: true },
      {
        name: `noEdgeFade`,
        type: `boolean`,
        default: false,
        label: `Disable edge fade`,
      },
      {
        name: `showMessages`,
        type: `boolean`,
        default: true,
        label: `Show messages`,
      },
      {
        name: `animateMessages`,
        type: `boolean`,
        default: true,
        label: `Animate messages`,
      },
      {
        name: `messageCount`,
        type: `number`,
        default: 38,
        min: 0,
        max: 96,
        step: 1,
      },
      {
        name: `messageSpeed`,
        type: `number`,
        default: 1,
        min: 0,
        max: 4,
        step: 0.1,
      },
      {
        name: `messageScale`,
        type: `number`,
        default: 1,
        min: 0.4,
        max: 2.5,
        step: 0.05,
      },
      {
        name: `rotateWheels`,
        type: `boolean`,
        default: true,
        label: `Rotate wheels`,
      },
      {
        name: `wheelRotationSpeed`,
        type: `number`,
        default: 1,
        min: 0,
        max: 4,
        step: 0.1,
        label: `Wheel speed`,
      },
      {
        name: `animateSegments`,
        type: `boolean`,
        default: true,
        label: `Animate segments`,
      },
      {
        name: `segmentPulse`,
        type: `number`,
        default: 1,
        min: 0,
        max: 4,
        step: 0.1,
        label: `Segment pulse`,
      },
      { name: `paused`, type: `boolean`, default: false },
      {
        name: `showDebug`,
        type: `boolean`,
        default: false,
        label: `Show debug grid`,
      },
    ],
    defaultSize: { w: 1600, h: 900 },
    background: `dark`,
    fullBleed: true,
    source: `src/components/brand-toys/MeshOfStreams.vue`,
  },
  {
    id: `agent-loop-fill`,
    label: `Streams — agent-loop fill`,
    group: `streams`,
    description: `Append-only log filling as the agent thinks. Replay-from-offset demo.`,
    component: () =>
      import(`../streams-home/AgentLoopFillDemo.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/streams-home/AgentLoopFillDemo.vue`,
  },
  {
    id: `collab-session`,
    label: `Streams — collab session`,
    group: `streams`,
    description: `Shared stream: Alice, Bob and an agent all see each other's events.`,
    component: () =>
      import(`../streams-home/CollabSessionDemo.vue`).then((m) => m.default),
    controls: [
      PAUSED,
      {
        name: `clients`,
        type: `multiselect`,
        default: [`Alice`, `agent`, `Bob`],
        options: [`Alice`, `agent`, `Bob`],
      },
    ],
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/streams-home/CollabSessionDemo.vue`,
  },
  {
    id: `connection-drop`,
    label: `Streams — connection drop`,
    group: `streams`,
    description: `SSE drops and resumes; durable stream survives the refresh.`,
    component: () =>
      import(`../streams-home/ConnectionDropDemo.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/streams-home/ConnectionDropDemo.vue`,
  },
  {
    id: `layers-grid`,
    label: `Streams — layers grid`,
    group: `streams`,
    description: `Static grid of the four protocol layers.`,
    component: () =>
      import(`../streams-home/LayersGrid.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/streams-home/LayersGrid.vue`,
    animated: false,
  },
  {
    id: `offset-replay`,
    label: `Streams — offset replay`,
    group: `streams`,
    description: `Replay from any offset, exactly once.`,
    component: () =>
      import(`../streams-home/OffsetReplayDemo.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/streams-home/OffsetReplayDemo.vue`,
  },
  {
    id: `polyglot-lineup`,
    label: `Streams — polyglot lineup`,
    group: `streams`,
    description: `Curl / Node / Python / Elixir / Go — it's just HTTP.`,
    component: () =>
      import(`../streams-home/PolyglotLineup.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/streams-home/PolyglotLineup.vue`,
    animated: false,
  },
  {
    id: `quickstart-playback`,
    label: `Streams — quickstart playback`,
    group: `streams`,
    description: `The 30-second tour: four curl commands playing back.`,
    component: () =>
      import(`../streams-home/QuickstartPlaybackDemo.vue`).then(
        (m) => m.default
      ),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/streams-home/QuickstartPlaybackDemo.vue`,
  },
  {
    id: `three-properties`,
    label: `Streams — three properties`,
    group: `streams`,
    description: `Durable / multiplayer / resumable — property grid.`,
    component: () =>
      import(`../streams-home/ThreePropertiesGrid.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/streams-home/ThreePropertiesGrid.vue`,
    animated: false,
  },
  {
    id: `integrations-grid`,
    label: `Streams — integrations grid`,
    group: `streams`,
    description: `Integrations tile grid (TanStack AI, Vercel AI SDK, Yjs…).`,
    component: () =>
      import(`../streams-home/IntegrationsGrid.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/streams-home/IntegrationsGrid.vue`,
    animated: false,
  },

  // ─────────────────────────── HOME WIDGETS ───────────────────────────
  {
    id: `partial-replication-diagramme`,
    label: `Home — partial-replication diagramme`,
    group: `home`,
    description: `Partial-replication shape carved out of the source DB.`,
    component: () =>
      import(`../home/PartialReplicationDiagramme.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/home/PartialReplicationDiagramme.vue`,
  },
  {
    id: `products-grid`,
    label: `Home — products grid`,
    group: `home`,
    description: `Three-up product grid (Sync / Streams / Agents).`,
    component: () => import(`../home/ProductsGrid.vue`).then((m) => m.default),
    controls: [
      { name: `productPage`, type: `boolean`, default: false },
      { name: `excludeSlug`, type: `string`, default: `` },
    ],
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/home/ProductsGrid.vue`,
    animated: false,
  },
  {
    id: `works-with-stack`,
    label: `Home — works-with stack`,
    group: `home`,
    description: `Logos strip: frameworks & platforms Electric pairs with.`,
    component: () =>
      import(`../home/WorksWithStack.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 320 },
    background: `dark`,
    source: `src/components/home/WorksWithStack.vue`,
    animated: false,
  },

  // ─────────────────────────── APP MOCKUP KIT ───────────────────────────
  // Primitives + scenes for the App-page mockup work
  // (see APP_DESKTOP_MOCKUP_PLAN.md). The "app" group covers
  // everything inside `website/src/components/brand-toys/app/` —
  // tokens probe, chrome primitives, sidebar / chat / state parts,
  // and the high-level scenes consumed by `AppDownloadPage.vue`.
  {
    id: `app-tokens-probe`,
    label: `App — tokens probe`,
    group: `app`,
    description: `Swatch grid of the --ds-* working palette. Phase 1 token-bridge sanity check.`,
    component: () => import(`./app/AppTokensProbe.vue`).then((m) => m.default),
    controls: [
      {
        name: `theme`,
        type: `select`,
        default: `dark`,
        options: [`light`, `dark`],
        description: `Toggle the .app-mockup-root data-theme attribute. Should switch independently of the brand-toys page's forced html.dark class.`,
      },
    ],
    defaultSize: { w: 1100, h: 720 },
    background: `dark`,
    source: `src/components/brand-toys/app/AppTokensProbe.vue`,
    animated: false,
  },
  {
    id: `app-traffic-lights`,
    label: `App — traffic lights`,
    group: `app`,
    description: `macOS close / minimize / maximize dots. Phase 2 chrome primitive.`,
    component: () =>
      import(`./app/toys/AppTrafficLightsToy.vue`).then((m) => m.default),
    controls: [
      {
        name: `state`,
        type: `select`,
        default: `normal`,
        options: [`normal`, `hover`, `active`],
        description: `Glyphs (× / − / +) appear in hover/active; default macOS look hides them.`,
      },
      {
        name: `theme`,
        type: `select`,
        default: `dark`,
        options: [`light`, `dark`],
      },
    ],
    defaultSize: { w: 360, h: 160 },
    background: `dark`,
    source: `src/components/brand-toys/app/primitives/chrome/AppTrafficLights.vue`,
    animated: false,
  },
  {
    id: `app-titlebar`,
    label: `App — titlebar`,
    group: `app`,
    description: `OS-aware titlebar primitive (macOS traffic lights · Windows/Linux menu strip + window controls). Phase 2 chrome primitive.`,
    component: () =>
      import(`./app/toys/AppTitlebarToy.vue`).then((m) => m.default),
    controls: [
      {
        name: `os`,
        type: `select`,
        default: `auto`,
        options: [`auto`, `macos`, `windows`, `linux`],
        description: `'auto' resolves via useDetectedOs() to the visitor's OS. Explicit values force a fixed variant.`,
      },
      {
        name: `mode`,
        type: `select`,
        default: `full`,
        options: [`full`, `compact`],
        description: `'compact' strips menu strip + window controls — the variant scenes flip to at narrow container widths.`,
      },
      {
        name: `theme`,
        type: `select`,
        default: `dark`,
        options: [`light`, `dark`],
      },
      { name: `title`, type: `string`, default: `` },
    ],
    defaultSize: { w: 1100, h: 240 },
    background: `dark`,
    source: `src/components/brand-toys/app/primitives/chrome/AppTitlebar.vue`,
    animated: false,
  },
  {
    id: `app-window-frame`,
    label: `App — window frame`,
    group: `app`,
    description: `Outer rounded shell + titlebar slot + empty workspace placeholder. Phase 2 chrome primitive.`,
    component: () =>
      import(`./app/toys/AppWindowFrameToy.vue`).then((m) => m.default),
    controls: [
      {
        name: `os`,
        type: `select`,
        default: `auto`,
        options: [`auto`, `macos`, `windows`, `linux`],
        description: `'auto' resolves via useDetectedOs(). Drives the outer border-radius (10px macOS / 8px Win / 6px Linux).`,
      },
      {
        name: `theme`,
        type: `select`,
        default: `dark`,
        options: [`light`, `dark`],
      },
    ],
    defaultSize: { w: 1280, h: 800 },
    background: `dark`,
    source: `src/components/brand-toys/app/primitives/chrome/AppWindowFrame.vue`,
    animated: false,
  },
  {
    id: `app-sidebar-row`,
    label: `App — sidebar row`,
    group: `app`,
    description: `Single sidebar entity row — status dot, title, type chip, depth, selected/expanded variants. Phase 3 sidebar primitive.`,
    component: () =>
      import(`./app/toys/AppSidebarRowToy.vue`).then((m) => m.default),
    controls: [
      { name: `title`, type: `string`, default: `/horton/code-refactor` },
      { name: `type`, type: `string`, default: `horton` },
      {
        name: `status`,
        type: `select`,
        default: `running`,
        options: [
          `idle`,
          `running`,
          `streaming`,
          `spawning`,
          `paused`,
          `stopped`,
        ],
      },
      {
        name: `depth`,
        type: `number`,
        min: 0,
        max: 4,
        step: 1,
        default: 0,
      },
      {
        name: `childCount`,
        type: `number`,
        min: 0,
        max: 12,
        step: 1,
        default: 0,
        label: `Child count`,
        description: `> 0 enables the +N badge (when collapsed) or chevron-down (when expanded).`,
      },
      { name: `expanded`, type: `boolean`, default: false },
      { name: `selected`, type: `boolean`, default: false },
      {
        name: `theme`,
        type: `select`,
        default: `dark`,
        options: [`light`, `dark`],
      },
    ],
    defaultSize: { w: 480, h: 240 },
    background: `dark`,
    source: `src/components/brand-toys/app/primitives/sidebar/AppSidebarRow.vue`,
    animated: false,
  },
  {
    id: `app-sidebar`,
    label: `App — sidebar`,
    group: `app`,
    description: `Full sidebar — new-session row, section header, fixture-driven entity tree with connector lines. Phase 3 sidebar primitive.`,
    component: () =>
      import(`./app/toys/AppSidebarToy.vue`).then((m) => m.default),
    controls: [
      {
        name: `width`,
        type: `number`,
        min: 200,
        max: 400,
        step: 10,
        default: 240,
        description: `Sidebar column width. 240 matches SIDEBAR_DEFAULT_WIDTH in agents-server-ui.`,
      },
      {
        name: `noHeader`,
        type: `boolean`,
        default: false,
        label: `No header spacer`,
        description: `Suppress the 44-px header band — set true when a scene mounts a titlebar above the sidebar.`,
      },
      { name: `sectionLabel`, type: `string`, default: `Today` },
      {
        name: `showFooter`,
        type: `boolean`,
        default: true,
        label: `Show footer`,
        description: `Server picker + filter / settings strip at the bottom.`,
      },
      { name: `serverUrl`, type: `string`, default: `localhost:4437` },
      {
        name: `theme`,
        type: `select`,
        default: `dark`,
        options: [`light`, `dark`],
      },
    ],
    defaultSize: { w: 320, h: 720 },
    background: `dark`,
    source: `src/components/brand-toys/app/primitives/sidebar/AppSidebar.vue`,
    animated: false,
  },
  {
    id: `app-message-bubble`,
    label: `App — message bubble`,
    group: `app`,
    description: `User-message bubble — input-bg fill, hairline border, soft shadow. Phase 4 chat primitive.`,
    component: () =>
      import(`./app/toys/AppMessageBubbleToy.vue`).then((m) => m.default),
    controls: [
      {
        name: `text`,
        type: `string`,
        default: `refactor packages/auth to use the new session helper, write a quick test`,
      },
      { name: `sender`, type: `string`, default: `sam` },
      { name: `timestamp`, type: `string`, default: `just now` },
      {
        name: `theme`,
        type: `select`,
        default: `dark`,
        options: [`light`, `dark`],
      },
    ],
    defaultSize: { w: 720, h: 280 },
    background: `dark`,
    source: `src/components/brand-toys/app/primitives/chat/AppMessageBubble.vue`,
    animated: false,
  },
  {
    id: `app-message-input`,
    label: `App — message input`,
    group: `app`,
    description: `Composer slab — raised surface, hairline border, send button. Single-row body matching MessageInput.tsx (no chip strip; that belongs to the spawn drawer). Phase 4 chat primitive.`,
    component: () =>
      import(`./app/toys/AppMessageInputToy.vue`).then((m) => m.default),
    controls: [
      {
        name: `placeholder`,
        type: `string`,
        default: `Send a message...`,
      },
      { name: `sendActive`, type: `boolean`, default: true },
      {
        name: `theme`,
        type: `select`,
        default: `dark`,
        options: [`light`, `dark`],
      },
    ],
    defaultSize: { w: 720, h: 240 },
    background: `dark`,
    source: `src/components/brand-toys/app/primitives/chat/AppMessageInput.vue`,
    animated: false,
  },
  {
    id: `app-agent-response`,
    label: `App — agent response`,
    group: `app`,
    description: `Streaming Horton response — paragraph + fenced code + tool-call pill. The animated centrepiece. Phase 4.`,
    component: () =>
      import(`./app/toys/AppAgentResponseToy.vue`).then((m) => m.default),
    controls: [
      {
        name: `state`,
        type: `select`,
        default: `streaming`,
        options: [`idle`, `thinking`, `streaming`, `completed`],
      },
      {
        name: `progress`,
        type: `number`,
        min: -1,
        max: 1,
        step: 0.01,
        default: -1,
        label: `Progress (-1 = auto)`,
        description: `Manual scrub. -1 lets the internal RAF driver loop.`,
      },
      { name: `paused`, type: `boolean`, default: false },
      {
        name: `cps`,
        type: `number`,
        min: 5,
        max: 200,
        step: 5,
        default: 60,
        label: `Chars per sec`,
      },
      { name: `hasCodeBlock`, type: `boolean`, default: true },
      { name: `hasToolCall`, type: `boolean`, default: true },
      {
        name: `theme`,
        type: `select`,
        default: `dark`,
        options: [`light`, `dark`],
      },
    ],
    defaultSize: { w: 760, h: 520 },
    background: `dark`,
    source: `src/components/brand-toys/app/primitives/chat/AppAgentResponse.vue`,
    animated: true,
  },
  {
    id: `app-state-inspector`,
    label: `App — state inspector`,
    group: `app`,
    description: `3-panel state explorer (StreamDB + Types + Records + Events) with deterministic pulse loop on the events list. Matches the desktop app's right-tile state inspector. Phase 5 state primitive.`,
    component: () =>
      import(`./app/toys/AppStateInspectorToy.vue`).then((m) => m.default),
    controls: [
      {
        name: `pulseRate`,
        type: `number`,
        min: 0,
        max: 5,
        step: 0.1,
        default: 0.8,
        label: `Pulses / sec`,
      },
      { name: `paused`, type: `boolean`, default: false },
      {
        name: `density`,
        type: `select`,
        default: `comfortable`,
        options: [`comfortable`, `compact`],
      },
      {
        name: `theme`,
        type: `select`,
        default: `dark`,
        options: [`light`, `dark`],
      },
    ],
    defaultSize: { w: 720, h: 600 },
    background: `dark`,
    source: `src/components/brand-toys/app/primitives/state/AppStateInspector.vue`,
    animated: true,
  },
  {
    id: `app-tile-shell`,
    label: `App — tile shell`,
    group: `app`,
    description: `Workspace tile chrome (header + body slot). Header demonstrates the full action cluster: status pill + runner badge + sandbox badge + view toggles + overflow menu. Phase 4 workspace primitive.`,
    component: () =>
      import(`./app/toys/AppTileShellToy.vue`).then((m) => m.default),
    controls: [
      {
        name: `title`,
        type: `string`,
        default: `Test Message Received`,
      },
      {
        name: `sessionId`,
        type: `string`,
        default: `horton/70cqMB5GnW`,
      },
      {
        name: `status`,
        type: `select`,
        default: `running`,
        options: [
          `idle`,
          `running`,
          `streaming`,
          `spawning`,
          `paused`,
          `stopped`,
        ],
      },
      { name: `chromeInsetTarget`, type: `boolean`, default: false },
      { name: `showClose`, type: `boolean`, default: false },
      {
        name: `theme`,
        type: `select`,
        default: `dark`,
        options: [`light`, `dark`],
      },
    ],
    defaultSize: { w: 760, h: 600 },
    background: `dark`,
    source: `src/components/brand-toys/app/primitives/workspace/AppTileShell.vue`,
    animated: false,
  },
  {
    id: `app-chat-tile-content`,
    label: `App — chat tile content`,
    group: `app`,
    description: `ChatTileContent — header + bubble + agent response + composer. Now passes session id + runner / sandbox badges through the header to match EntityHeader.tsx. Phase 4 composed primitive.`,
    component: () =>
      import(`./app/toys/ChatTileContentToy.vue`).then((m) => m.default),
    controls: [
      {
        name: `progress`,
        type: `number`,
        min: -1,
        max: 1,
        step: 0.01,
        default: -1,
        label: `Progress (-1 = auto)`,
      },
      { name: `paused`, type: `boolean`, default: false },
      {
        name: `cps`,
        type: `number`,
        min: 5,
        max: 200,
        step: 5,
        default: 60,
        label: `Chars per sec`,
      },
      {
        name: `density`,
        type: `select`,
        default: `comfortable`,
        options: [`comfortable`, `compact`],
      },
      { name: `chromeInsetTarget`, type: `boolean`, default: false },
      {
        name: `theme`,
        type: `select`,
        default: `dark`,
        options: [`light`, `dark`],
      },
    ],
    defaultSize: { w: 760, h: 800 },
    background: `dark`,
    source: `src/components/brand-toys/app/primitives/workspace/parts/ChatTileContent.vue`,
    animated: true,
  },
  {
    id: `app-state-tile-content`,
    label: `App — state tile content`,
    group: `app`,
    description: `StateTileContent — header + 3-panel state inspector with pulse loop on the events list. Phase 4 composed primitive (rebuilt in phase 5 to match the real desktop-app inspector).`,
    component: () =>
      import(`./app/toys/StateTileContentToy.vue`).then((m) => m.default),
    controls: [
      {
        name: `pulseRate`,
        type: `number`,
        min: 0,
        max: 5,
        step: 0.1,
        default: 0.8,
        label: `Pulses / sec`,
      },
      { name: `paused`, type: `boolean`, default: false },
      {
        name: `density`,
        type: `select`,
        default: `comfortable`,
        options: [`comfortable`, `compact`],
      },
      { name: `showClose`, type: `boolean`, default: true },
      {
        name: `theme`,
        type: `select`,
        default: `dark`,
        options: [`light`, `dark`],
      },
    ],
    defaultSize: { w: 720, h: 700 },
    background: `dark`,
    source: `src/components/brand-toys/app/primitives/workspace/parts/StateTileContent.vue`,
    animated: true,
  },
  {
    id: `scene-hero-chat-state`,
    label: `App — scene: hero (chat + state)`,
    group: `app`,
    description: `Desktop hero scene — full window: titlebar + sidebar + chat tile + state tile. § 2 desktop column. Phase 5 deliverable; drag the stage to walk the breakpoint cascade (sidebar hidden → state dropped → titlebar compact).`,
    component: () =>
      import(`./app/toys/HeroChatStateSceneToy.vue`).then((m) => m.default),
    controls: [
      {
        name: `os`,
        type: `select`,
        default: `auto`,
        options: [`auto`, `macos`, `windows`, `linux`],
      },
      {
        name: `theme`,
        type: `select`,
        default: `dark`,
        options: [`light`, `dark`],
      },
      {
        name: `progress`,
        type: `number`,
        min: -1,
        max: 1,
        step: 0.01,
        default: -1,
        label: `Progress (-1 = auto)`,
        description: `Manual scrub for the typewriter. -1 lets the internal RAF driver loop.`,
      },
      { name: `paused`, type: `boolean`, default: false },
      {
        name: `cps`,
        type: `number`,
        min: 5,
        max: 200,
        step: 5,
        default: 60,
        label: `Chars per sec`,
      },
      {
        name: `pulseRate`,
        type: `number`,
        min: 0,
        max: 5,
        step: 0.1,
        default: 0.8,
        label: `Pulses / sec`,
      },
      {
        name: `splitRatio`,
        type: `number`,
        min: 0.3,
        max: 0.85,
        step: 0.05,
        default: 0.6,
        label: `Chat tile share`,
        description: `Workspace split — chat tile's flex-grow share; state tile gets the rest.`,
      },
      { name: `title`, type: `string`, default: `Test Message Received` },
      { name: `sessionId`, type: `string`, default: `horton/70cqMB5GnW` },
    ],
    defaultSize: { w: 1280, h: 800 },
    background: `dark`,
    source: `src/components/brand-toys/app/scenes/desktop/HeroChatStateScene.vue`,
    animated: true,
  },

  // ─────────────────────────── MISC STANDALONE ───────────────────────────
  {
    id: `scalability-chart`,
    label: `Misc — scalability chart`,
    group: `misc`,
    description: `Throughput / latency scalability chart.`,
    component: () => import(`../ScalabilityChart.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/ScalabilityChart.vue`,
    animated: false,
  },
  {
    id: `install-pill`,
    label: `Misc — install pill`,
    group: `misc`,
    description: `Copy-on-click install command pill.`,
    component: () => import(`../InstallPill.vue`).then((m) => m.default),
    controls: [
      {
        name: `command`,
        type: `string`,
        default: `npx @electric-sql/start my-electric-app`,
      },
      {
        name: `tone`,
        type: `select`,
        default: `raised`,
        options: [`raised`, `flat`],
      },
    ],
    defaultSize: { w: 720, h: 240 },
    background: `dark`,
    source: `src/components/InstallPill.vue`,
    animated: false,
  },
  {
    id: `bottom-cta-strap`,
    label: `Misc — bottom CTA strap`,
    group: `misc`,
    description: `The shared bottom-of-page CTA strap.`,
    component: () => import(`../BottomCtaStrap.vue`).then((m) => m.default),
    defaultSize: { w: 1920, h: 400 },
    background: `dark`,
    source: `src/components/BottomCtaStrap.vue`,
    animated: false,
  },
]

export function findToy(id: string | null | undefined): ToyDef | undefined {
  if (!id) return undefined
  return TOYS.find((t) => t.id === id)
}

export const GROUP_ORDER: readonly ToyGroup[] = [
  `hero`,
  `sync`,
  `agents`,
  `streams`,
  `cloud`,
  `home`,
  `app`,
  `misc`,
]

export const GROUP_LABELS: Record<ToyGroup, string> = {
  hero: `Hero backgrounds`,
  sync: `Sync`,
  agents: `Agents`,
  streams: `Streams`,
  cloud: `Cloud`,
  home: `Homepage`,
  app: `App`,
  misc: `Misc`,
}
