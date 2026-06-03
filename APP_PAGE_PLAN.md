# /app page revamp — plan

> **Status:** draft for review.
> **Goal:** turn `website/app.md` (`AppDownloadPage.vue`) from a Cursor-style downloads index into a real product landing page that explains what `@electric-ax/agents-desktop` + `@electric-ax/agents-mobile` actually do.
> **Tone:** matches existing landing pages — `agents-home`, `streams-home`, `sync-home`, `cloud-home`. Reuses `Section`, `BottomCtaStrap`, `InstallPill`, `HeroNetworkBg`-style chrome.
> **Author/agent note:** all desktop/mobile capability claims below are grounded in code that is already in `packages/agents-desktop` and `packages/agents-mobile` — nothing on this page should make promises the apps don't keep.

---

## 1. Why the current page underdelivers

`website/app.md` → `src/components/app-download/AppDownloadPage.vue` is today:

```text
┌─────────────────────────────────────┐
│ Hero (text only)                    │  Electric Agents App
│   "A native home for your           │
│    long-running agents."            │
│   [Download for Mac] [Other …]      │
├─────────────────────────────────────┤
│ Desktop  — per-platform cards       │
│   mac arm / mac x64 / win / linux   │
├─────────────────────────────────────┤
│ Mobile · Coming soon                │  ← actually working; not just "soon"
│   ios / android (disabled)          │
├─────────────────────────────────────┤
│ Canary builds                       │
├─────────────────────────────────────┤
│ Bottom CTA (Quickstart, Docs, Cloud)│
└─────────────────────────────────────┘
```

The hero copy is one line of vague positioning, the screenshot slot is an explicit `TODO`, and **every section below the fold is about which `.dmg` to grab**. The page sells nothing about what the app does.

What it **should** sell, in priority order:

1. **It is one app for the whole platform**, not just a chat client.
   - Coding locally with Horton.
   - Attaching to remote sessions spawned by CI / webhooks / issues / cron — software-factory-style workflows.
   - Observing and steering the agents _you are building_ on the Electric Agents infra and SDK — state explorer, entity timeline, fork-from-here, MCP, skills, working-directory picker.
2. **It works across devices and users.** Desktop on macOS / Windows / Linux today, native mobile on iOS / Android in active development, all looking at the same durable Electric streams. Multi-server, multi-tenant, Electric Cloud sign-in built in. _The mobile apps preview on this page but are not yet available from a public app store — see §7._
3. **The bundled Horton.** General-purpose chat agent and coding agent in the same app — pick a model (Anthropic / OpenAI / DeepSeek / Moonshot / Codex), point at a working directory, go.
4. **It bridges local and cloud.** Your laptop can act as a pull-wake runner for cloud agents, so the same desktop is both a UI and a worker.

That is the story this page is missing.

---

## 2. The unifying narrative — one app, three jobs

The user-facing pitch we land on:

> **One app, three jobs, one platform.**
>
> Electric Agents is durable infrastructure for long-running agents, with an SDK for shipping your own. The desktop and mobile apps are how you work with that platform — whether you're **building** agents, **running** them, or **steering** them while they work.
>
> - **Code with Horton, locally** — chat with a bundled coding agent that can read, write and edit files in any directory you point it at.
> - **Attach to remote sessions** — sessions spawned by CI, webhooks, GitHub issues, cron or your own software factory show up live in the sidebar. Pick one up on your laptop. Continue it on your phone.
> - **Introspect your own agents** — the same app is the dev tool for the entities you write with the SDK. State explorer, entity timeline, fork-from-here, MCP, skills.
>
> One UI. One streaming control plane. Many devices, many users.

**On the "software factory" phrase.** It's a useful frame for the middle bullet — remote sessions spawned by CI / webhooks / issues — but it is **not** the headline. The page mentions it in this §2 pitch block, in the §3 "Attach remotely" card body, and in §3.5 scenario 1, then moves on. The page hero (see §1 Hero in the section-by-section block below) deliberately omits the phrase — the main narrative is _one app for the whole platform_; software factory is one named scenario within it.

The phrase already shows up in `website/blog/posts/2026-03-26-stream-db.md`; this page is the first place we let it act as a named scenario rather than a throwaway aside.

---

## 3. Page structure (8 sections)

```text
┌─────────────────────────────────────────────────────────────┐
│ §1 HERO                                                     │
│    Headline + sub + primary CTA (platform-detected)         │
│    Glyph row: macOS · Windows · Linux · iOS · Android       │
│    Release-notes link                                       │
├─────────────────────────────────────────────────────────────┤
│ §2 VISUAL STRAP (desktop + mobile screenshots side by side) │
│    "Same session, two devices" — illustrates multi-device   │
├─────────────────────────────────────────────────────────────┤
│ §3 THREE WAYS TO USE IT  (three feature cards + scenarios)  │
│    [Code]   [Attach]   [Introspect]                         │
│    local    remote     SDK                                  │
├─────────────────────────────────────────────────────────────┤
│ §3.5 SCENARIOS  (worked end-to-end examples)                │
│    GitHub issue → CI → triage on phone → finish on desk · … │
├─────────────────────────────────────────────────────────────┤
│ §4 MULTI-DEVICE, MULTI-USER                                 │
│    Diagram: phone ↔ Cloud ↔ desktop-runner                  │
│    Cloud sign-in, pull-wake runner, shared sessions         │
├─────────────────────────────────────────────────────────────┤
│ §5 BUNDLED HORTON                                           │
│    Model picker, working dir, tools, skills, /slash         │
│    BYO keys (OS keychain) or sign in to Codex               │
├─────────────────────────────────────────────────────────────┤
│ §6 BUILT FOR BUILDERS                                       │
│    State explorer, entity timeline, fork-from-here, MCP,    │
│    local discovery, tile workspace, deep-link layouts       │
├─────────────────────────────────────────────────────────────┤
│ §7 DOWNLOAD                                                 │
│    Desktop per-platform cards (current §2)                  │
│    Mobile · Preview card → packages/agents-mobile on GitHub │
│    Canary builds (current §4)                               │
├─────────────────────────────────────────────────────────────┤
│ §8 BOTTOM CTA STRAP                                         │
│    "Build with Electric Agents" — Quickstart, Docs, Cloud   │
└─────────────────────────────────────────────────────────────┘
```

