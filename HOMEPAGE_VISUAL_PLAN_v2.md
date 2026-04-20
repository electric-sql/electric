# Homepage — landing page plan v2 (`/`)

> **Successor to** [`HOMEPAGE_VISUAL_PLAN.md`](./HOMEPAGE_VISUAL_PLAN.md).
> Same trunk (open-front isometric scene + three product sections that
> crop the same world), but **much denser**, **colour-coded per
> element kind**, with a **legend / filter mechanic** that doubles as
> the framing device for the per-product vignettes.
>
> v1 stays as the baseline reference for everything not restated here:
> page structure, section copy, reused blocks, technical recommendation
> (canvas 2D, no three.js), projection maths, scene-graph types,
> per-section animation tweaks, scroll behaviour, SSR strategy. **Read
> v1 first.** This document is additive.
>
> **The thesis:** the existing scene is too quiet to earn the "data
> platform for multi-agent business" tagline, and renders all three
> substrates in one brand teal so the eye can't tell them apart. v2
> fixes both with one move: **a colour-coded, much denser, "small
> operational block" scene**, paired with **a hover/tap legend that
> filters the scene to one substrate at a time**. The same legend
> mechanic _is_ the framing for each product vignette — a vignette is a
> tighter crop of the hero scene with the corresponding pill
> pre-applied.

---

## TL;DR — what changes from v1

- **Scene mass roughly 5× drawables, ~4× draw cost.** From one
  open-front building, two floors, two channels, two named actors →
  a small **operational block**: a 3-floor main building, a 2-floor
  side annex with a skybridge, a roof rack, a sidewalk strip, an
  underground server hint, **4 substrate channels with junctions and
  risers**, **8 named non-human actors + ~13 human silhouettes**,
  **~27 addressable surfaces (45 drawables incl. visual noise)**,
  **8 concurrent threads** running on coprime cadences.
