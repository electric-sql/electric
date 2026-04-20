# Homepage — landing page plan (`/`)

> Working spec for the new Electric homepage. Sibling document to
> `STREAMS_LANDING_PAGE_PLAN.md`, `SYNC_LANDING_PAGE_PLAN.md` and the
> existing Agents page.
>
> **Approach:** overbuild now, edit down later. Mirrors the approach used
> on the three product landing page plans. Lift sections wholesale from
> the current homepage where they already work; build new sections only
> for the hero and the three product overviews.
>
> **Trunk:** an isometric "open-front building" hero that anchors the
> whole page, then three product sections that each crop the _same_
> isometric world from a different angle (agents → streams → sync), then
> the reused blocks (works-with / deployment / news / community / etc).
>
> **Inputs:** the long-form ChatGPT brief from the design conversation,
> plus an audit of the three existing hero backgrounds
> (`HeroNetworkBg`, `StreamFlowBg`, `SyncFanOutBg`), the existing
> homepage (`/index.md`), and the global `--ea-*` token palette.

---

## TL;DR

- **Hero:** a structured isometric scene — an "open-front building"
  showing a business in operation, with the substrate visible
  beneath the floor. Hairline canvas geometry, same teal/navy
  palette as the product pages. **Text sits to the side** of the
  scene (not centred over it) — the homepage has more to say than
  the product pages and the scene wants horizontal room.
- **Three product sections** follow the hero, in order:
  **Agents → Streams → Sync.** Each one is a _different crop of the
  same isometric world_, focused on one product's "what it solves",
  with prose alongside.
- **Existing homepage blocks** are lifted with light edits:
  works-with grid, deployment strip, scales-to chart, latest news,
  CTA straps, backed-by, open-source/community.
- The current `SolutionsSection` and `ProductsSection` blocks are
  **replaced** by the three new product sections — they're saying
  the same thing more abstractly.
- **Build it as a structured 3D scene-graph in TypeScript, projected
  to Canvas 2D with a hand-rolled isometric projection.** No three.js.
- Reuse the _exact_ particle/edge/tooltip vocabulary of the three
  sibling hero backgrounds — comet tokens, glow halos, dotted rails,
  hover tooltips, click-to-fire — but lift them into 3D space. The
  homepage becomes the _world_ the other pages each show one slice of.
- **Cropping the same scene** for each product section is the single
  highest-leverage idea in this plan. It's pure show-don't-tell at
  page scale: the products visually _are_ facets of one underlying
  system. No labels required.

---

## Page structure

```
Section                            Mode     Pattern                           Source
──────────────────────────────────────────────────────────────────────────────────
1   Hero                           light    iso scene right + text left        [NEW]
2   Agents — multi-agent           dark     iso vignette left + prose right    [NEW]
    coordination
3   Streams — durable substrate    light    prose left + iso vignette right    [NEW]
4   Sync — shared state            dark     iso vignette left + prose right    [NEW]
    everywhere
5   No siloes strap                ?light   CTA strap                          [LIFT]
6   Works with your stack          ?light   integrations grid                  [LIFT]
7   Managed cloud, open source     ?dark    deployment strip                   [LIFT]
8   Scales like the web            ?light   scales-to chart                    [LIFT]   ★
9   Latest news                    ?light   news + bluesky                     [LIFT]
10  Get started strap              ?dark    CTA strap                          [LIFT]
11  Backed by                      ?light   investors grid                     [LIFT]
12  Open source community          ?light   repos + discord                    [LIFT]
```

(★ = cut-candidate during the editing pass. `?` = mode inferred from
component name only — verify against the rendered component during the
build pass and re-balance if wrong.)

**Rhythm:** sections 1–4 alternate cleanly (light → dark → light → dark).
Sections 5–12 are inferred from component names; **two pairs need
attention during build**:

- **§5 + §6** are both currently inferred light. If verified, give one
  of them a dark band (probably §6 `WorksWithSection`) so the trilogy
  → reused-blocks transition has a clear edge.
- **§11 + §12** are both currently inferred light. Probably acceptable
  since they share a "community / credibility" theme, but a thin
  divider rule between them would help.

Section 5 (`NoSilosStrap`) is positioned as a tight closer to the
product trilogy and a soft handoff into the reused blocks — moved up
from its current place after `LatestNewsSection` on the live homepage.

