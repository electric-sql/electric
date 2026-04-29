/**
 * Scene-graph types for the homepage isometric world.
 *
 * The scene is authored in a right-handed 3D space and projected to 2D
 * canvas via a fixed isometric matrix. See `projection.ts`.
 *
 * Conventions:
 *  - +x and +y are the two horizontal axes that lie on the iso plane.
 *    Visually, increasing x and y both move *down-right* and *down-left*
 *    on the canvas respectively. The far back corner of the scene is at
 *    (0,0,0) and the near front-right corner is at (+x, 0, 0).
 *  - +z is up.
 *  - One world unit ≈ one floor tile (~1m for sizing intuition).
 *
 * v2 additions: substrate classification (`sync`/`streams`/`agents`),
 * legend filter, dual ambient+focus scripts per crop, junction/riser
 * geometry, walk-path arcs.
 */

export type Vec3 = readonly [x: number, y: number, z: number]

export type SurfaceId = string
export type ChannelId = string
export type ThreadId = string
export type JunctionId = string
export type RiserId = string

// ── Substrate classification ─────────────────────────────────────────

/** Three-substrate colour key. v2 element-kind colour model. */
export type Substrate = `sync` | `streams` | `agents`

// ── Building structure ────────────────────────────────────────────────

export type Facing = 0 | 90 | 180 | 270

export type Furniture =
  | { kind: `desk`; id?: string; at: Vec3; facing: Facing }
  | { kind: `table`; id?: string; at: Vec3; size?: readonly [number, number] }
  | { kind: `chair`; id?: string; at: Vec3; facing: Facing }
  | { kind: `counter`; id?: string; at: Vec3; size?: readonly [number, number] }
  | {
      kind: `screen`
      id?: string
      at: Vec3
      facing: Facing
      surface: SurfaceId
      // Width and height of the screen in world units. Optional.
      w?: number
      h?: number
    }
  | {
      kind: `board`
      id?: string
      at: Vec3
      facing: Facing
      cards: { surface: SurfaceId; row: number; col?: number }[]
      // Optional column count (defaults to 1 for a single-column board).
      cols?: number
    }
  | {
      kind: `wall-grid`
      id?: string
      at: Vec3
      facing: Facing
      w: number
      h: number
      cols: number
      rows: number
      // Surface ids for cells that should be addressable. The remaining
      // cells render as visual noise that blip ambiently.
      addressable: { surface: SurfaceId; row: number; col: number }[]
    }
  | {
      kind: `person`
      id?: string
      at: Vec3
      facing: Facing
      pose: `sit` | `stand`
      busyWith?: ThreadId
    }
  | { kind: `lamp`; id?: string; at: Vec3 }
  | { kind: `plant`; id?: string; at: Vec3 }
  | { kind: `cooler`; id?: string; at: Vec3 }
  | { kind: `door-arc`; id?: string; at: Vec3; facing: Facing; radius?: number }

export interface Zone {
  id: string
  label: string // hover-only, never rendered
  origin: Vec3 // floor-local
  size: Vec3
  furniture: Furniture[]
}

export interface Floor {
  height: number // z extent, in world units
  zones: Zone[]
}

export interface Building {
  id?: string
  origin: Vec3
  size: Vec3
  floors: Floor[]
  /** When true, treat as roof / silhouette only (no floor rect). */
  roof?: boolean
}

/** Skybridge connecting two buildings at a given z. */
export interface Skybridge {
  id?: string
  // Two world-space endpoints; rendered as a thin floor + railings.
  from: Vec3
  to: Vec3
  width?: number
}

/** Outdoor sidewalk / strip in front of the buildings. */
export interface Sidewalk {
  origin: Vec3
  size: readonly [number, number]
}

/** Streetlight, bench, tree silhouette, etc. on the outdoor strip. */
export type OutdoorProp =
  | { kind: `streetlight`; at: Vec3 }
  | { kind: `tree`; at: Vec3 }
  | { kind: `bench`; at: Vec3; facing: Facing }

/** Pedestrian walking on the sidewalk on a slow loop. */
export interface Pedestrian {
  id: string
  // Polyline that the pedestrian loops along.
  loop: Vec3[]
  // Seconds for one full loop.
  loopMs: number
  // Phase offset (0..1) so multiple pedestrians don't sync up.
  phase: number
}

// ── Substrate ─────────────────────────────────────────────────────────

export interface Packet {
  threadId: ThreadId
  position: number // 0..1 along the channel path
}

export interface Channel {
  id: ChannelId
  /** Always 'streams' for now — kept for forward compatibility. */
  substrate?: Substrate
  // Polyline through world space at a single z under the floor.
  path: Vec3[]
  // Static "durable" packets that sit on the channel — i.e. queued work.
  durable: Packet[]
  /** Optional left/right portal flags — used to fade comets at world edges. */
  portalLeft?: boolean
  portalRight?: boolean
}

