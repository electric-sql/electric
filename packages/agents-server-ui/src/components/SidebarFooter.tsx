import { ServerPicker } from './ServerPicker'
import { SettingsMenu } from './SettingsMenu'
import { SidebarViewMenu } from './SidebarViewMenu'
import styles from './SidebarFooter.module.css'

/**
 * Bottom-anchored row in the sidebar.
 *
 * Layout (left → right):
 *   - ServerPicker: takes the leading flex slot, can grow to fill
 *     remaining width.
 *   - SidebarViewMenu: filter / grouping for the session list.
 *   - SettingsMenu: theme + runtime + Settings… launcher.
 *
 * The two trailing icon buttons sit flush to the right edge so the
 * sidebar's icon column reads as a clean vertical rail.
 */
export function SidebarFooter(): React.ReactElement {
  return (
    <div className={styles.footer}>
      <ServerPicker />
      <SidebarViewMenu />
      <SettingsMenu />
    </div>
  )
}
