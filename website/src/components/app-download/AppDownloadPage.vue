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

const githubReleaseBase = `https://github.com/electric-sql/electric/releases`
const appReleaseNotesUrl = `${githubReleaseBase}?q=%22%40electric-ax%2Fagents-desktop%22&expanded=true`

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

type MobilePlatform = {
  id: 'ios' | 'android'
  icon: 'apple' | 'android'
  storeIcon: 'appstore' | 'googleplay'
  name: string
  storeLabel: string
}

const mobilePlatforms: MobilePlatform[] = [
  {
    id: `ios`,
    icon: `apple`,
    storeIcon: `appstore`,
    name: `iOS`,
    storeLabel: `App Store`,
  },
  {
    id: `android`,
    icon: `android`,
    storeIcon: `googleplay`,
    name: `Android`,
    storeLabel: `Google Play`,
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
          Run, observe and steer
          your&nbsp;<span class="ad-hero-accent">agents</span>.
        </h1>
        <p class="ad-hero-text">
          Desktop and mobile clients for the Electric Agents platform — one app
          to code with Horton, attach to remote sessions, and build your own
          agents on the infra and&nbsp;SDK.
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
          aria-label="Available on macOS, Windows and Linux. Native iOS and Android apps in preview."
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
          </span>
          <span class="ad-hero-glyph is-preview">
            <span
              class="ad-hero-glyph-icon ad-icon ad-icon--android"
              aria-hidden="true"
            />
            <span class="ad-hero-glyph-label mono">Android</span>
          </span>
          <span class="ad-hero-platform-preview mono" aria-hidden="true"
            >Preview</span
          >
        </div>

        <p class="ad-hero-meta">
          <a
            class="ad-meta-link"
            :href="appReleaseNotesUrl"
            target="_blank"
            rel="noreferrer"
            >Release notes</a
          >
        </p>
      </div>
    </section>

    <!--
      Phase 1 placeholder block.

      The six <Section> shells below are the new structure for the
      /app page rewrite (see APP_PAGE_PLAN.md). Each one carries an
      <AdPlaceholder> as its content for now; later phases swap each
      placeholder for the section's real copy + visuals. The chrome
      stays the same, so each swap is a localised diff.

      Phases that fill each section:
        §2 visual strap          → phase 2 (placeholder image pair)
                                   phase 5 (real screenshots)
        §3 three ways to use it  → phase 3
        §3.5 scenarios           → phase 3
        §4 multi-device          → phase 4
        §5 bundled Horton        → phase 4
        §6 built for builders    → phase 3
    -->

    <!-- ─────────────── §2 — Visual strap (desktop + mobile) ─────────────── -->
    <Section id="visual">
      <!--
        Phase 2 lands the strap as a placeholder PAIR — desktop window
        on the left, phone screen on the right — so the layout reads
        as the eventual two-device shot even before real screenshots
        arrive. Phase 5 swaps each placeholder for the captured
        asset (desktop-hero.png / mobile-hero.png) without touching
        the surrounding chrome.
      -->
      <div class="ad-visual-strap">
        <AdPlaceholder
          class="ad-visual-strap-desktop"
          name="desktop-hero.png"
          sublabel="Sidebar tree + tile workspace · chat tile left · state explorer right"
          aspect="16/10"
        />
        <AdPlaceholder
          class="ad-visual-strap-mobile"
          name="mobile-hero.png"
          sublabel="Mobile chat screen · same session, live streaming response"
          aspect="9/16"
        />
      </div>
      <p class="ad-visual-strap-caption mono">
        Same session. Two devices. One control plane.
      </p>
    </Section>

    <!-- ─────────────────── §3 — Three ways to use it ─────────────────── -->
    <Section id="three-ways">
      <AdPlaceholder
        name="§3 — Three ways to use it"
        sublabel="Three cards: Code locally · Attach remotely · Build with the SDK"
        aspect="16/6"
      />
    </Section>

    <!-- ─────────────────── §3.5 — Scenarios ─────────────────── -->
    <Section id="scenarios">
      <AdPlaceholder
        name="§3.5 — Scenarios"
        sublabel="Four worked end-to-end examples spanning the three modes above"
        aspect="16/8"
      />
    </Section>

    <!-- ─────────────────── §4 — Multi-device, multi-user ─────────────────── -->
    <Section id="multi-device">
      <AdPlaceholder
        name="§4 — Multi-device, multi-user"
        sublabel="Diagram: phone ↔ Electric Cloud ↔ desktop (also a pull-wake worker)"
        aspect="16/8"
      />
    </Section>

    <!-- ─────────────────── §5 — Bundled Horton ─────────────────── -->
    <Section id="horton">
      <AdPlaceholder
        name="§5 — Bundled Horton"
        sublabel="Model picker · working-directory picker · tools · skills · /slash commands"
        aspect="16/8"
      />
    </Section>

    <!-- ─────────────────── §6 — Built for builders ─────────────────── -->
    <Section id="builders">
      <AdPlaceholder
        name="§6 — Built for builders"
        sublabel="State explorer · entity timeline · tile workspace · MCP · local discovery · CLI installer"
        aspect="16/8"
      />
    </Section>

    <!--
      ═══════════════════ §7 — Download ═══════════════════

      The three <Section> blocks below (desktop / mobile / canary)
      collectively make up §7 of the new page. They keep their own
      anchors (#desktop, #mobile, #canary) for backwards compatibility
      with any external links; phase 6 verifies these still resolve
      after the rest of the page is in place.

      Phase 1 leaves their copy untouched. The mobile sub-section is
      still labelled "Coming soon"; a later phase reframes it as
      "Mobile · Preview" linking to packages/agents-mobile on GitHub
      (see APP_PAGE_PLAN.md §7).
    -->

    <!-- ─────────────────── §7a — Desktop ─────────────────── -->
    <Section id="desktop">
      <template #eyebrow>Desktop</template>
      <template #title>Choose your platform</template>
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

    <!-- ─────────────────── §7b — Mobile (coming soon) ─────────────────── -->
    <Section id="mobile" :dark="true">
      <template #eyebrow>Mobile · Coming soon</template>
      <template #title>Native iOS &amp; Android</template>
      <template #subtitle>
        Native mobile clients are in development. Same agents you run on the
        desktop, in your&nbsp;pocket.
      </template>

      <div class="ad-mobile-grid">
        <article
          v-for="platform in mobilePlatforms"
          :key="platform.id"
          class="ad-mobile-card"
          aria-disabled="true"
        >
          <span class="ad-mobile-icon" aria-hidden="true">
            <span class="ad-icon" :class="`ad-icon--${platform.icon}`" />
          </span>
          <h3 class="ad-mobile-name">{{ platform.name }}</h3>
          <span class="ad-soon-pill mono">Coming soon</span>
          <span class="ad-store-badge">
            <span
              class="ad-store-glyph ad-icon"
              :class="`ad-icon--${platform.storeIcon}`"
              aria-hidden="true"
            />
            <span class="ad-store-label">{{ platform.storeLabel }}</span>
          </span>
        </article>
      </div>
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
.ad-icon--appstore {
  --icon-url: url('https://api.iconify.design/simple-icons/appstore.svg');
}
.ad-icon--googleplay {
  --icon-url: url('https://api.iconify.design/simple-icons/googleplay.svg');
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

.ad-hero-actions {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.ad-hero-meta {
  margin: 18px 0 0;
  font-size: 13px;
  color: var(--vp-c-text-3);
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
   On narrow viewports the row collapses to 3 columns, with iOS +
   Android wrapping onto a second visual row that keeps the
   preview pill anchored beneath them. */

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
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--vp-c-text-3);
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
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.ad-hero-platform-preview {
  grid-row: 2;
  grid-column: 4 / 6;
  justify-self: center;
  align-self: start;
  margin-top: 4px;
  padding: 3px 10px;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--vp-c-brand-1) 80%, var(--vp-c-text-3));
  background: color-mix(in srgb, var(--vp-c-brand-1) 10%, transparent);
  border: 1px solid
    color-mix(in srgb, var(--vp-c-brand-1) 32%, var(--vp-c-divider));
  border-radius: 999px;
  white-space: nowrap;
}

/* ── §2 visual strap ────────────────────────────────────────── *
   Desktop screenshot left (16:10), phone screenshot right (9:16);
   the 2.4:1 column split keeps both placeholders' rendered
   heights close while preserving each device's natural aspect
   ratio. Caption sits centred below the pair. */

.ad-visual-strap {
  display: grid;
  /* `minmax(0, …)` overrides the default `min-width: auto` on grid
     items so that the placeholders' aspect-ratio + intrinsic content
     can't push the columns past their fractional allocation. Without
     this, the AdPlaceholder labels widen the mobile column enough to
     overflow the section's max-width. */
  grid-template-columns: minmax(0, 2.4fr) minmax(0, 1fr);
  gap: 24px;
  align-items: stretch;
}

.ad-visual-strap-caption {
  margin: 22px 0 0;
  text-align: center;
  font-size: 13px;
  letter-spacing: 0.04em;
  color: var(--vp-c-text-3);
}

@media (max-width: 768px) {
  .ad-visual-strap {
    grid-template-columns: 1fr;
    gap: 16px;
  }
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

/* ── §7b mobile ─────────────────────────────────────────────── */

.ad-mobile-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

.ad-mobile-card {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  background: var(--vp-c-bg);
}

.ad-mobile-icon {
  font-size: 22px;
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-1);
}

.ad-mobile-icon .ad-icon {
  font-size: 22px;
}

.ad-mobile-name {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--vp-c-text-1);
}

.ad-soon-pill {
  padding: 3px 9px;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  background: color-mix(in srgb, var(--vp-c-brand-1) 16%, transparent);
  color: var(--vp-c-brand-1);
  border-radius: 999px;
  white-space: nowrap;
  justify-self: end;
}

.ad-store-badge {
  grid-column: 1 / -1;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 14px;
  font-weight: 500;
}

.ad-store-glyph {
  font-size: 18px;
  color: var(--vp-c-text-1);
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

@media (max-width: 900px) {
  .ad-desktop-grid,
  .ad-mobile-grid {
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
  .ad-mobile-card {
    grid-template-columns: 36px minmax(0, 1fr) auto;
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
