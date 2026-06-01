import { Collapsible } from '@base-ui/react/collapsible'
import { useEffect, useState } from 'react'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { ApiKeysForm } from '../../ApiKeysForm'
import {
  codexDisable,
  codexEnableSource,
  codexSignIn,
  loadApiKeysStatus,
  loadDesktopState,
  onDesktopStateChanged,
  restartLocalRuntimes,
  saveApiKeys as persistApiKeys,
  saveEnabledModels as persistEnabledModels,
  type ApiKeysStatus,
  type CodexAuthSource,
  type CodexStatus,
  type ModelPickerChoice,
  type ModelPickerStatus,
} from '../../../lib/server-connection'
import { Button, Icon, Text } from '../../../ui'
import {
  SettingsBanner,
  SettingsPanel,
  SettingsRow,
  SettingsScreen,
  SettingsSection,
  SettingsStatusBadge,
} from '../SettingsScreen'
import styles from './CredentialsPage.module.css'

export function CredentialsPage(): React.ReactElement {
  const isDesktop = typeof window !== `undefined` && Boolean(window.electronAPI)
  const [status, setStatus] = useState<ApiKeysStatus | null>(null)
  const [codexBusy, setCodexBusy] = useState<string | null>(null)
  const [codexError, setCodexError] = useState<string | null>(null)
  const [restartPending, setRestartPending] = useState(false)
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    if (!isDesktop) return
    let cancelled = false
    void loadApiKeysStatus().then((result) => {
      if (cancelled) return
      setStatus(result)
    })
    void loadDesktopState().then((next) => {
      if (cancelled || !next) return
      setRestartPending(next.credentialsRestartPending)
    })
    const off = onDesktopStateChanged((next) => {
      setRestartPending(next.credentialsRestartPending)
    })
    return () => {
      cancelled = true
      off?.()
    }
  }, [isDesktop])

  const refreshStatus = async (): Promise<void> => {
    const next = await loadApiKeysStatus()
    if (next) setStatus(next)
  }

  const onRestart = async (): Promise<void> => {
    setRestarting(true)
    try {
      await restartLocalRuntimes()
    } finally {
      setRestarting(false)
    }
  }

  return (
    <SettingsScreen title="Credentials">
      {isDesktop && restartPending && (
        <RestartBanner onRestart={onRestart} restarting={restarting} />
      )}
      <SettingsSection
        title="Model providers"
        description={
          isDesktop
            ? `Configure model providers for connected local runtimes. Changes save automatically and apply on the next runtime restart.`
            : `Model providers are configured by the agents-server you're connected to. The web build inherits whatever providers the server was started with.`
        }
      >
        {!isDesktop ? (
          <SettingsPanel>
            <Text size={2} tone="muted">
              No editable provider keys in the web build.
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
            <CodexSettings
              status={status.codex}
              busy={codexBusy}
              error={codexError}
              onSignIn={async () => {
                setCodexBusy(`sign-in`)
                setCodexError(null)
                try {
                  const next = await codexSignIn()
                  if (next) await refreshStatus()
                } catch (err) {
                  setCodexError(
                    err instanceof Error ? err.message : String(err)
                  )
                } finally {
                  setCodexBusy(null)
                }
              }}
              onUseSource={async (source) => {
                setCodexBusy(source)
                setCodexError(null)
                try {
                  await codexEnableSource(source)
                  await refreshStatus()
                } catch (err) {
                  setCodexError(
                    err instanceof Error ? err.message : String(err)
                  )
                } finally {
                  setCodexBusy(null)
                }
              }}
              onDisable={async () => {
                setCodexBusy(`disable`)
                setCodexError(null)
                try {
                  await codexDisable()
                  await refreshStatus()
                } catch (err) {
                  setCodexError(
                    err instanceof Error ? err.message : String(err)
                  )
                } finally {
                  setCodexBusy(null)
                }
              }}
              modelControl={
                <ProviderModelSettings
                  status={status.modelPicker}
                  provider="openai-codex"
                  onSave={async (values) => {
                    await persistEnabledModels(values)
                    await refreshStatus()
                  }}
                />
              }
            />
            <ApiKeysForm
              layout="settings"
              autoSave
              initial={{
                anthropic:
                  status.saved.anthropic ?? status.suggested.anthropic ?? ``,
                openai: status.saved.openai ?? status.suggested.openai ?? ``,
                deepseek:
                  status.saved.deepseek ?? status.suggested.deepseek ?? ``,
                moonshot:
                  status.saved.moonshot ?? status.suggested.moonshot ?? ``,
                brave: status.saved.brave ?? ``,
              }}
              showBrave={false}
              showSuggestionHint={
                !status.hasAnyKey &&
                Boolean(
                  status.suggested.anthropic ||
                    status.suggested.openai ||
                    status.suggested.deepseek ||
                    status.suggested.moonshot
                )
              }
              onSave={async ({ anthropic, openai, deepseek, moonshot }) => {
                await persistApiKeys({
                  anthropic: anthropic.trim() || null,
                  openai: openai.trim() || null,
                  deepseek: deepseek.trim() || null,
                  moonshot: moonshot.trim() || null,
                  brave: status.saved.brave ?? null,
                })
                await refreshStatus()
              }}
              modelControls={{
                anthropic: (
                  <ProviderModelSettings
                    status={status.modelPicker}
                    provider="anthropic"
                    onSave={async (values) => {
                      await persistEnabledModels(values)
                      await refreshStatus()
                    }}
                  />
                ),
                openai: (
                  <ProviderModelSettings
                    status={status.modelPicker}
                    provider="openai"
                    onSave={async (values) => {
                      await persistEnabledModels(values)
                      await refreshStatus()
                    }}
                  />
                ),
                deepseek: (
                  <ProviderModelSettings
                    status={status.modelPicker}
                    provider="deepseek"
                    onSave={async (values) => {
                      await persistEnabledModels(values)
                      await refreshStatus()
                    }}
                  />
                ),
                moonshot: (
                  <ProviderModelSettings
                    status={status.modelPicker}
                    provider="moonshot"
                    onSave={async (values) => {
                      await persistEnabledModels(values)
                      await refreshStatus()
                    }}
                  />
                ),
              }}
            />
          </>
        )}
      </SettingsSection>
      {isDesktop && status && (
        <SettingsSection
          title="Tools"
          description="Optional tool provider keys used by local agents."
        >
          <ApiKeysForm
            layout="settings"
            autoSave
            initial={{
              anthropic: status.saved.anthropic ?? ``,
              openai: status.saved.openai ?? ``,
              deepseek: status.saved.deepseek ?? ``,
              moonshot: status.saved.moonshot ?? ``,
              brave: status.saved.brave ?? status.suggested.brave ?? ``,
            }}
            showModelKeys={false}
            showSuggestionHint={
              !status.saved.brave && Boolean(status.suggested.brave)
            }
            onSave={async ({ brave }) => {
              await persistApiKeys({
                anthropic: status.saved.anthropic ?? null,
                openai: status.saved.openai ?? null,
                deepseek: status.saved.deepseek ?? null,
                moonshot: status.saved.moonshot ?? null,
                brave: brave.trim() || null,
              })
              await refreshStatus()
            }}
          />
        </SettingsSection>
      )}
    </SettingsScreen>
  )
}

