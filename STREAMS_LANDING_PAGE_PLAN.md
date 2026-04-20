# Durable Streams — landing page plan (`/streams`)

> Working spec for the new Durable Streams landing page. Mirrors the visual
> language of the Electric Agents landing page (centered hero, alternating
> prose/visual sections, dark "bands" to break things up, hairline borders,
> monospace install prompt, numbered code annotations).
>
> **Approach:** overbuild now, edit down later. Sibling page to
> `/agents` and `/sync`.
> **Reuse policy:** every section calls out whether it is a _direct lift_,
> a _re-skin_ of an existing component, or _new build_.
>
> **Chosen narrative trunk:** Proposal A ("the data primitive for the agent
> loop") with Proposal B's architectural meat (3-properties cards,
> layer-drop-down demo, integrations grid) and Proposal C's auto-playing
> terminal hook spliced in as Section 3.

---

## Page-level decisions

- **Layout:** `layout: page` with `pageClass: ds-homepage` (parallel to
  `ea-homepage` on Agents and `sync-page` on Sync, so the navbar
  bottom-divider hide rule applies consistently).
- **Hero chrome:** new `<StreamFlowBg>` background — flowing tokens along
  faint horizontal "rails" that occasionally branch off to consumer dots.
  Distinct from the Agents network mesh and the Sync fan-out.
- **Token palette:** uses the existing `--ea-*` tokens — no new tokens
  needed. Brand teal `var(--vp-c-brand-1)` for accents. Producer = brand;
  Consumer = `--ea-text-2` desaturated.
- **Type scale:** identical to Agents page (`56px` hero name, `28px`
  section titles, `17px` prose, `15px` detail).
- **Vertical rhythm:** alternates light → dark, mirroring Agents.
- **Cross-product links:** hero tagline links _back_ to `/agents`
  ("the substrate underneath Electric Agents") and `/sync`
  ("paired with Electric Sync for Postgres-backed apps").
- **Naming:** branded as **Durable Streams** (the OSS protocol /
  open standard) with a small "An Electric product" eyebrow above
  the hero name. Avoids the "Electric Streams" overload.

```
Section                       Mode    Pattern
──────────────────────────────────────────────────────────────────────
1   Hero                      light   centered hero + install prompt
2   Streaming needs to be     light   prose-left  / demo-right
    durable
3   30-second tour            dark    full-bleed auto-playing terminal
4   Three properties          light   3-card row
5   Append-only, exactly-once dark    demo-left   / text-right
6   Polyglot consumers        light   full-bleed signature visual
7   Layered protocol stack    dark    demo-left   / text-right
8   Drop a layer when needed  light   full-bleed signature visual
9   Cache it on a CDN         dark    text-left   / demo-right
10  Durable Sessions          light   full-bleed showcase     [NEW]
11  Built for the AI loop     light   integrations grid (4-up)
12  Your stack, not ours      dark    diagram + tabbed code
13  Your first stream, end    light   annotated code + CLI + CTAs
    to end
14  What people build         dark    3-up demo strip         [NEW]
15  Compose your stack        light   3-up cross-sell grid    [NEW]
16  Used by + Get started     light   logos + CTA strap       [NEW]
```

> **Rhythm note:** §10 and §11 are both light, mirroring the Agents
> page's twin-light opening (`#hero` + `#come-online`). §15 and §16 are
> both light to keep a tight, single-band close (mirrors the Sync plan).

---

## Section 1 — Hero

**Layout:** centered, `padding: 100px 24px 80px` (matches `.ea-hero`).
**Background:** new `<StreamFlowBg>` component — faint horizontal
"rails" of glyphs/dots flowing left-to-right, occasionally branching
off to small consumer markers. Brand-teal at very low opacity.
Distinguishes from the Agents `HeroNetworkBg` mesh and the Sync
`SyncFanOutBg` radial.

**Copy:**

```
                       An Electric product

                      Durable Streams
                      ───────────────
                The data primitive for the agent loop

   Persistent, addressable, real-time streams over plain HTTP.
   Built for AI sessions, multi-user collaboration and the
   substrate underneath Electric Agents.

              ┌────────────────────────────────────────┐
              │ $ npm i @durable-streams/client     📋 │
              └────────────────────────────────────────┘

                        spec · github · docs
```

- **Eyebrow:** _"An Electric product"_ — small, muted, all-caps.
- **Headline:** `Durable Streams` with brand-teal underline accent on
  "Streams" (mirrors `.ea-hero-underline`).
- **Sub-headline:** _"The data primitive for the agent loop."_
  (Lifted from `quickstart.md`.)
- **Tagline:** _"Persistent, addressable, real-time streams over plain
  HTTP. Built for AI sessions, multi-user collaboration and the
  substrate underneath [Electric Agents](/agents)."_
- **Install prompt:** `npm i @durable-streams/client` with
  copy-to-clipboard. Same chrome as `.ea-hero-install` on Agents.
  Verified package — see `/docs/streams/clients/typescript`.
- **Below install — secondary link row:** small muted links
  _"spec"_ (→ PROTOCOL.md), _"github"_, _"docs"_ (→ `/docs/streams/`).
- **No CTA buttons in the hero** — install prompt is the primary action.
- **Alternative install line** _(open decision)_: lead with
  `curl -X PUT https://api.streams.dev/v1/stream/hello` to emphasise
  the protocol-first nature. Could ship as a small toggle under the
  install pill (`npm` ⇄ `curl`).

**Background animation hint (`<StreamFlowBg>`):**

```
  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·
  ─ ─ ─ ─ ─•─ ─ ─ ─ ─•─ ─ ─ ─ ─ ─ ─ ─•─ ─ ─ ─ ─•─ ─ ─ ─ ─ ──→
                  └──•               └──•                  └──•
       ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·
  ─ ─ ─ ─•─ ─ ─ ─ ─ ─ ─•─ ─ ─ ─ ─•─ ─ ─ ─ ─ ─ ─•─ ─ ─ ─ ─ ──→
            └──•                                └──•
```

3–5 horizontal rails. Each rail emits a "token" (small dot) every
~600ms. Tokens move left-to-right. Occasionally a rail branches
downward to a "consumer" marker that pulses briefly, then fades.
Brand-teal at 8–12% opacity on light, 14–18% on dark.

**Components:**

- _New build:_ `<StreamFlowBg>` — small SVG/canvas, ~120 lines, mirrors
  the structural pattern of `<HeroNetworkBg>`.
- _Direct lift:_ install-prompt block from `HomePage.vue` (Agents).
- _Re-skin:_ `.ea-hero-*` styles, no structural changes.

---

## Section 2 — "Streaming needs to be durable"

> The page's emotional hook. Names the pain that Durable Streams solves.
> Mirrors the Agents page's "Agents need to come online" section
> (`#come-online`).

**Layout:** light band. Prose-left (`flex: 1`) / demo-right (`flex: 1`,
`max-width: 520px`). Mirrors `.ea-come-online`.

**Section title:** _"Streaming needs to be durable"_

**Prose (3 paragraphs, max-width 640px):**

