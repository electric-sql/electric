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
}

export type ToyGroup =
  | `hero`
  | `sync`
  | `agents`
  | `streams`
  | `cloud`
  | `home`
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
    controls: [
      PAUSED,
      {
        name: `labelsOnHover`,
        type: `boolean`,
        default: false,
        description: `Hide entity labels until hovered.`,
      },
      NO_EDGE_FADE,
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
    controls: [PAUSED, NO_EDGE_FADE],
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
    controls: [PAUSED, NO_EDGE_FADE],
    fullBleed: true,
    background: `dark`,
    defaultSize: { w: 1280, h: 720 },
    source: `src/components/streams-home/StreamFlowBg.vue`,
  },
  {
    id: `cloud-hex-bg`,
    label: `Cloud — hex viewer background`,
    group: `hero`,
    description: `Hex-viewer rendering of the Tanner quote — Cloud hero art.`,
    component: () =>
      import(`../cloud-home/CloudHexBg.vue`).then((m) => m.default),
    fullBleed: true,
    background: `dark`,
    defaultSize: { w: 1280, h: 720 },
    source: `src/components/cloud-home/CloudHexBg.vue`,
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
  {
    id: `cloud-strip`,
    label: `Sync — cloud strip`,
    group: `sync`,
    description: `Horizontal cloud-hosting logo strip.`,
    component: () =>
      import(`../sync-home/CloudStrip.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 200 },
    background: `dark`,
    source: `src/components/sync-home/CloudStrip.vue`,
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
    id: `cdn-fan-out`,
    label: `Streams — CDN fan-out`,
    group: `streams`,
    description: `One stream fans out across a CDN's edges.`,
    component: () =>
      import(`../streams-home/CdnFanOutDemo.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/streams-home/CdnFanOutDemo.vue`,
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
    id: `layer-dropdown`,
    label: `Streams — layer dropdown`,
    group: `streams`,
    description: `Four-layer protocol dropdown explainer.`,
    component: () =>
      import(`../streams-home/LayerDropdownDemo.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/streams-home/LayerDropdownDemo.vue`,
  },
  {
    id: `layered-stack`,
    label: `Streams — layered stack`,
    group: `streams`,
    description: `Layered-stack animation — bytes → JSON → events → DB.`,
    component: () =>
      import(`../streams-home/LayeredStackDemo.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/streams-home/LayeredStackDemo.vue`,
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
    id: `snapshot-sync-diagram`,
    label: `Misc — snapshot sync diagram`,
    group: `misc`,
    description: `Static snapshot-sync diagram.`,
    component: () =>
      import(`../SnapshotSyncDiagram.vue`).then((m) => m.default),
    defaultSize: { w: 1280, h: 720 },
    background: `dark`,
    source: `src/components/SnapshotSyncDiagram.vue`,
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
  `misc`,
]

export const GROUP_LABELS: Record<ToyGroup, string> = {
  hero: `Hero backgrounds`,
  sync: `Sync`,
  agents: `Agents`,
  streams: `Streams`,
  cloud: `Cloud`,
  home: `Homepage`,
  misc: `Misc`,
}
