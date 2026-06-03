<script setup lang="ts">
/* Hidden download page at /app.

   Patterned on the existing agents / streams / sync landing pages
   (Section blocks, eyebrow chips, brand-accented headline) plus
   download-page conventions from Cursor / Linear / Raycast:
   - Centred hero with a single platform-detected primary CTA.
     A real app screenshot / mockup will land in a follow-up PR;
     for now the hero is text + CTAs only.
   - Platform glyphs from the Iconify `simple-icons` set, masked
     via CSS to inherit the current text colour — same pattern the
     rest of the site uses for social icons.
   - Per-platform card CTAs use a muted dark/alt button rather than
     the saturated brand teal so the hero stays the loudest CTA on
     the page. Format labels (DMG/EXE/AppImage) are baked into the
     button text rather than sitting beside it.
   - Mobile section trimmed to icon + name + Coming-soon pill +
     store badge with no prose descriptions.
   - Canary section collapsed into a compact platform-per-row list
     with inline download chips. */
import { computed, onMounted, ref } from 'vue'
import { VPButton } from 'vitepress/theme'

import Section from '../agents-home/Section.vue'
import BottomCtaStrap from '../BottomCtaStrap.vue'
import AdPlaceholder from './AdPlaceholder.vue'
import AppMockupEmbed from '../brand-toys/app/AppMockupEmbed.vue'
import AppMockupShadowHost from '../brand-toys/app/AppMockupShadowHost.vue'
import HeroChatStateScene from '../brand-toys/app/scenes/desktop/HeroChatStateScene.vue'

const githubReleaseBase = `https://github.com/electric-sql/electric/releases`
const appReleaseNotesUrl = `${githubReleaseBase}?q=%22%40electric-ax%2Fagents-desktop%22&expanded=true`
const agentsMobileRepoUrl = `https://github.com/electric-sql/electric/tree/main/packages/agents-mobile`

type DesktopPlatformId =
  | 'macos-arm64'
  | 'macos-x64'
  | 'windows-x64'
  | 'linux-x64'

type DownloadOption = {
  label: string
  assetName: string
}

type DesktopPlatform = {
  id: DesktopPlatformId
  icon: 'apple' | 'windows' | 'linux'
  name: string
  detail: string
  downloads: DownloadOption[]
}

const stableTag = `agents-desktop-latest`
const canaryTag = `agents-desktop-canary`

const desktopPlatforms: DesktopPlatform[] = [
  {
    id: `macos-arm64`,
    icon: `apple`,
    name: `macOS Apple Silicon`,
    detail: `M1, M2, M3 and newer.`,
    downloads: [
      {
        label: `Download for Mac (Apple Silicon)`,
        assetName: `Electric-Agents-mac-arm64.dmg`,
      },
    ],
  },
  {
    id: `macos-x64`,
    icon: `apple`,
    name: `macOS Intel`,
    detail: `For Intel-based Macs.`,
    downloads: [
      {
        label: `Download for Mac (Intel)`,
        assetName: `Electric-Agents-mac-x64.dmg`,
      },
    ],
  },
  {
    id: `windows-x64`,
    icon: `windows`,
    name: `Windows`,
    detail: `64-bit installer for Windows 10 and 11.`,
    downloads: [
      {
        label: `Download for Windows`,
        assetName: `Electric-Agents-win-x64.exe`,
      },
    ],
  },
  {
    id: `linux-x64`,
    icon: `linux`,
    name: `Linux`,
    detail: `Portable AppImage or Debian package.`,
    downloads: [
      {
        label: `Download AppImage`,
        assetName: `Electric-Agents-linux-x64.AppImage`,
      },
      {
        label: `Download DEB`,
        assetName: `Electric-Agents-linux-x64.deb`,
      },
    ],
  },
]

type CanaryEntry = {
  platform: string
  icon: 'apple' | 'windows' | 'linux'
  assets: { label: string; assetName: string }[]
}

const canaryEntries: CanaryEntry[] = [
  {
    platform: `macOS Apple Silicon`,
    icon: `apple`,
    assets: [
      { label: `Download`, assetName: `Electric-Agents-canary-mac-arm64.dmg` },
    ],
  },
  {
    platform: `macOS Intel`,
    icon: `apple`,
    assets: [
      { label: `Download`, assetName: `Electric-Agents-canary-mac-x64.dmg` },
    ],
  },
  {
    platform: `Windows`,
    icon: `windows`,
    assets: [
      {
        label: `Download`,
        assetName: `Electric-Agents-canary-windows-x64.exe`,
      },
    ],
  },
  {
    platform: `Linux`,
    icon: `linux`,
    assets: [
      {
        label: `AppImage`,
        assetName: `Electric-Agents-canary-linux-x64.AppImage`,
      },
      { label: `DEB`, assetName: `Electric-Agents-canary-linux-x64.deb` },
    ],
  },
]

function releaseUrl(tag: string, assetName: string): string {
  return `${githubReleaseBase}/download/${encodeURIComponent(tag)}/${assetName}`
}

function latestReleaseUrl(assetName: string): string {
  return releaseUrl(stableTag, assetName)
}

/* Detect the visitor's OS on mount; default to macOS Apple Silicon
   so SSR / first paint always renders a sensible primary. */
const detectedId = ref<DesktopPlatformId>('macos-arm64')

/* All Mac browsers still report `Intel Mac OS X` in the UA string on
   Apple Silicon for legacy compat (it's a deliberate Apple/browser
   decision), so the UA tells us nothing about CPU arch. We default
   macOS to Apple Silicon (Intel Macs went EOL in 2023) and only flip
   to Intel on a positive signal from the WebGL renderer string,
   which differs between Apple GPU and Intel integrated graphics. */
function detectMacArch(): 'macos-arm64' | 'macos-x64' {
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
    if (!gl) return 'macos-arm64'
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    if (!ext) return 'macos-arm64'
    const renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '')
    // Apple Silicon: "Apple GPU" (Safari) or "ANGLE (Apple, M-series ...)" (Chrome)
    // Intel Mac:     "Intel ..." (Safari) or "ANGLE (Intel, ...)" (Chrome)
    if (/Intel/i.test(renderer) && !/Apple/i.test(renderer)) {
      return 'macos-x64'
    }
    return 'macos-arm64'
  } catch {
    return 'macos-arm64'
  }
}

onMounted(() => {
  if (typeof navigator === 'undefined') return
  const ua = `${navigator.userAgent || ''} ${navigator.platform || ''}`
  if (/Win(dows|64|32)|WOW64|WinNT/i.test(ua)) {
    detectedId.value = 'windows-x64'
  } else if (
    /Linux|X11|Ubuntu|Fedora|Debian/i.test(ua) &&
    !/Android/i.test(ua)
  ) {
    detectedId.value = 'linux-x64'
  } else if (/Mac|Macintosh|Darwin/i.test(ua)) {
    detectedId.value = detectMacArch()
  }
})

const primaryPlatform = computed(
  () =>
    desktopPlatforms.find((p) => p.id === detectedId.value) ??
    desktopPlatforms[0]
)
</script>

