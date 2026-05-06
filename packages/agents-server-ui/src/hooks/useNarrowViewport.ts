import { useEffect, useState } from 'react'

/**
 * Default breakpoint at which the app treats the viewport as
 * "narrow". 768px is the standard tablet/mobile cutoff and matches
 * the point at which the sidebar (240px default) starts eating an
 * uncomfortable share of the chat column.
 */
export const NARROW_VIEWPORT_BREAKPOINT_PX = 768

/**
 * Returns `true` when the viewport's CSS width is at or below the
 * `breakpoint` (default 768px), tracking `window.matchMedia` so the
 * value updates on resize / orientation change without a manual
 * `resize` listener.
 *
 * SSR-safe: returns `false` on the very first render before
 * `window` is available, then resyncs from `matchMedia` on mount.
 *
 * Used by the sidebar to switch between push-displace and overlay
 * modes — sized once here so every consumer (sidebar, settings
 * sidebar, future drawers) shares the same threshold.
 */
export function useNarrowViewport(
  breakpoint: number = NARROW_VIEWPORT_BREAKPOINT_PX
): boolean {
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === `undefined`) return false
    return window.matchMedia(`(max-width: ${breakpoint}px)`).matches
  })

  useEffect(() => {
    if (typeof window === `undefined`) return
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const onChange = (e: MediaQueryListEvent): void => setNarrow(e.matches)
    // Sync immediately in case the breakpoint was crossed between
    // the initial render and the effect running (e.g. window
    // resized during hydration).
    setNarrow(mql.matches)
    mql.addEventListener(`change`, onChange)
    return () => mql.removeEventListener(`change`, onChange)
  }, [breakpoint])

  return narrow
}
