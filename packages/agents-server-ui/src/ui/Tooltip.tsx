import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import type { ReactElement, ReactNode } from 'react'
import styles from './Tooltip.module.css'

interface TooltipProps {
  /** The primary label shown in the tooltip popup. */
  content: ReactNode
  /**
   * Optional keyboard shortcut hint (e.g. `⌘B`, `Ctrl+K`). Rendered
   * as slightly muted text after the label, separated by a space —
   * not in brackets — matching the convention used by Cursor / VS
   * Code tooltips.
   */
  shortcut?: ReactNode
  /** The element that triggers the tooltip on hover/focus. */
  children: ReactElement
  /** Side relative to the trigger. Default `top`. */
  side?: `top` | `right` | `bottom` | `left`
  align?: `start` | `center` | `end`
  sideOffset?: number
}

/**
 * Compact tooltip — wraps `@base-ui/react/tooltip`.
 *
 * Single-shot API:
 *   <Tooltip content="Copy URL"><IconButton>…</IconButton></Tooltip>
 *   <Tooltip content="Hide sidebar" shortcut="⌘B"><IconButton/></Tooltip>
 *
 * Wrap your app in <TooltipProvider delay={…}> (re-exported below) to
 * configure the open delay shared across all tooltips. Per-tooltip
 * delays aren't supported by Base UI's Tooltip.Root; nest a separate
 * <TooltipProvider> for any local override.
 */
export function Tooltip({
  content,
  shortcut,
  children,
  side = `top`,
  align = `center`,
  sideOffset = 6,
}: TooltipProps): React.ReactElement {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
        >
          <BaseTooltip.Popup className={styles.popup}>
            {content}
            {shortcut !== undefined && shortcut !== null && (
              <span className={styles.shortcut}>{shortcut}</span>
            )}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}

export const TooltipProvider = BaseTooltip.Provider
