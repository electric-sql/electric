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
 * Replaces `<Theme>` from `@radix-ui/themes`.
 */
export function ThemeProvider({
  appearance,
  tooltipDelay = 350,
  children,
}: ThemeProviderProps): React.ReactElement {
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute(`data-theme`, appearance)
    return () => {
      root.removeAttribute(`data-theme`)
    }
  }, [appearance])

  return <TooltipProvider delay={tooltipDelay}>{children}</TooltipProvider>
}