> _Today's streaming APIs are fragile. SSE drops on a refresh. Tokens
> get lost on flaky networks. Resuming means re-running the entire
> request and re-billing the LLM._
>
> _Real applications need streams to be **durable, addressable and
> shareable**. They need to survive disconnects, persist across
> sessions, and let multiple users — and agents — read and write the
> same conversation._
>
> **\*Durable Streams** is the protocol for that. Append-only,
> URL-addressable streams over plain HTTP. Resumable from any offset.
> Cacheable on any CDN. Powering the agent loop, multiplayer collab,
> and the read-path for Electric Sync.\*

**Visual — `<ConnectionDropDemo>` (new build):**

```
┌─ Without Durable Streams ────────────────┐
│                                          │
│  POST /v1/chat/completions               │
│  ────────────────────────                │
│  ▶ The capital of                        │
│  ▶ France is Pa  ✕  connection lost      │
│                                          │
│  ⤴ retry                                 │
│  POST /v1/chat/completions   …re-bills   │
│  ▶ The capital of                        │
│  ▶ France is Paris.                      │
│                                          │
└──────────────────────────────────────────┘

┌─ With Durable Streams ───────────────────┐
│                                          │
│  POST /v1/stream/chat-42                 │
│  ────────────────────────                │
│  ▶ The capital of                        │
│  ▶ France is Pa  ✕  connection lost      │
│                                          │
│  ⤴ resume                                │
│  GET  /v1/stream/chat-42?offset=7        │
│  ▶ ris.                                  │
│                                          │
│  ✓ exactly-once, no extra LLM call       │
│                                          │
└──────────────────────────────────────────┘
```

- **Animation hint:** loops on a ~6s timer. Top card streams 3–4 token
  chunks, drops, retries (re-streams from scratch). Bottom card streams
  the same chunks, drops, then resumes from the offset and only the
  missing tokens stream in. The "✓ exactly-once" line fades in last.
- **Static-fallback:** for `prefers-reduced-motion`, render both cards
  in their final state with no token animation.
- **Token style:** monospace, brand-teal for newly-streamed tokens,
  `--ea-text-1` once "settled."

**Components:**

- _New build:_ `<ConnectionDropDemo>` — pure CSS + small JS for the loop
  cycle, ~180 lines. Cousin of `<CrashRecoveryDemo>`.
- _Re-skin:_ layout class equivalent to `.ea-come-online`.

---

## Section 3 — "30-second tour" _(dark band)_

> The page's "I get it now" moment. Lifts the curl quickstart from
> `/docs/streams/quickstart` into an auto-playing terminal panel.
> Spliced in from Proposal C — gives engineers a working mental model
> before any further prose.

**Layout:** dark band, full-width signature. Centered terminal panel
with playback controls underneath.

**Section title:** _"The 30-second tour"_
**Subtitle:** _"Five curl commands. From zero to a live stream you can
tail across the network."_

**Visual — `<QuickstartPlaybackDemo>` (new build):**

```
┌─ Terminal ─────────────────────────────────────────────────────────┐
│                                                                    │
│  $ ./durable-streams-server dev                                    │
│  ✓ Listening on http://localhost:4437                              │
│                                                                    │
│  $ curl -X PUT http://localhost:4437/v1/stream/hello \             │
│        -H 'Content-Type: text/plain'                               │
│  ✓ 201 Created                                                     │
│                                                                    │
│  $ curl -X POST http://localhost:4437/v1/stream/hello \            │
│        -H 'Content-Type: text/plain' \                             │
│        -d 'Hello, Durable Streams!'                                │
│  ✓ 200 OK   Stream-Next-Offset: 01JQXK5V00                         │
│                                                                    │
│  $ curl "http://localhost:4437/v1/stream/hello?offset=-1"          │
│  Hello, Durable Streams!                                           │
│                                                                    │
│  $ curl -N "http://localhost:4437/v1/stream/hello?offset=-1\       │
│              &live=sse"                                            │
│  data: Hello, Durable Streams!                                     │
│  data: ▍                                                           │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
        ◀◀   ▶   ▮▮   ▶▶                              0:18 / 0:30
```

- **Animation hint:** the terminal types each command character-by-
  character, then types a brief `…` while the response "loads," then
  prints the response. After the final SSE command, a blinking cursor
  remains visible. Loop after 1s pause.
- **Playback controls:** asciinema-style chrome under the terminal —
  restart, play/pause, scrubber, time elapsed. Click anywhere on the
  terminal to pause.
- **Two callouts** — small annotations to the right of specific lines
  (only visible at `≥ md`):
  - Next to `?offset=-1` — _"`-1` = beginning of stream"_
  - Next to `Stream-Next-Offset` — _"Save this header to resume from
    exactly here later."_
- **Static-fallback:** for `prefers-reduced-motion` show the full
  terminal as static text.

**Footer link under the terminal (small, centered):**
_"Run this yourself → `/docs/streams/quickstart`"_

**Components:**

- _New build:_ `<QuickstartPlaybackDemo>` — typewriter-style component
  driven by a JSON script `[ { type, text, delay } ]`. Reuses
  `.cli-body` / `.cli-prompt` / `.cli-line` / `.cli-output` styles
  from Agents page. ~200 lines. The script is shared with
  `/docs/streams/quickstart` so updates land in one place.

---

## Section 4 — "Three properties that change everything"

> Crystallises _why_ the protocol shape matters. Lifted from Proposal B
> §3 — three hairline cards in a row, monospace icons, no shadows.

**Layout:** light band, 3-up grid (collapses to 1-up on mobile).
Card chrome borrows from `.ea-problem-card`.

**Section title:** _"Three properties that change everything"_
**Tagline:** _"Durable Streams is a protocol, not a SaaS. The protocol
is the product."_

```
┌── { url } ─────────────────────┐ ┌── ▤ append-only ──────────────┐ ┌── ↻ resumable ─────────────────┐
│                                │ │                                │ │                                │
│  URL-addressable               │ │  Append-only                   │ │  Resumable                     │
│                                │ │                                │ │                                │
│  Every stream lives at its own │ │  Once data is at an offset,    │ │  Reads return                  │
│  URL. Works with curl, fetch,  │ │  it never changes. Offsets     │ │  Stream-Next-Offset.           │
│  any load balancer, any CDN.   │ │  are opaque,                   │ │  Reconnect with                │
│                                │ │  lexicographically sortable    │ │  ?offset=… — exactly once,     │
│                                │ │  cursors.                      │ │  zero state on the client.     │
│                                │ │                                │ │                                │
│  PUT   /v1/stream/hello        │ │  POST  → 200 OK                │ │  GET ?offset=01JQXK5V00        │
│  POST  /v1/stream/hello        │ │        Stream-Next-Offset:     │ │      → next chunk only         │
│  GET   /v1/stream/hello        │ │           01JQXK5V00           │ │                                │
│                                │ │                                │ │                                │
└────────────────────────────────┘ └────────────────────────────────┘ └────────────────────────────────┘
```

- Each card has:
  - Monospace title row: `{ url }` / `▤ append-only` / `↻ resumable`
    (icon glyph + label, `--vp-c-brand-1`).
  - Bold one-line claim.
  - 2–3 line elaboration.
  - A monospace mini snippet at the bottom in a sub-panel
    (`var(--ea-surface-alt)`).
- **No "read more" links.** This section is a statement, not a gateway.

**Components:**

- _New build:_ `<ThreePropertiesGrid>` — ~120 lines, pure CSS grid.
  Card chrome derived from `.ea-problem-card`.

---

## Section 5 — "Replay from any offset, exactly once" _(dark band)_