<template>
  <div class="ad-page">
    <!-- ─────────────────── §1 — Hero ─────────────────── -->
    <section class="ad-hero">
      <div class="ad-hero-inner">
        <h1 class="ad-hero-name">
          Electric Agents&nbsp;<span class="ad-hero-accent">App</span>
        </h1>
        <p class="ad-hero-text">
          Desktop and mobile clients — one app to code with Horton, attach to
          remote sessions, and build your own agents on
          <a href="/agents">Electric&nbsp;Agents</a>.
        </p>

        <div class="ad-hero-actions">
          <VPButton
            tag="a"
            size="medium"
            theme="brand"
            :text="primaryPlatform.downloads[0].label"
            :href="latestReleaseUrl(primaryPlatform.downloads[0].assetName)"
          />
          <!-- TODO(phase 6): swap href to "#download" once §7 ships an
               umbrella anchor on the download block. Pointing at
               "#desktop" today lands users at the first sub-section,
               which is the right scroll target for now. -->
          <VPButton
            tag="a"
            size="medium"
            theme="alt"
            text="Other platforms"
            href="#desktop"
          />
        </div>

        <!--
          Platform glyph row.

          Communicates multi-platform breadth above the fold without
          relying on the downloads block further down. Five muted
          glyph + label pairs in a CSS grid; the iOS + Android pair
          gets a `Preview` pill in the second grid row beneath them
          (one shared label rather than per-glyph clutter) because
          the mobile apps don't have public App Store / Play
          listings yet — see §7 mobile sub-section.
        -->
        <div
          class="ad-hero-platforms"
          aria-label="Available on macOS, Windows and Linux. Native iOS and Android apps in mobile preview."
        >
          <span class="ad-hero-glyph">
            <span
              class="ad-hero-glyph-icon ad-icon ad-icon--apple"
              aria-hidden="true"
            />
            <span class="ad-hero-glyph-label mono">macOS</span>
          </span>
          <span class="ad-hero-glyph">
            <span
              class="ad-hero-glyph-icon ad-icon ad-icon--windows"
              aria-hidden="true"
            />
            <span class="ad-hero-glyph-label mono">Windows</span>
          </span>
          <span class="ad-hero-glyph">
            <span
              class="ad-hero-glyph-icon ad-icon ad-icon--linux"
              aria-hidden="true"
            />
            <span class="ad-hero-glyph-label mono">Linux</span>
          </span>
          <span class="ad-hero-glyph is-preview">
            <span
              class="ad-hero-glyph-icon ad-icon ad-icon--apple"
              aria-hidden="true"
            />
            <span class="ad-hero-glyph-label mono">iOS</span>
            <span class="ad-hero-glyph-preview mono" aria-hidden="true"
              >Preview</span
            >
          </span>
          <span class="ad-hero-glyph is-preview">
            <span
              class="ad-hero-glyph-icon ad-icon ad-icon--android"
              aria-hidden="true"
            />
            <span class="ad-hero-glyph-label mono">Android</span>
            <span class="ad-hero-glyph-preview mono" aria-hidden="true"
              >Preview</span
            >
          </span>
        </div>
      </div>

      <!--
        Hero mockup pair — live HTML/CSS desktop mockup with a phone
        placeholder overlapping its right edge. The desktop scene is
        the real animated mockup (HeroChatStateScene); the phone is
        a placeholder until the mobile mockup primitive lands. Sits
        OUTSIDE `.ad-hero-inner` so it can break the inner column's
        820-px cap and span the full hero width.
      -->
      <div class="ad-hero-mockup">
        <div class="ad-hero-mockup-stage">
          <div class="ad-hero-mockup-desktop">
            <div class="ad-hero-mockup-desktop-inner">
              <AppMockupShadowHost
                :scene="HeroChatStateScene"
                :scene-props="{ os: 'auto', theme: 'dark' }"
              />
            </div>
          </div>
          <div class="ad-hero-mockup-phone" aria-hidden="true">
            <AdPlaceholder
              name="mobile-hero.png"
              sublabel="Mobile chat — same session, live streaming response"
              aspect="9/19"
            />
          </div>
        </div>
        <p class="ad-hero-mockup-caption mono">
          Same session. Two devices. One control plane.
        </p>
      </div>
    </section>

    <!--
      Sections §2–§6 land their structure (this Section shell + an
      <AdPlaceholder> inside) in phase 1, and have their real copy /
      visuals filled in as the rewrite progresses (see
      APP_PAGE_PLAN.md §7 for the phase schedule). The chrome stays
      the same across phases, so each fill-in is a localised diff.

      Phase ownership for each section:
        §2   visual strap          → folded into the §1 hero — the
                                      desktop+mobile pair lives there
                                      now so visitors land directly
                                      on the product shot.
        §3   three ways to use it  → phase 3 ✓
        §3.5 scenarios             → phase 3 ✓ copy · phase 5 illustrations
        §4   multi-device          → phase 4 ✓ copy · phase 5 diagram SVG
        §5   bundled Horton        → phase 4 ✓
        §6   built for builders    → phase 3 ✓
    -->

    <!-- ─────────────────── §3 — Three ways to use it ─────────────────── *
         Three side-by-side cards (Code locally · Attach remotely · Build
         with the SDK). Each card: lucide icon + sentence-form title + body
         + 3-item "You can:" bullet list. No card-level eyebrows — the
         titles carry the categorization on their own. The strip beneath
         the grid restates the one-integrated-platform line as the
         section's takeaway. Body strings locked in APP_PAGE_PLAN.md §3. -->
    <Section id="three-ways">
      <template #title>Three ways to use it</template>

      <div class="ad-modes-grid">
        <article class="ad-modes-card">
          <span class="ad-modes-icon" aria-hidden="true">
            <span class="ad-icon ad-icon--code" />
          </span>
          <h3 class="ad-modes-title">Code with Horton, locally</h3>
          <p class="ad-modes-body">
            Horton ships in the desktop. Pick a model, point at a directory,
            chat to a coding agent that edits, runs bash, and spawns parallel
            workers.
          </p>
          <p class="ad-modes-list-label mono">You can:</p>
          <ul class="ad-modes-list">
            <li>Refactor a folder, one worker per file</li>
            <li>Bisect a regression — one worker repros, one fixes</li>
            <li>Edit code, run bash, search the web in one chat</li>
            <li>Learn Electric Agents with <code>/quickstart</code></li>
          </ul>
        </article>

        <article class="ad-modes-card">
          <span class="ad-modes-icon" aria-hidden="true">
            <span class="ad-icon ad-icon--radio" />
          </span>
          <h3 class="ad-modes-title">Attach to remote sessions</h3>
          <p class="ad-modes-body">
            Connect to any agents-server — your own or Electric Cloud. Sessions
            spawned by CI, webhooks, GitHub issues, cron or your software
            factory show up live.
          </p>
          <p class="ad-modes-list-label mono">You can:</p>
          <ul class="ad-modes-list">
            <li>
              Triage a GitHub-issue session on the phone, finish on the desk
            </li>
            <li>Steer a CI agent before its PR merges</li>
            <li>Pause and resume a cron-triggered pipeline</li>
            <li>Hand a session off between devices mid-run</li>
          </ul>
        </article>

        <article class="ad-modes-card">
          <span class="ad-modes-icon" aria-hidden="true">
            <span class="ad-icon ad-icon--microscope" />
          </span>
          <h3 class="ad-modes-title">Build your own agents</h3>
          <p class="ad-modes-body">
            It's also the dev tool for the entities <em>you</em> write with the
            SDK (<code>@electric-ax/agents-runtime</code>) — state explorer,
            timeline, fork-from-here.
          </p>
          <p class="ad-modes-list-label mono">You can:</p>
          <ul class="ad-modes-list">
            <li>Watch a stuck entity's inbox + runs in real time</li>
            <li>Fork any past point to A/B test a change</li>
            <li>Step through a failed worker without redeploying</li>
            <li>Tile parent + workers side-by-side</li>
          </ul>
        </article>
      </div>

      <p class="ad-modes-strip mono">
        One integrated platform — code, attach, and build in one app.
      </p>
    </Section>

    <!-- ─────────────────── §3.5 — Scenarios ─────────────────── *
         Four worked end-to-end stories that span the three modes from
         §3. Each card carries a placeholder illustration at the top,
         a `Touches:` eyebrow in mono naming the moving parts, the
         scenario title, and a short body paragraph. The dark section
         background sets these apart from the §3 cards above and the
         §6 builder cards below — they read as the page's "in practice"
         interlude. Body strings are locked in APP_PAGE_PLAN.md §3.5;
         do not edit them here without updating that doc. -->
    <Section id="scenarios" :dark="true">
      <template #title>What this looks like in practice</template>
      <template #subtitle>
        Four short stories that span the three modes above. None of them require
        code you don't have today.
      </template>

      <div class="ad-scenarios-grid">
        <article class="ad-scenarios-card">
          <div class="ad-scenarios-illo">
            <!--
              Scenario 1 mockup — sidebar + chat. The sidebar uses the
              default fixture (with "Refactor auth helpers" selected at
              the top, status streaming) so the eye reads "a fresh
              session has arrived". Chat title is reframed as a GitHub
              issue id to anchor the CI spawn in the headline above.
              Disable container-query reflow so the sidebar stays
              visible at the card's narrow width — explicit visibility
              props decide the layout.
            -->
            <AppMockupEmbed
              :scene="HeroChatStateScene"
              :scene-props="{
                os: 'auto',
                theme: 'dark',
                responsive: false,
                showSidebar: true,
                showChatTile: true,
                showStateTile: false,
                title: 'Fix flaky auth test · issue/1724',
                sessionId: 'horton/issue-1724',
              }"
              aspect="16/9"
              :scale="0.75"
            />
          </div>
          <p class="ad-scenarios-touches mono">
            Touches: Cloud · mobile · steer · stop · review
          </p>
          <h3 class="ad-scenarios-title">
            GitHub issue → CI spawns Horton → triage on phone → finish on desk
          </h3>
          <p class="ad-scenarios-body">
            Your software factory opens an agent session on Electric Cloud from
            a fresh GitHub issue or a CI dispatch. You get a notification on
            your phone, skim the diff Horton drafted, push back a steering
            message, then pick up on your laptop to merge.
          </p>
        </article>

        <article class="ad-scenarios-card">
          <div class="ad-scenarios-illo">
            <!--
              Scenario 2 mockup — sidebar + chat. The visual hook is
              the WORKER TREE under the parent "Rename across packages"
              — the sidebar's existing fixture has this expanded with
              4 workers (typescript-client, agents-runtime,
              agents-server, agents-server-ui). We highlight the
              parent so the eye lands on the tree, then reads down to
              the child workers below it.
            -->
            <AppMockupEmbed
              :scene="HeroChatStateScene"
              :scene-props="{
                os: 'auto',
                theme: 'dark',
                responsive: false,
                showSidebar: true,
                showChatTile: true,
                showStateTile: false,
                sidebarSelectedUrl: '/horton/parallel-rename',
                title: 'Rename across packages',
                sessionId: 'horton/parallel-rename',
              }"
              aspect="16/9"
              :scale="0.75"
            />
          </div>
          <p class="ad-scenarios-touches mono">
            Touches: desktop · working-dir · workers · tile · fork
          </p>
          <h3 class="ad-scenarios-title">
            Local refactor with parallel workers
          </h3>
          <p class="ad-scenarios-body">
            Open the desktop, point Horton at a repo, ask for a rename across
            packages. Horton spawns a worker per package; you fork the one that
            took the wrong turn and ship the diff.
          </p>
        </article>

        <article class="ad-scenarios-card">
          <div class="ad-scenarios-illo">
            <!--
              Scenario 3 mockup — state inspector only. With sidebar
              and chat tile both hidden, the state tile is the
              leftmost surface in the window so the scene
              automatically routes the macOS chrome inset (78-px
              header padding past the traffic lights) to it. The
              title is rebranded as a custom `summarizer` entity to
              anchor the SDK / debug-without-redeploy story above.
            -->
            <AppMockupEmbed
              :scene="HeroChatStateScene"
              :scene-props="{
                os: 'auto',
                theme: 'dark',
                responsive: false,
                showSidebar: false,
                showChatTile: false,
                showStateTile: true,
                title: 'Summarise outline draft',
                sessionId: 'summarizer/r3kc8mq',
              }"
              aspect="16/9"
              :scale="0.75"
            />
          </div>
          <p class="ad-scenarios-touches mono">
            Touches: SDK · state explorer · timeline · fork · MCP
          </p>
          <h3 class="ad-scenarios-title">
            Build an agent on the SDK, debug it without a redeploy
          </h3>
          <p class="ad-scenarios-body">
            You ship a custom <code>summarizer</code> entity with the SDK and
            it's getting stuck on certain inputs. Open the state explorer, fork
            the failing session, change the prompt, replay.
          </p>
        </article>

        <article class="ad-scenarios-card">
          <div class="ad-scenarios-illo">
            <!--
              Scenario 4 mockup — chat only. The agent has already
              finished overnight, so we pause the typewriter at full
              progress so the chat reads as "morning catch-up on a
              completed run" rather than a live stream. Chat tile is
              the leftmost surface — same chrome-inset routing as
              scenario 3.
            -->
            <AppMockupEmbed
              :scene="HeroChatStateScene"
              :scene-props="{
                os: 'auto',
                theme: 'dark',
                responsive: false,
                showSidebar: false,
                showChatTile: true,
                showStateTile: false,
                paused: true,
                progress: 1,
                title: 'Nightly research · v0.4 → v0.5 changes',
                sessionId: 'research/nightly-1729',
              }"
              aspect="16/9"
              :scale="0.75"
            />
          </div>
          <p class="ad-scenarios-touches mono">
            Touches: Cloud · cron wake · mobile · fork · send
          </p>
          <h3 class="ad-scenarios-title">Cron-triggered overnight pipeline</h3>
          <p class="ad-scenarios-body">
            Cron kicks off a nightly research agent on the cloud server. Open
            the mobile app in the morning and hand off the most promising lead
            to a fresh session.
          </p>
        </article>
      </div>
    </Section>

    <!-- ─────────────────── §4 — Multi-device, multi-user ─────────────────── *
         Phase 4 ships this section with copy + an `<AdPlaceholder>` for the
         multi-device diagram (16/8). Phase 5 swaps the placeholder for an
         inline SVG matching the `EntityOverviewDiagram.vue` style — see
         APP_PAGE_PLAN.md §4 + §9 open-questions for the deliberate "ship
         without the SVG" decision. The locked plan paragraph is split
         across the subtitle and the three pillars below the diagram so
         the body reads as scannable rather than a wall of prose. -->
    <Section id="multi-device">
      <template #title>Multi-device, multi-user</template>
      <template #subtitle>
        Agents run on the server, not the client. The desktop and mobile apps
        are live views into the same Electric streams.
      </template>

      <AdPlaceholder
        name="multi-device.svg"
        sublabel="Diagram: phone ↔ Electric Cloud ↔ desktop (also a pull-wake worker)"
        aspect="16/8"
      />

      <div class="ad-multi-pillars">
        <article class="ad-multi-pillar">
          <span class="ad-multi-icon" aria-hidden="true">
            <span class="ad-icon ad-icon--monitor-smartphone" />
          </span>
          <h3 class="ad-multi-title">Same session, every device</h3>
          <p class="ad-multi-body">
            Open the same session from your laptop and your phone, hand work off
            between devices, follow a long-running run from wherever you happen
            to be.
          </p>
        </article>

        <article class="ad-multi-pillar">
          <span class="ad-multi-icon" aria-hidden="true">
            <span class="ad-icon ad-icon--users" />
          </span>
          <h3 class="ad-multi-title">Shared with your team</h3>
          <p class="ad-multi-body">
            Sign in once with GitHub or Google; your Electric Cloud workspaces
            appear automatically. Share a session with a teammate by sharing its
            URL — the multi-user view sees the same stream.
          </p>
        </article>

        <article class="ad-multi-pillar">
          <span class="ad-multi-icon" aria-hidden="true">
            <span class="ad-icon ad-icon--cpu" />
          </span>
          <h3 class="ad-multi-title">Pull-wake runners</h3>
          <p class="ad-multi-body">
            The desktop can register itself as a pull-wake runner, so your
            laptop becomes a worker for your cloud agents. Close the lid and
            they finish on the next runner that comes online.
          </p>
        </article>
      </div>
    </Section>

    <!-- ─────────────────── §5 — Bundled Horton ─────────────────── *
         Two-zone layout that intentionally breaks from the §3 / §3.5 / §6
         card grids so the page has visual variety as the reader scrolls.
         Zone 1: three capability pillars (provider · working directory ·
         skills + slash) restating the three sub-bullets locked in
         APP_PAGE_PLAN.md §5. Zone 2: "Things you can ask Horton to do"
         3-column prompt grid (Chat / Code / Research) with example
         prompts in `<code>` so the visual reads as a prompt library
         rather than a marketing list. The Section uses `:dark="true"`
         so this block sits as a contrasting hero strip for Horton
         between the surrounding §4 + §6 sections — bundled agent gets
         the marquee treatment without taking the headline. In dark
         global mode the surface difference is subtle (one `--vp-c-bg`
         rung) but consistent; in light mode it's a pronounced dark
         strip on a light page. -->
    <Section id="horton" :dark="true">
      <template #title>Horton, in the box</template>
      <template #subtitle>
        A friendly, capable general-purpose chat agent with code-editing
        superpowers — no server-side setup required.
      </template>

      <div class="ad-horton-pillars">
        <article class="ad-horton-pillar">
          <span class="ad-horton-pillar-icon" aria-hidden="true">
            <span class="ad-icon ad-icon--key-round" />
          </span>
          <h3 class="ad-horton-pillar-title">Pick your provider</h3>
          <p class="ad-horton-pillar-body">
            Bring your own API key (stored in the OS keychain), or sign in to
            Codex. Anthropic, OpenAI, DeepSeek and Moonshot for models; Brave
            Search and E2B for tools.
          </p>
        </article>

        <article class="ad-horton-pillar">
          <span class="ad-horton-pillar-icon" aria-hidden="true">
            <span class="ad-icon ad-icon--folder-tree" />
          </span>
          <h3 class="ad-horton-pillar-title">Pick your working directory</h3>
          <p class="ad-horton-pillar-body">
            Horton reads and edits whatever you point it at — no per-project
            install. The picker walks your filesystem; recent directories
            surface automatically.
          </p>
        </article>

        <article class="ad-horton-pillar">
          <span class="ad-horton-pillar-icon" aria-hidden="true">
            <span class="ad-icon ad-icon--wand" />
          </span>
          <h3 class="ad-horton-pillar-title">Skills + slash commands</h3>
          <p class="ad-horton-pillar-body">
            Type <code>/quickstart</code> to learn Electric Agents itself; write
            your own skills to ship reusable workflows.
          </p>
        </article>
      </div>

      <div class="ad-horton-ask">
        <p class="ad-horton-ask-eyebrow mono">
          Things you can ask Horton to do
        </p>
        <div class="ad-horton-ask-grid">
          <article class="ad-horton-ask-col">
            <header class="ad-horton-ask-header">
              <span class="ad-horton-ask-icon" aria-hidden="true">
                <span class="ad-icon ad-icon--message-circle" />
              </span>
              <h3>Chat</h3>
            </header>
            <ul>
              <li><code>Summarise this docs page</code></li>
              <li><code>Plan a refactor</code></li>
              <li><code>Explain this stack trace</code></li>
              <li><code>Draft a launch tweet</code></li>
            </ul>
          </article>

          <article class="ad-horton-ask-col">
            <header class="ad-horton-ask-header">
              <span class="ad-horton-ask-icon" aria-hidden="true">
                <span class="ad-icon ad-icon--braces" />
              </span>
              <h3>Code</h3>
            </header>
            <ul>
              <li><code>Refactor this file</code></li>
              <li><code>Write tests for X</code></li>
              <li><code>Bisect this regression</code></li>
              <li><code>Apply the same change across these 4 files</code></li>
            </ul>
          </article>

          <article class="ad-horton-ask-col">
            <header class="ad-horton-ask-header">
              <span class="ad-horton-ask-icon" aria-hidden="true">
                <span class="ad-icon ad-icon--compass" />
              </span>
              <h3>Research</h3>
            </header>
            <ul>
              <li><code>Find the latest spec for Y</code></li>
              <li><code>Diff what changed since v1.2</code></li>
              <li><code>Pull the open PRs touching this dir</code></li>
            </ul>
          </article>
        </div>
      </div>
    </Section>

    <!-- ─────────────────── §6 — Built for builders ─────────────────── *
         Six compact cards (3×2 desktop, 2×2 → 1×6 at narrower widths).
         Each card: lucide icon + 2-4 word title + one-sentence body.
         Intentionally terse spec-sheet rhythm — the page already has
         scenarios above, so cards here just identify what's in the
         box. Every feature listed here is shipping today; see the
         claim→code mapping in APP_PAGE_PLAN.md §5 / §6 if you're
         tempted to add anything else. -->
    <Section id="builders">
      <template #title>Built for builders</template>
      <template #subtitle>
        When you ship your own entities on the Electric Agents infra and SDK
        (<code>@electric-ax/agents-runtime</code>), the same app becomes the dev
        tool you'd otherwise have to write yourself.
      </template>

      <div class="ad-builders-grid">
        <article class="ad-builders-card">
          <span class="ad-builders-icon" aria-hidden="true">
            <span class="ad-icon ad-icon--layout" />
          </span>
          <h3 class="ad-builders-title">Tile workspace</h3>
          <p class="ad-builders-body">
            Split right / down cycle, find, <code>?layout=</code> deep link.
          </p>
        </article>

        <article class="ad-builders-card">
          <span class="ad-builders-icon" aria-hidden="true">
            <span class="ad-icon ad-icon--database" />
          </span>
          <h3 class="ad-builders-title">State explorer</h3>
          <p class="ad-builders-body">
            Live view of every shared-state source per entity.
          </p>
        </article>

        <article class="ad-builders-card">
          <span class="ad-builders-icon" aria-hidden="true">
            <span class="ad-icon ad-icon--history" />
          </span>
          <h3 class="ad-builders-title">Entity timeline</h3>
          <p class="ad-builders-body">
            Runs, inbox, manifests, fork-from-here.
          </p>
        </article>

        <article class="ad-builders-card">
          <span class="ad-builders-icon" aria-hidden="true">
            <span class="ad-icon ad-icon--cable" />
          </span>
          <h3 class="ad-builders-title">MCP &amp; skills</h3>
          <p class="ad-builders-body">
            Add MCP servers with native OAuth; workspace
            <code>mcp.json</code> takes precedence.
          </p>
        </article>

        <article class="ad-builders-card">
          <span class="ad-builders-icon" aria-hidden="true">
            <span class="ad-icon ad-icon--radar" />
          </span>
          <h3 class="ad-builders-title">Local discovery</h3>
          <p class="ad-builders-body">Finds dev servers on localhost ports.</p>
        </article>

        <article class="ad-builders-card">
          <span class="ad-builders-icon" aria-hidden="true">
            <span class="ad-icon ad-icon--terminal" />
          </span>
          <h3 class="ad-builders-title">CLI installer</h3>
          <p class="ad-builders-body">
            Installs the <code>electric</code> command system-wide.
          </p>
        </article>
      </div>
    </Section>

    <!--
      ═══════════════════ §7 — Download ═══════════════════

      The three <Section> blocks below (desktop / mobile / canary)
      collectively make up §7 of the new page. They keep their own
      anchors (#desktop, #mobile, #canary) for backwards
      compatibility with any external links; phase 6 verifies these
      still resolve after the rest of the page is in place.

      Desktop and canary keep their original cards / list verbatim.
      The mobile sub-section is reframed as `Mobile · Preview`
      pointing at packages/agents-mobile on GitHub (see
      APP_PAGE_PLAN.md §7 for the locked body string).
    -->

    <!-- ─────────────────── §7a — Desktop App ─────────────────── -->
    <Section id="desktop">
      <template #title>Desktop App</template>
      <template #subtitle>
        Install the desktop app to start, monitor and return to long-running
        agents from your own computer.
      </template>

      <div class="ad-desktop-grid">
        <article
          v-for="platform in desktopPlatforms"
          :key="platform.id"
          class="ad-platform-card"
          :class="{ 'is-recommended': platform.id === detectedId }"
        >
          <div class="ad-platform-head">
            <span class="ad-platform-icon" aria-hidden="true">
              <span class="ad-icon" :class="`ad-icon--${platform.icon}`" />
            </span>
            <div class="ad-platform-title">
              <h3>{{ platform.name }}</h3>
              <p>{{ platform.detail }}</p>
            </div>
          </div>

          <div class="ad-platform-cta">
            <VPButton
              v-for="(opt, idx) in platform.downloads"
              :key="opt.assetName"
              tag="a"
              size="medium"
              :theme="platform.id === detectedId && idx === 0 ? 'brand' : 'alt'"
              :text="opt.label"
              :href="latestReleaseUrl(opt.assetName)"
            />
          </div>
        </article>
      </div>

      <p class="ad-download-meta">
        <a
          class="ad-meta-link"
          :href="appReleaseNotesUrl"
          target="_blank"
          rel="noreferrer"
          >Release notes</a
        >
      </p>

      <aside class="custom-block warning ad-signing-note">
        <p class="custom-block-title">Unsigned Preview</p>
        <p>
          App signing is still in progress, so macOS and Windows may need an
          extra confirmation before opening Electric Agents for the first time.
        </p>
        <ul>
          <li>
            <strong>macOS:</strong> try opening the app, then go to
            <strong>System Settings → Privacy &amp; Security</strong> and choose
            <strong>Open Anyway</strong>.
          </li>
          <li>
            <strong>Windows:</strong> choose <strong>More info</strong>, then
            <strong>Run anyway</strong>.
          </li>
        </ul>
      </aside>
    </Section>

    <!-- ─────────────────── §7b — Mobile · Preview ─────────────────── *
         Reframed from the original "Coming soon" two-card grid to a
         single Preview card pointing at the source repo. The mobile
         apps are not launching with this page, so the two-card
         iOS/Android grid + disabled App Store / Play badges would
         read as vapor; the single repo-link card is honest about
         the current state and matches the `Preview` framing
         introduced by the §1 hero glyph row. See APP_PAGE_PLAN.md
         §7 for the locked body string. -->
    <Section id="mobile" :dark="true">
      <template #eyebrow>Preview</template>
      <template #title>Native iOS &amp; Android App</template>
      <template #subtitle>
        Same agents you run on the desktop, in your&nbsp;pocket.
      </template>

      <article class="ad-mobile-preview-card">
        <div class="ad-mobile-preview-device">
          <AdPlaceholder
            name="mobile-app-preview.png"
            sublabel="iOS · session list · live streaming response"
            aspect="9/16"
          />
        </div>

        <div class="ad-mobile-preview-content">
          <p class="ad-mobile-preview-body">
            Native iOS and Android clients are in active development. The source
            lives in
            <a
              class="ad-mobile-preview-link"
              :href="agentsMobileRepoUrl"
              target="_blank"
              rel="noreferrer"
              >packages/agents-mobile</a
            >
            — clone the repo and run the Expo dev build today, or watch the repo
            to be notified when the public App Store and Google Play listings
            ship with&nbsp;v1.
          </p>
          <div class="ad-mobile-preview-actions">
            <VPButton
              tag="a"
              size="medium"
              theme="alt"
              text="View on GitHub →"
              :href="agentsMobileRepoUrl"
            />
          </div>
        </div>
      </article>
    </Section>

    <!-- ─────────────────── §7c — Canary ─────────────────── -->
    <Section id="canary">
      <template #eyebrow>Pre-release</template>
      <template #title>Canary builds</template>
      <template #subtitle>
        Moving builds from the <code>main</code>&nbsp;branch. Useful for
        previewing the newest desktop changes — prefer the release builds above
        for day-to-day&nbsp;use.
      </template>

      <ul class="ad-canary-list">
        <li
          v-for="entry in canaryEntries"
          :key="entry.platform"
          class="ad-canary-item"
        >
          <span
            class="ad-canary-icon ad-icon"
            :class="`ad-icon--${entry.icon}`"
            aria-hidden="true"
          />
          <span class="ad-canary-name">{{ entry.platform }}</span>
          <span class="ad-canary-assets">
            <a
              v-for="asset in entry.assets"
              :key="asset.assetName"
              :href="releaseUrl(canaryTag, asset.assetName)"
              target="_blank"
              rel="noreferrer"
              class="ad-canary-asset"
            >
              {{ asset.label }}
              <span class="ad-canary-arrow" aria-hidden="true">↓</span>
            </a>
          </span>
        </li>
      </ul>

      <p class="ad-canary-meta">
        Release tag
        <a
          :href="`${githubReleaseBase}/tag/${canaryTag}`"
          target="_blank"
          rel="noreferrer"
          ><code>{{ canaryTag }}</code></a
        >
      </p>
    </Section>

    <!-- ─────────────────── §8 — Bottom CTA ─────────────────── -->
    <BottomCtaStrap id="get-started">
      <template #eyebrow>
        <span>Durable · long-running · cloud-connected</span>
      </template>
      <template #title>Build with Electric&nbsp;Agents</template>
      <template #tagline>
        Stand up the open-source runtime locally, or connect to
        Electric&nbsp;Cloud.
      </template>
      <template #actions>
        <VPButton
          tag="a"
          size="medium"
          theme="brand"
          text="Quickstart"
          href="/docs/agents/quickstart"
        />
        <VPButton
          tag="a"
          size="medium"
          theme="alt"
          text="Agents docs"
          href="/docs/agents/"
        />
        <VPButton
          tag="a"
          size="medium"
          theme="alt"
          text="Cloud"
          href="/cloud/"
        />
      </template>
    </BottomCtaStrap>
  </div>
</template>

<style scoped>
.ad-page {
  overflow-x: hidden;
  max-width: 100vw;
}

/* ── Iconify icon class ─────────────────────────────────────── *
   Mirrors the `.vpi-*` pattern used elsewhere on the site
   (SiteFooter.vue, custom.css). Each `.ad-icon--*` modifier sets
   `--icon-url`; the base `.ad-icon` masks that into the current
   text colour so icons inherit theme tints automatically.
   Source: api.iconify.design (simple-icons + mdi sets). */
.ad-icon {
  display: inline-block;
  width: 1em;
  height: 1em;
  font-size: 18px;
  background-color: currentColor;
  -webkit-mask: var(--icon-url) no-repeat center / contain;
  mask: var(--icon-url) no-repeat center / contain;
  flex-shrink: 0;
}

.ad-icon--apple {
  --icon-url: url('https://api.iconify.design/simple-icons/apple.svg');
}
.ad-icon--windows {
  --icon-url: url('https://api.iconify.design/simple-icons/windows11.svg');
}
.ad-icon--linux {
  --icon-url: url('https://api.iconify.design/mdi/linux.svg');
}
.ad-icon--android {
  --icon-url: url('https://api.iconify.design/simple-icons/android.svg');
}

/* lucide icons — used by the §3 mode cards and the §6 builder grid.
   `lucide` is already the icon set used inside `agents-server-ui`, so
   the marketing page and the product share visual vocabulary. */
.ad-icon--code {
  --icon-url: url('https://api.iconify.design/lucide/code-2.svg');
}
.ad-icon--radio {
  --icon-url: url('https://api.iconify.design/lucide/radio-tower.svg');
}
.ad-icon--microscope {
  --icon-url: url('https://api.iconify.design/lucide/microscope.svg');
}
.ad-icon--layout {
  --icon-url: url('https://api.iconify.design/lucide/layout-grid.svg');
}
.ad-icon--database {
  --icon-url: url('https://api.iconify.design/lucide/database.svg');
}
.ad-icon--history {
  --icon-url: url('https://api.iconify.design/lucide/history.svg');
}
.ad-icon--cable {
  --icon-url: url('https://api.iconify.design/lucide/cable.svg');
}
.ad-icon--radar {
  --icon-url: url('https://api.iconify.design/lucide/radar.svg');
}
.ad-icon--terminal {
  --icon-url: url('https://api.iconify.design/lucide/terminal.svg');
}

/* §4 multi-device pillars + §5 Horton pillars + §5 ask-grid. Kept in
   their own block (rather than appended to the lucide list above) so
   it's obvious which icons are owned by phase 4 — easier to retire if
   the sections ever get restructured. */
.ad-icon--monitor-smartphone {
  --icon-url: url('https://api.iconify.design/lucide/monitor-smartphone.svg');
}
.ad-icon--users {
  --icon-url: url('https://api.iconify.design/lucide/users.svg');
}
.ad-icon--cpu {
  --icon-url: url('https://api.iconify.design/lucide/cpu.svg');
}
.ad-icon--key-round {
  --icon-url: url('https://api.iconify.design/lucide/key-round.svg');
}
.ad-icon--folder-tree {
  --icon-url: url('https://api.iconify.design/lucide/folder-tree.svg');
}
.ad-icon--wand {
  --icon-url: url('https://api.iconify.design/lucide/wand-2.svg');
}
.ad-icon--message-circle {
  --icon-url: url('https://api.iconify.design/lucide/message-circle.svg');
}
.ad-icon--braces {
  --icon-url: url('https://api.iconify.design/lucide/braces.svg');
}
.ad-icon--compass {
  --icon-url: url('https://api.iconify.design/lucide/compass.svg');
}

/* ── §1 hero ────────────────────────────────────────────────── */

.ad-hero {
  position: relative;
  padding: 72px 24px 56px;
  text-align: center;
}

.ad-hero-inner {
  position: relative;
  max-width: 820px;
  margin: 0 auto;
}

.ad-hero-name {
  font-size: 56px;
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: -0.02em;
  color: var(--vp-c-text-1);
  margin: 0;
  padding-bottom: 4px;
  text-wrap: balance;
}

.ad-hero-accent {
  color: var(--vp-c-brand-1);
}

.ad-hero-text {
  font-size: 22px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  margin: 18px auto 28px;
  max-width: 660px;
  line-height: 1.45;
  text-wrap: balance;
}

/* Inline link inside the hero paragraph — points at the Agents
   landing page. Sits in the muted sub-copy so a flat VitePress
   default would disappear; lift it to brand-1 with a thin
   underline to read as an unambiguous link without breaking the
   sub-copy's quiet tone. */
.ad-hero-text a {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  transition: color 120ms ease;
}

.ad-hero-text a:hover {
  color: var(--vp-c-brand-2);
}

.ad-hero-actions {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.ad-download-meta {
  /* Small follow-up line under the §7a desktop download grid;
     previously sat in the hero as `Release notes`, moved down so
     the hero stays focused on the CTAs + platform glyphs. */
  margin: 28px 0 0;
  font-size: 13px;
  color: var(--vp-c-text-3);
  text-align: center;
}

.ad-meta-link {
  color: var(--vp-c-text-2);
  border-bottom: 1px solid var(--vp-c-divider);
  text-decoration: none;
  padding-bottom: 1px;
}

.ad-meta-link:hover {
  color: var(--vp-c-brand-1);
  border-bottom-color: var(--vp-c-brand-1);
}

/* ── §1 hero — platform glyph row ───────────────────────────── *
   Sits between the CTA buttons and the release-notes link, two
   rows in a 5-column grid:
     row 1 — five [icon + label] pairs (macOS · Windows · Linux ·
             iOS · Android)
     row 2 — a single `Preview` pill positioned beneath the iOS +
             Android pair (columns 4–5), softly marking the native
             mobile apps as not-yet-public.
   The 5-column layout is preserved on narrow viewports — the per-
   glyph `minmax(56px, auto)` columns compress comfortably down to
   ~360px without label truncation, so a responsive collapse to a
   2-row grid would only add complexity for no readability gain. */

.ad-hero-platforms {
  display: grid;
  grid-template-columns: repeat(5, minmax(56px, auto));
  justify-content: center;
  align-items: start;
  gap: 14px 28px;
  margin: 32px auto 0;
  max-width: 540px;
}

.ad-hero-glyph {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--vp-c-text-3);
}

/* Vertical divider centred in the 28px column gap between the
   desktop trio (cols 1-3) and the mobile pair (cols 4-5). Sits as
   an absolutely-positioned hairline on the iOS glyph, anchored
   off its container's relative positioning. Top:0 + bottom:<badge
   area> stretches the line from the top of the iOS icon down to
   the bottom of its label — matching the desktop column height —
   while clearing the small `Preview` chip that hangs below.  */
.ad-hero-glyph:nth-child(4)::before {
  content: '';
  position: absolute;
  left: -14px;
  top: 0;
  bottom: 17px;
  width: 1px;
  background: var(--vp-c-divider);
}

.ad-hero-glyph-icon {
  font-size: 22px;
  color: var(--vp-c-text-2);
}

.ad-hero-glyph.is-preview .ad-hero-glyph-icon {
  /* Mobile glyphs are noticeably (but gently) more muted than the
     desktop trio so the eye reads "this is a different cluster"
     before it ever reaches the Preview pill below. */
  color: color-mix(in srgb, var(--vp-c-text-2) 65%, transparent);
}

.ad-hero-glyph-label {
  font-size: 10px;
  line-height: 1;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

/* Per-glyph `Preview` chip — one tucked tight under each mobile
   glyph's label (iOS, Android). Reads as a title-style badge on
   each platform rather than a single anchor pill that left the
   row feeling lopsided. Sized down to ~7px so the chip lives as
   visual punctuation under the label, not a second mark
   competing for attention with the icon. Negative margin-top
   pulls the chip back through the parent's 6px flex `gap` so it
   sits ~1px under the label rather than 6px below it. */
.ad-hero-glyph-preview {
  margin-top: -1px;
  padding: 0 5px;
  font-size: 7px;
  line-height: 1.4;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--vp-c-brand-1) 80%, var(--vp-c-text-3));
  background: color-mix(in srgb, var(--vp-c-brand-1) 10%, transparent);
  border: 1px solid
    color-mix(in srgb, var(--vp-c-brand-1) 32%, var(--vp-c-divider));
  border-radius: 999px;
  white-space: nowrap;
}