Every section uses the existing `<Section>` block from `website/src/components/agents-home/Section.vue` (eyebrow chip + brand-accented title + subtitle + body slot). The hero and the bottom CTA reuse `<BottomCtaStrap>` and the matching hero pattern from `<AgentsHero>`.

---

## 4. Section-by-section copy + structure

### §1 Hero

```text
                    ┌─────────────────────────────┐
                    │   run · observe · steer     │   ← mono strap
                    └─────────────────────────────┘

              Electric Agents App
                       ^^^ brand-accent (cyan), no period

       Desktop and mobile clients — one app to code with
       Horton, attach to remote sessions, and build your
       own agents on the infra and SDK.

          ┌──────────────────────────┐  ┌────────────────┐
          │  Download for Mac (M-)   │  │ Other platforms│
          └──────────────────────────┘  └────────────────┘

                Apple │ Windows │ Linux │ iOS │ Android
                       (glyph row, muted)
                                    ^^^^^^^^^^^^^^ preview
                       ↑ vertical divider between desktop
                         (Apple/Win/Linux) and mobile (iOS/Android)
```

- **Strap:** `run · observe · steer` rendered as a small mono lead-line above the H1. Demotes the old verb-chain headline so the product name can land as the brand mark.
- **Headline (H1):** `Electric Agents App` — `App` carries the brand-accent (cyan), matching the `Electric <Agents>` treatment from `<AgentsHero>`. **No trailing period** — keeps the punctuation aligned with the `/agents` hero convention and avoids a non-accented `.` floating after the cyan word.
- **Sub:** `Desktop and mobile clients — one app to code with Horton, attach to remote sessions, and build your own agents on the infra and SDK.`
- **Primary CTA:** platform-detected download button (existing behaviour; keep `detectMacArch()`).
- **Secondary CTA:** `Other platforms` jumping to `#desktop`.
- **Glyph row** under the CTAs: 5 platform glyphs in a muted row, with a thin vertical divider between the three desktop glyphs and the two mobile glyphs. Communicates the desktop/mobile split visually. iOS + Android carry a small `Preview` mark (single label under the pair) — see §7 for the matching mobile section.
- **No `Release notes` link in the hero.** The link lives under the §7a desktop download grid where it belongs (it documents desktop releases specifically).

> Why this matters: the current hero is text-only and the platform breadth is buried in §2/§3. Surfacing macOS / Windows / Linux / iOS / Android above the fold reframes the page from "download a desktop app" to "download an app for your fleet".

### §2 Visual strap

```text
┌─────────────────────────────────────────────────────────────┐
│  ┌────────────────────────────────┐    ┌─────────────────┐  │
│  │  Desktop window                │    │  Phone          │  │
│  │  Sidebar tree · tile workspace │    │  Same session,  │  │
│  │  Horton chat in left tile      │    │  chat view      │  │
│  │  State explorer in right tile  │    │                 │  │
│  └────────────────────────────────┘    └─────────────────┘  │
│                                                              │
│       "Same session. Two devices. One control plane."        │
└─────────────────────────────────────────────────────────────┘
```

- No copy headline of its own — this is a between-section strap that makes the hero believable.
- We will need to **capture two real screenshots** for this:
  - Desktop: a session with the sidebar tree visible + a split tile workspace (chat on the left, state explorer on the right) — proves both "regular UI" and "dev tool" in one image.
  - Mobile: the chat session screen from `packages/agents-mobile/src/screens/SessionScreen.tsx` showing the _same_ session URL.
- File the resulting assets under `website/public/img/app/`. Suggested filenames: `desktop-hero.png`, `mobile-hero.png`, plus 2× variants.

### §3 Three ways to use it

This section does the heavy positioning lift. It is also where the **software-factory** scenario is named (in the middle card), without being made the whole pitch.

