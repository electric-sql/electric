import { Text } from '../../../ui'
import { SettingsScreen, SettingsSection } from '../SettingsScreen'

/**
 * Settings → General. Currently surfaces the provider API keys for
 * the bundled local Horton runtime; future general preferences land
 * here too.
 *
 * On the desktop build the form persists keys via `desktop:save-api-keys`,
 * which writes `settings.json`, mirrors the values into `process.env`,
 * and restarts the runtime so Horton picks up the new keys on its
 * next start. On the web build the IPC bridge is absent and we render
 * an explanatory message instead.
 */
export function GeneralPage(): React.ReactElement {
  return (
    <SettingsScreen title="General">
      <SettingsSection
        title="Startup"
        description="General app-level preferences will live here as the desktop settings model expands."
      >
        <div style={{ padding: `16px` }}>
          <Text size={2} tone="muted">
            Connected servers are restored on launch and kept alive from the
            tray when all windows are closed.
          </Text>
        </div>
      </SettingsSection>
    </SettingsScreen>
  )
}