/* ── §1 hero mockup pair ────────────────────────────────────── *
   Live desktop mockup + overlapping phone placeholder, sitting at
   the bottom of the hero. The desktop scene is HeroChatStateScene
   (real animated HTML/CSS, OS-reactive); the phone is a placeholder
   until the mobile mockup primitive lands.

   Layout:
     ┌──────────────────────────────────────────────────────────┐
     │                                                          │
     │   [ HeroChatStateScene ]              ┌──────┐           │
     │                                       │      │           │
     │   …                                   │ 📱   │           │
     │                                       │      │           │
     │                                       └──────┘           │
     │                                                          │
     │             Same session. Two devices.                   │
     └──────────────────────────────────────────────────────────┘

   Stage uses `position: relative` + container queries so the phone
   can absolute-overlap the desktop on wide viewports and tuck under
   it (stacked) on narrow viewports without breaking the layout.
   The desktop scene already runs its own internal container queries
   (sidebar collapse, state-tile drop) — sizing the mockup wrapper to
   a fixed width makes those breakpoints fire predictably regardless
   of the surrounding column. */

.ad-hero-mockup {
  /* Break out of the hero's 820-px text column so the mockup can
     fill the page width with breathing room. The 1240-px cap matches
     the design — wider screens just centre the stage. */
  max-width: 1240px;
  margin: 56px auto 0;
  padding: 0 24px;
  container-type: inline-size;
  container-name: hero-mockup;
}