- **Three accent colours**, one per element kind (sync = brand teal,
  streams = cool violet, agents = warm coral). The scene becomes
  legible as three intertwined systems. Colour is keyed to _what
  the element is_, not what thread it belongs to (see "Element-kind
  colour model" below).
- **A legend overlay** on the hero (and a locked badge on the
  vignettes) with three pills + a reset. **Hover** isolates one
  substrate. **Click** locks the filter. A small `→` icon on each
  pill scroll-jumps to the matching product section.
- **Vignettes inherit the filter.** The Agents section is the same
  scene cropped to the coordination floor with the _agents pill
  pre-applied_ — coral actors loud, cyan/violet dimmed. Same trick for
  Streams and Sync.
- **Density survives** because three orthogonal relief valves give
  the viewer somewhere to retreat: passive colour pre-filter, active
  legend hover-filter, and guided per-vignette filter.

## What this is _not_

Not a re-architecture, not a new renderer, not a new build pipeline,
not a brand redesign. The v1 scene-graph types stand; v2 extends
them. The painter's-algorithm renderer stands; v2 adds ~8 draw
helpers. The Vue SFC + SSR + `IntersectionObserver` lifecycle stand
unchanged. The accent colours apply only inside `<HomeIsoBg>`; the
rest of the website keeps the existing teal-on-navy palette.
Sections 5–12 of the homepage (lifted blocks) are unaffected.

---

## Colour palette — three accents, one family

| Substrate   | Accent (dark)        | Accent (light)       | Reads as                       |
| ----------- | -------------------- | -------------------- | ------------------------------ |
| **Sync**    | brand teal `#75fbfd` | brand teal `#0ea5b7` | shared / mirrored / live       |
| **Streams** | violet `#a78bfa`     | violet `#7c5cff`     | deep / persistent / underneath |
| **Agents**  | coral `#ff8a65`      | coral `#ea5a3c`      | warm / alive / characterful    |

Notes:

- The hex values above are the **target families, not final values**.
  Phase 4 must do a perceptual-luminance pass: in light mode in
  particular, the three currently land at very different L values
  (sync `#0ea5b7` ≈ L 60, violet `#7c5cff` ≈ L 65, coral `#ea5a3c` ≈
  L 60 but visually heavier). All three want to land within ±5 L
  of each other so the composition feels balanced. Tune per-mode.
- Coral is the more expressive choice — agents are deliberately the
  _warm_ element in a cool infrastructure. Fallback if coral fights
  the brand: amber `#fbbf24` (still warm, less saturated, safer).
- All accents resolved via CSS custom properties at draw time, same
  pattern as v1's `brand()` / `stroke()` helpers in `render.ts`.
  Theme switching just works.
- Neutral monochrome (white / black at low alpha) is the _background_
  state. Anything that's part of the building scaffold — shell,
  floor lines, plain desks, plain humans, lamps, plants, sidewalk —
  stays neutral regardless of substrate or filter. Accents are
  reserved for **substrate-tagged elements**.

### Brand association risk

The website currently uses brand teal as the _Electric_ colour. v2
repurposes it as the _Sync_ colour. A reader on the homepage may
subconsciously read "Electric ≡ Sync" — over-promoting one of three
products via colour. Mitigations to choose between in Phase 4:

1. **Accept it.** Sync is the foundation product; teal-as-sync isn't
   a bad outcome. Document the implied hierarchy.
2. **Use a slightly desaturated teal for Sync** in the scene only,
   reserving the brighter brand teal for the legend's "show all"
   reset state. Keeps "brand teal" as the umbrella.
3. **Drop teal for sync entirely** and pick a fourth accent (e.g.
   sea green). Most invasive, biggest brand discontinuity. Probably
   not.

---

## Element-kind colour model

> One-line rule: **colour is determined by what the element _is_, not
> what thread it belongs to.**

| Element kind                                           | Substrate tag  | Colour | Notes                                   |
| ------------------------------------------------------ | -------------- | ------ | --------------------------------------- |
| Channel rail                                           | `streams`      | violet | always                                  |
| Comet (in flight)                                      | `streams`      | violet | always                                  |
| Durable packet (parked on channel)                     | `streams`      | violet | always                                  |
| Junction box                                           | `streams`      | violet | always                                  |
| Riser (channel ↑ surface)                              | `streams`      | violet | always                                  |
| Off-canvas portal                                      | `streams`      | violet | entry/exit fade halo                    |
| Actor: courier / inspector / analyst / sweeper         | `agents`       | coral  | always                                  |
| Walk-path arc (hover/script)                           | `agents`       | coral  | always                                  |
| Handoff burst                                          | `agents`       | coral  | particle effect at pickup/drop          |
| Surface-with-thread-pulse                              | `sync`         | teal   | only when actively glowing for a thread |
| Mirror-connection arc (hover)                          | `sync`         | teal   | always                                  |
| Building shell, floor, walls                           | none (neutral) | mono   | scaffold                                |
| Plain desk, board (no glowing card), table, chair      | none (neutral) | mono   | scaffold                                |
| Human silhouette (sit / stand / pedestrian / customer) | none (neutral) | mono   | non-actor                               |
| Lamp pool, plant, streetlight, bench, sidewalk         | none (neutral) | mono   | flavour                                 |

**Why this model and not "thread-dominant colours":** a thread like
`fulfilment-9c2b` involves a comet (streams), a courier (agents),
_and_ a screen pulse (sync) inside a single loop. Colouring everything
in the thread by its `dominant` would mean the courier flashes violet
when carrying a streams-thread and coral when carrying an
agents-thread — chaotic and confusing. Colouring by element kind
keeps the visual taxonomy stable: violet things flow, coral things
walk, teal things mirror. Threads are _traceable across colours_ —
which is the whole point.

`Thread.dominant` (added in Phase 4) exists only as **legend / filter
metadata**: it determines which pill the thread "belongs to" for
filter-dimming purposes, and which ambient cadence the thread
inherits. It does not affect rendering colour.

---

## The scene — maximalist composition

> World cube: roughly **14 × 8 × 10.5** units (x × y × z), where
> z spans -3.5 (faint underground hint) → +7.0 (roof). Up from
> v1's 10 × 6 × 5. Hero crop fits this at the 5/12 + 7/12 grid;
> vignettes crop into sub-rectangles.

### Architectural mass

```
                              ┌──── roof: rack + antenna + dish ────┐
                              │     · maintenance figure (occ.) ·   │
   ┌──────── 2nd floor: planning / data wall ────────┐  │
   │ · 6×4 cell grid wall display · 2 analyst figures │  │
   │ · ambient blip on cells every ~4 s              │  │
   ├───── 1st floor: review + meeting room ──────────┤  │       ┌─────────┐
   │ · review desk + screen + 1 figure               │  │   ╔═══│ annex   │
   │ · meeting room: 4-chair table, 3 figures, occ.  │  │   ║   │ 1st fl. │
   │   "speaking" turn animation                     │  │═══╝   ├─────────┤
   ├──── ground floor: front + dispatch + ops ───────┤  │       │ annex:  │
   │ · 3 front desks (3 figures, 3 screens)          │  │       │ fulfil. │
   │ · dispatch counter (1 figure, 1 screen)         │  │       │ +2 scrn │
   │ · ops bullpen: 2 boards (8 + 5 cards), 2 figs.  │  │       │ +1 fig  │
   └─────────────────────────────────────────────────┘  ╚═══════╧═════════╝
                              │  outdoor sidewalk: 2-3 pedestrians,         │
                              │  1 customer at door, streetlight, plant     │
                              ▼
   ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ floor line ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
   substrate (z = -1.0 .. -2.5):
     ━━━ channel-a ━━━════════════════════════════════════━━━━━━►
                    │ junction-1
     ━━━ channel-b ━━━════╤═══════════╤═════════════════════════►
                          │ junction-2  channel-c (diagonal, to annex)
     ──── channel-d (feedback loop, exits left, re-enters right) ────
   risers (vertical violet lines): channel ↑ to specific surfaces
   underground hint: faint server-rack silhouettes at z = -3.0..-3.5
```

**Annex geometry note:** the annex is **2 floors** (z = 0..4.8), not

1. The skybridge attaches at z ≈ 2.8 (just above the annex's first
   floor and the main building's first floor) and runs roughly level.
   The annex's **ground floor** is the loading dock + comet entry/exit;
   the annex's **first floor** holds the fulfilment screens. v2's
   inventory below assumes this 2-floor annex.

### Detailed inventory

#### Main building

- **Ground floor** (z = 0..2.4) — 3 zones:
  - `front-of-house`: 3 desks in a row, 3 seated humans, 3 screens.
  - `dispatch`: 1 standing human, 1 desk, 1 screen, low counter.
  - `ops`: 2 ops boards (8 cards in 2×4, 5 cards), 2 desks, 2
    standing humans (one per board).
- **First floor** (z = 2.4..4.8) — 2 zones:
  - `review`: 1 desk + screen + 1 standing human.
  - `meeting`: 1 round table, 4 chairs (3 occupied), occasional
    "speaking turn" — one of 3 humans briefly faces another.
- **Second floor / mezzanine** (z = 4.8..6.4) — 1 zone:
  - `planning`: full-wall data screen rendered as a 6×4 cell grid
    (24 small rectangles; ~6 are addressable surfaces, ~18 are
    visual noise that blip individually). 2 analyst actors, one
    occasionally taps the wall.
- **Roof** (z = 6.4..7.0) — silhouette only:
  - 2 server-rack cabinets, 1 antenna, 1 dish. 1 maintenance actor
    appears on a 30 s loop, walks the perimeter, exits.

#### Side annex (right-hand, 2 floors, z = 0..4.8)

- **Ground floor:** loading dock door silhouette on the right side.
  **Comet entry/exit** via the right portal (see Substrate below).
  No furniture, just the dock.
- **First floor (`fulfilment`):** 1 standing human, 2 screens.
  Connected to main building's first floor by a short skybridge at
  z ≈ 2.8.

#### Outdoor strip (in front of buildings, on the floor plane)

- 1 sidewalk band ~1 unit wide running the full block width.
- 2–3 pedestrian humans drifting past on slow, independent loops.
- 1 customer human that approaches the front door, "enters" (fades
  through doorway), then re-spawns left after 20 s.
- 1 streetlight, 1 tree silhouette, 1 bench. Pure flavour.

#### Substrate (z = -1.0 .. -2.5)

- **4 channels:**
  - `channel-a`: main bus, full width, z = -1.5
  - `channel-b`: secondary, full width, z = -1.9 (offset so they
    cross visually from the iso angle)
  - `channel-c`: diagonal "express", connects ops zone down into
    substrate then up into the annex's fulfilment screen
  - `channel-d`: feedback loop — exits left edge at z = -2.3,
    "wraps around" off-canvas, re-enters right edge at z = -2.3
- **3–4 junction boxes** at branch points: small 0.3 × 0.3 × 0.2
  cubes that pulse softly (violet) when a comet passes.
- **6–8 risers**: thin vertical violet lines connecting a channel
  point up to a specific surface. e.g. channel-a at x=2 ↑ to
  front-of-house screen #2. When a thread fires, the riser briefly
  brightens. Makes "this packet _manifests_ on this screen" literal.
- **15–20 durable packets** pre-seeded across the 4 channels.
- **2 portals** at the world edges:
  - **left portal**: comet-spawn at x = -1.5, z = -1.5 — new
    customer messages arriving. Fade-in radius 0.6 units so the
    first-frame doesn't flash inside the crop's fade halo.
  - **right portal**: comet-exit at x = 14, z = -1.5 — completed
    responses leaving. Fade-out matched.

#### Underground hint (z = -3.0 .. -3.5)

A faint band of 4–5 server-rack silhouettes drawn at low alpha
(~0.08) in the dim "stroke" colour. No animation, no interactivity.
Drops to transparent at z = -3.5. Visible only as suggestion that
_the substrate sits on something_. Cut-candidate (see Performance
section).

#### Actors — 8 named non-human + ~13 humans

**Non-human actors** (substrate = `agents`, coral, ~8 total):

| ID              | Kind      | Home                      | Role in scripts                                 |
| --------------- | --------- | ------------------------- | ----------------------------------------------- |
| `courier-1`     | courier   | substrate near front      | `fulfilment-9c2b` packet pickup → desk → return |
| `courier-2`     | courier   | substrate near annex      | `dispatch-2c4` channel-c express runs           |
| `courier-3`     | courier   | substrate centre          | long cross-block route, ambient                 |
| `inspector-1`   | inspector | ops board #1              | tick / pause / tick (8 s)                       |
| `inspector-2`   | inspector | ops board #2              | tick / pause / tick (offset)                    |
| `analyst-1`     | analyst   | data wall                 | `enrich-ab3` — wall ↔ review desk              |
| `analyst-2`     | analyst   | meeting room ↔ data wall | ambient cross-floor walk                        |
| `sweeper-1`     | sweeper   | substrate area            | walks the substrate perimeter (30 s)            |
| `maintenance-1` | analyst   | roof                      | appears, walks, exits (30 s)                    |

(That's 9, not 8 — `maintenance-1` is technically the 9th. Kept
for narrative reasons; cut-candidate if budget tightens.)

**Humans** (no substrate tag, neutral grey, ~13 total):

| ID(s)             | Pose  | Location                                |
| ----------------- | ----- | --------------------------------------- |
| `human-fh-1..3`   | sit   | front-of-house desks                    |
| `human-disp-1`    | stand | dispatch counter                        |
| `human-meet-1..3` | sit   | meeting room (occasional speaking turn) |
| `human-rev-1`     | stand | review desk                             |
| `pedestrian-1..3` | walk  | sidewalk (drift loops)                  |
| `customer-1`      | walk  | sidewalk → front door (20 s loop)       |

**Sprite distinctions** (today's `render.ts` draws inspector and
analyst identically — Phase 5 fixes this):

- `human` — torso line + circle head, neutral grey
- `courier` — torso + small **square** head + parcel diamond, coral
- `inspector` — torso + small **hexagonal** head + clipboard line, coral
- `analyst` — torso + small **round** head + tiny laptop rectangle, coral
- `sweeper` — torso + small **diamond** head + tool line, coral (dimmer)

Shape distinguishes kind even before colour — important for
color-blind safety.

#### Threads — 8 concurrent, coprime cadences

| Thread            | Dominant | Cadence  | Story (one loop)                                                                                                                                  |
| ----------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `escalation-1f6a` | sync     | **5 s**  | Customer card pulses across FH-screen #1 → ops-board-1-card-0 → review screen, in unison with 200 ms cascade                                      |
| `fulfilment-9c2b` | streams  | **7 s**  | Comet enters channel-a from left portal, parks halfway, courier-1 picks it up, walks to fulfilment annex, screen lights, comet exits right portal |
| `enrich-ab3`      | agents   | **11 s** | Analyst-1 walks from data wall to review desk, taps screen, returns                                                                               |
| `notify-5d8`      | streams  | **3 s**  | Short ambient comet on channel-b, full length, exits — high-frequency notification noise                                                          |
| `audit-7e1`       | sync     | **13 s** | Three small mirror-pulses ripple across every screen on the upper floor in cascading sequence                                                     |
| `dispatch-2c4`    | agents   | **19 s** | Courier-2 picks up from dispatch counter, walks to fulfilment annex via channel-c                                                                 |
| `meeting-4f8`     | sync     | **17 s** | Three meeting-room figures briefly all light up (a "decision moment"); a single card on the planning wall pulses in response                      |
| `health-bg`       | streams  | **2 s**  | Continuous low-intensity ambient ping on every channel — establishes "the substrate is always alive" baseline                                     |

Cadences (2, 3, 5, 7, 11, 13, 17, 19) are pairwise coprime; LCM is
9,699,690 seconds (~112 days). The scene effectively never visually
repeats. At any second, **3–5 threads are mid-action**.

`dominant` here is **legend/filter metadata only** — see the
Element-kind colour model section. The packet that travels in
`fulfilment-9c2b` is still violet (it's a streams element); the
courier walking it is still coral (it's an agents element). The
thread's `dominant: streams` only means: hovering the Streams pill
in the legend keeps this thread's beats _running at full intensity_
while sync/agents-dominant threads are dimmed.

#### Surface count — single source of truth

- 3 front-of-house screens
- 1 dispatch screen
- 2 ops boards × cards: 8 + 5 = 13
- 1 review screen
- 1 planning data-wall (24 cells: ~6 addressable, ~18 visual noise)
- 1 meeting-room wall screen
- 2 fulfilment-annex screens

= **27 addressable surfaces** (of which ~12 actively manifest threads),
**+18 visual-noise cells** = **45 drawables** total. Use 27 / 45
consistently when discussing counts.

#### Environmental detail

- **Hanging desk lamps** — small downward-cast soft circles on each
  desk, drawn once as a shallow gradient.
- **Door arc** at the entrance — thin 90° arc swings every 12 s.
- **Plants / silhouettes** at zone corners — 5-line cluster.
- **Water cooler / coffee station** silhouette in dispatch.
- **Floor grid** — dotted iso tiles outside the building boundary,
  fading to transparent ~2 units out.
- **Time-of-day tint** — very slow background hue shift on a 90 s
  cycle. Almost subliminal.

### Connecting tissue

These animations turn "lots of moving things" into "a system you
can read":

- **Risers glow on thread fire.** When a thread pulses, every riser
  attached to one of its surfaces briefly brightens (violet). Makes
  "this packet → this screen" literal.
- **Connection arcs on hover.** Hovering a screen draws thin **teal**
  arcs to other manifestations of its thread (sync). Hovering a
  channel point draws **violet** arcs to attached risers (streams).
  Hovering an actor draws a dashed **coral** arc along its current
  walk-path (agents). Half-second draws, fade over a second.
- **Handoff bursts.** When a courier "picks up" or "drops off",
  small **coral** particle burst at the handoff point.
- **Junction pulses.** When a comet passes a junction box, the
  junction itself flashes briefly (violet).
- **Off-canvas spawn/exit.** Comets enter/exit the world boundary
  with a quick alpha fade in/out (radius 0.6 units, sized so the
  fade lands outside the crop's `fadeMargin` halo).
- **Card shuffle.** Every ~14 s, a card on one of the ops boards
  moves down a row (animated 600 ms slide), displacing the row
  below. Reads as "work being prioritised".
- **Tiny activity blips.** Every screen/cell flashes a 1–2px dot at
  random positions on a ~4 s individual cadence. Reads as "live
  data" without being intrusive.

---

## The legend / filter mechanic

The single most important UX addition in v2. It does triple duty:

1. **Teaches** the viewer the colour code without on-scene labels.
2. **Lets** the viewer isolate one substrate to study it in detail.
3. **Acts** as the framing device for product vignettes — each
   vignette is the same scene with the matching pill pre-applied.

### Component — `<HomeIsoLegend>`

A small overlay positioned over the scene (default: bottom-left).
Three pills + a clear-all reset.

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│               [ home iso scene ]                     │
│                                                      │
│   ┌───────────────────────────────────┐              │
│   │ ●━━ Sync   →    ●⇒⇒ Streams →     │              │
│   │   shared state    durable         │              │
│   │                                   │              │
│   │ ●▷▷ Agents →   [ × show all ]     │              │
│   │   non-human                       │              │
│   │   actors                          │              │
│   └───────────────────────────────────┘              │
└──────────────────────────────────────────────────────┘
```

Each pill:

- A coloured dot in its accent, with a tiny **shape-encoded**
  mini-icon: sync = pulsing **circle**, streams = drifting
  **chevron** (→), agents = walking-figure **glyph** (▷). Shape
  encoding makes pills distinguishable even if accent colour is
  indistinguishable (color-blind safety).
- A short label.
- A muted descriptor below.
- A small `→` icon **on the right edge** of the pill — distinct
  click target for the scroll-jump anchor.

### Pill click model — single primary target

The whole pill body toggles the filter. The `→` anchor is the
only path to scroll-jump. Rationale: dual click targets on the
same pill (label = scroll, body = filter) is a UX smell; one
unambiguous primary action wins.

- **Hover (desktop)**: filter applies live; release = filter clears.
- **Click pill body (any device)**: locks the filter. Click again
  to unlock. Active pill shows a small `×`.
- **Click `→` icon**: smooth-scroll to the matching product
  section. Filter state unchanged.
- **Click "× show all"**: clears any locked filter.
- **Mini-icon attention pulse** on first scroll-into-view: pills
  cascade-pulse 800 ms apart. Once only per session
  (sessionStorage flag).

### Filter rule — what dims, what doesn't

When `state.filter` is set:

- **Substrate-tagged elements** matching the filter: alpha × **1.2**
  (capped at 1.0), line weight tier ↑ (1 → 1.4 px).
- **Substrate-tagged elements** not matching the filter: alpha ×
  **0.15**.
- **Neutral elements** (building shell, floors, plain desks, plain
  humans, lamps, plants, sidewalk, walls, scaffolding): alpha
  unchanged. The scaffold stays at full strength regardless.

This is the rule. If hovering "Agents" left a coral scatter floating
in a near-blank canvas, it would be disorienting; keeping the
neutral scaffold visible anchors the eye.

Filter transitions are eased over 200 ms. Under `prefers-reduced-motion:
reduce`, transitions snap instantly (no easing).

### Mixed-thread surface edge case

A surface that's a manifestation of _multiple_ threads (e.g. a card
on multiple boards' radar): it pulses according to whichever thread
fired most recently, in **teal** (it's a sync element regardless of
which thread fires it). Filter behaviour: dims unless the active
filter is `sync`, OR any of its threads' `dominant` matches the
filter — i.e. surface-as-sync-element is preserved when a thread
that owns it is being highlighted, even if that thread is a
streams- or agents-dominant thread. Edge case worth documenting;
unlikely to come up in practice with 8 well-separated threads.

### Vignette = filter pre-applied

Each `<HomeIsoBg>` mount accepts an optional `filter` prop:

```vue
<HomeIsoBg crop="coordination-floor" filter="agents" />
<HomeIsoBg crop="substrate-cutaway" filter="streams" />
<HomeIsoBg crop="mirrored-surfaces" filter="sync" />
```

The legend on vignette mounts is **locked** — shown as a
read-only badge in the top-right ("Filter: Agents") with a colour
indicator and shape-encoded icon. Not interactive (no toggle, no
clear). The filter is part of the section's identity.

The legend on the **hero** is fully interactive. Same component,
`interactive` prop drives the difference.

### Mobile

- Legend pills become a horizontal scrolling tab strip **above**
  the scene (not overlay).
- Tap-to-toggle. Tapping the active pill clears.
- Mini-icons stay; labels truncate to single word ("Sync" /
  "Streams" / "Agents").
- Vignette badge in the top-right corner of the scene; not
  interactive.
- The `→` scroll-jump icon is omitted on mobile (the section is
  already directly below the hero scroll-wise; tap on a pill =
  filter only).

---

## Script composition — ambient + crop scripts

> v1 assumes **one script per crop**, with the hero having no
> script. v2 needs **8 ambient threads always running**, _plus_
> a tighter focused script for each vignette. We resolve this
> with a composition model.

### Two script slots per crop

```ts
interface CropConfig {
  name: CropName
  bounds: WorldBounds // (existing)
  fadeMargin: number // (existing)
  filter: Substrate | null // (new)
  scripts: {
    ambient: CropScript | null // 0..N ambient threads, looping forever
    focus: CropScript | null // tightly-timed sequence for this crop
  }
}
```

- Hero (`world`): `ambient = AMBIENT_SCRIPT` (all 8 threads),
  `focus = null`.
- Agents vignette (`coordination-floor`): `ambient = AMBIENT_SCRIPT`
  (still running, but heavily dimmed by the `filter='agents'`
  combined with the per-element alpha rule), `focus =
AGENTS_FOCUS_SCRIPT` (a 4-beat handoff that _amplifies_ the
  agent-class threads).
- Streams vignette: same pattern with `STREAMS_FOCUS_SCRIPT`.
- Sync vignette: same pattern with `SYNC_FOCUS_SCRIPT`.

### How they combine in the simulator

Both scripts tick simultaneously — each maintains its own cursor
(`scriptT`, `nextBeatIdx`). At loop boundary, each resets
independently. They share the `SceneState` and write to the same
`highlights`, `comets`, `threadPulses`, actor walks. There's no
priority resolution needed: focus scripts play _additive_ beats
that amplify what the ambient threads are already doing.

If a focus beat conflicts with an ambient beat (e.g. both want
courier-1 walking different paths), the focus beat wins —
focus scripts are explicitly authored to _commandeer_ relevant
actors during their loop window.

### Script restart on viewport entry — debounced

v1 says "scripts start fresh from beat 0 each time their section
enters the viewport". v2 adds the crop-zoom-in animation on the
same trigger. Combined naively, scrolling back-and-forth restarts
both repeatedly = janky.

**Debounce rule**: only restart (script + zoom) if the section was
out of viewport for **> 2 s** AND its `IntersectionObserver`
visibility ratio dropped below 0.05. Otherwise the script resumes
from current state and the zoom stays at its current bounds.
Implementation: a single `lastExitMs` timestamp per mount.

---

## Updated camera crops

The hero crop expands to fit the bigger scene. Vignette crops
adjust to focus on the relevant subset. All four still share the
same scene data; only `bounds`, `fadeMargin`, `filter`, and
`scripts` differ.

```
   crop                worldBounds (rough)            filter      ambient   focus
   ──────────────────────────────────────────────────────────────────────────────
   world (hero)        x[-2..14] y[-2..8] z[-3..7.5]  null        all 8     none
   coordination-floor  x[2..12]  y[-1..6] z[-0.5..5]  'agents'    all 8     4-beat handoff
   substrate-cutaway   x[-2..14] y[-1..7] z[-3..0.5]  'streams'   all 8     packet flow + pickup
   mirrored-surfaces   x[1..10]  y[1..5]  z[0..6.5]   'sync'      all 8     cross-floor pulse cascade
```

### Crop-zoom-in on viewport entry (debounced)

When a vignette section enters the viewport (and the debounce
window has elapsed), interpolate `bounds` from the hero's `world`
extent down to the vignette's tight extent over **600 ms**
(ease-in-out cubic). Visually says "we're zooming in on this part
of what you just saw". The projector recomputes per frame during
the transition — cheap (it's a single matrix update + per-vertex
projection).

Under `prefers-reduced-motion: reduce`, the zoom is skipped — the
vignette renders at its target bounds immediately.

---

## Density readability — the relief valves

Maximalism only works because three orthogonal mechanisms each
give the viewer somewhere to retreat:

1. **Colour pre-filter (passive).** Three accents, one per element
   kind. The eye groups by colour automatically. Even before
   conscious thought: "the cyan stuff is one thing, the violet
   stuff is another, the coral stuff is a third". Three is the
   reliable upper bound for this.
2. **Legend filter (active).** The scene that's "too busy" at full
   intensity drops to one substrate at amplified + everything else
   at 0.15 in one hover. Same content, perceptually three times
   quieter.
3. **Vignette pre-applied filter (guided).** Even a viewer who
   never touches the legend gets walked through: section 2 shows
   agents-only, section 3 shows streams-only, section 4 shows
   sync-only. By the time they've scrolled past, they've seen each
   substrate isolated. The hero retroactively makes sense.

**Maximalism is safe iff the filter is trivially accessible.**
Without the filter, drop the density. With it, push the density.

---

## Accessibility & color-blind safety

This is a real concern at v2 scale. The legend is a new
interactive overlay; the scene relies on colour to encode kind.

### Color-blind safety

- **Shape redundancy in the legend.** Pill mini-icons are
  shape-encoded (circle / chevron / walking-glyph) so pills are
  distinguishable without colour.
- **Shape redundancy in the scene.** Element kinds already differ
  in shape — channels are long polylines, comets are halos,
  surfaces are quads, actors are silhouette+head shapes. Colour
  reinforces shape; it isn't load-bearing alone.
- **Verification pass in Phase 4.** Run the Phase 4 recoloured
  scene through a deuteranopia / tritanopia / achromatopsia
  simulator. Worst case: agents (coral) and streams (violet) read
  too similar for deuteranopes — fallback is amber for agents.
- **`prefers-contrast: more`.** When the user requests high
  contrast, push all accent saturations / lightnesses to the
  outer boundaries of the palette and increase line weights by
  1 tier (1 → 1.4, 1.4 → 1.8).

### Keyboard & screen reader (legend)

- **Tab** focuses pills in order; `Tab` / `Shift+Tab` to navigate;
  `Enter` / `Space` to toggle filter; `Escape` to clear.
- The `→` scroll-jump icon is a separately-tabbable child link.
- Container: `role="group"`, `aria-label="Substrate filter"`.
- Each pill: `role="checkbox"` with `aria-checked` and an
  `aria-label` like "Filter to Sync — shared state".
- Filter state changes announce via a polite live region:
  _"Filter: Agents"_ / _"Filter cleared"_.
- Clear visible focus rings (`outline: 2px solid currentColor`,
  `outline-offset: 2px`).
- Skip the attention-pulse animation when
  `prefers-reduced-motion` is set.

### Scene canvas

- Canvas is decorative; mark the canvas element with
  `role="img"` and a brief `aria-label` summarising the scene
  (_"Animated diagram of a small business in operation, with
  three substrates: sync, streams, agents"_).
- Hover tooltips on packets / actors are nice-to-have for
  sighted users; not required to be screen-readable (the legend
  carries the information).
- All keyboard / screen-reader interaction routes through the
  legend; canvas hit-test interactions are pointer-only.

---

## Reduced motion (v2 specifics)

v1 freezes everything on `prefers-reduced-motion: reduce`. v2
extends:

- Legend filter still works (hover-isolate and click-lock).
  Filter alpha transition snaps instead of easing.
- Connection arcs and handoff bursts: still draw briefly on
  hover, but with no fade-in/out — instant on, instant off.
- Crop-zoom-in: skipped entirely; vignette renders at target
  bounds immediately.
- Card-shuffle, screen blips, comet flow, walks, time-of-day
  tint, mini-icon attention pulse: all frozen (matches v1).
- Threads: the _mirror pulse_ highlight effect itself is
  preserved (it's not motion, it's tonal change), but on a
  fixed 5 s cadence instead of cascading sync-thread-cycling.

---

## SSR snapshots

v1 specifies one static SVG per crop, used as SSR fallback +
reduced-motion render + social/blog cropping. v2 keeps the same
strategy, with one complication: the static state of an 8-thread
scene needs to look coherent in a single frozen frame.

- One snapshot per crop = **4 snapshots** (`world`,
  `coordination-floor`, `substrate-cutaway`, `mirrored-surfaces`).
- Snapshots are rendered from a deliberately-chosen "hero
  moment" of the scene state — picked manually during Phase 6 so
  that 2–3 threads are visibly mid-action and the composition
  reads well.
- Vignette snapshots have their `filter` pre-applied (so the
  static state already shows the dimmed-other-substrates
  treatment).
- Generation: a one-shot Node script `iso/snapshots/build.ts`
  that drives `drawScene` against a server-side canvas, freezes
  state at a chosen elapsedMs, and serialises to SVG.
- Commit the SVGs to `iso/snapshots/`. Regenerate after Phases
  5, 6, 8 (each changes the scene visually).

---

## Performance budget (delta from v1)

v1's budget: < 8 ms / frame on a 2019 MacBook Air, < 16 ms on a
mid-tier Android. v2 is ~5× the drawables and ~4× the draw cost.
Rough estimate: **6–10 ms** on a modern laptop, **14–18 ms** on
mid-tier Android — within v1's ceiling but tighter. **Verify with
real measurement in Phase 5** before locking in.

If we blow the budget, the cut order:

1. **Outdoor pedestrians + customer figure.** Pure flavour.
2. **Time-of-day tint.** Barely conscious.
3. **Server-rack basement.** Substrate channels carry the
   "underneath" idea on their own.
4. **Side annex + skybridge.** Move fulfilment back into the main
   building's ground floor.
5. **Planning wall / data grid.** Demote to a regular screen.
6. **Two of the eight threads.** Specifically the longest
   cadences (`audit-7e1`, `meeting-4f8`).
7. **Two of the four channels.** Keep `channel-a` + `channel-c`
   (main bus + diagonal feeder).
8. **Maintenance actor on roof.** Drops actor count to 8.

Each cut shaves ~10–20% of geometry. Plenty of dial-back range
without losing the shape.

---

## Implementation phases (v2 Phases 4–10)

**These phases supersede v1's Phases 4–6.** v1's Phases 1–3
(projection sandbox, type definition, animations) are reused
verbatim and remain the prerequisites. Numbering picks up at 4 to
keep continuity in the roadmap.

### Phase 4 — substrate classification + colour palette + a11y baseline

A small recoloured-but-otherwise-identical checkpoint. **Ships to
the live homepage if approved.**

- Add `Substrate = 'sync' | 'streams' | 'agents'` type. Add
  `dominant` to `Thread`. Add `substrate` to `Channel` (always
  `'streams'`) and `Actor` (always `'agents'`). Default-tag the
  existing scene constant.
- Add `iso/palette.ts` mapping substrate → CSS custom-prop name
  for light + dark modes.
- Add `accent(opts.dark, substrate, alpha)` helper to `render.ts`.
  Replace existing `brand()` calls. Tune the three accents'
  perceptual luminance (target ±5 L between them per mode).
- Run color-blind simulator; if coral fails, swap to amber.
- **Exit:** existing scene renders with three colours visible,
  identical density, no legend yet. Static screenshot is
  meaningfully more informative than today's monochrome.

> **Note:** Phase 4 default-tags the existing v1 scene. Phase 5
> rewrites that scene wholesale. So Phase 4's _scene-tagging
> work is checkpoint-only_ — its real value is the palette,
> renderer changes, and `palette.ts` infrastructure that Phase 5
> builds on.

### Phase 5 — denser scene constant + new draw helpers + sprite distinctions

- Author the maximalist `HOME_SCENE` per the inventory above.
  New zones, new furniture, new actors with unique sprites,
  new threads with `dominant` set.
- Update `drawActorSprite` to actually render `inspector` /
  `analyst` / `sweeper` distinctly (today they all render
  identically as the inspector hex-head silhouette).
- Add new draw helpers: junction box, riser, lamp pool,
  planning-wall grid, outdoor pedestrian, skybridge, customer
  door arc, underground server-rack silhouette band.
- **Measure frame budget** at this point (no scripts running yet
  — just static geometry + ambient comets). Confirm or trigger
  the cut order.
- **Exit:** the static render looks like a small operational
  block. Three colours visible. Not yet interactive.

### Phase 6 — multi-thread ambient + script composition + ambient enrichment

- Add the script composition model — `CropConfig.scripts.ambient`
  - `CropConfig.scripts.focus`. Update simulator to tick both.
- Author 8 thread scripts (the `AMBIENT_SCRIPT`) on coprime
  cadences. Add the `health-bg` continuous low-intensity ping.
- Add card-shuffle on ops boards, screen blips, occasional
  meeting-room speaking turn, off-canvas portal spawn/exit on
  channels with the 0.6-unit fade radius.
- **Exit:** at any second, 3–5 threads are mid-action; the scene
  reads as a continuously-running system, not a single loop.
  Generate the 4 SSR snapshots from this state.

### Phase 7 — legend + filter mechanic + walk-path arcs

- Add `state.filter: Substrate | null` to `SceneState`. Add eased
  per-substrate alpha multiplier (200 ms ease, snap under
  reduced-motion). Implement the filter rule from the spec
  (substrate-tagged elements only; neutral scaffold preserved).
- Build `HomeIsoLegend.vue`. Three pills with shape-encoded
  mini-icons, single-target click model, separate `→` scroll-jump
  anchor, attention-pulse on first scroll-in (sessionStorage-
  flagged), full keyboard + screen-reader support, debounce.
- Add **walk-path arcs** (dashed coral on actor-hover) — promoted
  here from Phase 9. The legend without arc-hover is missing the
  "agents" half of its show-don't-tell; bundle them.
- **Exit:** hovering a pill cleanly isolates one substrate;
  clicking locks; `→` scroll-jumps to the right product section;
  keyboard + screen-reader paths work end-to-end.

### Phase 8 — vignettes inherit filter + crop-zoom-in animation

- Add `filter` and `interactive` props to `<HomeIsoBg>`. Wire
  the three vignettes with the matching filter and
  `interactive={false}`. Show the locked-filter badge in
  top-right.
- Add the crop-zoom-in animation on viewport enter
  (interpolate `bounds` from `world` to vignette bounds over
  600 ms ease-in-out). Apply the debounce rule (script + zoom
  restart only after > 2 s out of viewport).
- Author the three focus scripts (`AGENTS_FOCUS_SCRIPT`,
  `STREAMS_FOCUS_SCRIPT`, `SYNC_FOCUS_SCRIPT`) for the new
  denser scene. Each commandeers the relevant actors during its
  loop.
- Regenerate the 4 SSR snapshots (vignettes now show their
  filter pre-applied).
- **Exit:** all four mounts behave correctly; vignettes read as
  guided readings of the hero, not separate scenes.

### Phase 9 — connection arcs + handoff bursts + junction pulses

- On surface-hover, draw thin teal connection arcs to other
  manifestations of the thread (sync show-don't-tell).
- On channel-point-hover, draw thin violet arcs to attached
  risers (streams show-don't-tell).
- On script `pickup` / `drop` beats, emit a small coral particle
  burst at the handoff point.
- On comet-passes-junction, flash the junction violet for 250 ms.
- Riser glow on thread fire (already covered in Connecting
  Tissue spec — implementation lands here).
- **Exit:** the scene gains "explanatory motion" — the user can
  see _why_ things are connected, not just see them moving.

### Phase 10 — copy pass, polish, brand check, final snapshots

- Lock copy for the new sections (largely unchanged from v1).
- Re-generate all 4 SSR snapshots. Verify no SSR layout shift
  on hydrate.
- Brand review: do the three accents survive in marketing
  screenshots? On socials? Against the rest of the website?
  Decide on the brand-association mitigation (option 1, 2, or 3
  from the Colour palette section).
- Verify reduced-motion render is coherent at all crops.
- Verify color-blind simulator render is coherent.
- Verify keyboard + screen-reader paths under VoiceOver / NVDA.
- **Exit:** review-ready.

### Component layout (delta from v1)

```
website/src/components/
├── home/
│   ├── HomeIsoBg.vue              [EDIT]   add `filter`, `interactive` props
│   ├── HomeIsoLegend.vue          [NEW]    legend component (Phase 7)
│   ├── HomeHero.vue               [EDIT]   mount the legend over the scene
│   ├── HomeProductSection.vue     [EDIT]   pass filter to HomeIsoBg
│   └── iso/
│       ├── scene.ts               [REWRITE Phase 5]   maximalist HOME_SCENE
│       ├── crops.ts               [EDIT]   updated bounds + scripts.{ambient,focus}
│       ├── palette.ts             [NEW Phase 4]       Substrate → CSS-var mapping
│       ├── scripts/
│       │   ├── ambient.ts         [NEW Phase 6]       8-thread ambient
│       │   ├── agents-focus.ts    [REWRITE Phase 8]   was agents.ts
│       │   ├── streams-focus.ts   [REWRITE Phase 8]   was streams.ts
│       │   └── sync-focus.ts      [REWRITE Phase 8]   was sync.ts
│       ├── snapshots/
│       │   ├── build.ts           [NEW Phase 6]       one-shot SVG generator
│       │   └── *.svg              [NEW Phases 6, 8, 10]
│       ├── projection.ts          [unchanged]
│       ├── render.ts              [EDIT]   accent(), filter alpha, new helpers
│       ├── simulate.ts            [EDIT]   filter state, dual scripts, debounce, zoom interp
│       └── types.ts               [EDIT]   Substrate, dominant, filter, CropConfig
```

---

## Open questions

1. **Brand mitigation choice.** Three options on the table for
   "brand teal ≡ Sync" risk (accept / desaturate / drop). Lock
   in Phase 4.
2. **Coral vs amber for agents.** Coral is more expressive,
   amber survives color-blind simulation more reliably.
   Prototype both during Phase 4, run sim, eyeball, choose.
3. **Legend placement: in-scene overlay vs above-scene strip?**
   Bottom-left overlay (default) preserves the scene's full
   vertical real-estate. Above-scene strip reads more
   navigational. Try both in Phase 7.
4. **Mobile vignette interactivity.** Currently locked-badge
   only. Worth allowing tap-to-temporarily-show-all on the
   badge? Probably no; defaults should win. Decide in Phase 8.
5. **Density A/B.** If we ship and analytics show people
   bouncing, the cut order is our pre-committed dial-back path.
   Worth instrumenting _time-on-hero_ + _legend interaction
   rate_ from day one. (Confirm site has analytics infra.)
6. **Crop-zoom-in animation: keep or cut?** Beautiful in theory;
   risk is "another animation that draws attention away from
   the prose". 600 ms one-shot debounced is probably fine, but
   re-evaluate against the live page in Phase 8.
7. **Naming.** Three substrates named **sync, streams, agents**
   in the legend pills, matching website nav. Lock before
   Phase 7 — once pills exist, renaming is expensive
   (alt-text, SEO, screenshots, social).
8. **Maintenance actor on the roof.** Cute but cuttable.
   Decide in Phase 5 measurement.

---

## Anti-goals (carried from v1, with v2 additions)

- No central hub, no big robot, no labelled product boxes.
- No comparison framing.
- No floating glowing app cubes.
- No on-scene labels for substrate elements (the **legend** is
  the only place text names them).
- No camera moves on the hero (the vignette crop-zoom-in is the
  only exception, and it's a brief debounced one-shot).
- No abstract sci-fi network art.
- **No more than three accent colours.** If a fourth concept
  needs a colour, fold it into one of the three.
- **No re-skinning of the lifted blocks (sections 5–12).** The
  three accents appear _only_ inside `<HomeIsoBg>`. The rest of
  the page stays in the existing teal-on-navy palette.
- **No thread-dominant colouring.** Element kind drives colour;
  threads are traceable across colours.
- **No sound, no music.**
