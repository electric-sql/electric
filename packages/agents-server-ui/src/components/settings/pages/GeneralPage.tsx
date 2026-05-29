import { useEffect, useState } from 'react'
import {
  loadPreventAppSuspensionPreference,
  savePreventAppSuspensionPreference,
} from '../../../lib/server-connection'
import { Text } from '../../../ui'
import { SettingsRow, SettingsScreen, SettingsSection } from '../SettingsScreen'

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
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)
  const [preventAppSuspension, setPreventAppSuspension] = useState(true)

  useEffect(() => {
    if (!isDesktop) return
    let cancelled = false
    void loadPreventAppSuspensionPreference().then((value) => {
      if (cancelled || value === null) return
      setPreventAppSuspension(value)
    })
    return () => {
      cancelled = true
    }
  }, [isDesktop])

  return (
    <SettingsScreen title="General">
      <SettingsSection
        title="Startup"
        description="General app-level preferences that affect how the desktop app behaves in the background."
      >
        <div style={{ padding: `16px` }}>
          <Text size={2} tone="muted">
            Connected servers are restored on launch and kept alive from the
            tray when all windows are closed.
          </Text>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Power"
        description="Control whether the desktop app asks the OS to keep the machine from fully sleeping while the bundled local runtime is starting or running."
      >
        {isDesktop ? (
          <SettingsRow
            label="Keep desktop awake while local runtime is active"
            description="Allows ongoing sessions and incoming mobile-triggered sessions to keep working while the local desktop runtime is active. The display can still sleep."
            control={
              <input
                type="checkbox"
                checked={preventAppSuspension}
                onChange={(event) => {
                  const next = event.currentTarget.checked
                  setPreventAppSuspension(next)
                  void savePreventAppSuspensionPreference(next)
                }}
                aria-label="Keep desktop awake while local runtime is active"
              />
            }
          />
        ) : (
          <div style={{ padding: `16px` }}>
            <Text size={2} tone="muted">
              This preference is available in the desktop app.
            </Text>
          </div>
        )}
      </SettingsSection>
    </SettingsScreen>
  )
}