/** Junction box at a branch/cross point on the substrate. */
export interface Junction {
  id: JunctionId
  at: Vec3
  /** Channels that meet at this junction. */
  channels: ChannelId[]
}

/** Riser: a vertical violet line connecting a channel point up to a surface. */
export interface Riser {
  id: RiserId
  channelId: ChannelId
  /** 0..1 along the channel at which the riser exits the substrate. */
  channelT: number
  /** Surface it terminates on. */
  surface: SurfaceId
  /** Top z of the riser (defaults to surface furniture's z if known; here
   *  we keep it explicit so we don't need a back-reference at draw time). */
  topZ: number
}

/** Faint underground server-rack silhouettes. */
export interface UndergroundProp {
  at: Vec3
  size?: readonly [number, number, number]
}

export interface Substrate3D {
  channels: Channel[]
  junctions?: Junction[]
  risers?: Riser[]
  underground?: UndergroundProp[]
}

// ── Actors ────────────────────────────────────────────────────────────

export type ActorKind =
  | `human`
  | `courier`
  | `inspector`
  | `analyst`
  | `sweeper`

export interface ActorWalk {
  points: Vec3[]
  // 0..1 progress along the polyline, computed by total path length.
  t: number
  // World units per second.
  speed: number
  // Optional callback fired once when t crosses 1.
  onArrive?: string
}

export interface Actor {
  id: string
  kind: ActorKind
  /** Default 'agents' for non-human actors; humans get no substrate tag. */
  substrate?: Substrate
  position: Vec3
  walking?: ActorWalk
  /** Default loop the actor returns to when no script is commandeering it. */
  homeLoop?: Vec3[]
}

// ── Threads ───────────────────────────────────────────────────────────

export interface Thread {
  id: ThreadId
  manifestations: SurfaceId[]
  /** Hue offset within the brand palette so multiple concurrent threads
   *  stay distinguishable. v2 keeps this as a fallback for when
   *  `dominant` isn't set. */
  hue: number
  /** v2: which substrate this thread "belongs to" for legend / filter
   *  metadata purposes. Does *not* drive rendering colour — element kind
   *  drives that. */
  dominant?: Substrate
  /** Cadence in ms for the thread's ambient pulse (informational; the
   *  ambient script encodes the actual schedule). */
  cadenceMs?: number
}

// ── Scene root ────────────────────────────────────────────────────────

export interface Scene {
  buildings: Building[]
  skybridges?: Skybridge[]
  sidewalk?: Sidewalk
  outdoor?: OutdoorProp[]
  pedestrians?: Pedestrian[]
  substrate: Substrate3D
  actors: Actor[]
  threads: Thread[]
}

// ── Camera & scripts ──────────────────────────────────────────────────

export interface WorldBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
  minZ: number
  maxZ: number
}

export type CropName =
  | `world`
  | `coordination-floor`
  | `substrate-cutaway`
  | `mirrored-surfaces`

export type CropAspect = `desktop` | `mobile`

export interface CameraCrop {
  worldBounds: WorldBounds
  // Distance (in world units) from the bounds at which geometry fades to
  // zero alpha. Lets us soften the edges of the crop without a hard cutoff.
  fadeMargin: number
  // Threads to keep "live" in this crop (others go dim).
  highlightThreads: ThreadId[]
  // Aspect-ratio variant — desktop crops are wider; mobile crops zoom
  // tighter and may drop entire substructures.
  aspect: CropAspect
  /** v2: pre-applied legend filter (vignettes only). null on the hero. */
  filter?: Substrate | null
}

export type ScriptBeat =
  | { at: number; kind: `highlight`; surface: SurfaceId; durationMs: number }
  | { at: number; kind: `pulse-thread`; thread: ThreadId; durationMs: number }
  | { at: number; kind: `walk-actor`; actor: string; to: Vec3[]; speed: number }
  | { at: number; kind: `wake-actor`; actor: string }
  | {
      at: number
      kind: `spawn-comet`
      channel: ChannelId
      threadId: ThreadId
      speed?: number
    }
  | {
      at: number
      kind: `junction-pulse`
      junction: JunctionId
      durationMs?: number
    }
  | { at: number; kind: `handoff-burst`; at3: Vec3; durationMs?: number }
  | {
      at: number
      kind: `card-shuffle`
      board: string
      from: number
      to: number
    }
  | { at: number; kind: `screen-blip`; surface: SurfaceId }
  | { at: number; kind: `speaking-turn`; people: string[]; durationMs?: number }
  | {
      at: number
      kind: `pickup`
      actor: string
      from: SurfaceId
      thread: ThreadId
    }
  | {
      at: number
      kind: `drop`
      actor: string
      into: ChannelId | SurfaceId
    }

export interface CropScript {
  loopMs: number
  beats: ScriptBeat[]
}

/** Composition of the two scripts that play simultaneously per crop. */
export interface CropScripts {
  ambient: CropScript | null
  focus: CropScript | null
}