> The reliability story, told visually. Mirrors Agents §4 (`#durable-state`,
> `<CrashRecoveryDemo>`).

**Layout:** dark band. Demo-left (`flex: 1`) / text-right (`flex: 1`).
Mirrors `.ea-durable-layout`.

**Section title:** _"Replay from any offset, exactly once"_
**Subtitle:** _"Producers identify themselves with three headers.
Servers de-dupe. Clients resume from the last offset they saw. No
external coordination required."_
**Detail line (smaller, muted):** _"`Producer-Id`, `Producer-Epoch`,
`Producer-Seq` — the entire idempotency story is on the wire."_

**Visual — `<OffsetReplayDemo>` (new build):**

```
   producer                  durable streams                consumer
   ┌───────┐                ┌───────────────┐              ┌────────┐
   │       │  POST  ▶▶▶▶▶▶  │ ▤▤▤▤▤▤        │  GET ?off=… │        │
   │  svc  │                │ ▤▤▤▤▤▤        │  ─────────▶ │ client │
   │       │                │ ▤▤▤▤▤▤        │             │        │
   └───────┘                └───────────────┘              └───┬────┘
       │                            │                          │
       │   Producer-Id: svc-1       │                          │
       │   Producer-Epoch: 2        │                          │
       │   Producer-Seq: 17         │            ── connection drops ──
       │                            │
       ▼                            ▼                          │
   ─ retry ─                  (server de-dupes)                ▼
       │                            │                ┌──────────────────┐
       │   Producer-Seq: 17  ──────▶│  duplicate     │   ?offset=last   │
       │                            │  ✗ ignored     │   ─────────────▶ │
       │                            │                │   ✓ resume from  │
       │   Producer-Seq: 18  ──────▶│  ✓ stored      │     exactly that │
       │                            │                │     point        │
                                                     └──────────────────┘
```

- **Animation hint:** runs on a ~10s loop in 3 phases:
  1. Producer posts 3 chunks. Stream fills left-to-right. Consumer
     reads them, "Stream-Next-Offset" updates each time.
  2. Producer retries Seq=17 (network blip). Server responds with a
     red ✗ and the "duplicate" callout pulses. Stream length
     unchanged.
  3. Consumer drops, then reconnects with `?offset=last`. Only the
     new chunk streams to it; a green ✓ pulses on the consumer.
- **Static-fallback:** show the diagram in its final state with the
  ✓/✗ markers static.

**Footer link under the text column:** _"Read the protocol →"_
`/docs/streams/concepts#producers`

**Components:**

- _New build:_ `<OffsetReplayDemo>` — animated SVG, ~250 lines. Cousin
  of `<CrashRecoveryDemo>`.

---

## Section 6 — "It's just HTTP — works everywhere"

> The polyglot story. **Reframed as a horizontal "lineup" rather than a
> top-down fan-out**, so it reads visibly different from §9 (CDN fan-out)
> and emphasises _language/runtime variety_ rather than _one-to-many
> distribution_.

**Layout:** light band, full-width signature. A single stream URL banner
runs across the top; five client cards are arranged horizontally
underneath, each with its own code snippet. Mobile collapses to a
vertical stack.

**Section title:** _"It's just HTTP — works everywhere"_
**Tagline:** _"If your runtime can speak HTTP, it can read and write a
Durable Stream. No SDK lock-in, no proprietary transport. No WebSocket
infrastructure."_

**Visual — `<PolyglotLineup>` (new build):**

```
   ╔═══════════════════════════════════════════════════════════════════╗
   ║   GET https://api.streams.dev/v1/stream/chat-42?live=sse          ║
   ║   ────────────────────────────────────────────────────────────    ║
   ║   data: {"role":"user","text":"Hello"}                            ║
   ║   data: {"role":"assistant","text":"Hi there!"}    ▍              ║
   ╚═══════════════════════════════════════════════════════════════════╝
                                   │
                    one stream URL, all of these clients
   ─────────────────────────────────────────────────────────────────────

  ┌─ TypeScript ──┐ ┌─ Python ───┐ ┌─ Swift ────┐ ┌─ Go ──────┐ ┌─ curl ───┐
  │               │ │            │ │            │ │           │ │          │
  │ import {      │ │ from       │ │ let req =  │ │ resp, _ : │ │ curl -N \│
  │   stream      │ │ durable_   │ │ URLRequest │ │ http.Get( │ │  "$URL?  │
  │ } from '@…/   │ │ streams    │ │ (url:URL!) │ │   url)    │ │   live=  │
  │   client'     │ │ import     │ │            │ │           │ │   sse"   │
  │               │ │ stream     │ │ URLSession │ │ scanner   │ │          │
  │ for await (   │ │            │ │  .shared   │ │  .Scan()  │ │ # prints │
  │   const m of  │ │ with       │ │  .dataTask │ │  → events │ │ # data:  │
  │   stream({…}) │ │  stream(…) │ │  (with:    │ │           │ │ # lines  │
  │ ) render(m)   │ │  as r:     │ │   req)     │ │           │ │          │
  │               │ │   for x in │ │            │ │           │ │          │
  │               │ │   r.iter_  │ │            │ │           │ │          │
  │               │ │    json(): │ │            │ │           │ │          │
  │               │ │     ...    │ │            │ │           │ │          │
  └───────────────┘ └────────────┘ └────────────┘ └───────────┘ └──────────┘
       browser /         data           iOS /          servers,      shell,
       Node /            scientists,    macOS app      AnyCable,     scripts,
       Edge /            workers                       Rails         debugging
       Workers
```

- **Animation hint:** the central stream banner ticks a new SSE event
  every ~1.2s. Each card's snippet briefly highlights its receive line
  (e.g. `for await … render(m)` pulses brand-teal) — a quiet,
  staggered cascade left → right showing all clients pick the same
  event up.
- **Logos:** small monochrome SVG in each card title row (TS, Python,
  Swift, Go, terminal glyph). Use logos from `/img/icons/`; fall back
  to wordmark if no logo exists.
- **Static-fallback:** show the lineup with no animation. The central
  banner shows the two-line SSE response statically.
- **Caption row beneath the cards (small, muted, centered):**
  _"Native client libraries in TypeScript and Python. Anything else
  speaks the protocol directly — no SDK required."_

**Mobile (≤768):** banner stays full-width on top; cards collapse to a
horizontal scroll-snap row (one card per viewport, swipe to advance).

**Components:**

- _New build:_ `<PolyglotLineup>` — flexbox row of 5 cards with
  syntax-highlighted snippets. ~220 lines.
- _Direct lift:_ logo SVGs from `/img/icons/`. Reuses
  `.code-block` chrome from Agents.

---

## Section 7 — "Layered protocol, layered power" _(dark band)_

> The architectural story. The protocol _stack_, not the _product_.
> Combines Proposal A §7 framing with Proposal B's stack visual.

**Layout:** dark band. Demo-left (`flex: 1`) / text-right (`flex: 1`).
Mirrors `.ea-context-layout`.

**Section title:** _"Layered protocol, layered power"_
**Subtitle:** _"Pick the layer you need. Every layer above adds power.
Every layer below adds the option to drop down."_
**Detail line (smaller, muted):** _"Bytes → JSON messages → typed CRUD
events → reactive type-safe DB."_

