import { onMounted, ref } from 'vue'

/**
 * The three platform variants the desktop app paints different window
 * controls for. Mac visitors get traffic lights; Windows visitors get
 * the Windows window controls; everyone else gets the Linux variant.
 *
 * Architecture (= we don't carry it). The download CTA needs to know
 * macOS-arm64 vs macOS-x64 to suggest the right binary, but the
 * mockup just needs the OS family. Keeping this composable narrow
 * means it can be reused anywhere that wants OS-conditional chrome
 * (mockup window frame, future homepage hero, OG image renderer)
 * without dragging in the macOS-arch detection logic that
 * `AppDownloadPage.vue` carries for its CTA.
 */
export type DetectedOs = `macos` | `windows` | `linux`

/**
 * Detect the visitor's OS, defaulting to `'macos'` on the server (no
 * `navigator`). On hydrate, the ref flips to the actual detected OS.
 *
 * SSR safety: the default produces a single-frame "always macOS"
 * first paint on Windows/Linux visitors. Acceptable tradeoff vs. a
 * flash-of-nothing — by the time the eye registers the chrome the
 * `onMounted` callback has fired and the ref has updated. If we
 * later want to avoid the flicker entirely, set a `data-os` attribute
 * on `<html>` from a tiny inline script before VitePress hydrates.
 *
 * UA-sniffing notes:
 *
 *   - All Mac browsers (Intel + Apple Silicon) report "Intel Mac OS X"
 *     in the UA — a deliberate Apple/browser legacy-compat decision.
 *     We don't try to detect the arch here; that lives in
 *     `AppDownloadPage.vue` for the download CTA. We just need
 *     macOS vs not-macOS.
 *   - iPad-as-Mac mode, "iPad Pro" desktop-class browsers, and any
 *     other Apple-shaped UA fall through to the macOS default — fine,
 *     because the mockup chrome is the same.
 *   - Linux UAs vary wildly (Ubuntu, Fedora, ChromeOS, plain X11).
 *     The regex covers the common cases and explicitly excludes
 *     Android (which would otherwise match `Linux`).
 *   - Windows phones / mobile UAs match the same "Windows" pattern
 *     as desktop and render Windows chrome — uncommon enough that
 *     it's not worth a separate branch.
 */
export function useDetectedOs(initial: DetectedOs = `macos`) {
  const os = ref<DetectedOs>(initial)

  onMounted(() => {
    if (typeof navigator === `undefined`) return
    const ua = `${navigator.userAgent || ``} ${navigator.platform || ``}`
    if (/Win(dows|64|32)|WOW64|WinNT/i.test(ua)) {
      os.value = `windows`
    } else if (
      /Linux|X11|Ubuntu|Fedora|Debian/i.test(ua) &&
      !/Android/i.test(ua)
    ) {
      os.value = `linux`
    } else {
      os.value = `macos`
    }
  })

  return { os }
}
