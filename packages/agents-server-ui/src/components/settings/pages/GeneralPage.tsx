import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ConfirmDialog, Icon, Stack, Text } from '../../../ui'
import { clearAllLocalData } from '../../../lib/server-connection'
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
  const [isClearing, setIsClearing] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClearAllLocalData = async (): Promise<void> => {
    setError(null)
    setIsClearing(true)
    try {
      await clearAllLocalData()
    } catch (err) {
      setIsClearing(false)
      setShowResetConfirm(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
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
        <SettingsSection
          title="Local data"
          description="Reset this desktop app back to first-run setup."
        >
          <Stack direction="column" gap={3} style={{ padding: `16px` }}>
            <SettingsRow
              label="Clear all local data"
              description={
                isDesktop
                  ? `Deletes saved settings, API keys, server connections, and sign-in state. The app will restart into onboarding.`
                  : `Only available in the desktop app.`
              }
              control={
                <Button
                  variant="soft"
                  tone="danger"
                  size={2}
                  disabled={!isDesktop || isClearing}
                  onClick={() => setShowResetConfirm(true)}
                >
                  <Icon icon={Trash2} size={2} />
                  {isClearing ? `Restarting…` : `Clear all local data`}
                </Button>
              }
            />
            {error && (
              <Text size={2} tone="danger">
                {error}
              </Text>
            )}
          </Stack>
        </SettingsSection>
      </SettingsScreen>

      <ConfirmDialog
        open={showResetConfirm}
        onOpenChange={(open) => {
          if (!isClearing) setShowResetConfirm(open)
        }}
        title="Clear all local data?"
        description="This deletes saved settings, API keys, server connections, and sign-in state. Electric Agents will restart and return to the onboarding flow."
        confirmLabel="Clear data and restart"
        loadingLabel="Restarting..."
        confirmTone="danger"
        confirmIcon={Trash2}
        loading={isClearing}
        error={error}
        onConfirm={() => {
          void handleClearAllLocalData()
        }}
      />
    </>
  )
}