```text
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  CODE LOCALLY    │  │  ATTACH REMOTELY │  │  BUILD WITH SDK  │
│                  │  │                  │  │                  │
│  Bundled Horton  │  │  Sessions spawned│  │  State explorer  │
│  with bash /     │  │  by CI, webhooks,│  │  + entity        │
│  read / write /  │  │  GitHub issues,  │  │  timeline for    │
│  edit / search / │  │  cron, or your   │  │  the agents YOU  │
│  workers.        │  │  software        │  │  build with the  │
│                  │  │  factory show up │  │  SDK.            │
│  Point it at any │  │  live in your    │  │                  │
│  folder, BYO     │  │  sidebar. Pick   │  │  Fork from any   │
│  keys.           │  │  one up, steer   │  │  point. MCP +    │
│                  │  │  it, hand it     │  │  skills + tile   │
│                  │  │  off.            │  │  workspace.      │
│                  │  │                  │  │                  │
│  You can:        │  │  You can:        │  │  You can:        │
│  · refactor a    │  │  · pick up a CI- │  │  · watch a stuck │
│    folder        │  │    spawned PR    │  │    entity live   │
│  · bisect a bug  │  │    review on     │  │  · fork to A/B   │
│  · scaffold a    │  │    your phone    │  │    a prompt fix  │
│    project       │  │  · steer a GitHub│  │  · trace a       │
│  · review a diff │  │    triage agent  │  │    failed worker │
└──────────────────┘  └──────────────────┘  └──────────────────┘
                  one integrated platform
```

- **Section eyebrow:** _none_. Earlier drafts carried a `WHAT YOU CAN DO` section eyebrow, but it just restated the title `Three ways to use it.` and added chrome we don't need. See the "Copy review pass" note at the end of this section.
- **Card eyebrows:** _none on any of the three cards_. Earlier drafts carried `Code locally` / `Attach remotely` / `Build with the SDK` per-card eyebrows; they were near-duplicates of the sentence-form titles. The card titles now do the categorisation work on their own.

**Tightening pass (locked).** An earlier version of the cards had ~40-50-word paragraphs and 3 long-form bullets per card; the section read as a wall of text relative to the rest of the page. The current locked copy halves each body (≈18-27 words) and uses 4 short one-line bullets per card. The model enumeration was dropped from card 1 (it's already in §5 pillar 1); the device-handoff sentence was dropped from card 2 (it's the topic of §4); the 7-feature enumeration in card 3's body was trimmed to 3 features (§6 expands on the rest).

- **Card 1 — "Code with Horton, locally."**
  - Body: Horton ships in the desktop. Pick a model, point at a directory, chat to a coding agent that edits, runs bash, and spawns parallel workers.
  - **You can:** (locked, 4 short bullets)
    - Refactor a folder, one worker per file
    - Bisect a regression — one worker repros, one fixes
    - Edit code, run bash, search the web in one chat
    - Learn Electric Agents with `/quickstart`
  - **`/quickstart` framing.** `packages/agents/skills/quickstart.md` describes itself as `Guided quickstart — build a full Electric Agents app from entity to frontend` — it walks the user through building a manager/worker app on the SDK. The earlier "scaffold a fresh project with `/init`, then iterate with `/quickstart`" bullet mis-framed this as a generic dev workflow; the corrected bullet ties Horton's slash skills to Electric Agents learning, which is what they actually do. `/init` was dropped from the bullet to keep it to one verb — it is still discoverable in-app.
  - Backed by: `packages/agents-desktop/src/runtime/lifecycle.ts` (BuiltinAgentsServer), `packages/agents/src/agents/horton.ts`, `WorkingDirectoryPicker`, `ApiKeysForm`, `CredentialsPage`.

- **Card 2 — "Attach to remote sessions."**
  - Body: Connect to any agents-server — your own or Electric Cloud. Sessions spawned by CI, webhooks, GitHub issues, cron or your software factory show up live.
  - **You can:** (locked, 4 short bullets)
    - Triage a GitHub-issue session on the phone, finish on the desk
    - Steer a CI agent before its PR merges
    - Pause and resume a cron-triggered pipeline
    - Hand a session off between devices mid-run
  - **Multi-user is the topic of §4.** An earlier draft of this card had a `Hand a session off to a teammate by sharing the entity URL — the multi-user view sees the same stream.` bullet. That claim is the explicit topic of §4 pillar 2; the trimmer locked here keeps mid-run device handoff (single user, multi-device) and leaves the teammate-handoff claim to §4 where it has room to breathe.
  - Backed by: `ServersPage` (multi-server config), `cloud-auth.ts` + `cloud-agent-servers.ts`, `local-discovery.ts`, mobile `ServerSetupScreen` / `SessionListScreen` / `SessionMenu` (signal stop/steer).

- **Card 3 — "Build your own agents."**
  - Body: It's also the dev tool for the entities _you_ write with the SDK (`@electric-ax/agents-runtime`) — state explorer, timeline, fork-from-here.
  - Title note: an earlier draft of this plan repeated the eyebrow text as the title (`"Build with the SDK."`), which read as redundant once both lines sat in the rendered card. The locked title mirrors cards 1 and 2 — verb + object — and connects to the body's "the entities _you_ write" emphasis. The eyebrow has since been removed entirely (see top of §3).
  - Feature-list trim: the original body listed 7 features (state explorer, entity timeline, fork-from-here, manifest drawer, MCP servers, skills, tile workspace). The trim picks 3 as a scannable sample; §6 "Built for builders" carries the full 6-card grid so nothing is lost.
  - **You can:** (locked, 4 short bullets)
    - Watch a stuck entity's inbox + runs in real time
    - Fork any past point to A/B test a change
    - Step through a failed worker without redeploying
    - Tile parent + workers side-by-side
  - Backed by: `StateExplorerPanel`, `EntityTimeline`, `EntityContextDrawer`, `Workspace` + `TileContainer`, `McpServersPage`, `useExpandedTreeNodes`.