.ad-hero-mockup-stage {
  position: relative;
  width: 100%;
  /* Aspect roughly matches the desktop scene + phone overlap so the
     stage reserves vertical space without depending on the scene's
     intrinsic height. The desktop scene fills the stage; the phone
     hangs off the right edge as an absolute overlay. */
  aspect-ratio: 16 / 10;
  display: flex;
  align-items: stretch;
}

.ad-hero-mockup-desktop {
  /* Desktop occupies most of the stage, leaving room on the right for
     the phone to overlap. Width is a percentage so the scene's
     internal container queries (sidebar / state-tile breakpoints)
     fire predictably as the viewport shrinks. */
  flex: 1 1 auto;
  width: 86%;
  max-width: 86%;
  /* Keep the scene flush-left so the phone overlaps the chat tile's
     right edge — the design intent in the reference. */
  align-self: stretch;
  /* Clip the inner sizing wrapper, which renders at 125 % so the
     scene's intrinsic layout box is bigger than this footprint —
     anything that bleeds past the visible footprint is cut here. */
  overflow: hidden;
}

/* Inner sizing wrapper. We render the scene at 125 % of the desktop
   footprint and then scale it back down by 0.8, so the visible result
   fills `.ad-hero-mockup-desktop` exactly while the scene itself is
   rendered at a higher intrinsic resolution — every UI element
   (sidebar, tile headers, message text, state inspector rows…) lands
   on screen at 80 % of its native size, giving the same on-page
   footprint as a full-resolution desktop screenshot but with finer
   detail per pixel. The scene's internal `@container` queries still
   fire at the larger intrinsic width (~107 % of the stage), so the
   sidebar + state tile remain visible at any reasonable hero width. */
