# Desktop mockup — plan

> **Status:** draft for review. **Phase 5 in progress — see "Post-review correction (Phase 5)" below for the chrome rearchitecture that landed after the first pass got the titlebar / tile header / composer / state inspector wrong.**
> **Goal:** ship a small **mockup kit** — composable primitives + page-slot scenes — that match the running apps pixel-for-pixel, _and_ use it to fill the §2 hero strap of `AppDownloadPage.vue`. The kit is sized to land §2 cleanly _and_ to extend to other slots on the App page (modes thumbnails, scenarios, mobile preview, OG images) without re-engineering the primitives. This plan ships the §2 scenes only; future scenes are out of scope but explicitly enabled.
> **Where it lives:** developed and reviewed inside the existing `/brand-toys` framework; consumed by `website/src/components/app-download/AppDownloadPage.vue` once the scenes look right.
> **Audience:** coding agents / collaborators picking this up after `APP_PAGE_PLAN.md`.
> **PR shape:** one pull request, sequenced internally as eight phases. Phases 1–7 are reviewable inside `/brand-toys` without touching user-visible pages; phase 8 lands the integration into `AppDownloadPage.vue`. No follow-up PRs are required for this plan to ship.

---

## 0. Post-review correction (Phase 5)

After phases 1–4 landed, side-by-side review against real screenshots
(`website/src/components/brand-toys/app/_reference/`) surfaced four
architectural mistakes in my first pass. The corrections below
**supersede** the corresponding sections of the original plan and
guide the Phase 5 + retroactive Phase 2/4 fixes:

1. **No separate titlebar on macOS.** The desktop app uses Electron's
   `hiddenInset` titlebar style, which means the traffic lights are
   painted **by the OS over the renderer** at a fixed top-left
   position. The renderer just paints a 44-px-tall drag region (the
   `SidebarHeader` spacer; or the leftmost tile's `MainHeader` strip
   when the sidebar is collapsed) and the lights overlay it. There is
   **no separate `<AppTitlebar>` component for macOS scenes**.
   - `AppWindowFrame` now overlays `AppTrafficLights` as an
     absolutely-positioned element at top-left when `os='macos'`.
   - `AppTitlebar` is retained only for Windows/Linux scenes, where a
     real custom titlebar strip (`DesktopTitleBar.tsx`) sits at the
     top of the window with app icon + menu sections + window
     controls.

2. **Tile header (= `EntityHeader`) is much richer.** The real strip
   carries a display title + session-id subtitle + copy-id icon
   cluster on the left, and a status pill + runner badge + sandbox
   badge + view-toggle icons + overflow menu + close button on the
   right. My first pass rendered just a status dot + mono title, which
   read as "tab bar" rather than "entity header". Rebuilt
   `AppTileHeader` to match `EntityHeader.tsx` exactly.

3. **Composer body is single-row.** My first pass added a chip strip
   below the textarea with `Attach`, `claude-4.6-sonnet`, and a `⌘↵`
   kbd hint — that strip belongs to the **spawn screen**'s
   `EntityContextDrawer`, NOT the regular session composer.
   `AppMessageInput` now mirrors the live `MessageInput.tsx` body:
   a `+` attach button on the left, the textarea flexes, and the
   send button caps the right edge. No chip strip. (A future
   `MobileChatScene` may render a stripped-down spawn variant; that
   stays out of scope for §2.)

4. **State inspector is a 3-panel layout, not a flat table.** The real
   state inspector has a top selector strip (StreamDB + runtime), a
   horizontal split into `Types` (left, with row counts per type) and
   `Records` (right, key / from / payload table for the selected
   type), and an `Events` panel at the bottom with `INS` insert pills
   - add (+) / refresh (↻) affordances on each row.
     `AppStateInspector` (renamed from `AppStateTable`) renders this
     structure, with the deterministic pulse loop now firing on the
     `Events` panel rows where the visual cadence reads strongest.

5. **Sidebar footer.** The sidebar terminates in a `SidebarFooter`
   row carrying the server picker (`● localhost:4437` with a
   chevron), a filter / view-menu icon, and a settings cog. My first
   pass dropped this entirely. Added `AppSidebarFooter` and mounted
   it inside `AppSidebar` with a top hairline divider matching the
   live `SidebarFooter.module.css`.

The §6 toy-by-toy controls schema below still applies; the fix list
just changed _what each primitive paints_, not the toy contract.

---

## 1. Why this exists

`APP_PAGE_PLAN.md §2` calls for a "desktop + mobile screenshots side by side" hero strap under the headline:

> "Same session. Two devices. One control plane."

