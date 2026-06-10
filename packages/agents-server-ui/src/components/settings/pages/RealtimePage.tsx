import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  loadRealtimeSettingsStatus,
  saveRealtimeSettings,
  type RealtimeSettingsStatus,
} from '../../../lib/server-connection'
import { Button, Select, Text } from '../../../ui'
import {
  SettingsPanel,
  SettingsRow,
  SettingsScreen,
  SettingsSection,
  SettingsStatusBadge,
} from '../SettingsScreen'
import styles from './RealtimePage.module.css'

export function RealtimePage(): React.ReactElement {
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)
  const navigate = useNavigate()
  const [status, setStatus] = useState<RealtimeSettingsStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadRealtimeSettingsStatus().then((next) => {
      if (cancelled) return
      setStatus(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const modelById = useMemo(
    () => new Map(status?.availableModels.map((model) => [model.id, model])),
    [status?.availableModels]
  )
  const selectedModel = status ? modelById.get(status.settings.model) : null

  const saveModel = async (model: string | null): Promise<void> => {
    if (!model || !status) return
    const next = {
      ...status,
      settings: { ...status.settings, model },
    }
    setStatus(next)
    setSaving(true)
    setError(null)
    try {
      await saveRealtimeSettings(next.settings)
    } catch (err) {
      setStatus(status)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsScreen title="Realtime">
      <SettingsSection
        title="OpenAI realtime"
        description="Configure the voice model used when Horton starts a realtime audio session."
      >
        {!isDesktop ? (
          <SettingsPanel>
            <Text size={2} tone="muted">
              Realtime settings are managed by the connected desktop or server
              runtime. This web build uses the default model when starting a
              session from the browser.
            </Text>
          </SettingsPanel>
        ) : !status ? (
          <SettingsPanel>
            <Text size={2} tone="muted">
              Loading…
            </Text>
          </SettingsPanel>
        ) : (
          <>
            <SettingsRow
              label="Authentication"
              description={authDescription(status)}
              splitLayout
              control={
                <>
                  <SettingsStatusBadge
                    tone={status.hasOpenAIApiKey ? `success` : `warning`}
                  >
                    {status.hasOpenAIApiKey ? `Ready` : `API key required`}
                  </SettingsStatusBadge>
                  <Button
                    type="button"
                    variant="soft"
                    tone="neutral"
                    onClick={() =>
                      navigate({
                        to: `/settings/$category`,
                        params: { category: `credentials` },
                      })
                    }
                  >
                    Credentials
                  </Button>
                </>
              }
            />
            <SettingsRow
              label="Provider"
              description="Realtime V1 supports OpenAI only. The provider boundary remains explicit so other realtime providers can be added later."
              splitLayout
              control={
                <SettingsStatusBadge tone="neutral">OpenAI</SettingsStatusBadge>
              }
            />
            <SettingsRow
              label="Voice model"
              description={
                selectedModel?.description ??
                `The model sent to the OpenAI Realtime API when a voice session starts.`
              }
              splitLayout
              control={
                <Select.Root
                  value={status.settings.model}
                  onValueChange={(model) => {
                    void saveModel(model)
                  }}
                  disabled={saving}
                >
                  <Select.Trigger
                    className={styles.modelSelect}
                    renderValue={(model) =>
                      model ? (modelById.get(model)?.label ?? model) : `Model`
                    }
                  />
                  <Select.Content>
                    {status.availableModels.map((model) => (
                      <Select.Item key={model.id} value={model.id}>
                        {model.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              }
            />
            {saving && (
              <SettingsPanel>
                <Text size={2} tone="muted">
                  Saving…
                </Text>
              </SettingsPanel>
            )}
            {error && (
              <SettingsPanel>
                <Text size={2} tone="danger">
                  {error}
                </Text>
              </SettingsPanel>
            )}
          </>
        )}
      </SettingsSection>

      {status && (
        <SettingsSection
          title="Available models"
          description="Models exposed for realtime voice sessions."
        >
          <SettingsPanel>
            <div className={styles.modelList}>
              {status.availableModels.map((model) => (
                <div key={model.id} className={styles.modelItem}>
                  <div className={styles.modelText}>
                    <span className={styles.modelTitle}>
                      {model.label}
                      {model.recommended && (
                        <SettingsStatusBadge tone="info">
                          Recommended
                        </SettingsStatusBadge>
                      )}
                    </span>
                    <span className={styles.modelId}>{model.id}</span>
                    <span className={styles.modelDescription}>
                      {model.description}
                    </span>
                  </div>
                  {model.id === status.settings.model && (
                    <span className={styles.recommended}>
                      <SettingsStatusBadge tone="success">
                        Selected
                      </SettingsStatusBadge>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </SettingsPanel>
        </SettingsSection>
      )}
    </SettingsScreen>
  )
}

function authDescription(status: RealtimeSettingsStatus): string {
  if (status.hasOpenAIApiKey) {
    return `Realtime sessions connect to the OpenAI Realtime API with your OpenAI API key.`
  }
  if (status.codexEnabled) {
    return `ChatGPT / Codex sign-in is enabled, but realtime voice still needs an OpenAI API key.`
  }
  return `Add an OpenAI API key in Credentials. ChatGPT / Codex sign-in alone does not grant Realtime API access.`
}
