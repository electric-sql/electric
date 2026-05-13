import type { ReactNode } from 'react'
import styles from './MainHeader.module.css'

type MainHeaderProps = {
  leading?: ReactNode
  title?: ReactNode
  actions?: ReactNode
  chromeInsetTarget?: boolean
}

/**
 * Header strip at the top of the main content column.
 *
 * The global sidebar/search controls live in the fixed titlebar controls layer
 * so they stay stationary during sidebar animations. This strip only owns the
 * tile title, optional leading affordance, and right-side actions.
 *
 * No border / divider — the strip shares a background with the column
 * body so the header reads as part of the same surface.
 */
export function MainHeader({
  leading,
  title,
  actions,
  chromeInsetTarget = false,
}: MainHeaderProps): React.ReactElement {
  return (
    <header
      className={styles.header}
      data-chrome-inset-target={chromeInsetTarget ? `true` : undefined}
    >
      {leading}
      <div className={styles.title}>{title}</div>
      {actions !== undefined && <div className={styles.actions}>{actions}</div>}
    </header>
  )
}
