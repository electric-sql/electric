import { forwardRef, type ReactNode } from 'react'
import styles from './TopBar.module.css'

type TopBarProps = {
  start?: ReactNode
  /** Title slot; takes the remaining horizontal space. */
  title?: ReactNode
  end?: ReactNode
  /** Title alignment within the title slot. Default `start`. */
  titleAlign?: `start` | `center` | `end`
  className?: string
}

/**
 * Generic three-slot top-bar layout used by the app shell.
 *
 *   ┌────────┬────────────────────────────────────┬────────┐
 *   │ start  │ title                              │ end    │
 *   └────────┴────────────────────────────────────┴────────┘
 *
 * The bar is fixed-height (`--ds-row-height-lg`), borderless on the
 * sides, with a single bottom divider. Slot wrappers are flex rows so
 * consumers can drop in icon buttons and text directly.
 *
 * No alignment / styling is enforced on the slot contents themselves —
 * only the layout. App-specific composition lives in `AppTopBar`.
 */
export const TopBar = forwardRef<HTMLDivElement, TopBarProps>(function TopBar(
  { start, title, end, titleAlign = `start`, className },
  ref
) {
  const titleCls = [
    styles.title,
    titleAlign === `center`
      ? styles.titleCenter
      : titleAlign === `end`
        ? styles.titleEnd
        : styles.titleStart,
  ].join(` `)
  return (
    <div
      ref={ref}
      className={[styles.bar, className].filter(Boolean).join(` `)}
    >
      {start !== undefined && <div className={styles.start}>{start}</div>}
      <div className={titleCls}>{title}</div>
      {end !== undefined && <div className={styles.end}>{end}</div>}
    </div>
  )
})
