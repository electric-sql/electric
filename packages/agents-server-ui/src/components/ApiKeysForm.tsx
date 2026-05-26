import { useCallback, useState } from 'react'
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
  brave: string
}

type ApiKeyFieldId = keyof ApiKeysFormValues

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
}: ApiKeysFormProps): React.ReactElement {
  const [anthropic, setAnthropic] = useState(initial.anthropic)
  const [openai, setOpenai] = useState(initial.openai)
  const [deepseek, setDeepseek] = useState(initial.deepseek)
  const [brave, setBrave] = useState(initial.brave)
  const [visibleKeys, setVisibleKeys] = useState<
    Record<ApiKeyFieldId, boolean>
  >({
    anthropic: false,
    openai: false,
    deepseek: false,
    brave: false,
  })
  const [saving, setSaving] = useState(false)
  const canSave =
    anthropic.trim().length > 0 ||
    openai.trim().length > 0 ||
    deepseek.trim().length > 0 ||
    brave.trim().length > 0

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!canSave || saving) return
      setSaving(true)
      try {
        await onSave({ anthropic, openai, deepseek, brave })
      } finally {
        setSaving(false)
      }
    },
    [anthropic, openai, deepseek, brave, canSave, saving, onSave]
  )

  const toggleVisible = useCallback((field: ApiKeyFieldId) => {
    setVisibleKeys((current) => ({ ...current, [field]: !current[field] }))
  }, [])

  if (layout === `settings`) {
    return (
      <form onSubmit={handleSubmit} className={styles.settingsForm}>
        {showSuggestionHint && (
          <SettingsPanel>
            <div className={styles.hint}>
              <Icon icon={Sparkles} size={2} />
              <Text size={1} tone="muted">
                Pre-filled from your environment. Click save to persist them.
              </Text>
            </div>
          </SettingsPanel>
        )}
        <SettingsRow
          label="Anthropic API key"
          description="Used for Claude models. Looks like sk-ant-…"
          stackedControl
          control={
            <ApiKeyInput
              field="anthropic"
              placeholder="sk-ant-…"
              value={anthropic}
              visible={visibleKeys.anthropic}
              onChange={setAnthropic}
              onToggleVisible={toggleVisible}
              autoFocus={autoFocus}
            />
          }
        />
        <SettingsRow
          label="OpenAI API key"
          description="Used for GPT models. Looks like sk-…"
          stackedControl
          control={
            <ApiKeyInput
              field="openai"
              placeholder="sk-…"
              value={openai}
              visible={visibleKeys.openai}
              onChange={setOpenai}
              onToggleVisible={toggleVisible}
            />
          }
        />
        <SettingsRow
          label="DeepSeek API key"
          description="Used for DeepSeek models. Looks like sk-…"
          stackedControl
          control={
            <ApiKeyInput
              field="deepseek"
              placeholder="sk-…"
              value={deepseek}
              visible={visibleKeys.deepseek}
              onChange={setDeepseek}
              onToggleVisible={toggleVisible}
            />
          }
        />
        <SettingsRow
          label="Brave Search API key"
          description="Powers the web-search tool. Without it, search falls back to Anthropic's built-in search."
          stackedControl
          control={
            <ApiKeyInput
              field="brave"
              placeholder="BSA…"
              value={brave}
              visible={visibleKeys.brave}
              onChange={setBrave}
              onToggleVisible={toggleVisible}
            />
          }
        />
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
          <Button type="submit" disabled={!canSave || saving}>
            {saving ? savingLabel : saveLabel}
          </Button>
        </SettingsActions>
      </form>
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
        <Field
          label="Anthropic API key"
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
          label="OpenAI API key"
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
          label="DeepSeek API key (optional)"
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
          label="Brave Search API key (optional)"
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
  onToggleVisible,
  autoFocus = false,
}: {
  field: ApiKeyFieldId
  placeholder: string
  value: string
  visible: boolean
  onChange: (value: string) => void
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
