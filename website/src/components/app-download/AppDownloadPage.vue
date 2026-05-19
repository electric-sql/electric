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
          Electric&nbsp;<span class="ad-hero-accent">Agents</span>&nbsp;App
        </h1>
        <p class="ad-hero-text">
          A native home for your long-running&nbsp;agents.
        </p>

        <div class="ad-hero-actions">
          <VPButton
            tag="a"
            size="medium"
            theme="brand"
            :text="primaryPlatform.downloads[0].label"
            :href="latestReleaseUrl(primaryPlatform.downloads[0].assetName)"
          />
          <VPButton
            tag="a"
            size="medium"
            theme="alt"
            text="Other platforms"
            href="#desktop"
          />
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

      <!-- TODO(follow-up): app screenshot / mockup goes here. The
           previous CSS-rendered agents-server-ui mockup was removed
           to keep the hero clean ahead of a proper image asset. -->
    </section>

    <!-- ─────────────────── §2 — Desktop ─────────────────── -->
    <Section id="desktop">
      <template #eyebrow>Desktop</template>
      <template #title>Choose your platform</template>
      <template #subtitle>
        Pre-built artifacts for macOS, Windows and Linux. Signing and
        notarization are still being wired up, so OS install warnings are
        expected on this&nbsp;preview.
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
    </Section>

    <!-- ─────────────────── §3 — Mobile (coming soon) ─────────────────── -->
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

    <!-- ─────────────────── §4 — Canary ─────────────────── -->
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

    <!-- ─────────────────── §5 — Bottom CTA ─────────────────── -->
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

/* ── §2 desktop ─────────────────────────────────────────────── */

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

/* ── §3 mobile ──────────────────────────────────────────────── */

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

/* ── §4 canary ──────────────────────────────────────────────── *
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
