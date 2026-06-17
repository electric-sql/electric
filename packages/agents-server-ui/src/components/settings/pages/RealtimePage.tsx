import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  loadRealtimeSettingsStatus,
  saveRealtimeSettings,
  type RealtimeSettingsStatus,
} from '../../../lib/server-connection'
import { Button, Select, Switch, Text } from '../../../ui'
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
  const voiceById = useMemo(
    () => new Map(status?.availableVoices.map((voice) => [voice.id, voice])),
    [status?.availableVoices]
  )
  const reasoningEffortById = useMemo(
    () =>
      new Map(
        status?.availableReasoningEfforts.map((effort) => [effort.id, effort])
      ),
    [status?.availableReasoningEfforts]
  )
  const selectedModel = status ? modelById.get(status.settings.model) : null
  const selectedVoice = status ? voiceById.get(status.settings.voice) : null
  const selectedReasoningEffort = status
    ? reasoningEffortById.get(status.settings.reasoningEffort)
    : null

  const saveSettingsPatch = async (
    patch: Partial<RealtimeSettingsStatus[`settings`]>
  ): Promise<void> => {
    if (!status) return
    const next = {
      ...status,
      settings: { ...status.settings, ...patch },
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
                    tone={
                      status.openAIApiKeyStatus === `valid`
                        ? `success`
                        : `warning`
                    }
                  >
                    {authBadgeLabel(status)}
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
                    if (model) void saveSettingsPatch({ model })
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
            <SettingsRow
              label="Voice"
              description={
                selectedVoice?.description ??
                `The OpenAI voice used for audio output. Voice is locked after a session starts.`
              }
              splitLayout
              control={
                <Select.Root
                  value={status.settings.voice}
                  onValueChange={(voice) => {
                    if (voice) void saveSettingsPatch({ voice })
                  }}
                  disabled={saving}
                >
                  <Select.Trigger
                    className={styles.modelSelect}
                    renderValue={(voice) =>
                      voice ? (voiceById.get(voice)?.label ?? voice) : `Voice`
                    }
                  />
                  <Select.Content>
                    {status.availableVoices.map((voice) => (
                      <Select.Item key={voice.id} value={voice.id}>
                        {voice.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              }
            />
            <SettingsRow
              label="Reasoning effort"
              description={
                status.settings.model === `gpt-realtime-2`
                  ? (selectedReasoningEffort?.description ??
                    `How much reasoning GPT-Realtime-2 should spend before responding.`)
                  : `Reasoning effort only applies to GPT-Realtime-2.`
              }
              splitLayout
              control={
                <Select.Root
                  value={status.settings.reasoningEffort}
                  onValueChange={(reasoningEffort) => {
                    if (reasoningEffort) {
                      void saveSettingsPatch({
                        reasoningEffort:
                          reasoningEffort as RealtimeSettingsStatus[`settings`][`reasoningEffort`],
                      })
                    }
                  }}
                  disabled={
                    saving || status.settings.model !== `gpt-realtime-2`
                  }
                >
                  <Select.Trigger
                    className={styles.modelSelect}
                    renderValue={(reasoningEffort) =>
                      reasoningEffort
                        ? (reasoningEffortById.get(
                            reasoningEffort as RealtimeSettingsStatus[`settings`][`reasoningEffort`]
                          )?.label ?? reasoningEffort)
                        : `Effort`
                    }
                  />
                  <Select.Content>
                    {status.availableReasoningEfforts.map((effort) => (
                      <Select.Item key={effort.id} value={effort.id}>
                        {effort.label}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              }
            />
            <SettingsRow
              label="Interrupt responses"
              description="Stop current audio when OpenAI detects new user speech. Disable this in noisy rooms if short sounds cut Horton off."
              splitLayout
              control={
                <Switch
                  checked={status.settings.interruptResponse}
                  disabled={saving}
                  ariaLabel="Interrupt responses"
                  onCheckedChange={(interruptResponse) => {
                    void saveSettingsPatch({ interruptResponse })
                  }}
                />
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
          title="Available voices"
          description="Voices exposed for realtime audio output."
        >
          <SettingsPanel>
            <div className={styles.modelList}>
              {status.availableVoices.map((voice) => (
                <div key={voice.id} className={styles.modelItem}>
                  <div className={styles.modelText}>
                    <span className={styles.modelTitle}>
                      {voice.label}
                      {voice.recommended && (
                        <SettingsStatusBadge tone="info">
                          Recommended
                        </SettingsStatusBadge>
                      )}
                    </span>
                    <span className={styles.modelId}>{voice.id}</span>
                    <span className={styles.modelDescription}>
                      {voice.description}
                    </span>
                  </div>
                  {voice.id === status.settings.voice && (
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
  if (status.openAIApiKeyStatus === `valid`) {
    return `Realtime sessions connect to the OpenAI Realtime API with your OpenAI API key.`
  }
  if (status.openAIApiKeyStatus === `invalid`) {
    return (
      status.openAIApiKeyError ??
      `The configured OpenAI API key could not be used for realtime audio.`
    )
  }
  if (status.openAIApiKeyStatus === `unknown`) {
    return (
      status.openAIApiKeyError ??
      `Unable to verify realtime API access right now.`
    )
  }
  if (status.codexEnabled) {
    return `ChatGPT / Codex sign-in is enabled, but realtime voice still needs an OpenAI API key.`
  }
  return `Add an OpenAI API key in Credentials. ChatGPT / Codex sign-in alone does not grant Realtime API access.`
}

function authBadgeLabel(status: RealtimeSettingsStatus): string {
  switch (status.openAIApiKeyStatus) {
    case `valid`:
      return `Ready`
    case `invalid`:
      return `Invalid key`
    case `unknown`:
      return status.hasOpenAIApiKey ? `Verify failed` : `Checking`
    case `missing`:
      return `API key required`
  }
}