- **Strip under the cards** (one line, centred, muted):
  `One integrated platform — code, attach, and build in one app.`

### §3.5 Scenarios

A 2×2 (or horizontally-scrolling) strip of worked end-to-end examples. The purpose is to take the abstract "one app, three jobs" pitch and make it visceral — by the time the reader leaves this section, they should be picturing themselves doing one of these.

```text
┌──────────────────────────────────────────────────────────────┐
│  Scenario 1                                                  │
│    GitHub issue → CI spawns Horton → triage on phone →       │
│    finish on desk                                            │
│                                                              │
│    Your software factory opens a new agent session on        │
│    Electric Cloud — a fresh GitHub issue, an                 │
│    `issue_comment`, or a `workflow_dispatch` from CI. You    │
│    get a notification on your phone, skim the diff Horton    │
│    drafted, push back a steering message ("don't touch the   │
│    migration files"), then pick up on your laptop to merge.  │
│                                                              │
│    Touches:  Cloud · mobile · steer · stop · review          │
├──────────────────────────────────────────────────────────────┤
│  Scenario 2                                                  │
│    Local refactor with parallel workers                      │
│                                                              │
│    Open the desktop, point Horton at a repo, ask for a       │
│    rename across packages. Horton spawns a worker per        │
│    package, you watch all four in a 2×2 tile workspace,      │
│    fork the one that took the wrong turn, ship the diff.     │
│                                                              │
│    Touches:  desktop · working-dir · workers · tile · fork   │
├──────────────────────────────────────────────────────────────┤
│  Scenario 3                                                  │
│    Build an agent on the SDK, debug it without a redeploy    │
│                                                              │
│    You ship a custom `summarizer` entity with the SDK.       │
│    It's getting stuck on certain inputs. Open the state      │
│    explorer, watch its shared state evolve, fork the         │
│    failing session, change the prompt, replay.               │
│                                                              │
│    Touches:  SDK · state explorer · timeline · fork · MCP    │
├──────────────────────────────────────────────────────────────┤
│  Scenario 4                                                  │
│    Cron-triggered overnight pipeline                         │
│                                                              │
│    Cron kicks off a nightly research agent on the cloud      │
│    server. Open the mobile app in the morning, see what      │
│    it found, hand off the most promising lead to a fresh     │
│    session for follow-up.                                    │
│                                                              │
│    Touches:  Cloud · cron wake · mobile · fork · send        │
└──────────────────────────────────────────────────────────────┘
```

- **Section eyebrow:** _none_. Earlier drafts had `SCENARIOS` above the title; the title `What this looks like in practice.` is enough.
- **Headline:** `What this looks like in practice.`
- **Sub:** Four short stories that span the three modes above. None of them require code you don't have today.
- Format suggestion: render as four cards with the `Touches: …` line as in-card metadata in mono, the title in semi-bold, then ~3 lines of body. Reuse the `.ad-platform-card` chrome from the current page so the visual rhythm doesn't fork.
- **Implementation note:** each scenario gets a placeholder image slot at the top of the card (`<div class="ad-scenario-illo" data-placeholder="scenario-1.png">`). We'll fill those in later when we capture the actual flows; PR ships with a styled placeholder block.
- **Locked body trims** (copy-review pass): each scenario body lost one line to tighten the cards.
  - Scenario 1: dropped the `issue_comment` / `workflow_dispatch` enumeration and the `("don't touch the migration files")` parenthetical, leaving `…from a fresh GitHub issue or a CI dispatch.`
  - Scenario 2: dropped `you watch all four in a 2×2 tile workspace` (the tile workspace is the topic of §6 already).
  - Scenario 3: dropped `watch its shared state evolve` (implied by `Open the state explorer`).
  - Scenario 4: dropped `see what it found,` (the next clause makes the same point).

Backed by: every capability cited is a composition of the features already mapped in §5 of this doc. No new code required to ship the page.

### §4 Multi-device, multi-user

```text
                ┌────────────────────────┐
                │   Electric Streams /   │
                │   Electric Cloud       │
                │   ◯  durable agents    │
                └────────────────────────┘
                       ▲              ▲
                       │              │  pull-wake runner
                  sees+steers     registers itself,
                       │          sees+steers
                       │              │
                  ┌────────┐    ┌──────────┐
                  │ phone  │    │ desktop  │
                  │        │    │ (also a  │
                  │        │    │ worker)  │
                  └────────┘    └──────────┘
```