**Visual — `<LayeredStackDemo>` (new build):**

> Reads top-down (highest abstraction at the top). The animation flows
> top-down too — start with the typed value at the top, "decompose" it
> down through each layer to bytes. Sets up §8's "drop a layer" theme.

```
                       User { name: "Alice" }
                                 │
                                 ▼
   ╔══════════════════════════════════════════════╗
   ║  StreamDB                                    ║   ← typed reactive DB
   ║  schema, queries, optimistic actions         ║      (TanStack DB inside)
   ╚══════════════════════════════════════════════╝
                                 │
                                 ▼
   ╔══════════════════════════════════════════════╗
   ║  Durable State                               ║   ← typed CRUD events
   ║  insert · update · delete · snapshot         ║      MaterializedState
   ╚══════════════════════════════════════════════╝
                                 │
                                 ▼
   ╔══════════════════════════════════════════════╗
   ║  JSON mode                                   ║   ← message boundaries
   ║  array flattening, GET → JSON array          ║      one POST per item
   ╚══════════════════════════════════════════════╝
                                 │
                                 ▼
   ╔══════════════════════════════════════════════╗
   ║  Durable Streams                             ║   ← bytes + offsets
   ║  PUT · POST · GET · HEAD · DELETE            ║      the base protocol
   ╚══════════════════════════════════════════════╝
                                 │
                                 ▼
                            { 48 65 6c 6c 6f }
```

- **Animation hint:** a typed value enters at the top
  (`User { name: "Alice" }`) and falls down through each layer,
  decomposing as it goes:
  - StreamDB: `User { id: "1", name: "Alice" }`
  - State: `{ type: "user", op: "insert", value: {…} }`
  - JSON: `{"event": "click"}`
  - Bytes: `48 65 6c 6c 6f`
    Each layer pulses brand-teal as the token passes through. Loop on a
    6s timer.
- **Hover affordance:** hovering a layer expands a small popover with
  one extra sentence + a "Read more" link to the relevant doc.
- **Static-fallback:** show all four layers stacked, with the token in
  its bytes form at the bottom.

**Side text column copy:**

> Durable Streams is a layered protocol. The base layer is just bytes
> over HTTP. Each layer above turns those bytes into something more
> structured — JSON messages, typed CRUD events, then a fully reactive,
> type-safe database.
>
> You can stop at any layer that fits your problem. And because every
> layer is just a convention on top of the one below, you can always
> drop down to read the raw stream when you need to.

**Footer links under the text column:**
_"Concepts →"_ `/docs/streams/concepts` ·
_"JSON mode →"_ `/docs/streams/json-mode` ·
_"Durable State →"_ `/docs/streams/durable-state` ·
_"StreamDB →"_ `/docs/streams/stream-db`

**Components:**

- _New build:_ `<LayeredStackDemo>` — SVG + small JS for the
  token-transform animation. ~280 lines.

---

## Section 8 — "Drop a layer when you need to"

> The "open boxes" payoff: layers are conventions on top of one
> another, not walls. The same JSON-mode stream can be consumed at
> three different abstraction levels. Lifted from Proposal B §6.

**Layout:** light band, full-width centerpiece. Three panels in a row
(collapses to stacked on mobile).

**Section title:** _"Drop a layer when you need to"_
**Tagline:** _"One JSON-mode stream. Three ways to consume it. All in
sync."_

**Visual — `<LayerDropdownDemo>` (new build):**

```
   shared stream — created with Content-Type: application/json
                 GET /v1/stream/users-state
   ─────────────────────────────────────────────────────────────────

┌── Raw HTTP ─────────────┐ ┌── State events ───────┐ ┌── StreamDB ────────────┐
│  res.body()             │ │  state.apply(evt)     │ │  db.users.toArray()    │
│  ─ raw byte stream ─    │ │  ─ Materialized       │ │  ─ TanStack DB         │
│                         │ │     State ─           │ │     reactive ─         │
│                         │ │                        │ │                        │
│  {"type":"user","key":  │ │  Map<key, value>      │ │  ┌────┬───────┬─────┐  │
│   "1","value":{"name":  │ │  ┌─────┬──────────┐   │ │  │ id │ name  │ ✱   │  │
│   "Alice"},"headers":   │ │  │ 1   │ Alice    │   │ │  ├────┼───────┼─────┤  │
│   {"operation":"insert" │ │  │ 2   │ Bob      │   │ │  │ 1  │ Alice │ new │  │
│   }}                    │ │  │ 3   │ Carol    │   │ │  │ 2  │ Bob   │     │  │
│  {"type":"user","key":  │ │  └─────┴──────────┘   │ │  │ 3  │ Carol │     │  │
│   "2",…                 │ │                        │ │  └────┴───────┴─────┘  │
│  …                      │ │  applies events as    │ │                        │
│                         │ │  they arrive          │ │  ↻ live re-render      │
└─────────────────────────┘ └────────────────────────┘ └────────────────────────┘
       ▲                            ▲                            ▲
       │                            │                            │
       └─────────────────  same stream URL  ──────────────────────┘
       │                            │                            │
       │                            │                            │
   @durable-streams/         @durable-streams/state        @durable-streams/state
       client                  MaterializedState            createStreamDB({...})
```

**How it actually works (call out under the visual):**

- All three panels read **the same stream URL**, created with
  `Content-Type: application/json`.
- The "Raw HTTP" panel uses `stream()` from `@durable-streams/client`
  and consumes bytes as-is.
- The "State events" panel passes those JSON events through
  `MaterializedState.apply()` — a key/value map projection.
- The "StreamDB" panel uses `createStreamDB({ schema })` — TanStack DB
  reactive collections on top of the same projection.

> The point: there are no "JSON mode" vs "State" vs "DB" _streams_ on
> the wire. There is one stream. Each consumer chooses how much of the
> protocol it wants to use.

- **Animation hint:** a new event is appended to the stream every
  ~2.5s. All three panels update at once — bytes panel scrolls a new
  JSON line in, State map adds/updates an entry, table panel inserts
  a new row with a brief brand-teal "✱ new" pulse.
- **Static-fallback:** show the three panels in their final state with
  4–5 events visible in each.

**Mobile (≤768):** panels stack vertically. Caption row stays above.
The bottom "consumer code" row collapses to one line per panel.

**Components:**

- _New build:_ `<LayerDropdownDemo>` — three sub-panels driven by a
  shared simulated event stream. ~300 lines (largest demo on the page).

---

## Section 9 — "Cache it on a CDN" _(dark band)_

> The scale story. Mirrors Agents §6 (`#scale-to-zero`,
> `<AgentGridDemo>`).

**Layout:** dark band. Text-left (`flex: 1`) / demo-right (`flex: 0 0
auto`). Mirrors `.ea-scale-layout`.

**Section title:** _"Cache it on a CDN"_
**Subtitle:** _"Range-based reads against immutable offsets are
trivially cacheable. Fan out to millions of clients without scaling
your origin."_
**Detail line (smaller, muted):** _"One origin request, twelve thousand
cached reads. The internet already knows how to deliver this."_

**Visual — `<CdnFanOutDemo>` (new build):**

