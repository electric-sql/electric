import { useEffect } from 'react'

type HotkeyOptions = {
  /** Skip when the focused element is a text input / textarea / contenteditable. */
  ignoreInputs?: boolean
  /** Disable the hook (handler is not registered). */
  disabled?: boolean
}

const isMac = (): boolean =>
  typeof navigator !== `undefined` &&
  /(mac|iphone|ipad|ipod)/i.test(navigator.platform || navigator.userAgent)

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === `INPUT` || tag === `TEXTAREA` || tag === `SELECT`) return true
  if (target.isContentEditable) return true
  return false
}

/**
 * Bind a single keyboard shortcut to a callback.
 *
 *   useHotkey('mod+k', () => openSearch())
 *   useHotkey('mod+b', () => toggleSidebar())
 *   useHotkey('escape', close, { ignoreInputs: false })
 *
 * `mod` resolves to ⌘ on macOS and Ctrl on other platforms. Modifiers
 * may be `mod`, `ctrl`, `meta`, `alt`, `shift`. Plus-separated, key last.
 *
 * By default the handler is skipped while focus is in a text input so
 * typing 'k' in a sidebar filter doesn't fire `mod+k` etc. Pass
 * `ignoreInputs: false` to disable that guard (e.g. for `Escape`).
 */
export function useHotkey(
  combo: string,
  handler: (e: KeyboardEvent) => void,
  options: HotkeyOptions = {}
): void {
  const { ignoreInputs = true, disabled = false } = options

  useEffect(() => {
    if (disabled) return
    const parts = combo
      .toLowerCase()
      .split(`+`)
      .map((p) => p.trim())
    const key = parts[parts.length - 1]
    const mods = new Set(parts.slice(0, -1))
    const wantMod = mods.has(`mod`)
    const wantMeta = mods.has(`meta`) || (wantMod && isMac())
    const wantCtrl = mods.has(`ctrl`) || (wantMod && !isMac())
    const wantAlt = mods.has(`alt`)
    const wantShift = mods.has(`shift`)

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() !== key) return
      if (e.metaKey !== wantMeta) return
      if (e.ctrlKey !== wantCtrl) return
      if (e.altKey !== wantAlt) return
      if (e.shiftKey !== wantShift) return
      if (ignoreInputs && isEditable(e.target)) return
      handler(e)
    }

    window.addEventListener(`keydown`, onKeyDown)
    return () => window.removeEventListener(`keydown`, onKeyDown)
  }, [combo, handler, ignoreInputs, disabled])
}

export const isMacPlatform = isMac
