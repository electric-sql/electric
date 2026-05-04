import { ServerPicker } from './ServerPicker'
import { SettingsMenu } from './SettingsMenu'
import styles from './SidebarFooter.module.css'

/**
 * Bottom-anchored row in the sidebar.
 *
 * Hosts the active-server picker on the left and the settings cog on
 * the right. Settings dropdown currently exposes the theme toggle;
 * future preferences land in the same menu.
 */
export function SidebarFooter(): React.ReactElement {
  return (
    <div className={styles.footer}>
      <ServerPicker />
      <SettingsMenu />
    </div>
  )
}