.ad-hero-mockup-desktop-inner {
  width: 125%;
  height: 125%;
  transform: scale(0.8);
  transform-origin: top left;
}

.ad-hero-mockup-phone {
  position: absolute;
  /* Hang off the right edge of the desktop. The phone's left edge
     overlaps the desktop's right column by ~40 px so the eye reads
     "two devices, one workflow" rather than "two separate panels". */
  right: 24px;
  top: 50%;
  transform: translateY(-50%);
  width: 22%;
  min-width: 200px;
  max-width: 280px;
  /* Drop shadow lifts the phone off the desktop visually so the
     overlap reads as foreground, not as a clipped device. */
  filter: drop-shadow(-8px 8px 24px rgba(0, 0, 0, 0.35))
    drop-shadow(0 2px 6px rgba(0, 0, 0, 0.25));
  z-index: 2;
}

/* The AdPlaceholder used as the phone needs a phone-shaped frame:
   tall, rounded corners, dark surface so it reads as a device shell
   even before the real mockup primitive lands. Style the inner
   `.ad-placeholder` it renders via `:deep()` so we don't have to
   touch the placeholder primitive itself. */
.ad-hero-mockup-phone :deep(.ad-placeholder) {
  height: 100%;
  border-radius: 32px;
  border-width: 1.5px;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 75%, transparent);
}

