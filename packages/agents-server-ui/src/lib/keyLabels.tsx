import { Kbd } from '../ui'
import { isMacPlatform } from '../hooks/useHotkey'

/**
 * Tiny helpers for rendering keyboard shortcut hints next to buttons,
 * menu items, and tooltips.
 *
 * `mod` resolves to `⌘` on macOS and `Ctrl` on other platforms,
 * matching the resolution in `useHotkey('mod+...')` so the displayed
 * hint always matches the actually-bound shortcut.
 */

export function modSymbol(): string {
  return isMacPlatform() ? `⌘` : `Ctrl`
}

/**
 * Detect whether we're running inside an Electron renderer. Used to
 * decide which shortcut hint to *show* for actions whose natural
 * binding (e.g. `⌘N` for "new session") is intercepted by the browser
 * at the OS level and only works in the desktop build.
 */
export function isElectron(): boolean {
  if (typeof navigator === `undefined`) return false
  if (/electron/i.test(navigator.userAgent)) return true
  // Some Electron builds set this on the global process object.
  const proc = (
    globalThis as unknown as { process?: { versions?: Record<string, string> } }
  ).process
  return Boolean(proc?.versions?.electron)
}

type ModSpec = { letter: string; shift?: boolean } | string // legacy single-letter form

function normaliseSpec(spec: ModSpec): { letter: string; shift: boolean } {
  if (typeof spec === `string`) return { letter: spec, shift: false }
  return { letter: spec.letter, shift: spec.shift ?? false }
}

/**
 * Render a `mod[+shift]+<key>` shortcut as keycaps. On macOS it
 * collapses to a single `⌘[⇧]<KEY>` pill; on other platforms it
 * renders `Ctrl [Shift] <KEY>` as separate pills, matching the OS
 * convention.
 */
export function ModKey(spec: ModSpec): React.ReactElement {
  const { letter, shift } = normaliseSpec(spec)
  const upper = letter.toUpperCase()
  if (isMacPlatform()) {
    return <Kbd>{`⌘${shift ? `⇧` : ``}${upper}`}</Kbd>
  }
  return (
    <>
      <Kbd>Ctrl</Kbd>
      {shift && <Kbd>Shift</Kbd>}
      <Kbd>{upper}</Kbd>
    </>
  )
}

/** Plain-text label for tooltips, e.g. `⌘N`, `⌘⇧O`, `Ctrl+Shift+O`. */
export function modKeyLabel(spec: ModSpec): string {
  const { letter, shift } = normaliseSpec(spec)
  const upper = letter.toUpperCase()
  if (isMacPlatform()) return `⌘${shift ? `⇧` : ``}${upper}`
  return `Ctrl+${shift ? `Shift+` : ``}${upper}`
}

/**
 * Shortcut for the "New session" action.
 *
 * - In the **desktop / Electron** build, the natural choice (`⌘N` /
 *   `Ctrl+N`) is intercepted by the OS in normal browsers, but works
 *   fine inside Electron. We display it as `⌘N` there.
 * - In a **browser**, `⌘N` opens a new browser window — there's no way
 *   to override that with `preventDefault`. We fall back to
 *   `⌘⇧O` / `Ctrl+Shift+O` (a common "new chat" combo that browsers
 *   don't reserve) and display that hint instead.
 *
 * The `useHotkey` binding registers **both** combinations regardless,
 * so users can press whichever they remember.
 */
export function newSessionLabel(): string {
  return isElectron()
    ? modKeyLabel(`n`)
    : modKeyLabel({ letter: `o`, shift: true })
}

/** JSX form of `newSessionLabel` for inline keycap rendering. */
export function NewSessionKey(): React.ReactElement {
  return isElectron() ? <ModKey letter="n" /> : <ModKey letter="o" shift />
}