// ── Per-section animation tweaks ──────────────────────────────────────

export interface CropTweaks {
  // Multipliers applied to ambient animation channels for this crop.
  // 1 = normal, 0 = hidden, >1 = amplified.
  substrateFlow: number
  mirroredPulse: number
  courierWalk: number
  // Cadence override (ms) for the mirrored thread pulse. If undefined, use
  // the scene default.
  pulseCadenceMs?: number
}

// ── Active runtime state ──────────────────────────────────────────────

/** A comet token currently flowing along a channel. */
export interface ActiveComet {
  channelId: ChannelId
  threadId: ThreadId
  // 0..1 along the channel path.
  t: number
  speed: number
  // Birth time in ms (relative to runtime start) — used for fade-in/out.
  birthMs: number
  // Optional id for hit-testing / scripted reference.
  id?: string
}

/** A transient junction-box flash. */
export interface JunctionFlash {
  junctionId: JunctionId
  startMs: number
  durationMs: number
}

/** Coral particle burst from an agent handoff. */
export interface HandoffBurst {
  at: Vec3
  startMs: number
  durationMs: number
}

/** Connection arc drawn briefly on hover (sync arcs between mirrored
 *  surfaces, streams arcs from a channel to its risers, agents arcs
 *  along an actor's walk-path). */
export interface ConnectionArc {
  kind: Substrate
  // World-space points for the arc's polyline (3+ for a curved arc).
  points: Vec3[]
  startMs: number
  durationMs: number
}

export interface SceneState {
  scene: Scene
  // Dynamic moving comets on channels (in addition to `Channel.durable`).
  comets: ActiveComet[]
  // Per-surface highlight intensity (0..1), driven by hover, threads,
  // or scripts. Decays over time.
  highlights: Map<SurfaceId, number>
  // Per-thread pulse intensity (0..1), oscillates ambiently and is
  // amplified by scripts.
  threadPulses: Map<ThreadId, number>
  // Last time we triggered an ambient pulse for each thread.
  lastPulseMs: Map<ThreadId, number>
  // Per-script playback state — v2 supports two scripts running together.
  scripts: {
    ambient: { t: number; nextBeatIdx: number }
    focus: { t: number; nextBeatIdx: number }
  }
  // Total elapsed runtime in ms since SceneState was created.
  elapsedMs: number
  /** v2: active legend filter (or null). The render layer uses this to
   *  attenuate non-matching substrate-tagged elements. */
  filter: Substrate | null
  /** v2: eased per-substrate alpha multiplier (0..1.2). */
  filterAlpha: { sync: number; streams: number; agents: number }
  /** Live junction flashes. */
  junctionFlashes: JunctionFlash[]
  /** Live agent handoff bursts. */
  handoffBursts: HandoffBurst[]
  /** Live connection arcs (sync/streams/agents on hover). */
  connectionArcs: ConnectionArc[]
  /** Optional per-actor "carrying" thread for handoff visual flair. */
  carrying: Map<string, ThreadId>
}

// ── Projection types ──────────────────────────────────────────────────

/**
 * Result of projecting a 3D world point to canvas-space 2D, plus the
 * sortKey used for painter's-algorithm ordering.
 */
export interface Projected {
  sx: number
  sy: number
  // (x + y - z) — higher values are closer to the viewer, draw later.
  depth: number
  // 0..1 alpha contribution from the crop's fadeMargin (1 in centre, 0
  // at the very edge of the fade halo).
  fade: number
}

export interface ProjectorOpts {
  // Pixels-per-world-unit at default zoom.
  scale: number
  // Screen-space offset of the world origin in canvas units.
  offsetX: number
  offsetY: number
  // Crop bounds and fade margin (world units).
  bounds: WorldBounds
  fadeMargin: number
}

// ── Rendering options ─────────────────────────────────────────────────

export interface RenderOptions {
  ctx: CanvasRenderingContext2D
  // Canvas dimensions in css pixels (not device pixels).
  width: number
  height: number
  // True when the document has class "dark" — for theme-aware drawing.
  dark: boolean
  // Crop being rendered.
  crop: CameraCrop
  // Per-crop animation tweaks.
  tweaks: CropTweaks
  // Active scene state.
  state: SceneState
  // Optional text-exclusion zones (in canvas-space pixels). Geometry that
  // hits these gets dimmed so text stays legible.
  exclusions?: ExcludeRect[]
  // Hover state — index of hovered surface or actor for highlight.
  hoveredSurface?: SurfaceId | null
  hoveredActorId?: string | null
  // Reduced motion — when true, all motion freezes (everything renders
  // in its idle position).
  reducedMotion: boolean
  /** v2: high-contrast mode (prefers-contrast: more). */
  highContrast?: boolean
}

export interface ExcludeRect {
  left: number
  top: number
  right: number
  bottom: number
}