.ad-hero-mockup-caption {
  margin: 22px 0 0;
  text-align: center;
  font-size: 13px;
  letter-spacing: 0.04em;
  color: var(--vp-c-text-3);
}

/* Below ~720 px container width the overlap stops working — the
   desktop tile has already collapsed its state pane (via its own
   @container query at 720 px), and squeezing a phone alongside makes
   both unreadable. Stack instead: desktop on top, phone below,
   centred. */
@container hero-mockup (max-width: 720px) {
  .ad-hero-mockup-stage {
    flex-direction: column;
    align-items: center;
    aspect-ratio: auto;
    gap: 24px;
  }
  .ad-hero-mockup-desktop {
    width: 100%;
    max-width: 100%;
    aspect-ratio: 16 / 10;
  }
  .ad-hero-mockup-desktop-inner {
    /* Drop the oversized-render trick once the layout stacks. The
       desktop is the primary device on its own row, so it should fill
       the column at 1:1 rather than rendering at 125 % and scaling
       back down. */
    width: 100%;
    height: 100%;
    transform: none;
  }
  .ad-hero-mockup-phone {
    position: static;
    transform: none;
    width: 60%;
    max-width: 280px;
    aspect-ratio: 9 / 19;
  }
}

/* ── §3 three ways to use it ────────────────────────────────── *
   Three equal-width cards in a row at desktop widths, collapsing
   to two columns < 980px and one column on mobile. Each card is a
   vertical stack of: icon · category eyebrow · title · body
   paragraph · "You can:" label · 4-item bullet list.

   List-bottoms alignment across cards is the product of TWO
   mechanisms working together:
     1. `align-items: stretch` on the grid → cards take the height
        of the tallest one, so all three share a bottom edge.
     2. `margin-top: auto` on `.ad-modes-list-label` (NOT the list)
        → the (label + list) block anchors to the bottom of each
        card's flex column, so when body copy is shorter the extra
        space lands above the label, not between label and list.
   Either mechanism alone is insufficient: stretching without the
   auto-margin leaves lists floating mid-card; auto-margin without
   stretching collapses each card's height to its content.

   The strip beneath the grid restates the one-integrated-platform
   takeaway as a centred, muted single line. */

