# Electric Sync — landing page plan (`/sync`) _v2_

> Working spec for the new Electric Sync landing page. Mirrors the visual
> language of the Electric Agents landing page (centered hero, alternating
> prose/visual sections, dark "bands" to break things up, hairline borders,
> monospace install prompt, numbered code annotations).
>
> **Approach:** overbuild now, edit down later.
> **Reuse policy:** every section calls out whether it is a _direct lift_,
> a _re-skin_ of an existing component, or _new build_.
> **Cut markers:** sections marked **[CUT-CANDIDATE]** are the first to
> drop in the editing pass.

---

## Changelog from v1

- **Re-ordered the spine** so each section earns the next. Two attached
  diagrams move from Section 2 (emotional opener) to **Section 6** (the
  payoff after we've explained shapes, fan-out, and writes).
- **Added Section 5 — "Bring your own writes"** (4-tile pattern ladder).
  Sync is read-path only; the write story now has its own moment instead
  of being one line in `WorksWithSection`.
- **Added Section 11 — "What people build"** (3-card demo strip) before
  the closing CTA, so the page _feels_ alive.
- **Added Section 10 — "Managed cloud, open source"** (single hairline
  strip — re-skin of `DeploymentSection`).
- **Marked Section 8 ("Four things you get for free") as [CUT-CANDIDATE].**
  Doing double-duty work now that the spine is tighter.
- **Hero copy options** documented for testing.
- **Mobile spec** added per section.
- **"What this isn't" caption** added to Section 3 to head off the
  "but how do I write?" confusion.

Resulting page is now 13 sections (vs. 10 in v1). One is explicitly
disposable. Net: +2 fixed sections, +1 demo strip, +1 cloud strip,
+1 cut-candidate.

---

## Page-level decisions

- **Layout:** `layout: page` with `pageClass: sync-page` (parallel to
  `ea-homepage` on the Agents page so the navbar bottom-divider hide rule
  applies consistently).
- **Hero chrome:** `<HeroNetworkBg>` swapped for a Sync-flavoured background
  (faint diagonal "fan-out" lines from a central point — see Section 1).
- **Token palette:** uses the existing `--ea-*` tokens — no new tokens
  needed. Brand teal `var(--vp-c-brand-1)` for accents.
- **Type scale:** identical to Agents page (`56px` hero name, `28px`
  section titles, `17px` prose, `15px` detail).
- **Vertical rhythm:** alternates light → dark → light to match Agents.
- **Mobile breakpoints:** mirror Agents (`480 / 518 / 768 / 959 / 1019 /
1099 / 1280`). Each section spec calls out its mobile collapse rule.

```
Section                          Mode    Pattern                              Cut?
──────────────────────────────────────────────────────────────────────────────────
1   Hero                         light   centered hero + install prompt
2   Apps need to come online     light   prose left + small visual right
3   Sync the shape               dark    full-bleed centerpiece
4   One Postgres, many clients   light   prose + fan-out animation
5   Bring your own writes        light   4-tile ladder
6   Multi-user ↔ multi-agent     dark    side-by-side cards (the diagrams)
7   Scales like the web          light   prose + ScalabilityChart
8   Four things you get free     light   2×2 grid                             ★
9   Works with your stack        dark    3-column stack visual
10  Managed cloud, open source   light   single Cloud strip
11  Your first sync in 10 lines  light   annotated code
12  What people build            dark    3-card demo strip
13  Compose your sync stack      light   3-card cross-sell
14  Used by + Get started        light   logos + CTA strap
```

(★ = cut-candidate)

---

## Section 1 — Hero

**Layout:** centered, `padding: 100px 24px 80px` (matches `.ea-hero`).
**Background:** new `SyncFanOutBg` component — a faint dotted/dashed pattern
of lines fanning _outward_ from a central point on the left toward many
points on the right. Brand-teal at very low opacity. (Distinguishes from
the Agents `HeroNetworkBg` mesh.)

### Headline copy — three options to test

| #   | Headline                                                        | Tone           | Note                          |
| --- | --------------------------------------------------------------- | -------------- | ----------------------------- |
| A   | _"The data layer for collaborative software."_                  | Most ambitious | Earns it via Section 6 payoff |
| B   | _"Sync your Postgres into anything."_                           | Most concrete  | Devs grok it instantly        |
| C   | _"Make apps fast. Make them collaborative.<br>Sync your data."_ | Rhythmic       | Three-beat, marketing-forward |

**Recommendation:** **A** — it's the most ambitious, hardest to write to,
and the page argues for it convincingly across Sections 3–6. Fall back
to B if A feels overreach.

### Sub-headline & tagline (paired with A)

- **Sub-headline:** _"Sub-millisecond reactivity. Instant local writes.
  Multi-user, multi-device, multi-agent — built in."_
- **Tagline:** _"Real-time sync for Postgres, over plain HTTP. Using your
  existing stack."_

```
                          Electric Sync
                          ─────────────
              The data layer for collaborative software

      Sub-millisecond reactivity. Instant local writes.
      Multi-user, multi-device, multi-agent — built in.

         Real-time sync for Postgres, over plain HTTP.
                    Using your existing stack.

              ┌──────────────────────────────────────┐
              │ $ npx @electric-sql/start my-app  📋 │
              └──────────────────────────────────────┘

                       Apache 2.0  ·  ★ 9.5k on GitHub
```

- **Install prompt:** `npx @electric-sql/start my-app` with copy-to-clipboard.
  (Same chrome as `.ea-hero-install` on the Agents page.)
- **Open-source signal:** small line below the install prompt — _"Apache
  2.0 · ★ 9.5k on GitHub"_. Mirrors the Agents page's `ea-hero-credibility`
  slot (currently empty there). Live star count via existing
  `useGitHubStars` composable if we have one, else static.
- **No buttons in the hero** — install prompt is the primary action.

**Mobile (≤768):** identical structure, smaller type. Install prompt
shrinks to `padding: 8px 14px`, font `13px`. OS signal wraps to 2 lines.

**Components:**

- _New build_: `<SyncFanOutBg>` — small SVG/canvas, ~80 lines, mirrors
  `<HeroNetworkBg>`.
- _Direct lift_: install-prompt block from `HomePage.vue` (Agents).

---

## Section 2 — "Apps need to come online together" _(problem)_

> Echoes the Agents page's _"Agents need to come online"_ slot. Establishes
> the problem the rest of the page solves.

**Layout:** light band, prose left (max-width 640px), small visual right.

**Section title:** _"Apps need to come online together"_

**Body copy (3 short paragraphs):**

> Most software is built request-by-request, tab-by-tab, user-by-user.
> Each click hits an endpoint. Each component fetches its own data. Each
> tab is its own island.
>
> But real software is collaborative. Teams work together. Agents work
> alongside humans. Devices stay in sync across pockets, desks and
> data centres.
>
> **Sync makes that the default.** State is persistent, addressable and
> shared — across every client, every tab, every device, every agent.

**Visual (right):** small live-looking demo — a `<MultiClientPulseDemo>`
showing three browser-window frames stacked, each displaying the same
list, with a row updating in all three simultaneously on a 3-second loop.

```
┌─ Prose ─────────────────────────────┐  ┌─ <MultiClientPulseDemo> ─────────────┐
│                                      │  │                                       │
│  ## Apps need to come online together│  │  ┌─ web ────────────┐                 │
│                                      │  │  │ ☐ Buy milk       │                 │
│  Most software is built request-by-  │  │  │ ☑ Email Sam     ◄┼── pulse        │
│  request, tab-by-tab, user-by-user…  │  │  │ ☐ Ship release   │                 │
│                                      │  │  └──────────────────┘                 │
│  But real software is collaborative. │  │                                       │
│  Teams work together. Agents work    │  │  ┌─ mobile ─────────┐                 │
│  alongside humans…                   │  │  │ ☐ Buy milk       │                 │
│                                      │  │  │ ☑ Email Sam     ◄┼── pulse        │
│  ▸ Sync makes that the default.      │  │  │ ☐ Ship release   │                 │
│  State is persistent, addressable    │  │  └──────────────────┘                 │
│  and shared.                         │  │                                       │
│                                      │  │  ┌─ worker ─────────┐                 │
│                                      │  │  │ ☐ Buy milk       │                 │
│                                      │  │  │ ☑ Email Sam     ◄┼── pulse        │
│                                      │  │  │ ☐ Ship release   │                 │
│                                      │  │  └──────────────────┘                 │
└──────────────────────────────────────┘  └───────────────────────────────────────┘
```

**Mobile (≤768):** stacks. Visual moves below prose. Window frames stay
side-by-side at smaller scale to preserve the "three clients" message.

**Components:**

- _New build_: `<MultiClientPulseDemo>` — pure CSS animation, ~120 lines.
  No JS state needed — just `@keyframes` cycling row highlights.

---

## Section 3 — "Sync the shape, not the database" _(dark band — the primitive)_

> The page's technical centerpiece. Defines the unit of sync.

**Layout:** dark band, full-width visual on top, prose + secondary copy
beneath in two columns.

**Section title:** _"Sync the shape, not the database"_
**Subtitle:** _"A shape is a slice of your Postgres — a table, an optional
WHERE, an optional set of columns. Subscribe to it, and your client gets a
live, up-to-date copy."_

**Visual — `<ShapeCarveDemo>` (new build):**

```
                        ╭────────────── Postgres ──────────────╮
                        │                                       │
                        │   projects                            │
                        │   ┌─────────────────────────────┐     │
                        │   │ id │ workspace_id │ name    │     │
                        │   ├────┼──────────────┼─────────┤     │
                        │   │ 01 │   ws-A     ✓ │  Apollo │ ◄┐  │
                        │   │ 02 │   ws-B       │  Beta   │  │  │ rows
                        │   │ 03 │   ws-A     ✓ │  Comet  │ ◄┤  │ matching
                        │   │ 04 │   ws-C       │  Delta  │  │  │ shape
                        │   │ 05 │   ws-A     ✓ │  Echo   │ ◄┤  │ pulse teal
                        │   │ 06 │   ws-B       │  Fox    │  │  │
                        │   └─────────────────────────────┘     │
                        ╰───────────────────────────────────────╯
                                          │
                                          │  Shape: { table: 'projects',
                                          │           where: 'workspace_id = $1',
                                          │           params: ['ws-A'] }
                                          ▼
                  ╭─────────────────── Electric ──────────────────╮
                  │                                                │
                  │  ▶ snapshot   ▶ insert   ▶ update   ▶ delete  │   live changelog
                  │                                                │
                  ╰────────────────────────────────────────────────╯
                          │            │            │
                          ▼            ▼            ▼
                    ┌──────────┐ ┌──────────┐ ┌──────────┐
                    │ client A │ │ client B │ │ client C │      many clients,
                    │ (web)    │ │ (mobile) │ │ (worker) │      one shape
                    └──────────┘ └──────────┘ └──────────┘
```

- **Animation hint:** rows matching the WHERE clause pulse/highlight in
  brand teal. Non-matching rows stay muted. When a row is updated in
  Postgres (cycled on a 4-second timer), the matching shape change pulses
  through Electric and into all three clients simultaneously.
- **Static-fallback:** for SSR / `prefers-reduced-motion` show the same
  layout without pulses.

**Prose underneath the visual (two columns):**

| Left column                                                                       | Right column                                                                               |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Defined by you**                                                                | **Delivered everywhere**                                                                   |
| `table` + optional `where` + optional `columns`.                                  | One shape, many subscribers. Live changelog over plain HTTP — cacheable and CDN-friendly.  |
| Shapes are immutable per subscription, so a client always sees a consistent view. | Rejoin from the last `offset` after a disconnect. Resume from cache. Resilient by default. |

**Caption (small, muted, beneath the prose):**
_"Sync handles reads. Writes go through your existing API — see [Section
5](#5) below."_ — heads off the most common reader confusion.

**Footer link:** _"Read the Shapes guide →"_ `/docs/sync/guides/shapes`

**Mobile (≤768):** visual scales (allow horizontal scroll if needed for
the table). Two-column prose stacks.

**Components:**

- _New build_: `<ShapeCarveDemo>` — SVG-based, framer-motion-free
  (CSS animations via `@keyframes`); ~250 lines. Cycles through 4 states
  (insert / update / delete / steady) on a 4-second loop.

---

## Section 4 — "One Postgres, many clients" _(consequence #1: fan-out)_

> Builds directly on Section 3. If a shape is the unit, fan-out is the
> immediate consequence.

**Layout:** light band, prose left, animated diagram right.

**Section title:** _"One Postgres, many clients"_
**Subtitle:** _"Fan out to thousands of subscribers from a single shape.
Cache it on the edge. Resume from a CDN."_

**Body copy:**

> Every subscriber to a shape gets the same stream of changes. There's no
> per-client query, no per-client connection to Postgres, no per-client
> state on the server. Just one shape, served from a long-lived HTTP
> response, cached by the same CDN that serves your assets.
>
> Resume from anywhere. Disconnect a client, reconnect a week later, and
> it picks up from the offset it left at — replaying only what it missed.

**Visual:** re-skin of `PartialReplicationDiagramme.vue` (already exists),
or new `<FanOutDiagram>` if the existing one isn't expressive enough.

```
                                     ┌─── Postgres ────┐
                                     │                  │
                                     │  ┌────────────┐  │
                                     │  │ projects   │  │
                                     │  └────────────┘  │
                                     └────────┬─────────┘
                                              │
                                              │ one shape
                                              ▼
                                  ┌────── Electric ──────┐
                                  │                       │
                                  │  ▶ change ▶ change ▶  │
                                  │                       │
                                  └─┬───┬───┬───┬───┬───┬─┘
                                    │   │   │   │   │   │
                                    │   │   │   │   │   │  served via
                                    │   │   │   │   │   │  any standard
                                    ▼   ▼   ▼   ▼   ▼   ▼  CDN
                              ┌──────────────────────────────┐
                              │       CDN / edge cache       │
                              └─┬───┬───┬───┬───┬───┬───┬───┬─┘
                                │   │   │   │   │   │   │   │
                                ▼   ▼   ▼   ▼   ▼   ▼   ▼   ▼
                              [c] [c] [c] [c] [c] [c] [c] [c]   thousands
                                                                  of clients
```

**Footer link:** _"Read the HTTP API →"_ `/docs/sync/api/http`

**Mobile (≤768):** stack prose above visual. Visual scales down to
single-column.

**Components:**

- _Re-skin_ of `PartialReplicationDiagramme.vue` if expressive enough,
  otherwise _new build_ `<FanOutDiagram>` (~150 lines).

---

## Section 5 — "Bring your own writes" _(consequence #2: composability)_

> The "Sync is read-only" answer, given proactively. Pre-empts the most
> common reader question.

**Layout:** light band, intro prose centred, 4-tile ladder beneath.

**Section title:** _"Bring your own writes"_
**Subtitle:** _"Sync handles the read path. Write path stays in your
existing API — exactly how complex or simple as you want it to be."_

**Body copy (one paragraph, centred under the title):**

> Sync doesn't replace your backend. It runs alongside it. Writes go
> through your existing API; the changes flow back via Postgres and Sync
> picks them up. **Choose the write pattern that fits the shape of your
> app — start simple, layer up later.**

**Visual — 4-tile ladder (new build, simple):**

```
┌── 1. Online writes ────────────────┐  ┌── 2. Optimistic state ─────────────┐
│                                     │  │                                     │
│   client  →  POST /api/x  →  PG     │  │   client  ◀── optimistic ──┐        │
│              ↓                      │  │      ↓                      │        │
│           response                  │  │   POST /api/x  →  PG  →  Sync       │
│                                     │  │                            │        │
│   ─ Simplest. Rare cases. ─         │  │   ─ The default for apps. ─         │
│                                     │  │                                     │
│   Send writes through your API.     │  │   Show the result instantly.        │
│   Wait for the response. Re-render. │  │   Reconcile with the synced truth.  │
└─────────────────────────────────────┘  └─────────────────────────────────────┘

┌── 3. Shared persistent ────────────┐  ┌── 4. Through the database ─────────┐
│                                     │  │                                     │
│   IndexedDB ◀─ optimistic ─┐        │  │   client  →  local PG  →  Sync ⇄ PG │
│      ↓                      │        │  │                                     │
│   POST /api/x  →  PG  →  Sync       │  │   ─ Pure local-first. PGlite. ─     │
│                              │        │  │                                     │
│   ─ Crash-safe optimistic. ─        │  │   Write to a local Postgres.        │
│                                     │  │   Sync reconciles bidirectionally.  │
│   Survives reload, multi-tab,       │  │                                     │
│   patchy connectivity.              │  │                                     │
└─────────────────────────────────────┘  └─────────────────────────────────────┘
```

Each tile links to the matching anchor in `/docs/sync/guides/writes`.

**Footer line (centred):** _"Use TanStack DB for optimistic state out of
the box →"_ `/sync/tanstack-db`

**Mobile (≤768):** ladder collapses to single column. Tile order
preserved (1 → 4).

**Components:**

- _New build_: simple grid of 4 hairline cards. ~80 lines markup +
  CSS-only.

---

## Section 6 — "Multi-user ↔ multi-agent" _(dark band — the payoff)_

> The two attached diagrams. Now lands as the payoff to the technical
> argument built up in Sections 3–5, not as the opening punch.

**Layout:** dark band, two equal cards side-by-side (re-uses the existing
`.paradigm-comparison` grid from `KeyToAdoptionSection.vue`, re-skinned to
EA hairlines).

**Section title:** _"Multi-user ↔ multi-agent"_
**Tagline:** _"Once your data is shared, real-time, and resilient by
default — collaboration becomes free. Multi-user UX, multi-agent systems,
all without bespoke coordination code."_

```
┌─ ❌ Single-user ↔ single-agent ───────┐ ┌─ ✅ Multi-user ↔ multi-agent ────────┐
│                                       │ │                                       │
│  AI apps and agentic systems built    │ │  With sync, state is persistent,      │
│  on a single-user ↔ single-agent,     │ │  addressable and shared. You get      │
│  request ↔ response paradigm don't    │ │  multi-tab, multi-device, multi-user  │
│  cut it.                              │ │  and multi-agent built in.            │
│                                       │ │                                       │
│  Requests are fragile and hard to     │ │  You unlock product-led growth and    │
│  resume. The UI blocks while they     │ │  can weave your product into your     │
│  stream back. Local state isn't       │ │  customers' workflows and             │
│  shared.                              │ │  governance structures.               │
│                                       │ │                                       │
│  ╔═════════════════════════════════╗  │ │  ╔═════════════════════════════════╗  │
│  ║  [request-response.jpg]         ║  │ │  ║  [sync-based-architecture.jpg]  ║  │
│  ║                                 ║  │ │  ║                                 ║  │
│  ║   User → API → LLM provider     ║  │ │  ║   Clients ⇄ DB                  ║  │
│  ║   ─ UI blocked ─                ║  │ │  ║      ↓ Writes    ↑ Sync         ║  │
│  ║   Renders streaming response    ║  │ │  ║   Durable Session ↔ Stream      ║  │
│  ║   ─ Unblocked ─                 ║  │ │  ║   Agents ↔ LLM ↔ Stream         ║  │
│  ╚═════════════════════════════════╝  │ │  ╚═════════════════════════════════╝  │
│                                       │ │                                       │
└───────────────────────────────────────┘ └───────────────────────────────────────┘
```

**Visuals:** existing `request-response.jpg` and `sync-based-architecture.jpg`
(plus `.sm.jpg` variants), re-used from `KeyToAdoptionSection`.

**Footer link:** _"Read 'A data primitive for the agent loop' →"_
`/blog/2026/04/08/data-primitive-agent-loop`

**Mobile (≤768):** cards stack vertically. Already handled by existing
component's `@media (max-width: 768px)` rule.

**Components:**

- _Re-skin_: existing `KeyToAdoptionSection.vue` — strip its `--padding-*`
  block, swap `var(--vp-c-bg-soft)` for `var(--ea-surface)` and
  `var(--vp-c-divider)` for `var(--ea-divider)`. Drop the `Section`-level
  CTA buttons (now redundant with section-footer link).

---

## Section 7 — "Scales like the web" _(proof point)_

**Layout:** light band, prose left, chart right (mirrors EA "Scale to
zero" section's `ea-scale-layout`).

**Section title:** _"Scales like the web"_
**Subtitle:** _"It's just HTTP. The internet already knows how to deliver
it."_

```
┌─ Prose ─────────────────────────────┐  ┌─ ScalabilityChart ────────────────────┐
│                                      │  │                                       │
│  ## Scales like the web              │  │   80 Gbps ┐         ┌──────           │
│                                      │  │           │        ╱                  │
│  Electric serves shape changes as    │  │           │      ╱                    │
│  plain HTTP responses. That means    │  │           │    ╱                      │
│  your existing CDN, edge cache, and  │  │           │  ╱                        │
│  load balancers just work.           │  │           │╱                          │
│                                      │  │   0 Gbps  └──────────────────────     │
│  Latency stays flat. Memory stays    │  │           0       1M concurrent users │
│  flat. Cost stays low.               │  │                                       │
│                                      │  │   ─────  latency (ms)   flat ✓        │
│  Sync to a thousand devices, or a    │  │   ─────  memory  (MB)   flat ✓        │
│  million. Same architecture.         │  │                                       │
│                                      │  │  See the benchmarks →                 │
└──────────────────────────────────────┘  └───────────────────────────────────────┘
```

**Detail line under prose (smaller, muted):**
_"Up to 80 Gbps to a million concurrent users from a single commodity
Postgres."_

**Footer link:** _"Read the benchmarks →"_ `/docs/sync/reference/benchmarks`

**Mobile (≤768):** stack prose above chart. Chart scales to single-column.

**Components:**

- _Direct lift_: `ScalabilityChart.vue`. Wrap in `var(--ea-surface)` panel
  with hairline border to match EA chrome.

---

## Section 8 — "Four things you get for free" **[CUT-CANDIDATE]**

> Currently the weakest section in the spine. Repeats themes from
> Sections 4 (fan-out → resilience) and 6 (collab). Marked as the first
> to drop in the editing pass — but kept here in v2 because the user
> asked for an overbuild.

**Layout:** light band, 2×2 grid of hairline cards (re-uses the
`BestWayToBuildSection.vue` 4-panel grid).

**Section title:** _"Four things you get for free"_
**Tagline (re-framed to escape the redundancy charge):**
_"Adopt the shape primitive. Get every other local-first concern thrown in."_

```
┌── ⚡ Super-fast reactivity ─────────────┐  ┌── 📡 Resilient transport ────────────┐
│                                          │  │                                       │
│  Build fast, modern apps like Figma      │  │  Build apps that work reliably, even  │
│  and Linear. With sub-millisecond        │  │  with patchy connectivity. Resilient  │
│  reactivity and instant local writes.    │  │  transport ensures data is never      │
│                                          │  │  lost.                                │
│  ─────────────────────────────────────   │  │  ─────────────────────────────────────│
│  Read more →                             │  │  Read more →                          │
└──────────────────────────────────────────┘  └───────────────────────────────────────┘

┌── 👥 Real-time collaboration ───────────┐  ┌── 💾 Durable state ──────────────────┐
│                                          │  │                                       │
│  Build multi-user, multi-agent apps      │  │  Build multi-step agentic workflows   │
│  that naturally support both real-time   │  │  that resume after failures. Agents   │
│  and asynchronous collaboration.         │  │  and workers sync and resume from     │
│                                          │  │  durable state.                       │
│  ─────────────────────────────────────   │  │  ─────────────────────────────────────│
│  Read more →                             │  │  Read more →                          │
└──────────────────────────────────────────┘  └───────────────────────────────────────┘
```

Each card links to a relevant blog post (already wired up in
`BestWayToBuildSection.vue`).

**Why cut?** The four claims here are all _consequences_ of the shape
primitive — and the page already argues for each one in dedicated
sections (3, 4, 6, plus implicit in 5). This section restates them as a
parallel features list, which weakens the cumulative argument.

**Why keep (for now)?** It's a familiar marketing pattern, it links to
4 blog posts that drive depth-of-engagement, and it gives the page
a visually rhythmic 2×2 in the middle.

**If kept, mobile (≤768):** grid collapses to single column (already
handled).

**Components:**

- _Re-skin_: `BestWayToBuildSection.vue` — swap card chrome to EA
  hairlines, drop the `Section`-level CTA buttons.

---

## Section 9 — "Works with your stack" _(dark band — architecture summary)_

> Replaces the EA "Your stack, not ours" section. The architecture story,
> told in code.

**Layout:** dark band, three-column visual (re-uses `WorksWithSection.vue`
verbatim, re-skinned).

**Section title:** _"Works with your stack"_
**Tagline:** _"Any web framework, any client, any deployment that speaks
HTTP and JSON."_

```
┌── Your data ──────────────┐  ┌── Your stack ─────────────────┐  ┌── Your app ───────────────┐
│                            │  │                                │  │                            │
│  ⚡ Database sync          │  │   🔐 Auth                      │  │  🅣  Live data             │
│  ┌─────────────────────┐   │  │   ┌─────────────────────────┐  │  │  ┌─────────────────────┐   │
│  │ SELECT id, name,    │   │  │   │   With your API         │  │  │  │ const { data } =    │   │
│  │   completed         │   │  │   └─────────────────────────┘  │  │  │   useLiveQuery(q =>│   │
│  │ FROM todos          │   │  │                                │  │  │   q.from({ todos })│   │
│  │ WHERE user_id = $1; │   │  │   ✏️  Write                    │  │  │   .where(t =>      │   │
│  └─────────────────────┘   │  │   ┌─────────────────────────┐  │  │  │     eq(t.done, 0)) │   │
│  ┌────────────────────┐    │  │   │   Through your backend  │  │  │  │   .orderBy(...)    │   │
│  │ 📡 Real-time stream│    │  │   └─────────────────────────┘  │  │  │  )                 │   │
│  │   stream.subscribe…│    │  │                                │  │  │                    │   │
│  └────────────────────┘    │  │   📦 Middleware                │  │  │ <ul>               │   │
│                            │  │   ┌─────────────────────────┐  │  │  │  {data.map(t =>   │   │
│       Your data            │  │   │   It's just HTTP & JSON │  │  │  │    <li>{t.text}</…│   │
│  (Postgres dominant,       │  │   └─────────────────────────┘  │  │  │  )}                │   │
│   Streams secondary)       │  │            Your stack          │  │  │ </ul>              │   │
│                            │  │                                │  │  └─────────────────────┘   │
│                            │  │                                │  │            Your app        │
└────────────────────────────┘  └────────────────────────────────┘  └────────────────────────────┘
```

**Decision:** keep the Streams data source as a smaller secondary tile
(reinforces composable-family story; pairs with Section 13's cross-sell)
but make Postgres dominant — full-height vs. Streams as a smaller pip.

**Mobile (≤768):** existing component already handles 1- and 2-column
collapse. Reorder: Your data → Your app → Your stack so the code panels
flank the abstraction.

**Components:**

- _Re-skin_: `WorksWithSection.vue` — swap `var(--vp-c-bg-soft)` panels for
  EA hairline cards, change panel `border-radius` from 12px to 8px,
  swap divider color, tighten padding. Adjust column 1 to make the
  Postgres panel dominant. No template changes beyond panel sizing.

---

## Section 10 — "Managed cloud, open source" _(Cloud strip)_

> Single hairline strip. Doesn't try to compete with `/cloud` — just
> signposts to it.

**Layout:** light band, single full-width strip with two-pane window
(mirrors the agents-page support card aesthetic from `pricing.md`).

**Section title:** _"Managed cloud, open source"_
**Tagline:** _"Vendor agnostic, infra agnostic."_

```
┌─ Electric Cloud ─────────────────────┬─ Self-host ────────────────────────────┐
│                                       │                                         │
│  ⚡ Electric Cloud                    │   📂 Open source                        │
│                                       │                                         │
│  Scalable, turnkey hosting with       │   Apache 2.0. Run Electric on your      │
│  usage-based pricing. Skip the ops.   │   own infrastructure — Docker, k8s,     │
│                                       │   bare metal. Self-host the same        │
│  ┌──────────────┐                     │   binaries Electric Cloud runs.         │
│  │  Sign up →   │                     │                                         │
│  └──────────────┘                     │   ┌──────────────────┐                  │
│                                       │   │  Deployment guide │                 │
│                                       │   └──────────────────┘                  │
└───────────────────────────────────────┴─────────────────────────────────────────┘
```

**Mobile (≤768):** two panes stack vertically with horizontal divider
between them.

**Components:**

- _Re-skin_: `DeploymentSection.vue` — convert from `card primary +
secondary-grid` layout to two-pane window with vertical divider, matching
  the pricing-page support-card pattern. Drop the secondary "Local
  development" card (covered by Section 11's CTA).

---

## Section 11 — "Your first sync in 10 lines" _(try it)_

> Direct translation of EA Section 9 (annotated code). Concrete code-and-CLI
> moment to convert technical readers.

**Layout:** light band, left column = stacked code panel + terminal panel,
right column = numbered annotations list (re-uses `.ea-annotated-code`
layout).

**Section title:** _"Your first sync in 10 lines"_
**Subtitle:** _"Define a shape. Subscribe with a live query. Sync in real
time."_

**Code-sample decision:** **TanStack DB**, per `AGENTS.md`'s recommended
stack. Pure `ShapeStream` would be more "purely Sync" but TanStack DB is
how most users actually adopt Sync, and the code is more readable.

```
┌── app.tsx ─────────────────────────────────────┐   ┌── Annotations ─────────────┐
│ import { createCollection }       from         │   │ ① Pick a table             │
│   '@tanstack/react-db'                         │   │   The collection is your   │
│ import { electricCollectionOptions }           │   │   reactive client store.   │
│   from '@tanstack/electric-db-collection'      │   │                            │
│                                                │   │ ② Point at your shape     │
│ export const todoCollection = createCollection │   │   The proxy on your        │
│   (electricCollectionOptions({                 │   │   backend chooses the      │
│     id: 'todos',                              ① │   │   table + WHERE clause.   │
│     getKey: (row) => row.id,                   │   │                            │
│     shapeOptions: { url: '/api/todos' },      ② │   │ ③ Query reactively         │
│     onInsert: ({ transaction }) => …,         ③ │   │   useLiveQuery returns    │
│   }))                                          │   │   sub-millisecond updates  │
│                                                │   │   from differential        │
│ function TodoList() {                          │   │   dataflow.                │
│   const { data } = useLiveQuery((q) =>        ④ │   │                            │
│     q.from({ todo: todoCollection })           │   │ ④ Filter, sort, join       │
│      .where(({ todo }) => eq(todo.done, false))│   │   The local query engine   │
│      .orderBy(({ todo }) => todo.created_at))  │   │   handles it. No round-    │
│   return <List items={data} />                 │   │   trips.                   │
│ }                                              │   │                            │
└────────────────────────────────────────────────┘   │ ⑤ Run the dev server       │
                                                    │                            │
┌── Terminal ────────────────────────────────────┐   │ ⑥ Mutate in Postgres        │
│ $ pnpm dev                                  ⑤  │   │   Open psql and update    │
│ ✓ Electric sync up at http://localhost:3000    │   │   any row.                 │
│                                                │   │                            │
│ $ pnpm psql                                 ⑥  │   │ ⑦ Watch the UI update      │
│ # UPDATE todos SET done = true WHERE id = 1;   │   │   In real time, across     │
│ UPDATE 1                                       │   │   every open client.       │
│                                                │   │                            │
│ ─ in another tab ────────────────────────── ⑦  │   │                            │
│ ✓ todos[1].done → true   (synced 14ms)         │   │                            │
└────────────────────────────────────────────────┘   └────────────────────────────┘

                       ┌─────────────┐  ┌─────────────┐
                       │ Quickstart  │  │ Read Docs   │
                       └─────────────┘  └─────────────┘
```

**CTAs at bottom (centered):**

- `Quickstart` (brand) → `/docs/sync/quickstart`
- `Read the Docs` (alt) → `/docs/sync`

**Mobile (≤768):** annotations move below the code panel; numbered markers
in code remain visible. Already handled by EA's `.ea-annotated-code`
collapse.

**Components:**

- _Re-skin_: copy-and-adapt `.ea-annotated-code` block from
  `HomePage.vue` (Agents). Swap the code body for the Sync sample.

---

## Section 12 — "What people build" _(dark band — demo strip)_

> Adds visual life to the page. Three strongest demos as social proof
> for the technical claims above.

**Layout:** dark band, 3-card grid using existing `DemoListing.vue`.

**Section title:** _"What people build"_
**Tagline:** _"Real apps shipped on Sync. Every demo is open source —
fork it, run it, learn from it."_

```
┌── LinearLite ──────────────┐  ┌── AI Chat ─────────────────┐  ┌── Burn ────────────────────┐
│                             │  │                             │  │                             │
│  [linearlite-listing.jpg]   │  │  [ai-chat-listing.jpg]      │  │  [burn-listing.jpg]         │
│                             │  │                             │  │                             │
│  ## LinearLite              │  │  ## AI Chat                 │  │  ## Burn                    │
│                             │  │                             │  │                             │
│  A Linear-style issue       │  │  Multi-user, multi-agent    │  │  Real-time multiplayer      │
│  tracker. Real-time sync,   │  │  AI chat with TanStack DB   │  │  game shipped on sync.      │
│  optimistic writes.         │  │  and Electric.              │  │                             │
│                             │  │                             │  │                             │
│  ┌─────────┐  ┌─────────┐   │  │  ┌─────────┐  ┌─────────┐   │  │  ┌─────────┐  ┌─────────┐   │
│  │  Open   │  │ Source  │   │  │  │  Open   │  │ Source  │   │  │  │  Open   │  │ Source  │   │
│  └─────────┘  └─────────┘   │  │  └─────────┘  └─────────┘   │  │  └─────────┘  └─────────┘   │
└─────────────────────────────┘  └─────────────────────────────┘  └─────────────────────────────┘

                              All demos →  /sync/demos
```

**Demos to feature** (open to your call — picked for variance):

- **LinearLite** — proves apps-like-Linear-style use case
- **AI Chat** — proves multi-user/multi-agent claim
- **Burn** — proves real-time fan-out (multiplayer)

Footer link: _"See all demos →"_ `/sync/demos`

**Mobile (≤768):** 3-card grid collapses to single column. `DemoListing`
component already does this.

**Components:**

- _Direct lift_: `DemoListing.vue` × 3, populated via `data/demos.data.ts`.
  Pull the three demos by slug.
- May need a small `<DemoStrip>` wrapper component (~30 lines) to handle
  the grid + section header.

---

## Section 13 — "Compose your sync stack" _(cross-sell)_

> Closing cross-sell. Drops Postgres Sync (the page is the Sync page) and
> shows the three siblings.

**Layout:** light band, three-card grid (re-uses `ProductsGrid.vue` with a
filtered list).

**Section title:** _"Compose your sync stack"_
**Tagline:** _"Sync is one of four primitives in the Electric stack. Each
solves a different layer of the local-first problem."_

```
┌── 📡 Durable Streams ─────┐  ┌── 🅣  TanStack DB ────────┐  ┌── 🐘 PGlite ──────────────┐
│                            │  │                            │  │                            │
│  The data primitive        │  │  Reactive client store     │  │  Embeddable Postgres       │
│  for the agent loop.       │  │  for super-fast apps.      │  │  with reactivity and sync. │
│                            │  │                            │  │                            │
│  ───────────────────────   │  │  ───────────────────────   │  │  ───────────────────────   │
│                            │  │                            │  │                            │
│  For building resilient,   │  │  For sub-millisecond       │  │  A full database inside    │
│  collaborative multi-      │  │  reactivity and instant    │  │  your client or runtime.   │
│  agent systems.            │  │  writes.                   │  │                            │
│                            │  │                            │  │                            │
│  /streams →                │  │  /sync/tanstack-db →       │  │  /sync/pglite →            │
└────────────────────────────┘  └────────────────────────────┘  └────────────────────────────┘
```

**Mobile (≤768):** existing `ProductsGrid` collapses to 2-col then 1-col.

**Components:**

- _Re-skin_: `ProductsGrid.vue` — accept a `:filter` prop (or pass a
  pre-filtered list) so we can exclude `postgres-sync`. Switch grid from
  `repeat(4, 1fr)` to `repeat(3, 1fr)`.

---

## Section 14 — "Used by" + "Get started"

**Layout:** light band, logos at top, CTA strap below. Combines what was
two sections in v1 to keep the close tight.

```
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│   [Logo]   [Logo]   [Logo]   [Logo]   [Logo]   [Logo]   [Logo]   [Logo]│
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│                          Get started                                    │
│                                                                         │
│   Start with the Quickstart. Dive deeper with the Docs and Demos.       │
│                                                                         │
│       ┌──────────────┐  ┌──────────┐  ┌──────────┐                      │
│       │  Quickstart  │  │   Docs   │  │  Demos   │                      │
│       └──────────────┘  └──────────┘  └──────────┘                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

- `Quickstart` → `/docs/sync/quickstart` (brand)
- `Docs` → `/docs/sync` (alt)
- `Demos` → `/sync/demos` (alt)

**Mobile (≤768):** CTA buttons stack vertically.

**Components:**

- _Direct lift_: `UsedBySection.vue` and `NextStepsSection.vue` —
  already exist. Just update CTA hrefs to point at `/docs/sync/*`.

---

## Build inventory

### Direct lift (no changes)

- `UsedBySection.vue` (Section 14)
- `NextStepsSection.vue` (Section 14, just update hrefs)
- `request-response.jpg` + `sync-based-architecture.jpg` (already in repo)
- `DemoListing.vue` × 3 (Section 12)
- `ScalabilityChart.vue` (Section 7, just wrap in EA card)

### Re-skin to EA hairline aesthetic (CSS-only, sometimes one prop)

- `KeyToAdoptionSection.vue` → Section 6
- `BestWayToBuildSection.vue` → Section 8
- `WorksWithSection.vue` → Section 9
- `DeploymentSection.vue` → Section 10 (heavier — restructure to two-pane)
- `ProductsGrid.vue` (add `:filter` prop) → Section 13
- `PartialReplicationDiagramme.vue` → Section 4 (if expressive enough)

### New build

| Component                  | Section | Approx. lines | Risk |
| -------------------------- | ------- | ------------- | ---- |
| `<SyncFanOutBg>`           | 1       | ~80           | Low  |
| `<MultiClientPulseDemo>`   | 2       | ~120          | Low  |
| `<ShapeCarveDemo>`         | 3       | ~250          | Med  |
| `<FanOutDiagram>` (maybe)  | 4       | ~150          | Low  |
| 4-tile writes ladder       | 5       | ~80           | Low  |
| `<DemoStrip>` wrapper      | 12      | ~30           | Low  |
| `SyncHomePage.vue` wrapper | (all)   | ~40           | Low  |

Largest risk is `<ShapeCarveDemo>`. Everything else is mechanical.

### Routing / config

- `/sync/index.md` → swap frontmatter to `pageClass: sync-page`, replace
  body with `<SyncHomePage />`.
- `custom.css` → add `.sync-page .VPNavBar { border-bottom: 0 }` rule
  alongside existing `.ea-homepage` rule (or generalise to
  `.no-nav-divider`).

---

## Open design questions

1. **Hero headline:** A / B / C above. Recommendation: A.
2. **Hero background:** new fan-out lines (suggested) or reuse the EA
   mesh for maximum family resemblance?
3. **Section 4 visual:** re-use `PartialReplicationDiagramme.vue` (cheap)
   or new `<FanOutDiagram>` (more expressive of fan-out specifically)?
4. **Section 8 keep or cut:** marked as cut-candidate; explicit user call
   needed.
5. **Section 9 — Streams panel:** keep as a smaller secondary tile
   (recommended) or drop entirely?
6. **Section 11 code sample:** TanStack DB (recommended, idiomatic) or
   vanilla `ShapeStream` (purer Sync)?
7. **Section 12 demo selection:** LinearLite + AI Chat + Burn proposed —
   any other demos you'd swap in? (Notes, Pixel Art, Territory Wars,
   Write Patterns are also strong candidates.)
8. **OS signal in hero:** static "★ 9.5k on GitHub" or live count?
9. **Footer link in each section:** keep "Read more →" links per section
   (recommended — gives the page depth-of-engagement) or trust the
   closing CTA strap to carry navigation?

---

## Suggested order of build

1. **Wireframe pass** — `SyncHomePage.vue` shell with placeholders for
   new components, all re-skinned existing components dropped in to
   validate flow before committing to any new visuals.
2. **Re-skin pass** — sweep existing components to EA hairlines (one PR,
   mechanical CSS change). Tackle `DeploymentSection.vue` separately as
   it needs structural change.
3. **Section 5 writes-ladder** — small new build, smooths a known
   confusion point, low risk.
4. **`<MultiClientPulseDemo>`** — Section 2 visual, CSS-only animation.
5. **`<ShapeCarveDemo>`** — biggest new build, biggest payoff.
6. **`<SyncFanOutBg>`** — small but sets the hero tone.
7. **`<DemoStrip>` + Section 12 wiring** — one wrapper + 3 `DemoListing`s.
8. **Polish + responsive sweep** — test all sections at the EA breakpoints
   (480 / 518 / 768 / 959 / 1019 / 1099 / 1280).
9. **Editing pass** — re-evaluate Section 8; trim any section that
   doesn't earn its place once the page is assembled.