**Headline copy:** kept understated. The visual is the unique element
of the homepage; the copy doesn't need to do triple-duty. Likely
something close to the existing _"The data platform for multi-agent"_
holds — see [Section 1](#section-1--hero) for options.

**Reuse policy** (mirrors sibling plans):

- **[NEW]** = built from scratch for this page.
- **[LIFT]** = use the existing component as-is, possibly with copy
  tweaks.
- **[RESKIN]** = use the existing component but restyle to match the
  new hero aesthetic.
- **[CUT]** = drop from the page entirely.

| Existing block      | Decision   | Notes                                                                             |
| ------------------- | ---------- | --------------------------------------------------------------------------------- |
| `SolutionsSection`  | **CUT**    | Replaced by the three product sections, which say the same thing more concretely. |
| `ProductsSection`   | **CUT**    | Same — replaced by the trilogy.                                                   |
| `WorksWithSection`  | **LIFT**   | Keep as-is.                                                                       |
| `DeploymentSection` | **LIFT**   | Keep as-is.                                                                       |
| `ScalesToSection`   | **LIFT** ★ | Cut-candidate: the trilogy already implies scale.                                 |
| `NoSilosStrap`      | **LIFT**   | Reposition to close out the trilogy.                                              |
| `LatestNewsSection` | **LIFT**   | Keep as-is.                                                                       |
| `GetStartedStrap`   | **LIFT**   | Keep as-is.                                                                       |
| `BackedBySection`   | **LIFT**   | Keep as-is.                                                                       |
| `OpenSourceSection` | **LIFT**   | Keep as-is.                                                                       |

---

## Section 1 — Hero

**Layout:** **two-column**, scene right / text left, deliberately
_different_ from the centered hero used on `/agents`, `/sync` and
`/streams`. The scene needs horizontal room; the page has three
products to introduce instead of one.

```
┌───────────────────────────────────────────────────────────────────────┐
│                                                                       │
│   The data platform                  ┌─────────────────────────────┐  │
│   for multi-agent                    │                             │  │
│                                      │     ▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱      │  │
│   Build collaborative,               │    ╱  upper floor           │  │
│   multi-agent business systems       │   ▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱      │  │
│   on a shared live substrate.        │  ╱  ground floor            │  │
│                                      │ ▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱▱       │  │
│   ┌─────────────────────┐            │   ░░░ substrate ░░░         │  │
│   │ $ npx @electric-sql │            │   • • → → • • → → •         │  │
│   └─────────────────────┘            │                             │  │
│                                      └─────────────────────────────┘  │
│   [Start building »]  [GitHub]                                        │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### Copy

- **Eyebrow** _(optional)_: `"Open source · Apache 2.0"` —
  small, muted, all-caps. Mirrors the eyebrow on the agents CTA.
- **Headline:** _"The data platform for multi-agent"_ — keep the
  current line. It's earned by the visual.
- **Sub-headline:** _"Build collaborative, multi-agent business
  systems on a shared live substrate."_
- **Tagline:** _"Postgres sync, durable streams and an agent
  framework. The composable primitives underneath the
  next generation of business software."_
- **Install prompt** _(same chrome as `.ea-hero-install`)_:
  `npx @electric-sql/start my-app`
- **CTA buttons:** primary `Start building »` →
  `https://dashboard.electric-sql.cloud/`, secondary `GitHub` →
  repo. **Two CTAs only** (install prompt counts as one CTA in the
  visual hierarchy; three buttons + an install prompt is too busy
  for a hero with this much going on visually). If the install
  prompt is the primary action, drop `Start building »` and
  promote `GitHub` to secondary.

### Scene

Full **isometric "open-front building"** as specced in the
[concept directions](#three-concept-directions) and the
[MVP prototype spec](#mvp-prototype-spec) below. This is the _full_
scene — both floors, both channels, the courier loop, the inspector,
and the named thread (`escalation-1f6a`) with all four
manifestations live.

The product sections (2–4) crop into this same scene at three
different angles. The hero is the only place the whole world is
visible at once.

### Layout details

- **Desktop (≥ 1100 px):** 5/12 text + 7/12 scene, with the scene
  given the larger column to breathe.
- **Tablet (768–1099 px):** stack vertically — scene first, text
  below. The scene is the unique element; show it before the prose.
- **Mobile (≤ 767 px):** stack vertically — scene first, then text.
  Scene crops to ~16:9 ratio; the upper floor is dropped if it
  causes the scene to feel cramped (see Mobile in [Open
  questions](#open-questions)).
- **Padding:** ~80 px top / 60 px bottom on desktop. Slightly
  tighter than the centered product heroes since the headline copy
  isn't carrying the full visual weight.

---

## Section 2 — Agents (multi-agent coordination)

**Mode:** dark band (matches the existing `/agents` first dark band).
**Layout:** iso vignette left + prose right.

### Copy

- **Section title:** _"Agents that participate, not just respond."_
- **Sub-title:** _"Stop building isolated chatbots. Run agents as
  first-class participants in your business systems — alongside
  humans, plugged into the same shared state."_
- **Body** _(2–3 short paragraphs)_:
  - Today's agents live in chat windows or behind a single user. Real
    work happens inside business systems where many people, many
    surfaces and many software services already collaborate.
  - Electric Agents brings the agent loop online. Spawn durable,
    serverless agents that wake on demand, share context, hand work
    off to humans, and never lose a thread.
  - Built on Durable Streams, deployed on your existing stack.
- **CTA:** `Explore Agents »` → `/agents`.
  Secondary: `Quickstart` → `/docs/agents/quickstart`.

### Vignette — _Multi-actor coordination_

A **cropped, zoomed view** of the hero scene, framed on a single
floor with multiple actors active at once:

- One human silhouette at a desk.
- Two non-human actors (a courier and an inspector) visible at
  different points on the floor.
- A **second human** on the upper level visible in shallow depth-of-
  field — implies the wider scene without showing it.
- **Scripted sequence** _(scoped to this vignette — see
  [CropScript](#camera-crops--per-vignette-scripts))_:
  a thread is passed between three actors on a ~12 s loop:
  - Inspector pauses next to a card on the ops board → card
    highlights.
  - Courier picks the card up → walks it across the floor to a
    desk.
  - Human at the desk takes the card → screen lights up.
  - Card travels back into the substrate as a comet → loop.
- **Mobile fallback** _(< 768 px width)_: drop to the simpler
  _single-handoff_ version — one human + one courier passing one
  card. The four-beat sequence loses its meaning when squeezed
  into a 16:9 strip.

**What's implied (no labels):**

- Agents are participants in the same fabric, not a separate
  layer.
- Work moves between humans and non-humans without breaking.
- The substrate carries context between actors.

### Lift / build

- The vignette is **the same `<HomeIsoBg>` component** with a
  different `CameraCrop` and a different `CropScript`. The crop
  is data; the script is a small per-vignette state machine
  attached to it — see [Camera crops & per-vignette
  scripts](#camera-crops--per-vignette-scripts).

---

## Section 3 — Streams (durable substrate)

**Mode:** light band.
**Layout:** prose left + iso vignette right.

### Copy

- **Section title:** _"A durable substrate for live work."_
- **Sub-title:** _"Persistent, addressable, real-time streams over
  plain HTTP. Built for AI sessions, multi-user collaboration and
  the substrate underneath Electric Agents."_
- **Body** _(2–3 short paragraphs)_:
  - Multi-actor systems need a place where in-flight work _lives_
    between actions. Not a queue, not a database — a durable
    timeline that anyone can join, branch from, or replay.
  - Durable Streams gives you that primitive: append-only logs
    with offsets, addressable over HTTP, fanned out over CDN.
  - The same protocol underneath Electric Agents, the realtime
    layer for AI SDKs, and the message bus for collaborative apps.
- **CTA:** `Explore Streams »` → `/streams`.
  Secondary: `Read the spec` → `https://durablestreams.com`.

### Vignette — _Substrate exposed_

A **cutaway zoom into the area beneath the floor** of the hero
scene. The building is barely visible at the top of the frame
(implied through legs / desk silhouettes); the substrate fills the
view:

- Two parallel channels in clear focus.
- Comet tokens drifting along each.
- Three durable packets sitting visibly _paused_ in segments —
  they don't move, they just glow gently. (This is the entire
  point: work that doesn't vanish.)
- A branch dropping off one channel down to a small consumer
  marker.
- Occasional courier feet visible at the top of the frame — a
  reminder that actors _use_ the substrate.
- **Mobile fallback** _(< 768 px width)_: drop to a single
  channel with two paused packets and one comet. Two channels
  side-by-side in a narrow strip read as parallel lines, not as
  "depth beneath the floor".

**What's implied (no labels):**

- Work persists in flight; nothing is "lost in transit".
- Multiple consumers can tap the same stream.
- The substrate is _under_ and _between_ the visible business —
  foundational, not ornamental.

### Lift / build

- Same component, deeper camera crop (lower world `z` than the
  hero crop, with the floor line near the top of the frame).
- Reuses the existing `StreamFlowBg` particle drawing routines
  (comet tokens with trailing gradient + soft glow halo) — the
  same code path, projected onto the isometric channel paths
  instead of horizontal rails.

---

## Section 4 — Sync (shared state everywhere)

**Mode:** dark band.
**Layout:** iso vignette left + prose right.

### Copy

- **Section title:** _"One source of truth, on every surface."_
- **Sub-title:** _"Sync subsets of your Postgres into everything.
  Sub-millisecond reactivity. Multi-user, multi-device, multi-agent —
  built in."_
- **Body** _(2–3 short paragraphs)_:
  - The hardest part of building collaborative software isn't
    storing the data — it's making sure every screen, every agent
    and every device sees the same live state, fast.
  - Electric Sync solves that. Carve out shapes from your
    Postgres, fan them out over CDN, and reconcile updates at
    sub-millisecond speed. Read-path sync; write through your
    existing backend.
  - The data layer for collaborative software, and the canonical
    state your agents read from.
- **CTA:** `Explore Sync »` → `/sync`.
  Secondary: `Quickstart` → `/docs/quickstart`.

### Vignette — _Mirrored state_

A **tight crop on two surfaces** within the hero building:

- Foreground: the front-of-house screen, with a card visible.
- Background, slightly higher: the upper-floor review screen,
  also showing the same card.
- A thin teal pulse propagates between them every ~3 s.
- A third manifestation — a card on the ops board between the
  two screens — pulses with a 200 ms delay so the eye reads it as
  _propagation_, not coincidence.
- Below the floor line, in shallow focus: one of the substrate
  channels carrying the corresponding packet.
- **Mobile fallback** _(< 768 px width)_: keep the two-surface
  pulse but drop the substrate channel and the third
  manifestation. Two surfaces pulsing in sync is the minimum
  legible version.

**What's implied (no labels):**

- The same business object is live on multiple surfaces.
- Updates propagate across the whole system.
- The substrate is the connective tissue.

### Lift / build

- Same component, different crop and a single scripted thread.
- Reuses the existing `SyncFanOutBg` drawing palette for the
  pulse colour and timing.

---

## Sections 5–12 — Reused blocks

These are **lifted** from the existing homepage with the changes
noted. Most need no work; one or two might benefit from a copy or
order tweak after the trilogy lands.

### Section 5 — `NoSilosStrap` _(LIFT)_

Light. CTA strap closing out the product trilogy: _"No siloes. No
black boxes. Just sync, solved, with standard web tech."_ Lifted
verbatim. Sits between the trilogy and the integrations grid as a
soft transition.

### Section 6 — `WorksWithSection` _(LIFT)_

Light. Integrations grid (Neon / Supabase / Vercel / TanStack /
Phoenix / React) with the existing tabbed code/SQL/SSE preview.
**Possible copy tweak:** the title currently reads
_"Works with your stack"_ — keep. Confirms that the heavy concepts
in the hero are buildable today on tools the reader already uses.

### Section 7 — `DeploymentSection` _(LIFT)_

Dark. _"Managed cloud, open source. Vendor agnostic, infra
agnostic."_ Lifted verbatim. The "Electric Cloud" pitch lives here.

### Section 8 — `ScalesToSection` _(LIFT, cut-candidate)_

Light. Existing scales-to chart. **Cut-candidate** because the
trilogy already implies scale and the integrations grid covers
"works at the size of the web". Keep for v1, drop in the editing
pass if the page feels long.

### Section 9 — `LatestNewsSection` _(LIFT)_

Light. Latest blog posts + Bluesky timeline. Keep as-is — proves
the project is alive and shipping.

### Section 10 — `GetStartedStrap` _(LIFT)_

Dark. `Get started` CTA strap. Lifted verbatim.

### Section 11 — `BackedBySection` _(LIFT)_

Light. Investors grid. Lifted verbatim. Provides credibility
without taking page real-estate from the products.

### Section 12 — `OpenSourceSection` _(LIFT)_

Light. Repo cards (durable-streams / electric / pglite / TanStack
db) + lazy-loaded Discord widget. Lifted verbatim.

---

## The visual — hero scene + per-product vignettes

> The rest of this document specifies the isometric scene that drives
> the hero (Section 1) and the three product vignettes (Sections 2–4).
> All four are renders of the same underlying scene from different
> camera crops, each with its own scripted thread cycle.

## What we're building on (the visual heritage we have to honour)

The three product hero backgrounds share a tight, deliberate aesthetic.
The homepage hero must clearly come from the same family — anything that
looks like a different product (e.g. glossy WebGL, big robot, generic
sci-fi network art) breaks the suite.

| Property          | Convention used by all three                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| Renderer          | HTML Canvas 2D, no WebGL                                                                        |
| Line weight       | 1px hairline, occasionally 1.4–2px for "hot" elements                                           |
| Palette (dark)    | brand teal `#75fbfd` (`--vp-c-brand-1`) for active geometry, `rgba(255,255,255,~0.16)` for idle |
| Palette (light)   | navy `#1a1a2e` (`--vp-c-brand-1` light) for active, `rgba(0,0,0,~0.13)` for idle                |
| Composition       | full-bleed background, with **radial fade** from centre so headline copy sits on a quiet pool   |
| Text occlusion    | runtime-measured `getClientRects()` exclusion zones — geometry never lands on text              |
| Animation grammar | comet tokens with trailing gradients + soft radial glow halo + solid centre dot                 |
| Interaction       | hover tooltip (mono font, `--ea-surface-alt`), click-to-fire bursts                             |
| Token palette     | `--ea-*` aliases (no new design tokens needed)                                                  |

**Key consequence for the homepage:** anything we draw in the isometric
scene — packets in the substrate, highlights on a shared object, a
"woken" agent — should reuse those exact drawing routines. That's how
the homepage _quotes_ the other pages without restating them.

The product pages each show a single abstraction:

- **Agents** → a triangulated mesh of nodes (network topology)
- **Streams** → parallel rails with flowing tokens (timelines)
- **Sync** → a table fanned out to clients (replication)

The homepage gets to be the **one view that contains all three**.

---

## Why isometric, and why now

The three product backgrounds are deliberately _flat schematics_.
Putting another flat schematic on the homepage would be visual noise —
no clear hierarchy between "the products" and "what they're for".

An **isometric world** does something none of the other backgrounds do:
it pulls the eye _into_ a place. The product pages then read as
"different abstractions of the same place from different angles".
That's the right hierarchy.

It also lets us solve the show-don't-tell problem cleanly:

- We can show **one business object visible in three places at once**
  (sync) — without ever drawing a fan-out diagram.
- We can show **a comet of work travelling through a channel under
  the floor** (streams) — without ever labelling "stream".
- We can show **a small mechanical actor pick up that work from the
  channel** (agents) — without ever drawing a robot in a hub.

The viewer infers the system from its consequences. That is the whole
point of the brief.

---

## Three concept directions

The plan commits to **A — open-front building** as the primary build
target (and the rest of the doc assumes it). B and C are documented as
**fallbacks**, not parallel options: if the prototype of A reads as
too literal, too vertical, or too cluttered, drop back to B; if both
A and B fail, try C. They are not competing directions to be A/B/C
tested at full fidelity.

### A. Open-front building — _the build target_

> _A small business shown from the side, like a dollhouse with the front
> wall removed._

Two or three storeys plus an exposed substrate beneath the foundation.
Each floor is a different functional area, but the building is **narrow
and deep, not wide and tall** — so the eye can track the whole height
in a single hero crop without it feeling vertical-only.

```
   ┌────────────────────────────────────────────────────────────┐
   │  · sky-blank ·                                             │
   │                                                            │
   │   ┌───────── upper floor — review / approval ─────────┐    │
   │   │  desk · screen showing the ticket  ·  approver   │    │
   │   └────────────────╦───────────────────────────────────┘    │
   │                    ║  channel up through substrate          │
   │   ┌────────────────╨─── ground floor — front of house ─┐   │
   │   │  customer-facing surface · dashboard · ops desk    │   │
   │   └────────────────╦───────────────────────────────────┘   │
   │                    ║                                       │
   │   ─ ─ ─ ─ ─ ─ ─ ─ ─╨─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─    │  ← floor line
   │   substrate (visible through cutaway / transparency)        │
   │     ╭──── stream channel A ────╮      ╭─── channel B ───╮   │
   │     │  • comet  • comet  ────► │      │  ••─────────►   │   │
   │     ╰──────────────────────────╯      ╰─────────────────╯   │
   │       ↑   small mechanical actor lifts work back up         │
   │                                                            │
   └────────────────────────────────────────────────────────────┘
```

**What the viewer should see** (in the order they read it):

1. _People doing recognisable work_ on each floor — silhouettes at
   desks, ticket cards on screens, approval cards on a board.
2. _The same business object in two places_ — a card highlighted on
   the ground-floor screen also lit up on the upper-floor screen,
   pulsing in sync. (Sync, not labelled.)
3. _Channels running underneath the floor_, with comet tokens flowing
   left→right, queued packets sitting durably in segments.
   (Streams, not labelled.)
4. _Two or three small non-human actors_ — not robots; more like
   _operator rigs_ or _couriers_. They emerge from the substrate to
   interact with a screen, then return. (Agents, not labelled.)
5. _One thread of work_ visibly walks the building: enters bottom-right
   as a customer message → ground-floor desk picks it up → drops into
   the substrate → courier lifts it to the upper floor for approval
   → returns through the channel → exits as a response.

**How the Electric stack is implied (no labels):**

| Product                | Visible behaviour                                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sync**               | A card on the upper-floor monitor and a card on the ground-floor dashboard light up _together_, with a thin teal pulse between them.                  |
| **Durable Streams**    | A queued comet sits paused in a substrate channel for a beat. A courier arrives, picks it up, the queue advances.                                     |
| **Agents (framework)** | A courier-actor walks a substrate path, climbs up, edits a screen, descends back into the substrate. Multiple couriers visible doing different roles. |

**Why this wins the brief:** it's the most literal "business in
operation" composition, and the cutaway gives a natural place to
expose the substrate without making it feel like a labeled diagram.

### B. Operational district — _fallback if A is too vertical_

> _Two or three small buildings on a single block, with the streets and
> the underground visible._

Departments are buildings; the substrate is an underground rail / utility
network running between them. The advantage over (A) is more horizontal
real-estate, which fits a wide hero crop better. The disadvantage is
that "buildings on a block" reads slightly more _brand-illustration_ and
slightly less _infrastructure diagram_ — it might lose some of the
"technical" feel the other pages have.

Worth prototyping if A reads as too vertical at hero aspect ratios.

### C. Editorial tabletop diorama — _fallback if A and B both fail_

> _A miniature business world floating on a stylised plinth or
> "ops table"._

Cards, screens, tiny people and couriers laid out on a tabletop, with
the substrate visible _beneath_ the table surface as if the table is
glass. Most art-directed. Most "premium homepage" feeling.

This is the highest-risk direction — it's beautiful when it works and
twee when it doesn't, and it leans furthest from the other heroes'
"technical schematic" feel. Useful as a fallback if (A) and (B) both
end up reading as too cluttered.

### Wildcard, considered and rejected: the manifold

> _A single business object passing through stacked transparent layers —
> human surface, software surface, agent surface, substrate._

This is conceptually elegant and maps very cleanly onto the
"layered protocol stack" already used on the streams page
(`LayeredStackDemo`). But it risks reading exactly as the brief
warns against: a labelled architecture stack with workers floating
between layers. We'd be re-skinning a diagram. Skip.

---

## Technical recommendation

**Build it as a structured 3D scene-graph in TypeScript, projected to
Canvas 2D with a hand-rolled isometric projection. Do not use three.js
or React Three Fiber.**

The brief's intuition that 3D authoring is easier for an agent to
manipulate than a hand-authored SVG is correct. But 3D _authoring_ and
3D _rendering_ are separable. We get the agent-friendly authoring story
without taking on the WebGL line-quality problem.

### Why not three.js / R3F

- The other three hero backgrounds are sharp, hairline canvas. WebGL
  line rendering at 1px isometric angles is famously fuzzy without
  significant per-frame work (`Line2`, MSAA, custom anti-aliased line
  shaders). We'd spend the prototype budget chasing line crispness.
- three.js + a non-trivial scene is ~150 KB minified and adds material,
  shader, camera, renderer abstractions we don't need. Each existing
  hero background is ~500 lines of self-contained canvas; this is the
  same envelope.
- We don't need _any_ of the things three.js is great at: no rotating
  camera, no shadows, no lighting, no PBR materials, no orbit controls.
  The brief explicitly says "avoid sweeping camera moves".
- The visual style we want is closer to _technical illustration_
  (think Figma isometric, blueprint, exploded axonometric) than to
  _3D rendering_. Canvas 2D is the native medium for that.

### Why not pure SVG

- SVG would be tempting (vector-clean, themable via `currentColor`),
  but a scene with hundreds of edges, animated comets and flickering
  highlights creates a heavy DOM and a sluggish animation loop. Per-
  frame canvas drawing at 1px is exactly the trick the other heroes
  rely on.
- We _will_ probably author static structural elements (building shell,
  floor lines) as a small SVG layer behind the canvas, just so they
  zoom crisply. But the moving substrate, packets, highlights and
  actors live on canvas.

### Recommended stack

```
┌─────────────────────────────────────────────────┐
│  <HomeIsoBg />  (Vue SFC, parallels HeroNetworkBg)│
│                                                 │
│  ┌─────────────────────────────────────────┐    │
│  │ Layer 0: SVG  — building shell, floor   │    │
│  │           lines, screen frames          │    │
│  │           (static, themed via CSS vars) │    │
│  └─────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────┐    │
│  │ Layer 1: Canvas — substrate channels,    │    │
│  │           packets, highlights, actors,   │    │
│  │           hover/click interactivity      │    │
│  │           (dynamic, requestAnimationFrame│    │
│  └─────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────┐    │
│  │ Layer 2: HTML — tooltip floater          │    │
│  │           (same component as siblings)   │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

Three layers, all positioned absolute, identical pattern to the
existing hero components. The Vue component owns the scene graph,
hands transformed coordinates to both the SVG and canvas layers,
and runs the animation loop on canvas only.

### Coordinate system & projection

Author everything in a **right-handed 3D world** with units in metres:

- `+x` = depth into the scene (back-right in the iso view)
- `+y` = depth into the scene (back-left in the iso view)
- `+z` = up

Project to screen via a fixed isometric matrix:

```
screenX = (x - y) * cos(30°) * scale
screenY = ((x + y) * sin(30°) - z) * scale
```

Static for the whole scene — no camera object, no perspective. Means
the whole projection is a function of `scale` and a screen-centre
offset; we can precompute every static vertex on layout.

Dot product for **z-sort** is `(x + y - z)` — items with higher values
draw later (in front).

### Camera crops & per-vignette scripts

Each product section reuses the same scene but renders a different
**sub-rectangle of world space**, framed and rotated to fit the
section's container, plus a **per-vignette script** that drives a
focused narrative for that crop. We don't move a 3D camera — we just
translate the projection origin, clip to a `worldBounds` rectangle,
and run a small state machine on top.

```ts
interface CameraCrop {
  // World-space rectangle that should map to the rendered viewport.
  worldBounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
    minZ: number
    maxZ: number
  }
  // Optional fade mask — distance from the bounds at which geometry
  // fades to zero alpha. Lets us soften the edges of the crop without
  // a hard cutoff.
  fadeMargin: number
  // Which threads to keep "live" in this crop (others go dim).
  highlightThreads: ThreadId[]
  // Aspect-ratio variant — desktop crops are wider; mobile crops zoom
  // tighter and may drop entire substructures.
  aspect: 'desktop' | 'mobile'
}

// A scripted sequence of beats that runs on top of the shared scene
// when this crop is active. Each beat manipulates threads, packets and
// actors via the same primitives the renderer already uses.
interface CropScript {
  loopMs: number
  beats: ScriptBeat[]
}

type ScriptBeat =
  | { at: number; kind: 'highlight'; surface: SurfaceId; durationMs: number }
  | { at: number; kind: 'pulse-thread'; thread: ThreadId; durationMs: number }
  | { at: number; kind: 'walk-actor'; actor: string; to: Vec3; speed: number }
  | {
      at: number
      kind: 'pickup'
      actor: string
      from: SurfaceId
      thread: ThreadId
    }
  | { at: number; kind: 'drop'; actor: string; into: ChannelId | SurfaceId }
  | { at: number; kind: 'spawn-comet'; channel: ChannelId; threadId: ThreadId }
```

The hero uses the `world` crop with **no script** (it just runs the
ambient animations from the scene's idle state). Sections 2–4 each
get a tighter crop _plus_ a scripted loop:

| Section | Crop name            | World focus                                                           | Script length                          |
| ------- | -------------------- | --------------------------------------------------------------------- | -------------------------------------- |
| Hero    | `world`              | Full scene                                                            | none — ambient                         |
| Agents  | `coordination-floor` | Ground floor, multi-actor area, depth-of-field cue to upper floor     | ~12 s — 4-beat handoff                 |
| Streams | `substrate-cutaway`  | Lower z range only — building visible only as silhouettes at top edge | ~8 s — packet pause / pickup / advance |
| Sync    | `mirrored-surfaces`  | Tight focus on three surfaces wired to a single thread                | ~3 s — propagating pulse               |

The trilogy is **shared scene + per-crop script**, not "one trick,
four configurations". The crops are mechanical and cheap; the scripts
are real per-vignette state machines. They're small and declarative
(see the `CropScript` shape above), but they are work — count them
when planning the build.

**Scroll-into-view behaviour:** vignette scripts start fresh from beat
0 each time their section enters the viewport (via
`IntersectionObserver`). They pause when scrolled out. This way the
viewer always sees a coherent intro, never a random mid-state.

---

## Proposed scene data model

A small, declarative TypeScript graph the rest of the file consumes.
Agents (and humans) can edit _this_ without touching rendering code.

```ts
// World coordinates in arbitrary units (1 = ~1 floor tile).
type Vec3 = readonly [x: number, y: number, z: number]

interface Building {
  origin: Vec3
  size: Vec3
  floors: Floor[]
}

interface Floor {
  height: number // z extent, in world units
  zones: Zone[]
}

interface Zone {
  id: string
  label: string // hover-only, never rendered
  origin: Vec3 // floor-local
  size: Vec3
  furniture: Furniture[]
}

type Furniture =
  | { kind: 'desk'; at: Vec3; facing: 0 | 90 | 180 | 270 }
  | { kind: 'screen'; at: Vec3; facing: 0 | 90 | 180 | 270; surface: SurfaceId }
  | { kind: 'board'; at: Vec3; cards: CardRef[] }
  | { kind: 'person'; at: Vec3; pose: 'sit' | 'stand'; busyWith?: ThreadId }

interface Substrate {
  channels: Channel[]
}

interface Channel {
  id: ChannelId
  // Path through world space, projected to a single z under the floor.
  // Polyline so we can route around buildings.
  path: Vec3[]
  // Static packets that sit durably on the channel — i.e. queued work.
  durable: Packet[]
}

interface Packet {
  threadId: ThreadId
  position: number // 0..1 along the channel path
}

interface Actor {
  id: string
  kind: 'human' | 'courier' | 'inspector' | 'analyst'
  position: Vec3
  // optional path the actor is currently walking; null when idle.
  walking?: { points: Vec3[]; t: number; speed: number }
}

interface Thread {
  id: ThreadId
  // The list of surfaces this thread *currently* exists on. Drives the
  // sync-style mirrored highlight effect.
  manifestations: SurfaceId[]
  // Visual hue offset within the brand palette so multiple concurrent
  // threads stay distinguishable.
  hue: number
}

// A "surface" is anything a thread can manifest on: a screen, a board,
// a card on a desk, a packet in a channel.
type SurfaceId = string
type ChannelId = string
type ThreadId = string

interface Scene {
  buildings: Building[]
  substrate: Substrate
  actors: Actor[]
  threads: Thread[]
}
```

**Why this shape:**

- It's pure data. An agent can synthesise or mutate a `Scene` literal
  without understanding the renderer.
- It separates _structure_ (buildings, channels) from _state_
  (threads, actors), which lines up exactly with how the streams /
  sync / agents stories want to be told. Threads & actors are the
  moving parts of the show-don't-tell narrative.
- `manifestations: SurfaceId[]` is the single hook that drives the
  "same object in two places" sync visual. To express _"this support
  ticket is open in three places"_, you append three `SurfaceId`s
  to one thread.
- `Channel.durable: Packet[]` is the single hook for the
  "work doesn't vanish when nobody is looking" streams visual. A
  packet sitting at `position: 0.4` for ten seconds _is_ the
  durability story.

The renderer is then a pair of functions:

```ts
function projectScene(scene: Scene, crop: CameraCrop): ProjectedScene
function drawScene(
  ctx: CanvasRenderingContext2D,
  ps: ProjectedScene,
  t: number
): void
```

`projectScene` runs once per crop on layout and on resize.
`drawScene` runs every frame, taking the elapsed time and animating
threads / actors / packets that have a `t` parameter.

---

## MVP prototype spec

A single Vue SFC: `website/src/components/home/HomeIsoBg.vue`,
mounted at four places on the homepage:

1. As the hero background on `/` (full `world` crop).
2. Inside the agents section (Section 2, `coordination-floor` crop).
3. Inside the streams section (Section 3, `substrate-cutaway` crop).
4. Inside the sync section (Section 4, `mirrored-surfaces` crop).

The four mounts share the same scene data; only the `<crop>` prop
differs.

### Scene at MVP

- **One building**, two floors plus visible substrate.
- **Ground floor:** two zones — front-of-house desk (1 person at
  a screen) and an ops board (a vertical wall card-rack with 4 cards
  visible).
- **Upper floor:** one zone — a review desk with a screen, 1 person
  standing reviewing it.
- **Roof / sky:** kept blank. The headline copy lives on top of this
  empty area; runtime exclusion zones (same trick as
  `HeroNetworkBg.measureExclusions`) prevent any geometry from
  intruding.
- **Substrate:** two parallel channels under the floor, each with
  three durable packets pre-seeded.
- **Actors:** one courier-actor that walks a fixed loop —
  emerges from a channel → climbs to the upper floor → taps the
  screen → returns to the substrate. One inspector-actor that
  occasionally pauses next to a queued packet and "ticks" it.
- **Thread:** one named thread (`escalation-1f6a`) wired to four
  surfaces: the front-of-house screen, the ops-board top card, the
  upper-floor review screen, and one packet in the substrate. All
  four pulse together once every ~6 s.

### Animations

Subtle, on-by-default, paused under
`prefers-reduced-motion: reduce` (matches existing pattern).

- **Substrate flow:** comet tokens drift along channel paths at
  ~25 px/s (much slower than the streams hero — this is "calm
  background activity").
- **Mirrored thread pulse:** every 5–8 s, each surface in the
  thread's `manifestations` list briefly lights up teal in
  unison, with a 200 ms delay between surfaces so the eye
  reads it as _propagation_, not coincidence.
- **Courier walk:** 16 s loop. Linear movement along its path,
  tiny bob on the z-axis to suggest steps.
- **Idle micro-motion:** people silhouettes shift weight by
  half a pixel every ~2 s. Cards on the ops board jitter their
  outline by sub-pixel. Just enough to never feel frozen.

### Per-section animation tweaks

Each crop dampens or amplifies the shared animations to suit its
focus:

| Crop                 | Substrate flow | Mirrored pulse                  | Courier walk               |
| -------------------- | -------------- | ------------------------------- | -------------------------- |
| `world` (hero)       | normal         | normal                          | normal                     |
| `coordination-floor` | dim            | dim                             | **amplified, faster loop** |
| `substrate-cutaway`  | **amplified**  | dim                             | edge-only                  |
| `mirrored-surfaces`  | dim            | **amplified, on a 3 s cadence** | hidden                     |

This keeps the cropped vignettes focused on one product's story
without anyone needing to author a new animation.

### Interactivity

Same vocabulary as the three product heroes, available in all four
crops:

- **Hover a packet** → tooltip `/escalation-1f6a · waiting`.
- **Hover a surface** that's part of a thread → the _other_
  surfaces in that thread briefly highlight too. (Demonstrates
  sync.)
- **Click a channel** → spawn a new comet at that point, propagate
  it along the channel. (Demonstrates streams.)
- **Click the courier** → it instantly wakes and starts a new walk.
  (Demonstrates agents.)

### What's static vs animated at MVP

| Element                     | Static |        Animated        |
| --------------------------- | :----: | :--------------------: |
| Building shell, floor lines |   ✓    |                        |
| Screen and board frames     |   ✓    |                        |
| Person silhouettes          |   ✓    | sub-pixel weight shift |
| Substrate channel rails     |   ✓    |                        |
| Substrate comets            |        |           ✓            |
| Durable packet markers      |   ✓    |   gentle glow pulse    |
| Mirrored thread highlight   |        |           ✓            |
| Courier actor               |        |           ✓            |
| Inspector actor             |        |           ✓            |
| Hover tooltip               |        |           ✓            |

### Fidelity target

"Beautiful in static screenshot, alive on hover."

Specifically: the thing should look polished and complete with motion
disabled (so it works for marketing screenshots, blog hero crops,
social previews). Animation is icing, not load-bearing.

### Operational details

Things that are easy to forget until they bite during the build pass.
Pin these down before merging the page assembly step.

- **SSR.** The site is VitePress, which renders pages on the server.
  `<HomeIsoBg>` (and the existing hero backgrounds it follows) is a
  client-only Canvas component — wrap it in `<ClientOnly>` when used
  inside a Markdown page, exactly as the existing product heroes do.
  Provide a server-rendered fallback (see "static screenshot fallback"
  below) so layout doesn't shift on hydrate.
- **Static screenshot fallback.** Each of the four mounts must
  pre-render a static SVG or PNG of its crop in the _idle_ state, used
  as: (a) the SSR fallback before hydration, (b) the
  `prefers-reduced-motion: reduce` rendering, (c) blog post and social
  share crops. Generate these once from the same scene data via a
  one-shot Node script that draws to a server-side canvas; commit them
  as `iso/snapshots/<crop>.svg`.
- **Animation start gate.** Only the active vignette animates. The
  hero starts on mount; vignette scripts only start when their section
  intersects the viewport (`IntersectionObserver`, `rootMargin: 0px`,
  `threshold: 0.25`). When a vignette scrolls out, pause its `rAF`
  loop and freeze its state. This keeps total motion-on-screen low
  and CPU usage minimal on long scrolls.
- **Theme switching.** All colours are CSS custom properties read from
  the document at draw time (matches the existing hero pattern). When
  the user toggles dark/light, the next animation frame picks up the
  new tokens — no scene rebuild required. Verify the contrast on both
  modes for: hairline strokes, courier silhouette, packet glow, and
  the `radialFade` of the headline area.
- **Performance budget.** One `rAF` loop per visible mount, max. With
  hero + one vignette ever visible at once that's ≤ 2 active loops.
  Single canvas per mount, 1× DPR draw scaled to `devicePixelRatio` on
  resize. Target: < 8 ms/frame on a 2019 MacBook Air, < 16 ms on a
  mid-tier Android. If we blow this, the first thing to drop is
  per-actor sub-pixel idle motion (it's nice but not load-bearing).
- **Hit areas.** Click targets on small moving sprites (the courier,
  comet packets) must have a generous invisible hit halo — a sprite
  drawn at 8 px should have a 24 px hit radius. The current
  `StreamFlowBg` token-click pattern already does this; lift its
  approach.
- **Mobile interactivity.** Hover doesn't exist on touch. On
  `(pointer: coarse)`, replace hover-tooltip with tap-to-show: a tap
  on a packet shows the tooltip _in place_ with a dismiss-on-outside
  pattern; a tap on a surface fires the same thread highlight as
  desktop hover would. Don't try to make hover-only behaviour
  discoverable on mobile — just don't ship it there.

---

## Implementation plan

A six-phase build. Each phase is independently mergeable; the order
matters but the cadence does not. No human-day estimates — agents
work at a different cadence and the meaningful unit is _phase
boundary_ (each one is a reviewable checkpoint), not wall time.

### Phase 1 — projection sandbox

A throwaway page (`/dev/iso-sandbox`, gated to dev builds) that draws
an isometric grid and a couple of test cubes. Verify the projection
matrix, z-sort, hit-testing (world↔screen roundtrip on click) and the
DPR-aware canvas resize. **Exit criterion:** click anywhere on the
sandbox and the displayed `(x, y, z)` coords are correct to within
1 px.

### Phase 2 — `Scene` type and static render

Define the data model from this doc in `iso/types.ts`. Hand-author
the MVP scene as a TypeScript constant in `iso/scene.ts`. Render only
structure (no animation, no interactivity, no scripts): building
shell, screens, people, channels, durable packets. **Exit criterion:**
the static render looks like a polished isometric illustration —
this is the static-screenshot baseline used by the SSR fallback.

### Phase 3 — animations and the radial fade

Add the `rAF` loop. Implement comet flow, courier walk, mirrored
thread pulse, sub-pixel idle motion, and the `prefers-reduced-motion`
short-circuit. Lift the `radialFade` and `getTextRects` exclusion
helpers verbatim from `HeroNetworkBg`. **Exit criterion:** the scene
breathes without the headline area being touched by geometry.

### Phase 4 — camera crops and per-vignette scripts

Add `CameraCrop` and `CropScript` from this doc. Author the four
named crops in `iso/crops.ts` and the three scripts (agents, streams,
sync) in `iso/scripts/`. Wire the `IntersectionObserver` so scripts
start at beat 0 on enter and pause on exit. **Exit criterion:** all
four crops play correctly in the sandbox with the correct script,
and switching between them from a debug panel doesn't leak state.

### Phase 5 — wire to homepage hero and product trilogy

Convert `website/index.md` from `layout: home` to `layout: page` with
a custom layout component (matching `/agents`, `/streams`, `/sync`).
Build `HomeHero.vue` and `HomeProductSection.vue`. Wire `<HomeIsoBg>`
into the hero (Section 1) with the `world` crop and into Sections 2–4
with the `coordination-floor`, `substrate-cutaway` and
`mirrored-surfaces` crops. Lift the `[LIFT]` blocks from
`website/src/components/home/sections/`. **Exit criterion:** the new
homepage renders end-to-end on `localhost:5173` with all 12 sections
in order, in both dark and light themes, on desktop and mobile.

### Phase 6 — copy pass, polish, snapshots

Tune line weights and palette balance against the live page in both
themes. Lock down the headline / sub-head / tagline / CTA copy for
each new section. Generate the static SVG snapshots used for SSR
fallback (see "Operational details" above) and verify there's no
layout shift on hydrate. Verify the inferred dark/light modes of the
lifted blocks (Sections 5–12) — re-balance if two same-mode bands
end up touching. **Exit criterion:** review-ready.

### Component layout

```
website/src/components/
├── home/
│   ├── HomeIsoBg.vue              [NEW]    The shared iso scene component.
│   ├── HomeHero.vue               [NEW]    Section 1 wrapper (text + scene).
│   ├── HomeProductSection.vue     [NEW]    Re-usable wrapper for Sections 2–4.
│   ├── ProductsGrid.vue           [CUT?]   Was used by ProductsSection. If
│   │                                       nothing else imports it after
│   │                                       SolutionsSection + ProductsSection
│   │                                       are cut, delete it too.
│   ├── sections/
│   │   ├── SolutionsSection.vue   [CUT]    Replaced by trilogy.
│   │   ├── ProductsSection.vue    [CUT]    Replaced by trilogy.
│   │   ├── WorksWithSection.vue   [LIFT]   No change.
│   │   ├── DeploymentSection.vue  [LIFT]   No change.
│   │   ├── ScalesToSection.vue    [LIFT]   Cut-candidate.
│   │   ├── LatestNewsSection.vue  [LIFT]   No change.
│   │   ├── BackedBySection.vue    [LIFT]   No change.
│   │   ├── OpenSourceSection.vue  [LIFT]   No change.
│   ├── straps/
│   │   ├── NoSilosStrap.vue       [LIFT]   No change.
│   │   └── GetStartedStrap.vue    [LIFT]   No change.
│   └── iso/                       [NEW dir]
│       ├── scene.ts               [NEW]    The MVP `Scene` constant.
│       ├── crops.ts               [NEW]    The four named `CameraCrop`s.
│       ├── scripts/               [NEW]    Per-vignette `CropScript`s.
│       │   ├── agents.ts          [NEW]    `coordination-floor` 4-beat loop.
│       │   ├── streams.ts         [NEW]    `substrate-cutaway` 3-beat loop.
│       │   └── sync.ts            [NEW]    `mirrored-surfaces` pulse cycle.
│       ├── snapshots/             [NEW]    Static SVG fallbacks per crop.
│       ├── projection.ts          [NEW]    Iso projector + z-sort.
│       ├── render.ts              [NEW]    Canvas drawing routines.
│       └── types.ts               [NEW]    All scene-graph types.
```

### Page wiring (`website/index.md`)

```md
---
layout: page
title: 'Electric'
titleTemplate: ':title | The data platform for multi-agent'
pageClass: home-page
---

<script setup>
import HomeHero            from './src/components/home/HomeHero.vue'
import HomeProductSection  from './src/components/home/HomeProductSection.vue'
import {
  WorksWithSection,
  DeploymentSection,
  ScalesToSection,
  NoSilosStrap,
  LatestNewsSection,
  GetStartedStrap,
  BackedBySection,
  OpenSourceSection,
} from './src/components/home'
</script>

<HomeHero />

<HomeProductSection product="agents"  :dark="true"  /> <!-- Section 2 -->
<HomeProductSection product="streams" :dark="false" /> <!-- Section 3 -->
<HomeProductSection product="sync"    :dark="true"  /> <!-- Section 4 -->

<NoSilosStrap />
<WorksWithSection />
<DeploymentSection />
<ScalesToSection />        <!-- ★ cut-candidate -->
<LatestNewsSection />
<GetStartedStrap />
<BackedBySection />
<OpenSourceSection />
```

`HomeProductSection` reads its copy and crop config from a single
`product` prop, internally instances `<HomeIsoBg>` with the right
crop, and handles the left/right column orientation (alternates
based on dark/light mode for visual rhythm).

---

## Open questions

Real ones — the things actually under-specified, not the things
already covered by "Operational details" or the build phases.

1. **Actor design language.** Couriers / inspectors should not look
   like robots. Options: faceless silhouette with a clipboard,
   hexagonal head + thin limbs, suitcase-with-legs. Worth a short
   visual sprint of its own _before_ Phase 2 (the actor is the most
   "characterful" element in the scene; getting it wrong undermines
   the whole illustration).
2. **Hero text on left or right?** The current draft has text on the
   left; LTR readers land on it first. But the scene is the stronger
   element, so text on the _right_ (eye lands on the scene first,
   then reads the prose) might be more compelling. Try both in
   Phase 5 against the live page.
3. **Headline copy lock-in.** Held until the visual exists, then
   written to it. _"The data platform for multi-agent"_ (current
   copy) likely holds — the visual is the unique element of the
   homepage; the copy can stay relatively understated. Lock in
   Phase 6.
4. **Thread variety at MVP.** MVP has one thread. Is one enough to
   read "shared substrate", or does the eye need at least two
   different cadences to register that it's a _system_? Decide
   during Phase 3 by eye, not in advance.
5. **`NoSilosStrap` placement.** The plan moves it up to close the
   trilogy. Verify in Phase 5 that this doesn't demote a CTA that
   was pulling its weight where it was on the live page — easy to
   swap back.
6. **`ScalesToSection` keep or cut?** Marked as cut-candidate. The
   "scales like the web" claim is genuinely a differentiator and
   probably worth keeping somewhere; question is whether _this_
   section visualises it well enough to earn its slot. Decide in
   Phase 6.

---

## Anti-goals (taken straight from the brief, restated for the build)

- No central hub, no big robot, no labelled product boxes.
- No comparison framing ("before/after", "old way/new way").
- No floating glowing app cubes — software surfaces are flat
  screens _inside_ the building, attached to desks and walls.
- No labels on substrate elements. The viewer infers from
  behaviour, never from text.
- No camera moves. The view is fixed; only the scene contents
  animate.
- No abstract sci-fi network art. Every element should be
  recognisably _a thing in a working business_ — a desk, a
  screen, a queue, a courier — even when stylised.
- **No re-stating the trilogy.** The three product sections each
  use the same isometric world from a different angle; we don't
  also include a separate "products grid" or "solutions" tile
  block. One presentation per concept.