- **Section eyebrow:** _none_. Earlier drafts had `MULTI-DEVICE` above the title; the title is `Multi-device, multi-user.` so the eyebrow was pure repetition.
- **Headline:** `Multi-device, multi-user.`
- **Body:** Agents run on the server, not the client. The desktop and mobile apps are live views into the same Electric streams — open the same session from your laptop and your phone, hand work off between devices, share a workspace with your team. Sign in once with GitHub or Google; your Electric Cloud workspaces appear automatically. The desktop can even register itself as a pull-wake runner so your laptop becomes a worker for your cloud agents — close the lid and they finish on the next runner that comes online.
- Backed by: `cloud-auth.ts` (GitHub/Google OAuth), `cloud-agent-servers.ts`, `pullWake` config in `BuiltinAgentsServer` startup, mobile `CloudAuthContext` + `CloudServerPicker`.
- **No screenshot needed** — keep the ASCII flavour or render the diagram as an inline SVG matching the existing `EntityOverviewDiagram.vue` style (already in `website/src/components/`).
- **Multi-user is a kept-forward claim.** Pillar 2 reads `Share a session with a teammate by sharing its URL — the multi-user view sees the same stream.` "Multi-user view" is a feature we are actively building; it is intentionally a forward-looking claim. Do not drop or hedge this language in future passes — the platform pitch depends on it.

### §5 Bundled Horton

```text
┌─────────────────────────────────────────────┐
│  Bundled Horton                             │
│                                             │
│  Tools:                                     │
│    bash · read · write · edit               │
│    web_search · fetch_url                   │
│    spawn_worker · send · skills             │
│                                             │
│  Providers (you BYO key, OS keychain):      │
│    Anthropic · OpenAI · DeepSeek            │
│    Moonshot · Brave Search · E2B            │
│    — or sign in to Codex (OAuth /           │
│      codex-cli / opencode auth)             │
│                                             │
│  /slash skills: /quickstart · /init · …     │
└─────────────────────────────────────────────┘
```

- **Section eyebrow:** _none_. Earlier drafts had `BUNDLED AGENT` above the title; the title `Horton, in the box.` already conveys "bundled".
- **Headline:** `Horton, in the box.`
- **Sub:** A friendly, capable general-purpose chat agent with code-editing superpowers — no server-side setup required.
- Three sub-bullets:
  - **Pick your provider.** Bring your own API key (stored in the OS keychain), or sign in to Codex. Anthropic, OpenAI, DeepSeek and Moonshot for models; Brave Search and E2B for tools.
  - **Pick your working directory.** Horton reads and edits whatever you point it at — no per-project install. The picker walks your filesystem; recent directories surface automatically.
  - **Skills + slash commands.** Type `/quickstart` to learn Electric Agents itself; write your own skills to ship reusable workflows.

Provider-list rationale: the locked pillar 1 body explicitly splits the §5 ASCII's "Providers" listing into _models_ (Anthropic, OpenAI, DeepSeek, Moonshot) and _tools_ (Brave Search, E2B). The ASCII grouped them all under "Providers (you BYO key, OS keychain)" but rendering them as a single set in the pillar body reads as imprecise once Brave/E2B sit next to Anthropic/OpenAI — they're different kinds of providers, both happen to share the BYO-key pattern.

Pillar 1 trim rationale: an earlier draft ended with `— keys never leave your machine.` This was a near-tautology with `stored in the OS keychain` and added a security-y flavour that didn't land — dropped in the copy-review pass.

Pillar 3 `/quickstart` framing: `packages/agents/skills/quickstart.md` is `Guided quickstart — build a full Electric Agents app from entity to frontend` — i.e. a guided way to **learn Electric Agents itself** by building a multi-agent tutorial app on the SDK, not generic onboarding for the desktop app. An earlier draft called it `the guided onboarding skill`, which mis-framed what it does. The locked body explicitly says `learn Electric Agents itself` to match the skill's actual scope.

`SecretStore` reference removed: pillar 1 used to mention `<code>SecretStore</code>` as the keychain wrapper. Dropped in the copy-review pass — internal implementation name with no value to the reader; `OS keychain` is enough.

- **Things you can ask Horton to do** (3-column list, short verbs):
  - _Chat:_ `Summarise this docs page`, `Plan a refactor`, `Explain this stack trace`, `Draft a launch tweet`.
  - _Code:_ `Refactor this file`, `Write tests for X`, `Bisect this regression`, `Apply the same change across these 4 files`.
  - _Research:_ `Find the latest spec for Y`, `Diff what changed since v1.2`, `Pull the open PRs touching this dir`.
- Backed by: `packages/agents-desktop/src/credentials/`, `WorkingDirectoryPicker`, `OnboardingModal`, `createSkillTools`, `createHortonDocsSupport`, `createHortonTools` in `packages/agents/src/agents/horton.ts`.

### §6 Built for builders

```text
┌──────────────────────┐ ┌──────────────────────┐
│  TILE WORKSPACE      │ │  STATE EXPLORER      │
│  Split right/down    │ │  Live view of every  │
│  cycle, find,        │ │  shared-state source │
│  ?layout= deep link  │ │  per entity          │
└──────────────────────┘ └──────────────────────┘
┌──────────────────────┐ ┌──────────────────────┐
│  ENTITY TIMELINE     │ │  MCP & SKILLS        │
│  Runs, inbox,        │ │  Add MCP servers,    │
│  manifests,          │ │  OAuth handled       │
│  fork-from-here      │ │  natively, workspace │
│                      │ │  mcp.json override   │
└──────────────────────┘ └──────────────────────┘
┌──────────────────────┐ ┌──────────────────────┐
│  LOCAL DISCOVERY     │ │  CLI INSTALLER       │
│  Finds dev servers   │ │  Installs the        │
│  on localhost ports  │ │  `electric` command  │
│                      │ │  system-wide         │
└──────────────────────┘ └──────────────────────┘
```