```
                                    origin
                                ┌───────────┐
                                │  ⚡ Stream │
                                │           │
                                │  offset=  │
                                │  …KV00    │
                                └─────┬─────┘
                                      │  1 origin request
                          ┌───────────┼───────────┐
                          ▼           ▼           ▼
                    ┌───────────┐ ┌───────┐ ┌───────────┐
                    │ edge:lhr  │ │edge:fra│ │ edge:nyc  │
                    └─┬─────┬─┬─┘ └─┬───┬─┘ └─┬─────┬─┬─┘
                      ▼     ▼ ▼     ▼   ▼     ▼     ▼ ▼
                     · · · · · · · · · · · · · · · · · ·
                     · · · · · · · · · · · · · · · · · ·
                     · · · · · · · · · · · · · · · · · ·
                     · · · · · · · · · · · · · · · · · ·
                          12,438 cached reads to clients


             ┌──────────────────────────────────────────┐
             │  origin requests  ▏  client reads        │
             │           1       ▏       12,438         │
             └──────────────────────────────────────────┘
```

- **Animation hint:** every ~3s a new "stream chunk" pulses out of the
  origin → fans to the three edges → fans down to the dot grid.
  The "origin requests" counter increments by 1; the "client reads"
  counter increments by ~3,000 (animated number tween).
- **Static-fallback:** show the steady-state counts.

**Components:**

- _New build:_ `<CdnFanOutDemo>` — SVG + animated counters,
  ~220 lines. Borrows the dot-grid pattern from `<AgentGridDemo>`.

---

## Section 10 — "Durable Sessions: multi-user, multi-agent"

