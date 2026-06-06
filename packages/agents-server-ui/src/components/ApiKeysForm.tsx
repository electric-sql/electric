import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Eye, EyeOff, Sparkles } from 'lucide-react'
import { Button, Field, Icon, IconButton, Input, Stack, Text } from '../ui'
import {
  SettingsActions,
  SettingsPanel,
  SettingsRow,
} from './settings/SettingsScreen'
import styles from './ApiKeysForm.module.css'

export type ApiKeysFormValues = {
  anthropic: string
  openai: string
  deepseek: string
  moonshot: string
  brave: string
  e2b: string
}

type ApiKeyFieldId = keyof ApiKeysFormValues
type ModelApiKeyFieldId = Exclude<ApiKeyFieldId, `brave`>

interface ApiKeysFormProps {
  initial: ApiKeysFormValues
  /** When true, render the "pre-filled from your environment" callout. */
  showSuggestionHint?: boolean
  /** Submit handler — should persist + return when the round-trip is done. */
  onSave: (keys: ApiKeysFormValues) => Promise<void>
  /**
   * Optional secondary action label/handler. The first-launch modal
   * uses "Skip for now"; the settings page omits it entirely so the
   * user just clicks Save to persist (or navigates away to discard).
   */
  onSecondary?: () => void
  secondaryLabel?: string
  /** Override the primary button label. Defaults to "Save". */
  saveLabel?: string
  /** Override the in-flight primary button label. Defaults to "Saving…". */
  savingLabel?: string
  /** Auto-focus the Anthropic field on mount. Defaults to `false`. */
  autoFocus?: boolean
  /** Use Settings rows instead of the compact onboarding form layout. */
  layout?: `form` | `settings`
  showModelKeys?: boolean
  showBrave?: boolean
  modelControls?: Partial<Record<ModelApiKeyFieldId, ReactNode>>
  showE2b?: boolean
  /**
   * When `true`, persist on field blur (after the user has typed)
   * instead of waiting for a Save click. Hides the explicit
   * Save/Saving button row. Designed for the Credentials settings
   * screen, where saves are cheap and a separate banner prompts the
   * user to restart the local runtime to apply the changes. The
   * onboarding wizard leaves this `false` so saves remain explicit.
   */
  autoSave?: boolean
}

/**
 * Shared API-keys form for the local Horton runtime. Used by:
 *
 *  - `OnboardingModal` — the first-launch wizard's API-keys step.
 *  - `GeneralPage` (Settings → General) — the always-on editor for
 *    revising keys after initial setup.
 *
 * Save is enabled as soon as any field has content. The Brave field
 * is optional in both contexts — typing only Brave is allowed (e.g.
 * the user already has an LLM key in `.env` and just wants to add
 * web-search support). Empty submit is disabled because it would
 * be a no-op.
 */