- **Section eyebrow:** _none_. Earlier drafts had `DEV TOOLS` above the title.
- **Headline:** `Built for builders.`
- **Sub:** When you ship your own entities on the Electric Agents infra and SDK (`@electric-ax/agents-runtime`), the same app becomes the dev tool you'd otherwise have to write yourself.
- A 2×3 (or 3×2) grid of compact cards covering the six features above. Each card is icon + 4-word title + one-sentence body.
- **`Use it to…` hints removed.** An earlier draft carried a dashed-divider "Use it to…" sub-paragraph on every card. The §3.5 scenarios already do the show-don't-spec work; layering hints onto each spec card pushed total text over the line. Spec-sheet rhythm wins here.
- **MCP & skills card body** now reads `Add MCP servers with native OAuth; workspace mcp.json takes precedence.` An earlier draft said `…workspace mcp.json override.` which was imprecise — per `packages/agents/src/server.ts` the workspace file _wins on name conflict_ with the embedder's extras, it doesn't override anything user-set in a UI sense.
- Backed by:
  - `Workspace.tsx`, `TileContainer.tsx`, `SplitContainer.tsx`, `decodeLayout`.
  - `StateExplorerPanel`, `EventSidebar`, `StateTable`.
  - `EntityTimeline`, `useEntityTimeline`, "fork from here" in `ChatView`.
  - `McpServersPage`, `runtime/mcp.ts`, `createSkillTools`, skills catalog.
  - `discovery/local-discovery.ts`.
  - `cli/controller.ts`.

### §7 Download (the current page, trimmed)

```text
┌──────────────────────┐ ┌──────────────────────┐
│  Apple Silicon       │ │  Apple Intel         │
│  Electric-Agents-    │ │  Electric-Agents-    │
│  mac-arm64.dmg       │ │  mac-x64.dmg         │
└──────────────────────┘ └──────────────────────┘
┌──────────────────────┐ ┌──────────────────────┐
│  Windows             │ │  Linux               │
│  -win-x64.exe        │ │  AppImage  ·  .deb   │
└──────────────────────┘ └──────────────────────┘

      Unsigned-preview banner (kept as-is, current copy)

┌─────────────────────────────────────────────────┐
│  Mobile · Preview                               │
│                                                 │
│  Native iOS and Android apps are in active      │
│  development. Want to follow along or run a     │
│  dev build today?                               │
│                                                 │
│  → packages/agents-mobile on GitHub             │
│  · App Store / Google Play coming with v1       │
└─────────────────────────────────────────────────┘

   Pre-release / canary (existing compact list)
```