> The page's killer-demo moment. The three previous sections (§7
> layered, §8 dropdown, §9 CDN) explained _what_ the protocol is and
> _how_ it scales. This section answers _why_ — to enable a category
> of application that doesn't exist on top of plain SSE.
>
> Pattern reference:
> [Durable Sessions for Collaborative AI](https://electric-sql.com/blog/2026/01/12/durable-sessions-for-collaborative-ai).

**Layout:** light band, full-width signature visual. Title + subtitle
above; visual fills the band; small footer link underneath.

**Section title:** _"Durable Sessions: multi-user, multi-agent"_
**Tagline:** _"One session URL. Many humans, many agents, many
devices. Everyone reads and writes the same durable stream — and
catches up from any offset."_

**Visual — `<CollabSessionDemo>` (new build):**

```
                ╔════════════════════════════════════════════════╗
                ║   /v1/stream/session/design-review             ║
                ║   Content-Type: application/json               ║
                ╚════════════════════════════════════════════════╝
                                       ▲
        ┌──────────────────────────────┼──────────────────────────────┐
        │                              │                              │
        │ append                  append│                       append │
        │ subscribe              subscribe                    subscribe│
        │                              │                              │
   ┌────┴─────┐               ┌────────┴────────┐              ┌──────┴──────┐
   │   👤     │               │       🤖        │              │    👤       │
   │  Alice   │               │     agent       │              │   Bob       │
   │ (laptop) │               │  ─ summariser ─ │              │  (phone)    │
   └──────────┘               └─────────────────┘              └─────────────┘
        │                              │                              │
        │  appends:                    │  appends:                    │  appends:
        │  { user, "PR #214 …" }       │  { tool_call, summary(…) }   │  { user, "👍" }
        │                              │  { tool_result, "3 issues" } │
        │                              │  { agent, "Found 3 issues" } │

           ─────────────  shared message timeline ─────────────

           ┌────────────────────────────────────────────────────┐
           │ 12:01  Alice    PR #214 needs review               │
           │ 12:01  agent    summary(…)               (tool)    │
           │ 12:02  agent    Found 3 issues                     │
           │ 12:03  Bob      👍                                  │
           │ 12:03  agent    ▍ generating fix...                │
           └────────────────────────────────────────────────────┘
                       (materialized via StreamDB, live)
```

- **Animation hint:** loops on a ~12s timer.
  1. Alice's avatar pulses, an "append" arrow flies up to the
     session, the message appears at the bottom of the timeline.
  2. The agent avatar pulses, a tool-call event flies up, then a
     tool-result, then a streaming response.
  3. Bob's avatar pulses (a phone icon — visually distinct device),
     his message appears.
  4. The cursor at the bottom (`▍`) blinks throughout.
- **Reset moment** — every ~30s the bottom timeline briefly fades to
  show "Bob joins on a 4G connection — replays 21 events from offset
  `01JQ…`" — drives the "join from anywhere, catch up from any
  offset" beat.
- **Static-fallback:** show the diagram with the timeline fully
  populated and no animations.
- **Caption row beneath the timeline (small, muted):**
  _"Built on the same protocol as everything else on this page —
  no special "session" infrastructure required."_

**Footer link under the visual (centered, small):**
_"Read 'Durable Sessions for Collaborative AI' →"_
`/blog/2026/01/12/durable-sessions-for-collaborative-ai`

**Mobile (≤768):** participants collapse to a stacked list above the
timeline. Timeline stays full-width.

**Components:**

- _New build:_ `<CollabSessionDemo>` — SVG + CSS keyframes for
  participant pulses + DOM-driven timeline. ~280 lines. The
  per-participant avatar pattern is similar to `<AgentGridDemo>` cells
  but enlarged and labelled.

---

## Section 11 — "Built for the AI loop"

> Where the layers meet the real world. 4-up integrations grid, hairline
> borders, monospace titles. Each card is a gateway into a real
> integration in the docs.

**Layout:** light band, 4-up grid (collapses to 2-up at `≤ md`,
1-up on mobile). Card chrome borrows from `.ea-problem-card`.

**Section title:** _"Built for the AI loop"_
**Tagline:** _"From token streams to multi-agent collaboration —
Durable Streams plug into the AI stack you already use."_

```
┌── 🅣 TanStack AI ─────────────┐  ┌── ▲ Vercel AI SDK ──────────┐
│                                │  │                              │
│  Durable connection adapter.   │  │  Durable Transport for the   │
│  Resumable, shareable AI       │  │  AI SDK. Drop-in replacement │
│  sessions across tabs and      │  │  for `streamText` transport. │
│  devices.                      │  │                              │
│                                │  │                              │
│  ─────────────────────────     │  │  ─────────────────────────   │
│  Docs →    Blog post →         │  │  Docs →    Blog post →       │
└────────────────────────────────┘  └──────────────────────────────┘

┌── ✎ Yjs ──────────────────────┐  ┌── ⇆ Durable Proxy ──────────┐
│                                │  │                              │
│  Sync Yjs CRDT documents over  │  │  Wrap any SSE / streaming AI │
│  Durable Streams. No WebSocket │  │  API. Persists upstream into │
│  infrastructure needed.        │  │  a stream so clients can     │
│                                │  │  reconnect and resume.       │
│                                │  │                              │
│  ─────────────────────────     │  │  ─────────────────────────   │
│  Docs →                        │  │  Docs →                      │
└────────────────────────────────┘  └──────────────────────────────┘
```

Each card:

- Title row: monospace icon + name, `--ea-text-1`.
- 2–3 line value-prop in `--ea-text-2`.
- Footer divider (`1px solid var(--ea-divider)`) then small links:
  _"Docs →"_ and (when applicable) _"Blog post →"_.

**Mapped destinations:**

| Card          | Docs link                                  | Blog post                                                |
| ------------- | ------------------------------------------ | -------------------------------------------------------- |
| TanStack AI   | `/docs/streams/integrations/tanstack-ai`   | `/blog/2026/01/12/durable-sessions-for-collaborative-ai` |
| Vercel AI SDK | `/docs/streams/integrations/vercel-ai-sdk` | `/blog/2026/03/24/durable-transport-ai-sdks`             |
| Yjs           | `/docs/streams/integrations/yjs`           | —                                                        |
| Durable Proxy | `/docs/streams/durable-proxy`              | `/blog/2025/04/09/building-ai-apps-on-sync`              |

**Optional 5th & 6th cards** (if we want to fill a 3×2 instead of 2×2):
**StreamFS** (filesystem inside a stream → `/docs/streams/stream-fs`),
**AnyCable** (Go client → external).

**Components:**

- _Re-skin / new build:_ `<IntegrationsGrid>` — ~140 lines, pure CSS
  grid. Card chrome derived from `.ea-problem-card`.

---

## Section 12 — "Your stack, not ours" _(dark band)_

> Direct sibling of Agents §8 (`#your-stack`). Same layout, same
> chrome, same tabbed code panel.

**Layout:** dark band. Diagram-left (`flex: 0 0 280px`) / code-right
(`flex: 1`). Mirrors `.ea-stack-layout`.

**Section title:** _"Your stack, not ours"_
**Subtitle:** _"Self-host the server with one binary, or run it on
Electric Cloud. Producers and consumers are anything that speaks
HTTP."_

**Diagram (left column):**

```
                ┌──────────────────────────────┐
                │      Your producer           │
                │   Anthropic · Express ·      │
                │   FastAPI · cron job         │
                └──────────────┬───────────────┘
                               │  POST  /v1/stream/…
                               ▼
                ┌──────────────────────────────┐
                │  ⚡  Durable Streams         │   ← brand-coloured border
                │     server                   │
                │   electric cloud · self-host │
                └──────────────┬───────────────┘
                               │  GET ?live=sse · ?offset=…
                               ▼
                ┌──────────────────────────────┐
                │      Your consumer           │
                │   browser · agent · worker   │
                │   AnyCable · iOS · Python    │
                └──────────────────────────────┘
```

- Middle box uses brand-teal border + brand-teal label
  (mirrors `.runtime-box` in Agents).
- Top and bottom boxes use `--ea-divider` border + dashed style for
  the consumer box (the "open" side).

**Code (right column) — three tabs (`active` tab in **bold**):**

Tab 1 — `producer.ts` (active):

```
┌─ ▌producer.ts▐ ┬── consumer.ts ─┬── curl.sh ───┐
│                                                 │
│  import { DurableStream, IdempotentProducer }   │
│    from "@durable-streams/client"               │
│                                                 │
│  const stream = await DurableStream.create({    │
│    url: STREAM_URL,                             │
│    contentType: "application/json",             │
│  })                                             │
│                                                 │
│  const producer = new IdempotentProducer(       │
│    stream, "llm-relay-1", { autoClaim: true }   │
│  )                                              │
│                                                 │
│  for await (const chunk of llm.stream(prompt))  │
│    producer.append(chunk)                       │
│                                                 │
│  await producer.flush()                         │
│                                                 │
└─────────────────────────────────────────────────┘
```

Tab 2 — `consumer.ts` (active):

```
┌── producer.ts ─┬─ ▌consumer.ts▐ ┬── curl.sh ───┐
│                                                 │
│  import { stream }                              │
│    from "@durable-streams/client"               │
│                                                 │
│  const res = await stream<ChatMessage>({        │
│    url: STREAM_URL,                             │
│    offset: lastSeen ?? "-1",                    │
│    live: "sse",                                 │
│  })                                             │
│                                                 │
│  res.subscribeJson(async (batch) => {           │
│    for (const msg of batch.items) render(msg)   │
│    lastSeen = batch.nextOffset                  │
│  })                                             │
│                                                 │
└─────────────────────────────────────────────────┘
```

Tab 3 — `curl.sh` (active):

```
┌── producer.ts ─┬── consumer.ts ─┬─ ▌curl.sh▐ ──┐
│                                                 │
│  curl -X POST $URL                              │
│    -H 'Content-Type: application/json'          │
│    -d '{"event":"click"}'                       │
│                                                 │
│  curl -N "$URL?offset=-1&live=sse"              │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Mobile (≤768):** stack diagram moves above the code tabs.

**Components:**

- _Direct lift:_ `.ea-stack-layout`, `.stack-box`, `.code-tabs`,
  `.code-block.tabbed` styles + structure (matches Agents §8).
- _Re-skin:_ swap labels and copy. New `producer.ts` / `consumer.ts`
  / `curl.sh` content. Tab state management from Agents'
  `stackTab` ref pattern.

---

## Section 13 — "Your first stream, end to end"

> The closing CTA before the social-proof close. Direct sibling of
> Agents §9 (`#first-agent`). Same annotated-code chrome, same numbered
> annotations on the right, same CLI panel underneath, same two CTA
> buttons.
>
> **Naming:** dropped "in 6 lines" — the previous draft over-promised.
> The full end-to-end snippet is ~16 lines. The headline is now
> honest about what's shown.

**Layout:** light band. Annotated code panel + CLI panel on the left
(`flex: 1`) / numbered annotations on the right (`flex: 0 0 320px`).
Mirrors `.ea-annotated-code`.

**Section title:** _"Your first stream, end to end"_
**Subtitle:** _"Create a stream. Append a message. Subscribe live.
Sixteen lines, one package, real APIs."_

**Code panel (left, top):**

```
┌─ stream.ts ────────────────────────────────────────────────┐
│                                                            │
│  import { DurableStream, stream }                       ① │
│    from "@durable-streams/client"                          │
│                                                            │
│  const url = "https://streams.example.com/v1/stream/chat" │
│                                                            │
│  const handle = await DurableStream.create({            ② │
│    url,                                                    │
│    contentType: "application/json",                     ③ │
│  })                                                        │
│                                                            │
│  await handle.append(JSON.stringify({                   ④ │
│    role: "user", text: "Hello"                             │
│  }))                                                       │
│                                                            │
│  const res = await stream<{ role: string; text: string }>({│
│    url,                                                    │
│    offset: "-1",                                        ⑤ │
│    live: "sse",                                         ⑥ │
│  })                                                        │
│                                                            │
│  res.subscribeJson(async (batch) => {                   ⑦ │
│    for (const msg of batch.items) console.log(msg)         │
│  })                                                        │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**CLI panel (left, bottom):**

```
┌─ Terminal ─────────────────────────────────────────────────┐
│                                                            │
│  $ npx tsx stream.ts                                       │
│  ✓ Created stream chat                                     │
│  ✓ Appended message                                        │
│  → { role: "user", text: "Hello" }                         │
│  → { role: "assistant", text: "Hi there!" }                │
│  → ▍                                                       │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**Annotations (right column, numbered ①–⑦):**

| #   | Title                                       | Body                                                                                                                                                             |
| --- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ①   | **One package, two entry points**           | `DurableStream` for read/write handles. `stream()` for fetch-style consumption.                                                                                  |
| ②   | **`DurableStream.create` opens or creates** | Idempotent: returns the existing handle if the stream already exists.                                                                                            |
| ③   | **Pick your content type**                  | `application/json` enables [JSON mode](/docs/streams/json-mode) — message boundaries are preserved.                                                              |
| ④   | **Append messages**                         | Each `append` is a single `POST`. Wrap with [`IdempotentProducer`](/docs/streams/clients/typescript#exactly-once-writes) for exactly-once delivery and batching. |
| ⑤   | **Resume from any offset**                  | `"-1"` = beginning. Pass a saved offset to resume from exactly that point. `"now"` = skip the backlog.                                                           |
| ⑥   | **Live, in real time**                      | `"sse"` opens a long-lived Server-Sent Events stream. `"long-poll"` works in environments that can't hold a connection open.                                     |
| ⑦   | **Subscribe with batches**                  | `subscribeJson` calls your handler with a `batch.items` array. The batch carries the next offset — save it to resume from later.                                 |

**CTAs (centered, below):**

```
              ┌─────────────────┐  ┌─────────────────┐
              │  Get Started    │  │  Read the Docs  │
              └─────────────────┘  └─────────────────┘
                  brand                  alt
              /docs/streams/        /docs/streams/
                quickstart
```

**Mobile (≤768):** annotations move below the code panel; numbered
markers in code remain visible. Already handled by EA's
`.ea-annotated-code` collapse.

**Components:**

- _Direct lift:_ `.ea-annotated-code`, `.ea-left-col`, `.ea-right-col`,
  `.ea-cli-panel`, `.ea-ann-item` chrome from Agents page.
- _Re-skin:_ code content, CLI lines, annotation copy. CTA destinations.

---

## Section 14 — "What people build" _(dark band — demo strip)_

> Adds visual life to the page. Three strongest demos from the
> durable-streams ecosystem as social proof for the technical claims
> above. Sibling of the Sync plan §12.

**Layout:** dark band, 3-card grid using existing `DemoListing.vue`
(or a thin `<DemoStrip>` wrapper around it).

**Section title:** _"What people build"_
**Tagline:** _"Real apps shipped on Durable Streams. Every demo is
open source — fork it, run it, learn from it."_

```
┌── Durable AI Chat ─────────┐  ┌── Background Jobs ─────────┐  ┌── Yjs Editor ──────────────┐
│                             │  │                             │  │                             │
│  [ai-chat-listing.jpg]      │  │  [bg-jobs-listing.jpg]      │  │  [yjs-listing.jpg]          │
│                             │  │                             │  │                             │
│  ## Durable AI Chat         │  │  ## Background Jobs         │  │  ## Yjs Collab Editor       │
│                             │  │                             │  │                             │
│  Multi-user, multi-agent    │  │  Real-time job dashboard    │  │  Multi-user collaborative   │
│  AI chat with resumable     │  │  built on State Protocol.   │  │  editor over Yjs CRDTs and  │
│  sessions across tabs and   │  │  Live progress events into  │  │  Durable Streams. No        │
│  devices.                   │  │  StreamDB.                  │  │  WebSocket server needed.   │
│                             │  │                             │  │                             │
│  ┌─────────┐  ┌─────────┐   │  │  ┌─────────┐  ┌─────────┐   │  │  ┌─────────┐  ┌─────────┐   │
│  │  Open   │  │ Source  │   │  │  │  Open   │  │ Source  │   │  │  │  Open   │  │ Source  │   │
│  └─────────┘  └─────────┘   │  │  └─────────┘  └─────────┘   │  │  └─────────┘  └─────────┘   │
└─────────────────────────────┘  └─────────────────────────────┘  └─────────────────────────────┘

                              All demos →  /streams/demos
```

**Demos to feature** (open to your call — picked for variance):

- **Durable AI Chat** — proves multi-user/multi-agent AI session claim
- **Background Jobs Dashboard** — proves State Protocol use case
  (lives in `examples/state` of the durable-streams repo)
- **Yjs Collab Editor** — proves CRDT collaboration without WebSockets

**Footer link:** _"See all demos →"_ `/streams/demos`

**Mobile (≤768):** 3-card grid collapses to single column.
`DemoListing` component already does this.

**Components:**

- _Direct lift:_ `DemoListing.vue` × 3, populated via a new
  `streams-demos.data.ts` (mirrors `demos.data.ts`) that reads from
  `/streams/demos/*.md`.
- _New build:_ `<DemoStrip>` wrapper component (~30 lines) — same
  pattern as proposed for the Sync plan.
- _Placeholder fallback:_ if `/streams/demos/*` isn't populated yet,
  hand-curate three cards inline (matches the Agents `/agents/demos`
  current state). Plan calls out a `[CUT-CANDIDATE]` if no demos exist
  by ship date.

---

## Section 15 — "Compose your stack" _(cross-sell)_

> Closing cross-sell back to the rest of the Electric product family.
> Sibling of Sync plan §13. The page is the Streams page so it links
> out to Sync, Agents, and TanStack DB.

**Layout:** light band, three-card grid (re-uses `ProductsGrid.vue`
with a filter to exclude Streams itself).

**Section title:** _"Compose your stack"_
**Tagline:** _"Durable Streams is one of four primitives in the
Electric stack. Each solves a different layer of the local-first +
real-time problem."_

```
┌── 🔌 Electric Sync ────────┐  ┌── 🤖 Electric Agents ──────┐  ┌── 🅣  TanStack DB ────────┐
│                             │  │                             │  │                            │
│  Real-time sync for         │  │  Durable, composable        │  │  Reactive client store     │
│  Postgres, over HTTP.       │  │  serverless agents.         │  │  for super-fast apps.      │
│                             │  │                             │  │                            │
│  ───────────────────────    │  │  ───────────────────────    │  │  ───────────────────────   │
│                             │  │                             │  │                            │
│  Sub-millisecond            │  │  Built on Durable           │  │  Sub-millisecond           │
│  reactivity. Powered by     │  │  Streams. The agent loop,   │  │  reactivity, instant       │
│  Durable Streams under      │  │  online and serverless.     │  │  writes, optimistic        │
│  the hood.                  │  │                             │  │  state out of the box.     │
│                             │  │                             │  │                            │
│  /sync →                    │  │  /agents →                  │  │  https://tanstack.com/db → │
└─────────────────────────────┘  └─────────────────────────────┘  └────────────────────────────┘
```

**Mobile (≤768):** existing `ProductsGrid` collapses to 2-col then
1-col.

**Components:**

- _Re-skin:_ `ProductsGrid.vue` — accept a `:filter` prop (or pass a
  pre-filtered list) so we can exclude `durable-streams`. Switch grid
  from `repeat(4, 1fr)` to `repeat(3, 1fr)`. Same prop hook proposed
  for the Sync plan.

---

## Section 16 — "Used by" + "Get started"

> Tight close. Logos at top, CTA strap below. Combines what would
> otherwise be two sections to keep the close fast.

**Layout:** light band, logos at top, CTA strap below. Sibling of Sync
plan §14.

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
│   Start with the Quickstart. Dive into the Concepts. See real apps.     │
│                                                                         │
│       ┌──────────────┐  ┌──────────┐  ┌──────────┐                      │
│       │  Quickstart  │  │   Docs   │  │  Demos   │                      │
│       └──────────────┘  └──────────┘  └──────────┘                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

- `Quickstart` → `/docs/streams/quickstart` (brand)
- `Docs` → `/docs/streams/` (alt)
- `Demos` → `/streams/demos` (alt)

**Mobile (≤768):** CTA buttons stack vertically.

**Components:**

- _Direct lift:_ `UsedBySection.vue` and `NextStepsSection.vue` —
  already exist. Just update CTA hrefs to point at `/docs/streams/*`
  and the logo set if Streams has different reference customers from
  Sync (otherwise reuse the Sync logo set).

---

## Build inventory

### Direct lift (no changes)

- `UsedBySection.vue` (§16)
- `NextStepsSection.vue` (§16, just update hrefs)
- `DemoListing.vue` × 3 (§14)
- `.ea-stack-layout`, `.stack-box`, `.code-tabs`, `.code-block.tabbed`
  (§12 — all from Agents)
- `.ea-annotated-code`, `.ea-left-col`, `.ea-right-col`,
  `.ea-cli-panel`, `.ea-ann-item` (§13 — all from Agents)
- `.ea-come-online` layout class (§2)
- `.ea-durable-layout` layout class (§5)
- `.ea-context-layout` layout class (§7)
- `.ea-scale-layout` layout class (§9)
- `.cli-body` / `.cli-prompt` / `.cli-line` / `.cli-output` (§3, §13)
- Logo SVGs from `/img/icons/` (§6, §10)

### Re-skin to EA hairline aesthetic (CSS-only, sometimes one prop)

- `ProductsGrid.vue` — add `:filter` prop → §15
  (same change requested in Sync plan)
- `.ea-problem-card` chrome → §4 (3-properties), §11 (integrations grid)
- `.runtime-box` chrome → §12 brand-coloured middle box

### New build

| Component                   | Section | Approx. lines | Risk |
| --------------------------- | ------- | ------------- | ---- |
| `<StreamsHomePage>` wrapper | (all)   | ~50           | Low  |
| `<StreamFlowBg>`            | §1      | ~120          | Low  |
| `<ConnectionDropDemo>`      | §2      | ~180          | Low  |
| `<QuickstartPlaybackDemo>`  | §3      | ~200          | Med  |
| `<ThreePropertiesGrid>`     | §4      | ~120          | Low  |
| `<OffsetReplayDemo>`        | §5      | ~250          | Med  |
| `<PolyglotLineup>`          | §6      | ~220          | Low  |
| `<LayeredStackDemo>`        | §7      | ~280          | Med  |
| `<LayerDropdownDemo>`       | §8      | ~300          | High |
| `<CdnFanOutDemo>`           | §9      | ~220          | Med  |
| `<CollabSessionDemo>`       | §10     | ~280          | High |
| `<IntegrationsGrid>`        | §11     | ~140          | Low  |
| `<DemoStrip>` wrapper       | §14     | ~30           | Low  |
| `streams-demos.data.ts`     | §14     | ~30           | Low  |

**Largest risks:** `<LayerDropdownDemo>` and `<CollabSessionDemo>` —
both have multiple synchronised sub-panels with shared simulated event
streams. Build the simulated-event-stream utility once, reuse across
both demos and `<QuickstartPlaybackDemo>`.

### Routing / config

- `/streams/index.md` → swap frontmatter to `pageClass: ds-homepage`,
  replace body with `<StreamsHomePage />`. Frontmatter:
  ```yaml
  layout: page
  title: Durable Streams
  titleTemplate: false
  description: The data primitive for the agent loop. Persistent,
    addressable, real-time streams over plain HTTP.
  sidebar: false
  pageClass: ds-homepage
  ```
- `custom.css` → add `.ds-homepage .VPNavBar { border-bottom: 0 }`
  rule alongside existing `.ea-homepage` and `.sync-page` rules. (Or
  generalise to `.no-nav-divider` and apply that class on all three
  vertical pages.)
- `/streams/demos/index.md` — placeholder if `streams-demos.data.ts`
  has nothing yet (mirrors `/agents/demos`).

---

## Build order (suggested)

For a quick first round we can ship the page with mostly static
content and only the cheapest demos. Then add animated demos in
follow-up PRs.

1. **Skeleton + sections 1, 4, 11, 12, 13, 15, 16** — hero (with
   placeholder bg), three-properties, integrations grid, "your stack"
   (lifts from Agents), annotated quickstart, cross-sell, used-by +
   CTA strap. ~1 day. Page is already publishable at this point.
2. **Section 2 + 3** — "Streaming needs to be durable" prose + the
   `QuickstartPlaybackDemo` terminal. ~1 day. Page now has its
   "I get it" moment in the first viewport.
3. **Sections 5, 7, 8** — `OffsetReplayDemo`, `LayeredStackDemo`,
   `LayerDropdownDemo`. The biggest animated builds (build the
   shared simulated-event-stream utility first). ~2–3 days.
4. **Sections 6 + 9** — `PolyglotLineup`, `CdnFanOutDemo`.
   ~1–2 days.
5. **Section 10 + 14** — `CollabSessionDemo` (the killer demo) and
   `DemoStrip` wiring. Section 10 is the biggest single payoff visual
   on the page; worth a polished build. ~2 days.
6. **Polish** — `<StreamFlowBg>` hero background, motion-reduction
   fallbacks, mobile rhythm pass across all 16 sections.

---

## Open decisions to settle before implementation

1. **Hero install line.** `npm i @durable-streams/client` (TS-first,
   verified to exist) or `curl -X PUT https://api.streams.dev/v1/stream/hello`
   (protocol-first)? Could toggle. Currently leads with TS.
2. **Hostname in code samples.** Use `streams.example.com` (matches
   docs), `api.streams.dev` (suggests Cloud), or `localhost:4437`
   (matches the quickstart)? Page is currently inconsistent — pick one
   and apply across §6, §10, §12, §13.
3. **Eyebrow text.** "An Electric product" — yes / no / different
   wording?
4. **Cross-product link in the tagline.** Confirm we want to link out
   to `/agents` from the hero.
5. **Cloud vs self-host emphasis.** §12 currently treats both as
   equal; should we lead with Electric Cloud (pricing-page tie-in)?
6. **§11 grid size.** 2×2 (4 cards: TanStack AI, Vercel AI SDK, Yjs,
   Durable Proxy) or 3×2 (add StreamFS, AnyCable)? Could also add a
   fifth "Electric Sync" card to underline that Sync runs _on_ Streams.
7. **Reusable demos.** `OffsetReplayDemo`, `LayerDropdownDemo`,
   `CollabSessionDemo`, and `QuickstartPlaybackDemo` would all be
   valuable inside `/docs/streams/*` too — design them generically so
   they can be embedded in MDX.
8. **Pricing CTA.** Do we want a small "See pricing →" link in the
   hero secondary row, or keep pricing entirely off this page?
9. **§3 vs §2 ordering.** Currently prose first, then tour. Could swap
   for a more "show, then tell" flow (mirrors Proposal C).
10. **§14 demo selection.** Durable AI Chat + Background Jobs +
    Yjs Editor proposed — verify these exist in the durable-streams
    examples folder. If `/streams/demos/*` isn't populated by ship
    date, mark §14 as `[CUT-CANDIDATE]` for v1.
11. **Tab state in §12.** Three tabs sharing a single panel
    (Agents-style, with `stackTab` ref) or three stacked panels?
    Plan currently shows the tabbed pattern.
12. **Logo set in §16.** Reuse the Sync logo set or curate a
    Streams-specific one? Streams has a different audience tilt
    (AI infra, real-time collab) — may warrant separate logos.