function modelDisplayName(choice: ModelPickerChoice): string {
  const prefix = `${choice.providerLabel} `
  return choice.label.startsWith(prefix)
    ? choice.label.slice(prefix.length)
    : choice.label
}

function ProviderModelSettings({
  status,
  provider,
  onSave,
}: {
  status: ModelPickerStatus
  provider: ModelPickerChoice[`provider`]
  onSave: (values: Array<string>) => Promise<void>
}): React.ReactElement | null {
  const [enabled, setEnabled] = useState(status.enabled)
  const [saving, setSaving] = useState(false)
  const statusKey = `${status.choices.map((choice) => choice.value).join(`\n`)}|${status.enabled.join(`\n`)}`

  useEffect(() => {
    setEnabled(status.enabled)
  }, [statusKey, status.enabled])

  const choices = status.choices.filter(
    (choice) => choice.provider === provider
  )
  if (choices.length === 0) return null

  const enabledSet = new Set(enabled)
  const enabledCount = choices.filter((choice) =>
    enabledSet.has(choice.value)
  ).length

  const saveNext = async (next: Array<string>): Promise<void> => {
    setEnabled(next)
    setSaving(true)
    try {
      await onSave(next)
    } catch (error) {
      setEnabled(status.enabled)
      console.error(`[credentials] failed to save enabled models`, error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Collapsible.Root className={styles.modelPicker} aria-busy={saving}>
      <Collapsible.Trigger
        type="button"
        className={styles.modelCollapseTrigger}
      >
        <span className={styles.modelCollapseSummary}>
          {enabledCount} of {choices.length} models shown in the model picker.
        </span>
        {saving && <span className={styles.modelCollapseSaving}>Saving…</span>}
        <Icon
          icon={ChevronDown}
          size={2}
          className={styles.modelCollapseIcon}
        />
      </Collapsible.Trigger>
      <Collapsible.Panel keepMounted className={styles.modelCollapsePanel}>
        <div className={styles.modelGrid}>
          {choices.map((choice) => {
            const checked = enabledSet.has(choice.value)
            const disabled = saving || (checked && enabledSet.size <= 1)
            return (
              <label
                key={choice.value}
                className={styles.modelOption}
                data-disabled={disabled ? `true` : undefined}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={(event) => {
                    const nextSet = new Set(enabledSet)
                    if (event.target.checked) {
                      nextSet.add(choice.value)
                    } else {
                      nextSet.delete(choice.value)
                    }
                    const next = status.choices
                      .map((candidate) => candidate.value)
                      .filter((value) => nextSet.has(value))
                    void saveNext(next)
                  }}
                />
                <span className={styles.modelOptionText}>
                  <span className={styles.modelOptionName}>
                    {modelDisplayName(choice)}
                  </span>
                  <span className={styles.modelOptionId}>{choice.id}</span>
                </span>
              </label>
            )
          })}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}

function RestartBanner({
  onRestart,
  restarting,
}: {
  onRestart: () => Promise<void>
  restarting: boolean
}): React.ReactElement {
  return (
    <SettingsBanner
      action={
        <Button
          type="button"
          tone="neutral"
          disabled={restarting}
          onClick={() => {
            void onRestart()
          }}
        >
          {restarting ? `Restarting…` : `Restart local runtime`}
        </Button>
      }
    >
      <Icon icon={RefreshCw} size={2} />
      <Text size={2}>
        Restart the local runtime to apply credential changes.
      </Text>
    </SettingsBanner>
  )
}

function CodexSettings({
  status,
  busy,
  error,
  onSignIn,
  onUseSource,
  onDisable,
  modelControl,
}: {
  status: CodexStatus
  busy: string | null
  error: string | null
  onSignIn: () => Promise<void>
  onUseSource: (source: CodexAuthSource) => Promise<void>
  onDisable: () => Promise<void>
  modelControl?: React.ReactNode
}): React.ReactElement {
  const detected = status.availableSources.filter(
    (source) => source.source !== `desktop-oauth`
  )

  const description = status.enabled
    ? `Using ${status.email ?? status.accountId ?? sourceLabel(status.source)}.`
    : `Sign in with OpenAI to enable Codex models in the local runtime.`

  return (
    <>
      <SettingsRow
        label="ChatGPT / Codex"
        description={description}
        splitLayout
        control={
          status.enabled ? (
            <>
              <SettingsStatusBadge tone="success">Enabled</SettingsStatusBadge>
              <Button
                type="button"
                variant="soft"
                tone="neutral"
                disabled={busy !== null}
                onClick={() => {
                  void onDisable()
                }}
              >
                {busy === `disable` ? `Disabling…` : `Disable`}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                void onSignIn()
              }}
            >
              {busy === `sign-in` ? `Signing in…` : `Sign in`}
            </Button>
          )
        }
      />
      {modelControl}
      {!status.enabled &&
        detected.map((source) => (
          <SettingsRow
            key={source.source}
            label={`${source.label} login found`}
            description={`Reuse the ${source.label} login already on this machine instead of signing in again.`}
            splitLayout
            control={
              <Button
                type="button"
                variant="soft"
                tone="neutral"
                disabled={busy !== null}
                onClick={() => {
                  void onUseSource(source.source)
                }}
              >
                {busy === source.source ? `Enabling…` : `Use this login`}
              </Button>
            }
          />
        ))}
      {(status.error || error) && (
        <SettingsPanel>
          <Text size={2} tone="danger">
            {status.error ?? error}
          </Text>
        </SettingsPanel>
      )}
    </>
  )
}

function sourceLabel(source: CodexAuthSource | null): string {
  if (source === `codex-cli`) return `Codex CLI`
  if (source === `opencode`) return `OpenCode`
  if (source === `desktop-oauth`) return `ChatGPT / Codex`
  return `ChatGPT / Codex`
}
