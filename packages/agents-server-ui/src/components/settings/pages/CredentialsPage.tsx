import { useEffect, useState } from 'react'
import { ApiKeysForm } from '../../ApiKeysForm'
import {
  loadApiKeysStatus,
  saveApiKeys as persistApiKeys,
  type ApiKeysStatus,
} from '../../../lib/server-connection'
import { Text } from '../../../ui'
import { SettingsScreen, SettingsSection } from '../SettingsScreen'

export function CredentialsPage(): React.ReactElement {
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
    <SettingsScreen title="Credentials">
      <SettingsSection
        title="Provider API keys"
        description={
          isDesktop
            ? `Global provider keys used by connected local runtimes unless a server override is configured. Stored securely on this machine.`
            : `API keys are configured by the agents-server you're connected to. The web build inherits whatever keys the server was started with.`
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