The App page (`AppDownloadPage.vue`) is already shipped with the strap structure in place as `<AdPlaceholder>` blocks (phases 1–4 of `APP_PAGE_PLAN.md` are merged). `APP_PAGE_PLAN.md §7 phase 5` envisions swapping those placeholders for captured screenshots. **This plan supersedes that phase 5 step** — instead of dropping in screenshots, we drop in animated HTML/CSS mockups (phase 8 of this plan). The screenshot path is no longer required for the §2 strap. (Other placeholders on the page — scenarios, multi-device diagram, mobile-app-preview — remain `APP_PAGE_PLAN.md`'s problem.)

Two reasons not to ship the §2 strap as flat screenshots:

1. **The desktop app already _is_ HTML+CSS.** `packages/agents-desktop` is a thin Electron shell around `agents-server-ui`. The only "native chrome" is macOS traffic-light buttons, the Windows/Linux titlebar (already custom-painted React in `DesktopTitleBar.tsx`), the tray icon, and the power-save blocker. Everything inside the visible window is a React tree styled with CSS modules over a `--ds-*` design-token sheet that is **explicitly aligned with the marketing site's `--vp-c-*` tokens** (see the file header in `packages/agents-server-ui/src/ui/tokens.css`).
2. **The story we want to tell is dynamic.** "Live, durable, agentic" is much more legible if the hero shows Horton _streaming_ a response into the left tile while the right tile's state-explorer rows pulse with updates. That is hard to do with a still and trivial to do with a `setInterval`.

Trade-off summary:

|                                              | HTML/CSS mockup                                | Screenshot          |
| -------------------------------------------- | ---------------------------------------------- | ------------------- |
| Pixel-exact match                            | yes (shared tokens + copied module CSS)        | yes                 |
| Light/dark auto-switches with the site theme | yes, free                                      | needs 2× assets     |
| Crisp at any DPI / size                      | yes                                            | needs 2x/3x exports |
| Animatable                                   | yes — typing chat, splitting tiles             | only with video/GIF |
| Catches up when the app UI changes           | drifts (but tokens stay in sync automatically) | drifts              |
| Up-front effort                              | ~2–3 days for a full hero scene                | ~30 min per shot    |
| Reusable in social / launch / OG images      | yes                                            | yes                 |

We pick the mockup. Screenshots remain the right tool for §3.5 scenarios and other surfaces where the goal is storytelling rather than product fidelity.

---

## 2. Why HTML/CSS over embedding the real React tree

We considered three reuse options:

1. **Just share the CSS.** Import `tokens.css` + a few `*.module.css` files into the website. Hand-write the markup as Vue. Smallest bundle, no React, no SSR drama, easiest to animate.
2. **Mount the real React components inside Vue.** Add `react`, `react-dom`, `@vitejs/plugin-react` to the website. Pulls the entire `agents-server-ui` dep tree (Streamdown, Shiki, Mermaid, KaTeX, lucide, tanstack-router, tanstack-db) into a marketing page. Eager bundle is hundreds of KB; lazy is still a fight with VitePress SSR. Also requires fixture-mode plumbing in `ElectricAgentsProvider`.
3. **Build a separate Vite app and iframe it.** Cleanest isolation but introduces an iframe theme-sync problem and a separate maintenance surface.

We pick **option 1** — it is the right size for the §2 strap and easy to animate. Option 3 stays available later if we want a full live mockup for launch material; option 2 is firmly off the table.

---

## 3. Why `/brand-toys` is the right harness

`website/brand-toys.md` already exists as a registry-driven component playground. It gives us, for free:

- **Resizable stage** at known px dimensions (`StageFrame.vue`) — perfect for screenshots and recordings at fixed sizes.
- **Auto-generated control panel** from a JSON schema in `toys.ts` — every prop becomes a slider/toggle/select without per-toy UI work.
- **URL-state mirroring** — every config knob is in the query string, so any composed state is bookmarkable / linkable.
- **Group chips + filter** in the index. We add an `app` group.
- **`H` key recording mode** that hides the chrome for clean screen captures.
- **Lazy-loaded** via `defineAsyncComponent`. Toys don't bloat the index.
- **`paused: boolean` convention** already shared across animated toys.

One snag: `BrandToysPage.vue` forces the site into dark mode while on `/brand-toys`. That is fine for our purposes if each app toy applies `data-theme` to **its own root** rather than relying on `html.dark`. The `--ds-*` tokens are designed to scope; we just need a wrapper `<div class="app-mockup-root" :data-theme="theme">` on each toy. No framework change required.

---

## 4. Token bridge

`packages/agents-server-ui/src/ui/tokens.css` is the source of truth for the app's `--ds-*` tokens. Its file-header comment already says it is "kept in lock-step with the marketing site's `website/.vitepress/theme/custom.css`". We exploit that alignment.

Approach: **copy `tokens.css` into the website with the root selectors rescoped.** Two find-replaces:

```text
:root,
:root[data-theme='light']
  → .app-mockup-root,
    .app-mockup-root[data-theme='light']

:root[data-theme='dark']
  → .app-mockup-root[data-theme='dark']
```

The copy lives at `website/src/components/brand-toys/app/tokens.css` and carries a header comment marking it as a copy:

```css
/* SOURCE: packages/agents-server-ui/src/ui/tokens.css
   Scoped to .app-mockup-root so the website's own CSS vars don't fight.
   When the source updates, re-run the two find-replaces above. */
```

Each app toy wraps its content in `<div class="app-mockup-root" :data-theme="theme">` so:

- The mockup uses `--ds-*` regardless of the website's `html.dark` state.
- Light/dark toggles work _per-toy_ via the controls panel.
- `--vp-c-*` site vars are untouched — no risk of leaking into surrounding pages.

**Contract:** only use `--ds-*` inside the mockup. Never `--vp-c-*` (those resolve to the page's mode, not the toy's). This is the same contract `agents-server-ui` already follows.

**Long-term cleanup** (out of scope for this plan): extract `tokens.css` into a workspace package — `@electric-ax/agents-ui-tokens` or similar — that both `agents-server-ui` and the website import via PostCSS or a plain `@import`. Removes the "kept in lock-step by hand" footgun. Tracked separately.

---

## 4.5. OS detection — match the visitor's platform

The desktop app paints different window controls per OS — macOS gets traffic-light buttons (delegated to native chrome via the OS), Windows/Linux get the custom-painted titlebar in [`DesktopTitleBar.tsx`](packages/agents-server-ui/src/components/DesktopTitleBar.tsx) (app-icon menu button + min/max/close glyphs).

To make the marketing mockup feel like _your_ desktop, the toy auto-detects the visitor's OS and picks the matching chrome. A Mac visitor sees traffic lights; a Windows visitor sees the Windows window controls; a Linux visitor sees the Linux variant.

**Reuse what's already there.** [`AppDownloadPage.vue:171-203`](website/src/components/app-download/AppDownloadPage.vue) already has battle-tested OS detection (UA-sniffing for Win/Linux + a WebGL-renderer probe for Apple Silicon vs Intel). Extract the OS half into a composable so the mockup and the download CTA stay in sync:

```ts
// website/src/components/app-download/useDetectedOs.ts
import { onMounted, ref } from 'vue'

export type DetectedOs = 'macos' | 'windows' | 'linux'

export function useDetectedOs(initial: DetectedOs = 'macos') {
  const os = ref<DetectedOs>(initial)
  onMounted(() => {
    if (typeof navigator === 'undefined') return
    const ua = `${navigator.userAgent || ''} ${navigator.platform || ''}`
    if (/Win(dows|64|32)|WOW64|WinNT/i.test(ua)) os.value = 'windows'
    else if (/Linux|X11|Ubuntu|Fedora|Debian/i.test(ua) && !/Android/i.test(ua))
      os.value = 'linux'
    else os.value = 'macos' // Mac, iPad-as-Mac, anything that isn't Win/Linux
  })
  return { os }
}
```

`AppDownloadPage.vue` continues using its own `detectedId` (which carries arch info for the download CTA). The composable is _additive_ — it doesn't replace the existing logic, it just shares the OS-classification half.

**The toy's `os` control becomes a four-way select:**

```ts
{ name: 'os', type: 'select', options: ['auto', 'macos', 'windows', 'linux'], default: 'auto' }
```

- `auto` resolves at runtime via `useDetectedOs()` and renders the visitor's actual OS.
- `macos` / `windows` / `linux` force a specific variant for previewing in `/brand-toys` and for any marketing surface that wants a fixed OS.

**SSR safety.** The composable defaults to `'macos'` on the server (no `navigator`); on hydrate, it flips to the detected OS. There will be a single-frame "always macOS" first paint on Windows/Linux — acceptable tradeoff vs. a flash-of-nothing. If we want to avoid it, a tiny inline `<script>` in `AppDownloadPage.vue` can set a `data-os` attribute on `<html>` before VitePress hydrates, but that's optional polish.

**On the App page (`AppDownloadPage.vue`):** pass `os="auto"` to `<HeroChatStateScene>`. Default behaviour, nothing else needed.

---

## 4.6. Architecture — primitives, scenes, responsive sizing

The mockup is a **kit**, not a single component. Two motivating constraints, both raised explicitly during plan review:

1. **Reuse across the App page (and beyond).** `AppDownloadPage.vue` carries multiple slots a product mockup could plausibly fill — §2 hero strap (this plan), §3 modes-card thumbnails, §3.5 scenario illustrations, §6 builder cards, §7b mobile preview — plus surfaces outside the App page (OG images, homepage hero, blog posts). Each needs a different _composition_ (chat-only, state-only, parallel workers, full window, mobile chat, mobile session list), not a different mockup engine.
2. **Responsive to container size.** The same scene needs to render acceptably at 1280×800 (§2 hero), ~520×290 (§3.5 scenario card), ~320×180 (a §3 thumbnail), 1920×1200 (full-bleed marketing / OG hero). Naive `transform: scale()` makes text fuzzy at non-integer scales; `font-size: 1cqw` everywhere fights `agents-server-ui`'s overwhelmingly px-based CSS modules and breaks the shared-styling premise.

The architecture answers both with the same shape.

### Primitives vs scenes

Two layers, with a strict directionality between them.

```text
website/src/components/brand-toys/app/
├── primitives/                           ← never imported outside the app/ kit
│   ├── chrome/
│   │   ├── AppWindowFrame.vue
│   │   ├── AppTitlebar.vue
│   │   └── AppTrafficLights.vue
│   ├── sidebar/
│   │   ├── AppSidebar.vue
│   │   └── AppSidebarRow.vue
│   ├── workspace/
│   │   ├── AppTileShell.vue              ← chrome only; content via slot
│   │   └── parts/
│   │       ├── ChatTileContent.vue
│   │       ├── StateTileContent.vue
│   │       └── …                         ← future: WorkersTileContent etc.
│   └── mobile/
│       ├── AppPhoneFrame.vue
│       └── parts/
│           ├── MobileChatContent.vue
│           └── …                         ← future: MobileSessionListContent etc.
│
└── scenes/                               ← page-slot compositions; consumed by pages
    ├── desktop/
    │   └── HeroChatStateScene.vue        ← § 2 desktop column
    └── mobile/
        └── MobileChatScene.vue           ← § 2 mobile column
```

**Primitives** are the building blocks. They never change to suit a specific page slot. Their job is "look like the running product". They expose enough props (`os`, `theme`, `density`, content slots) to be composed, never enough to know which page they're on.

**Scenes** are page-slot-specific compositions. Each scene picks which primitives to include, what fixture to render, what density to use, and what container-query breakpoints to honour. Adding a new marketing surface = adding a new scene file (~50–100 lines), no primitive changes. Scenes are the only thing imported by `AppDownloadPage.vue` and any future consumer.

**Rule:** every consumer in `AppDownloadPage.vue` consumes a scene. Primitives are exposed in `/brand-toys` for development and primitive-level toys, but never imported directly from outside the `app/` kit. This keeps the primitive surface stable as scenes accumulate.

We use "scene" deliberately — parallel to the filmmaking sense: specific characters (which primitives), specific framing (which container), specific dialog (which fixture). One Vue SFC per scene.

### Responsive sizing strategy

Three rules, ranked.

**1. Chrome geometry is fixed in px.** Titlebar is 28px tall, traffic lights are 12px, sidebar rows are 28px (`--ds-row-height-md`), tile header is 36px. This matches the real product, where window chrome doesn't scale with window size. It also avoids the fuzzy-text problem that `transform: scale()` and `font-size: 1cqw` both produce at fractional ratios.

**2. Layout reflows via CSS `@container` queries.** Every scene declares `container-type: inline-size` on its root, then uses container-width breakpoints to toggle which parts are visible / how they're arranged. Each scene picks its own breakpoints — they are scene-local, not global. Primitives expose `data-mode` / `data-density` attributes (e.g. `<AppTitlebar :data-mode="compact">`) that scenes flip at their breakpoints; primitives never run their own container queries.

**3. Scenes _opt into_ compactness; they don't fall back to it.** A scene meant for a §3 card thumbnail explicitly composes "compact, no sidebar, no titlebar buttons" from the start — it isn't `HeroChatStateScene` collapsed by accident. Two scenes that show the same chat tile at different densities are two scene files. Cheaper than the alternative (one scene with five branchy `v-if`s).

Concrete shape for a hero-style scene:

```vue
<!-- scenes/desktop/HeroChatStateScene.vue -->
<template>
  <div class="hero-scene app-mockup-root" :data-os="os" :data-theme="theme">
    <AppWindowFrame :os="os">
      <AppTitlebar :os="os" />
      <div class="hero-scene-body">
        <AppSidebar class="hero-sidebar" />
        <div class="hero-tiles">
          <AppTileShell><ChatTileContent /></AppTileShell>
          <AppTileShell class="tile-state"><StateTileContent /></AppTileShell>
        </div>
      </div>
    </AppWindowFrame>
  </div>
</template>

<style scoped>
.hero-scene {
  container-type: inline-size;
}

.hero-scene-body {
  display: flex;
  height: 100%;
}
.hero-tiles {
  display: grid;
  grid-template-columns: 6fr 4fr;
  flex: 1;
}

@container (max-width: 900px) {
  /* Hide sidebar, keep tile pair. */
  .hero-sidebar {
    display: none;
  }
}
@container (max-width: 700px) {
  /* Drop state tile; chat fills workspace. */
  .tile-state {
    display: none;
  }
  .hero-tiles {
    grid-template-columns: 1fr;
  }
}
@container (max-width: 480px) {
  /* Strip titlebar to a bare strap. */
  .hero-scene :deep(.app-titlebar [data-tb-buttons]) {
    display: none;
  }
}
</style>
```

Default breakpoint table per scene this plan ships:

| Scene                | Default size (toy) | Breakpoint cascade                                                         |
| -------------------- | ------------------ | -------------------------------------------------------------------------- |
| `HeroChatStateScene` | 1280 × 800         | ≥ 900: full window (titlebar + sidebar + 60/40 tile split)                 |
|                      |                    | < 900: hide sidebar, keep tile pair                                        |
|                      |                    | < 700: drop state tile, chat fills workspace                               |
|                      |                    | < 480: strip titlebar buttons; just chat content                           |
| `MobileChatScene`    | 360 × 640          | ≥ 320: full phone frame                                                    |
|                      |                    | < 320: shrink bezel padding, keep proportions; aspect remains 9:16 minimum |

### Escape hatch: fluid scale wrapper

For surfaces that must fill a non-px-grid container at a fixed aspect — OG images rasterized to PNG at 1200×630, Twitter video stills, hero animations that flex with viewport — wrap the scene in a `transform: scale()` wrapper. The mockup renders at its native size; the wrapper scales rigidly to fit. Acceptable for one-shot rasterization (the output is a PNG, not live text); avoid for live rendering at fractional scale. The container-query path is the default; this is the explicit opt-out.

A `<MockupScaleFit>` helper component would live in `primitives/` and take `target-width` / `target-height` props. Out of scope for this plan unless an actual consumer needs it; flagged here so a future agent doesn't reinvent it.

### Scene catalog (reuse map)

Concrete surface inventory for `AppDownloadPage.vue`. This plan ships the **bold rows**; every other row is enabled by the primitives but ships in a follow-up plan that cites this one for the primitive contract.

| Slot                              | Aspect / target   | Scene (this plan ships)                           | Future scenes (out of scope here)                                                                        |
| --------------------------------- | ----------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **§2 hero strap, desktop column** | 16:10             | **`HeroChatStateScene`**                          | —                                                                                                        |
| **§2 hero strap, mobile column**  | 9:16              | **`MobileChatScene`**                             | —                                                                                                        |
| §3 mode card 1 — Code with Horton | 16:9 thumb        | —                                                 | `ModeChatScene` (chat-only, compact)                                                                     |
| §3 mode card 2 — Attach to remote | 16:9 thumb        | —                                                 | `ModeRemoteAttachScene`                                                                                  |
| §3 mode card 3 — Build your own   | 16:9 thumb        | —                                                 | `ModeStateExplorerScene`                                                                                 |
| §3.5 scenarios (4× cards)         | 16:9              | —                                                 | `ScenarioMobileTriageScene`, `ScenarioWorkersScene`, `ScenarioForkSessionScene`, `ScenarioCronWakeScene` |
| §4 multi-device diagram           | 16:8              | _not a mockup_                                    | stays as inline SVG per `APP_PAGE_PLAN.md §4`                                                            |
| §6 builder cards (6×)             | small             | _not a mockup_                                    | likely no mockup; icon + text                                                                            |
| §7b mobile preview                | 9:16, dark        | —                                                 | `MobileSessionListScene`                                                                                 |
| OG / social / launch image        | 1200 × 630, fluid | `HeroChatStateScene` via scale wrapper (deferred) | dedicated `OgHeroScene` if needed                                                                        |

If a future agent picks up one of the un-shipped rows, the work is: (a) add any new primitives the scene needs (e.g. `WorkersTileContent` for `ScenarioWorkersScene`), (b) write the scene SFC composing primitives, (c) register it as a brand-toys scene toy, (d) drop it into the matching `<AdPlaceholder>` slot. No primitive ever changes shape to support a new scene; if a primitive _must_ change, the change is itself a primitive-level edit reviewed against the running product.

### Brand-toys verification of responsiveness

Every scene toy in `/brand-toys` exposes a `size` control or is demoed via the existing stage-frame resize handle, so we can stretch a scene from 1920 px down to 320 px and visually confirm the breakpoint cascade. Phase 6 / 7 end-of-phase checks include explicit "drag to width X, verify Y collapses to Z" steps so this isn't theory.

---

## 5. File layout

Architecture from §4.6 expressed as files. Two layers — `primitives/` and `scenes/` — with a shared `tokens.css` / `shared.css` / `fixtures.ts` underneath.

```text
website/src/components/app-download/
├── useDetectedOs.ts            # NEW. Shared OS-detection composable
│                               # used by AppDownloadPage.vue and the
│                               # mockup scenes (per §4.5).
└── …existing files…

website/src/components/brand-toys/app/
├── tokens.css                  # copy of agents-server-ui tokens.css,
│                               # :root → .app-mockup-root, scoped so it
│                               # cannot leak to the rest of the site
├── shared.css                  # base/utility helpers; @import './tokens.css'
├── fixtures.ts                 # canned entities, chat fixtures, state rows,
│                               # tool-call payloads — single source of
│                               # truth for the mockups' fake content
│
├── primitives/                 # never imported outside the app/ kit
│   ├── chrome/
│   │   ├── AppTrafficLights.vue       # macOS red/amber/green dots
│   │   ├── AppTitlebar.vue            # macOS / Windows / Linux variants
│   │   └── AppWindowFrame.vue         # rounded shell + os-correct titlebar slot
│   ├── sidebar/
│   │   ├── AppSidebarRow.vue          # status dot + label; selected/hover states
│   │   └── AppSidebar.vue             # header + tree + footer, fixture-driven
│   ├── workspace/
│   │   ├── AppTileShell.vue           # mirrors TileContainer chrome; content slot
│   │   ├── AppTileHeader.vue          # mirrors MainHeader.tsx
│   │   └── parts/
│   │       ├── ChatTileContent.vue    # bubble + agent response + composer
│   │       ├── StateTileContent.vue   # state-explorer table with row pulses
│   │       └── …                      # future: WorkersTileContent, etc.
│   ├── chat/                          # leaf-level chat parts; reused across
│   │   │                              # desktop ChatTileContent + mobile
│   │   │                              # MobileChatContent
│   │   ├── AppMessageBubble.vue       # user bubble
│   │   ├── AppAgentResponse.vue       # Horton response; streaming animation
│   │   └── AppMessageInput.vue        # composer slab
│   ├── state/                         # leaf-level state parts
│   │   ├── AppStateRow.vue            # one row, optional pulse
│   │   └── AppStateTable.vue          # grid; periodic deterministic pulses
│   └── mobile/
│       ├── AppPhoneFrame.vue          # phone bezel + status bar + home indicator
│       └── parts/
│           ├── MobileChatContent.vue  # mobile chat composition (header + log + input)
│           └── …                      # future: MobileSessionListContent, etc.
│
└── scenes/                     # page-slot compositions; consumed by pages
    ├── desktop/
    │   └── HeroChatStateScene.vue     # § 2 desktop column
    └── mobile/
        └── MobileChatScene.vue        # § 2 mobile column
```

Total surface estimate for **this plan's scope**: ~16–18 small SFCs (primitives + 2 scenes) + one composable, fixtures + shared CSS, ~1700 lines all in.

Future scenes (per the §4.6 catalog) add ~50–100 lines each as new SFCs in `scenes/`, plus any net-new content parts (e.g. `WorkersTileContent` ≈ 200 lines). Primitives stay frozen.

---

## 6. Toy-by-toy controls schema

Every primitive and scene gets a `/brand-toys` entry. The two layers are tagged differently:

- **Primitive toys** — atoms and molecules from `primitives/`. Used during phases 2–5 to verify each piece against the running product. Stable; rarely re-opened once green.
- **Scene toys** — compositions from `scenes/`. These are the deliverables. They expose **a `size` control** so we can drag the brand-toys stage from 1920×1200 down to 320×400 and watch the breakpoint cascade fire.

Sketches below mirror the existing `ControlDef` type — `paused`, `theme`, `os`, `progress` etc. follow the conventions other toys already use.

### Primitive toys — chrome

**`AppTrafficLights`**

```ts
{
  id: 'app-traffic-lights',
  label: 'App — traffic lights',
  group: 'app',
  controls: [
    { name: 'state', type: 'select', options: ['normal', 'hover', 'active'], default: 'normal' },
    { name: 'theme', type: 'select', options: ['light', 'dark'], default: 'dark' },
  ],
  defaultSize: { w: 200, h: 80 },
  animated: false,
}
```

**`AppTitlebar`**

```ts
{
  id: 'app-titlebar',
  label: 'App — titlebar',
  group: 'app',
  controls: [
    { name: 'os', type: 'select', options: ['auto', 'macos', 'windows', 'linux'], default: 'auto' },
    { name: 'theme', type: 'select', options: ['light', 'dark'], default: 'dark' },
    { name: 'mode', type: 'select', options: ['full', 'compact'], default: 'full' },
    { name: 'title', type: 'string', default: '' },
  ],
  defaultSize: { w: 800, h: 40 },
  animated: false,
}
```

`mode: 'compact'` strips OS controls / app-icon menu — the variant scenes flip to at narrow container widths (per §4.6 breakpoints).

**`AppWindowFrame`** — empty content slot, used to verify the chrome reads correctly before any content lands.

```ts
{
  id: 'app-window-frame',
  controls: [
    { name: 'os', type: 'select', options: ['auto', 'macos', 'windows', 'linux'], default: 'auto' },
    { name: 'theme', type: 'select', options: ['light', 'dark'], default: 'dark' },
  ],
  defaultSize: { w: 1280, h: 800 },
  animated: false,
}
```

### Primitive toys — sidebar

**`AppSidebarRow`**

```ts
controls: [
  { name: 'name', type: 'string', default: '/horton/abc123' },
  { name: 'status', type: 'select', options: ['idle', 'running', 'spawning', 'paused', 'stopped'], default: 'running' },
  { name: 'selected', type: 'boolean', default: false },
  { name: 'depth', type: 'number', min: 0, max: 4, step: 1, default: 0 },
  { name: 'theme', type: 'select', options: ['light', 'dark'], default: 'dark' },
]
defaultSize: { w: 240, h: 36 }
animated: false
```

**`AppSidebar`**

```ts
controls: [
  { name: 'theme', type: 'select', options: ['light', 'dark'], default: 'dark' },
  { name: 'rowCount', type: 'number', min: 3, max: 30, step: 1, default: 12 },
  { name: 'selectedIndex', type: 'number', min: 0, max: 30, step: 1, default: 2 },
  { name: 'expandedIndex', type: 'number', min: -1, max: 30, step: 1, default: 1 },
  { name: 'width', type: 'number', min: 200, max: 400, step: 10, default: 240 },
]
defaultSize: { w: 240, h: 700 }
animated: false
```

### Primitive toys — chat (leaf parts, reused desktop + mobile)

**`AppMessageBubble`**

```ts
controls: [
  {
    name: 'text',
    type: 'string',
    default: 'refactor this folder to use the new auth helper',
  },
  {
    name: 'theme',
    type: 'select',
    options: ['light', 'dark'],
    default: 'dark',
  },
]
animated: false
```

**`AppAgentResponse`** — the animated centrepiece.

```ts
controls: [
  { name: 'theme', type: 'select', options: ['light', 'dark'], default: 'dark' },
  { name: 'state', type: 'select', options: ['idle', 'thinking', 'streaming', 'completed'], default: 'streaming' },
  { name: 'progress', type: 'number', min: 0, max: 1, step: 0.01, default: 0.4 },
  { name: 'paused', type: 'boolean', default: false },
  { name: 'hasCodeBlock', type: 'boolean', default: true },
  { name: 'hasToolCall', type: 'boolean', default: true },
  { name: 'cps', type: 'number', min: 5, max: 200, step: 5, default: 60, label: 'Chars per sec' },
]
defaultSize: { w: 720, h: 480 }
```

When `state === 'streaming'`, the toy walks through a fixture string at `cps` chars/sec. `paused` freezes the timer. `progress` is a manual scrub for screenshots. `state: 'completed'` snaps to the fully-rendered end-state instantly.

**`AppMessageInput`**

```ts
controls: [
  {
    name: 'theme',
    type: 'select',
    options: ['light', 'dark'],
    default: 'dark',
  },
  { name: 'placeholder', type: 'string', default: 'Reply to Horton…' },
  { name: 'queuedCount', type: 'number', min: 0, max: 5, step: 1, default: 0 },
]
animated: false
```

### Primitive toys — workspace (tile shells + content parts)

**`AppTileShell`** — chrome only; the toy renders a placeholder content block in the slot for layout review.

```ts
controls: [
  { name: 'theme', type: 'select', options: ['light', 'dark'], default: 'dark' },
  { name: 'title', type: 'string', default: '/horton/abc123' },
  { name: 'density', type: 'select', options: ['comfortable', 'compact'], default: 'comfortable' },
]
defaultSize: { w: 600, h: 600 }
animated: false
```

**`ChatTileContent`** — composes bubble + agent response + composer inside an `AppTileShell`.

```ts
controls: [
  { name: 'theme', type: 'select', options: ['light', 'dark'], default: 'dark' },
  { name: 'paused', type: 'boolean', default: false },
  { name: 'progress', type: 'number', min: 0, max: 1, step: 0.01, default: 0.4 },
  { name: 'cps', type: 'number', min: 5, max: 200, step: 5, default: 60 },
  { name: 'density', type: 'select', options: ['comfortable', 'compact'], default: 'comfortable' },
]
defaultSize: { w: 760, h: 800 }
```

### Primitive toys — state explorer

**`AppStateRow`**

```ts
controls: [
  { name: 'pulsing', type: 'boolean', default: false },
  {
    name: 'theme',
    type: 'select',
    options: ['light', 'dark'],
    default: 'dark',
  },
]
animated: false
```

**`AppStateTable`**

```ts
controls: [
  { name: 'theme', type: 'select', options: ['light', 'dark'], default: 'dark' },
  { name: 'paused', type: 'boolean', default: false },
  { name: 'rowCount', type: 'number', min: 3, max: 30, step: 1, default: 8 },
  { name: 'pulseRate', type: 'number', min: 0, max: 5, step: 0.1, default: 0.5, label: 'Pulses/sec' },
]
defaultSize: { w: 480, h: 600 }
```

**`StateTileContent`** — `AppTileShell` + `AppStateTable`, same animation controls as the table.

### Scene toys (deliverables)

**`HeroChatStateScene`** — § 2 desktop column. Drops into `AppDownloadPage.vue` §2 in phase 8.

```ts
{
  id: 'scene-hero-chat-state',
  label: 'Scene — hero (chat + state)',
  group: 'app',
  description: 'Full window: titlebar + sidebar + chat tile + state tile. § 2 desktop column.',
  controls: [
    { name: 'os', type: 'select', options: ['auto', 'macos', 'windows', 'linux'], default: 'auto' },
    { name: 'theme', type: 'select', options: ['light', 'dark'], default: 'dark' },
    { name: 'paused', type: 'boolean', default: false },
    { name: 'progress', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'selectedSidebarIndex', type: 'number', min: 0, max: 12, step: 1, default: 2 },
    { name: 'splitRatio', type: 'number', min: 0.3, max: 0.85, step: 0.05, default: 0.6 },
    { name: 'cps', type: 'number', min: 5, max: 200, step: 5, default: 60 },
  ],
  defaultSize: { w: 1280, h: 800 },
}
```

**Responsive verification.** This toy MUST be dragged through the §4.6 breakpoint cascade during phase 6 review:

- 1280 × 800 → full window (titlebar + sidebar + 60/40 split)
- 850 × 530 → sidebar hidden, tile pair remains
- 650 × 410 → state tile dropped, chat fills workspace
- 450 × 280 → titlebar buttons stripped; just chat content reading

If any breakpoint produces broken layout (overflowing chrome, clipped text, weird tile gaps), the scene's container queries are wrong, not the primitives — fix in the scene's `<style scoped>` block.

**`MobileChatScene`** — § 2 mobile column. Drops into `AppDownloadPage.vue` §2 in phase 8.

```ts
{
  id: 'scene-mobile-chat',
  label: 'Scene — mobile chat',
  group: 'app',
  description: 'Phone frame + chat screen. § 2 mobile column.',
  controls: [
    { name: 'theme', type: 'select', options: ['light', 'dark'], default: 'dark' },
    { name: 'paused', type: 'boolean', default: false },
    { name: 'progress', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5 },
    { name: 'cps', type: 'number', min: 5, max: 200, step: 5, default: 60 },
  ],
  defaultSize: { w: 360, h: 640 },
}
```

**Aspect note.** The default size is **9:16**, not real-iPhone 9:19.5. This matches the App page §2 visual strap, which commits to `aspect="9/16"` for the mobile placeholder column (`AppDownloadPage.vue:1275` — the 2.4:1 column ratio is calibrated against this aspect; changing to 9:19.5 would force the desktop column to grow ~1.45× wider). The phone bezel renders slightly stubby relative to a real iPhone — acceptable; this is a marketing prop matching a marketing aspect, not a hardware test. If we ever want the "real iPhone" version, ship as a separate `MobileChatSceneTall` scene; primitives stay unchanged.

**Responsive verification.** Drag through:

- 360 × 640 → full phone frame (default)
- 320 × 570 → bezel padding shrinks proportionally; content unchanged
- 480 × 854 → frame scales up cleanly; no layout regression at oversized targets

---

## 7. Animation primitives

Each animated toy follows a tiny shared pattern, hand-written per toy (no shared driver — Vue makes this trivial enough that abstraction would be overkill):

```ts
// Pseudo-Vue. Each animated toy carries its own loop.
const props = defineProps<{
  state: 'idle' | 'thinking' | 'streaming' | 'completed'
  paused: boolean
  progress: number
  cps: number
  // ...
}>()
const internalProgress = ref(props.progress)
const driven = computed(() => props.state === 'streaming' && !props.paused)

let raf: number | null = null
let lastT = 0
let holdUntil = 0

const HOLD_AFTER_COMPLETION_MS = 3000

function tick(t: number) {
  if (!driven.value) {
    raf = null
    return
  }
  if (lastT === 0) lastT = t
  const dt = (t - lastT) / 1000
  lastT = t

  if (internalProgress.value >= 1) {
    // Hold-then-loop: sit at completed for HOLD_AFTER_COMPLETION_MS,
    // then snap back to 0 and start over. Predictable cadence is more
    // important than variety here — readers should be able to scrub
    // any frame and it should feel deliberate.
    if (holdUntil === 0) holdUntil = t + HOLD_AFTER_COMPLETION_MS
    if (t >= holdUntil) {
      internalProgress.value = 0
      holdUntil = 0
    }
  } else {
    internalProgress.value = Math.min(
      1,
      internalProgress.value + dt * (props.cps / FIXTURE_LENGTH)
    )
  }
  raf = requestAnimationFrame(tick)
}

watch(driven, (on) => {
  if (on) {
    lastT = 0
    holdUntil = 0
    raf = requestAnimationFrame(tick)
  } else if (raf !== null) {
    cancelAnimationFrame(raf)
    raf = null
  }
})
```

Specific animations:

- **Streaming Horton response.** `internalProgress` clamps a substring length over a fixture string. CSS-only blinking caret. Fixture string is one short paragraph, one fenced code block, one tool-call pill — enough to read as "a real coding agent talking" without reproducing the full markdown renderer. **Loop behaviour:** stream → hold for 3 s on the completed end-state → snap back to 0 → stream again. Predictable cadence; the same fixture string every loop.
- **State table row pulse.** A **deterministic** loop over a fixture list of row indices in `fixtures.ts` (e.g. `[0, 3, 1, 5, 2]`). Every `1 / pulseRate` seconds, advance the cursor, set `data-pulse="true"` on the row at that index for ~600 ms, CSS keyframe handles the lift. Wraps to the start of the list — same recording every cycle. (Random pulses look noisier, screenshot worse, and produce non-deterministic recordings.)
- **Tile split-open intro.** `IntersectionObserver` flips `data-state="open"` once per mount; CSS transitions `flex-basis: 100% → splitRatio` over 400 ms with `cubic-bezier(0.32, 0.72, 0, 1)` (matches the workspace's own ease).
- **Viewport-intersection start trigger.** Animated toys do _not_ start their `requestAnimationFrame` loop on mount — they wait for an `IntersectionObserver` to fire `isIntersecting` once. This means: (a) the brand-toys stage starts the animation as soon as the toy lands in view (always true at brand-toys default sizes), and (b) the App page hero strap doesn't burn CPU on the typewriter while it's scrolled off-screen. The same observer can drive the tile-split intro and the streaming start in one go.
- **Theme toggle.** Pure attribute swap on the toy's root: `data-theme="light"` ↔ `data-theme="dark"`. The `--ds-*` tokens cascade automatically.
- **Reduced motion.** Respect `@media (prefers-reduced-motion: reduce)` — kill the typewriter and pulses, snap to end-state. Already a token-css-friendly pattern.

---

## 8. Recommended implementation order

Each phase ends with at least one bookmarkable `/brand-toys?id=<slug>` URL so we can pause, screenshot, and review without committing to the next phase.

### Phase 1 — framework wiring + token probe

- Add `app` to `ToyGroup` in `website/src/components/brand-toys/toys.ts`, `GROUP_ORDER`, `GROUP_LABELS`.
- Add a `group-app` colour rule in `BrandToysIndex.vue` (suggested teal-leaning shade, ~`rgba(117, 251, 253, 0.14)` background / `#75fbfd` foreground — matches the app's dark accent).
- Land `website/src/components/brand-toys/app/tokens.css` (the rescoped copy) and `shared.css` (`@import './tokens.css'` + tiny utility helpers).
- Land `fixtures.ts` with hardcoded sidebar entities, chat fixture string, state-table rows.
- Land a single placeholder toy `app-tokens-probe` that renders a small grid of swatches (`--ds-bg`, `--ds-bg-subtle`, `--ds-surface`, `--ds-surface-raised`, `--ds-text-1`, `--ds-text-2`, `--ds-text-3`, `--ds-accent-9`, `--ds-border-1`, `--ds-divider`) inside `<div class="app-mockup-root" :data-theme="theme">`.
- **End-of-phase check:** in light mode the swatches read warm-white / navy ink, in dark mode they read deep-navy / accent-teal, regardless of the brand-toys page's forced dark mode.

### Phase 2 — chrome

- Add `website/src/components/app-download/useDetectedOs.ts` (per §4.5). Tiny composable; one place, used by `AppTitlebar` / `AppWindowFrame` and later by `AppDownloadPage.vue`'s phase-8 integration.
- `AppTrafficLights`, `AppTitlebar`, `AppWindowFrame`. Three small toys; build them side-by-side with screenshots of the real Electron window so the spacing/sizes line up. `AppTitlebar` and `AppWindowFrame` accept the new four-way `os` select (`auto | macos | windows | linux`); `auto` resolves via `useDetectedOs()`.
- **End-of-phase check (1):** the empty-content `AppWindowFrame` toy at 1280×800, light or dark, looks indistinguishable from the actual app window for the visitor's OS.
- **End-of-phase check (2):** flipping the `os` control to each explicit value renders the matching chrome variant — verify by side-by-side screenshots against the real Electron window on macOS and against `DesktopTitleBar.tsx` (Windows/Linux variant) on at least one non-Mac machine.

### Phase 3 — sidebar

- `AppSidebarRow` first (one row, all states), then `AppSidebar` (full panel with fixture data).
- Compare directly against `Sidebar.tsx` running locally via `pnpm dev:desktop`.
- **End-of-phase check:** opening `app-sidebar` at 240×700 dark looks like a clean cut-out of the real sidebar.

### Phase 4 — chat parts (animated)

- `AppMessageBubble` → `AppMessageInput` → `AppAgentResponse`. Build the leaf-level chat parts that both desktop and mobile scenes will reuse. Spend extra polish time on the typewriter cadence and code-block styling — this is the centrepiece animation.
- Compose `ChatTileContent` (= `AppTileShell` + the three chat parts) as the desktop chat-tile primitive.
- **End-of-phase check:** `chat-tile-content` with `paused=false` types out a Horton response over ~6–10 seconds and lands in a believable end-state.

### Phase 5 — state explorer parts (animated)

- `AppStateRow` → `AppStateTable` → `StateTileContent` (= `AppTileShell` + table).
- Pulses should feel calm — too fast reads as flashing UI, too slow reads as broken.
- **End-of-phase check:** `state-tile-content` at 480×600 with default rate looks alive but not noisy.

### Phase 6 — desktop scene: `HeroChatStateScene`

- Compose `AppWindowFrame` + `AppTitlebar` + `AppSidebar` + `ChatTileContent` + `StateTileContent` per the §4.6 example. Should be ~80–120 lines, mostly the `<style scoped>` `@container` queries.
- **End-of-phase check (1):** the scene at 1280×800 next to a real screenshot of the app at the same size — the eye should not be able to tell which is which without the cursor.
- **End-of-phase check (2) — responsive cascade:** drag the brand-toys stage through the §4.6 breakpoints (`850×530` sidebar gone; `650×410` state tile gone; `450×280` titlebar buttons stripped). At each step, layout reflows cleanly with no overflow, no clipping, no awkward gaps. If a breakpoint is wrong, fix the scene's container queries — primitives stay frozen.

### Phase 7 — mobile scene: `MobileChatScene`

- Build `AppPhoneFrame` and `MobileChatContent` primitives (header + reusing the existing `AppMessageBubble` / `AppAgentResponse` / `AppMessageInput` atoms inside a mobile-style log + composer). Compose into `MobileChatScene`.
- Smaller scope than the desktop scene — the only net-new chrome is the phone bezel, status bar, home indicator, and the mobile chat header.
- **End-of-phase check (1):** `scene-mobile-chat` at 360×640 dark looks like a clean cut-out of the Expo dev build's chat screen.
- **End-of-phase check (2) — responsive cascade:** drag through `320×570` (small phone) and `480×854` (oversized) — bezel padding adjusts, content does not overflow, aspect ratio handling looks deliberate.

### Phase 8 — landing-page integration

The App page (`AppDownloadPage.vue`) already has the §2 strap structure shipped — phases 1–4 of `APP_PAGE_PLAN.md` are merged. The strap looks like this today (around lines 325–349):

```vue
<Section id="visual">
  <div class="ad-visual-strap">
    <AdPlaceholder
      name="desktop-hero.png"
      sublabel="Sidebar tree + tile workspace · chat tile left · state explorer right"
      aspect="16/10"
    />
    <AdPlaceholder
      name="mobile-hero.png"
      sublabel="Mobile chat screen · same session, live streaming response"
      aspect="9/16"
    />
  </div>
  <p class="ad-visual-strap-caption mono">
    Same session. Two devices. One control plane.
  </p>
</Section>
```

Phase 8 replaces only the two `<AdPlaceholder>` calls — leave the `<Section>`, the `.ad-visual-strap` wrapper grid (the 2.4:1 column ratio that depends on these aspects, see `AppDownloadPage.vue:1275`), and the caption untouched. The scenes inherit the wrapper's grid sizing, and their internal container queries fire at the in-page rendered widths.

```vue
<Section id="visual">
  <div class="ad-visual-strap">
    <HeroChatStateScene os="auto" />
    <MobileChatScene />
  </div>
  <p class="ad-visual-strap-caption mono">
    Same session. Two devices. One control plane.
  </p>
</Section>
```

Sublabels are dropped on the swap — the scenes depict what they describe directly. The sublabels are the spec for what the scenes should show:

- **Desktop:** "Sidebar tree + tile workspace · chat tile left · state explorer right"
- **Mobile:** "Mobile chat screen · same session, live streaming response"

If `<HeroChatStateScene>` / `<MobileChatScene>` doesn't match those sublabels at the in-page rendered width, either the scene is wrong or its responsive breakpoints are wrong; don't rewrite the sublabel.

- **Section is _not_ `:dark`.** §2 respects the visitor's light/dark choice, so the scenes inherit the page theme (per §12 open question recommendation, and the auto-theme contract).
- **`os="auto"`** on the desktop scene picks up the visitor's OS via `useDetectedOs()` (§4.5).
- **Responsive verification on the live page:** view the App page at 1920px, 1024px, 768px, 480px viewports. The desktop scene's container queries should fire as the strap column narrows (sidebar drops first, then state tile). The mobile scene scales without overflow at every viewport.
- **`AppDownloadPage.vue:330-332` carries a stale comment** referring to `APP_PAGE_PLAN.md` phase 5 swapping in screenshots. Update that comment in the same diff to reference this plan instead — phase 5 of the App page plan is now satisfied by phase 8 of this plan.
- **End-of-phase check:** the App page §2 strap renders both scenes side by side, both animated, both respecting the page's light/dark mode, no missing assets in the build, no layout shift vs. the placeholder version (column ratio + caption position unchanged), and the responsive cascade reads correctly across viewport widths.

Phases 1–7 are reviewable in `/brand-toys` without touching user-visible pages. Phase 8 is the only one that affects `AppDownloadPage.vue`. The plan ships as a single PR; phases are an authoring aid, not a release boundary.

#### Future scenes — out of scope here, enabled by this plan

Per the §4.6 scene catalog, every other `AdPlaceholder` slot on `AppDownloadPage.vue` is a candidate for a future scene built on these primitives — `ScenarioWorkersScene` for §3.5, `MobileSessionListScene` for §7b, `ModeChatScene` thumbnails for §3, etc. Those are separate plans. Each one cites this plan for the primitive contract, adds any missing content parts (typically one new `*TileContent` or `Mobile*Content`), and writes the scene SFC composing primitives. No primitive ever changes shape to accommodate a new scene; primitive changes are themselves primitive-level edits reviewed against the running product.

---

## 9. Mapping every visual claim back to source

When laying out a toy, the corresponding React/CSS source is the reference. Match geometry, type sizes, paddings and colours from the listed file — do not eyeball them.

| Mockup surface                 | Reference source                                                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design tokens                  | `packages/agents-server-ui/src/ui/tokens.css`                                                                                                                                                                                         |
| Window frame (rounded, shadow) | Drawn entirely in CSS — `border-radius: 10px` on the outer frame for the macOS look, `border-radius: 6px` for Windows/Linux. We are NOT delegating to OS-level window rounding (the mockup is HTML, not an Electron `BrowserWindow`). |
| macOS traffic lights           | Native; reproduce as 3× 12px circles, 8px gap, ~14px from window edge — colours `#ff5f57` / `#febc2e` / `#28c840`                                                                                                                     |
| Windows/Linux titlebar         | `packages/agents-server-ui/src/components/DesktopTitleBar.tsx` + `DesktopTitleBar.module.css`                                                                                                                                         |
| Sidebar root                   | `packages/agents-server-ui/src/components/Sidebar.tsx` + `Sidebar.module.css` (`SIDEBAR_DEFAULT_WIDTH = 240`)                                                                                                                         |
| Sidebar row                    | `SidebarRow.tsx` + `SidebarRow.module.css` (height `--ds-row-height-md = 28px`)                                                                                                                                                       |
| Sidebar header                 | `SidebarHeader.tsx` + `SidebarHeader.module.css`                                                                                                                                                                                      |
| Tile header                    | `MainHeader.tsx` + `MainHeader.module.css`                                                                                                                                                                                            |
| Tile container                 | `components/workspace/TileContainer.tsx` + `TileContainer.module.css`                                                                                                                                                                 |
| Split / splitter               | `components/workspace/SplitContainer.module.css` + `Splitter.module.css`                                                                                                                                                              |
| User message bubble            | `UserMessage.tsx` + `UserMessage.module.css`                                                                                                                                                                                          |
| Agent response                 | `AgentResponse.tsx` + `AgentResponse.module.css`; tool-call cards in `ToolCallView.tsx` + `toolBlock.module.css`                                                                                                                      |
| Code block                     | `MarkdownCodeBlock.tsx` (we will not bundle Shiki — paint a single hand-styled code block)                                                                                                                                            |
| Composer / message input       | `MessageInput.tsx` + `MessageInput.module.css`                                                                                                                                                                                        |
| Entity timeline (scroll body)  | `EntityTimeline.tsx` + `EntityTimeline.module.css`                                                                                                                                                                                    |
| State explorer table           | `components/stateExplorer/*` — match table row geometry, header band, and the `--ds-*` status hue colours                                                                                                                             |

If a surface isn't in this table, ask before mocking it — we are deliberately not replicating settings pages, MCP picker, credentials forms etc.

---

## 10. What we explicitly will not replicate

Worth being honest about up front. None of these are needed for the §2 hero strap or any phase deliverable in this plan.

- **Real markdown rendering.** No Streamdown, no Shiki, no KaTeX. The fake response paints one paragraph + one fenced code block + one tool-call pill, all hand-styled.
- **Real entity tree dynamics.** Fixed sidebar tree, no expand/collapse animation work. The `expandedIndex` control swaps to a different fixture rather than animating.
- **Real virtualization.** Doesn't matter at hero scale.
- **All the obscure surfaces** — settings pages, MCP picker, credentials, working-directory picker, onboarding modal. Out of scope.
- **Live data.** No `ElectricAgentsProvider`, no `ShapeStream`, no fixture-mode plumbing. The fixtures live as plain TypeScript constants in `fixtures.ts`.
- **Pixel-exact macOS native chrome.** Traffic lights are ours, drawn as SVG. We are not trying to reproduce Apple's exact button hover behaviour.

---

## 11. Out of scope for this plan

- **`@electric-ax/agents-ui-tokens` shared package.** The cleaner long-term home for `tokens.css`. Tracked separately; the copy approach in §4 is the bridge until that lands.
- **Future scenes beyond `HeroChatStateScene` + `MobileChatScene`.** The §4.6 scene catalog enumerates them — `ScenarioWorkersScene`, `MobileSessionListScene`, `ModeChatScene` thumbnails, `OgHeroScene`, etc. The primitives this plan ships are designed to support all of them, but each scene is a separate plan with its own review. We do not pre-build "just in case" scenes.
- **New content parts.** `ChatTileContent` and `StateTileContent` are the only `*TileContent` parts in scope. Future scenes that need a workers grid, an entity timeline, or a credentials panel introduce new content parts as part of those scenes' plans.
- **`MockupScaleFit` helper.** The `transform: scale()` escape hatch in §4.6 is a documented option, not a deliverable. We add the helper component when an actual consumer (likely `OgHeroScene`) needs it.
- **Live React embedding inside the website (option 2).** Firmly off the table per §2 — the dep tree is too heavy for a marketing page and SSR-vs-React is a fight we don't need.
- **Iframed live mockup (option 3).** Deferred future option per §2, not blocked. If we later want a fully-live mockup for launch material, the option is open; this plan just doesn't deliver it.
- **Any new product capabilities.** This plan adds no features to the desktop app, the mobile app, or the agents server — it ships a marketing visual kit.

---

## 11.5. Operational notes

- **Browser support.** `tokens.css` is built on `color-mix(in oklab, …)`. That requires Chrome 111+, Safari 16.2+, Firefox 113+ (April 2023). It's already a hard requirement of `agents-server-ui`; the marketing site ships the same evergreen-only contract via VitePress, so no new floor. Older browsers will see broken token resolution — same as the rest of the agents UI.
- **Bundle-weight expectation for phase 8.** The brand-toys uses are lazy-loaded for free (every toy imports via `defineAsyncComponent`). The App page §2 will eagerly mount both scenes — that's ~16–18 small SFCs (primitives + 2 scenes) + the rescoped `tokens.css` (~500 lines) + `fixtures.ts` (a few KB). Estimated incremental impact on `AppDownloadPage.vue`: ~25–40 KB of JS+CSS post-minification, no runtime deps beyond Vue. Reasonable for a hero strap; if it creeps higher, lazy-load the scenes with `defineAsyncComponent` from inside `AppDownloadPage.vue` and gate on `IntersectionObserver`.
- **Scope of the OS-detection composable.** `useDetectedOs()` (per §4.5) lives at `website/src/components/app-download/useDetectedOs.ts` so the App page and the mockup share one implementation. If a future page wants the same detection (homepage hero, OG image renderer), promote to `website/src/composables/` — same import path, same behaviour.
- **Phase 0 smoke test.** Before phase 1, run `pnpm --filter @electric-sql/docs dev` and confirm `/brand-toys` loads cleanly (existing toys render, group chips work). 30-second check; surfaces any harness regression upfront so we don't blame our own scaffolding for it.

---

## 12. Open questions

- ~~**Window-frame style: macOS-only, or animated through OS?**~~ _Resolved: the mockup auto-detects the visitor's OS and renders the matching chrome (see §4.5). A Mac visitor sees traffic lights; a Windows visitor sees the Windows controls; a Linux visitor sees the Linux variant. The toy keeps explicit `os` overrides in `/brand-toys` so we can capture per-OS screenshots for the §7 download cards later, but the App page hero ships with `os="auto"`._
- **Dark default vs respect site theme.** The App page hero looks loudest in dark, but the rest of the page respects the visitor's light/dark choice. Recommend: the mockup follows the website theme (so a light-mode visitor sees a light mockup), with the option to force `data-theme="dark"` via a prop if we ever want a "loud" placement (e.g. the homepage hero).
- **Phase 4 cadence.** The streaming typewriter rate (`cps` default `60`) is a guess. Settle it during phase 4 by recording a real Horton response and matching the perceived pace, not by counting tokens.
- **Phase 7 scope creep risk.** The `MobileChatScene` reuses three desktop atoms (`AppMessageBubble`, `AppAgentResponse`, `AppMessageInput`), so most of the work is `AppPhoneFrame` + `MobileChatContent` + the scene composition. If phase 7 grows beyond ~half a day, scope down — drop the mobile scene from this plan and ship the App page §2 with a mobile placeholder (or real Expo screenshot) instead. Better to land phases 1–6 + 8 cleanly than to bloat the PR. This is the only phase with real "cut it" pressure; the others are sized to stay small.
- **Animation fallback for OG / static social.** Recordings work for tweets and blog posts, but Open Graph images need a still. Recommend: capture the `state: 'completed'` snapshot from the toy at a fixed `progress=1` and use that as the OG image.