.ad-modes-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  align-items: stretch;
}

.ad-modes-card {
  display: flex;
  flex-direction: column;
  padding: 28px 26px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  background: var(--vp-c-bg);
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.ad-modes-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(
    in srgb,
    var(--vp-c-brand-1) 45%,
    var(--vp-c-divider)
  );
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.08);
}

.ad-modes-icon {
  font-size: 22px;
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: color-mix(in srgb, var(--vp-c-brand-1) 8%, transparent);
  border: 1px solid
    color-mix(in srgb, var(--vp-c-brand-1) 22%, var(--vp-c-divider));
  color: var(--vp-c-brand-1);
  margin-bottom: 18px;
}

.ad-modes-icon .ad-icon {
  font-size: 22px;
}

.ad-modes-title {
  margin: 0 0 12px;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1.25;
  color: var(--vp-c-text-1);
  text-wrap: balance;
}

.ad-modes-body {
  margin: 0 0 20px;
  font-size: 15px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  text-wrap: pretty;
}

/* "You can" mini-eyebrow above each bullet list. Same mono-uppercase
   feel as the card eyebrow so the visual rhythm inside each card
   stays consistent without introducing a second typographic
   register.

   `margin-top: auto` lives on the LABEL (not the list) so the whole
   "You can …" block — label and bullets together — anchors to the
   bottom of the card. Cards with shorter body copy get extra
   whitespace BETWEEN body and label, not between label and list. */
.ad-modes-list-label {
  margin: auto 0 8px;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.ad-modes-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}

.ad-modes-list li {
  position: relative;
  padding-left: 16px;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--vp-c-text-2);
}

.ad-modes-list li::before {
  content: '·';
  position: absolute;
  left: 4px;
  top: -1px;
  color: var(--vp-c-brand-1);
  font-weight: 700;
}

.ad-modes-list code {
  font-size: 12.5px;
}

.ad-modes-strip {
  margin: 36px auto 0;
  text-align: center;
  font-size: 13px;
  letter-spacing: 0.04em;
  color: var(--vp-c-text-3);
}

/* ── §3.5 scenarios ─────────────────────────────────────────── *
   2×2 grid of worked examples that span the three modes from §3.
   Each card stacks: placeholder illustration (16:9) at the top,
   a `Touches: …` mono eyebrow, a semi-bold title, then ~3 lines
   of body. The Section is rendered with `:dark="true"`, which
   forces dark theme variables for its subtree — so the cards
   render dark even in global light mode and pop as the page's
   "in practice" interlude between the §3 modes grid and the §6
   builder grid. */

.ad-scenarios-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
}

.ad-scenarios-card {
  display: flex;
  flex-direction: column;
  padding: 24px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  /* `--vp-c-bg` is one rung BELOW the dark Section's `--ea-surface-alt`
     (= `--vp-c-bg-soft`) fill, so cards read as recessed panels
     within the section rather than elevated tiles — same convention
     the `.ad-mobile-preview-card` further down uses for the same
     dark-section context. The thin border keeps the edge defined
     against the slightly lighter section fill. */
  background: var(--vp-c-bg);
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.04);
}

.ad-scenarios-illo {
  margin-bottom: 18px;
}

.ad-scenarios-touches {
  margin: 0 0 10px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.ad-scenarios-title {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--vp-c-text-1);
  letter-spacing: -0.005em;
  text-wrap: balance;
}

.ad-scenarios-body {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  text-wrap: pretty;
}

.ad-scenarios-body code {
  font-size: 12.5px;
}

/* ── §4 multi-device, multi-user ────────────────────────────── *
   Three-pillar grid that sits below the diagram placeholder
   (16/8). Equal-width columns at desktop widths, collapsing to
   2 then 1 at narrower breakpoints alongside the rest of the
   page. Pillars share the brand-tinted square icon CHIP pattern
   from §3 modes (same tint formula, same rounded-square shape,
   no border-thickness change) but render slightly smaller
   (40px/10px-radius vs §3's 44px/12px-radius) so the body copy
   underneath stays the dominant element — these pillars carry
   one short paragraph each rather than the §3 cards' bullet
   list. The whole block sits 36px below the diagram, matching
   the gap between the §3 modes grid and its strip. */

.ad-multi-pillars {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  margin-top: 36px;
}

.ad-multi-pillar {
  display: flex;
  flex-direction: column;
}

.ad-multi-icon {
  font-size: 20px;
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: color-mix(in srgb, var(--vp-c-brand-1) 8%, transparent);
  border: 1px solid
    color-mix(in srgb, var(--vp-c-brand-1) 22%, var(--vp-c-divider));
  color: var(--vp-c-brand-1);
  margin-bottom: 14px;
}

.ad-multi-icon .ad-icon {
  font-size: 20px;
}

.ad-multi-title {
  margin: 0 0 8px;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.005em;
  line-height: 1.3;
  color: var(--vp-c-text-1);
}

.ad-multi-body {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  text-wrap: pretty;
}

/* ── §5 Horton, in the box ──────────────────────────────────── *
   Two-zone layout under a `:dark` Section:
     Zone 1 — three capability pillars (provider · working
              directory · skills + slash) in a 3-column grid.
     Zone 2 — "Things you can ask Horton to do" 3-column prompt
              grid (Chat / Code / Research) with `<code>` example
              prompts so the visual reads as a prompt library
              rather than another card grid.
   The two zones are separated by a dashed hairline rule (not a
   solid block) so the section reads as one continuous Horton
   pitch rather than two unrelated sub-sections. */

.ad-horton-pillars {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 28px;
  margin-top: 8px;
}

.ad-horton-pillar {
  display: flex;
  flex-direction: column;
}

.ad-horton-pillar-icon {
  font-size: 20px;
  width: 42px;
  height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 11px;
  background: color-mix(in srgb, var(--vp-c-brand-1) 12%, transparent);
  border: 1px solid
    color-mix(in srgb, var(--vp-c-brand-1) 28%, var(--vp-c-divider));
  color: var(--vp-c-brand-1);
  margin-bottom: 16px;
}

.ad-horton-pillar-icon .ad-icon {
  font-size: 20px;
}

.ad-horton-pillar-title {
  margin: 0 0 10px;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.005em;
  line-height: 1.3;
  color: var(--vp-c-text-1);
}

.ad-horton-pillar-body {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  text-wrap: pretty;
}

.ad-horton-pillar-body code {
  font-size: 12.5px;
}

.ad-horton-ask {
  margin-top: 44px;
  padding-top: 36px;
  border-top: 1px dashed var(--vp-c-divider);
}

.ad-horton-ask-eyebrow {
  margin: 0 0 18px;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.ad-horton-ask-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 22px;
}

.ad-horton-ask-col {
  display: flex;
  flex-direction: column;
  padding: 18px 18px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg);
}

.ad-horton-ask-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.ad-horton-ask-icon {
  font-size: 16px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  background: color-mix(in srgb, var(--vp-c-brand-1) 8%, transparent);
  border: 1px solid
    color-mix(in srgb, var(--vp-c-brand-1) 22%, var(--vp-c-divider));
  color: var(--vp-c-brand-1);
}

.ad-horton-ask-icon .ad-icon {
  font-size: 16px;
}

.ad-horton-ask-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--vp-c-text-1);
}

.ad-horton-ask-col ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}

.ad-horton-ask-col li {
  font-size: 13px;
  line-height: 1.45;
  color: var(--vp-c-text-2);
}

