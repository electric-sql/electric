import { useEffect, useState } from 'react'
import { ApiKeysForm } from '../../ApiKeysForm'
import {
  loadApiKeysStatus,
  saveApiKeys as persistApiKeys,
  type ApiKeysStatus,
} from '../../../lib/server-connection'
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
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)
  const [status, setStatus] = useState<ApiKeysStatus | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    if (!isDesktop) return
    let cancelled = false
    void loadApiKeysStatus().then((result) => {
      if (cancelled) return
      setStatus(result)
    })
    return () => {
      cancelled = true
    }
  }, [isDesktop])

  return (
    <SettingsScreen title="General">
      <SettingsSection
        title="API keys"
        description={
          isDesktop
            ? `Provider keys for the local Horton runtime. Stored on this machine and never sent anywhere except the provider you select. Brave Search is optional and powers the web-search tool.`
            : `API keys are configured by the agents-server you're connected to. The desktop app exposes editing here; the web build inherits whatever keys the server was started with.`
        }
      >
        {!isDesktop ? (
          <div style={{ padding: `16px` }}>
            <Text size={2} tone="muted">
              No editable provider keys in the web build.
            </Text>
          </div>
        ) : !status ? (
          <div style={{ padding: `16px` }}>
            <Text size={2} tone="muted">
              Loading…
            </Text>
          </div>
        ) : (
          <div style={{ padding: `16px` }}>
            <ApiKeysForm
              key={savedAt ?? `initial`}
              initial={{
                anthropic:
                  status.saved.anthropic ?? status.suggested.anthropic ?? ``,
                openai: status.saved.openai ?? status.suggested.openai ?? ``,
                brave: status.saved.brave ?? status.suggested.brave ?? ``,
              }}
              showSuggestionHint={
                !status.hasAnyKey &&
                Boolean(
                  status.suggested.anthropic ||
                    status.suggested.openai ||
                    status.suggested.brave
                )
              }
              onSave={async ({ anthropic, openai, brave }) => {
                await persistApiKeys({
                  anthropic: anthropic.trim() || null,
                  openai: openai.trim() || null,
                  brave: brave.trim() || null,
                })
                const next = await loadApiKeysStatus()
                if (next) setStatus(next)
                setSavedAt(Date.now())
              }}
              saveLabel="Save changes"
              savingLabel="Saving…"
            />
          </div>
        )}
      </SettingsSection>
    </SettingsScreen>
  )
}