export function ApiKeysForm({
  initial,
  showSuggestionHint = false,
  onSave,
  onSecondary,
  secondaryLabel,
  saveLabel = `Save`,
  savingLabel = `Saving…`,
  autoFocus = false,
  layout = `form`,
  showModelKeys = true,
  showBrave = true,
  modelControls,
  showE2b = true,
  autoSave = false,
}: ApiKeysFormProps): React.ReactElement {
  const [anthropic, setAnthropic] = useState(initial.anthropic)
  const [openai, setOpenai] = useState(initial.openai)
  const [deepseek, setDeepseek] = useState(initial.deepseek)
  const [moonshot, setMoonshot] = useState(initial.moonshot)
  const [brave, setBrave] = useState(initial.brave)
  const [e2b, setE2b] = useState(initial.e2b)
  const [visibleKeys, setVisibleKeys] = useState<
    Record<ApiKeyFieldId, boolean>
  >({
    anthropic: false,
    openai: false,
    deepseek: false,
    moonshot: false,
    brave: false,
    e2b: false,
  })
  const [saving, setSaving] = useState(false)
  // Tracks the last set of values we've actually persisted, so an
  // auto-save fires only when the user has changed a field's value.
  // We keep this in a ref to avoid re-renders on every save and to
  // guarantee the latest snapshot is visible inside callback closures.
  const persistedRef = useRef(initial)
  // Set per-field to `true` on `onChange` so blur of a field the user
  // never typed in (e.g. they tabbed past a pre-filled suggestion)
  // does not silently persist values they never approved.
  const editedRef = useRef<Record<ApiKeyFieldId, boolean>>({
    anthropic: false,
    openai: false,
    deepseek: false,
    moonshot: false,
    brave: false,
    e2b: false,
  })

  const canSave =
    (showModelKeys &&
      (anthropic.trim().length > 0 ||
        openai.trim().length > 0 ||
        deepseek.trim().length > 0 ||
        moonshot.trim().length > 0)) ||
    (showBrave && brave.trim().length > 0) ||
    (showE2b && e2b.trim().length > 0)

  const handleSave = useCallback(async (): Promise<void> => {
    if (!canSave || saving) return
    setSaving(true)
    try {
      await onSave({ anthropic, openai, deepseek, moonshot, brave, e2b })
      persistedRef.current = {
        anthropic,
        openai,
        deepseek,
        moonshot,
        brave,
        e2b,
      }
    } finally {
      setSaving(false)
    }
  }, [
    anthropic,
    openai,
    deepseek,
    moonshot,
    brave,
    e2b,
    canSave,
    saving,
    onSave,
  ])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      await handleSave()
    },
    [handleSave]
  )

  const persistIfDirty = useCallback(
    async (field: ApiKeyFieldId, values: ApiKeysFormValues): Promise<void> => {
      if (!editedRef.current[field]) return
      if (values[field] === persistedRef.current[field]) {
        editedRef.current[field] = false
        return
      }
      setSaving(true)
      try {
        await onSave(values)
        persistedRef.current = values
        editedRef.current[field] = false
      } finally {
        setSaving(false)
      }
    },
    [onSave]
  )

  const handleAutoSaveBlur = useCallback(
    (field: ApiKeyFieldId) => {
      if (!autoSave) return
      void persistIfDirty(field, {
        anthropic,
        openai,
        deepseek,
        moonshot,
        brave,
        e2b,
      })
    },
    [
      autoSave,
      anthropic,
      openai,
      deepseek,
      moonshot,
      brave,
      e2b,
      persistIfDirty,
    ]
  )

  const wrapOnChange = useCallback(
    (field: ApiKeyFieldId, setter: (value: string) => void) =>
      (value: string) => {
        if (autoSave) editedRef.current[field] = true
        setter(value)
      },
    [autoSave]
  )

  const toggleVisible = useCallback((field: ApiKeyFieldId) => {
    setVisibleKeys((current) => ({ ...current, [field]: !current[field] }))
  }, [])

  if (layout === `settings`) {
    const showActions = !autoSave || Boolean(onSecondary && secondaryLabel)
    // We deliberately render a fragment (rather than a `<form>` wrapper)
    // so rows in the API-keys block are direct DOM children of the
    // surrounding `<SettingsSection>`'s card. Wrapping them in a form
    // — even with `display: contents` — would make `.row:first-child`
    // match the wrapper's first row instead of the section's first
    // row, breaking the dividers between rows from different
    // components stacked in the same section (e.g. the Codex row and
    // the Anthropic row below it).
    return (
      <>
        {showSuggestionHint && (
          <SettingsPanel>
            <div className={styles.hint}>
              <Icon icon={Sparkles} size={2} />
              <Text size={1} tone="muted">
                {autoSave
                  ? `Pre-filled from your environment. Edit a field to save it.`
                  : `Pre-filled from your environment. Click save to persist them.`}
              </Text>
            </div>
          </SettingsPanel>
        )}
        {showModelKeys && (
          <>
            <SettingsRow
              label="Anthropic API"
              description="Used for Claude models. Looks like sk-ant-…"
              splitLayout
              control={
                <ApiKeyInput
                  field="anthropic"
                  placeholder="sk-ant-…"
                  value={anthropic}
                  visible={visibleKeys.anthropic}
                  onChange={wrapOnChange(`anthropic`, setAnthropic)}
                  onBlur={() => handleAutoSaveBlur(`anthropic`)}
                  onToggleVisible={toggleVisible}
                  autoFocus={autoFocus}
                />
              }
            />
            {modelControls?.anthropic}
            <SettingsRow
              label="OpenAI API"
              description="Used for GPT models. Looks like sk-…"
              splitLayout
              control={
                <ApiKeyInput
                  field="openai"
                  placeholder="sk-…"
                  value={openai}
                  visible={visibleKeys.openai}
                  onChange={wrapOnChange(`openai`, setOpenai)}
                  onBlur={() => handleAutoSaveBlur(`openai`)}
                  onToggleVisible={toggleVisible}
                />
              }
            />
            {modelControls?.openai}
            <SettingsRow
              label="DeepSeek API"
              description="Used for DeepSeek models. Looks like sk-…"
              splitLayout
              control={
                <ApiKeyInput
                  field="deepseek"
                  placeholder="sk-…"
                  value={deepseek}
                  visible={visibleKeys.deepseek}
                  onChange={wrapOnChange(`deepseek`, setDeepseek)}
                  onBlur={() => handleAutoSaveBlur(`deepseek`)}
                  onToggleVisible={toggleVisible}
                />
              }
            />
            {modelControls?.deepseek}
            <SettingsRow
              label="Kimi / Moonshot API"
              description="Used for Kimi and Moonshot models. Looks like sk-…"
              splitLayout
              control={
                <ApiKeyInput
                  field="moonshot"
                  placeholder="sk-…"
                  value={moonshot}
                  visible={visibleKeys.moonshot}
                  onChange={wrapOnChange(`moonshot`, setMoonshot)}
                  onBlur={() => handleAutoSaveBlur(`moonshot`)}
                  onToggleVisible={toggleVisible}
                />
              }
            />
            {modelControls?.moonshot}
          </>
        )}
        {showBrave && (
          <SettingsRow
            label="Brave Search API"
            description="Powers the web-search tool. Without it, search falls back to Anthropic's built-in search."
            splitLayout
            control={
              <ApiKeyInput
                field="brave"
                placeholder="BSA…"
                value={brave}
                visible={visibleKeys.brave}
                onChange={wrapOnChange(`brave`, setBrave)}
                onBlur={() => handleAutoSaveBlur(`brave`)}
                onToggleVisible={toggleVisible}
              />
            }
          />
        )}
        {showE2b && (
          <SettingsRow
            label="E2B API"
            description="Enables the E2B remote-sandbox profile, which runs agents in isolated cloud microVMs. Looks like e2b_…"
            splitLayout
            control={
              <ApiKeyInput
                field="e2b"
                placeholder="e2b_…"
                value={e2b}
                visible={visibleKeys.e2b}
                onChange={wrapOnChange(`e2b`, setE2b)}
                onBlur={() => handleAutoSaveBlur(`e2b`)}
                onToggleVisible={toggleVisible}
              />
            }
          />
        )}
        {showActions && (
          <SettingsActions separator>
            {onSecondary && secondaryLabel && (
              <Button
                type="button"
                variant="soft"
                tone="neutral"
                onClick={onSecondary}
                disabled={saving}
              >
                {secondaryLabel}
              </Button>
            )}
            {!autoSave && (
              <Button
                type="button"
                disabled={!canSave || saving}
                onClick={() => {
                  void handleSave()
                }}
              >
                {saving ? savingLabel : saveLabel}
              </Button>
            )}
          </SettingsActions>
        )}
      </>
    )
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      {showSuggestionHint && (
        <div className={styles.hint}>
          <Icon icon={Sparkles} size={2} />
          <Text size={1} tone="muted">
            Pre-filled from your environment. Click save to persist them.
          </Text>
        </div>
      )}
      <Stack direction="column" gap={3}>
        {showModelKeys && (
          <>
            <Field
              label="Anthropic API"
              description="Used for Claude models. Looks like sk-ant-…"
            >
              <ApiKeyInput
                field="anthropic"
                placeholder="sk-ant-…"
                value={anthropic}
                visible={visibleKeys.anthropic}
                onChange={setAnthropic}
                onToggleVisible={toggleVisible}
                autoFocus={autoFocus}
              />
            </Field>
            <Field
              label="OpenAI API"
              description="Used for GPT models. Looks like sk-…"
            >
              <ApiKeyInput
                field="openai"
                placeholder="sk-…"
                value={openai}
                visible={visibleKeys.openai}
                onChange={setOpenai}
                onToggleVisible={toggleVisible}
              />
            </Field>
            <Field
              label="DeepSeek API (optional)"
              description="Used for DeepSeek models. Looks like sk-…"
            >
              <ApiKeyInput
                field="deepseek"
                placeholder="sk-…"
                value={deepseek}
                visible={visibleKeys.deepseek}
                onChange={setDeepseek}
                onToggleVisible={toggleVisible}
              />
            </Field>
            <Field
              label="Kimi / Moonshot API (optional)"
              description="Used for Kimi and Moonshot models. Looks like sk-…"
            >
              <ApiKeyInput
                field="moonshot"
                placeholder="sk-…"
                value={moonshot}
                visible={visibleKeys.moonshot}
                onChange={setMoonshot}
                onToggleVisible={toggleVisible}
              />
            </Field>
          </>
        )}
        {showBrave && (
          <Field
            label="Brave Search API (optional)"
            description="Powers the web-search tool. Without it, search falls back to Anthropic's built-in search."
          >
            <ApiKeyInput
              field="brave"
              placeholder="BSA…"
              value={brave}
              visible={visibleKeys.brave}
              onChange={setBrave}
              onToggleVisible={toggleVisible}
            />
          </Field>
        )}
        {showE2b && (
          <Field
            label="E2B API (optional)"
            description="Enables the E2B remote-sandbox profile, which runs agents in isolated cloud microVMs. Looks like e2b_…"
          >
            <ApiKeyInput
              field="e2b"
              placeholder="e2b_…"
              value={e2b}
              visible={visibleKeys.e2b}
              onChange={setE2b}
              onToggleVisible={toggleVisible}
            />
          </Field>
        )}
      </Stack>
      <Stack gap={2} justify="end" className={styles.actions}>
        {onSecondary && secondaryLabel && (
          <Button
            type="button"
            variant="soft"
            tone="neutral"
            onClick={onSecondary}
            disabled={saving}
          >
            {secondaryLabel}
          </Button>
        )}
        <Button type="submit" disabled={!canSave || saving}>
          {saving ? savingLabel : saveLabel}
        </Button>
      </Stack>
    </form>
  )
}

function ApiKeyInput({
  field,
  placeholder,
  value,
  visible,
  onChange,
  onBlur,
  onToggleVisible,
  autoFocus = false,
}: {
  field: ApiKeyFieldId
  placeholder: string
  value: string
  visible: boolean
  onChange: (value: string) => void
  onBlur?: () => void
  onToggleVisible: (field: ApiKeyFieldId) => void
  autoFocus?: boolean
}): React.ReactElement {
  const label = visible ? `Hide API key` : `Show API key`

  return (
    <div className={styles.secretInput}>
      <Input
        type={visible ? `text` : `password`}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        size={2}
        autoFocus={autoFocus}
        mono
        className={styles.secretInputControl}
      />
      <IconButton
        type="button"
        variant="ghost"
        tone="neutral"
        size={1}
        aria-label={label}
        title={label}
        className={styles.secretInputToggle}
        onClick={() => onToggleVisible(field)}
      >
        <Icon icon={visible ? EyeOff : Eye} size={2} />
      </IconButton>
    </div>
  )
}