.ad-horton-ask-col code {
  font-size: 12.5px;
  /* Code chips in the ask-grid are the section's hero ornament — the
     reader skims the section and the chips are what they pick up.
     Slightly more padding and a softer background than VitePress's
     default inline-code styling so the chips read as prompt
     primitives, not random inline references. */
  padding: 3px 7px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--vp-c-brand-1) 7%, var(--vp-c-bg-soft));
  border: 1px solid
    color-mix(in srgb, var(--vp-c-brand-1) 14%, var(--vp-c-divider));
  color: var(--vp-c-text-1);
}

/* ── §6 built for builders ──────────────────────────────────── *
   3×2 grid at desktop widths, collapses to 2 columns then 1. Each
   card holds a lucide icon, a short title, a one-sentence feature
   description, and a "Use it to…" hint. The hint is intentionally
   typed as a separate paragraph (rather than appended inline to
   the body) so it can carry its own slightly muted colour and act
   as the card's call-to-mind. */

.ad-builders-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.ad-builders-card {
  display: flex;
  flex-direction: column;
  padding: 22px 22px 24px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg);
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.ad-builders-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(
    in srgb,
    var(--vp-c-brand-1) 45%,
    var(--vp-c-divider)
  );
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.07);
}

.ad-builders-icon {
  font-size: 18px;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: color-mix(in srgb, var(--vp-c-brand-1) 8%, transparent);
  border: 1px solid
    color-mix(in srgb, var(--vp-c-brand-1) 22%, var(--vp-c-divider));
  color: var(--vp-c-brand-1);
  margin-bottom: 14px;
}

.ad-builders-icon .ad-icon {
  font-size: 18px;
}

.ad-builders-title {
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--vp-c-text-1);
  line-height: 1.3;
}

.ad-builders-body {
  margin: 0 0 12px;
  font-size: 14px;
  line-height: 1.55;
  color: var(--vp-c-text-2);
  text-wrap: pretty;
}

.ad-builders-body code {
  font-size: 12px;
}

/* ── §7a desktop ────────────────────────────────────────────── */

.ad-desktop-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin-top: 8px;
}

.ad-platform-card {
  display: flex;
  flex-direction: column;
  padding: 24px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  background: var(--vp-c-bg);
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.ad-platform-card.is-recommended {
  border-color: color-mix(
    in srgb,
    var(--vp-c-brand-1) 40%,
    var(--vp-c-divider)
  );
}

.ad-platform-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(
    in srgb,
    var(--vp-c-brand-1) 55%,
    var(--vp-c-divider)
  );
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.08);
}

.ad-platform-head {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}

.ad-platform-icon {
  font-size: 20px;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-1);
}

.ad-platform-icon .ad-icon {
  font-size: 20px;
}

.ad-platform-title h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--vp-c-text-1);
  line-height: 1.2;
}

.ad-platform-title p {
  margin: 3px 0 0;
  font-size: 13px;
  color: var(--vp-c-text-2);
  line-height: 1.4;
}

/* Per-platform CTA — uses the site's <VPButton> directly so the
   pill styling, padding and theme-aware colours match every other
   button on the site. Only the detected platform's first download
   gets theme="brand"; the rest use theme="alt" to keep the visual
   weight focused on the recommended download. Linux exposes both
   AppImage and DEB as side-by-side buttons; the other platforms
   ship a single download. */
.ad-platform-cta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.ad-signing-note {
  margin-top: 24px;
  padding-bottom: 18px;
}

.ad-signing-note p {
  max-width: 700px;
}

.ad-signing-note ul {
  margin: 8px 0 0;
  padding-left: 20px;
  display: grid;
  gap: 6px;
}

/* ── §7b mobile · preview ───────────────────────────────────── *
   Single card replacing the previous two-card iOS/Android grid.
   Body text + GitHub CTA — body and actions sit side-by-side on
   desktop, stack vertically below 768px. */

/* §7b mobile preview is a two-column strap: phone-shaped placeholder
   on the left + body / CTA on the right. Matches the §2 visual-strap
   rhythm (placeholder + caption) rather than the §7a download-grid
   rhythm, so the dark section reads as "here's the device" rather
   than "another row of platforms". Phase 5 swaps the placeholder for
   a real iOS screenshot. */
.ad-mobile-preview-card {
  display: grid;
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
  align-items: center;
  gap: 48px;
  max-width: 920px;
  margin: 0 auto;
}

.ad-mobile-preview-device {
  /* AdPlaceholder fills this column at its 9:16 aspect ratio; no
     extra chrome here — the placeholder's own dashed border + caption
     carry the visual. */
  width: 100%;
}

.ad-mobile-preview-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.ad-mobile-preview-body {
  margin: 0;
  font-size: 16px;
  line-height: 1.65;
  color: var(--vp-c-text-2);
  text-wrap: pretty;
}

.ad-mobile-preview-link {
  color: var(--vp-c-brand-1);
  text-decoration: none;
  border-bottom: 1px solid
    color-mix(in srgb, var(--vp-c-brand-1) 30%, transparent);
}

.ad-mobile-preview-link:hover {
  border-bottom-color: var(--vp-c-brand-1);
}

.ad-mobile-preview-actions {
  display: flex;
  align-items: center;
}

/* ── §7c canary ─────────────────────────────────────────────── *
   Single compact list rather than four mini-card boxes. Each row:
   icon + platform + inline download chips, hairline-separated
   like an engineering reference table. */

.ad-canary-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg);
  overflow: hidden;
}

.ad-canary-item {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  font-size: 14px;
  color: var(--vp-c-text-2);
}

.ad-canary-item + .ad-canary-item {
  border-top: 1px solid var(--vp-c-divider);
}

.ad-canary-icon {
  font-size: 16px;
  color: var(--vp-c-text-2);
}

.ad-canary-name {
  color: var(--vp-c-text-1);
  font-weight: 500;
}

.ad-canary-assets {
  display: inline-flex;
  gap: 4px;
}

.ad-canary-asset {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--vp-c-text-2);
  text-decoration: none;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}

.ad-canary-asset:hover {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
}

.ad-canary-arrow {
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-3);
}

.ad-canary-meta {
  margin: 16px 0 0;
  font-size: 13px;
  color: var(--vp-c-text-3);
}

.ad-canary-meta a {
  color: var(--vp-c-text-2);
  text-decoration: none;
  border-bottom: 1px solid var(--vp-c-divider);
}

.ad-canary-meta a:hover {
  color: var(--vp-c-brand-1);
  border-bottom-color: var(--vp-c-brand-1);
}

.ad-canary-meta code {
  font-size: 12px;
}

/* ── Responsive ─────────────────────────────────────────────── */

@media (max-width: 980px) {
  /* The three §3 mode cards carry a lot of body + list text and
     start to look cramped before the rest of the page does, so they
     drop to a 2-up grid earlier than the desktop downloads. The §4
     multi-device pillars and §5 Horton pillars / ask-grid collapse
     here too so the page reflows together rather than at staggered
     breakpoints — easier to reason about, and the three-pillar
     blocks read more comfortably at half-width than at thirds. */
  .ad-modes-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .ad-multi-pillars,
  .ad-horton-pillars,
  .ad-horton-ask-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .ad-builders-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .ad-desktop-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .ad-hero {
    padding: 56px 20px 40px;
  }
  .ad-hero-name {
    font-size: 38px;
  }
  .ad-hero-text {
    font-size: 18px;
  }
  .ad-mobile-preview-card {
    grid-template-columns: 1fr;
    gap: 28px;
  }
  .ad-mobile-preview-device {
    max-width: 240px;
    margin: 0 auto;
  }
  .ad-mobile-preview-actions {
    justify-self: start;
  }
  .ad-modes-grid {
    grid-template-columns: 1fr;
  }
  .ad-modes-card {
    padding: 24px 22px;
  }
  .ad-modes-title {
    font-size: 20px;
  }
  .ad-scenarios-grid {
    grid-template-columns: 1fr;
    gap: 18px;
  }
  .ad-scenarios-title {
    font-size: 17px;
  }
  /* On mobile, §4 / §5 also drop to single columns so the long body
     text doesn't get squeezed against a half-width column. */
  .ad-multi-pillars,
  .ad-horton-pillars,
  .ad-horton-ask-grid {
    grid-template-columns: 1fr;
  }
  .ad-horton-pillar-title {
    font-size: 17px;
  }
}

@media (max-width: 600px) {
  .ad-builders-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .ad-hero-name {
    font-size: 30px;
  }
  .ad-hero-actions {
    flex-direction: column;
    align-items: stretch;
    max-width: 280px;
    margin: 0 auto;
  }
  .ad-canary-item {
    grid-template-columns: 20px minmax(0, 1fr);
  }
  .ad-canary-assets {
    grid-column: 1 / -1;
    flex-wrap: wrap;
  }
}
</style>