- **Desktop sub-section** — keep `<VPButton>` per-platform cards and the recommended-card highlight. Keep the `Unsigned Preview` callout exactly as it is.
- **Mobile sub-section** — the apps are not launching with this page. Reframe accordingly:
  - **Headline:** `Mobile · Preview` (no Coming-soon pill — the framing is "you can build it from source today", not vapor).
  - **Final body copy (lock this string):**
    > Native iOS and Android clients are in active development. The source lives in [`packages/agents-mobile`](https://github.com/electric-sql/electric/tree/main/packages/agents-mobile) — clone the repo and run the Expo dev build today, or watch the repo to be notified when the public App Store and Google Play listings ship with v1.
  - **CTA:** one primary link, `View on GitHub →`, pointing at the `packages/agents-mobile` directory on the default branch.
  - **No platform cards yet** — the two-card iOS/Android grid only makes sense once there are real install paths. For now, one combined `Mobile · Preview` card with a single GitHub link reads more honestly than two side-by-side "coming soon" placeholders.
  - Until launch, the page can still legitimately mention mobile in the hero glyph row and in the §3 / §3.5 scenario copy — the apps run, just not from a public store. The §1 hero glyph row adds a small `preview` mark spanning the iOS + Android glyphs (one label under the pair, not per-glyph, to avoid cluttering the visual).
- **Canary** — keep the existing list verbatim. It's already the right shape.

### §8 Bottom CTA strap

Keep the existing `<BottomCtaStrap>` block — copy and button order already work for this page:

```text
┌──────────────────────────────────────────────────────┐
│  · Durable · long-running · cloud-connected ·        │
│                                                      │
│       Build with Electric Agents                     │
│                                                      │
│  Stand up the open-source runtime locally, or        │
│  connect to Electric Cloud.                          │
│                                                      │
│   [Quickstart]  [Agents docs]  [Cloud]               │
└──────────────────────────────────────────────────────┘
```

No copy change required here — the current `<BottomCtaStrap>` invocation is fine.

---

## 5. Mapping every claim back to code

Use this table as a checklist when writing the copy so the page makes no claim the apps can't back up.

| Page claim                                                                  | Implementation reference                                                                                                                                                   |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bundled Horton coding agent (bash / read / write / edit)                    | `packages/agents/src/agents/horton.ts` (`createHortonTools`), `BuiltinAgentsServer` start in `packages/agents-desktop/src/runtime/lifecycle.ts`                            |
| Pick your model provider (Anthropic / OpenAI / DeepSeek / Moonshot / Codex) | `packages/agents-desktop/src/credentials/{api-keys.ts,codex-auth.ts,model-picker.ts}`, `CredentialsPage.tsx`, `OnboardingModal`                                            |
| Bring-your-own keys in the OS keychain                                      | `packages/agents-desktop/src/services/secret-store.ts`, `apiKeysRef` in `settings.json`                                                                                    |
| Working-directory picker                                                    | `packages/agents-desktop/src/credentials/controller.ts` (`chooseWorkingDirectory`), `WorkingDirectoryPicker.tsx`                                                           |
| Skills + `/slash` commands                                                  | `createSkillTools` from `@electric-ax/agents-runtime`, `AGENT_SKILLS_DIR`, system prompt in `buildHortonSystemPrompt`                                                      |
| Multi-server (manual / discovered / cloud)                                  | `packages/agents-desktop/src/shared/types.ts` `ServerSource`, `ServersPage.tsx`, `discovery/local-discovery.ts`, `cloud/cloud-agent-servers.ts`                            |
| Electric Cloud sign-in (GitHub / Google)                                    | `packages/agents-desktop/src/cloud/cloud-auth.ts`                                                                                                                          |
| Pull-wake runner registration                                               | `packages/agents-desktop/src/runtime/lifecycle.ts` (`pullWake` config block)                                                                                               |
| State explorer                                                              | `packages/agents-server-ui/src/components/stateExplorer/StateExplorerPanel.tsx` and siblings                                                                               |
| Entity timeline + fork-from-here                                            | `packages/agents-server-ui/src/hooks/useEntityTimeline.ts`, `EntityTimeline.tsx`, `ChatView.tsx` (anchor / `forkEntity`)                                                   |
| Tile workspace + split menu + deep-link layouts                             | `packages/agents-server-ui/src/components/workspace/Workspace.tsx`, `TileContainer`, `SplitMenu`, `decodeLayout`                                                           |
| MCP servers (settings + workspace `mcp.json`)                               | `packages/agents-desktop/src/runtime/mcp.ts`, `packages/agents-server-ui/src/components/settings/pages/McpServersPage.tsx`                                                 |
| Local discovery of dev servers                                              | `packages/agents-desktop/src/discovery/local-discovery.ts`                                                                                                                 |
| Same session on desktop + mobile                                            | `packages/agents-mobile/src/screens/SessionScreen.tsx` + Expo DOM embed of `packages/agents-server-ui/src/embed/EmbedApp.tsx`                                              |
| Mobile chat with queue / steer / stop                                       | `NativeMessageComposer` + `NativeEntityContextDrawer` in `packages/agents-mobile/src/screens/SessionScreen.tsx`                                                            |
| CLI installer (system-wide `electric`)                                      | `packages/agents-desktop/src/cli/controller.ts`                                                                                                                            |
| Tray + launch-at-login + power-save blocker                                 | `packages/agents-desktop/src/ui/tray.ts`, `packages/agents-desktop/src/app/login-items.ts`, `packages/agents-desktop/src/runtime/lifecycle.ts` (`refreshPowerSaveBlocker`) |

If a claim can't be linked to a row in this table, cut it from the page before merging.

---

## 6. Visual assets we'll need

> **Ship placeholders first.** Every image / SVG slot on this page lands as a styled placeholder block in phase 1, with a `data-placeholder="…"` attribute and a TODO comment marking where the real asset goes. The page can ship and look credible without any of these files existing yet — we fill them in during phase 5 (or as small follow-up PRs after merge). Don't block the rewrite on imagery.

The placeholder block should be a single component (suggested: `<AdPlaceholder name="…" aspect="16/9" />`) styled as a dashed-border, soft-bg rectangle with the slot name centred in mono — same visual language as the existing `.ad-platform-card` border + tone. Putting them behind one component means swapping each one for a real `<img>` / `<svg>` later is a one-line change per slot.

Asset list (to be captured later):

- `desktop-hero.png` / `desktop-hero@2x.png` — desktop window with sidebar tree + tile workspace (chat tile on the left, state explorer tile on the right). Use a real session, not lorem ipsum.
- `mobile-hero.png` / `mobile-hero@2x.png` — mobile chat screen, ideally showing a live streaming response so the screenshot communicates "live, durable session".
- `scenario-1.png` … `scenario-4.png` — small 16:9 illustrations for the §3.5 scenario cards (can be screenshots, can be SVG diagrams; consistency across the four matters more than fidelity).
- `multi-device.svg` — inline diagram for §4. Same visual vocabulary as `EntityOverviewDiagram.vue`. **Optional** if we want to ship the page faster — the section reads fine without a diagram, just denser.
- Iconify masks for §3 / §6 cards. Reuse the existing `.ad-icon--*` pattern in the current page (`apple`, `windows`, `linux`, `android`, `appstore`, `googleplay`) and add a small palette for **tile-workspace**, **state-explorer**, **timeline**, **mcp**, **skills**, **discovery**. `lucide` (already used in `agents-server-ui`) is a good source.

All assets land in `website/public/img/app/`.

---

## 7. Implementation plan — one PR, worked through in phases

The rewrite ships as a **single pull request**. Internally we sequence the work as six phases so the diff stays readable and so we can stop, review, and resume the working tree in a coherent state at the end of each phase. Phases are a working aid for the author and the reviewer — **not** independent PRs.

**Every phase lands with placeholders where real images / SVGs eventually live.** Nothing in this plan blocks on producing those assets; missing imagery is filled in either as part of phase 5 in this PR or as small follow-up PRs after merge.

The branch already has two commits ahead of `main` — this plan doc, and the main-nav entry (`MegaNav.vue` / `MegaNavMobile.vue`). Phase 1's nav-entry work is therefore already done; the remaining phases continue on the same branch and land together when the PR is opened for review.

1. **Phase 1 — skeleton + placeholder component + main nav entry.**
   - Land `APP_PAGE_PLAN.md` (this doc). _Already committed._
   - Rename `AppDownloadPage.vue` → `AppPage.vue` (or keep the name; doesn't really matter — references only live in `app.md`).
   - Add `<AdPlaceholder name="…" aspect="…">` component.
   - Add empty `<Section>` shells for §2 / §3 / §3.5 / §4 / §5 / §6, each containing the appropriate placeholder block + a TODO comment.
   - Move existing per-platform cards into §7.
   - **Add the App entry to the main nav** in `website/.vitepress/theme/components/MegaNav.vue` and `MegaNavMobile.vue`. Sits in its own visual group between `Sync` and `Cloud`, with a `'|'` divider on each side. Plain `{ id: 'app', label: 'App', link: '/app' }` link (no dropdown panel — the page is self-contained). Also add `if (p.startsWith('/app')) return 'app'` to the `activeId` computed in `MegaNav.vue` so the link highlights when the user is on the page. _Already committed._
   - End-of-phase state: page renders the new structure with placeholders and the existing downloads; no copy or visual changes shipped to users yet.

2. **Phase 2 — hero rewrite + glyph row.**
   - New headline + sub (no "software factory" in hero; copy per §1 Hero above).
   - Add the 5-platform glyph row under the CTAs.
   - §2 visual strap still a placeholder pair (`desktop-hero` + `mobile-hero` placeholders).

3. **Phase 3 — "Three ways to use it" (§3) + scenarios (§3.5) + "Built for builders" (§6).**
   - Pure copy + Iconify card grids; scenario cards land as placeholder image + final body copy.
   - This is where "software factory" lives — once in the §3 middle card, once in §3.5 scenario 1.

4. **Phase 4 — multi-device + bundled Horton sections (§4, §5).**
   - Inline SVG diagram for §4 _or_ a placeholder block (pick whichever is cheaper at the time).
   - Two card-style detail blocks for §5 (tools + providers + skills + "things you can ask").

5. **Phase 5 — fill in placeholders with real assets.**
   - Capture desktop + mobile hero screenshots, drop into §2. The mobile shot should look real (run the Expo dev build against a local server) but the page should not promise public store availability.
   - Capture / illustrate scenarios 1–4 for §3.5.
   - Producing the `multi-device.svg` for §4 if we didn't ship one in phase 4.
   - The mobile `Preview` card in §7 stays as a single combined card pointing at `packages/agents-mobile` on GitHub. Only swap to per-platform install cards once App Store / Play listings are live — that's a separate follow-up PR after the v1 mobile launch, not part of this page rewrite.
   - **Optional**: if real assets aren't ready when the rest of the PR is, this phase can be deferred to a small follow-up PR. The page is still credible with `<AdPlaceholder>` blocks shown.

6. **Phase 6 — polish + redirects.**
   - Verify all anchors (`#desktop`, `#mobile`, `#download`, `#canary`) still work — the old fragments should redirect to §7 sub-sections.
   - Run `pnpm --filter website build` to confirm no regressions.
   - Visual QA in light + dark.

Phases 1–4 are pure markup + copy — they can land in a single working day without waiting on design. Phase 5 is the only one that needs real screenshots, and phase 6 is short by construction. When opening the PR for review, list these six phases in the PR description and structure the commits to match so the diff reads in the same order.

---

## 8. Out of scope (for now)

- A standalone `/app/desktop` and `/app/mobile` deep-dive page. The single `/app` page should carry the full pitch. If it ever gets too long, split _then_.
- Auto-update / signing copy. The current "Unsigned Preview" callout already does the right thing; we shouldn't make codesigning a hero element until it's actually solved.
- A pricing / "Pro" tier mention on the page. This page is product, not commerce — pricing belongs on `/pricing/`.
- Any net-new product capabilities. This doc is purely a marketing/positioning rewrite over the apps as they exist today.

---

## 9. Open questions

- **§3.5 scenarios — keep all four, or trim to two?** Four scenarios is generous and risks padding. Two strong ones might land harder. Recommend ship four in phase 3 and reassess at phase 5 once we have real illustrations — easy to cut before opening the PR for review, easy to defend if we keep them.
- **Should §4 ship without a diagram in phase 4, or wait for the SVG?** Recommend ship without — the copy is strong on its own and we can layer the diagram in later without re-flowing the section.
- ~~**Mobile sub-section in §7 — TestFlight / internal-testing tracks ready?**~~ _Resolved: mobile won't launch with this page._ §7 ships with a single `Mobile · Preview` card linking to `packages/agents-mobile` on GitHub. Per-platform install paths land in a small follow-up PR after the public v1 mobile launch.
- **Card 3 eyebrow — `Build with the SDK` vs `Build & debug`?** Both work. `Build with the SDK` is more honest about what the card is for (the platform builders); `Build & debug` is friendlier to people who haven't yet decided whether they're going to build. Recommend `Build with the SDK` and trust the body copy to soften it.
