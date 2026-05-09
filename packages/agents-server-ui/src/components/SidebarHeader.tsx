import styles from './SidebarHeader.module.css'

/**
 * Empty sidebar header spacer. The sidebar/search controls are fixed at the
 * shell level so they stay stationary while the sidebar animates under them.
 * This row preserves the top gutter and macOS draggable titlebar surface.
 */
export function SidebarHeader(): React.ReactElement {
  return <div className={styles.header} aria-hidden="true" />
}
