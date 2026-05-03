import { useEffect, type ReactNode } from 'react'
import { TooltipProvider } from './Tooltip'

interface ThemeProviderProps {
  /** Resolved theme — `dark` or `light`. */
  appearance: `dark` | `light`
  /**
   * Tooltip open delay (ms) shared across all tooltips inside the
   * provider. Default 350ms.
   */
  tooltipDelay?: number
  children: ReactNode
}

/**
 * Top-level provider for the design system.
 *
 * - Sets `data-theme="dark|light"` on the document root so tokens.css
 *   switches between light/dark variable sets.
 * - Wraps children in a Base UI <TooltipProvider> so `<Tooltip>` calls
 *   share a delay timer (instant follow-up tooltips after one opens).
 *
 * Replaces `<Theme>` from `@radix-ui/themes`. The legacy `.dark` class on
 * <html> is also kept in sync during the in-progress refactor so any
 * still-mounted Radix Themes tree continues to dark-mode correctly.
 */
export function ThemeProvider({
  appearance,
  tooltipDelay = 350,
  children,
}: ThemeProviderProps): React.ReactElement {
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute(`data-theme`, appearance)
    // Compat: keep the legacy `.dark` class in sync until the Radix
    // Themes wrapper is fully removed in Phase 3.
    root.classList.toggle(`dark`, appearance === `dark`)
    return () => {
      root.removeAttribute(`data-theme`)
    }
  }, [appearance])

  return <TooltipProvider delay={tooltipDelay}>{children}</TooltipProvider>
}
